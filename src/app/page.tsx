"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "notion-gcal-sync-secret";

export default function Home() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [results, setResults] = useState<any>(null);
  const [secret, setSecret] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setSecret(stored);
      setSaved(true);
    }
  }, []);

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, secret);
    setSaved(true);
  }

  function handleClear() {
    localStorage.removeItem(STORAGE_KEY);
    setSecret("");
    setSaved(false);
  }

  async function handleSync() {
    setStatus("syncing");
    setResults(null);
    if (!saved) handleSave();
    try {
      const res = await fetch(`/api/sync?secret=${encodeURIComponent(secret)}`);
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setResults(data);
        return;
      }
      setStatus("done");
      setResults(data);
    } catch (err) {
      setStatus("error");
      setResults({ error: String(err) });
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600, margin: "40px auto", padding: "0 20px" }}>
      <h1>Notion → GCal Sync</h1>
      <div style={{ marginBottom: 16 }}>
        {!saved ? (
          <input
            type="password"
            placeholder="Sync secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ padding: "8px 12px", marginRight: 8, border: "1px solid #ccc", borderRadius: 4, width: 200 }}
          />
        ) : (
          <span style={{ marginRight: 8, color: "#666" }}>Secret saved</span>
        )}
        <button
          onClick={handleSync}
          disabled={status === "syncing" || !secret}
          style={{ padding: "8px 16px", borderRadius: 4, border: "none", background: "#0070f3", color: "#fff", cursor: "pointer" }}
        >
          {status === "syncing" ? "Syncing..." : "Sync Now"}
        </button>
        {saved && (
          <button
            onClick={handleClear}
            style={{ padding: "8px 16px", marginLeft: 8, borderRadius: 4, border: "1px solid #ccc", background: "transparent", cursor: "pointer" }}
          >
            Clear Secret
          </button>
        )}
      </div>
      {results && (
        <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 4, overflow: "auto", fontSize: 13 }}>
          {JSON.stringify(results, null, 2)}
        </pre>
      )}
    </main>
  );
}
