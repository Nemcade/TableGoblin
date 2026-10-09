for (const entry of ["room-state", "room-operations", "room-permissions"]) require("esbuild").buildSync({
  entryPoints: [`src/${entry}.ts`], bundle: true, platform: "node", format: "cjs",
  outfile: `.server-runtime/${entry}.cjs`,
});
