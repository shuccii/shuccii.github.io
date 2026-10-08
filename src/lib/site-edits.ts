// ローカル保存とGitHub保存で、同じ既存テキスト項目だけを更新する。
export function applySiteEdits<T extends object>(data: T, changes: unknown): T {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("変更内容が正しくありません");
  const entries = Object.entries(changes);
  if (entries.length > 200) throw new Error("変更項目が多すぎます");
  const updated = structuredClone(data);
  for (const [key, value] of entries) {
    const parts = key.split(".");
    if (typeof value !== "string" || value.length > 100000 || key.length > 200 ||
        parts.some((part) => !part || ["__proto__", "prototype", "constructor"].includes(part))) {
      throw new Error("変更項目が正しくありません");
    }
    let current: unknown = updated;
    for (const [index, part] of parts.entries()) {
      if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) {
        throw new Error(`編集できない項目です: ${key}`);
      }
      const object = current as Record<string, unknown>;
      if (index === parts.length - 1) {
        if (typeof object[part] !== "string") throw new Error(`編集できない項目です: ${key}`);
        object[part] = value;
      } else current = object[part];
    }
  }
  return updated;
}
