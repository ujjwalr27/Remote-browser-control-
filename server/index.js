// WebSocket server that wires the web UI to a per-connection headless Chromium
// session running in Docker.
//
// Protocol (JSON text messages from client):
//   {action:"start"}            -> spin up container + start streaming
//   {action:"stop"}             -> tear down
//   {action:"input", ...event}  -> forward mouse/scroll/keyboard to the browser
//
// Server -> client:
//   binary frame                -> a JPEG screencast frame
//   {type:"status", state, msg} -> lifecycle updates / errors

import http from "node:http";
import { WebSocketServer } from "ws";
import { startBrowserContainer, safeStop } from "./docker.js";
import { BrowserSession } from "./browser.js";

const PORT = Number(process.env.PORT || 4000);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("client connected");
  /** @type {{container?: any, session?: BrowserSession, starting?: boolean}} */
  const state = {};

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const teardown = async () => {
    const { session, container } = state;
    state.session = undefined;
    state.container = undefined;
    if (session) await session.close();
    if (container) await safeStop(container);
  };

  const start = async () => {
    if (state.session || state.starting) return;
    state.starting = true;
    send({ type: "status", state: "starting", msg: "Launching container…" });
    try {
      const { container, cdpUrl, wsEndpoint } = await startBrowserContainer();
      state.container = container;
      console.log(`container ready at ${cdpUrl} -> ${wsEndpoint}`);

      const session = new BrowserSession({
        onFrame: (jpeg) => {
          if (ws.readyState === ws.OPEN) ws.send(jpeg, { binary: true });
        },
      });
      await session.connect(wsEndpoint);
      state.session = session;
      send({ type: "status", state: "running", msg: "Browser is live." });
    } catch (err) {
      console.error("start failed:", err);
      send({ type: "status", state: "error", msg: err.message });
      await teardown();
    } finally {
      state.starting = false;
    }
  };

  ws.on("message", async (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.action === "start") {
      await start();
    } else if (msg.action === "stop") {
      await teardown();
      send({ type: "status", state: "stopped", msg: "Browser stopped." });
    } else if (msg.action === "input" && state.session) {
      await state.session.handleInput(msg);
    }
  });

  ws.on("close", async () => {
    console.log("client disconnected");
    await teardown();
  });

  ws.on("error", (err) => console.warn("ws error:", err.message));
});

server.listen(PORT, () => {
  console.log(`backend listening on http://127.0.0.1:${PORT} (ws + /health)`);
});

// Best-effort cleanup if the process is killed.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n${sig} received, shutting down`);
    process.exit(0);
  });
}
