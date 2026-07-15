# Piano B — Gestionale Centro Sviluppo Cognitivo
## Documento di contesto per nuove chat (aggiornato al 14/07/2026, ore pomeridiane)

> Fornire questo file a inizio conversazione per riprendere il lavoro senza perdere il contesto.

---

## 1. Chi e cosa

- **Simone**: amministrazione/contabilità/commerciale del Centro Sviluppo Cognitivo Coop. Soc. (cooperativa sociale, training cognitivo BrainRx e Metodo Feuerstein). Non è un programmatore: le spiegazioni tecniche vanno date in modo chiaro e in italiano.
- **Piano B**: gestionale (scheduling/CRM) in **un singolo file `index.html`** (~2100 righe) su GitHub Pages, dominio `https://calendari-sviluppo-cognitivo.it`.
- **Stack**: MSAL.js (login Microsoft 365), Microsoft Graph API, SharePoint Lists come database. Nessun build step, nessun framework.
- **Repo**: `amministrazione-oss/calendari-sviluppo-cognitivo` (pubblico). Push su `main` = deploy automatico.
- **Copia locale**: `C:\Users\simob\Documents\calendari-sviluppo-cognitivo` (Windows, PowerShell).
- **Azure**: Client ID `87706ad1-bb17-406a-8fcc-99472a21903a`, Tenant `da2cae71-8782-45b6-b259-47e7cb68f1b5`, host `centrosviluppocognitivo.sharepoint.com`.
- **Liste SharePoint**: Gestionale_Operatori, Gestionale_Utenti, Gestionale_Progetti, Gestionale_Sessioni, Gestionale_Chiusure, Gestionale_Impostazioni. Ogni item: `Title` (id) + `Data` (JSON).
- **Piano Claude**: Team (org. Centro Sviluppo Cognitivo) → i dati non vengono usati per addestramento (termini commerciali Anthropic).

## 2. Metodo di lavoro consolidato

- **Claude Code** (installato nativamente su Windows, v2.1.207) esegue le modifiche al codice in locale e fa commit+push. Identità git configurata (Simone / amministrazione@sviluppocognitivo.it).
- **Questa chat** fa da consulente tecnico: si ragiona qui, si preparano prompt dettagliati (in blocchi codice ```text``` così Simone li copia col tastino), Claude Code esegue.
- **Regola fissa di Simone**: prima di ogni consegna, verifica automatica che elenca cosa è stato fatto e cosa manca. I report vanno in `VERIFICA.md` nel repo.
- **CLAUDE.md** nel repo contiene architettura e regole di dominio (Claude Code lo legge a ogni sessione; le chat NON sono visibili a Claude Code → ogni regola di business nuova va fatta scrivere lì).
- Dopo ogni push, la chat verifica il codice pubblicato scaricandolo da GitHub (sintassi con Node, grep sulle regole).
- Claude Code risponde in italiano (istruzione nel CLAUDE.md).
- Node.js NON è installato sul PC di Simone (Claude Code usa verifiche alternative; la chat fa il check Node da GitHub).
- Backlog delle cose future: da salvare in un file `BACKLOG.md` nel repo (non ancora creato).

## 3. Specifiche di dominio (regole vincolanti)

