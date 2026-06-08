// Container lifecycle for the headless Chromium image.
//
// Uses dockerode to talk to the Docker daemon (the Unix socket inside WSL).
// Each browser session gets its own container with a dynamically-assigned host
// port mapped to the container's CDP port 9222. We then poll the CDP HTTP
// endpoint until Chromium is ready and return its webSocketDebuggerUrl.

import Docker from "dockerode";

const docker = new Docker(); // defaults to /var/run/docker.sock
const IMAGE = process.env.CHROMIUM_IMAGE || "bld-chromium";
// The image's socat proxy publishes CDP here (Chromium itself stays on
// internal 127.0.0.1:9222, which we can't reach from outside the container).
const CDP_PORT = "9223/tcp";

// When the backend itself runs inside a container (docker compose), set
// DOCKER_NETWORK to a shared user-defined network. We then attach the spawned
// Chromium container to that network and reach it by its container IP on 9222,
// instead of publishing a port to the host.
const NETWORK = process.env.DOCKER_NETWORK || "";

/**
 * Start a Chromium container and wait until CDP is reachable.
 * @returns {Promise<{container: import('dockerode').Container, cdpUrl: string, wsEndpoint: string}>}
 */
export async function startBrowserContainer() {
  const createOpts = {
    Image: IMAGE,
    HostConfig: {
      AutoRemove: true,
      // Chromium can be memory hungry; bump shared memory so we don't rely on
      // --disable-dev-shm-usage alone for stability.
      ShmSize: 512 * 1024 * 1024,
    },
  };

  if (NETWORK) {
    // Container-to-container: join the shared network, no published port.
    createOpts.HostConfig.NetworkMode = NETWORK;
  } else {
    // Host/WSL backend: publish CDP on a Docker-assigned free host port.
    createOpts.ExposedPorts = { [CDP_PORT]: {} };
    createOpts.HostConfig.PortBindings = { [CDP_PORT]: [{ HostPort: "" }] };
  }

  const container = await docker.createContainer(createOpts);
  await container.start();

  const info = await container.inspect();

  let cdpUrl;
  if (NETWORK) {
    const net = info.NetworkSettings.Networks[NETWORK];
    if (!net?.IPAddress) {
      await safeStop(container);
      throw new Error(`Container has no IP on network "${NETWORK}"`);
    }
    // Connect by IP (not name): Chromium rejects non-IP Host headers.
    cdpUrl = `http://${net.IPAddress}:9223`;
  } else {
    const binding = info.NetworkSettings.Ports[CDP_PORT];
    if (!binding || !binding[0]) {
      await safeStop(container);
      throw new Error("Could not determine mapped CDP host port");
    }
    cdpUrl = `http://127.0.0.1:${binding[0].HostPort}`;
  }

  // Chromium reports its ws endpoint as ws://127.0.0.1:9222/... (its own
  // loopback). Rewrite the host to our reachable proxy address so Playwright
  // connects through socat instead of to an unreachable 127.0.0.1.
  const rawWs = await waitForCdp(cdpUrl);
  const ws = new URL(rawWs);
  ws.host = new URL(cdpUrl).host;
  const wsEndpoint = ws.toString();

  return { container, cdpUrl, wsEndpoint };
}

/**
 * Poll the CDP HTTP endpoint until Chromium reports a debugger URL.
 */
async function waitForCdp(cdpUrl, { timeoutMs = 20000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cdpUrl}/json/version`);
      if (res.ok) {
        const data = await res.json();
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`CDP not ready within ${timeoutMs}ms: ${lastErr?.message ?? "unknown"}`);
}

/**
 * Stop (and, via AutoRemove, remove) a container. Never throws.
 */
export async function safeStop(container) {
  if (!container) return;
  try {
    await container.stop({ t: 2 });
  } catch (err) {
    // Already stopped / removed — ignore.
    if (err?.statusCode !== 304 && err?.statusCode !== 404) {
      console.warn("container stop warning:", err.message);
    }
  }
}
