// Tiny allowlisted proxy for Yahoo Finance. Yahoo 429s Vercel's (AWS) IPs,
// but accepts Cloudflare's. StockStarter calls `<worker>/<yahoo-host>/<path>`
// and this forwards it, passing cookies/redirects through untouched.
//
// Deploy: `cd worker && npx wrangler deploy && npx wrangler secret put PROXY_KEY`
// then set YAHOO_PROXY_URL / YAHOO_PROXY_KEY on the app host.

const ALLOWED_HOSTS = new Set([
  "fc.yahoo.com",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
]);

export default {
  async fetch(req, env) {
    if (env.PROXY_KEY && req.headers.get("x-proxy-key") !== env.PROXY_KEY) {
      return new Response("forbidden", { status: 403 });
    }
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

    const url = new URL(req.url);
    const [, host, ...rest] = url.pathname.split("/");
    if (!ALLOWED_HOSTS.has(host)) return new Response("host not allowed", { status: 403 });

    const headers = new Headers();
    for (const h of ["user-agent", "accept", "cookie"]) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    return fetch(`https://${host}/${rest.join("/")}${url.search}`, {
      headers,
      redirect: "manual",
    });
  },
};
