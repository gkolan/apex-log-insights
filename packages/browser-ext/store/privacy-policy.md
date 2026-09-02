# Privacy policy for Apex Log Insights

_Last updated: August 1, 2026_

This policy explains what the browser extension reads, processes, stores, and transmits. Read it before loading a production Apex debug log. The goal is to make the extension's local-processing and local-storage boundaries explicit.

## Summary

Apex Log Insights parses logs inside the browser extension. The extension does not send log content, reports, preferences, or usage information to the developer, an analytics provider, or another application service.

The extension does store preferences and may retain the active log or report in the browser profile so the analyzer can restore it after refresh. Local storage is not the same as collection by the developer, but it can still contain sensitive information on the device.

## Information the extension processes

When the user opens or selects an Apex debug log, the extension may process:

- the complete raw log;
- file name, size, and source URL;
- parsed report fields, findings, and raw-line evidence;
- sibling `.log` file names and timestamps when file-sidebar discovery is enabled;
- redaction names entered by the user;
- theme, navigation, Log Explorer, and sidebar preferences.

Apex debug logs may contain Salesforce IDs, names, email addresses, field values, query values, endpoints, debug messages, and other business information.

## Processing and transmission

Parsing runs in a Web Worker packaged with the extension. Apex Log Insights does not upload the log or parsed report.

The browser still performs its normal operations, including extension installation, updates, safe-browsing checks, and requests for a web-hosted `.log` URL. Those browser or website operations are outside Apex Log Insights log processing.

## Local storage

The extension uses `chrome.storage.local` and, where available, `chrome.storage.session`.

Stored values can include:

- the active raw log or report and its source URL;
- interface and redaction preferences;
- locally discovered sibling-log names and timestamps;
- the active file name and sidebar state.

The extension retains no more than the five most recently opened log payloads. A payload may remain after its analyzer tab closes so that refreshing the tab still works. Opening additional logs removes the oldest cached payloads. Clearing extension data or uninstalling the extension removes all retained payloads.

To remove cached logs while keeping preferences, open the extension popup and select **Clear cached logs**. Clearing all extension data through the browser or uninstalling the extension removes cached logs and preferences.

## Redaction

The Log Explorer can mask recognized email addresses, Salesforce IDs, phone numbers, and names supplied by the user before copying text.

Redaction is pattern-based. It may miss sensitive text or mask text that is not sensitive. It does not alter the stored source log. Review copied content before sharing it.

## Permissions

| Permission    | Purpose                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tabs`        | Recognizes `.log` tabs, opens the analyzer, and supports user-initiated local-file navigation.                          |
| `storage`     | Stores the active analyzer payload, source information, preferences, and optional sidebar state in the browser profile. |
| `scripting`   | Reads links from a local directory-listing tab after the user enables sibling-log discovery.                            |
| `*://*/*.log` | Lets the content script recognize web-hosted `.log` URLs.                                                               |
| `file:///*`   | Lets the extension handle local `.log` URLs after the user grants browser file access.                                  |

## Data collection and third parties

Apex Log Insights has no account system, analytics, advertising, telemetry, or crash-reporting service. The extension does not sell or share user data.

## Changes to this policy

Update this policy when storage, permissions, network behavior, redaction, or third-party services change. The new date must match the extension submission that contains the change.

## Contact

Open a question or bug at the [project issue tracker](https://github.com/gkolan/apex-log-insights/issues). Do not attach an unreviewed production log or other sensitive content.
