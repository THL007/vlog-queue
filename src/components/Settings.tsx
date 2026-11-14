import { useState } from "react";
import { api, getSettings, saveSettings } from "../lib/api";

export function Settings({ onSaved }: { onSaved: () => void }) {
  const initial = getSettings();
  const [url, setUrl] = useState(initial.api);
  const [token, setToken] = useState(initial.token);
  const [state, setState] = useState<{ kind: "idle" | "testing" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings(url.trim(), token.trim());
    setState({ kind: "testing" });
    try {
      const h = await api.health();
      setState({ kind: "ok", msg: h.webhook ? "Connected. Jobs go straight to Vlog Boy." : "Connected, but the webhook secret isn’t set on the API yet, so jobs will wait." });
      onSaved();
    } catch (err) {
      setState({ kind: "error", msg: (err as Error).message });
    }
  };

  return (
    <form className="settings" onSubmit={submit}>
      <h2>Connection</h2>
      <p className="quiet">The token stays on this device. The API holds the bucket and the webhook secret.</p>
      <div className="field">
        <label htmlFor="api">API URL</label>
        <input id="api" name="url" type="url" inputMode="url" autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="token">Access token</label>
        <input id="token" name="password" type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      <div className="send">
        <button type="submit" className="btn btn--primary" disabled={state.kind === "testing"}>
          {state.kind === "testing" ? "Checking…" : "Save and test"}
        </button>
        <p className={`hint${state.kind === "error" ? " hint--error" : ""}`} role="status">
          {state.msg || ""}
        </p>
      </div>
    </form>
  );
}
