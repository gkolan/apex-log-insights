# Privacy Policy — Apex Log Insights

*Last updated: March 2026*

---

## Summary

Apex Log Insights does not collect, transmit, or store any personal data or log content. All analysis runs locally in your browser. Nothing is sent to any server.

---

## Data Collection

Apex Log Insights collects **no data of any kind**.

- No analytics or telemetry
- No crash reporting
- No usage tracking
- No account or login required
- No cookies

---

## Log File Processing

When you load an Apex debug log file, it is parsed entirely within your browser using a local Web Worker. The log content:

- Is never uploaded to any server
- Is never transmitted over the network
- Is never stored beyond your current browser session (unless you explicitly save a report file to disk yourself)
- Is processed in memory only and discarded when you close the tab

---

## Local Storage

Apex Log Insights uses `chrome.storage.local` to persist **user interface preferences only**, such as:

- Whether to open links in a new tab
- How many context lines to show in the Log Explorer
- PHI/PII redaction settings (enabled/disabled, name list)

These preferences contain no log data, no personal information, and are stored only on your local device. They are never transmitted.

---

## Permissions Used

| Permission | Purpose |
|------------|---------|
| `tabs` | Detects when you navigate to a `.log` URL so the extension can offer to open the analyzer. No tab content is read beyond the URL pattern. |
| `storage` | Stores UI preferences locally on your device (see above). |
| Host: `*://*/*.log` | Allows the content script to run on `.log` URLs. Required to intercept and analyze log files opened directly in the browser. |
| Host: `file:///` | Allows the extension to read `.log` files opened from your local filesystem. |

---

## Third Parties

Apex Log Insights does not integrate with any third-party services, APIs, or analytics platforms. No data is shared with any third party.

---

## Children's Privacy

This extension is a developer tool intended for professional use. It is not directed at children and does not knowingly collect information from anyone.

---

## Changes to This Policy

If this policy changes, the updated version will be published with the extension update and reflected by a new "Last updated" date above.

---

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.
