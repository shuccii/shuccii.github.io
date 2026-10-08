// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import fs from "node:fs";
import path from "node:path";
import { applySiteEdits } from "./src/lib/site-edits";

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
      server.middlewares.use("/__edit", (req, res, next) => {
        if (req.method !== "POST") return next();

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
          if (bytes > 256 * 1024) {
            rejected = true;
            chunks.length = 0;
            res.statusCode = 413;
            res.setHeader("Content-Type", "application/json");
            res.end('{"ok":false,"error":"payload too large"}');
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (rejected) return;
          try {
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
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  site: "https://shuccii.github.io",
  integrations: [
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
});
