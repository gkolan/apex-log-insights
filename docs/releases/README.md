# Browser-extension releases

This folder contains browser-extension build archives for release review and temporary development loading. Packages are grouped by browser so users can identify the correct file without opening an archive.

Read [Apex Log Insights 1.2.0](1.2.0.md) for the features, parser corrections, privacy boundaries, known limitations, and candidate packages included in this release.

## Choose a package

| Browser         | Folder               | Package format |
| --------------- | -------------------- | -------------- |
| Google Chrome   | [chrome/](chrome/)   | `.zip`         |
| Microsoft Edge  | [edge/](edge/)       | `.zip`         |
| Mozilla Firefox | [firefox/](firefox/) | `.xpi`         |

For normal installation, prefer the browser store links in the [browser-extension guide](../../packages/browser-ext/README.md). These files support release review, manual testing, and approved distribution workflows.

Do not edit an archive by hand. Follow the [release guide](../development/releasing.md); the export script builds each package and copies it into the correct folder.

## Related

- [Apex Log Insights 1.2.0](1.2.0.md)
- [Release guide](../development/releasing.md)
- [Browser-extension guide](../../packages/browser-ext/README.md)
