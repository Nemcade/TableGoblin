const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const project = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4180);
const url = `http://127.0.0.1:${port}`;
function open() {
  if (process.env.TABLE_GOBLIN_NO_OPEN) return;
  const [cmd, args] = process.platform === "win32" ? ["cmd.exe", ["/d", "/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd, args, { windowsHide: true }, error => { if (error) console.log(`Open ${url} in your browser.`); });
}
(async () => {
  for (const file of ["dist/index.html", ".server-runtime/room-state.cjs", ".server-runtime/room-operations.cjs"]) if (!fs.existsSync(path.join(project, file)))
    throw new Error("The built app is missing. Run npm install and npm run build in this folder first.");
  const { serverBuild } = require("./online-runtime.cjs");
  let response;
  try { response = await fetch(url + "/api/health", { signal: AbortSignal.timeout(1500) }); }
  catch (error) { if (error.cause?.code !== "ECONNREFUSED") throw new Error(`Could not check the service on port ${port}. Close the existing server window and try again.`); }
  if (response) {
    const info = await response.json().catch(() => ({}));
    if (info.app !== "table-goblin") throw new Error(`Port ${port} is used by another application. Set PORT to a free port before starting Table Goblin.`);
    if (info.build !== serverBuild()) throw new Error(`An older or different Table Goblin server is already running on port ${port}.\nClose its existing server window (or press Ctrl+C there), then open this launcher again.\nRefresh the GM and player browsers afterward. Your saved rooms and identities are kept.\nThe outdated server has not been stopped automatically.`);
    console.log(`Table Goblin is already running: ${url}`); open(); return;
  }
  const child = spawn(process.execPath, [path.join(__dirname, "room-server.cjs")], { cwd: project, stdio: ["inherit", "pipe", "inherit"], windowsHide: true });
  let started = false;
  child.stdout.on("data", chunk => { process.stdout.write(chunk); if (!started && chunk.toString().includes("Table Goblin online:")) { started = true; open(); } });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 0; });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
