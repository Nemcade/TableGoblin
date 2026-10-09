// Rebuild locally hosted Google Fonts assets; no network requests at app runtime.
const fs = require("node:fs/promises");
const path = require("node:path");
const families = [
  ["Meddon", "meddon", ""], ["Cormorant Garamond", "cormorantgaramond", ":ital,wght@0,400;0,700;1,400;1,700"],
  ["Jim Nightshade", "jimnightshade", ""], ["Special Elite", "specialelite", ""],
  ["Crimson Pro", "crimsonpro", ":ital,wght@0,400;0,700;1,400;1,700"],
  ["Roboto", "roboto", ":ital,wght@0,400;0,700;1,400;1,700"], ["Quicksand", "quicksand", ":wght@400;700"],
  ["Bebas Neue", "bebasneue", ""], ["Nunito", "nunito", ":ital,wght@0,400;0,700;1,400;1,700"],
  ["IM Fell English", "imfellenglish", ":ital@0;1"],
];
const root = path.resolve(__dirname, "../public/fonts");
async function get(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}
(async () => {
  await fs.mkdir(root, { recursive: true });
  const blocks = [], sources = [];
  for (const [family, slug, styles] of families) {
    const url = `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}${styles}&display=swap`;
    const css = await (await get(url)).text();
    const faces = [...css.matchAll(/\/\* (latin(?:-ext)?) \*\/\s*(@font-face\s*\{[^}]+\})/g)].map(m => m[2]);
    if (!faces.length) throw new Error(`No Latin font faces for ${family}`);
    const assets = new Map();
    for (const face of faces) {
      const remote = face.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
      if (!remote) throw new Error(`Missing font file for ${family}`);
      let file = assets.get(remote);
      if (!file) {
        file = `${slug}-${assets.size + 1}.woff2`; assets.set(remote, file);
        await fs.writeFile(path.join(root, file), Buffer.from(await (await get(remote)).arrayBuffer()));
        sources.push({ family, file, source: remote });
      }
      blocks.push(face.replace(remote, `/fonts/${file}`));
    }
    const licensePath = slug === "specialelite" ? "apache/specialelite/LICENSE.txt" : `ofl/${slug}/OFL.txt`;
    const license = await (await get(`https://raw.githubusercontent.com/google/fonts/main/${licensePath}`)).text();
    await fs.writeFile(path.join(root, `${slug}-LICENSE.txt`), license);
    console.log(`${family}: ${assets.size} local font files + license`);
  }
  await fs.writeFile(path.join(root, "fonts.css"), "/* Google Fonts, locally hosted. Licenses and sources in this directory. */\n" + blocks.join("\n\n"));
  await fs.writeFile(path.join(root, "sources.json"), JSON.stringify(sources, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
