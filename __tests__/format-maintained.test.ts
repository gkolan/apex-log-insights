import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isMaintainedFormatFile,
  listMaintainedFormatFiles,
  prettierArguments,
} from "../scripts/format-maintained.js";

describe("maintained formatting scope", () => {
  it("includes parser, host, test, script, configuration, and documentation files", () => {
    expect(isMaintainedFormatFile("packages/core/src/parserCore.ts")).toBe(
      true,
    );
    expect(isMaintainedFormatFile("packages/cli/src/server.test.ts")).toBe(
      true,
    );
    expect(
      isMaintainedFormatFile(
        "packages/vscode-ext/scripts/assemble-webview.mjs",
      ),
    ).toBe(true);
    expect(isMaintainedFormatFile("vitest.config.mts")).toBe(true);
    expect(isMaintainedFormatFile("docs/development/testing.md")).toBe(true);
    expect(isMaintainedFormatFile(".github/workflows/validate.yml")).toBe(true);
  });

  it("excludes generated, UI-only, research, lock, and unsupported files", () => {
    expect(isMaintainedFormatFile("viewer/apex-parser-worker.js")).toBe(false);
    expect(isMaintainedFormatFile("viewer/modules/render-report.js")).toBe(
      false,
    );
    expect(isMaintainedFormatFile("packages/browser-ext/shared/app.js")).toBe(
      false,
    );
    expect(
      isMaintainedFormatFile("packages/vscode-ext/webview/vscode-adapter.js"),
    ).toBe(false);
    expect(isMaintainedFormatFile("research/report.md")).toBe(false);
    expect(isMaintainedFormatFile("pnpm-lock.yaml")).toBe(false);
    expect(isMaintainedFormatFile("docs/releases/archive.zip")).toBe(false);
  });

  it("discovers existing tracked and untracked maintained files from Git", () => {
    const files = listMaintainedFormatFiles(process.cwd());
    expect(files).toContain("scripts/format-maintained.ts");
    expect(files).toContain("__tests__/format-maintained.test.ts");
    expect(files).not.toContain("package-lock.json");
    expect(files).not.toContain("viewer/apex-parser-worker.js");
  });

  it("passes hostile-looking filenames after the option terminator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "apex-log-format-"));
    try {
      const fileName = "--config=missing.ts";
      await writeFile(join(directory, fileName), "export const value = 1;\n");
      const executable = resolve(
        process.cwd(),
        "node_modules",
        ".bin",
        process.platform === "win32" ? "prettier.cmd" : "prettier",
      );
      const args = prettierArguments("--check", [fileName]);
      expect(args).toEqual(["--check", "--", fileName]);

      const result = spawnSync(executable, args, {
        cwd: directory,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
