import { readStorage, writeStorage } from "./storage.ts";

type Media = { id: string; url: string } & (
  | { type: "image"; mobileUrl: string; brightness: number }
  | { type: "video" }
);

export function pickBackgroundIndex(media: Media[], last: number, first: boolean, previous: string | null): number {
  const all = media.map((_, index) => index);
  const eligible = all.filter((index) => index !== last && (!first || media[index].type === "image"));
  const preferred = eligible.filter((index) => !first || media[index].id !== previous);
  const pool = preferred.length ? preferred : eligible.length ? eligible : all;
  if (!pool.length) return -1;
  const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return pool[Math.floor(random * pool.length)];
}

export function initializeBackground(): void {
  const data = document.getElementById("background-media");
  const a = document.getElementById("bg-a");
  const b = document.getElementById("bg-b");
  if (!data || !a || !b) return;
  const media: Media[] = JSON.parse(data.textContent || "[]");
  if (!media.length) return;
  const layers = [a, b];
  let showing = 1;
  let last = -1;
  let first = true;
  let timer = 0;
  let pauseTimer = 0;
  let nextWait = 0;
  let suspended = false;
  let pending: AbortController | null = null;

  const paused = () => suspended || document.hidden;
  const tone = (brightness: number) => {
    document.body.classList.toggle("background-dark", brightness < 145);
    document.body.classList.toggle("background-light", brightness >= 145);
  };
  const brightness = (video: HTMLVideoElement) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 150;
      ctx.drawImage(video, 0, 0, 32, 32);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) total += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      return total / (pixels.length / 4);
    } catch {
      return 150;
    }
  };
  const releaseVideo = (layer: HTMLElement) => {
    const video = layer.querySelector("video");
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  };

  const load = (layer: HTMLElement, item: Media, signal: AbortSignal): Promise<number> => new Promise((resolve, reject) => {
    releaseVideo(layer);
    layer.replaceChildren();
    layer.style.backgroundImage = "";
    let settled = false;
    const element = item.type === "image" ? new Image() : document.createElement("video");
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      element.onload = element.onerror = null;
      if (ready) {
        if (item.type === "image") {
          layer.style.backgroundImage = `url("${(element as HTMLImageElement).src}")`;
          resolve(item.brightness);
        } else resolve(brightness(element as HTMLVideoElement));
      } else {
        if (element instanceof HTMLVideoElement) releaseVideo(layer);
        else element.removeAttribute("src");
        reject(new Error("Background unavailable"));
      }
    };
    const abort = () => finish(false);
    const timeout = window.setTimeout(abort, 45000);
    signal.addEventListener("abort", abort, { once: true });
    if (item.type === "image") {
      const image = element as HTMLImageElement;
      image.onload = () => { void image.decode().then(() => finish(true), () => finish(false)); };
      image.onerror = abort;
      image.src = matchMedia("(max-width: 1024px)").matches ? item.mobileUrl : item.url;
    } else {
      const video = element as HTMLVideoElement;
      video.muted = video.defaultMuted = video.loop = video.playsInline = true;
      video.preload = "auto";
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.addEventListener("loadeddata", () => {
        if (!settled) void video.play().then(() => finish(true), abort);
      }, { once: true });
      video.addEventListener("error", abort, { once: true });
      video.src = item.url;
      layer.append(video);
      video.load();
    }
  });

  const schedule = (wait: number) => {
    clearTimeout(timer);
    nextWait = wait;
    if (!paused()) timer = window.setTimeout(() => void swap(), wait);
  };
  const swap = async () => {
    if (paused() || pending) return;
    const index = pickBackgroundIndex(media, last, first, readStorage("local", "lastInitialBackground"));
    if (index < 0) return;
    last = index;
    const controller = new AbortController();
    pending = controller;
    const layer = layers[showing];
    try {
      const value = await load(layer, media[index], controller.signal);
      if (controller.signal.aborted || paused()) return;
      tone(value);
      if (first) writeStorage("local", "lastInitialBackground", media[index].id);
      layer.style.opacity = "1";
      const other = layers[1 - showing];
      other.style.opacity = "0";
      clearTimeout(pauseTimer);
      pauseTimer = window.setTimeout(() => other.querySelector("video")?.pause(), 2600);
      showing = 1 - showing;
      const wait = first ? 15000 : media[index].type === "video" ? 22000 : 9000;
      first = false;
      if (media.length > 1) schedule(wait);
    } catch {
      if (!controller.signal.aborted) schedule(2000);
    } finally {
      if (pending === controller) pending = null;
    }
  };

  const updateVisibility = () => {
    document.body.classList.toggle("background-paused", paused());
    if (paused()) {
      clearTimeout(timer);
      clearTimeout(pauseTimer);
      if (pending) {
        pending.abort();
        pending = null;
        nextWait = 0;
      }
      layers.forEach((layer) => layer.querySelector("video")?.pause());
    } else {
      const video = layers[1 - showing].querySelector("video");
      if (video) void video.play().catch(() => schedule(0));
      if (first || media.length > 1) schedule(nextWait);
    }
  };
  document.addEventListener("visibilitychange", updateVisibility);
  window.addEventListener("pagehide", () => { suspended = true; updateVisibility(); });
  window.addEventListener("pageshow", () => { suspended = false; updateVisibility(); });
  updateVisibility();
}
