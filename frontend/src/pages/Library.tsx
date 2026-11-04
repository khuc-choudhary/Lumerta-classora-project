import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Board } from "../components/Board";
import { Empty, Page, Spinner } from "../components/ui";
import { useApp } from "../store";
import type { BoardPage } from "../types";

interface It { id: number; title: string; data: any; created_at: string }

export default function Library() {
  const { toast } = useApp();
  const [tab, setTab] = useState<"board" | "note">("board");
  const [items, setItems] = useState<It[] | null>(null); const [view, setView] = useState<It | null>(null);
  const load = useCallback(() => { setItems(null); api<It[]>(`/items/${tab}`).then(setItems).catch((e) => toast(e.message, "err")); }, [tab, toast]);
  useEffect(() => { load(); }, [load]);
  const del = async (id: number) => { if (!confirm("Delete this item?")) return; await api(`/items/${id}`, { method: "DELETE" }).catch((e) => toast(e.message, "err")); load(); };
  return (
    <Page title="Saved Library" sub="Your saved board explanations and notes.">
      <div className="flex gap-2 mb-5"><button className={`btn ${tab === "board" ? "btn-primary" : ""}`} onClick={() => setTab("board")}>🧾 Boards</button><button className={`btn ${tab === "note" ? "btn-primary" : ""}`} onClick={() => setTab("note")}>🗒️ Notes</button></div>
      {!items ? <Spinner /> : !items.length ? <Empty icon="🗂️" title={`No saved ${tab === "board" ? "boards" : "notes"} yet`} body={tab === "board" ? "Press 💾 Save on the classroom board to keep an explanation." : "Generate notes in Quiz & Notes and save them."} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <div key={it.id} className="glass p-4"><div className="font-bold truncate">{it.title}</div>
              <div className="text-xs text-muted">{new Date(it.created_at).toLocaleString()}{tab === "board" && ` · ${it.data.pages?.length ?? 0} page(s)`}</div>
              <div className="flex gap-2 mt-3"><button className="btn btn-sm btn-primary" onClick={() => setView(it)}>Open</button><button className="btn btn-sm btn-danger" onClick={() => del(it.id)}>Delete</button></div></div>))}
        </div>)}
      {view && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onClick={() => setView(null)} role="dialog" aria-modal="true">
          <div className="glass w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" style={{ background: "var(--bg2)" }} onClick={(e) => e.stopPropagation()}>
            <div className="p-3 flex justify-between items-center border-b" style={{ borderColor: "var(--panel-border)" }}><b className="truncate">{view.title}</b><button className="btn btn-sm" onClick={() => setView(null)}>✕ Close</button></div>
            {tab === "board" ? <div className="flex-1 min-h-0"><Board theme={view.data.theme ?? "green"} readOnly initial={view.data.pages as BoardPage[]} /></div> : (
              <div className="flex-1 overflow-auto p-5 space-y-3 text-sm">
                {view.data.summary && <p>{view.data.summary}</p>}
                {view.data.key_points?.length > 0 && <ul className="list-disc ml-5">{view.data.key_points.map((k: string, i: number) => <li key={i}>{k}</li>)}</ul>}
                {view.data.definitions?.length > 0 && <><b>Definitions</b><ul className="list-disc ml-5">{view.data.definitions.map((k: string, i: number) => <li key={i}>{k}</li>)}</ul></>}
                {view.data.flashcards?.length > 0 && <><b>Flashcards</b>{view.data.flashcards.map((c: any, i: number) => <p key={i}>Q: {c.q} — A: {c.a}</p>)}</>}
              </div>)}
          </div>
        </div>)}
    </Page>
  );
}
