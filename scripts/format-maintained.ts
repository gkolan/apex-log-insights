import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORMAT_EXTENSIONS = new Set([
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".yaml",
  ".yml",
]);
const EXCLUDED_PREFIXES = [
  "packages/browser-ext/shared/",
  "packages/vscode-ext/webview/",
  "research/",
  "viewer/",
];

export function isMaintainedFormatFile(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    FORMAT_EXTENSIONS.has(extname(normalized)) &&
    !EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix)) &&
    normalized !== "pnpm-lock.yaml"
  );
}

export function listMaintainedFormatFiles(cwd: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "utf8" },
  );
  return output
    .split("\0")
    .filter(Boolean)
    .filter(isMaintainedFormatFile)
    .filter((filePath) => existsSync(resolve(cwd, filePath)))
    .sort();
}

export function prettierArguments(
  mode: "--check" | "--write",
  files: string[],
): string[] {
  return [mode, "--", ...files];
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--write") {
    throw new Error("Usage: format-maintained.ts --check|--write");
  }

  const cwd = process.cwd();
  const files = listMaintainedFormatFiles(cwd);
  if (!files.length)
    throw new Error("No maintained files found for formatting.");

  const executable = resolve(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prettier.cmd" : "prettier",
  );
  const result = spawnSync(executable, prettierArguments(mode, files), {
    cwd,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}
