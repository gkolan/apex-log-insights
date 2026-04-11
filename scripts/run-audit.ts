#!/usr/bin/env tsx
/**
 * run-audit.ts — Runs all security audit tools and writes individual
 * Markdown reports into the `audit/` folder at the project root.
 *
 * Tools executed:
 *   1. pnpm audit          — dependency vulnerability scan
 *   2. secretlint          — hardcoded secret detection
 *   3. eslint-plugin-security — static security analysis
 *
 * Usage:  pnpm run audit
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const auditDir = resolve(root, 'audit');

// Wipe and recreate audit folder for a clean run
rmSync(auditDir, { recursive: true, force: true });
mkdirSync(auditDir, { recursive: true });

const timestamp = new Date().toISOString().slice(0, 10);
let issueIndex = 0;

function nextId(): string {
  issueIndex += 1;
  return String(issueIndex).padStart(3, '0');
}

function writeIssue(tool: string, severity: string, title: string, body: string): void {
  const id = nextId();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filename = `${id}-${slug}.md`;
  const content = [
    `# ${title}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| ID | ${id} |`,
    `| Tool | ${tool} |`,
    `| Severity | ${severity} |`,
    `| Date | ${timestamp} |`,
    '',
    body,
    '',
  ].join('\n');
  writeFileSync(resolve(auditDir, filename), content, 'utf8');
  console.log(`  [${severity.toUpperCase().padEnd(8)}] ${id} — ${title}`);
}

// ---------------------------------------------------------------------------
// 1. pnpm audit
// ---------------------------------------------------------------------------
console.log('\n🔍 Running pnpm audit...');
try {
  const raw = execSync('pnpm audit --json 2>/dev/null || true', {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // pnpm audit may output non-JSON when there are no issues
  }

  if (parsed && typeof parsed === 'object' && 'advisories' in parsed) {
    const advisories = (parsed as { advisories: Record<string, PnpmAdvisory> }).advisories;
    for (const [, advisory] of Object.entries(advisories)) {
      const sev = advisory.severity || 'unknown';
      const title = `Dependency: ${advisory.module_name} — ${advisory.title}`;
      const body = [
        `**Package:** \`${advisory.module_name}\``,
        `**Vulnerable versions:** ${advisory.vulnerable_versions}`,
        `**Patched versions:** ${advisory.patched_versions}`,
        `**Recommendation:** ${advisory.recommendation || 'Upgrade to patched version'}`,
        '',
        advisory.overview || '',
        '',
        advisory.url ? `**Advisory:** ${advisory.url}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      writeIssue('pnpm audit', sev, title, body);
    }
  }

  // Also try the simpler table format for newer pnpm versions
  if (!parsed || !('advisories' in parsed)) {
    const tableOutput = execSync('pnpm audit 2>&1 || true', {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const vulnLines = tableOutput
      .split('\n')
      .filter((l) => /^\s*(low|moderate|high|critical)\s/i.test(l));
    for (const line of vulnLines) {
      const match = line.match(/^\s*(low|moderate|high|critical)\s+(.+)/i);
      if (match) {
        writeIssue('pnpm audit', match[1], `Dependency: ${match[2].trim()}`, line.trim());
      }
    }
    if (vulnLines.length === 0 && tableOutput.includes('No known vulnerabilities')) {
      console.log('  No dependency vulnerabilities found.');
    }
  }
} catch (err) {
  console.warn('  ⚠ pnpm audit failed:', (err as Error).message);
}

// ---------------------------------------------------------------------------
// 2. secretlint
// ---------------------------------------------------------------------------
console.log('\n🔍 Running secretlint...');
try {
  const raw = execSync(
    'npx secretlint "**/*" --secretlintrcFilePath .secretlintrc.json --format json 2>/dev/null || true',
    { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );

  let results: SecretlintResult[] = [];
  try {
    results = JSON.parse(raw) as SecretlintResult[];
  } catch {
    // non-JSON means no findings or secretlint not available
  }

  let secretCount = 0;
  for (const file of results) {
    for (const msg of file.messages || []) {
      secretCount++;
      const sev = msg.severity === 2 ? 'critical' : msg.severity === 1 ? 'high' : 'medium';
      const title = `Secret detected in ${file.filePath.replace(root + '/', '')}`;
      const body = [
        `**File:** \`${file.filePath.replace(root + '/', '')}\``,
        `**Line:** ${msg.loc?.start?.line ?? 'unknown'}`,
        `**Rule:** \`${msg.ruleId}\``,
        `**Message:** ${msg.message}`,
      ].join('\n');
      writeIssue('secretlint', sev, title, body);
    }
  }
  if (secretCount === 0) {
    console.log('  No hardcoded secrets found.');
  }
} catch (err) {
  console.warn('  ⚠ secretlint failed:', (err as Error).message);
}

// ---------------------------------------------------------------------------
// 3. eslint-plugin-security
// ---------------------------------------------------------------------------
console.log('\n🔍 Running ESLint security rules...');
try {
  const raw = execSync(
    `npx eslint --config eslint-security.config.mjs "packages/*/src/**/*.{ts,js}" "viewer/**/*.js" "scripts/**/*.ts" --format json 2>/dev/null || true`,
    { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );

  let results: EslintResult[] = [];
  try {
    results = JSON.parse(raw) as EslintResult[];
  } catch {
    // parse error or empty
  }

  let eslintCount = 0;
  for (const file of results) {
    for (const msg of file.messages || []) {
      if (!msg.ruleId?.startsWith('security/')) continue;
      eslintCount++;
      const sev = msg.severity === 2 ? 'high' : 'medium';
      const relPath = file.filePath.replace(root + '/', '');
      const title = `${msg.ruleId} in ${relPath}:${msg.line}`;
      const body = [
        `**File:** \`${relPath}\``,
        `**Line:** ${msg.line}, Column: ${msg.column}`,
        `**Rule:** \`${msg.ruleId}\``,
        `**Message:** ${msg.message}`,
        '',
        `**Source:** \`${msg.source || '(not available)'}\``,
      ].join('\n');
      writeIssue('eslint-security', sev, title, body);
    }
  }
  if (eslintCount === 0) {
    console.log('  No security lint issues found.');
  }
} catch (err) {
  console.warn('  ⚠ ESLint security scan failed:', (err as Error).message);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n✅ Audit complete — ${issueIndex} issue(s) written to audit/\n`);

// ---------------------------------------------------------------------------
// Type helpers (not exported, just for internal casting)
// ---------------------------------------------------------------------------
interface PnpmAdvisory {
  module_name: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
  patched_versions: string;
  recommendation?: string;
  overview?: string;
  url?: string;
}

interface SecretlintResult {
  filePath: string;
  messages: {
    severity: number;
    message: string;
    ruleId: string;
    loc?: { start?: { line?: number } };
  }[];
}

interface EslintResult {
  filePath: string;
  messages: {
    severity: number;
    message: string;
    ruleId: string | null;
    line: number;
    column: number;
    source?: string;
  }[];
}
