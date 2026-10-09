require("esbuild").buildSync({
  entryPoints: ["src/room-state.ts"], bundle: true, platform: "node", format: "cjs",
  outfile: ".server-runtime/room-state.cjs",
});
