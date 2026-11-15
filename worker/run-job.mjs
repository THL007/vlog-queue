#!/usr/bin/env node
// Render one Vlog Queue job on this server with ffmpeg.
// Usage: node worker/run-job.mjs <jobId> [--keep] [--max <seconds>] [--title "<title>"] [--type <video type>]
// Env (worker/.env or process env): VQ_API (Worker URL), VQ_TOKEN (same as the app's access token).
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const envFile = join(HERE, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const API = (process.env.VQ_API || "https://vlog-queue-api.thl007.workers.dev").replace(/\/+$/, "");
const TOKEN = process.env.VQ_TOKEN;
const jobId = process.argv[2];
const keep = process.argv.includes("--keep");
const argVal = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const argMax = Number(argVal("--max")) || null; // Vlog Boy's chosen length when the job has none
const argTitle = argVal("--title") || null; // Vlog Boy's chosen title when the job has none
const argType = argVal("--type") || null; // Vlog Boy's chosen video type when the job has none
if (!TOKEN) die("VQ_TOKEN missing (worker/.env)");
if (!jobId || !/^[A-Za-z0-9-]+$/.test(jobId)) die("usage: run-job.mjs <jobId>");

const PRESETS = {
  "short-9x16": { w: 1080, h: 1920, defaultMax: 60 },
  "vlog-16x9": { w: 1920, h: 1080, defaultMax: null },
  "square-1x1": { w: 1080, h: 1080, defaultMax: 60 },
  "portrait-4x5": { w: 1080, h: 1350, defaultMax: 60 },
};
const FPS = 30;
// Longest a single clip may run, by video type (null = keep the clip's own length).
const PACE = { montage: 1.6, "day-in-life": 2.8, travel: 3.2, food: 2.4, grwm: 2.6, tutorial: null, cinematic: 5.5, explainer: 4, product: 3, talking: null };
const STILL_SECONDS = 3;

function die(msg) {
  console.error(`run-job: ${msg}`);
  process.exit(1);
}

async function call(path, init = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
    duplex: init.body && typeof init.body !== "string" ? "half" : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path}: ${data.error || res.status}`);
  return data;
}
const patch = (body) => call(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) }).catch((e) => console.error("patch failed:", e.message));

function run(cmd, args, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => { err += d; if (!quiet) process.stderr.write(d); });
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.split("\n").slice(-6).join(" ")}`))));
  });
}

async function probe(file) {
  const out = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
  const a = j.streams.find((s) => s.codec_type === "audio");
  const dur = Number(j.format.duration) || 0;
  const isImage = v && (!dur || ["png", "mjpeg", "webp", "bmp", "tiff", "gif"].includes(v.codec_name)) && !a && (dur < 0.2 || ["png", "mjpeg", "webp", "bmp", "tiff"].includes(v.codec_name));
  return { kind: isImage ? "image" : v ? "video" : a ? "audio" : "unknown", duration: dur, hasAudio: Boolean(a) };
}

async function listAllFiles(prefix, acc = []) {
  const r = await call(`/broll?prefix=${encodeURIComponent(prefix)}`);
  for (const f of r.files) acc.push(f.key);
  for (const f of r.folders) await listAllFiles(f.prefix, acc);
  return acc;
}

// organize.mjs moves inbox clips to broll/<folder>/<name without the 6-hex prefix>
// (maybe with a suffix on name clashes). Find the moved copy of an inbox key.
async function findMoved(key) {
  if (!key.startsWith("broll/_inbox/")) return null;
  const name = key.split("/").pop().replace(/^[a-f0-9]{6}-/, "");
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const files = (await listAllFiles("broll/")).filter((k) => !k.startsWith("broll/_inbox/"));
  const base = (k) => k.split("/").pop();
  return files.find((k) => base(k) === name) || files.find((k) => base(k).startsWith(stem) && base(k).endsWith(ext)) || null;
}

