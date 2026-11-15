import { useCallback, useEffect, useRef, useState } from "react";
import { api, duration, FORMATS, Job, JobStatus, typeLabel, when } from "../lib/api";

const fmtLabel = (id: string) => FORMATS.find((f) => f.id === id)?.label ?? id;
const name = (j: Job) => j.title || (j.status === "done" || j.status === "failed" ? "Untitled" : "Untitled, Vlog Boy names it");
const STATUS_LABEL: Record<JobStatus, string> = { queued: "Up next", running: "Rendering", cancelling: "Stopping", done: "Done", failed: "Needs a look" };
const isRendering = (j: Job) => j.status === "running" || j.status === "cancelling";

function confirmText(j: Job) {
  const t = `“${name(j)}”`;
  if (j.status === "running") return `Stop rendering ${t} and delete it? Vlog Boy stops within a few seconds.`;
  if (j.status === "cancelling") return `${t} is still stopping. Delete it now anyway?`;
  if (j.status === "queued") return `Delete ${t}? Vlog Boy won’t render it.`;
  return `Delete ${t}${j.output ? " and its video" : ""}? This can’t be undone. Your clips stay in the library.`;
}

function DeleteButton({ job: j, remove }: { job: Job; remove: (j: Job) => void }) {
  const label = j.status === "running" ? "Stop and delete" : j.status === "cancelling" ? "Delete now" : "Delete";
  return (
    <button type="button" className="btn btn--small btn--danger" onClick={() => remove(j)} aria-label={`${label}: ${name(j)}`}>
      {label}
    </button>
  );
}

type Layout = "overview" | "board" | "table" | "gallery";
const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "board", label: "Board" },
  { id: "table", label: "Table" },
  { id: "gallery", label: "Gallery" },
];

function readParam(k: string) {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k);
}
function writeParam(k: string, v: string | null) {
  const url = new URL(window.location.href);
  if (v) url.searchParams.set(k, v);
  else url.searchParams.delete(k);
  window.history.replaceState({}, "", url);
}

