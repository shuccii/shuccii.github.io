import test from "node:test";
import assert from "node:assert/strict";
import { applySiteEdits } from "../src/lib/site-edits.ts";
import { pickBackgroundIndex } from "../src/lib/background.ts";
import { readStorage, writeStorage, removeStorage } from "../src/lib/storage.ts";

test("site text edits preserve other data and reject invalid batches atomically", () => {
  const original = { home: { title: "庭", tags: ["写真"] }, enabled: true };
  const result = applySiteEdits(original, { "home.title": "新しい庭" });
  assert.deepEqual(result, { home: { title: "新しい庭", tags: ["写真"] }, enabled: true });
  assert.equal(original.home.title, "庭");
  for (const changes of [null, [], { "home.title": "変更", "home.missing": "x" }, { "home.tags": "x" }, { enabled: "x" }, { "home.title": 1 }]) {
    assert.throws(() => applySiteEdits(original, changes));
    assert.equal(original.home.title, "庭");
  }
});

test("prototype aliases, inherited fields, empty paths and oversized text are rejected", () => {
  const data = { home: { title: "庭" } };
  for (const key of ["__proto__.polluted", "constructor.prototype.polluted", "home.__proto__.title", "home.toString", "home..title", ""]) {
    assert.throws(() => applySiteEdits(data, { [key]: "x" }));
  }
  assert.throws(() => applySiteEdits(data, { "home.title": "x".repeat(100001) }));
  assert.equal({}.polluted, undefined);
});

test("background selection handles empty, single-image and video-only catalogs", () => {
  const image = { id: "photo", type: "image", url: "/photo", mobileUrl: "/photo", brightness: 100 };
  const video = { id: "film", type: "video", url: "/film" };
  assert.equal(pickBackgroundIndex([], -1, true, null), -1);
  assert.equal(pickBackgroundIndex([image], 0, true, "photo"), 0);
  assert.equal(pickBackgroundIndex([video], -1, true, null), 0);
  assert.equal(pickBackgroundIndex([image, video], -1, true, null), 0);
  assert.equal(pickBackgroundIndex([image, video], 0, false, null), 1);
  assert.equal(pickBackgroundIndex([image, { ...image, id: "other" }], -1, true, "photo"), 1);
});

test("storage helpers tolerate blocked access to the storage object itself", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    globalThis.window = Object.defineProperties({}, {
      localStorage: { get() { throw new Error("SecurityError"); } },
      sessionStorage: { get() { throw new Error("SecurityError"); } },
    });
    for (const kind of ["local", "session"]) {
      assert.equal(readStorage(kind, "key"), null);
      assert.doesNotThrow(() => writeStorage(kind, "key", "value"));
      assert.doesNotThrow(() => removeStorage(kind, "key"));
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  }
});

test("production CSP forbids inline scripts and JS is never inlined into HTML", async () => {
  const { assetsInlineLimit, scriptSrc } = await import("../scripts/build-safety.mjs");
  assert.equal(scriptSrc(false).includes("'unsafe-inline'"), false);
  assert.match(scriptSrc(false), /^script-src 'self'/);
  assert.equal(scriptSrc(true).includes("'unsafe-inline'"), true);
  for (const file of ["_astro/page.js", "a.mjs", "b.CJS"]) assert.equal(assetsInlineLimit(file), false);
  for (const file of ["icon.svg", "photo.webp", "style.css"]) assert.equal(assetsInlineLimit(file), undefined);
});

test("frame guard only blocks embedding by other origins", async () => {
  const { isForeignFrame } = await import("../src/lib/frame-guard.ts");
  const self = { origin: "https://shuccii.github.io" };
  const topLevel = { location: self };
  topLevel.self = topLevel;
  topLevel.top = topLevel;
  assert.equal(isForeignFrame(topLevel), false);

  const sameOriginParent = { location: self };
  assert.equal(isForeignFrame({ self: {}, top: sameOriginParent, location: self }), false);

  const crossOriginParent = {
    get location() {
      throw new DOMException("Blocked a frame", "SecurityError");
    },
  };
  assert.equal(isForeignFrame({ self: {}, top: crossOriginParent, location: self }), true);
  assert.equal(isForeignFrame({ self: {}, top: { location: { origin: "https://evil.example" } }, location: self }), true);
});
