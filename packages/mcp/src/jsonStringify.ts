type JsonTask =
  | { kind: "value"; value: unknown; depth: number; arraySlot: boolean }
  | { kind: "text"; value: string }
  | { kind: "leave"; value: object };

function isUnsupported(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  );
}

/**
 * Serialize JSON-like tool output without depending on the JavaScript call stack.
 * Circular references become null, matching the repository's report boundary.
 */
export function stringifyJson(value: unknown, indentSize = 2): string {
  const width = Math.max(0, Math.min(10, Math.floor(indentSize)));
  // Pretty indentation is visual metadata, not report data. Cap its growth so
  // an adversarially deep value cannot make whitespace output quadratic.
  const indent = (depth: number) => " ".repeat(Math.min(depth, 20) * width);
  const active = new WeakSet<object>();
  const chunks: string[] = [];
  const tasks: JsonTask[] = [
    { kind: "value", value, depth: 0, arraySlot: true },
  ];

  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "text") {
      chunks.push(task.value);
      continue;
    }
    if (task.kind === "leave") {
      active.delete(task.value);
      continue;
    }

    const current = task.value;
    if (current === null || isUnsupported(current)) {
      chunks.push("null");
    } else if (typeof current === "string") {
      chunks.push(JSON.stringify(current));
    } else if (typeof current === "number") {
      chunks.push(Number.isFinite(current) ? String(current) : "null");
    } else if (typeof current === "boolean") {
      chunks.push(current ? "true" : "false");
    } else if (typeof current === "bigint") {
      throw new TypeError("Do not know how to serialize a BigInt");
    } else if (typeof current !== "object") {
      chunks.push(task.arraySlot ? "null" : "");
    } else if (active.has(current)) {
      chunks.push("null");
    } else {
      active.add(current);
      tasks.push({ kind: "leave", value: current });

      if (Array.isArray(current)) {
        if (current.length === 0) {
          chunks.push("[]");
          continue;
        }
        chunks.push("[");
        if (width > 0) chunks.push("\n");
        tasks.push({
          kind: "text",
          value: `${width > 0 ? `\n${indent(task.depth)}` : ""}]`,
        });
        for (let index = current.length - 1; index >= 0; index -= 1) {
          if (index < current.length - 1) {
            tasks.push({ kind: "text", value: width > 0 ? ",\n" : "," });
          }
          tasks.push({
            kind: "value",
            value: current[index],
            depth: task.depth + 1,
            arraySlot: true,
          });
          if (width > 0) {
            tasks.push({
              kind: "text",
              value: indent(task.depth + 1),
            });
          }
        }
        continue;
      }

      const entries: Array<[string, unknown]> = [];
      for (const key of Object.keys(current)) {
        let child: unknown;
        try {
          child = (current as Record<string, unknown>)[key];
        } catch {
          continue;
        }
        if (!isUnsupported(child)) entries.push([key, child]);
      }
      if (entries.length === 0) {
        chunks.push("{}");
        continue;
      }
      chunks.push("{");
      if (width > 0) chunks.push("\n");
      tasks.push({
        kind: "text",
        value: `${width > 0 ? `\n${indent(task.depth)}` : ""}}`,
      });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]!;
        if (index < entries.length - 1) {
          tasks.push({ kind: "text", value: width > 0 ? ",\n" : "," });
        }
        tasks.push({
          kind: "value",
          value: child,
          depth: task.depth + 1,
          arraySlot: false,
        });
        tasks.push({
          kind: "text",
          value: `${width > 0 ? indent(task.depth + 1) : ""}${JSON.stringify(key)}:${width > 0 ? " " : ""}`,
        });
      }
    }
  }

  return chunks.join("");
}
