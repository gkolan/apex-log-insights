type CloneTask =
  | { kind: "value"; value: unknown; assign: (value: unknown) => void }
  | { kind: "leave"; value: object };

function jsonPrimitive(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return null;
}

/**
 * Clone an untrusted JSON-like value without recursive traversal.
 *
 * Unsupported object properties are omitted, unsupported array entries and
 * circular references become `null`, and non-finite numbers become `null`.
 */
export function cloneJsonLike<T>(value: T): T {
  let result: unknown = null;
  const active = new WeakSet<object>();
  const tasks: CloneTask[] = [
    { kind: "value", value, assign: (next) => (result = next) },
  ];

  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "leave") {
      active.delete(task.value);
      continue;
    }

    const source = task.value;
    if (typeof source !== "object" || source === null) {
      task.assign(jsonPrimitive(source));
      continue;
    }
    if (active.has(source)) {
      task.assign(null);
      continue;
    }

    const target: unknown[] | Record<string, unknown> = Array.isArray(source)
      ? new Array(source.length).fill(null)
      : {};
    task.assign(target);
    active.add(source);
    tasks.push({ kind: "leave", value: source });

    const keys = Array.isArray(source)
      ? Array.from({ length: source.length }, (_, index) => String(index))
      : Object.keys(source);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      let child: unknown;
      try {
        child = (source as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      const supported =
        child === null ||
        typeof child === "string" ||
        typeof child === "boolean" ||
        typeof child === "number" ||
        typeof child === "object";
      if (!supported && !Array.isArray(target)) continue;
      tasks.push({
        kind: "value",
        value: child,
        assign: (next) => {
          if (Array.isArray(target)) {
            target[Number(key)] = next;
          } else {
            Object.defineProperty(target, key, {
              value: next,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          }
        },
      });
    }
  }

  return result as T;
}
