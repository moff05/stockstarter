// One-time Dropbox refresh-token bootstrap.
//
// Run locally once to mint a long-lived refresh token for the hosted sync:
//     bun scripts/dropbox-auth.mjs
//
// It asks for your App key + App secret (from dropbox.com/developers/apps →
// your app → Settings), walks you through the authorize step, and prints the
// refresh token. Put that token — plus the app key/secret — into Railway as
// DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN.
//
// Nothing is stored on disk; the secret never leaves your machine except in
// the direct token exchange with Dropbox.

const appKey = (prompt("Dropbox App key:") ?? "").trim();
const appSecret = (prompt("Dropbox App secret:") ?? "").trim();

if (!appKey || !appSecret) {
  console.error("App key and secret are both required. Aborting.");
  process.exit(1);
}

// token_access_type=offline → we get a refresh token, not just a short-lived one.
const authUrl =
  "https://www.dropbox.com/oauth2/authorize?" +
  new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    token_access_type: "offline",
  }).toString();

console.log("\n1. Open this URL in your browser and click 'Allow':\n");
console.log("   " + authUrl + "\n");
console.log("2. Dropbox will show you an authorization code. Copy it.\n");

const code = (prompt("3. Paste the authorization code here:") ?? "").trim();
if (!code) {
  console.error("No code provided. Aborting.");
  process.exit(1);
}

const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: appKey,
    client_secret: appSecret,
  }).toString(),
});

if (!res.ok) {
  console.error("\nToken exchange failed:", res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
if (!data.refresh_token) {
  console.error("\nNo refresh_token in response:", data);
  process.exit(1);
}

// Look up the account's root namespace. On a Dropbox Business/team account the
// team-space folders (e.g. a company's "/Finance/...") only resolve when
// the API is told to use the team root — otherwise a member token defaults to
// the personal "home" root and team folders return path/not_found. If this is a
// team account, print the id to set as DROPBOX_ROOT_NAMESPACE_ID.
let rootNamespaceId = null;
let isTeamAccount = false;
try {
  const acct = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (acct.ok) {
    const info = await acct.json();
    rootNamespaceId = info?.root_info?.root_namespace_id ?? null;
    isTeamAccount = info?.root_info?.[".tag"] === "team";
  }
} catch {
  /* non-fatal — the refresh token above is what matters */
}

console.log("\n✅ Success. Set these in Railway → Variables:\n");
console.log("   DROPBOX_APP_KEY       = " + appKey);
console.log("   DROPBOX_APP_SECRET    = " + appSecret);
console.log("   DROPBOX_REFRESH_TOKEN = " + data.refresh_token);
console.log("\n(Also set DROPBOX_FOLDER to the folder path, e.g. /StockStarter/Broker Exports)\n");

if (rootNamespaceId) {
  if (isTeamAccount) {
    console.log("⚠️  This is a Dropbox TEAM account. The shared folder lives in the team");
    console.log("    space, so you MUST also set this or the sync gets path/not_found:\n");
    console.log("   DROPBOX_ROOT_NAMESPACE_ID = " + rootNamespaceId + "\n");
  } else {
    console.log("(Personal account — DROPBOX_ROOT_NAMESPACE_ID not needed. If a team");
    console.log(" folder ever 404s, set DROPBOX_ROOT_NAMESPACE_ID = " + rootNamespaceId + ")\n");
  }
}
