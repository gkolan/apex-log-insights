# Chrome Web Store submission checklist

Use this checklist when submitting or updating Apex Log Insights on the Chrome Web Store. A completed checklist means the uploaded archive, listing, permissions, privacy disclosures, screenshots, and release notes all describe the same version and behavior.

Developer Dashboard: https://chrome.google.com/webstore/devconsole

---

## Before you start

- [ ] Select and synchronize the release version using `docs/development/releasing.md`
- [ ] Run `pnpm validate` — every health check passes
- [ ] Run `pnpm build` — build packages and extension archives without changing the version
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
- [ ] **Short description:** (125 chars — see listing.md)
- [ ] **Detailed description:** (full text from listing.md — paste as plain text)
- [ ] **Category:** Developer Tools
- [ ] **Language:** English
- [ ] **Single purpose statement:** (see listing.md)

---

## Screenshots

See `store/screenshots-guide.md` for what to capture.

- [ ] Screenshot 1 — Triage view (1280×800 PNG)
- [ ] Screenshot 2 — Execution view (1280×800 PNG)
- [ ] Screenshot 3 — Data & Limits view (1280×800 PNG)
- [ ] Screenshot 4 — Log Explorer with active search (1280×800 PNG)
- [ ] Screenshot 5 — Diagnostics view (1280×800 PNG)
- [ ] Promotional tile (440×280 PNG) — optional but recommended
- [ ] Marquee banner (1400×560 PNG) — optional

---

## Permissions justification

The store will ask "Why does your extension need each permission?" Copy from `store/listing.md` → "Permissions Justification" section.

- [ ] **tabs** — justified
- [ ] **storage** — justified
- [ ] **scripting** — justified
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