export function Queue({ onNew }: { onNew: () => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<Layout>(() => {
    const l = readParam("layout");
    return LAYOUTS.some((x) => x.id === l) ? (l as Layout) : "overview";
  });
  const [typeFilter, setTypeFilterState] = useState<string>(() => readParam("type") || "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    writeParam("layout", l === "overview" ? null : l);
  };
  const setTypeFilter = (t: string) => {
    setTypeFilterState(t);
    writeParam("type", t || null);
  };

  const load = useCallback(async () => {
    try {
      const list = await api.jobs();
      setJobs(list);
      setError(null);
      const need = list.flatMap((j) => [j.output, j.thumbnail]).filter((k): k is string => Boolean(k));
      if (need.length) setUrls(await api.sign(need));
      return list;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const list = await load();
      if (!alive) return;
      const busy = list?.some((j) => j.status === "running" || j.status === "cancelling" || j.status === "queued");
      timer.current = setTimeout(tick, busy ? 5000 : 30000);
    };
    tick();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const retry = async (id: string) => {
    await api.retry(id).catch((e) => setError(e.message));
    load();
  };

  const remove = async (j: Job) => {
    if (!window.confirm(confirmText(j))) return;
    setJobs((prev) => prev && (j.status === "running" ? prev.map((x) => (x.id === j.id ? { ...x, status: "cancelling", stage: "stopping" } : x)) : prev.filter((x) => x.id !== j.id)));
    if (playing === j.id) setPlaying(null);
    await api.deleteJob(j.id).catch((e) => setError(e.message));
    load();
  };

  if (error && !jobs)
    return (
      <section className="state" role="alert">
        <h2>Can’t load the queue</h2>
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => load()}>
          Try again
        </button>
      </section>
    );

  if (!jobs)
    return (
      <div aria-busy="true" aria-label="Loading the queue">
        <div className="sheet sheet--skeleton" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="row row--skeleton" />
        ))}
      </div>
    );

  if (!jobs.length)
    return (
      <section className="state">
        <h2>No videos yet</h2>
        <p>Upload B-roll, pick a type and a format, and Vlog Boy cuts it. Finished videos land here.</p>
        <button type="button" className="btn btn--primary" onClick={onNew}>
          Start a video
        </button>
      </section>
    );

  const shown = typeFilter ? jobs.filter((j) => (typeFilter === "auto" ? !j.type : j.type === typeFilter)) : jobs;
  const usedTypes = [...new Set(jobs.map((j) => j.type).filter((t): t is string => Boolean(t)))].map((id) => ({ id, label: typeLabel(id) }));
  const ctx = { urls, playing, setPlaying, retry, remove };

  return (
    <div className="queue">
      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={layout === l.id} className="segmented__item" onClick={() => setLayout(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <label className="filter">
          <span>Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} name="type">
            <option value="">All types</option>
            {usedTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
            {jobs.some((j) => !j.type) && <option value="auto">Picked by Vlog Boy</option>}
          </select>
        </label>
      </div>

      {error && (
        <p className="notice" role="status">
          Last refresh failed: {error}
        </p>
      )}

      {shown.length === 0 ? (
        <section className="state">
          <h2>Nothing of this type yet</h2>
          <button type="button" className="btn" onClick={() => setTypeFilter("")}>Show all types</button>
        </section>
      ) : layout === "board" ? (
        <Board jobs={shown} {...ctx} />
      ) : layout === "table" ? (
        <Table jobs={shown} {...ctx} />
      ) : layout === "gallery" ? (
        <Gallery jobs={shown} {...ctx} />
      ) : (
        <Overview jobs={shown} {...ctx} />
      )}
    </div>
  );
}

type Ctx = { jobs: Job[]; urls: Record<string, string>; playing: string | null; setPlaying: (id: string | null) => void; retry: (id: string) => void; remove: (j: Job) => void };

/* ---------- Overview: what's rendering, then up next, failures and the reel */
function Overview({ jobs, urls, playing, setPlaying, retry, remove }: Ctx) {
  const running = jobs.filter(isRendering);
  const queued = jobs.filter((j) => j.status === "queued");
  const done = jobs.filter((j) => j.status === "done");
  const failed = jobs.filter((j) => j.status === "failed");
  return (
    <>
      <section aria-labelledby="now">
        <h2 id="now">Now rendering</h2>
        {running.length ? (
          running.map((j) => <RenderSheet key={j.id} job={j} remove={remove} />)
        ) : (
          <p className="quiet">{queued.length ? "Waiting for Vlog Boy to pick up the next job." : "Nothing rendering right now."}</p>
        )}
      </section>

      {queued.length > 0 && (
        <section aria-labelledby="up">
          <h2 id="up">Up next</h2>
          <ul className="rows">
            {queued.map((j) => (
              <li key={j.id} className="row">
                <span className="row__title">{name(j)}</span>
                <span className="row__meta">{typeLabel(j.type, j.customType)}</span>
                <span className="row__meta">{fmtLabel(j.format)}</span>
                <span className="row__meta">{j.webhook && !j.webhook.sent ? "not delivered" : when(j.createdAt)}</span>
                <span className="row__actions"><DeleteButton job={j} remove={remove} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section aria-labelledby="failed">
          <h2 id="failed">Needs a look</h2>
          <ul className="rows">
            {failed.map((j) => (
              <li key={j.id} className="row">
                <span className="row__title">{name(j)}</span>
                <span className="row__meta row__meta--error">{j.error || "Render failed"}</span>
                <span className="row__actions">
                  <button type="button" className="btn btn--small" onClick={() => retry(j.id)}>Retry</button>
                  <DeleteButton job={j} remove={remove} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="done">
        <h2 id="done">Done <span className="count num">{done.length}</span></h2>
        {done.length ? (
          <ul className="reel">
            {done.map((j) => (
              <Take key={j.id} job={j} urls={urls} playing={playing} setPlaying={setPlaying} remove={remove} />
            ))}
          </ul>
        ) : (
          <p className="quiet">Finished videos show up here with a download button.</p>
        )}
      </section>
    </>
  );
}

function RenderSheet({ job: j, remove }: { job: Job; remove: (j: Job) => void }) {
  const pct = Math.round((j.progress || 0) * 100);
  return (
    <article className="sheet">
      <div className="sheet__head">
        <h3 className="sheet__title">{name(j)}</h3>
        <span className="fig num">{pct}<small>%</small></span>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${name(j)} progress`}>
        <span style={{ transform: `scaleX(${Math.max(0.02, j.progress || 0)})` }} />
      </div>
      <dl className="meta">
        <div><dt>Stage</dt><dd>{j.status === "cancelling" ? "stopping…" : j.stage || "starting"}</dd></div>
        <div><dt>Type</dt><dd>{typeLabel(j.type, j.customType)}</dd></div>
        <div><dt>Format</dt><dd>{fmtLabel(j.format)}</dd></div>
        <div><dt>Clips</dt><dd className="num">{j.clips.length}</dd></div>
      </dl>
      <div className="sheet__actions"><DeleteButton job={j} remove={remove} /></div>
    </article>
  );
}

/* ---------- Board: one column per status */
function Board({ jobs, urls, retry, remove }: Ctx) {
  const cols: JobStatus[] = ["queued", "running", "done", "failed"];
  return (
    <div className="board">
      {cols.map((s) => {
        const list = jobs.filter((j) => (s === "running" ? isRendering(j) : j.status === s));
        return (
          <section key={s} className="board__col" aria-labelledby={`col-${s}`}>
            <h2 id={`col-${s}`} className="board__head">
              {STATUS_LABEL[s]} <span className="count num">{list.length}</span>
            </h2>
            {list.length === 0 ? (
              <p className="quiet board__empty">None</p>
            ) : (
              <ul className="board__list">
                {list.map((j) => (
                  <li key={j.id} className="card">
                    {j.thumbnail && urls[j.thumbnail] && (
                      <img className="card__thumb" src={urls[j.thumbnail]} alt="" loading="lazy" width={320} height={180} />
                    )}
                    <h3 className="card__title">{name(j)}</h3>
                    <p className="row__meta">{typeLabel(j.type, j.customType)}, {fmtLabel(j.format)}</p>
                    {s === "running" && (
                      <>
                        <div className="meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.02, j.progress || 0)})` }} /></div>
                        <p className="row__meta num">{j.status === "cancelling" ? "stopping…" : `${j.stage || "starting"}, ${Math.round((j.progress || 0) * 100)}%`}</p>
                      </>
                    )}
                    {s === "done" && j.output && urls[j.output] && (
                      <a className="link" href={`${urls[j.output]}&download=1`} download>Download{j.durationSeconds ? `, ${duration(j.durationSeconds)}` : ""}</a>
                    )}
                    {s === "failed" && (
                      <>
                        <p className="row__meta row__meta--error">{j.error || "Render failed"}</p>
                        <button type="button" className="btn btn--small" onClick={() => retry(j.id)}>Retry</button>
                      </>
                    )}
                    <div className="card__actions"><DeleteButton job={j} remove={remove} /></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- Table: every job, newest first */
function Table({ jobs, urls, retry, remove }: Ctx) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Type</th>
            <th scope="col">Format</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Length</th>
            <th scope="col">Created</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <th scope="row" data-label="Title">{name(j)}</th>
              <td data-label="Type">{typeLabel(j.type, j.customType)}</td>
              <td data-label="Format">{fmtLabel(j.format)}</td>
              <td data-label="Status" className={j.status === "failed" ? "row__meta--error" : undefined}>
                {STATUS_LABEL[j.status]}{j.status === "running" ? `, ${Math.round((j.progress || 0) * 100)}%` : ""}
              </td>
              <td data-label="Length" className="num">{j.durationSeconds ? duration(j.durationSeconds) : j.maxSeconds ? `≤ ${duration(j.maxSeconds)}` : ""}</td>
              <td data-label="Created">{when(j.createdAt)}</td>
              <td className="table__actions">
                {j.status === "done" && j.output && urls[j.output] && (
                  <a className="link" href={`${urls[j.output]}&download=1`} download>Download</a>
                )}
                {j.status === "failed" && (
                  <button type="button" className="btn btn--small" onClick={() => retry(j.id)}>Retry</button>
                )}
                <DeleteButton job={j} remove={remove} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Gallery: finished videos only, big */
function Gallery({ jobs, urls, playing, setPlaying, remove }: Ctx) {
  const done = jobs.filter((j) => j.status === "done");
  if (!done.length) return <p className="quiet">No finished videos yet. They hang here when Vlog Boy is done.</p>;
  return (
    <ul className="reel reel--gallery">
      {done.map((j) => (
        <Take key={j.id} job={j} urls={urls} playing={playing} setPlaying={setPlaying} remove={remove} />
      ))}
    </ul>
  );
}

function Take({ job: j, urls, playing, setPlaying, remove }: { job: Job; urls: Record<string, string>; playing: string | null; setPlaying: (id: string | null) => void; remove: (j: Job) => void }) {
  const src = j.output ? urls[j.output] : undefined;
  const poster = j.thumbnail ? urls[j.thumbnail] : undefined;
  return (
    <li className="take">
      <div className={`take__frame take__frame--${j.format}`}>
        {playing === j.id && src ? (
          <video src={src} poster={poster} controls playsInline ref={(el) => { el?.play().catch(() => {}); }} />
        ) : (
          <button type="button" className="take__poster" onClick={() => setPlaying(j.id)} aria-label={`Play ${name(j)}`}>
            {poster ? <img src={poster} alt="" width={540} height={960} loading="lazy" /> : null}
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </button>
        )}
      </div>
      <div className="take__body">
        <h3>{name(j)}</h3>
        <p className="row__meta">
          {typeLabel(j.type, j.customType)}, {fmtLabel(j.format)}{j.durationSeconds ? `, ${duration(j.durationSeconds)}` : ""}, finished {when(j.updatedAt)}
        </p>
        <div className="take__actions">
          {src && (
            <a className="btn btn--small" href={`${src}&download=1`} download>
              Download
            </a>
          )}
          {src && typeof navigator !== "undefined" && "share" in navigator && (
            <button type="button" className="btn btn--small" onClick={() => shareVideo(src, name(j))}>
              Share to app
            </button>
          )}
          <DeleteButton job={j} remove={remove} />
        </div>
      </div>
    </li>
  );
}

async function shareVideo(url: string, title: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], `${title.replace(/[^\w\- ]/g, "").trim() || "video"}.mp4`, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
    else await navigator.share({ url, title });
  } catch {
    /* user closed the share sheet */
  }
}
