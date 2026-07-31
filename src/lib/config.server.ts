import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this into the client bundle — values here never reach the browser.
// Always read process.env inside a function so values are resolved at
// request time, not module load time.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
  };
}
