import { describe, expect, it } from "vitest";

import { auditDocumentationPage } from "../scripts/audit-docs.js";

const completePage = `# Analyze a log

Use this guide to analyze a synthetic Apex debug log and verify the resulting evidence without exposing production data.

## Run the analysis

1. Open a synthetic log.
2. Select **Analyze**.

## Related

- [Documentation](../README.md)
`;

describe("documentation quality audit", () => {
  it("accepts a concise task page with an outcome and final navigation", () => {
    expect(
      auditDocumentationPage("docs/user-guides/analyze.md", completePage),
    ).toMatchObject({ score: 10 });
  });

  it("reports missing navigation and unlabeled code fences", () => {
    const result = auditDocumentationPage(
      "docs/user-guides/analyze.md",
      completePage
        .replace(/## Related[\s\S]+$/, "")
        .replace("1. Open a synthetic log.", "```\nexample\n```"),
    );
    expect(
      result.checks.find(
        (check) => check.name === "final navigation is easy to find",
      )?.passed,
    ).toBe(false);
    expect(
      result.checks.find(
        (check) => check.name === "code fences identify their language",
      )?.passed,
    ).toBe(false);
  });

  it("rejects long prose and em dashes", () => {
    const longParagraph = Array.from({ length: 121 }, () => "word").join(" ");
    const result = auditDocumentationPage(
      "docs/reference/example.md",
      completePage.replace("1. Open a synthetic log.", `${longParagraph} —`),
    );
    expect(
      result.checks.find((check) => check.name === "paragraphs are concise")
        ?.passed,
    ).toBe(false);
    expect(
      result.checks.find((check) => check.name === "prose avoids em dashes")
        ?.passed,
    ).toBe(false);
  });
});
