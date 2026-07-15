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
7. **Rendering** — plain DOM/innerHTML templating per view (`renderCalendario`, `renderSessioni`, `renderOperatori`, `renderUtenti`, `renderProgetti`, `renderDisponibilita`, `renderChiusure`, `renderImpostazioni`, ...), all string-built HTML with the `esc()` helper for escaping. Modals are generic: `openModal(html, onCancel, isDirty, onSaveTrigger)`/`openModalStacked(html, onCancel, isDirty, onSaveTrigger)` inject markup into `#modal-root`; `onCancel` restores state on abandonment (e.g. the disponibilità snapshot), `isDirty`/`onSaveTrigger` power the unsaved-changes guard (see "Regole UX" below). A single Escape-handler stack (`pushEsc`/`popEsc`) keeps nested modal/popup/confirm-dialog layers from reacting to the same keypress.
8. **Scheduling engine** — the core domain logic, structured as **two passes**, shared by both generation paths via common helpers (`determinaAmbito`, `sessioniDaConservare`, `sedePriorita`, `minutiSettimana`, `risolviOnlineDaCasa`, `decidiOnlineDaCasa`):
   - **Scope ("ambito") and protected sessions**: `determinaAmbito(spid, nameFilter)` resolves which projects are in scope for a given generation run (single project / name filter / all active), independent of remaining monte-ore. `sessioniDaConservare(ms, scopeIds)` returns every session that must survive the run untouched — i.e. everything **except** `proposta` sessions belonging to in-scope projects. `confermata`, `eseguita`, `assenza ingiustificata`, `annullata`, and any `proposta` from an out-of-scope project are never deleted/recreated. All of these (except `annullata`, which is treated as a freed slot) remain **active constraints**: they pre-populate the busy-operator/busy-room trackers before any new placement happens.
   - **Passata 1 — placement** (`generateMonth()` inline; `generateMonthAI()`'s IA-response validation loop): assigns sessions for in-scope projects given frequency/duration, operator availability (`effRng`), room constraints (Cesate has 6 rooms, Busto Arsizio has 2, same room per half-day), a 5-minute gap between consecutive sessions, in-day travel time between sites, and weekly-hour contract caps — but does **not** yet decide whether an `Online` session happens from home or on-site (that field, `onlineDaCasa`, is left `null`). Project order: primary key is the rigidity index (`calcStrettezza`); secondary key at a tie is `sedePriorita()` (in-presence < composite Presenza+Online/Domicilio < pure remote). Operator choice within an eligible pool is pre-sorted by `minutiSettimana()` so that `Assunto` operators still under their weekly contracted hours are tried before everyone else (P.IVA collaborators fill the rest). In `generateMonthAI()`, Passata 1 also rejects any AI-proposed session that overlaps a protected/out-of-scope session's operator or room.
   - **Passata 2 — online resolution** (`risolviOnlineDaCasa(ms, newS, keep)`): runs once, after all placement is done, over the *combined* set of new + kept sessions. For each operator+day it sorts **every** session chronologically (including sessions from projects outside this run's scope) and calls `decidiOnlineDaCasa()` per `Online` session in `newS`, applying the travel-time rule (`tempoCasa` if the nearest in-presence session is at Cesate, `tempoBusto` if at Busto Arsizio) and treating an already-resolved "online in sede" session as an extended physical presence for later decisions the same day. Never mutates sessions outside `newS` (protected sessions' own `onlineDaCasa`/`aula` are left as-is).
   - Both entry points end by setting `state.data.sessioni` to the preserved set and persisting `newS` one by one via `saveRecord('sessioni', ...)`.
   - "🗑 Svuota proposte del mese" mirrors the same scope rule: it only deletes `proposta` sessions of in-scope projects, never `confermata`/`eseguita`/`assenza ingiustificata`/`annullata` or out-of-scope proposals.
9. **AI chat assistant** (`sendChat`, `bCtx`) — also calls `CFG.claudeProxy` with a context string built from current operators/utenti/progetti counts, purely for Q&A (not persisted beyond the in-memory `chatH` array).
10. **Excel import/export** (`handleImport`, uses the `xlsx` SheetJS library loaded from a CDN) for bulk-importing operators/clients from `.xlsx` templates.

### Key domain concepts worth knowing before editing scheduling/session code

- **Sedi** (sites): `Cesate`, `Busto Arsizio`, `Online`, `Domicilio`, plus composite modes `Presenza+Online` / `Presenza+Domicilio` that resolve to a concrete site per-session based on operator/room availability. **Business rule**: for `Presenza+Online` the effective site can only resolve to `Cesate` or `Online`; for `Presenza+Domicilio` only to `Cesate` or `Domicilio` — **never** `Busto Arsizio` (Busto Arsizio has no online sessions). This is enforced in `generateMonth()` (slot-compatibility filter and effective-`sede` resolution) and in `generateMonthAI()` (prompt constraint **and** a hard post-validation that discards any AI-proposed session violating it) — keep both in sync if this rule ever changes.
- **Aule** (rooms): fixed lists `AULE_CESATE` (6) and `AULE_BUSTO` (2); an operator keeps one room for the whole day/half-day once assigned (`opRoom` map keyed by `operatorId|date` or `operatorId|date|halfDay`).
- **Disponibilità** (availability): weekly recurring slots plus per-date exceptions (`eccezioni`/`availOverrides`), read through `effRng()`, which supports both a newer array-of-exception-objects format and a legacy per-date object format — check both when touching availability logic.
- **Progetti** (projects) carry `monteOre` (hour budget), `frequenza` (sessions/week), `durataSessione`, `operatoriAmmessi` (eligible operators), and optionally `tipiSessione` (session-type rotations with per-method duration "componenti").
- **Sessioni** states: `proposta`, `confermata`, `eseguita`, `assenza ingiustificata`, `annullata` (see `STATI_SESS`). Only `proposta` sessions of in-scope projects are ever deleted/recreated by a generation run or by "Svuota proposte del mese" — every other state is a protected, active scheduling constraint (see Scheduling engine above). `oreErog()` (monte-ore consumed) counts `eseguita` and `assenza ingiustificata`, excludes `annullata` (which stays recoverable) and `proposta`/`confermata` (not yet consumed).
- **Chiusure**: center-wide closures (holidays/vacation) that block session generation on those dates; Italian public holidays (including computed Easter/Easter Monday) are precomputed via `getFestivita`/`getPasqua`.

When making changes, keep everything self-contained in `index.html` (no framework or bundler is set up), preserve the JSON-blob-in-SharePoint-list persistence model, and be careful with the two scheduling code paths (`generateMonth` vs `generateMonthAI`) since they duplicate validation/session-shape logic independently.

## Regole UX

- **Modifiche non salvate nelle schede modali**: ogni scheda modale con form (operatori, utenti, progetti, sessioni, disponibilità — popup giorno e "Applica a più giorni") confronta lo stato del form con quello di apertura. Se l'utente prova a chiuderla (click fuori/backdrop, Esc, o pulsante "Annulla"/di chiusura) con modifiche non salvate, appare un dialogo con tre scelte: **Salva ed esci**, **Esci senza salvare**, **Continua a modificare**. Nessuna via di chiusura deve mai perdere dati non salvati senza avviso. Implementato tramite i parametri `isDirty`/`onSaveTrigger` di `openModal`/`openModalStacked` e la funzione condivisa `confirmUnsavedChanges()`.
- Questo confronto esclude le eccezioni di disponibilità (`eccezioni`) quando fanno parte anche del form principale (operatori/progetti): quelle sono salvate immediatamente su ogni click-giorno/"Applica a più giorni" e già gestite dal ripristino via snapshot descritto sopra — non devono duplicare l'avviso.

## Regole di business pianificate (non ancora implementate)

- **Pausa pranzo** (da implementare in un prossimo ciclo): ogni operatore deve avere 60 minuti consecutivi liberi interamente dentro la finestra 12:00–14:30. La pausa si considera implicita (non richiede uno slot vuoto esplicito) se l'operatore inizia a lavorare alle 13:30 o dopo, oppure se finisce entro le 13:30. Se dopo la pausa c'è uno spostamento casa→sede, pausa + viaggio devono concludersi entro le 14:30. La Passata 2 (`risolviOnlineDaCasa`) può scegliere "online in sede" per far quadrare la pausa (l'aula resta occupata in quel caso). Il report di generazione può suggerire riduzioni o spostamenti della pausa per sbloccare sessioni, ma non deve mai eseguirli in automatico.

## Manutenzione del CONTESTO.md

`CONTESTO.md`, nella root del repo, è il documento di contesto del progetto usato nelle conversazioni di consulenza con Claude (fuori da Claude Code). Regola permanente:

- Alla fine di ogni sessione di lavoro che produce modifiche al codice, **prima del commit finale**, aggiorna `CONTESTO.md`:
  - aggiungi alla sezione "Cronologia lavori" una voce sintetica con data e descrizione delle modifiche fatte in questa sessione;
  - aggiorna la sezione "Backlog" se sono emerse nuove voci o se alcune sono state completate (rimuovile o segnale come fatte).
- `CONTESTO.md` va sempre incluso nello stesso commit delle modifiche di codice a cui si riferisce, mai in un commit separato successivo.
