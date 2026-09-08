#!/usr/bin/env tsx
/**
 * run-bugs.ts — Runs bug-detection tools and writes individual
 * Markdown reports into the `bugs/` folder at the project root.
 *
 * Tools executed:
 *   1. knip              — unused exports, files, dependencies, dead code
 *   2. tsc --noUncheckedIndexedAccess — unsafe array/object index access
 *   3. attw              — package type correctness for consumers
 *   4. madge             — circular dependency detection
 *
 * Usage:  pnpm bugs:report
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const bugsDir = resolve(root, "bugs");

// Wipe and recreate bugs folder for a clean run
rmSync(bugsDir, { recursive: true, force: true });
mkdirSync(bugsDir, { recursive: true });

const timestamp = new Date().toISOString().slice(0, 10);
let issueIndex = 0;

function nextId(): string {
  issueIndex += 1;
  return String(issueIndex).padStart(3, "0");
}

function writeIssue(
  tool: string,
  severity: string,
  title: string,
  body: string,
): void {
  const id = nextId();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const filename = `${id}-${slug}.md`;
  const content = [
    `# ${title}`,
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| ID | ${id} |`,
    `| Tool | ${tool} |`,
    `| Severity | ${severity} |`,
    `| Date | ${timestamp} |`,
    "",
    body,
    "",
  ].join("\n");
  writeFileSync(resolve(bugsDir, filename), content, "utf8");
  console.log(`  [${severity.toUpperCase().padEnd(8)}] ${id} — ${title}`);
}

function run(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (err) {
    // Many tools exit non-zero when they find issues — capture stdout/stderr
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return (execErr.stdout || "") + "\n" + (execErr.stderr || "");
  }
}

// ---------------------------------------------------------------------------
// 1. knip — unused exports, files, dependencies, dead code
// ---------------------------------------------------------------------------
console.log("\n🔍 Running knip (unused code & dependencies)...");
{
  const raw = run(
    "npx knip --include files,dependencies,unlisted,unresolved --reporter json 2>/dev/null",
  );
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Try line-based fallback
  }

  if (parsed && typeof parsed === "object") {
    const categoryMap: Record<string, { label: string; severity: string }> = {
      files: { label: "Unused file", severity: "medium" },
      dependencies: { label: "Unused dependency", severity: "medium" },
      devDependencies: { label: "Unused devDependency", severity: "low" },
      unlisted: { label: "Unlisted dependency", severity: "high" },
      unresolved: { label: "Unresolved import", severity: "high" },
      exports: { label: "Unused export", severity: "medium" },
      types: { label: "Unused exported type", severity: "low" },
      duplicates: { label: "Duplicate export", severity: "low" },
      enumMembers: { label: "Unused enum member", severity: "low" },
      classMembers: { label: "Unused class member", severity: "medium" },
      binaries: { label: "Unused binary", severity: "low" },
      optionalPeerDependencies: {
        label: "Unused optional peer dependency",
        severity: "low",
      },
    };

    let knipCount = 0;
    const emitCategoryItems = (
      category: string,
      items: unknown,
      fallbackFile?: string,
    ) => {
      if (!Array.isArray(items) || items.length === 0) return;
      const meta = categoryMap[category] || {
        label: category,
        severity: "medium",
      };

      for (const item of items) {
        knipCount++;
        const issue =
          item && typeof item === "object" ? (item as KnipIssue) : {};
        const filePath =
          issue.name || issue.path || fallbackFile || String(item);
        const relPath = filePath.replace(root + "/", "");
        const symbols = issue.symbols
          ? issue.symbols
              .map((s: { symbol: string }) => `\`${s.symbol}\``)
              .join(", ")
          : null;

        const title = `${meta.label}: ${relPath}${symbols ? ` (${symbols})` : ""}`;
        const bodyParts = [
          `**Category:** ${category}`,
          `**File:** \`${relPath}\``,
        ];
        if (fallbackFile && fallbackFile !== filePath) {
          bodyParts.push(
            `**Reported in:** \`${fallbackFile.replace(root + "/", "")}\``,
          );
        }
        if (symbols) bodyParts.push(`**Symbols:** ${symbols}`);
        if (issue.line) bodyParts.push(`**Line:** ${issue.line}`);
        bodyParts.push(
          "",
          `**Action:** Review and remove if truly unused, or add to knip ignore config if intentional.`,
        );

        writeIssue("knip", meta.severity, title, bodyParts.join("\n"));
      }
    };

    // Knip v6 shape: { issues: [{ file, exports: [], files: [], ... }] }
    const fileIssues = Array.isArray(parsed.issues) ? parsed.issues : null;
    if (fileIssues) {
      for (const fileIssue of fileIssues) {
        if (!fileIssue || typeof fileIssue !== "object") continue;
        const issueRecord = fileIssue as KnipFileIssue;
        const fallbackFile =
          typeof issueRecord.file === "string" ? issueRecord.file : undefined;
        for (const [category, items] of Object.entries(issueRecord)) {
          if (category === "file") continue;
          emitCategoryItems(category, items, fallbackFile);
        }
      }
    } else {
      // Legacy shape: { exports: [...], files: [...], ... }
      for (const [category, items] of Object.entries(parsed)) {
        emitCategoryItems(category, items);
      }
    }

    if (knipCount === 0) {
      console.log("  No unused code or dependency issues found.");
    }
  } else {
    // Fallback: parse text output
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.some((l) => /unused|unlisted|unresolved/i.test(l))) {
      for (const line of lines) {
        if (/^\s*(Unused|Unlisted|Unresolved)/i.test(line)) continue; // section headers
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("---") || trimmed.startsWith("knip"))
          continue;
        writeIssue("knip", "medium", `knip: ${trimmed.slice(0, 80)}`, trimmed);
      }
    } else {
      console.log("  No unused code or dependency issues found.");
    }
  }
}

// ---------------------------------------------------------------------------
// 2. tsc --noUncheckedIndexedAccess — unsafe index access
// ---------------------------------------------------------------------------
console.log("\n🔍 Running tsc --noUncheckedIndexedAccess...");
{
  const packages = ["core", "cli", "mcp", "browser-ext"];
  let tscCount = 0;

  for (const pkg of packages) {
    const tsconfig = `packages/${pkg}/tsconfig.json`;
    const raw = run(
      `npx tsc --noEmit --noUncheckedIndexedAccess -p ${tsconfig} 2>&1 || true`,
    );

    const errorLines = raw.split("\n").filter((l) => /error TS\d+/.test(l));
    for (const line of errorLines) {
      tscCount++;
      // Format: path(line,col): error TS1234: message
      const match = line.match(
        /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/,
      );
      if (match) {
        const [, filePath, lineNum, col, code, message] = match;
        const relPath = filePath.replace(root + "/", "");
        const title = `Unsafe index access in ${relPath}:${lineNum}`;
        const body = [
          `**File:** \`${relPath}\``,
          `**Line:** ${lineNum}, Column: ${col}`,
          `**Error:** \`${code}\` — ${message}`,
          "",
          `**Action:** Add a null/undefined check after the index access, or use optional chaining.`,
        ].join("\n");
        writeIssue("tsc-unchecked-index", "medium", title, body);
      } else {
        writeIssue(
          "tsc-unchecked-index",
          "medium",
          `tsc: ${line.slice(0, 80)}`,
          line,
        );
      }
    }
  }
  if (tscCount === 0) {
    console.log("  No unsafe index access issues found.");
  }
}

// ---------------------------------------------------------------------------
// 3. attw — Are The Types Wrong
// ---------------------------------------------------------------------------
console.log("\n🔍 Running attw (type correctness)...");
{
  // attw checks published packages — only core and cli have exports
  const publishable = [
    { name: "@apex-log-insights/core", dir: "packages/core" },
    { name: "@apex-log-insights/cli", dir: "packages/cli" },
    { name: "@apex-log-insights/mcp", dir: "packages/mcp" },
  ];

  let attwCount = 0;
  for (const pkg of publishable) {
    const raw = run(`npx attw --pack ${pkg.dir} 2>&1 || true`);

    if (/EPERM|operation not permitted|Command failed:\s*npm pack/i.test(raw)) {
      console.warn(
        `  Skipped ${pkg.name}: package archive could not be created in this environment.`,
      );
      continue;
    }

    // attw outputs problems as lines containing ✗ or "error" or "fail"
    const problemLines = raw
      .split("\n")
      .filter(
        (l) =>
          /✗|❌|fail|error|problem/i.test(l) &&
          !l.includes("npm warn") &&
          !l.includes("No problems found") &&
          !l.includes("EPERM") &&
          !l.includes("does not contain types") &&
          !l.includes("error while checking package"),
      );

    if (problemLines.length > 0) {
      for (const line of problemLines) {
        attwCount++;
        const trimmed = line
          .replace(
            /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
            "",
          )
          .trim();
        const title = `Type export issue in ${pkg.name}: ${trimmed.slice(0, 60)}`;
        const body = [
          `**Package:** \`${pkg.name}\``,
          `**Directory:** \`${pkg.dir}\``,
          `**Issue:** ${trimmed}`,
          "",
          `**Action:** Fix the \`exports\` field in package.json or the TypeScript declarations so consumers get correct types.`,
        ].join("\n");
        writeIssue("attw", "high", title, body);
      }
    }

    // Also capture the overall summary if it mentions issues
    if (raw.includes("No problems found")) {
      // all good for this package
    }
  }
  if (attwCount === 0) {
    console.log("  No type export issues found.");
  }
}

// ---------------------------------------------------------------------------
// 4. madge — circular dependencies
// ---------------------------------------------------------------------------
console.log("\n🔍 Running madge (circular dependencies)...");
{
  // Scan package bundles so erased type-only imports cannot be mistaken for
  // runtime cycles. Viewer modules have no build step and remain source-based.
  const targets = [
    { label: "packages/core", dir: "packages/core/dist", ext: "js,cjs" },
    { label: "packages/cli", dir: "packages/cli/dist", ext: "js" },
    { label: "packages/mcp", dir: "packages/mcp/dist", ext: "js" },
    { label: "viewer/modules", dir: "viewer/modules", ext: "js" },
  ];

  let madgeCount = 0;
  for (const target of targets) {
    const raw = run(
      `npx madge --circular --extensions ${target.ext} ${target.dir} 2>&1 || true`,
    );

    // madge outputs circular deps as: ✖ Found N circular dependencies
    // followed by lines like: 1) file-a.ts > file-b.ts > file-a.ts
    const circularLines = raw.split("\n").filter((l) => /^\s*\d+\)/.test(l));

    for (const line of circularLines) {
      madgeCount++;
      const trimmed = line.replace(/^\s*\d+\)\s*/, "").trim();

      // Check if this cycle is type-only (TS `import type` is erased at build time)
      let isTypeOnly = false;
      if (target.ext === "ts") {
        const files = trimmed.split(/\s*>\s*/);
        isTypeOnly = files.length >= 2;
        for (let i = 0; i < files.length && isTypeOnly; i++) {
          const importer = files[i];
          const imported = files[(i + 1) % files.length];
          // Check if the import from importer → imported is type-only
          const importerPath = resolve(root, target.dir, importer);
          try {
            const content = execSync(`cat "${importerPath}"`, {
              encoding: "utf8",
              cwd: root,
            });
            const baseName = imported.replace(/\.ts$/, "");
            const hasRuntimeImport = new RegExp(
              `^import\\s+(?!type\\s)[^;]*from\\s+['\"].*${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
              "m",
            ).test(content);
            if (hasRuntimeImport) isTypeOnly = false;
          } catch {
            isTypeOnly = false;
          }
        }
      }

      const severity = isTypeOnly ? "low" : "high";
      const typeNote = isTypeOnly ? " (type-only — no runtime impact)" : "";
      const title = `Circular dependency in ${target.dir}: ${trimmed.slice(0, 50)}`;
      const body = [
        `**Location:** \`${target.dir}\``,
        `**Cycle:** ${trimmed}`,
        `**Type-only:** ${isTypeOnly ? "Yes — uses `import type`, erased at build time" : "No — runtime circular dependency"}`,
        "",
        isTypeOnly
          ? `**Action:** Informational. This cycle only involves \`import type\` statements and has no runtime impact. Consider extracting shared types to a \`types.ts\` file to eliminate the static cycle.`
          : `**Action:** Break the cycle by extracting shared code into a separate module, or restructuring the imports.`,
      ].join("\n");
      writeIssue("madge", severity, title + typeNote, body);
    }
  }
  if (madgeCount === 0) {
    console.log("  No circular dependencies found.");
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  `\n✅ Bug scan complete — ${issueIndex} issue(s) written to bugs/\n`,
);

// ---------------------------------------------------------------------------
// Types (internal only)
// ---------------------------------------------------------------------------
interface KnipIssue {
  name?: string;
  path?: string;
  line?: number;
  symbols?: { symbol: string }[];
}

interface KnipFileIssue {
  file?: string;
  [category: string]: unknown;
}
