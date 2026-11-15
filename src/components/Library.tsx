import { useCallback, useEffect, useState } from "react";
import { api, bytes, Clip, fileName, Folder, folderLabel, Listing, when } from "../lib/api";

type Props = { picked: Set<string>; onToggle: (key: string) => void; refresh: number };

/** B-roll library as collapsible folders. Each folder lists its contents only when opened. */
export function Library({ picked, onToggle, refresh }: Props) {
  const [root, setRoot] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRoot(await api.broll("broll/"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refresh]);

  if (error)
    return (
      <div className="state state--inline" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn--secondary btn--small" onClick={load}>Try again</button>
      </div>
    );
  if (!root) return <Skeleton label="Loading the library" />;
  if (!root.folders.length && !root.files.length) return <p className="quiet">Your bucket has no B-roll yet. Upload clips above.</p>;

  return (
    <div className="tree">
      {root.folders.map((f) => (
        <FolderNode key={f.prefix} folder={f} picked={picked} onToggle={onToggle} refresh={refresh} defaultOpen={f.name === "_inbox"} />
      ))}
      {root.files.length > 0 && <Files files={root.files} picked={picked} onToggle={onToggle} />}
    </div>
  );
}

function FolderNode({ folder, picked, onToggle, refresh, defaultOpen = false }: { folder: Folder; defaultOpen?: boolean } & Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.broll(folder.prefix));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [folder.prefix]);

  useEffect(() => {
    if (open) load(); // lazy: nothing is fetched until the folder is opened
  }, [open, load, refresh]);

  const pickedHere = data ? data.files.filter((f) => picked.has(f.key)).length : 0;

  return (
    <details className="folder" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="folder__head">
        <svg className="folder__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        <span className="folder__name">{folderLabel(folder.name)}</span>
        {folder.name === "_inbox" && <span className="row__meta">Vlog Boy sorts these</span>}
        {data && (
          <span className="row__meta num">
            {[
              data.folders.length ? `${data.folders.length} folder${data.folders.length === 1 ? "" : "s"}` : "",
              data.files.length || !data.folders.length ? `${data.files.length} clip${data.files.length === 1 ? "" : "s"}` : "",
              pickedHere ? `${pickedHere} picked` : "",
            ].filter(Boolean).join(", ")}
          </span>
        )}
      </summary>
      {open && (
        <div className="folder__body">
          {error ? (
            <div className="state state--inline" role="alert">
              <p>{error}</p>
              <button type="button" className="btn btn--secondary btn--small" onClick={load}>Try again</button>
            </div>
          ) : !data ? (
            <Skeleton label={`Loading ${folderLabel(folder.name)}`} />
          ) : !data.folders.length && !data.files.length ? (
            <p className="quiet">Empty.</p>
          ) : (
            <>
              {data.folders.map((f) => (
                <FolderNode key={f.prefix} folder={f} picked={picked} onToggle={onToggle} refresh={refresh} />
              ))}
              {data.files.length > 0 && <Files files={data.files} picked={picked} onToggle={onToggle} />}
            </>
          )}
        </div>
      )}
    </details>
  );
}

function Files({ files, picked, onToggle }: { files: Clip[]; picked: Set<string>; onToggle: (k: string) => void }) {
  return (
    <ul className="clips">
      {files.map((c) => (
        <li key={c.key} className="clip">
          <label className="clip__pick">
            <input type="checkbox" checked={picked.has(c.key)} onChange={() => onToggle(c.key)} />
            <span className="clip__thumb">
              {c.thumb ? <img src={c.thumb} alt="" loading="lazy" decoding="async" width={96} height={54} /> : <Glyph name={c.key} />}
            </span>
            <span className="clip__text">
              <span className="row__title">{fileName(c.key)}</span>
              <span className="row__meta num">{bytes(c.size)}, {when(c.uploaded)}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function Glyph({ name }: { name: string }) {
  const audio = /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {audio ? <path d="M9 18V6l10-2v12M9 18a2 2 0 11-4 0 2 2 0 014 0zm10-2a2 2 0 11-4 0 2 2 0 014 0z" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <path d="M4 6h12v12H4zM16 10l4-2v8l-4-2" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="row row--skeleton" />
      ))}
    </div>
  );
}
