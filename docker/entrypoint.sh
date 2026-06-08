#!/bin/sh
# Modern Chromium ignores --remote-debugging-address and binds CDP to
# 127.0.0.1 only. We launch it on the internal loopback port 9222, then run a
# socat TCP proxy on 0.0.0.0:9223 so the backend (host or sibling container)
# can reach the DevTools endpoint.
set -e

chromium-browser \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --hide-scrollbars \
  --remote-debugging-port=9222 \
  --window-size=1280,720 \
  --user-data-dir=/tmp/chrome-profile \
  --lang=en-US \
  --disable-blink-features=AutomationControlled \
  --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36" \
  about:blank &

# Wait until Chromium's CDP HTTP endpoint answers on loopback.
for _ in $(seq 1 50); do
  if wget -q -O /dev/null http://127.0.0.1:9222/json/version 2>/dev/null; then
    break
  fi
  sleep 0.2
done

# Forward external 9223 -> internal 9222. `fork` handles concurrent connections
# (one for /json/version, one for the screencast websocket).
exec socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222
