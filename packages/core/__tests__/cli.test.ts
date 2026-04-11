import { describe, it, expect } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFile = promisify(execFileCallback);

// Run the CLI bin.ts via tsx from the cli package directory
function runCli(args: string[]) {
  const cliDir = resolve(__dirname, '../../cli');
  return execFile(process.execPath, ['--import', 'tsx', 'src/bin.ts', ...args], {
    cwd: cliDir,
    maxBuffer: 10 * 1024 * 1024,
  });
}

// Fixture path helper — fixtures/ is at the repo root
const fixture = (name: string) => resolve(__dirname, '../../../fixtures', name);

describe('CLI', () => {
  it('prints usage and exits with code 1 when no arguments are given', async () => {
    await expect(runCli([])).rejects.toThrow();
  });

  it('prints usage when --help is passed', async () => {
    // --help exits cleanly (code 0) and prints usage to stderr
    let output = '';
    try {
      const result = await runCli(['--help']);
      output = result.stderr ?? result.stdout ?? '';
    } catch (err: unknown) {
      output = (err as { stderr?: string }).stderr ?? '';
    }
    expect(output).toMatch(/Usage:/);
  });

  it('rejects a non-existent log path', async () => {
    await expect(
      runCli(['/tmp/does-not-exist-at-all.log', '--no-open']),
    ).rejects.toThrow();
  });

  it('rejects --port without a value', async () => {
    await expect(
      runCli([fixture('simple.log'), '--port', '--no-open']),
    ).rejects.toThrow();
  });
});
