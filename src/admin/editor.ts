import { applySiteEdits } from "../lib/site-edits";

// 公開版はPATでGitHub保存、開発版の紹介文はローカルへ保存。
// 秘密はメモリだけに保持し、ブラウザストレージには書かない。
const editables = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-edit]"));

const contentAuthoringPage = ["/blog/", "/photos/", "/videos/", "/works/"].includes(location.pathname);

if (document.querySelector("[data-edit]") || contentAuthoringPage) {
  const bar = document.createElement("div");
  bar.id = "edit-bar";
  bar.innerHTML = `
    <button id="edit-toggle" type="button">✎ 編集</button>
    <button id="edit-cancel" type="button" hidden>キャンセル</button>
  `;
  document.body.appendChild(bar);

  if (contentAuthoringPage) {
    const panel = document.createElement("section");
    panel.id = "content-editor";
    const worksEditorMarkup = `
        <h2 id="work-editor-heading">作ったものを追加</h2>
        <p class="content-editor-note">出版物・アプリ・Webサイトを登録します。本文を書くと詳細ページが作られ、空にすると一覧からリンク先へ直接飛びます。</p>
        <form id="work-publish-form">
          <p id="work-editing-note" class="content-editor-note" hidden></p>
          <label>種類<select name="type" required>
            <option value="publication">出版物・発表</option>
            <option value="app">アプリ・ツール</option>
            <option value="site">Webサイト</option>
          </select></label>
          <label>タイトル<input name="title" required maxlength="120" /></label>
          <label>公開日・発表日<input name="date" type="date" required /></label>
          <label>説明（一覧用）<input name="description" maxlength="200" /></label>
          <label>掲載先・動作環境<input name="venue" maxlength="120" placeholder="雑誌名・学会名・ストア名など" /></label>
          <label>公開ページ・DOIのURL<input name="url" type="url" placeholder="https://" /></label>
          <label>ソースコードのURL<input name="repo" type="url" placeholder="https://github.com/..." /></label>
          <label>使った技術（カンマ区切り）<input name="tech" placeholder="Python, scikit-learn" /></label>
          <label>タグ（カンマ区切り）<input name="tags" placeholder="研究, 機械学習" /></label>
          <label>本文（任意・Markdown）<textarea name="body" rows="10" placeholder="作った理由や仕組みを書くと詳細ページになります。"></textarea></label>
          <button type="submit">登録する</button>
          <button id="work-edit-cancel" type="button" hidden>新規登録に戻る</button>
        </form>
      `;

    panel.innerHTML = location.pathname === "/works/"
      ? worksEditorMarkup
      : location.pathname === "/blog/"
      ? `
        <h2 id="blog-editor-heading">新しいブログ記事</h2>
        <p class="content-editor-note">${import.meta.env.DEV ? "本文はMarkdownで書けます。画像・動画を選ぶと、記事と一緒にアップロードされます。" : "本文はMarkdownで書けます。写真・動画の追加はローカル管理画面をご利用ください。"}</p>
        <form id="blog-publish-form">
          <p id="blog-editing-note" class="content-editor-note" hidden></p>
          <label>タイトル<input name="title" required maxlength="120" /></label>
          <label>公開日<input name="date" type="date" required /></label>
          <label>説明（一覧用）<input name="description" maxlength="200" /></label>
          <label>タグ（カンマ区切り）<input name="tags" placeholder="日記, 研究" /></label>
          <label>本文<textarea name="body" required rows="14" placeholder="# 見出し\n\n本文をMarkdownで書けます。"></textarea></label>
          <label>画像・動画を添付<input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple /></label>
          <button type="submit">記事を公開</button>
          <button id="blog-edit-cancel" type="button" hidden>新規投稿に戻る</button>
        </form>
      `
      : `
        <h2>${location.pathname === "/photos/" ? "写真を追加" : "動画を追加"}</h2>
        <p class="content-editor-note">1ファイル50MBまで。保存後、GitHub Pagesの再ビルドが終わると公開されます。</p>
        <form id="media-upload-form" data-kind="${location.pathname === "/photos/" ? "photo" : "video"}">
          <label>ファイルを選択<input name="media" type="file" accept="${location.pathname === "/photos/" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm,video/quicktime"}" ${location.pathname === "/photos/" ? "multiple" : ""} required /></label>
          <button type="submit">アップロード</button>
        </form>
      `;
    if (!import.meta.env.DEV) {
      const note = document.createElement("p");
      note.className = "content-editor-note";
      note.textContent = "写真・動画の追加は位置情報保護のため、このMacのローカル管理画面から行ってください。文章の編集・記事の追加・削除はPATで保存できます。";
      panel.prepend(note);
      panel.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(input => { input.disabled = true; });
      panel.querySelector<HTMLButtonElement>('#media-upload-form button[type="submit"]')?.setAttribute("disabled", "");
    }
    document.body.appendChild(panel);
    const dateInput = panel.querySelector<HTMLInputElement>('input[name="date"]');
    if (dateInput) {
      dateInput.value = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    }
  }

  const toggleBtn = bar.querySelector<HTMLButtonElement>("#edit-toggle")!;
  const cancelBtn = bar.querySelector<HTMLButtonElement>("#edit-cancel")!;
  let editing = false;
  const original = new Map<HTMLElement, string>();
  const isDev = import.meta.env.DEV;
  const tokenKey = "githubEditToken";
  const githubFile = "src/data/site.json";
  const githubApi = "https://api.github.com/repos/shuccii/shuccii.github.io/contents/";

  const tokens = new Map<string, string>();
  const requestToken = (key: string, message: string) => {
    let token = tokens.get(key);
    if (!token) token = prompt(message)?.trim() || undefined;
    if (token) tokens.set(key, token);
    return token;
  };
  const getGithubToken = () => requestToken(tokenKey,
    "GitHub fine-grained PATを入力してください\n(repoのContents: Read and write権限が必要です)");
  const getToken = () => isDev
    ? requestToken("editToken", "編集パスワードを入力してください")
    : getGithubToken();

  const authHeaders = (token: string) => ({
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  });

  const encodeBase64 = (value: string) => {
    return encodeBytesBase64(new TextEncoder().encode(value));
  };

  const encodeBytesBase64 = (bytes: Uint8Array) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };

  const githubUrl = (path: string) => `${githubApi}${path.split("/").map(encodeURIComponent).join("/")}`;

  const putGithubFile = async (path: string, content: string, token: string, message: string) => {
    const url = githubUrl(path);
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await fetch(`${url}?ref=main&cacheBust=${Date.now()}`, {
        headers: authHeaders(token), cache: "no-store",
      });
      let sha;
      if (existing.ok) sha = (await existing.json()).sha;
      else if (existing.status !== 404) throw new Error(`保存先を確認できませんでした (${existing.status})`);

      const result = await fetch(url, {
        method: "PUT",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ message, content, ...(sha ? { sha } : {}), branch: "main" }),
      });
      if (result.ok) return;
      if (result.status !== 409 || attempt === 1) {
        throw new Error(`GitHubへの保存に失敗しました (${result.status})`);
      }
    }
  };

  const getGithubTextFile = async (path: string, token: string) => {
    const response = await fetch(`${githubUrl(path)}?ref=main&cacheBust=${Date.now()}`, {
      headers: authHeaders(token), cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHubからファイルを取得できませんでした (${response.status})`);
    const file = await response.json();
    return new TextDecoder().decode(
      Uint8Array.from(atob(file.content.replace(/\n/g, "")), (char) => char.charCodeAt(0)),
    );
  };

  const deleteGithubFile = async (path: string, token: string, message: string) => {
    const url = githubUrl(path);
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await fetch(`${url}?ref=main&cacheBust=${Date.now()}`, {
        headers: authHeaders(token), cache: "no-store",
      });
      if (!existing.ok) throw new Error(`削除対象を確認できませんでした (${existing.status})`);
      const file = await existing.json();
      const result = await fetch(url, {
        method: "DELETE",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ message, sha: file.sha, branch: "main" }),
      });
      if (result.ok) return;
      if (result.status !== 409 || attempt === 1) {
        throw new Error(`GitHubから削除できませんでした (${result.status})`);
      }
    }
  };

  const mediaType = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "photo";
    if (["mp4", "webm", "mov"].includes(ext)) return "video";
    return null;
  };

  const uploadMedia = async (file: File, token: string) => {
    if (!isDev) throw new Error("写真・動画の追加は、位置情報を除去できるローカル管理画面から行ってください。文章の編集・記事の追加・削除はこの公開画面で使えます。");
    const kind = mediaType(file);
    if (!kind) throw new Error(`${file.name} は対応していない形式です`);
    if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} は50MBを超えています`);
    const safeName = file.name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
    const name = `${Date.now()}-${safeName}`;
    const directory = kind === "photo" ? "src/assets/photos" : "src/assets/videos";
    const editToken = await requestToken("editToken", "ローカル管理パスワードを入力してください");
    if (!editToken) throw new Error("メディアの安全確認には管理パスワードが必要です");
    const sanitized = await fetch(`/__sanitize-media?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Edit-Token": editToken }, body: file,
    });
    if (!sanitized.ok) throw new Error("メディアの位置情報を除去できませんでした。公開を中止しました");
    await putGithubFile(`${directory}/${name}`, encodeBytesBase64(new Uint8Array(await sanitized.arrayBuffer())), token, `content: upload ${kind}`);
    return { kind, name };
  };

  const saveToGithub = async (changes: Record<string, string>, token: string) => {
    const url = `${githubApi}${githubFile}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const fileRes = await fetch(`${url}?ref=main&cacheBust=${Date.now()}`, {
        headers: authHeaders(token),
        cache: "no-store",
      });
      if (!fileRes.ok) {
        const detail = await fileRes.text();
        throw new Error(`GitHubからファイルを取得できませんでした (${fileRes.status}) ${detail}`);
      }
      const file = await fileRes.json();
      const data = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(file.content.replace(/\n/g, "")), (char) => char.charCodeAt(0)),
      ));
      const updated = applySiteEdits(data, changes);
      const updateRes = await fetch(url, {
        method: "PUT",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "content: update site text",
          content: encodeBase64(`${JSON.stringify(updated, null, 2)}\n`),
          sha: file.sha,
          branch: "main",
        }),
      });
      if (updateRes.ok) return;
      if (updateRes.status !== 409 || attempt === 1) {
        const detail = await updateRes.text();
        throw new Error(`GitHubへの保存に失敗しました (${updateRes.status}) ${detail}`);
      }
    }
  };

  const setEditing = (on: boolean) => {
    editing = on;
    document.body.classList.toggle("editing", on);
    toggleBtn.textContent = on ? "保存" : "✎ 編集";
    cancelBtn.hidden = !on;
    for (const el of editables()) {
      if (on) {
        original.set(el, el.textContent ?? "");
        el.setAttribute("contenteditable", "plaintext-only");
      } else el.removeAttribute("contenteditable");
    }
  };

  toggleBtn.addEventListener("click", async () => {
    if (!editing) {
      if (await getToken()) setEditing(true);
      return;
    }
    const changes: Record<string, string> = {};
    for (const el of editables()) {
      const value = (el.textContent ?? "").trim();
      if (value !== (original.get(el) ?? "").trim()) changes[el.dataset.edit!] = value;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    toggleBtn.textContent = "保存中…";
    toggleBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const token = tokens.get(isDev ? "editToken" : tokenKey) ?? "";
      if (isDev) {
        const res = await fetch("/__edit", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Edit-Token": token },
          body: JSON.stringify(changes),
        });
        if (!res.ok) throw new Error(res.status === 401 ? "パスワードが違います" : "保存に失敗しました");
      } else {
        await saveToGithub(changes, token);
      }
      setEditing(false);
      toggleBtn.textContent = isDev
        ? "✓ 保存しました"
        : "✓ 保存しました（反映まで少し待ってください）";
      setTimeout(() => (toggleBtn.textContent = "✎ 編集"), 5000);
    } catch (error) {
      if (String(error).includes("401") || String(error).includes("パスワード")) {
        tokens.delete(isDev ? "editToken" : tokenKey);

      }
      toggleBtn.textContent = "保存に失敗";
      alert(`${error instanceof Error ? error.message : "保存に失敗しました"}\nトークンの権限と有効期限を確認してください。`);
    } finally {
      toggleBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", () => {
    for (const el of editables()) el.textContent = original.get(el) ?? el.textContent;
    setEditing(false);
  });

  const setFormBusy = (form: HTMLFormElement, busy: boolean, label: string) => {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    button.textContent = label;
  };

  const showPublished = (form: HTMLFormElement, message: string) => {
    const notice = document.createElement("p");
    notice.className = "content-editor-success";
    notice.textContent = message;
    form.appendChild(notice);
  };

  const mediaForm = document.querySelector<HTMLFormElement>("#media-upload-form");
  mediaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const input = form.querySelector<HTMLInputElement>('input[name="media"]')!;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const kind = form.dataset.kind;
    if (files.some((file) => mediaType(file) !== kind)) {
      alert(kind === "photo" ? "画像ファイルを選択してください。" : "対応する動画ファイルを選択してください。");
      return;
    }
    const token = await getGithubToken();
    if (!token) return;
    setFormBusy(form, true, "アップロード中…");
    try {
      for (const file of files) await uploadMedia(file, token);
      form.reset();
      showPublished(form, "✓ GitHubに保存しました。公開反映まで少し待ってください。");
    } catch (error) {
      alert(error instanceof Error ? error.message : "アップロードに失敗しました");
    } finally {
      setFormBusy(form, false, "アップロード");
    }
  });

  const parseFrontmatter = (markdown: string) => {
    const matched = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const frontmatter = matched?.[1] ?? "";
    const value = (key: string) => frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
    const array = (key: string): string[] => {
      const raw = value(key);
      try { return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []; } catch {
        return raw.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim()).filter(Boolean);
      }
    };
    const text = (key: string) => {
      const raw = value(key);
      try { return String(JSON.parse(raw)); } catch { return raw.replace(/^['"]|['"]$/g, ""); }
    };
    return {
      title: text("title"), date: value("date"), description: text("description"), tags: array("tags"),
      photos: array("photos"), videos: array("videos"), body: matched?.[2]?.trim() ?? "",
      type: text("type"), url: text("url"), repo: text("repo"), venue: text("venue"),
      tech: array("tech"), image: text("image"),
    };
  };

  let editingPost: { path: string; photos: string[]; videos: string[] } | null = null;
  const blogForm = document.querySelector<HTMLFormElement>("#blog-publish-form");
  const blogHeading = document.querySelector<HTMLElement>("#blog-editor-heading");
  const blogNote = document.querySelector<HTMLElement>("#blog-editing-note");
  const blogCancel = document.querySelector<HTMLButtonElement>("#blog-edit-cancel");

  const resetBlogForm = () => {
    editingPost = null;
    blogForm?.reset();
    const date = blogForm?.querySelector<HTMLInputElement>('input[name="date"]')!;
    if (date) date.value = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    if (blogHeading) blogHeading.textContent = "新しいブログ記事";
    if (blogNote) blogNote.hidden = true;
    if (blogCancel) blogCancel.hidden = true;
    const submit = blogForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.textContent = "記事を公開";
  };

  blogCancel?.addEventListener("click", resetBlogForm);

  document.querySelectorAll<HTMLButtonElement>(".blog-edit").forEach((button) => {
    button.addEventListener("click", async () => {
      const token = await getGithubToken();
      const path = button.dataset.blogPath;
      if (!token || !path || !blogForm || !blogHeading || !blogNote || !blogCancel) return;
      try {
        const post = parseFrontmatter(await getGithubTextFile(path, token));
        editingPost = { path, photos: post.photos, videos: post.videos };
        blogForm.querySelector<HTMLInputElement>('input[name="title"]')!.value = post.title;
        blogForm.querySelector<HTMLInputElement>('input[name="date"]')!.value = post.date;
        blogForm.querySelector<HTMLInputElement>('input[name="description"]')!.value = post.description;
        blogForm.querySelector<HTMLInputElement>('input[name="tags"]')!.value = post.tags.join(", ");
        blogForm.querySelector<HTMLTextAreaElement>('textarea[name="body"]')!.value = post.body;
        blogHeading.textContent = "ブログ記事を編集";
        blogNote.textContent = `添付済み: ${[...post.photos, ...post.videos].join(", ") || "なし"}`;
        blogNote.hidden = false;
        blogCancel.hidden = false;
        blogForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = "変更を保存";
        document.getElementById("content-editor")?.scrollTo({ top: 0, behavior: "smooth" });
      } catch (error) {
        alert(error instanceof Error ? error.message : "記事を読み込めませんでした");
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".blog-delete, .media-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const path = button.dataset.blogPath ?? button.dataset.mediaPath;
      const isMedia = Boolean(button.dataset.mediaPath);
      const message = button.dataset.deleteLabel ?? (isMedia
        ? "このファイルを削除しますか？ブログ記事からの参照も表示されなくなります。"
        : "この記事を削除しますか？添付済みの写真・動画は削除されません。");
      if (!path || !confirm(message)) return;
      const token = await getGithubToken();
      if (!token) return;
      button.disabled = true;
      try {
        const what = isMedia
          ? "content: delete media"
          : path.startsWith("src/content/works/")
            ? "content: delete work"
            : "content: delete blog post";
        await deleteGithubFile(path, token, what);
        button.textContent = "削除しました";
        setTimeout(() => location.reload(), 3500);
      } catch (error) {
        button.disabled = false;
        alert(error instanceof Error ? error.message : "削除に失敗しました");
      }
    });
  });

  blogForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const fields = new FormData(form);
    const title = String(fields.get("title") ?? "").trim();
    const date = String(fields.get("date") ?? "");
    const description = String(fields.get("description") ?? "").trim();
    const body = String(fields.get("body") ?? "").trim();
    const tags = String(fields.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const files = Array.from(form.querySelector<HTMLInputElement>('input[name="media"]')!.files ?? []);
    if (!title || !date || !body) return;
    const token = await getGithubToken();
    if (!token) return;
    setFormBusy(form, true, editingPost ? "保存中…" : "公開中…");
    try {
      const uploaded = [];
      for (const file of files) uploaded.push(await uploadMedia(file, token));
      const slugBase = title.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "post";
      const path = editingPost?.path ?? `src/content/blog/${date}-${slugBase}-${Date.now().toString().slice(-6)}.md`;
      const photos = [...(editingPost?.photos ?? []), ...uploaded.filter((file) => file.kind === "photo").map((file) => file.name)];
      const videos = [...(editingPost?.videos ?? []), ...uploaded.filter((file) => file.kind === "video").map((file) => file.name)];
      const markdown = `---\ntitle: ${JSON.stringify(title)}\ndate: ${date}\ndescription: ${JSON.stringify(description)}\ntags: ${JSON.stringify(tags)}\nphotos: ${JSON.stringify(photos)}\nvideos: ${JSON.stringify(videos)}\n---\n\n${body}\n`;
      await putGithubFile(path, encodeBase64(markdown), token, editingPost ? "content: update blog post" : "content: publish blog post");
      const updated = Boolean(editingPost);
      resetBlogForm();
      showPublished(form, updated ? "✓ 変更をGitHubに保存しました。公開反映まで少し待ってください。" : "✓ 記事をGitHubに保存しました。公開反映まで少し待ってください。");
    } catch (error) {
      alert(error instanceof Error ? error.message : "記事の保存に失敗しました");
    } finally {
      setFormBusy(form, false, editingPost ? "変更を保存" : "記事を公開");
    }
  });

  // 作ったもの（/works/）の登録・編集
  let editingWork: { path: string; image: string } | null = null;
  const workForm = document.querySelector<HTMLFormElement>("#work-publish-form");
  const workHeading = document.querySelector<HTMLElement>("#work-editor-heading");
  const workNote = document.querySelector<HTMLElement>("#work-editing-note");
  const workCancel = document.querySelector<HTMLButtonElement>("#work-edit-cancel");

  const resetWorkForm = () => {
    editingWork = null;
    workForm?.reset();
    const date = workForm?.querySelector<HTMLInputElement>('input[name="date"]')!;
    if (date) date.value = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    if (workHeading) workHeading.textContent = "作ったものを追加";
    if (workNote) workNote.hidden = true;
    if (workCancel) workCancel.hidden = true;
    const submit = workForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.textContent = "登録する";
  };

  workCancel?.addEventListener("click", resetWorkForm);

  document.querySelectorAll<HTMLButtonElement>(".work-edit").forEach((button) => {
    button.addEventListener("click", async () => {
      const token = await getGithubToken();
      const path = button.dataset.workPath;
      if (!token || !path || !workForm || !workHeading || !workNote || !workCancel) return;
      try {
        const work = parseFrontmatter(await getGithubTextFile(path, token));
        editingWork = { path, image: work.image };
        const field = (name: string) => workForm.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
        field("type").value = ["publication", "app", "site"].includes(work.type) ? work.type : "app";
        field("title").value = work.title;
        field("date").value = work.date;
        field("description").value = work.description;
        field("venue").value = work.venue;
        field("url").value = work.url;
        field("repo").value = work.repo;
        field("tech").value = work.tech.join(", ");
        field("tags").value = work.tags.join(", ");
        field("body").value = work.body;
        workHeading.textContent = "登録内容を編集";
        workNote.textContent = work.image ? `サムネイル: ${work.image}` : "サムネイル: なし";
        workNote.hidden = false;
        workCancel.hidden = false;
        workForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = "変更を保存";
        document.getElementById("content-editor")?.scrollTo({ top: 0, behavior: "smooth" });
      } catch (error) {
        alert(error instanceof Error ? error.message : "登録内容を読み込めませんでした");
      }
    });
  });

  workForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const fields = new FormData(form);
    const read = (name: string) => String(fields.get(name) ?? "").trim();
    const list = (name: string) => read(name).split(",").map((item) => item.trim()).filter(Boolean);
    const title = read("title");
    const date = read("date");
    if (!title || !date) return;
    const token = await getGithubToken();
    if (!token) return;
    setFormBusy(form, true, editingWork ? "保存中…" : "登録中…");
    try {
      const slugBase = title.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "work";
      const path = editingWork?.path ?? `src/content/works/${date}-${slugBase}-${Date.now().toString().slice(-6)}.md`;
      const body = read("body");
      const markdown = [
        "---",
        `title: ${JSON.stringify(title)}`,
        `type: ${JSON.stringify(read("type") || "app")}`,
        `date: ${date}`,
        `description: ${JSON.stringify(read("description"))}`,
        `url: ${JSON.stringify(read("url"))}`,
        `repo: ${JSON.stringify(read("repo"))}`,
        `venue: ${JSON.stringify(read("venue"))}`,
        `tech: ${JSON.stringify(list("tech"))}`,
        `tags: ${JSON.stringify(list("tags"))}`,
        `image: ${JSON.stringify(editingWork?.image ?? "")}`,
        "---",
        "",
        body ? `${body}\n` : "",
      ].join("\n");
      await putGithubFile(path, encodeBase64(markdown), token, editingWork ? "content: update work" : "content: add work");
      const updated = Boolean(editingWork);
      resetWorkForm();
      showPublished(form, updated ? "✓ 変更をGitHubに保存しました。公開反映まで少し待ってください。" : "✓ GitHubに保存しました。公開反映まで少し待ってください。");
    } catch (error) {
      alert(error instanceof Error ? error.message : "登録に失敗しました");
    } finally {
      setFormBusy(form, false, editingWork ? "変更を保存" : "登録する");
    }
  });
}
