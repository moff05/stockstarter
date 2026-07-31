// Standalone production server (Railway or any Node/Bun host).
//
// Loads the built Nitro fetch handler and serves dist/client/ static assets,
// with a single shared-password gate in front of EVERYTHING (static, SSR,
// server functions) so a self-hosted instance isn't left open by default.
//
// Run under Bun (matches dev): `bun server/server.mjs`.
//   Required env: APP_PASSWORD   — the shared gate password
//   Optional env: PORT (default 8080), DIST_PATH (default "dist"),
//                 DB_PATH (honored by src/lib/db.server.ts)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const DIST = process.env.DIST_PATH ?? "dist";
const APP_PASSWORD = process.env.APP_PASSWORD ?? "";

// Never start ungated over someone's financial data.
if (!APP_PASSWORD) {
  console.error(
    "[server] FATAL: APP_PASSWORD is not set. Refusing to start an ungated server over financial data.",
  );
  process.exit(1);
}

// The session cookie value is a hash of the password + a fixed salt. Anyone who
// knows the password can mint it; nobody can read the password back out of it.
// Rotating APP_PASSWORD invalidates all existing sessions automatically.
const SESSION_TOKEN = createHash("sha256")
  .update("ss-gate:v1:" + APP_PASSWORD)
  .digest("hex");
const COOKIE_NAME = "ss_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Login rate limiting — defense-in-depth on top of a strong APP_PASSWORD.
// Per client IP: after LOGIN_MAX_ATTEMPTS failed tries, lock out for
// LOGIN_WINDOW_MS. In-memory only; a process restart clears it.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min window & lockout
const loginAttempts = new Map(); // clientKey -> { count, resetAt }

// Content-Security-Policy. Every external API (Yahoo Finance, Dropbox, the
// Anthropic AI chat) is called SERVER-side, so the browser makes no cross-origin
// requests — connect-src 'self' suffices. style-src allows inline styles (the
// login page's inline <style> block + component-injected styles). script-src is
// deliberately strict; if the SSR framework injects inline hydration scripts we
// discover it via Report-Only mode (below) before enforcing, so a wrong directive
// logs to the console instead of white-screening the app.
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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isAuthed(req) {
  const cookies = parseCookies(req.headers.cookie);
  const tok = cookies[COOKIE_NAME];
  return !!tok && safeEqual(tok, SESSION_TOKEN);
}

function clientKey(req) {
  const xff = req.headers["x-forwarded-for"];
  const fwd = (Array.isArray(xff) ? xff[0] : xff ?? "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}

/** Seconds remaining if this client is currently locked out, else 0. */
function loginLockedFor(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return 0;
  if (Date.now() > rec.resetAt) {
    loginAttempts.delete(key);
    return 0;
  }
  return rec.count >= LOGIN_MAX_ATTEMPTS ? Math.ceil((rec.resetAt - Date.now()) / 1000) : 0;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

// Periodically drop expired records so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of loginAttempts) if (now > rec.resetAt) loginAttempts.delete(k);
}, LOGIN_WINDOW_MS).unref?.();

function loginPage(error) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StockStarter — Sign in</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
         background: radial-gradient(circle at 20% 20%, #0a1128 0%, #030509 60%); color:#eaf2ff; }
  .card { width:100%; max-width:340px; padding:32px 28px; margin:16px;
          background: rgba(18, 24, 44, 0.55); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border:1px solid rgba(96, 165, 250, 0.25); border-radius:18px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06); }
  .logo { width:40px; height:40px; border-radius:10px;
          background: linear-gradient(135deg, #1d4ed8, #38bdf8); display:flex;
          align-items:center; justify-content:center; margin-bottom:18px; }
  .logo svg { width:20px; height:20px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; letter-spacing:-0.01em; }
  p.sub { font-size:13px; color:#9fb3d9; margin:0 0 22px; }
  label { display:block; font-size:12px; color:#9fb3d9; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; font-size:14px; color:#eaf2ff; background: rgba(10, 14, 28, 0.6);
          border:1px solid rgba(96, 165, 250, 0.3); border-radius:9px; outline:none; }
  input:focus { border-color:#38bdf8; }
  button { width:100%; margin-top:16px; padding:10px; font-size:14px; font-weight:600;
           color:#04101f; background: linear-gradient(135deg, #38bdf8, #1d4ed8); border:0; border-radius:9px; cursor:pointer; }
  button:hover { filter: brightness(1.08); }
  .err { margin-top:14px; font-size:12.5px; color:#f87171; }
</style></head><body>
  <form class="card" method="POST" action="/__login">
    <div class="logo"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="10.5" stroke="#fff" stroke-width="4" opacity="0.5"/><path d="M16 5.5 a10.5 10.5 0 0 1 9.1 5.25" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg></div>
    <h1>StockStarter</h1>
    <p class="sub">Enter the access password to continue.</p>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus>
    ${error ? `<div class="err">${error}</div>` : ""}
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

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

    // Security headers on every response (financial app: clickjacking, MIME
    // sniffing, referrer leakage, HTTPS downgrade). Set here so they carry through
    // every response path (send() and direct writeHead alike).
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(CSP_HEADER, CSP);
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");

    // Health check — ungated so the platform can probe liveness.
    if (pathname === "/healthz") {
      return send(res, 200, "ok", { "Content-Type": "text/plain" });
    }

    // Login submission
    if (pathname === "/__login" && req.method === "POST") {
      const key = clientKey(req);
      const lockedFor = loginLockedFor(key);
      if (lockedFor) {
        const mins = Math.ceil(lockedFor / 60);
        return send(
          res,
          429,
          loginPage(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`),
          { "Retry-After": String(lockedFor) },
        );
      }
      const body = await readBody(req);
      const params = new URLSearchParams(body ? body.toString("utf8") : "");
      const attempt = params.get("password") ?? "";
      if (safeEqual(createHash("sha256").update("ss-gate:v1:" + attempt).digest("hex"), SESSION_TOKEN)) {
        loginAttempts.delete(key); // clear failures on success
        const cookie = [
          `${COOKIE_NAME}=${SESSION_TOKEN}`,
          "HttpOnly",
          "Path=/",
          "SameSite=Lax",
          `Max-Age=${COOKIE_MAX_AGE}`,
          secure ? "Secure" : "",
        ].filter(Boolean).join("; ");
        return send(res, 303, "", { Location: "/", "Set-Cookie": cookie });
      }
      recordLoginFailure(key);
      return send(res, 401, loginPage("Incorrect password."));
    }

    // Logout
    if (pathname === "/__logout") {
      const cookie = `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
      return send(res, 303, "", { Location: "/", "Set-Cookie": cookie });
    }

    // Everything below requires auth.
    if (!isAuthed(req)) {
      return send(res, 200, loginPage(""));
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
  console.log(`[server] listening on 0.0.0.0:${PORT} (gated)`);
});
