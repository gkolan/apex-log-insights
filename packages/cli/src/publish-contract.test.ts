import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageJson(): {
  dependencies?: Record<string, string>;
  scripts: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
}

/** Bare specifiers left in a bundle, ignoring relative paths and Node built-ins. */
function externalBareImports(code: string): string[] {
  const found = new Set<string>();
  const pattern =
    /(?:^|[\s;}])(?:import|export)[^'"]*?from\s*["']([^"']+)["']/g;
  for (const match of code.matchAll(pattern)) {
    const specifier = match[1] as string;
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    if (specifier.startsWith("node:")) continue;
    found.add(specifier);
  }
  return [...found].sort();
}

describe("published CLI artifact", () => {
  // The tarball ships only `dist`, so anything the bundle still imports at
  // runtime must be a declared dependency. `--packages=external` once left
  // `@apex-log-insights/core` — a devDependency — as a bare import, which made
  // the installed `apex-log` binary fail with ERR_MODULE_NOT_FOUND.
  it("does not mark workspace packages external in the build script", () => {
    const { scripts } = readPackageJson();

    expect(scripts["build"]).not.toContain("--packages=external");
    expect(scripts["build"]).not.toMatch(/--external:@apex-log-insights/);
  });

  it("bundles every undeclared package into the binary entry point", async () => {
    const result = await build({
      entryPoints: [join(packageDir, "src/bin.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      alias: {
        // Aliased to source so the check does not depend on a prior
        // `pnpm build` having produced packages/core/dist.
        "@apex-log-insights/core": resolve(packageDir, "../core/src/index.ts"),
      },
    });

    const declared = Object.keys(readPackageJson().dependencies ?? {});
    const bundled = result.outputFiles[0]?.text ?? "";
    const undeclared = externalBareImports(bundled).filter(
      (specifier) => !declared.includes(specifier),
    );

    expect(bundled).not.toBe("");
    expect(undeclared).toEqual([]);
  });
});