- **Sedi**: Cesate (6 aule: Blu, Verde, Gialla, Rosa, Arancione, Viola), Busto Arsizio (2 aule: Grande, Piccola), Online, Domicilio. Modalità composite: Presenza+Online, Presenza+Domicilio.
- **REGOLA BUSINESS CRITICA**: Presenza+Online → solo Cesate o Online; Presenza+Domicilio → solo Cesate o Domicilio. **MAI Busto Arsizio** nelle composite (a Busto niente online né domicilio). Applicata in generateMonth, nel prompt IA e in validazione post-IA.
- Orari centro: 09:00–19:30. Gap minimo 5 minuti tra sessioni consecutive.
- Aula: l'operatore tiene la STESSA aula per la mezza giornata (mattina/pomeriggio possono differire — confermato che va bene così).
- Online in sede = aula resta occupata. Online da casa solo se margine di viaggio sufficiente (tempo-casa per Cesate, tempo-Busto per Busto) rispetto alla prima/ultima sessione in presenza della giornata. Flag `onlineDaCasa` sulla sessione.
- Assenze operatore: malattia (sempre giornata intera), permesso visita medica / permesso studio / ferie (fascia oraria facoltativa; senza fascia = giornata intera). L'algoritmo considera disponibile il resto della giornata.
- Contratti: Assunto (limite ore settimanali, straordinari) / P.IVA (senza monte ore). Priorità di scelta: prima Assunti sotto monte ore, poi P.IVA.
- Stati sessione: proposta, confermata, eseguita, annullata, assenza ingiustificata.
  - **Monte ore**: eseguita = conta; assenza ingiustificata = conta (utente perde l'ora); annullata = NON conta, recuperabile, non occupa operatore/aula.
  - **Rigenerazione**: tocca SOLO le "proposte" dei progetti nell'ambito di generazione. Confermate/eseguite/assenze SEMPRE intoccabili e vincoli attivi. Riunioni interne (es. "Riunione mensile Team") vanno inserite come "confermata".
- Rotazione "Tipi di sessione" (tipo1/tipo2...): continua per tutto il mese senza azzerarsi a inizio settimana. Approccio A: un solo operatore per l'intera sessione. Requisito formazioni: l'operatore deve avere TUTTE le formazioni dei metodi della sessione.
- Colori: navy #38378d, teal #15b4b7. Sedi: Cesate=blu, Busto=verde, Online=viola, Domicilio=arancione. Assenze: ferie arancione #FF9800, festività ambra #FFB74D, malattia azzurro, permessi giallo.
- Priorità piazzamento: 1) indice di rigidità disponibilità; a parità: presenza → composite → online/domicilio.
- Ordinamento utenti: "Cognome Nome" alfabetico (fatto in Progetti; estensione a tutta l'app in corso).

## 4. Architettura algoritmo (generateMonth) — TRE PASSATE

1. **Passata 1**: piazza tutte le sessioni dei progetti in ambito (disponibilità via effRng, aule, gap, rotazione tipi continua, priorità sede e assunti, vincoli da sessioni intoccabili/fuori ambito).
2. **Passata 2**: per ogni operatore/giornata, tutte le sessioni (anche fuori ambito) in ordine cronologico → decide onlineDaCasa con la regola del tempo di viaggio; online in sede riusa l'aula e conta come presenza per le decisioni successive.
3. **Passata 3 (riparazione completezza)**: per gli utenti sotto target settimanale, sposta/scambia SOLO proposte in ambito (prima tra Assunti, poi tutti gli ammessi), max 40 mosse; se servirebbe toccare fuori-ambito/confermate → non esegue, registra suggerimento nel report.
- **Report unico di generazione** (pulsante "📄 Report completo" dopo ogni run, algoritmo e IA): richieste vs piazzate per utente/settimana, cause carenze, suggerimenti azionabili, metriche (buchi operatori nei giorni con presenza, % online da casa, saturazione aule, carico Assunti/P.IVA).
- Il generatore IA (generateMonthAI, via proxy Azure `csc-claude-proxy.azurewebsites.net`) NON implementa i tipi di sessione né la Passata 3 (solo report); la sua risoluzione sede/online è ricalcolata deterministicamente post-risposta.
- Decisione strategica: **l'algoritmo è il motore primario; l'IA sarà assistente** (spiegazioni, suggerimenti, linguaggio naturale) — non sostituto. Costo stimato IA ~15-40€/mese per ~100 generazioni: non è il costo il problema, ma l'affidabilità sui vincoli combinatori.

## 5. Cronologia lavori (13-14/07/2026)

**13/07 — giornata fondativa (7 push):**
1. Installati Claude Code (nativo) e Git; clone repo; CLAUDE.md creato con /init.
2. Corretti 11 bug (i 3 critici: `sed` TDZ in generateMonth, `nameFilter` mancante in generateMonthAI, campo #gen-proj-name assente → i generatori non avevano MAI funzionato; più: sessioni duplicate/non persistite, import Excel senza errori, campo Tempo Busto, errori Impostazioni silenziati, listener duplicati Chiusure, mismatch sede/aula, svuota-utenti orfani, retry 429/503 su gfetch).
3. Regola business Busto nelle composite.
4. Blocco A: rotazione mensile continua; regola online da casa/in sede; fasce orarie assenze; ordinamento utenti in Progetti.
5. Blocco B: vista anagrafica cliente in SOLA LETTURA per operatori (da dettaglio sessione; hardening showTab/openUtenteModal); consuntivazione (esito sessione + nota operatore, canEdit solo proprie sessioni); rimosso pulsante Bulk (era morto); bug preesistente corretto: le confermate venivano cancellate in rigenerazione.
6. Blocco C (C1+C2): architettura a tre passate, priorità sede/assunti, perimetro ambito, Passata 3, report.
7. Fix UX: la scheda disponibilità resta aperta dopo ogni salvataggio (funzione condivisa → vale per operatori e progetti).
8. Multi-giorno ("Applica a più giorni": intervallo + giorni settimana + tipo + fasce; salta festività; salvataggio unico; conferma sovrascrittura) + colori ferie/festività distinti + palette ASSENZA_COLORI centralizzata.

**14/07:**
9. Fix schermata di accesso: niente più "Liste SharePoint non trovate" pre-login (acquireTokenSilent prima di toccare Graph; login pulito se token scaduto). Verificato con test browser (Edge headless) da Claude Code stesso.
10. Fix da 4 punti (completato e verificato da GitHub): (1) Annulla reale con snapshot dello stato all'apertura (`eccezioniSnapshot` + `_restoreSnapshot`, ripristina anche su SharePoint; attivo in entrambe le schede) + azione "🗑 Rimuovi impostazioni" nel pannello multi-giorno con conferma e salvataggio unico; (2) fasce settimanali visibili nel calendario mensile (giorni verdi con bordo tratteggiato, classe mc-weekly), cliccabili → editor precompilato che salvando crea l'eccezione per data; (3) bug "arr.findIndex is not a function" nelle Impostazioni risolto con normalizzazione difensiva `toArraySafe` (dati legacy oggetto→array) e guardie Array.isArray; (4) formato "Cognome Nome" con ordinamento per cognome esteso a tutta l'app (fullNameCN usata in 18 punti: calendario, sessioni, invio calendario, ecc.). File a 2208 righe, sintassi verificata.

**Test manuali suggeriti a Simone (da fare)**: prova Annulla (inserire giorni sbagliati → Annulla → ricaricare → spariti); ricontrollare le voci Impostazioni inserite quando c'era l'errore findIndex (alcune scritture potrebbero non essere andate a buon fine).

**15/07:**
11. Aggiunto `CONTESTO.md` al repo (era solo locale, ora versionato e incluso nel deploy). Introdotta nel `CLAUDE.md` una regola permanente di manutenzione: a fine di ogni sessione con modifiche al codice, prima del commit finale, aggiornare qui la sezione "Cronologia lavori" (voce sintetica con data) e la sezione "Backlog" (nuove voci o completate), includendo sempre `CONTESTO.md` nello stesso commit del codice.
12. Riepilogo/conferma del rilascio del 14/07 (fix dei 4 punti, punto 10 sopra): Annulla reale con snapshot, rimozione impostazioni multi-giorno, fasce settimanali visibili nel calendario mensile, bug `findIndex` sulle Impostazioni risolto, ordinamento "Cognome Nome" esteso a tutta l'app.
13. Ciclo di 4 fix UX + documentazione (dettagli in `VERIFICA.md`): (1) Annulla disponibilità — trovato e corretto un difetto reale in `saveRecord` (sostituiva l'oggetto in `state.data[key]` invece di aggiornarlo sul posto, rompendo l'identità del riferimento tenuto dalla scheda aperta) e reso il ripristino via snapshot più robusto (confronto di contenuto invece di un flag `dirty` manuale) — **da confermare con test manuale**, non riprodotto dal vivo; (2) dialogo "modifiche non salvate" (Salva ed esci / Esci senza salvare / Continua a modificare) su operatori, utenti, progetti, sessioni e i popup di disponibilità (click-giorno, "Applica a più giorni"), con nuovo stack di gestori Escape (`pushEsc`/`popEsc`) per le modali annidate; (3) numerazione progressiva nelle liste Formazioni/Metodi in Impostazioni (solo visualizzazione); (4) nuovo logo SVG al posto dei "due pallini", esteso — su scelta di Simone — a header, login e accesso negato (era chiesto solo per l'header).

**Stato dati**: inserimento in corso (14/07). Strategia test: prima set piccolo (2-3 operatori misti Assunto/P.IVA, 4-5 progetti rappresentativi), poi caricamento completo (import Excel disponibile). Realtà operativa: operatori multi-progetto nello stesso giorno, maggioranza sessioni online.

## 6. Backlog

*Funzionalità:*
1. IA a supporto dell'algoritmo (spiegazione anomalie, suggerimenti, comandi naturali) — priorità alta, prima del gruppo
2. Pseudonimizzazione dati inviati all'IA (GDPR: ID/iniziali al posto dei nomi in generateMonthAI) — priorità alta
3. Passata 3 "estetica" (ricompattamento giornate; criteri da definire con i dati del report)
4. Tipi di sessione nel generatore IA
5. Vista "I miei progetti" per gli operatori (oggi l'operatore vede l'anagrafica solo dal dettaglio sessione)
6. Avvisi scadenza contratti + calcolo straordinari da collegare alla UI (funzioni esistono, orfane)
7. Credenziali in chiaro su SharePoint + permessi a livello di lista lato M365 (la sola-lettura operatore è solo client-side; il token ha Sites.ReadWrite.All) — sessione dedicata, tema GDPR
8. Race condition bootstrap primo admin
9. Doppio click "Genera con IA" (decidere se comportamento voluto)
10. Assenze tipizzate anche per progetti/utenti
11. Pulizia ridondanza controllo gap 5 minuti
12. Limite noto P3: niente scambi di aula, niente riassegnazione operatore del blocco
13. Calendari famiglie via inviti Outlook/Graph (opzione C scelta): eventi calendario M365 con la famiglia invitata, aggiornamenti in tempo reale, solo sessioni confermate, attenzione alle rigenerazioni

*Strumenti (rivalutare se il progetto cresce/diventa multi-file):*
14. Graphify (knowledge graph del codice) — inutile su file singolo
15. Ruflo (multi-agente) — sovradimensionato ora
16. Caveman (output compresso) — sconsigliato: il flusso si regge sulle spiegazioni dettagliate
17. Node.js sul PC (rete di sicurezza per check sintassi locali)
18. claude doctor: ok, solo auto-update fallito una volta (fix: rilanciare `irm https://claude.ai/install.ps1 | iex`); Remote Control disabilitato da policy org

## 7. Prassi operative da mantenere

- Prompt per Claude Code: in blocco codice copiabile, un paragrafo per punto (le righe vuote a volte spezzano l'incolla su Windows), sempre chiusi da "verifica automatica + commit e push con messaggio descrittivo in italiano".
- Approvazioni in Claude Code: comandi di lettura (grep/status/find) → sempre sì; rm/delete → controllare i percorsi (ok se Temp o file suoi); "accept edits" (Shift+Tab) ok per lavori lunghi già ben specificati.
- Modifiche = cicli piccoli e verificabili; regole di business nuove → farle scrivere nel CLAUDE.md; niente novità mescolate ai fix nello stesso ciclo.
- Se un tool/prodotto è sconosciuto → cercare sul web prima di dare pareri.
- GDPR: minimizzare i dati personali reali condivisi in chat (utenti anche minori).
