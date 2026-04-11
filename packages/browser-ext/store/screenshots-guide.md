# Store Screenshots Guide — Apex Log Insights

Chrome Web Store requires **1–5 screenshots**. Recommended dimensions: **1280×800** or **640×400** pixels. PNG or JPEG.

The store also supports a **promotional tile** (440×280) and an optional **marquee banner** (1400×560).

---

## Recommended Screenshot Set (5 images)

Take these in order — they tell a complete story from "open a log" to "find the root cause".

---

### Screenshot 1 — Triage View (Hero shot)

**What to capture:** The Triage tab fully loaded with a log that has at least one warning (N+1 SOQL or governor limit near threshold). Show the verdict badge, the key metrics grid, and the N+1 banner if present.

**Suggested caption:**
> Instant triage — verdict, key metrics, and N+1 SOQL detection in one view.

**Tips:**
- Use a log with a WARNING or CRITICAL verdict so the badge color pops
- Make sure the N+1 SOQL banner is visible if the log has one
- Use light theme for screenshots (better contrast on the store's white background)
- Crop to 1280×800, hiding the browser chrome if possible (use a frameless window or crop)

---

### Screenshot 2 — Execution View

**What to capture:** The Execution tab showing the 20-phase timeline with at least 3–4 phases visible, each with their governor limit breakdown. Ideally show a trigger phase with DML + SOQL sub-items visible.

**Suggested caption:**
> Salesforce's 20-phase execution lifecycle — see exactly which phase consumed which governor limits.

**Tips:**
- Expand one or two phases to show sub-items (query rows, CPU time, heap)
- If the log has a trigger cascade, include that section
- The execution chain / call stack is a good secondary element to show

---

### Screenshot 3 — Data & Limits View

**What to capture:** The Data tab showing the SOQL queries table (with duration column) and DML operations table. Bonus if HTTP callouts or Named Credentials are also visible.

**Suggested caption:**
> Every SOQL query, DML operation, and HTTP callout — ranked, structured, and linked to the raw log.

**Tips:**
- Sort/rank by duration to show the slowest queries at the top
- Expand the "All queries" section if present to show more rows
- Show at least 5–8 rows in the SOQL table for visual richness

---

### Screenshot 4 — Log Explorer (Evidence view) with a search active

**What to capture:** The Evidence/Log Explorer tab with a search term typed in (e.g., "SOQL" or "EXCEPTION") and several highlighted matches visible. Show the context line controls sidebar.

**Suggested caption:**
> Full raw log with search, context lines, and one-click navigation to any event.

**Tips:**
- Use a search that returns 5–10 visible highlighted results
- Show the context line count controls (set to 5 or 10 lines for visual interest)
- Show the "Copy highlighted lines" button
- If possible, show an evidence pointer panel open (linking a query back to its line)

---

### Screenshot 5 — Diagnostics View

**What to capture:** The Diagnostics tab showing the debug level quality score card, execution context detection (e.g., "Synchronous Trigger"), and at least one warning card (mixed DML or recursive trigger) if the log has one.

**Suggested caption:**
> Diagnostics — execution context, debug level quality, trigger cascade analysis, and warning detection.

**Tips:**
- A log with a low debug quality score or a warning makes this screen more compelling
- Show the managed package overhead section if the log has managed packages
- The execution context chip (e.g., "SYNCHRONOUS TRIGGER") is a strong visual element

---

## Promotional Tile (440×280) — Optional but recommended

Use the Triage view cropped to the verdict badge + top metrics grid only. This is the thumbnail-scale image shown in category browsing.

**Text overlay to add (in an image editor):**
```
Apex Log Insights
Free offline toolkit for Apex debug logs
```

---

## Marquee Banner (1400×560) — Optional

A wider hero shot of the full analyzer UI — Triage view or Execution view at full width, with text overlay:

```
Apex Log Insights
Turn raw Apex debug logs into actionable insights — free, offline, instant.
```

---

## Checklist before uploading

- [ ] Screenshots are exactly 1280×800 or 640×400 (Chrome Web Store will reject other sizes)
- [ ] No browser chrome visible (use full-screen or crop)
- [ ] Light theme used (better legibility on the store's white background)
- [ ] Real log data used (not placeholder/empty state)
- [ ] Log contains enough data to make tables and views look populated
- [ ] Captions are ready to paste into the store's "Caption" field for each screenshot
- [ ] At least 1 screenshot uploaded (up to 5 recommended)

---

## Sample log to use for screenshots

`logs/webstore-demo-opportunity-trigger.log` is already in the repo and was likely chosen for this purpose. Use it as the primary screenshot source if it produces a WARNING or CRITICAL verdict with visible SOQL/DML data.
