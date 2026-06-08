# Backend image. Runs the WebSocket/orchestration server.
# It controls Docker via the host's mounted /var/run/docker.sock, and reaches
# spawned Chromium containers over the shared "bld-net" network.
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

EXPOSE 4000
CMD ["node", "index.js"]
