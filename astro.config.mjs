// @ts-check
import { defineConfig } from "astro/config";
import fs from "node:fs";
import path from "node:path";

const SITE_JSON = path.resolve("./src/data/site.json");
const SECRET_FILE = path.resolve("./.edit-secret");

// 開発サーバ限定の保存API。編集モード(画面右下の「編集」ボタン)で
// 書き換えたテキストを src/data/site.json に書き戻す。
// .edit-secret に書かれたパスワードを知っている本人だけが保存できる。
// 本番ビルド(静的サイト)には含まれない。
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

        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const changes = JSON.parse(body);
            const data = JSON.parse(fs.readFileSync(SITE_JSON, "utf-8"));
            for (const [key, value] of Object.entries(changes)) {
              if (typeof value !== "string") continue;
              const parts = key.split(".");
              let obj = data;
              for (let i = 0; i < parts.length - 1; i++) {
                obj = obj?.[parts[i]];
              }
              // site.json に既に存在するテキスト項目だけを上書きする
              if (obj && typeof obj[parts[parts.length - 1]] === "string") {
                obj[parts[parts.length - 1]] = value;
              }
            }
            fs.writeFileSync(SITE_JSON, JSON.stringify(data, null, 2) + "\n");
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
