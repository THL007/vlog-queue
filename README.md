# Vlog Queue

An Expo (web) PWA for sending B-roll to the Vlog Boy agent and collecting the finished videos.

- **Live app:** https://thl007.github.io/vlog-queue/ (add it to your home screen to install it)
- **API:** https://vlog-queue-api.thl007.workers.dev (Cloudflare Worker, bound to the R2 bucket `vlog-queue`)

## How it works

```mermaid
sequenceDiagram
  participant App as PWA (GitHub Pages)
  participant API as Worker API
  participant R2 as R2 bucket vlog-queue
  participant OB as OpenBot webhook
  participant VB as Vlog Boy (render server)
  App->>API: upload B-roll in 10 MB parts
  API->>R2: broll/<date>/<file>
  App->>API: POST /api/jobs (clips, format, notes)
  API->>R2: jobs/<id>/job.json (queued)
  API->>OB: signed webhook vlog.job.created
  OB->>VB: routine run
  VB->>API: PATCH status, progress, stage
  VB->>API: upload jobs/<id>/output.mp4 + thumbnail.jpg
  App->>API: poll /api/jobs, play or download the result
```

## Library

Uploads land in `broll/_inbox/`. When a batch finishes, the app sends `vlog.broll.uploaded` and Vlog Boy sorts the clips into folders (`worker/organize.mjs inspect` makes contact sheets, `move` applies the plan). Every clip has a thumbnail at `thumbs/<clip key>.jpg`: the browser grabs one at upload, and Vlog Boy fills in any that are missing. The library shows folders collapsed and loads a folder's contents only when you open it.

Title and length are optional: when they are empty, Vlog Boy picks them (`run-job.mjs --title`, `--max`).

The bucket is the source of truth. The browser never sees bucket keys or the webhook secret: it only holds an access token, and reads files through signed links that expire after an hour.

## Formats

| Preset | Size | For |
| --- | --- | --- |
| `short-9x16` | 1080 × 1920 | Shorts, Reels, TikTok (60 s default cap) |
| `vlog-16x9` | 1920 × 1080 | YouTube |
| `square-1x1` | 1080 × 1080 | Feed posts |
| `portrait-4x5` | 1080 × 1350 | Instagram feed |

Upload an audio file with the clips and pick it: it becomes the music bed, ducked under the clip sound. Everything is loudness-normalised to -14 LUFS.

## Layout

- `src/app/` — Expo Router screen (`?view=queue|new|settings`)
- `src/components/` — queue, new video, settings
- `src/styles/` — Hallmark Midnight tokens (`tokens.css`, `base.css`) and `app.css`
- `public/` — `index.html`, `manifest.json`, `sw.js`, icons
- `worker/src/index.js` — Cloudflare Worker API
- `worker/run-job.mjs` — the ffmpeg render that the Vlog Boy routine runs

## Develop

```bash
npm install
npm run web        # dev server
npm run build      # static export to dist/
```

`npm run deploy` builds and publishes `dist/` to the `gh-pages` branch, which GitHub Pages serves.

## Worker secrets

`APP_TOKEN` (the access token you type into Settings) and `WEBHOOK_SECRET` (the OpenBot routine's signing secret). `WEBHOOK_URL` is in `worker/wrangler.toml`.
