// Server-only Dropbox API client for the hosted sync.
//
// Reads a shared folder over the Dropbox API (the hosted server has no local
// Dropbox sync). Uses a long-lived refresh token (see scripts/dropbox-auth.mjs)
// exchanged for short-lived access tokens, cached in memory until expiry.
//
// Required env: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
// Folder path:  DROPBOX_FOLDER (e.g. "/StockStarter/Broker Exports")
// Team spaces:  DROPBOX_ROOT_NAMESPACE_ID (optional; set on a Business/team
//               account so team-space folders resolve — see pathRootHeaders)

export type DropboxFile = {
  name: string; // e.g. "Brokerage.xlsx"
  path: string; // Dropbox path_lower, used to download
  rev: string; // content revision — changes when the file is replaced
  modified: string; // server_modified ISO timestamp
};

export function isDropboxConfigured(): boolean {
  return !!(
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET &&
    process.env.DROPBOX_REFRESH_TOKEN
  );
}

export function dropboxFolder(): string {
  const f = process.env.DROPBOX_FOLDER ?? "";
  // Dropbox API wants a leading slash and no trailing slash; "" = root.
  const trimmed = f.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
}

// Team-space support. On a Dropbox Business account, a member token resolves
// paths against the member's personal "home" namespace by default — so a
// team-space folder (e.g. a company's shared "/Finance/...") returns
// path/not_found. Setting DROPBOX_ROOT_NAMESPACE_ID to the team root namespace
// id (printed by scripts/dropbox-auth.mjs) makes every call resolve from the
// team root instead. Unset => header omitted => identical to prior behavior.
function pathRootHeaders(): Record<string, string> {
  const ns = (process.env.DROPBOX_ROOT_NAMESPACE_ID ?? "").trim();
  return ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", root: ns }) } : {};
}

// --- access token cache -----------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN!,
      client_id: process.env.DROPBOX_APP_KEY!,
      client_secret: process.env.DROPBOX_APP_SECRET!,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Dropbox token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// --- API calls --------------------------------------------------------------

/** List every file (non-recursive) in the configured folder. Handles paging. */
export async function listFolder(): Promise<DropboxFile[]> {
  const token = await getAccessToken();
  const folder = dropboxFolder();
  const files: DropboxFile[] = [];

  let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...pathRootHeaders(),
    },
    body: JSON.stringify({ path: folder, recursive: false, limit: 2000 }),
  });
  if (!res.ok) {
    throw new Error(`Dropbox list_folder failed: ${res.status} ${await res.text()}`);
  }

  for (;;) {
    const data = (await res.json()) as {
      entries: Array<{
        ".tag": string;
        name: string;
        path_lower?: string;
        rev?: string;
        server_modified?: string;
      }>;
      cursor: string;
      has_more: boolean;
    };

    for (const e of data.entries) {
      if (e[".tag"] !== "file") continue;
      files.push({
        name: e.name,
        path: e.path_lower ?? "",
        rev: e.rev ?? "",
        modified: e.server_modified ?? "",
      });
    }

    if (!data.has_more) break;
    res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...pathRootHeaders(),
      },
      body: JSON.stringify({ cursor: data.cursor }),
    });
    if (!res.ok) {
      throw new Error(`Dropbox list_folder/continue failed: ${res.status} ${await res.text()}`);
    }
  }

  return files;
}

/** Download a file's bytes by its Dropbox path. */
export async function downloadFile(path: string): Promise<ArrayBuffer> {
  const token = await getAccessToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
      ...pathRootHeaders(),
    },
  });
  if (!res.ok) {
    throw new Error(`Dropbox download failed for ${path}: ${res.status} ${await res.text()}`);
  }
  return await res.arrayBuffer();
}
