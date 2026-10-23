# Elliot MCP server (stdio). Used by MCP directories such as Glama to run safety and quality checks.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git bubblewrap && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENTRYPOINT ["node", "src/index.js"]
