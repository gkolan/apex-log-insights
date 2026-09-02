import { describe, expect, it } from "vitest";

import { ApexLogParser } from "../src/certinia/ApexLogParser.js";

describe("ApexLogParser reuse", () => {
  it("does not carry errors or namespaces into the next parse", () => {
    const parser = new ApexLogParser();
    const first = parser.parse(
      [
        "10:00:00.0 (1)|UNSUPPORTED_EVENT|[1]|first",
        "10:00:00.1 (2)|METHOD_ENTRY|[1]|01p|managed.Sample.run()",
        "10:00:00.2 (3)|METHOD_EXIT|[1]|01p|managed.Sample.run()",
      ].join("\n"),
    );

    expect(first.parsingErrors).toContain(
      "Unsupported log event name: UNSUPPORTED_EVENT",
    );
    expect(
      first.children.some((event) => event.type === "UNSUPPORTED_EVENT"),
    ).toBe(true);

    const second = parser.parse(
      [
        "10:01:00.0 (1)|EXECUTION_STARTED",
        "10:01:00.1 (2)|EXECUTION_FINISHED",
      ].join("\n"),
    );

    expect(second.parsingErrors).toEqual([]);
    expect(second.logIssues).toEqual([]);
    expect(second.logIssueOverflowCount).toBe(0);
    expect(second.namespaces).toEqual(["default"]);
    expect(second.namespaces).not.toContain("managed");
  });
});
