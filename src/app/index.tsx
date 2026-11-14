import { useEffect, useState } from "react";
import { NewVideo } from "../components/NewVideo";
import { Queue } from "../components/Queue";
import { Settings } from "../components/Settings";
import { getSettings } from "../lib/api";

type View = "queue" | "new" | "settings";
const TABS: { id: View; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "new", label: "New video" },
  { id: "settings", label: "Settings" },
];

function readView(): View {
  if (typeof window === "undefined") return "queue";
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "new" || v === "settings" ? v : "queue";
}

export default function Home() {
  const [view, setViewState] = useState<View>("queue");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = getSettings().token ? readView() : "settings";
    setViewState(initial);
    setReady(true);
    const onPop = () => setViewState(readView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setView = (v: View) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", v);
    window.history.pushState({}, "", url);
    setViewState(v);
  };

  return (
    <div className="shell">
      <header className="bar">
        <div className="bar__inner">
          <a className="wordmark" href="./" aria-label="Vlog Queue, home" onClick={(e) => { e.preventDefault(); setView("queue"); }}>
            Vlog Queue
          </a>
          <nav aria-label="Sections">
            <ul className="tabs" role="list">
              {TABS.map((t) => (
                <li key={t.id}>
                  <a href={`?view=${t.id}`} className="tab" aria-current={view === t.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView(t.id); }}>
                    {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main className="main">
        {!ready ? null : view === "queue" ? (
          <>
            <h1 className="page-title">Your videos</h1>
            <Queue onNew={() => setView("new")} />
          </>
        ) : view === "new" ? (
          <>
            <h1 className="page-title">New video</h1>
            <NewVideo onQueued={() => setView("queue")} />
          </>
        ) : (
          <>
            <h1 className="page-title">Settings</h1>
            <Settings onSaved={() => {}} />
          </>
        )}
      </main>
    </div>
  );
}
