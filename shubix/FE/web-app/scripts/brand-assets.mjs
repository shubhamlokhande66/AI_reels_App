// Every Shubix logo and icon from the two pictures in Shared/ui-core/assets:   node scripts/brand-assets.mjs   (then commit)
//
// - the logo with the name (the wide picture) → public/brand (the header, the menu and the footer: components/atoms/Logo.tsx),
//   also for the phone app (FE/mobile-app/assets/brand)
// - the emblem alone (the square picture) → every icon: the browser tab (app/icon.png, app/favicon.ico), the installed web
//   app (public/icon-*.png), the iPhone home screen (app/apple-icon.png), the phone app (FE/mobile-app/assets) and Google
//   Play (docs/play-store/icon-512.png)
// Both are used whole, as designed; only the empty clear edges around them are left out. The icons keep a clear background,
// except where the system needs one (iPhone, the web app's maskable icon): white there.
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";

const root = process.cwd(), dir = join(root, "../../Shared/ui-core/assets");
const pics = await Promise.all(readdirSync(dir).filter((f) => /\.(png|webp)$/i.test(f)).map(async (f) => { const m = await sharp(join(dir, f)).metadata(); return { f, r: m.width / m.height }; }));
if (pics.length < 2) throw new Error("Shared/ui-core/assets needs two pictures: the logo with the name (wide) and the emblem alone (square)");
pics.sort((a, b) => b.r - a.r);
const named = pics[0].f, single = pics[pics.length - 1].f;
console.log(`Logo with the name: ${named}\nEmblem (every icon): ${single}`);
const logo = await sharp(join(dir, named)).ensureAlpha().trim({ threshold: 1 }).png().toBuffer();
const emblem = await sharp(join(dir, single)).ensureAlpha().trim({ threshold: 1 }).png().toBuffer();

// written from memory; Windows can hold a file a moment (the dev server, antivirus): try again a few times
async function put(buf, path) {
  for (let n = 0; ; n++) { try { writeFileSync(path, buf); break; } catch (e) { if (n >= 8) throw e; await new Promise((r) => setTimeout(r, 400)); } }
  console.log("  " + relative(root, path).replace(/\\/g, "/"));
}
const clear = { r: 0, g: 0, b: 0, alpha: 0 };
// the emblem whole, filling `fill` of a px square, on a clear (or white) background
async function square(px, fill = 1, white = false) {
  const n = Math.round(px * fill), mark = await sharp(emblem).resize({ width: n, height: n, fit: "contain", background: clear }).toBuffer();
  const pic = sharp({ create: { width: px, height: px, channels: 4, background: white ? "#ffffff" : clear } }).composite([{ input: mark, gravity: "center" }]);
  return (white ? pic.flatten({ background: "#ffffff" }) : pic).png({ compressionLevel: 9 }).toBuffer();
}
const mobile = join(root, "../mobile-app/assets");

for (const [h, name] of [[360, "shubix-gold.webp"], [200, "shubix-gold-sm.webp"]]) {
  const pic = await sharp(logo).resize({ height: h }).webp({ quality: 90 }).toBuffer();
  await put(pic, join(root, "public/brand", name)); await put(pic, join(mobile, "brand", name));
}
await put(await square(512), join(root, "app/icon.png"));
await put(await ico([await square(16), await square(32), await square(48)]), join(root, "app/favicon.ico"));
await put(await square(180, 0.84, true), join(root, "app/apple-icon.png"));
await put(await square(192, 0.96), join(root, "public/icon-192.png"));
await put(await square(512, 0.96), join(root, "public/icon-512.png"));
await put(await square(512, 0.74, true), join(root, "public/icon-maskable-512.png")); // kept inside the safe circle
await put(await square(1024, 0.96), join(mobile, "icon.png"));
await put(await square(1024, 0.62), join(mobile, "adaptive-icon.png")); // Android crops the edges (app.json: the white behind it)
await put(await square(512, 0.96), join(root, "../../docs/play-store/icon-512.png"));

// an .ico holding PNG pictures (every browser and Windows read these)
async function ico(pngs) {
  const ms = await Promise.all(pngs.map((p) => sharp(p).metadata()));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let at = 6 + 16 * pngs.length;
  const dirs = ms.map((m, i) => { const d = Buffer.alloc(16); d.writeUInt8(m.width, 0); d.writeUInt8(m.height, 1); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(pngs[i].length, 8); d.writeUInt32LE(at, 12); at += pngs[i].length; return d; });
  return Buffer.concat([head, ...dirs, ...pngs]);
}
