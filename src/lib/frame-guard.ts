// クリックジャッキング対策。
// GitHub Pages では X-Frame-Options や CSP の frame-ancestors(HTTPヘッダー限定)を
// 付けられないため、他サイトの iframe 内で開かれたらページを隠し、
// 本来のURLを新しいタブで開くリンクだけを表示する。
// コメント・いいね・意見ボックスはどれもJSで送信するので、
// JSを止めた sandbox iframe に入れられても送信操作はできない。

type FrameWindow = Pick<Window, "self" | "top" | "location">;

/** 別オリジンのページに埋め込まれているか。同じサイト内の iframe は許可する。 */
export function isForeignFrame(win: FrameWindow): boolean {
  if (win.top === win.self || win.top === null) return false;
  try {
    return win.top.location.origin !== win.location.origin;
  } catch {
    // 別オリジンの親には触れないので例外になる。
    return true;
  }
}

export function guardAgainstFraming(win: Window = window): boolean {
  if (!isForeignFrame(win)) return false;
  const doc = win.document;
  doc.documentElement.setAttribute("data-framed", "");
  const link = doc.createElement("a");
  link.href = win.location.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "このページを新しいタブで開く";
  link.className = "frame-guard-link";
  doc.body.replaceChildren(link);
  return true;
}