async function download(key, dest) {
  const sign = async (k) => (await call("/sign", { method: "POST", body: JSON.stringify({ keys: [k] }) })).urls[k];
  let res = await fetch(await sign(key));
  if (res.status === 404) {
    const moved = await findMoved(key);
    if (moved) {
      console.error(`clip ${key} was moved to ${moved}`);
      res = await fetch(await sign(moved));
    }
  }
  if (!res.ok) throw new Error(`download ${key}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function upload(file, key, contentType) {
  const PART = 10 * 1024 * 1024;
  const prefix = key.slice(0, key.lastIndexOf("/"));
  const name = key.slice(key.lastIndexOf("/") + 1);
  const { key: finalKey, uploadId } = await call("/uploads", { method: "POST", body: JSON.stringify({ name, contentType, prefix }) });
  const size = statSync(file).size;
  const parts = [];
  const fd = openSync(file, "r");
  try {
    for (let n = 1, off = 0; off < size || n === 1; n++, off += PART) {
      const len = Math.min(PART, size - off);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, off);
      parts.push(await call(`/uploads/part?key=${encodeURIComponent(finalKey)}&uploadId=${encodeURIComponent(uploadId)}&part=${n}`, { method: "PUT", body: buf }));
      if (off + PART >= size) break;
    }
  } finally {
    closeSync(fd);
  }
  await call("/uploads/complete", { method: "POST", body: JSON.stringify({ key: finalKey, uploadId, parts }) });
  return finalKey;
}

const work = join(HERE, "..", "work", jobId);

try {
  const { job } = await call(`/jobs/${jobId}`);
  const preset = PRESETS[job.format];
  if (!preset) throw new Error(`unknown format ${job.format}`);
  const { w, h } = preset;
  const maxSeconds = job.maxSeconds || argMax || preset.defaultMax;
  if (!job.title && argTitle) job.title = argTitle.slice(0, 140);

  await patch({ status: "running", stage: "downloading clips", progress: 0.05, error: null, logLine: "render started", ...(job.title ? { title: job.title } : {}), ...(!job.type && argType ? { type: argType } : {}), ...(!job.maxSeconds && maxSeconds ? { maxSeconds } : {}) });
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const inputs = [];
  for (const [i, key] of job.clips.entries()) {
    const ext = (key.match(/\.[A-Za-z0-9]{1,5}$/) || [".bin"])[0].toLowerCase();
    const file = join(work, `in-${String(i).padStart(3, "0")}${ext}`);
    await download(key, file);
    inputs.push({ key, file, ...(await probe(file)) });
    await patch({ progress: 0.05 + 0.2 * ((i + 1) / job.clips.length), stage: `downloaded ${i + 1} of ${job.clips.length}` });
  }

  const visuals = inputs.filter((x) => x.kind === "video" || x.kind === "image");
  const music = inputs.find((x) => x.kind === "audio");
  if (!visuals.length) throw new Error("no video or image clips in this job");

  // Time budget per visual clip.
  const type = job.type || argType;
  const pace = type ? PACE[type] : null;
  const natural = visuals.map((v) => {
    const own = v.kind === "image" ? STILL_SECONDS : Math.max(0.5, v.duration);
    return pace ? Math.min(own, v.kind === "image" ? Math.min(STILL_SECONDS, pace + 0.6) : pace) : own;
  });
  const total = natural.reduce((a, b) => a + b, 0);
  const scale = maxSeconds && total > maxSeconds ? maxSeconds / total : 1;

  const fit = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},format=yuv420p`;
  const segs = [];
  for (const [i, v] of visuals.entries()) {
    const len = Math.max(0.8, natural[i] * scale);
    // For trimmed video, keep the middle of the clip (skip shaky starts).
    const start = v.kind === "video" && len < v.duration ? Math.max(0, (v.duration - len) / 2) : 0;
    const seg = join(work, `seg-${String(i).padStart(3, "0")}.mp4`);
    const args = ["-y", "-hide_banner"];
    if (v.kind === "image") args.push("-loop", "1", "-t", String(len), "-i", v.file);
    else args.push("-ss", start.toFixed(3), "-t", len.toFixed(3), "-i", v.file);
    args.push("-f", "lavfi", "-t", len.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    const audioMap = v.kind === "video" && v.hasAudio ? "0:a:0" : "1:a:0";
    const vf = v.kind === "image" ? `${fit},zoompan=z='min(zoom+0.0008,1.08)':d=${Math.ceil(len * FPS)}:s=${w}x${h}:fps=${FPS}` : fit;
    args.push("-map", "0:v:0", "-map", audioMap, "-vf", vf, "-af", "aresample=48000,aformat=channel_layouts=stereo", "-t", len.toFixed(3),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", seg);
    await run("ffmpeg", args);
    segs.push(seg);
    await patch({ progress: 0.25 + 0.45 * ((i + 1) / visuals.length), stage: `cutting clip ${i + 1} of ${visuals.length}` });
  }

  await patch({ stage: "joining and mixing audio", progress: 0.72 });
  const list = join(work, "list.txt");
  writeFileSync(list, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
  const joined = join(work, "joined.mp4");
  await run("ffmpeg", ["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
  const joinedDur = (await probe(joined)).duration;

  const out = join(work, "output.mp4");
  const fade = Math.min(0.6, joinedDur / 4);
  const vfade = `fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0, joinedDur - fade).toFixed(3)}:d=${fade}`;
  if (music) {
    // Music under the clip sound, ducked when the clips are loud, then loudness-normalised.
    await run("ffmpeg", ["-y", "-hide_banner", "-i", joined, "-stream_loop", "-1", "-i", music.file,
      "-filter_complex",
      `[1:a]atrim=0:${joinedDur.toFixed(3)},volume=0.6,afade=t=out:st=${Math.max(0, joinedDur - 1.5).toFixed(3)}:d=1.5[m];` +
      `[0:a]asplit=2[c][sc];[m][sc]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[md];` +
      `[c][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a];[0:v]${vfade}[v]`,
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", joinedDur.toFixed(3), out]);
  } else {
    await run("ffmpeg", ["-y", "-hide_banner", "-i", joined, "-vf", vfade, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  }
  if (job.captions) await patch({ logLine: "captions requested: base cut has none; Vlog Boy adds them when the clips have speech" });

  await patch({ stage: "uploading", progress: 0.9 });
  const thumb = join(work, "thumbnail.jpg");
  await run("ffmpeg", ["-y", "-hide_banner", "-ss", String(Math.min(1, joinedDur / 2)), "-i", out, "-frames:v", "1", "-vf", `scale=${Math.round(w / 2)}:-2`, "-q:v", "3", thumb]);
  const outKey = await upload(out, `jobs/${jobId}/output.mp4`, "video/mp4");
  const thumbKey = await upload(thumb, `jobs/${jobId}/thumbnail.jpg`, "image/jpeg");
  const finalDur = (await probe(out)).duration;
  await patch({ status: "done", stage: "done", progress: 1, output: outKey, thumbnail: thumbKey, durationSeconds: Math.round(finalDur * 10) / 10, logLine: `rendered ${finalDur.toFixed(1)}s ${w}x${h}` });
  console.log(JSON.stringify({ ok: true, jobId, title: job.title, format: job.format, output: outKey, seconds: finalDur }));
  if (!keep) rmSync(work, { recursive: true, force: true });
} catch (e) {
  await patch({ status: "failed", stage: "failed", error: String(e.message || e).slice(0, 400), logLine: `failed: ${String(e.message || e).slice(0, 200)}` });
  console.error(`run-job failed: ${e.stack || e}`);
  process.exit(1);
}
