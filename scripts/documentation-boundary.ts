/** Public-document rules shared by the link checker and focused regressions. */
export function documentationBoundaryIssues(
  file: string,
  markdown: string,
): string[] {
  const issues: string[] = [];
  const userPage =
    file === "README.md" ||
    file === "docs/README.md" ||
    /^docs\/(?:user-guides|reference|releases)\//.test(file) ||
    /^packages\/[^/]+\/README\.md$/.test(file) ||
    file === "assets/images/README.md";
  if (
    userPage &&
    /^#{1,6} (?:Verification record|Validation performed|Accessibility audit|Accessibility verification|Editorial score|Release gate results)\s*$/im.test(
      markdown,
    )
  ) {
    issues.push(
      "move contributor audit results and reviewer instructions out of user-facing documentation",
    );
  }
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!;
    const repositoryPath = target.match(
      /^https:\/\/github\.com\/gkolan\/apex-log-insights\/blob\/(?:main|HEAD)\/(.+)$/,
    )?.[1];
    const localPath =
      repositoryPath ?? (/^[a-z][a-z0-9+.-]*:/i.test(target) ? null : target);
    if (
      localPath &&
      /(?:^|\/)(?:internal|reports|evidence|tasks)\//.test(localPath)
    ) {
      issues.push(
        "public documentation must not link to local-only evidence: " + target,
      );
    }
    if (
      file === "packages/vscode-ext/README.md" &&
      !/^(?:https:\/\/|mailto:|#)/.test(target)
    ) {
      issues.push(
        "VS Code README links must survive Marketplace packaging: " + target,
      );
    }
    if (repositoryPath?.split("/").includes("..")) {
      issues.push(
        "repository link contains an unresolved parent path: " + target,
      );
    }
  }
  return issues;
}
