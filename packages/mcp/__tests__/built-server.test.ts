import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The unit tests import from `src/`, so a malformed build artifact reaches
 * users untested. A duplicated shebang once made the published server fail to
 * start on every invocation. These checks run against `dist/` when it exists.
 */
const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const built = existsSync(serverPath);

describe.skipIf(!built)("built MCP server entry point", () => {
  it("declares exactly one shebang, on the first line", () => {
    const lines = readFileSync(serverPath, "utf8").split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env node");
    expect(lines.filter((line) => line.startsWith("#!"))).toHaveLength(1);
  });

  it("parses as valid JavaScript", () => {
    expect(() =>
      execFileSync(process.execPath, ["--check", serverPath], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
