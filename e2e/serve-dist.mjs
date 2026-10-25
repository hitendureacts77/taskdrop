// Serves the exported web app (apps/mobile/dist) for the end-to-end tests, with the
// same fallback to index.html that the real site has (vercel.json rewrites).
//   node e2e/serve-dist.mjs [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(fileURLToPath(new URL("../apps/mobile/dist", import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8099);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".css": "text/css",
};

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  let file = join(root, path);
  if (!(file + sep).startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  // Compress text the way the real site does, so timings taken against this server mean something.
  const type = types[extname(file)] ?? "application/octet-stream";
  const body = readFileSync(file);
  if (/gzip/.test(String(req.headers["accept-encoding"])) && /^(text\/|application\/json)/.test(type)) {
    res.writeHead(200, { "Content-Type": type, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    res.end(gzipSync(body, { level: 6 }));
    return;
  }
  res.writeHead(200, { "Content-Type": type });
  res.end(body);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
