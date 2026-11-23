import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";

const webDir = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(webDir, "..");
const npmDir = resolve(root, "npm");
const assetsDir = resolve(webDir, "assets");
const generatedDir = resolve(webDir, ".generated");
const require = createRequire(import.meta.url);

/*
 * Island discovery and the client loader map are framework-owned. The
 * generated registry is the module the client router imports through the
 * layout's data-islands URL, so it is written by the installed CLI rather
 * than duplicated here.
 */
const packageRoot = await realpath(
  dirname(require.resolve("@r4pidjs/r4/package.json")),
);
const { writeIslands } = await import(
  pathToFileURL(resolve(packageRoot, "lib/islands.mjs")).href
);

const common = {
  platform: "browser",
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
  transform: {
    jsx: "react-jsx",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  },
  logLevel: "warn",
};

await rm(npmDir, { recursive: true, force: true });
await rm(assetsDir, { recursive: true, force: true });
await mkdir(npmDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });

await writeIslands({ webDir });

/*
 * React ships CommonJS packages and the asset server serves browser ES
 * modules, so the React entry points are bundled once and mounted under
 * /__assets/npm. The wrappers share one vendor module so the browser keeps a
 * single React instance across react, react-dom/client, and jsx-runtime.
 */
const react = require("react");
const jsx = require("react/jsx-runtime");
const dom = require("react-dom/client");
const exportNames = [
  ...new Set([...Object.keys(react), ...Object.keys(jsx), "createRoot", "hydrateRoot"]),
]
  .filter(name => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
  .sort();
const npmEntry = resolve(generatedDir, "npm-entry.js");

await writeFile(
  npmEntry,
  [
    'import ReactDefault from "react";',
    'import * as Jsx from "react/jsx-runtime";',
    'import * as Dom from "react-dom/client";',
    "export default ReactDefault;",
    "const { " + exportNames.join(", ") + " } = { ...ReactDefault, ...Jsx, ...Dom };",
    "export { " + exportNames.join(", ") + " };",
  ].join("\n"),
);

await build({
  ...common,
  input: { vendor: npmEntry },
  output: {
    dir: npmDir,
    format: "es",
    codeSplitting: false,
    entryFileNames: "vendor.js",
    minify: true,
  },
});

await writeFile(
  resolve(npmDir, "react.js"),
  'export { default } from "./vendor.js";\nexport * from "./vendor.js";\n',
);
await writeFile(resolve(npmDir, "react-dom-client.js"), 'export * from "./vendor.js";\n');
await writeFile(resolve(npmDir, "react-jsx-runtime.js"), 'export * from "./vendor.js";\n');

await build({
  ...common,
  input: { server: resolve(webDir, "server.jsx") },
  output: {
    file: resolve(root, "bundle.js"),
    format: "iife",
    codeSplitting: false,
  },
});

await writeFile(
  resolve(assetsDir, "manifest.json"),
  JSON.stringify({ files: {} }, null, 2) + "\n",
);

console.log("built npm/, bundle.js, and web/assets");
