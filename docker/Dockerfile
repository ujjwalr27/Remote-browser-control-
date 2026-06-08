# Headless Chromium exposing the Chrome DevTools Protocol.
#
# Modern Chromium binds the remote-debugging port to 127.0.0.1 regardless of
# --remote-debugging-address, so we add a socat proxy (see entrypoint.sh) that
# republishes it on 0.0.0.0:9223 for the backend to connect to.
FROM zenika/alpine-chrome:123

USER root
RUN apk add --no-cache socat

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# socat listens here; Chromium stays on internal 9222.
EXPOSE 9223

USER chrome
ENTRYPOINT ["/entrypoint.sh"]
