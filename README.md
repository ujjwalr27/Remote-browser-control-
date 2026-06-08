# Remote Browser Control (mini "TeamViewer for a browser")

Open a web UI, hit **Start Browser**, and a Docker container spins up running
**headless Chromium**. Its screen streams back to the UI in real time over a
WebSocket, and you can **click, scroll, and type** into it from the page.

Everything runs locally. No deployment.

## How it works

```
┌─────────────────┐   WS (JPEG frames ⟶ / input events ⟵)   ┌──────────────────┐
│  Next.js Web UI │ <─────────────────────────────────────> │  Node backend    │
│  (browser tab)  │                                          │  (runs in WSL)   │
│  - Start/Stop   │                                          │  - WS server     │
│  - <canvas>     │                                          │  - Docker mgmt   │
│  - input capture│                                          │  - CDP client    │
└─────────────────┘                                          └────────┬─────────┘
                                                                       │ CDP (ws :9222)
                                                              ┌────────▼─────────┐
                                                              │ Docker container │
                                                              │ headless Chromium│
                                                              └──────────────────┘
```

1. The UI opens a WebSocket and sends `{action:"start"}`.
2. The backend launches the Chromium container ([dockerode](https://github.com/apocas/dockerode)),
   mapping a free host port to the container's CDP port `9222`.
3. It polls `/json/version` until Chromium is ready, then connects with
   `playwright-core`'s `connectOverCDP`.
4. `Page.startScreencast` emits JPEG frames; the backend forwards each frame to
   the UI and acks it (`Page.screencastFrameAck`) for backpressure control.
5. UI mouse/scroll/keyboard events are sent back as normalized coordinates and
   dispatched via `page.mouse` / `page.keyboard`.
6. On **Stop** or disconnect, the screencast stops and the container is removed.

## Project layout

| Path | What |
| --- | --- |
| `docker-compose.yml` | One-command stack (backend + frontend containers) |
| `docker/Dockerfile` | Headless Chromium image exposing CDP on 9222 |
| `server/docker.js` | Container lifecycle (start, wait-for-CDP, stop) |
| `server/browser.js` | CDP screencast + input dispatch with coordinate scaling |
| `server/index.js` | HTTP + WebSocket server, per-connection session |
| `web/` | Next.js UI (`components/BrowserView.tsx` does rendering + input) |

## Prerequisites

Because Docker here lives in **WSL**, run the **backend and Docker from a WSL
shell**. The Next.js dev server can run in WSL too; open the UI from the Windows
browser at `http://localhost:3000` (WSL2 forwards localhost automatically).

- Docker (in WSL): `docker --version`
- Node.js 20+ and npm

## Run it

Pick one of the two modes. Either way, **build the Chromium image first** — the
backend runs it at runtime:

```bash
docker build -t bld-chromium docker/
```

### Option A — one command (everything in Docker) ✅ recommended

The backend and frontend run as containers too; `docker compose` brings up all
of it. The backend mounts the host Docker socket to spawn the Chromium
container.

```bash
docker compose up --build
```

Then open **http://localhost:3000**. That's it — no separate `npm` steps.

### Option B — run backend/frontend directly (no compose)

Useful for development with hot reload. Run from a **WSL shell** so the backend
shares `localhost` with the Docker daemon.

```bash
# Backend on :4000
cd server && npm install && npm start

# Frontend on :3000 — second shell
cd web && npm install && npm run dev
```

---

Open **http://localhost:3000**, click **Start Browser**, and drive the headless
Chromium: click links, type in the Google search box, scroll. Click **Stop**
(or close the tab) to tear the container down — confirm with `docker ps`.

> Smoke-test the image on its own (optional):
> `docker run --rm -p 9223:9223 bld-chromium` then
> `curl http://localhost:9223/json/version`.
> (CDP is exposed on 9223 via a socat proxy — see `docker/entrypoint.sh` for why.)

### Configuration (optional env vars)

| Var | Where | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `4000` | Backend WS/HTTP port |
| `CHROMIUM_IMAGE` | server | `bld-chromium` | Docker image tag to run |
| `START_URL` | server | `https://www.google.com` | Initial page |
| `NEXT_PUBLIC_WS_URL` | web | `ws://localhost:4000` | Backend WS URL |

## Submission write-up

**What I built.** A working end-to-end remote browser: Next.js UI ↔ Node
WebSocket backend ↔ Dockerized headless Chromium driven over the Chrome
DevTools Protocol. Start/stop lifecycle, live JPEG screencast rendered to a
canvas, and full mouse/scroll/keyboard control with normalized-coordinate
scaling so clicks land correctly regardless of the displayed size.

**Key engineering decisions.**
- **CDP screencast over WebRTC/VNC** — keeps Chromium genuinely headless
  (matches the spec), is pure code, and needs no extra processes in the image.
- **Ack-based backpressure** — every frame is acked so Chromium paces itself to
  the consumer instead of flooding the socket.
- **`page.keyboard.insertText` for printable keys** — sidesteps the CDP virtual
  keycode mapping headache; special keys go through `page.keyboard.press`.
- **Per-connection container with `AutoRemove`** — clean teardown, no orphans.

**Where it could get stuck / things to watch.**
- WSL networking: backend and container must share the same `localhost` (run
  both in WSL).
- Chromium needs `--no-sandbox` inside the container.
- JPEG screencast latency is fine for control but not pixel-perfect/60fps.

**Next steps if I had more time.**
- WebRTC transport for lower latency and smoother video.
- Multi-session support with isolation + auth.
- Clipboard sync, file upload, touch/mobile emulation, and a URL bar in the UI.
```
