#!/usr/bin/env tsx
/** Scores maintained docs against the repository's structural writing standard. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DocumentationCheck {
  name: string;
  passed: boolean;
}

export interface DocumentationAuditResult {
  file: string;
  score: number;
  checks: DocumentationCheck[];
}

const NAVIGATION_HEADING =
  /^## (Related|Related documentation|Related guides|Next steps|See also)$/gm;

function stripNonProse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^>.*$/gm, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*[-*]\s+.*$/gm, "")
    .replace(/^\s*\[[ xX]\]\s+.*$/gm, "")
    .replace(/^\s*\d+\.\s+.*$/gm, "");
}

function openingWordCount(markdown: string): number {
  return markdown
    .replace(/^# .+\n+/, "")
    .split(/^##\s/m, 1)[0]!
    .replace(/[`*_>#\[\]()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasPurposefulOpening(markdown: string): boolean {
  const opening = markdown.replace(/^# .+\n+/, "").split(/^##\s/m, 1)[0]!;
  return /\b(use|learn|choose|start|look up|configure|create|install|run|integrate|review|verify|reference|describes?|explains?|shows?|records?|defines?)\b/i.test(
    opening,
  );
}

function headingsAreOrdered(markdown: string): boolean {
  const levels = [...markdown.matchAll(/^(#{1,6})\s+.+$/gm)].map(
    (match) => match[1]!.length,
  );
  if (levels.length < 2 || levels[0] !== 1) return false;
  return levels.every(
    (level, index) => index === 0 || level <= levels[index - 1]! + 1,
  );
}

function paragraphsAreConcise(markdown: string): boolean {
  return stripNonProse(markdown)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .every((paragraph) => paragraph.split(/\s+/).length <= 120);
}

function tableColumnCount(row: string): number {
  return row
    .replaceAll("&#124;", "")
    .replaceAll("\\|", "")
    .split("|")
    .slice(1, -1).length;
}

function tablesAreReadable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (
      !/^\|.*\|$/.test(lines[index]!) ||
      !/^\|[ :|-]+\|$/.test(lines[index + 1]!)
    ) {
      continue;
    }
    const columns = tableColumnCount(lines[index]!);
    if (columns > 6) return false;
    let row = index + 2;
    while (row < lines.length && /^\|.*\|$/.test(lines[row]!)) {
      if (tableColumnCount(lines[row]!) !== columns) return false;
      row += 1;
    }
  }
  return true;
}

function codeFencesAreLabeled(markdown: string): boolean {
  let insideFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("```")) continue;
    if (!insideFence && !/^```[A-Za-z0-9_-]+\s*$/.test(line)) return false;
    insideFence = !insideFence;
  }
  return !insideFence;
}

function hasFinalNavigation(file: string, markdown: string): boolean {
  if (file === "docs/README.md") return true;
  const matches = [...markdown.matchAll(NAVIGATION_HEADING)];
  const finalMatch = matches.at(-1);
  return Boolean(
    finalMatch?.index && finalMatch.index >= markdown.length * 0.65,
  );
}

function proseAvoidsEmDashes(markdown: string): boolean {
  return !markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\*\*[^*\n]+\*\*/g, "")
    .includes("—");
}

export function auditDocumentationPage(
  file: string,
  markdown: string,
): DocumentationAuditResult {
  const titleCount = [...markdown.matchAll(/^#\s+.+$/gm)].length;
  const checks: DocumentationCheck[] = [
    { name: "one clear page title", passed: titleCount === 1 },
    {
      name: "substantive reader-oriented opening",
      passed: openingWordCount(markdown) >= 12,
    },
    {
      name: "purpose or outcome is explicit",
      passed: hasPurposefulOpening(markdown),
    },
    {
      name: "heading hierarchy matches the page structure",
      passed: headingsAreOrdered(markdown),
    },
    {
      name: "page provides an actionable aid",
      passed:
        /^\d+\.\s+/m.test(markdown) ||
        /^\|.*\|$/m.test(markdown) ||
        /^```\w+/m.test(markdown) ||
        /^[-*]\s+/m.test(markdown),
    },
    { name: "paragraphs are concise", passed: paragraphsAreConcise(markdown) },
    {
      name: "tables are structurally readable",
      passed: tablesAreReadable(markdown),
    },
    {
      name: "code fences identify their language",
      passed: codeFencesAreLabeled(markdown),
    },
    {
      name: "final navigation is easy to find",
      passed: hasFinalNavigation(file, markdown),
    },
    { name: "prose avoids em dashes", passed: proseAvoidsEmDashes(markdown) },
  ];
  return {
    file,
    score: checks.filter((check) => check.passed).length,
    checks,
  };
}

function walkMarkdown(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? walkMarkdown(path)
      : name.endsWith(".md")
        ? [path]
        : [];
  });
}

function main(): void {
  const scriptDirectory = resolve(fileURLToPath(import.meta.url), "..");
  const root = resolve(scriptDirectory, "..");
  const docsRoot = resolve(root, "docs");
  const results = walkMarkdown(docsRoot)
    .sort()
    .map((path) =>
      auditDocumentationPage(
        relative(root, path).replaceAll("\\", "/"),
        readFileSync(path, "utf8"),
      ),
    );
  const failures = results.filter((result) => result.score < 10);
  for (const result of failures) {
    const missed = result.checks
      .filter((check) => !check.passed)
      .map((check) => check.name)
      .join("; ");
    console.error(`${result.file}: ${result.score}/10 - ${missed}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `Documentation quality audit passed: ${results.length} pages, 10/10 minimum.`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}
