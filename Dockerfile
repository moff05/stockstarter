# Hosted (Railway) image. Runs under Bun to match dev exactly — the build
# externalizes bun:sqlite, so the runtime must be Bun, not Node.
FROM oven/bun:1.3.14

WORKDIR /app

# Install deps first (cached layer). Need devDependencies (vite, etc.) to build,
# so do NOT set NODE_ENV=production before this step.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the app → dist/server + dist/client
COPY . .
RUN bun run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "server/server.mjs"]
