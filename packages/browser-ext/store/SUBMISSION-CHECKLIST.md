# Chrome Web Store submission checklist

Use this checklist when submitting or updating Apex Log Insights on the Chrome Web Store. A completed checklist means the uploaded archive, listing, permissions, privacy disclosures, screenshots, and release notes all describe the same version and behavior.

Developer Dashboard: https://chrome.google.com/webstore/devconsole

---

## Before you start

- [ ] Select and synchronize the release version using `docs/development/releasing.md`
- [ ] Run `pnpm validate` — every health check passes
- [ ] Run `pnpm build` — build packages and extension archives without changing the version
- [ ] Run the [rendered accessibility checks](../../../docs/development/testing.md#check-rendered-accessibility), review incomplete findings, and check keyboard and screen-reader behavior
- [ ] Confirm the zips are in `packages/browser-ext/dist/`
- [ ] Confirm version number in all three manifests matches root `package.json`
- [ ] Run `pnpm audit:report` — review any findings in `audit/`
- [ ] Run `pnpm bugs:report` — review any findings in `bugs/`

---

## Account setup (first submission only)

- [ ] Pay the one-time $5 Chrome Web Store developer registration fee
- [ ] Verify your developer email address
- [ ] Accept the Chrome Web Store Developer Agreement

---

## Store listing fields

Copy from `store/listing.md`:

- [ ] **Extension name:** Apex Log Insights
- [ ] **Short description:** copy from listing.md and check the destination store's character limit
- [ ] **Detailed description:** (full text from listing.md — paste as plain text)
- [ ] Replace the complete pre-1.2 description; confirm the published text no longer says the extension requires only `tabs` and `storage`
- [ ] **Category:** Developer Tools
- [ ] **Language:** English
- [ ] **Feedback contact:** `feedback@apexloginsights.com` in the description and applicable public support-email field; confirm the mailbox receives mail
- [ ] **Support URL:** use an HTTPS help page or issue tracker where the field requires a webpage, not an email address
- [ ] **Single purpose statement:** (see listing.md)

---

## Screenshots

See `store/screenshots-guide.md` for what to capture and [the image inventory](../../../assets/images/README.md) for the capture source and synthetic-input provenance.

- [ ] Screenshot 1 — Setup, `assets/images/1.png` (1280×800 PNG)
- [ ] Screenshot 2 — Triage Summary, `assets/images/3.png` (1280×800 PNG)
- [ ] Screenshot 3 — Execution Story, `assets/images/2.png` (1280×800 PNG)
- [ ] Screenshot 4 — Data & Limits, `assets/images/6.png` (1280×800 PNG)
- [ ] Screenshot 5 — Log Explorer with active search, `assets/images/5.png` (1280×800 PNG)

Diagnostics (`assets/images/4.png`) remains available as an alternate. Keep Setup first.

- [ ] Promotional tile — upload `assets/images/chrome-promo-tile.png` (440×280 PNG); see [Chrome image requirements](https://developer.chrome.com/docs/webstore/images)
- [ ] Marquee banner (1400×560 PNG) — optional

---

## Permissions justification

The store will ask "Why does your extension need each permission?" Copy from `store/listing.md` → "Permissions Justification" section.

- [ ] **tabs** — justified
- [ ] **storage** — justified
- [ ] **scripting** — justified for Chrome and Edge; absent from the Firefox manifest
- [ ] **Host: `*://*/*.log`** — justified
- [ ] **Host: `file:///`** — justified

---

## Privacy

- [ ] Privacy policy URL entered — host `store/privacy-policy.md` as a public page (GitHub raw link or your own domain)
- [ ] Store data-use answers match `store/privacy-policy.md`, including local retention of the active analyzer payload
- [ ] Confirm: no remote code execution, telemetry, analytics, or transmission of log content by the extension

---

## Pricing

- [ ] Set to **Free**

---

## Distribution

- [ ] **Visibility:** Public
- [ ] **Regions:** All regions (or restrict if needed)

---

## Package upload

- [ ] Upload the `.zip` from `packages/browser-ext/dist/`
- [ ] Confirm the store shows the correct version number after upload
- [ ] Review the auto-detected permissions summary — confirm it matches expectations

For Firefox, upload `firefox-extension-v*.xpi` as the extension and attach `firefox-source-v*.zip` as reviewer source code. The source archive contains the lockfile and exact reproduction instructions required for the bundled worker and generated UI.

- [ ] Replace the complete pre-1.2 Firefox description so it does not refer to Chrome behavior, claim that raw rendering is unbounded, or repeat stale permission language
- [ ] Replace the Firefox reviewer comments with `listing.md` → "Firefox reviewer notes"; the older comments omit the required core build and do not reproduce the submitted worker

---

## What's new (updates only)

Copy from `store/release-notes.md` for the current version.

---

## After submission

- [ ] Watch the dashboard and developer email for review status; review time varies
- [ ] Confirm the published version at the current [Chrome Web Store listing](https://chromewebstore.google.com/detail/apex-log-insights/mkgfpohljhagepglolcabmnhhiipicdp)
- [ ] Tag the release in Git: `git tag v<version> && git push --tags`

---

## Store link

```markdown
[Install Apex Log Insights from the Chrome Web Store](https://chromewebstore.google.com/detail/apex-log-insights/mkgfpohljhagepglolcabmnhhiipicdp)
```
