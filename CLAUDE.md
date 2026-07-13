# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Rispondi sempre in italiano, indipendentemente dalla lingua usata nel prompt.

## What this repo is

A single-file client-side web app (`index.html`, ~1600 lines: inline `<style>` + inline `<script>`, no build step) for **Centro Sviluppo Cognitivo**, a cognitive-training center (BrainRx / Metodo Feuerstein) running sites in Cesate, Busto Arsizio, online and at-home. It's a scheduling/CRM tool ("Gestionale") for managing operators (therapists), clients ("utenti"), projects/treatment plans, and calendar sessions. UI and identifiers are in Italian.

There is no package.json, build tool, linter, or test suite — this is intentionally a plain HTML/CSS/JS deploy. `CNAME` configures GitHub Pages for the custom domain `calendari-sviluppo-cognitivo.it`; pushing to `main` is the deploy.

## Running / testing changes

- Opening `index.html` directly as a `file://` URL is explicitly blocked by the app (see the `init()` guard) — it will show an error screen.
- Full functionality (login) requires being served over `https://` from an origin registered as a redirect URI in the Entra ID (Azure AD) app registration referenced by `CFG.clientId`/`CFG.tenantId`. In practice this means auth only works on the deployed production domain (or another origin explicitly added to the app registration) — there's no local dev auth flow.
- You can still statically inspect/edit markup, CSS, and non-auth-dependent JS logic (e.g. the scheduling algorithm in `generateMonth`) without deploying; just be aware MSAL/Graph calls won't succeed off the registered domain.
- No automated tests exist. Verify changes by reasoning through the code paths and, where feasible, deploying to a real/staging domain and exercising the UI manually.

## Architecture

Everything lives in `index.html`: CSS in one `<style>` block, then several `<script>` blocks. Read top-to-bottom, the script is organized into:

1. **MSAL loader** — tries a list of CDN URLs/versions for `msal-browser.js` with fallback (`tryNext()`), then dispatches `msal-ready`.
2. **`CFG` constant** (near the top of the main script) — hardcodes the Entra ID `clientId`/`tenantId`, the SharePoint host (`spHost`), the SharePoint **list names** used as the "database" (`CFG.lists`), a bootstrap `adminEmails` list, and `claudeProxy` (an external HTTPS endpoint that proxies calls to the Anthropic API — the Claude API key itself is *not* in this file, it lives server-side behind that proxy). Changing tenants/sites means updating this object.
3. **Data layer = SharePoint Lists via Microsoft Graph** (`gfetch`, `resolveSite`, `tryResolveLists`, `loadListRecords`, `loadAll`, `saveRecord`, `deleteRecord`). There is no real backend/database: each SharePoint list item stores one entity as a JSON blob in a `Data` column (`Title` = the entity's own `id`). `loadAll()` pulls all six lists (`operatori`, `utenti`, `progetti`, `sessioni`, `chiusure`, `impostazioni`) into `state.data` and also runs a one-time migration (splitting legacy `nome` fields into `nome`+`cognome`).
4. **Global mutable `state` object** — holds the MSAL account, resolved `role`, current user (`me`), SharePoint `siteId`/`listIds`, and `state.data.{operatori,utenti,progetti,sessioni,chiusure,impostazioni}`. There's no framework/store; UI code reads/writes `state` directly and re-renders by calling the relevant `renderX()` function.
5. **Auth + role resolution** (`initMsal`, `doLogin`, `doLogout`, `getToken`, `resolveRole`) — role is derived from Entra ID app roles claim, or by matching the signed-in email against the `operatori` list, or against `CFG.adminEmails`. If no operators exist yet, the first login bootstraps as Admin (`state.bootstrap`). Two roles: `Admin` (full access) and `Operatore` (sees only their own calendar/sessions/availability).
6. **Navigation** (`TABS`, `buildNav`, `showTab`) — each tab maps to a `<section id="view-*">` and triggers a `renderX()` call; there's no router, just show/hide of sections.
7. **Rendering** — plain DOM/innerHTML templating per view (`renderCalendario`, `renderSessioni`, `renderOperatori`, `renderUtenti`, `renderProgetti`, `renderDisponibilita`, `renderChiusure`, `renderImpostazioni`, ...), all string-built HTML with the `esc()` helper for escaping. Modals are generic: `openModal(html)`/`closeModal()` inject markup into `#modal-root`.
8. **Scheduling engine** — the core domain logic:
   - `generateMonth()`: deterministic, in-browser algorithm that assigns sessions for a month given each project's frequency/duration, operator availability (`effRng`, weekly + per-date exceptions), room constraints (Cesate has 6 rooms, Busto Arsizio has 2), a 5-minute gap between consecutive sessions, an operator keeping the same room all day, travel time between sites, and weekly-hour contract caps.
   - `generateMonthAI()`: alternative path that serializes operators/projects/existing sessions into a prompt and POSTs to `CFG.claudeProxy`, expecting back a JSON array of sessions; it then validates/saves the result the same way as the algorithmic path.
   - Both write results into `state.data.sessioni` and persist via `saveRecord('sessioni', ...)`.
9. **AI chat assistant** (`sendChat`, `bCtx`) — also calls `CFG.claudeProxy` with a context string built from current operators/utenti/progetti counts, purely for Q&A (not persisted beyond the in-memory `chatH` array).
10. **Excel import/export** (`handleImport`, uses the `xlsx` SheetJS library loaded from a CDN) for bulk-importing operators/clients from `.xlsx` templates.

### Key domain concepts worth knowing before editing scheduling/session code

- **Sedi** (sites): `Cesate`, `Busto Arsizio`, `Online`, `Domicilio`, plus composite modes `Presenza+Online` / `Presenza+Domicilio` that resolve to a concrete site per-session based on operator/room availability. **Business rule**: for `Presenza+Online` the effective site can only resolve to `Cesate` or `Online`; for `Presenza+Domicilio` only to `Cesate` or `Domicilio` — **never** `Busto Arsizio` (Busto Arsizio has no online sessions). This is enforced in `generateMonth()` (slot-compatibility filter and effective-`sede` resolution) and in `generateMonthAI()` (prompt constraint **and** a hard post-validation that discards any AI-proposed session violating it) — keep both in sync if this rule ever changes.
- **Aule** (rooms): fixed lists `AULE_CESATE` (6) and `AULE_BUSTO` (2); an operator keeps one room for the whole day/half-day once assigned (`opRoom` map keyed by `operatorId|date` or `operatorId|date|halfDay`).
- **Disponibilità** (availability): weekly recurring slots plus per-date exceptions (`eccezioni`/`availOverrides`), read through `effRng()`, which supports both a newer array-of-exception-objects format and a legacy per-date object format — check both when touching availability logic.
- **Progetti** (projects) carry `monteOre` (hour budget), `frequenza` (sessions/week), `durataSessione`, `operatoriAmmessi` (eligible operators), and optionally `tipiSessione` (session-type rotations with per-method duration "componenti").
- **Sessioni** states: `proposta`, `confermata`, `eseguita`, `assenza ingiustificata`, `annullata` (see `STATI_SESS`).
- **Chiusure**: center-wide closures (holidays/vacation) that block session generation on those dates; Italian public holidays (including computed Easter/Easter Monday) are precomputed via `getFestivita`/`getPasqua`.

When making changes, keep everything self-contained in `index.html` (no framework or bundler is set up), preserve the JSON-blob-in-SharePoint-list persistence model, and be careful with the two scheduling code paths (`generateMonth` vs `generateMonthAI`) since they duplicate validation/session-shape logic independently.
