import { useEffect, useRef, useState } from "react";
import { api, bytes, CUSTOM_TYPE, FORMATS, FormatId, makeThumb, typeLabel, uploadFile, VideoType } from "../lib/api";
import { TypePicker } from "./TypePicker";
import { Library } from "./Library";

type Upload = { id: string; name: string; size: number; progress: number; error?: string; key?: string };

export function NewVideo({ onQueued }: { onQueued: () => void }) {
  const [refresh, setRefresh] = useState(0);
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<FormatId>("short-9x16");
  const [type, setType] = useState<VideoType>("");
  const [customType, setCustomType] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [maxSeconds, setMaxSeconds] = useState("");
  const [captions, setCaptions] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const batch = useRef<{ pending: number; keys: string[] }>({ pending: 0, keys: [] });

  // When an upload batch finishes, ask Vlog Boy to sort the new clips into folders.
  const finishOne = (key?: string) => {
    if (key) batch.current.keys.push(key);
    batch.current.pending -= 1;
    setRefresh((n) => n + 1);
    if (batch.current.pending === 0 && batch.current.keys.length) {
      const keys = batch.current.keys;
      batch.current.keys = [];
      api.organize(keys)
        .then((r) => setOrganizeNote(r.webhook.sent ? `Vlog Boy is sorting ${keys.length} new clip${keys.length === 1 ? "" : "s"} into folders.` : "Uploaded to the inbox. Sorting starts once the webhook secret is set."))
        .catch(() => setOrganizeNote("Uploaded to the inbox. Sorting request failed; it will be sorted with the next upload."));
    }
  };

  useEffect(() => () => { batch.current.pending = 0; }, []);

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/") && !file.type.startsWith("audio/") && !file.type.startsWith("image/")) continue;
      const id = crypto.randomUUID();
      batch.current.pending += 1;
      setOrganizeNote(null);
      setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0 }]);
      const thumb = makeThumb(file);
      uploadFile(file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))))
        .then(async (key) => {
          const jpg = await thumb;
          if (jpg) await api.putThumb(key, jpg).catch(() => {});
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: 1, key } : x)));
          finishOne(key);
        })
        .catch((e) => {
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
          finishOne();
        });
    }
  };

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const uploading = uploads.some((u) => !u.key && !u.error);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError(null);
    if (type === CUSTOM_TYPE && !customType.trim()) {
      setSendError("Describe your custom type, or pick another one.");
      document.getElementById("custom-type")?.focus();
      return;
    }
    if (!picked.size) {
      setSendError("Pick at least one clip from the library.");
      return;
    }
    setSending(true);
    try {
      await api.createJob({ title: title.trim() || null, notes, format, type: type || null, customType: type === CUSTOM_TYPE ? customType.trim() || null : null, clips: [...picked], maxSeconds: maxSeconds ? Number(maxSeconds) : null, captions });
      setPicked(new Set());
      setTitle("");
      setNotes("");
      setUploads([]);
      onQueued();
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="compose" onSubmit={submit} noValidate>
      <section aria-labelledby="up-h" className="compose__col">
        <h2 id="up-h">B-roll</h2>
        <div
          className={`drop${drag ? " drop--over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        >
          <p>Drop clips here, or</p>
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            Choose files
          </button>
          <input ref={input} type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <p className="hint">Video, music or stills. Large files upload in 10 MB parts.</p>
        </div>

        {uploads.length > 0 && (
          <ul className="rows" aria-label="Uploads">
            {uploads.map((u) => (
              <li key={u.id} className="row row--upload">
                <span className="row__title">{u.name}</span>
                <span className="row__meta num">{bytes(u.size)}</span>
                <span className={`row__meta${u.error ? " row__meta--error" : ""}`}>{u.error ? u.error : u.key ? "uploaded" : `${Math.round(u.progress * 100)}%`}</span>
                {!u.key && !u.error && (
                  <span className="meter meter--row" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.02, u.progress)})` }} /></span>
                )}
              </li>
            ))}
          </ul>
        )}

        {organizeNote && <p className="hint" role="status">{organizeNote}</p>}

        <h3 className="sub">Library <span className="count num">{picked.size} picked</span></h3>
        <Library picked={picked} onToggle={toggle} refresh={refresh} />
      </section>

      <section aria-labelledby="fmt-h" className="compose__col compose__col--side">
        <h2 id="type-h">Type of video</h2>
        <TypePicker value={type} custom={customType} onChange={setType} onCustom={setCustomType} />

        <h2 id="fmt-h" className="h2--spaced">Format</h2>
        <fieldset className="formats">
          <legend className="visually-hidden">Output format</legend>
          {FORMATS.map((f) => (
            <label key={f.id} className={`format${format === f.id ? " format--on" : ""}`}>
              <input type="radio" name="format" value={f.id} checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span className={`format__shape format__shape--${f.id}`} aria-hidden="true" />
              <span className="format__label">{f.label}</span>
              <span className="format__meta">{f.size}, {f.where}</span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="title">Title, optional</label>
          <input id="title" name="title" type="text" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vlog Boy names it" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="max">Length in seconds, optional</label>
            <input id="max" name="max" type="number" inputMode="numeric" min={5} max={1800} value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} placeholder="Vlog Boy decides" />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
            <span>Burn in captions</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="notes">Notes for Vlog Boy</label>
          <textarea id="notes" name="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Open on the coffee pour, keep it calm, end on the sunset." />
        </div>

        <div className="send">
          <button type="submit" className="btn btn--primary" disabled={sending || uploading}>
            {sending ? "Sending…" : uploading ? "Waiting for uploads…" : "Send to Vlog Boy"}
          </button>
          <p className={`hint${sendError ? " hint--error" : ""}`} role={sendError ? "alert" : undefined}>
            {sendError || `${picked.size} clip${picked.size === 1 ? "" : "s"}, ${typeLabel(type || null, customType.trim())}, ${FORMATS.find((f) => f.id === format)!.label}`}
          </p>
        </div>
      </section>
    </form>
  );
}
