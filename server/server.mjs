// Standalone production server (Railway or any Node/Bun host).
//
// Serves the built static client + the SSR/server-function handler. There is
// no password gate: portfolio data lives in each visitor's own browser
// (localStorage), never on this server, so there's nothing here worth
// gating — the server only ever proxies public market data (Yahoo Finance)
// and, if ANTHROPIC_API_KEY is set, the AI chat.
//
// Run under Bun (matches dev): `bun server/server.mjs`.
//   Optional env: PORT (default 8080), DIST_PATH (default "dist"),
//                 DB_PATH (honored by src/lib/db.server.ts — a shared
//                 price cache only, not user data)

import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const DIST = process.env.DIST_PATH ?? "dist";

// Content-Security-Policy. Every external API (Yahoo Finance, the Anthropic
// AI chat) is called SERVER-side, so the browser makes no cross-origin
// requests — connect-src 'self' suffices. style-src allows inline styles
// (component-injected styles). script-src is deliberately strict; if the SSR
// framework injects inline hydration scripts we discover it via Report-Only
// mode (below) before enforcing, so a wrong directive logs to the console
// instead of white-screening the app.
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required for TanStack Start's inline SSR hydration scripts
  // (bootstrap, $tsr stream-barrier, the module-import shim). Their bodies carry
  // per-request dehydrated state so hashes aren't stable. 'self' still blocks
  // EXTERNAL scripts — the common XSS delivery vector — and every other resource
  // type is locked to same-origin.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const CSP_ENFORCE = true;
const CSP_HEADER = CSP_ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

// Load the Nitro fetch handler (dynamic import resolves ./assets/* relative to server.js)
const { default: handler } = await import(
  pathToFileURL(join(DIST, "server", "server.js")).href
);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const httpServer = createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    const pathname = decodeURIComponent(url.split("?")[0].split("#")[0]);
    const secure = (req.headers["x-forwarded-proto"] ?? "").includes("https");

    // Security headers on every response (clickjacking, MIME sniffing,
    // referrer leakage, HTTPS downgrade).
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(CSP_HEADER, CSP);
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");

    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    // Serve static assets from dist/client/
    const staticPath = join(DIST, "client", pathname);
    try {
      const s = await stat(staticPath);
      if (s.isFile()) {
        const ext = extname(staticPath).toLowerCase();
        const content = await readFile(staticPath);
        res.writeHead(200, {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Cache-Control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
        res.end(content);
        return;
      }
    } catch {
      // not a static file — fall through to SSR handler
    }

    // Hand off to the SSR / server-function handler
    const bodyBuf = await readBody(req);
    const hasBody = bodyBuf && bodyBuf.length > 0 && req.method !== "GET" && req.method !== "HEAD";

    const request = new Request(`http://127.0.0.1:${PORT}${url}`, {
      method: req.method,
      headers: (() => {
        const h = new Headers();
        for (const [key, val] of Object.entries(req.headers)) {
          if (val != null) h.set(key, Array.isArray(val) ? val.join(", ") : String(val));
        }
        return h;
      })(),
      ...(hasBody ? { body: bodyBuf, duplex: "half" } : {}),
    });

    const response = await handler.fetch(request);

    const resHeaders = {};
    for (const [key, val] of response.headers.entries()) resHeaders[key] = val;
    res.writeHead(response.status, resHeaders);

    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal Server Error");
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${PORT}`);
});
