// Dependency-free localhost server for Table Goblin. Keep this window open.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const project = path.resolve(__dirname, "..");
const root = path.join(project, "dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
function open(url) {
  if (process.env.TABLE_GOBLIN_NO_OPEN) return;
  const command =
    process.platform === "win32"
      ? ["cmd.exe", ["/d", "/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  execFile(command[0], command[1], { windowsHide: true }, (error) => {
    if (error) console.log(`Open this address in your browser: ${url}`);
  });
}
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error(
    "The built app is missing. Run npm install and npm run build in this folder, then open the launcher again.",
  );
  process.exit(1);
}
const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  if (req.url === "/__table-goblin") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ app: "table-goblin", project }));
    return;
  }
  let file;
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
  } catch {
    res.writeHead(400);
    res.end("Invalid address");
    return;
  }
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
  });
});
let port = 4173;
server.on("error", async (error) => {
  if (error.code !== "EADDRINUSE") {
    console.error(`Could not open the local server: ${error.message}`);
    process.exit(1);
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__table-goblin`, {
      signal: AbortSignal.timeout(1200),
    });
    const info = await response.json();
    if (info.app === "table-goblin" && info.project === project) {
      console.log(
        `Your table is already open at http://127.0.0.1:${port}. Opening it again in the browser.`,
      );
      open(`http://127.0.0.1:${port}`);
      process.exit(0);
    }
  } catch {}
  if (++port > 4193) {
    console.error("No free port found between 4173 and 4193.");
    process.exit(1);
  }
  server.listen(port, "127.0.0.1");
});
server.on("listening", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(
    `\n  TABLE GOBLIN\n\n  ${url}\n\n  Keep this window open while you play.\n  Close it or press Ctrl+C to stop the local server.\n  Your table saves in this browser. Use Export table for a portable backup.\n`,
  );
  open(url);
});
server.listen(port, "127.0.0.1");
