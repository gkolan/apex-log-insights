import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = resolve(__dirname, "..");
const extensionTestsPath = resolve(__dirname, "suite.cjs");
const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
const vscodeVersion = process.env.VSCODE_TEST_VERSION || "1.96.0";

async function main(): Promise<void> {
  const userDataDir = mkdtempSync(join(tmpdir(), "ali-vscode-"));
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(vscodeExecutablePath
        ? { vscodeExecutablePath }
        : { version: vscodeVersion }),
      launchArgs: ["--disable-extensions", `--user-data-dir=${userDataDir}`],
    });
  } catch (error) {
    console.error("VS Code Extension Host tests failed.", error);
    process.exitCode = 1;
  }
}

void main();
