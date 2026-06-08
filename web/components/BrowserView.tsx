"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000";

type Status = "idle" | "connecting" | "starting" | "running" | "stopped" | "error";

export default function BrowserView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastMoveSent = useRef(0);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  const running = status === "running";

  // ---- WebSocket lifecycle -------------------------------------------------
  const connect = useCallback(() => {
    if (wsRef.current) return;
    setStatus("connecting");
    setMessage("Connecting to backend…");

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("starting");
      setMessage("Requesting browser…");
      ws.send(JSON.stringify({ action: "start" }));
    };

    ws.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "status") {
            setStatus(msg.state as Status);
            setMessage(msg.msg || "");
          }
        } catch {
          /* ignore */
        }
        return;
      }
      // Binary JPEG frame → draw to canvas.
      const blob = new Blob([ev.data as ArrayBuffer], { type: "image/jpeg" });
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
      } catch {
        /* dropped frame */
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setStatus((s) => (s === "error" ? s : "stopped"));
    };

    ws.onerror = () => {
      setStatus("error");
      setMessage("WebSocket error — is the backend running on " + WS_URL + "?");
    };
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ action: "stop" }));
    ws?.close();
    wsRef.current = null;
    setStatus("stopped");
    setMessage("Stopped.");
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  // ---- Input forwarding ----------------------------------------------------
  const sendInput = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ action: "input", ...payload }));
    }
  }, []);

  const norm = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      nx: (e.clientX - rect.left) / rect.width,
      ny: (e.clientY - rect.top) / rect.height,
    };
  };

  const buttonName = (b: number) =>
    b === 2 ? "right" : b === 1 ? "middle" : "left";

  const onMouseMove = (e: React.MouseEvent) => {
    if (!running) return;
    const now = performance.now();
    if (now - lastMoveSent.current < 33) return; // ~30 fps cap
    lastMoveSent.current = now;
    sendInput({ t: "move", ...norm(e) });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!running) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
    sendInput({ t: "down", ...norm(e), button: buttonName(e.button) });
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!running) return;
    e.preventDefault();
    sendInput({ t: "up", ...norm(e), button: buttonName(e.button) });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!running) return;
    sendInput({ t: "wheel", ...norm(e), dx: e.deltaX, dy: e.deltaY });
  };

  // Capture keystrokes at the window level while a session is running, so typing
  // works without the view div needing to hold DOM focus.
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Let the local browser keep refresh/devtools shortcuts.
      if ((e.ctrlKey || e.metaKey) && ["r", "R", "i", "I"].includes(e.key)) return;
      e.preventDefault();
      const printable =
        e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      // NB: no `action` field here — it would shadow the {action:"input"} envelope.
      sendInput({ t: "key", key: e.key, text: printable ? e.key : "" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, sendInput]);

  // ---- Render --------------------------------------------------------------
  const busy = status === "starting" || status === "connecting";
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 16px",
          background: "var(--panel-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* faux traffic lights */}
        <div style={{ display: "flex", gap: 7 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span
              key={c}
              style={{ width: 11, height: 11, borderRadius: "50%", background: c }}
            />
          ))}
        </div>

        {!running ? (
          <button onClick={connect} disabled={busy} className="btn-primary" style={btnStyle}>
            {busy ? "Starting…" : "▶  Start Browser"}
          </button>
        ) : (
          <button onClick={stop} className="btn-danger" style={btnStyle}>
            ■  Stop
          </button>
        )}

        <StatusPill status={status} />
        <span
          style={{
            color: "var(--muted)",
            fontSize: 13,
            marginLeft: "auto",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {message}
        </span>
      </div>

      <div
        tabIndex={0}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
        style={{
          width: "calc(100% - 24px)",
          margin: 12,
          aspectRatio: "1280 / 720",
          background:
            "repeating-conic-gradient(#262c3a 0% 25%, #20242f 0% 50%) 50% / 22px 22px",
          cursor: running ? "crosshair" : "default",
          position: "relative",
          outline: "none",
          borderRadius: 10,
          overflow: "hidden",
          border: running ? "2px solid var(--accent)" : "2px solid var(--border)",
          boxShadow: running
            ? "0 0 0 1px var(--accent), 0 0 22px rgba(59,130,246,0.25)"
            : "inset 0 0 30px rgba(0,0,0,0.4)",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            opacity: running ? 1 : 0,
            transition: "opacity 0.25s ease",
          }}
        />
        {!running && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              padding: 20,
            }}
          >
            <div>
              <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.5 }}>
                {status === "error" ? "⚠️" : busy ? "⏳" : "🖥️"}
              </div>
              <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 600 }}>
                {status === "error"
                  ? "Couldn't reach the backend"
                  : busy
                  ? "Spinning up the container…"
                  : "No session running"}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                {status === "error"
                  ? message || "Check that the backend is up."
                  : busy
                  ? "Launching headless Chromium in Docker"
                  : 'Hit "Start Browser" to begin a live session'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const colors: Record<Status, string> = {
    idle: "#5b6477",
    connecting: "#eab308",
    starting: "#eab308",
    running: "#22c55e",
    stopped: "#5b6477",
    error: "#ef4444",
  };
  const active = status === "running" || status === "starting" || status === "connecting";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12.5,
        fontWeight: 600,
        color: "#cbd2e0",
        textTransform: "capitalize",
        padding: "5px 11px 5px 9px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--border)",
      }}
    >
      <span
        className={active ? "pulse" : undefined}
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: colors[status],
          boxShadow: `0 0 8px ${colors[status]}`,
        }}
      />
      {status}
    </span>
  );
}

const btnStyle: React.CSSProperties = {
  borderRadius: 9,
  padding: "9px 16px",
  fontSize: 14,
  fontWeight: 600,
};
