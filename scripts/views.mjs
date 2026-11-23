import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/*
 * The published CLI generates view handles itself during r4 build, but the
 * typegen step compiles the app crate first, so a fresh checkout needs the
 * handles before the first cargo build. Import the generator from the
 * installed package and write them here.
 */
const packageRoot = await realpath("node_modules/@r4pidjs/r4");
const { generateViews } = await import(
  pathToFileURL(packageRoot + "/lib/generate-views.mjs").href
);
const check = process.argv.includes("--check");

await generateViews({
  webDir: "app/web",
  outFile: "app/src/generated/views.rs",
  check,
});

console.log(check ? "view handles are up to date" : "wrote app/src/generated/views.rs");
