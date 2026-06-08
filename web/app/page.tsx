import BrowserView from "../components/BrowserView";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 1320,
        margin: "0 auto",
        padding: "32px 20px 48px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(145deg, #3b82f6, #1e40af)",
            boxShadow: "0 4px 14px rgba(59,130,246,0.35)",
            fontSize: 20,
          }}
        >
          🌐
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.3 }}>
            Remote Browser Control
          </h1>
          <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: 13.5 }}>
            A headless Chromium in Docker, streamed to your browser. Click,
            scroll, and type to drive it live.
          </p>
        </div>
      </header>
      <BrowserView />
    </main>
  );
}
