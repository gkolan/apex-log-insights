#!/usr/bin/env tsx
/** Validates local Markdown links and repository-specific documentation invariants. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".claude",
  ".git",
  ".test-dist",
  ".vscode-test",
  "node_modules",
  "dist",
  "research",
  "audit",
  "bugs",
  "code-analyzer-output",
  "coverage",
  "external-corpus",
  "reports",
]);
const errors: string[] = [];

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (ignoredDirectories.has(name)) return [];
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const markdownFiles = walk(root).filter((path) => extname(path) === ".md");

function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*~]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

function markdownHeadings(path: string): Set<string> {
  const content = readFileSync(path, "utf8").replace(/```[\s\S]*?```/g, "");
  return new Set(
    [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) =>
      headingSlug(match[1]!),
    ),
  );
}

function findDirectories(directory: string): string[] {
  return [
    directory,
    ...readdirSync(directory).flatMap((name) => {
      if (name.startsWith(".")) return [];
      const path = resolve(directory, name);
      return statSync(path).isDirectory() ? findDirectories(path) : [];
    }),
  ];
}

const documentedDirectories = [
  ...findDirectories(resolve(root, "docs")),
  ...findDirectories(resolve(root, "assets")),
  resolve(root, "packages/browser-ext/store"),
];
for (const directory of documentedDirectories) {
  if (!existsSync(resolve(directory, "README.md"))) {
    errors.push(
      `${directory.slice(root.length + 1)}/: documentation folder is missing README.md`,
    );
  }
}

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1]?.trim();
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const [pathPart, anchor] = target.split("#", 2);
    const withoutAnchor = pathPart?.replace(/^<|>$/g, "");
    const decoded = decodeURIComponent(withoutAnchor || "");
    const resolvedTarget = decoded ? resolve(dirname(file), decoded) : file;
    if (!existsSync(resolvedTarget)) {
      errors.push(
        `${file.slice(root.length + 1)}: missing link target ${target}`,
      );
      continue;
    }
    if (
      anchor &&
      extname(resolvedTarget) === ".md" &&
      !markdownHeadings(resolvedTarget).has(
        decodeURIComponent(anchor).toLowerCase(),
      )
    ) {
      errors.push(
        `${file.slice(root.length + 1)}: missing heading anchor ${target}`,
      );
    }
  }
}

const canonicalDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "STYLE_GUIDE.md",
  "AGENTS.md",
  "CLAUDE.md",
];
const stalePaths = [
  "packages/browser-ext/app.js",
  "packages/browser-ext/styles.css",
];
for (const relative of canonicalDocs) {
  const content = readFileSync(resolve(root, relative), "utf8");
  for (const stalePath of stalePaths) {
    if (content.includes(stalePath))
      errors.push(`${relative}: stale generated-file path ${stalePath}`);
  }
}

const userFacingDocs = [
  "README.md",
  "docs/README.md",
  "docs/user-guides/getting-started.md",
  "docs/user-guides/privacy.md",
  "docs/user-guides/troubleshooting.md",
  "packages/browser-ext/README.md",
  "packages/browser-ext/store/SUBMISSION-CHECKLIST.md",
  "packages/browser-ext/store/listing.md",
  "packages/browser-ext/store/privacy-policy.md",
  "packages/browser-ext/store/screenshots-guide.md",
  "packages/cli/README.md",
  "packages/core/README.md",
  "packages/mcp/README.md",
];
const staleWording = [
  "actionable insights",
  "No log data is stored",
  "logs/webstore-demo-opportunity-trigger.log",
  "Triage View",
  "Execution View",
  "Data View",
  "Evidence View",
  "Evidence/Log Explorer",
];
for (const relative of userFacingDocs) {
  const content = readFileSync(resolve(root, relative), "utf8");
  for (const wording of staleWording) {
    if (content.includes(wording)) {
      errors.push(
        `${relative}: stale wording "${wording}"; use the contract in docs/reference/terminology.md`,
      );
    }
  }
}

if (existsSync(resolve(root, "package-lock.json"))) {
  errors.push("package-lock.json: pnpm is the sole supported package manager");
}

if (errors.length) {
  console.error(
    `Documentation check failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`,
  );
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `Documentation check passed (${markdownFiles.length} Markdown files checked).`,
);
