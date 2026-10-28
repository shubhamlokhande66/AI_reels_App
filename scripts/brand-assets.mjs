// The Shubix logos from the two pictures in logo/:   node scripts/brand-assets.mjs   (then commit the result)
//
// - the logo with the name (the wide picture) → public/brand: the header, the menu and the footer (components/atoms/Logo.tsx)
// - the emblem alone (the square picture) → the browser tab: app/icon.png and app/favicon.ico
// Both are used whole, as designed (nothing cut from them); only the empty clear edges around them are left out.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd(), dir = join(root, "logo");
const pics = await Promise.all(readdirSync(dir).filter((f) => /\.(png|webp)$/i.test(f)).map(async (f) => { const m = await sharp(join(dir, f)).metadata(); return { f, r: m.width / m.height }; }));
if (pics.length < 2) throw new Error("logo/ needs two pictures: the logo with the name (wide) and the emblem alone (square)");
pics.sort((a, b) => b.r - a.r);
const named = pics[0].f, single = pics[pics.length - 1].f;
console.log(`Logo with the name: ${named}\nEmblem (browser tab): ${single}`);
const logo = await sharp(join(dir, named)).ensureAlpha().trim({ threshold: 1 }).png().toBuffer();
const emblem = await sharp(join(dir, single)).ensureAlpha().trim({ threshold: 1 }).png().toBuffer();

// written from memory; Windows can hold a file a moment (the dev server, antivirus): try again a few times
async function put(buf, path) {
  for (let n = 0; ; n++) { try { writeFileSync(path, buf); break; } catch (e) { if (n >= 8) throw e; await new Promise((r) => setTimeout(r, 400)); } }
  console.log("  " + path.slice(root.length + 1).replace(/\\/g, "/"));
}
// the emblem whole in a clear square (the tab's icons are square)
const square = (px) => sharp(emblem).resize({ width: px, height: px, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

await put(await sharp(logo).resize({ height: 360 }).webp({ quality: 90 }).toBuffer(), join(root, "public/brand/shubix-gold.webp"));
await put(await sharp(logo).resize({ height: 200 }).webp({ quality: 90 }).toBuffer(), join(root, "public/brand/shubix-gold-sm.webp"));
await put(await square(512), join(root, "app/icon.png"));
await put(await ico([await square(16), await square(32), await square(48)]), join(root, "app/favicon.ico"));

// an .ico holding PNG pictures (every browser and Windows read these)
async function ico(pngs) {
  const ms = await Promise.all(pngs.map((p) => sharp(p).metadata()));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let at = 6 + 16 * pngs.length;
  const dirs = ms.map((m, i) => { const d = Buffer.alloc(16); d.writeUInt8(m.width, 0); d.writeUInt8(m.height, 1); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(pngs[i].length, 8); d.writeUInt32LE(at, 12); at += pngs[i].length; return d; });
  return Buffer.concat([head, ...dirs, ...pngs]);
}
