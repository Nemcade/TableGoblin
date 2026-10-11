for (const entry of ["room-state", "room-operations", "room-permissions", "room-dice", "room-playback", "dice-throw", "dice-physics"]) require("esbuild").buildSync({
  entryPoints: [`src/${entry}.ts`], bundle: true, platform: "node", format: "cjs",
  outfile: `.server-runtime/${entry}.cjs`,
});
