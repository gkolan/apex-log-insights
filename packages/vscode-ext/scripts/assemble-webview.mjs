import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const viewerRoot = resolve(repositoryRoot, "viewer");
const outputRoot = resolve(packageRoot, "dist/webview");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(
  resolve(repositoryRoot, "THIRD-PARTY-NOTICES.md"),
  resolve(packageRoot, "dist/THIRD-PARTY-NOTICES.md"),
);
await cp(resolve(viewerRoot, "modules"), resolve(outputRoot, "modules"), {
  recursive: true,
});
await cp(resolve(viewerRoot, "icons"), resolve(outputRoot, "icons"), {
  recursive: true,
});
await cp(
  resolve(
    repositoryRoot,
    "packages/browser-ext/shared/icons/icon-active-128.png",
  ),
  resolve(outputRoot, "icons/icon-active-128.png"),
);
for (const file of ["app.js", "styles.css"]) {
  await cp(resolve(viewerRoot, file), resolve(outputRoot, file));
}
await cp(
  resolve(packageRoot, "webview/vscode-adapter.js"),
  resolve(outputRoot, "vscode-adapter.js"),
);
await cp(
  resolve(packageRoot, "webview/vscode.css"),
  resolve(outputRoot, "vscode.css"),
);

const sourceHtml = await readFile(resolve(viewerRoot, "index.html"), "utf8");
const html = sourceHtml
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace(
    /<script type="module" src="\.\/app\.js\?v=[^"]+"><\/script>/,
    '<script nonce="{{NONCE}}" type="module" src="{{SCRIPT_URI}}"></script>',
  )
  .replace(/\s*<script>\s*if \("serviceWorker"[\s\S]*?<\/script>/, "")
  .replace(/\s*<script src="\.\/register-sw\.js"><\/script>/, "")
  .replace("./styles.css?v=1.2.0", "{{STYLE_URI}}")
  .replace(
    "</head>",
    '    <link rel="stylesheet" href="{{VSCODE_STYLE_URI}}" />\n  </head>',
  )
  .replace("./icons/icon-active.svg", "{{ICON_URI}}")
  .replace(
    "<head>",
    '<head>\n    <meta http-equiv="Content-Security-Policy" content="{{CSP}}" />',
  );
await writeFile(resolve(outputRoot, "index.html"), html);
