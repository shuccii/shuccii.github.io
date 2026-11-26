// ビルド時の安全設定。astro.config.mjs と tests/site-safety.test.mjs から使う。

/**
 * Vite / Astro の assetsInlineLimit に渡す判定関数。
 *
 * Astro は小さな <script> をHTMLへ直接埋め込む(インライン化する)が、そうすると
 * CSP の script-src に 'unsafe-inline' が必要になり、万一XSSが入り込んだときに
 * CSP が防波堤として働かなくなる。そこでJSだけは必ず外部ファイルとして出力し、
 * script-src 'self' で許可できるようにする。
 * JS以外(小さな画像など)は Vite の既定(4KB未満ならインライン)に任せる。
 *
 * @param {string} filePath
 * @returns {boolean | undefined}
 */
export function assetsInlineLimit(filePath) {
  if (/\.(m?js|cjs)$/i.test(filePath)) return false;
  return undefined;
}

/**
 * 本番で使う script-src。'unsafe-inline' は開発サーバ(Vite の注入スクリプト)でだけ許可する。
 *
 * @param {boolean} dev
 * @returns {string}
 */
export function scriptSrc(dev) {
  return ["script-src 'self'", ...(dev ? ["'unsafe-inline'"] : []), "https://static.cloudflareinsights.com"].join(" ");
}
