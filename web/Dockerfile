# Frontend image. Serves the Next.js UI in dev mode.
# The browser (on the host) connects to the backend WS at ws://localhost:4000,
# which is published by the server service — so NEXT_PUBLIC_WS_URL stays default.
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .

EXPOSE 3000
# -H 0.0.0.0 so the dev server is reachable through Docker's port mapping.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
