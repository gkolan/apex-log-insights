import { describe, it, expect } from "vitest";
import {
  execFile as execFileCallback,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFile = promisify(execFileCallback);

// Run the CLI bin.ts via tsx from the cli package directory
function runCli(args: string[]) {
  const cliDir = resolve(__dirname, "../../cli");
  return execFile(
    process.execPath,
    ["--import", "tsx", "src/bin.ts", ...args],
    {
      cwd: cliDir,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

// Fixture path helper — fixtures/ is at the repo root
const fixture = (name: string) => resolve(__dirname, "../../../fixtures", name);

async function startCliServer(target: string): Promise<{
  child: ChildProcess;
  baseUrl: string;
}> {
  const cliDir = resolve(__dirname, "../../cli");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/bin.ts", target, "--port", "0", "--no-open"],
    { cwd: cliDir, stdio: ["ignore", "pipe", "pipe"] },
  );

  const baseUrl = await new Promise<string>((resolveUrl, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`CLI server did not start. Output:\n${output}`));
    }, 10_000);

    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolveUrl(match[1]);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`CLI server exited with ${code}. Output:\n${output}`));
      }
    });
  });

  return { child, baseUrl };
}

async function stopCliServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => {
    child.once("exit", () => resolveExit());
  });
  child.kill("SIGTERM");
  await exited;
}

describe("CLI", () => {
  it("prints usage and exits with code 1 when no arguments are given", async () => {
    await expect(runCli([])).rejects.toThrow();
  });

  it("prints usage when --help is passed", async () => {
    // --help exits cleanly (code 0) and prints usage to stderr
    let output = "";
    try {
      const result = await runCli(["--help"]);
      output = result.stderr ?? result.stdout ?? "";
    } catch (err: unknown) {
      output = (err as { stderr?: string }).stderr ?? "";
    }
    expect(output).toMatch(/Usage:/);
  });

  it("rejects a non-existent log path", async () => {
    await expect(
      runCli(["/tmp/does-not-exist-at-all.log", "--no-open"]),
    ).rejects.toThrow();
  });

  it("rejects --port without a value", async () => {
    await expect(
      runCli([fixture("simple.log"), "--port", "--no-open"]),
    ).rejects.toThrow();
  });

  it("rejects unknown options", async () => {
    await expect(runCli([fixture("simple.log"), "--pretty"])).rejects.toThrow();
  });

  it("rejects existing files that are not .log files", async () => {
    const packageJson = resolve(__dirname, "../../../package.json");
    await expect(runCli([packageJson, "--no-open"])).rejects.toThrow();
  });

  it("serves the viewer and only the selected log in single-file mode", async () => {
    const selectedLog = fixture("simple.log");
    const { child, baseUrl } = await startCliServer(selectedLog);

    try {
      const viewerResponse = await fetch(`${baseUrl}/`);
      expect(viewerResponse.status).toBe(200);
      expect(await viewerResponse.text()).toMatch(/Apex Log Insights/);

      const selectedResponse = await fetch(`${baseUrl}/logs/simple.log`);
      expect(selectedResponse.status).toBe(200);

      const siblingLogResponse = await fetch(
        `${baseUrl}/logs/webstore-demo-opportunity-trigger.log`,
      );
      expect(siblingLogResponse.status).toBe(404);

      const nonLogResponse = await fetch(`${baseUrl}/logs/README.md`);
      expect(nonLogResponse.status).toBe(404);

      const listResponse = await fetch(`${baseUrl}/api/logs`);
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toEqual([
        expect.objectContaining({ name: "simple.log" }),
      ]);

      const healthResponse = await fetch(`${baseUrl}/api/health`);
      expect(await healthResponse.json()).toEqual({
        status: "ok",
        mode: "single-file",
        capabilities: {
          listLogs: true,
          readLogs: true,
          serverSideParsing: false,
        },
      });

      const postResponse = await fetch(`${baseUrl}/api/logs`, {
        method: "POST",
      });
      expect(postResponse.status).toBe(405);
      expect(postResponse.headers.get("allow")).toBe("GET, HEAD");

      const headResponse = await fetch(`${baseUrl}/logs/simple.log`, {
        method: "HEAD",
      });
      expect(headResponse.status).toBe(200);
      expect(await headResponse.text()).toBe("");

      expect(viewerResponse.headers.get("x-content-type-options")).toBe(
        "nosniff",
      );
    } finally {
      await stopCliServer(child);
    }
  });
});
