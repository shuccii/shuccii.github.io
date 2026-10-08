// Storageへのアクセス自体が拒否されるブラウザでも、表示や送信を続ける。
export function readStorage(kind: "local" | "session", key: string): string | null {
  try {
    return window[kind === "local" ? "localStorage" : "sessionStorage"].getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(kind: "local" | "session", key: string, value: string): void {
  try {
    window[kind === "local" ? "localStorage" : "sessionStorage"].setItem(key, value);
  } catch {
    // 保存できない場合は、呼び出し元が保持する値を使う。
  }
}

export function removeStorage(kind: "local" | "session", key: string): void {
  try {
    window[kind === "local" ? "localStorage" : "sessionStorage"].removeItem(key);
  } catch {
    // 未保存なら削除も不要。
  }
}
