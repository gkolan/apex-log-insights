import { describe, expect, it } from "vitest";
import { documentationBoundaryIssues } from "../scripts/documentation-boundary.js";

describe("public documentation boundaries", () => {
  it("permits external references whose URL happens to contain reports", () => {
    expect(
      documentationBoundaryIssues(
        "docs/development/testing.md",
        "[External report](https://example.com/reports/result)",
      ),
    ).toEqual([]);
  });

  it("rejects a single unresolved parent path in a repository URL", () => {
    expect(
      documentationBoundaryIssues(
        "packages/vscode-ext/README.md",
        "[Images](https://github.com/gkolan/apex-log-insights/blob/main/../assets/images/README.md)",
      ),
    ).toHaveLength(1);
  });
  it("rejects reviewer results in user pages but permits contributor procedures", () => {
    const text = "# Analysis\n\n## Accessibility audit\n\nAll gates passed.\n";
    expect(
      documentationBoundaryIssues("packages/vscode-ext/README.md", text),
    ).toHaveLength(1);
    expect(
      documentationBoundaryIssues("docs/development/testing.md", text),
    ).toEqual([]);
  });

  it("preserves product diagnostics and user verification instructions", () => {
    expect(
      documentationBoundaryIssues(
        "docs/user-guides/example.md",
        "# Analyze\n\n## Verify your result\n\nReview the log quality warning.\n",
      ),
    ).toEqual([]);
  });

  it("rejects links to local evidence from any public page", () => {
    expect(
      documentationBoundaryIssues(
        "docs/development/testing.md",
        "[Result](../../reports/run.json)",
      ),
    ).toHaveLength(1);
  });

  it("requires package-safe links in the VS Code README", () => {
    expect(
      documentationBoundaryIssues(
        "packages/vscode-ext/README.md",
        "[Screenshots](../../assets/images/README.md)",
      ),
    ).toHaveLength(1);
    expect(
      documentationBoundaryIssues(
        "packages/vscode-ext/README.md",
        "[Screenshots](https://github.com/gkolan/apex-log-insights/blob/main/assets/images/README.md)",
      ),
    ).toEqual([]);
  });

  it("rejects the broken parent-path form emitted by packaging", () => {
    expect(
      documentationBoundaryIssues(
        "packages/vscode-ext/README.md",
        "[Images](https://github.com/gkolan/apex-log-insights/blob/HEAD/../../assets/images/README.md)",
      ),
    ).toHaveLength(1);
  });
});
