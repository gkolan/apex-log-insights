# Chrome Web Store Submission Checklist

Use this checklist when submitting or updating Apex Log Insights on the Chrome Web Store.

Developer Dashboard: https://chrome.google.com/webstore/devconsole

---

## Before you start

- [ ] Run `pnpm build` to sync versions, build all packages, and export extension zips
- [ ] Confirm the zips are in `packages/browser-ext/dist/`
- [ ] Confirm version number in all three manifests matches root `package.json`
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `pnpm typecheck` — no errors
- [ ] Run `pnpm audit` — review any findings in `audit/`
- [ ] Run `pnpm bugs` — review any findings in `bugs/`

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
- [ ] **Host: `*://*/*.log`** — justified
- [ ] **Host: `file:///`** — justified

---

## Privacy

- [ ] Privacy policy URL entered — host `store/privacy-policy.md` as a public page (GitHub raw link or your own domain)
- [ ] "Does not collect user data" options selected where applicable
- [ ] Confirm: no remote code execution, no external data calls

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

- [ ] Google review typically takes 1–3 business days for new extensions, faster for updates
- [ ] Watch the developer email for review status notifications
- [ ] Once live: update `README.md` with the real Chrome Web Store URL
- [ ] Add the Web Store badge image to `README.md`
- [ ] Tag the release in git: `git tag v{version} && git push --tags`

---

## Web Store badge (add to README once live)

```markdown
[![Available in the Chrome Web Store](https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/HRs9MPufa1J1h5glNhut.png)](YOUR_STORE_URL_HERE)
```
