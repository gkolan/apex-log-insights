/**
 * Apex Log Insights — CLI argument helpers.
 *
 * Pure functions shared by the CLI entry point. They are kept out of `bin.ts`
 * because that module launches the server as soon as it is imported.
 */

/** Whether `flag` appears in `args`. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** The value following `flag`, or `undefined` when the flag is absent. */
export function getFlagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const next = args[i + 1];
  if (next === undefined || next.startsWith("-")) {
    throw new Error(
      `Flag ${flag} requires a value but got: ${next === undefined ? "nothing" : next}`,
    );
  }
  return next;
}

/**
 * Positional arguments, excluding flags and the value consumed by `--port`.
 *
 * When `--port` is absent its index is -1, so the consumed-value index must
 * stay -1 as well. Deriving it as `indexOf("--port") + 1` instead discarded
 * the argument at index 0 — the log path in the documented `apex-log <file>`
 * invocation.
 */
export function positionalArgs(args: string[]): string[] {
  const portIndex = args.indexOf("--port");
  const portValueIndex = portIndex === -1 ? -1 : portIndex + 1;
  return args.filter(
    (arg, index) => !arg.startsWith("-") && index !== portValueIndex,
  );
}
