// CDP bridge: connects to the Chromium running in the container, streams its
// screen via Page.startScreencast, and dispatches mouse/scroll/keyboard input
// coming from the web UI.
//
// We use playwright-core's connectOverCDP purely as a convenient CDP client:
//   - page.mouse / page.keyboard give us low-level, no-wait input dispatch
//   - a raw CDPSession gives us the screencast frames Playwright doesn't expose

import { chromium } from "playwright-core";

const DEFAULT_URL = process.env.START_URL || "https://www.google.com";

export class BrowserSession {
  constructor({ onFrame }) {
    this.onFrame = onFrame; // (jpegBuffer) => void
    this.frameWidth = 1280; // updated from screencast metadata
    this.frameHeight = 720;
    this._buttons = new Set();
  }

  /**
   * @param {string} endpoint CDP websocket endpoint reachable from this process
   */
  async connect(endpoint) {
    this.browser = await chromium.connectOverCDP(endpoint);
    const context = this.browser.contexts()[0] || (await this.browser.newContext());
    this.page = context.pages()[0] || (await context.newPage());

    this.cdp = await context.newCDPSession(this.page);

    // Navigate somewhere visible before we start streaming.
    await this.page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

    this.cdp.on("Page.screencastFrame", async (frame) => {
      this.frameWidth = frame.metadata.deviceWidth || this.frameWidth;
      this.frameHeight = frame.metadata.deviceHeight || this.frameHeight;
      try {
        this.onFrame(Buffer.from(frame.data, "base64"));
      } finally {
        // Ack so Chromium keeps sending frames (backpressure control).
        this.cdp
          .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
          .catch(() => {});
      }
    });

    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      everyNthFrame: 1,
    });
  }

  // Map normalized (0..1) UI coordinates to viewport CSS pixels.
  _toViewport(nx, ny) {
    return {
      x: Math.max(0, Math.min(1, nx)) * this.frameWidth,
      y: Math.max(0, Math.min(1, ny)) * this.frameHeight,
    };
  }

  /**
   * Handle an input message from the web UI.
   * Shapes (all coords normalized 0..1 unless noted):
   *   {t:"move", nx, ny}
   *   {t:"down", nx, ny, button}
   *   {t:"up",   nx, ny, button}
   *   {t:"wheel", nx, ny, dx, dy}    // dx/dy in pixels
   *   {t:"key",  key, text}    // text set for printable chars
   */
  async handleInput(msg) {
    if (!this.page) return;
    try {
      switch (msg.t) {
        case "move": {
          const { x, y } = this._toViewport(msg.nx, msg.ny);
          await this.page.mouse.move(x, y);
          break;
        }
        case "down": {
          const { x, y } = this._toViewport(msg.nx, msg.ny);
          const button = msg.button || "left";
          await this.page.mouse.move(x, y);
          await this.page.mouse.down({ button });
          this._buttons.add(button);
          break;
        }
        case "up": {
          const { x, y } = this._toViewport(msg.nx, msg.ny);
          const button = msg.button || "left";
          await this.page.mouse.move(x, y);
          await this.page.mouse.up({ button });
          this._buttons.delete(button);
          break;
        }
        case "wheel": {
          const { x, y } = this._toViewport(msg.nx, msg.ny);
          await this.page.mouse.move(x, y);
          await this.page.mouse.wheel(msg.dx || 0, msg.dy || 0);
          break;
        }
        case "key": {
          // Printable single characters → insertText (no keymap headaches).
          if (msg.text && msg.text.length === 1) {
            await this.page.keyboard.insertText(msg.text);
          } else if (msg.key) {
            await this.page.keyboard.press(toPlaywrightKey(msg.key));
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.warn("input dispatch error:", err.message);
    }
  }

  async close() {
    try {
      await this.cdp?.send("Page.stopScreencast").catch(() => {});
      await this.browser?.close();
    } catch {
      // ignore
    }
  }
}

// Translate a DOM KeyboardEvent.key into a Playwright key name where they differ.
function toPlaywrightKey(key) {
  const map = {
    " ": "Space",
    Spacebar: "Space",
    Esc: "Escape",
    Del: "Delete",
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
  };
  return map[key] || key;
}
