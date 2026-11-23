import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

/*
 * Renders the brand SVGs to the raster assets the servers need:
 *
 *   app/static/favicon.ico         16-256 px PNG frames
 *   app/static/apple-touch-icon.png 180 px full-bleed square
 *
 * The source of truth stays vector: app/static/icon.svg and logo.svg. Run
 * this script after editing either file: node scripts/brand.mjs.
 */

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const staticDir = resolve(root, "app/static");
const icon = (await readFile(resolve(staticDir, "icon.svg"), "utf8")).trim();
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(frames) {
  const header = Buffer.alloc(6);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const entries = Buffer.alloc(16 * frames.length);
  let offset = 6 + 16 * frames.length;

  frames.forEach(({ size, png }, index) => {
    const entry = index * 16;

    entries.writeUInt8(size >= 256 ? 0 : size, entry);
    entries.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    entries.writeUInt8(0, entry + 2);
    entries.writeUInt8(0, entry + 3);
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(png.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);

    offset += png.length;
  });

  return Buffer.concat([header, entries, ...frames.map(frame => frame.png)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 256, height: 256 },
  deviceScaleFactor: 1,
});

async function render(svg, size, { transparent = true } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    [
      "<!doctype html><html><head><style>",
      "html,body{margin:0;padding:0;background:transparent}",
      "svg{display:block}",
      "</style></head><body>",
      svg.replace("<svg ", '<svg width="' + size + '" height="' + size + '" '),
      "</body></html>",
    ].join(""),
  );
  await page.evaluate(() => document.fonts.ready);

  return page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: transparent,
  });
}

const frames = [];

for (const size of ICO_SIZES) {
  frames.push({ size, png: await render(icon, size) });
}

const favicon = ico(frames);
const appleIcon = await render(icon.replace('rx="15"', 'rx="0"'), 180, {
  transparent: false,
});

await writeFile(resolve(staticDir, "favicon.ico"), favicon);
await writeFile(resolve(staticDir, "apple-touch-icon.png"), appleIcon);

console.log(
  "wrote app/static/favicon.ico (" +
    favicon.length.toLocaleString() +
    " bytes, " +
    ICO_SIZES.join("/") +
    ")",
);
console.log(
  "wrote app/static/apple-touch-icon.png (" +
    appleIcon.length.toLocaleString() +
    " bytes, 180x180)",
);

await browser.close();
