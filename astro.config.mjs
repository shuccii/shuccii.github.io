// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { applySiteEdits } from "./src/lib/site-edits";
import { publicationPrivacy, sanitizeMedia } from "./scripts/media-privacy.mjs";

const SITE_JSON = path.resolve("./src/data/site.json");
const SECRET_FILE = path.resolve("./.edit-secret");

// 開発サーバ限定の保存API。編集モード(画面右下の「編集」ボタン)で
// 書き換えたテキストを src/data/site.json に書き戻す。
// .edit-secret に書かれたパスワードを知っている本人だけが保存できる。
// 本番ビルド(静的サイト)には含まれない。
/** @returns {import("vite").Plugin} */
function editApi() {
  return {
    name: "edit-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!["/__edit", "/__sanitize-media"].includes(url.pathname)) return next();
        if (req.method !== "POST") return next();

        // Do not expose management APIs through LAN hosts, DNS rebinding or
        // cross-origin requests. Both browser requests send a local secret.
        const host = req.headers.host ?? "";
        const allowedHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
        if (!allowedHost || req.headers.origin !== `http://${host}`) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        // パスワード認証(.edit-secret と X-Edit-Token ヘッダを照合)
        let secret = "";
        try {
          secret = fs.readFileSync(SECRET_FILE, "utf-8").trim();
        } catch {
          /* ファイルがなければ常に拒否 */
        }
        const token = String(req.headers["x-edit-token"] ?? "");
        if (!secret || token !== secret) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end('{"ok":false,"error":"unauthorized"}');
          return;
        }

        /** @type {Buffer[]} */
        const chunks = [];
        let bytes = 0;
        let rejected = false;
        req.on("data", /** @param {Buffer} chunk */ (chunk) => {
          if (rejected) return;
          bytes += chunk.length;
          if (bytes > (url.pathname === "/__sanitize-media" ? 50 * 1024 * 1024 : 256 * 1024)) {
            rejected = true;
            chunks.length = 0;
            res.statusCode = 413;
            res.setHeader("Content-Type", "application/json");
            res.end('{"ok":false,"error":"payload too large"}');
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", async () => {
          if (rejected) return;
          let staging;
          try {
            if (url.pathname === "/__sanitize-media") {
              const extension = path.extname(url.searchParams.get("name") ?? "").toLowerCase();
              if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".webm"].includes(extension)) throw new Error("unsupported media");
              staging = await mkdtemp(path.join(os.tmpdir(), "mypage-media-"));
              const file = path.join(staging, `upload${extension}`);
              await writeFile(file, Buffer.concat(chunks), { mode: 0o600 });
              await sanitizeMedia(file);
              res.setHeader("Content-Type", "application/octet-stream");
              res.end(await readFile(file));
              return;
            }
            const body = Buffer.concat(chunks).toString("utf-8");
            const changes = JSON.parse(body);
            const data = JSON.parse(fs.readFileSync(SITE_JSON, "utf-8"));
            const updated = applySiteEdits(data, changes);
            fs.writeFileSync(SITE_JSON, JSON.stringify(updated, null, 2) + "\n");
            res.setHeader("Content-Type", "application/json");
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "保存内容の安全確認に失敗しました" }));
          } finally {
            if (staging) await rm(staging, { recursive: true, force: true });
          }
        });
      });
    },
  };
}

export default defineConfig({
  site: "https://shuccii.github.io",
  integrations: [
    publicationPrivacy(),
    // sitemap-index.xml を生成する。404ページはクロール対象から外す。
    sitemap({
      filter: (page) =>
        !page.endsWith("/404/") &&
        !page.endsWith("/404") &&
        // アクセス記録の管理ページは検索結果に出さない
        !page.endsWith("/visits/") &&
        !page.endsWith("/visits"),
    }),
  ],
  build: {
    // 小さな共通CSSはHTMLへ含め、初期表示時の2本の待ち時間をなくす。
    inlineStylesheets: "always",
  },
  vite: {
    plugins: [editApi()],
    build: {
      // 標準版とSafari版のbackdrop-filterを両方残す。
      cssMinify: "esbuild",
    },
  },
  server: { host: "127.0.0.1" },
});
