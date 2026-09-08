# Development documentation

Use this bucket to understand how the project is built, how its documentation is written, and how releases are produced.

| Goal                                                    | Guide                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Find the layer and source file that owns a behavior     | [Architecture](architecture.md)                             |
| Structure documentation around purpose and reader tasks | [Documentation standard](documentation-standard.md)         |
| Write direct, natural, evidence-based prose             | [Writing guide](writing-guide.md)                           |
| Choose regression tests and review coverage             | [Testing and coverage](testing.md)                          |
| Validate, version, package, and publish a release       | [Release guide](releasing.md)                               |
| Understand the VS Code host contract and design         | [VS Code extension specification](vscode-extension-spec.md) |

Point-in-time release reviews, implementation plans, and audit evidence are kept locally under ignored `internal/` or `reports/`, not in public navigation. Store-submission instructions are in the [browser store guide](../../packages/browser-ext/store/README.md).

Repository setup, testing, and contribution workflow remain in [CONTRIBUTING.md](../../CONTRIBUTING.md). Code conventions remain in the [style guide](../../STYLE_GUIDE.md).

## Related

- [Build and package browser extensions](browser-extension.md)

- [Documentation home](../README.md)
- [Contributing](../../CONTRIBUTING.md)
- [Project terminology](../reference/terminology.md)
