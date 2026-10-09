const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
function serverBuild() {
  const root = path.resolve(__dirname, "..");
  const hash = createHash("sha256").update(root);
  for (const file of ["scripts/room-server.cjs", "scripts/online-runtime.cjs", ".server-runtime/room-state.cjs", ".server-runtime/room-operations.cjs", ".server-runtime/room-permissions.cjs"])
    hash.update(fs.readFileSync(path.join(root, file)));
  return hash.digest("hex");
}
module.exports = { serverBuild };
