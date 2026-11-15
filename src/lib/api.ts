export type JobStatus = "queued" | "running" | "done" | "failed";

export type Job = {
  id: string;
  title: string | null;
  notes: string;
  format: FormatId;
  maxSeconds: number | null;
  captions: boolean;
  clips: string[];
  status: JobStatus;
  stage?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  output: string | null;
  thumbnail: string | null;
  durationSeconds?: number;
  error: string | null;
  log: string[];
  webhook?: { sent: boolean; status?: number; reason?: string };
};

export type Clip = { key: string; size: number; uploaded: string; thumb: string | null };
export type Folder = { prefix: string; name: string };
export type Listing = { prefix: string; folders: Folder[]; files: Clip[] };

export type FormatId = "short-9x16" | "vlog-16x9" | "square-1x1" | "portrait-4x5";

export const FORMATS: { id: FormatId; label: string; size: string; where: string }[] = [
  { id: "short-9x16", label: "Short 9:16", size: "1080 × 1920", where: "Shorts, Reels, TikTok" },
  { id: "vlog-16x9", label: "Vlog 16:9", size: "1920 × 1080", where: "YouTube" },
  { id: "square-1x1", label: "Square 1:1", size: "1080 × 1080", where: "Feed posts" },
  { id: "portrait-4x5", label: "Portrait 4:5", size: "1080 × 1350", where: "Instagram feed" },
];

export const DEFAULT_API = "https://vlog-queue-api.thl007.workers.dev";

const LS_API = "vq.api";
const LS_TOKEN = "vq.token";

export function getSettings() {
  if (typeof window === "undefined") return { api: DEFAULT_API, token: "" };
  return {
    api: localStorage.getItem(LS_API) || DEFAULT_API,
    token: localStorage.getItem(LS_TOKEN) || "",
  };
}

export function saveSettings(api: string, token: string) {
  localStorage.setItem(LS_API, api.replace(/\/+$/, ""));
  localStorage.setItem(LS_TOKEN, token);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { api, token } = getSettings();
  if (!token) throw new ApiError("Add your access token in Settings.", 401);
  let res: Response;
  try {
    res = await fetch(`${api}/api${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
    });
  } catch {
    throw new ApiError("Can't reach the API. Check the URL in Settings or your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export async function status(apiBase: string) {
  const res = await fetch(`${apiBase.replace(/\/+$/, "")}/api/status`).catch(() => null);
  if (!res || !res.ok) throw new ApiError("Can’t reach the API. Check the URL.", res?.status ?? 0);
  return (await res.json()) as { ready: boolean; appTokenSet: boolean; webhook: boolean };
}

export async function setupApp(apiBase: string, body: { appToken?: string; webhookSecret?: string }, currentToken?: string) {
  const res = await fetch(`${apiBase.replace(/\/+$/, "")}/api/setup/app`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(currentToken ? { authorization: `Bearer ${currentToken}` } : {}) },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new ApiError("Can’t reach the API. Check the URL.", 0);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Setup failed (${res.status})`, res.status);
  return data as { ok: boolean; webhook: boolean };
}

export const api = {
  health: () => call<{ ok: boolean; webhook: boolean }>("/health"),
  jobs: () => call<{ jobs: Job[] }>("/jobs").then((r) => r.jobs),
  createJob: (body: { title: string | null; notes: string; format: FormatId; clips: string[]; maxSeconds: number | null; captions: boolean }) =>
    call<{ job: Job }>("/jobs", { method: "POST", body: JSON.stringify(body) }).then((r) => r.job),
  retry: (id: string) => call<{ job: Job }>(`/jobs/${id}?action=retry`, { method: "POST" }).then((r) => r.job),
  broll: (prefix = "broll/") => call<Listing>(`/broll?prefix=${encodeURIComponent(prefix)}`),
  organize: (keys: string[]) => call<{ webhook: { sent: boolean } }>("/broll/organize", { method: "POST", body: JSON.stringify({ keys }) }),
  putThumb: (key: string, jpeg: Blob) => call(`/thumbs?key=${encodeURIComponent(key)}`, { method: "PUT", body: jpeg, headers: { "content-type": "image/jpeg" } }),
  deleteClip: (key: string) => call(`/broll?key=${encodeURIComponent(key)}`, { method: "DELETE" }),
  sign: (keys: string[]) => call<{ urls: Record<string, string> }>("/sign", { method: "POST", body: JSON.stringify({ keys }) }).then((r) => r.urls),
};

const PART = 10 * 1024 * 1024;

/** Chunked upload through the Worker into R2. Calls onProgress with 0..1. */
export async function uploadFile(file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const { key, uploadId } = await call<{ key: string; uploadId: string }>("/uploads", {
    method: "POST",
    body: JSON.stringify({ name: file.name, contentType: file.type }),
  });
  const total = Math.max(1, Math.ceil(file.size / PART));
  const parts: { partNumber: number; etag: string }[] = [];
  let done = 0;
  const queue = Array.from({ length: total }, (_, i) => i + 1);
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new ApiError("Upload cancelled", 0);
      const n = queue.shift()!;
      const blob = file.slice((n - 1) * PART, n * PART);
      let attempt = 0;
      for (;;) {
        try {
          const r = await call<{ partNumber: number; etag: string }>(
            `/uploads/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&part=${n}`,
            { method: "PUT", body: blob, signal },
          );
          parts.push(r);
          break;
        } catch (e) {
          if (++attempt >= 3 || signal?.aborted) throw e;
        }
      }
      done++;
      onProgress(done / total);
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) {
    await call("/uploads/abort", { method: "POST", body: JSON.stringify({ key, uploadId }) }).catch(() => {});
    throw e;
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  await call("/uploads/complete", { method: "POST", body: JSON.stringify({ key, uploadId, parts }) });
  return key;
}

export function fileName(key: string) {
  return key.split("/").pop()!.replace(/^[a-f0-9]{6}-/, "");
}

export function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function duration(s?: number) {
  if (!s && s !== 0) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Grab a small JPEG from a local video or image file, in the browser, for an instant thumbnail. */
export async function makeThumb(file: File): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    let source: HTMLVideoElement | HTMLImageElement;
    let w: number, h: number;
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    } else if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = url;
      await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error("no metadata")); });
      v.currentTime = Math.min(1, (v.duration || 0) / 3);
      await new Promise<void>((ok, bad) => { v.onseeked = () => ok(); v.onerror = () => bad(new Error("seek failed")); });
      source = v;
      w = v.videoWidth;
      h = v.videoHeight;
    } else return null;
    const scale = 320 / Math.max(w, 1);
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.72));
  } catch {
    return null; // Vlog Boy fills missing thumbnails when it sorts the inbox
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function folderLabel(name: string) {
  return name === "_inbox" ? "Inbox" : name;
}
