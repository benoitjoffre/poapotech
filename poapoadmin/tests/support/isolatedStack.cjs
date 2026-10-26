// Starts a private API, admin and widget so browser recipes never share the dev server's in-memory rate limiter.
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const ports = { api: 5161, admin: 5181, widget: 5182 };

async function waitFor(url, label, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} stopped early (exit ${child.exitCode})`);
    try { if ((await fetch(url)).status < 500) return; } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${label} not ready at ${url}`);
}

async function startIsolatedStack() {
  const urls = { api: `http://localhost:${ports.api}`, admin: `http://localhost:${ports.admin}`, widget: `http://localhost:${ports.widget}` };
  const children = [];
  const run = (cwd, args, env) => {
    const child = spawn(process.execPath, args, { cwd: path.join(root, cwd), stdio: process.env.POAPO_STACK_LOGS ? "inherit" : "ignore", env: { ...process.env, ...env } });
    children.push(child);
    return child;
  };
  const vite = path.join(root, "node_modules/vite/bin/vite.js");
  const api = run("poapoback", ["--import", "tsx", "src/server.ts"], {
    PORT: String(ports.api), NODE_ENV: "test", POAPO_RATE_LIMIT_MAX: "1000000",
    FRONTEND_URL: urls.widget, ADMIN_URL: urls.admin,
  });
  const admin = run("poapoadmin", [vite, "--port", String(ports.admin), "--strictPort"], {
    POAPO_API_PROXY: urls.api, VITE_WIDGET_BASE_URL: urls.widget,
  });
  const widget = run("poapofront", [vite, "--port", String(ports.widget), "--strictPort"], { POAPO_API_PROXY: urls.api, VITE_API_BASE_URL: urls.api });
  const stop = () => { for (const child of children) if (child.exitCode === null) child.kill("SIGTERM"); };
  try {
    await Promise.all([
      waitFor(`${urls.api}/api/auth/me`, "API", api),
      waitFor(urls.admin, "admin", admin),
      waitFor(urls.widget, "widget", widget),
    ]);
  } catch (error) { stop(); throw error; }
  return { ...urls, stop };
}

// Isolated by default; POAPO_API_URL / POAPO_ADMIN_URL / POAPO_WIDGET_URL point the recipe at an existing stack instead.
async function resolveStack() {
  if (process.env.POAPO_API_URL) {
    return { api: process.env.POAPO_API_URL, admin: process.env.POAPO_ADMIN_URL || "http://localhost:5174",
      widget: process.env.POAPO_WIDGET_URL || "http://localhost:5173", stop() {} };
  }
  return startIsolatedStack();
}

module.exports = { startIsolatedStack, resolveStack };
