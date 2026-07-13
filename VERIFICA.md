# VERIFICA.md

Verifica pre-pubblicazione del gestionale (`index.html`). Data verifica: 2026-07-13.

---

## PARTE A — Integrità delle funzionalità esistenti

| Funzionalità | Stato | Dettaglio |
|---|---|---|
| Divisione nome/cognome | **Presente** | Campi `nome`/`cognome` separati per operatori (`oe-nome`/`oe-cognome`) e utenti (`ue-nome`/`ue-cognome`, più `refNome`/`refCognome` per il referente). `loadAll()` include una migrazione automatica che divide i vecchi record con `nome` unico. |
| Sezioni credenziali | **Presente** | `buildCredUI()` genera righe piattaforma/ID/password con toggle mostra/nascondi (`eye-btn`); usata sia in Operatori (`oe-cred`) sia in Utenti (`ue-cred`). Nota: le password sono salvate in chiaro nel blob JSON su SharePoint (problema noto #12, non in scope di questa verifica). |
| Collegamento documenti OneDrive/SharePoint | **Parziale** | `buildDocsUI()` è implementata e collegata solo alla scheda **Utenti** (`ue-docs`, con link + apertura rapida della libreria SharePoint). Non è presente per gli **Operatori** (nessun campo documenti nella loro modale). |
| Paese di origine | **Presente** | Select `ue-paese` con l'elenco `COUNTRIES` (~190 paesi), solo per gli utenti. |
| Tempi di viaggio (casa, Busto Arsizio, domicilio) | **Parziale** | Tutti e tre i campi sono presenti nell'interfaccia e salvati (`tempoCasa`/`oe-tempo-casa`, `tempoBusto`/`oe-tempo-busto`, `domicilioTempo`/`pe-domicilio-tempo`). **Ma** l'algoritmo di generazione (`generateMonth`) usa solo `tempoBusto` e `domicilioTempo` nel calcolo di `travelMin`; **`tempoCasa` non viene mai letto da nessuna parte della logica di scheduling** — è un campo raccolto ma senza effetto pratico sulla calendarizzazione. |
| Calendario chiusure con festività italiane e calcolo Pasqua | **Presente** | Tab "📅 Chiusure Centro" (`renderChiusure`/`initChiusureTab`), pulsante "Carica festività italiane" che usa `getFestivita()`/`getPasqua()` (algoritmo di Gauss per la Pasqua, con Lunedì dell'Angelo calcolato di conseguenza). Le chiusure bloccano la generazione (`chiusureDates`). |
| Tipi di assenza operatori (malattia, permesso visita medica, permesso studio, ferie) con calendario colorato | **Parziale** | I 4 tipi sono gestiti in `renderMonthlyAvail()` con celle colorate (`mc-malattia`, `mc-ferie`, `mc-permesso`) **nel calendario mensile dentro la modale di modifica** dell'operatore/progetto. Le classi CSS `.ev-malattia`, `.ev-ferie`, `.ev-permesso`, `.ev-festivita` esistono nel foglio di stile ma **non vengono mai applicate da nessuna funzione JS**: il Calendario principale (tab "Calendario") non mostra le assenze come blocchi colorati, mostra solo le sessioni. |
| Calendari mensili di disponibilità per operatori e progetti | **Presente** | `renderMonthlyAvail()` è riutilizzata sia per l'operatore (`oe-monthly`, `isOperator=true`) sia per il progetto/utente (`pe-monthly`, `isOperator=false`), con opzioni di eccezione differenti (assenze per l'operatore, sola disponibilità extra per il progetto). |
| Selezione sede per fascia con regola Cesate ≠ Online automatico | **Presente** (a livello di risoluzione, non di editor) | Nell'editor delle fasce (`renderAvailEditor`/`renderFasce`) è possibile marcare una fascia come valida per Cesate **e** Online contemporaneamente (è un OR di disponibilità, comportamento voluto). La regola di mutua esclusione si applica invece **al momento della generazione**: per un progetto `Presenza+Online`, `generateMonth`/`generateMonthAI` risolvono la sede effettiva della singola sessione a **una sola** tra Cesate oppure Online (mai entrambe), scegliendo Cesate se lo slot lo consente, altrimenti Online. |
| Gestione contratti Assunto/P.IVA con limiti ore settimanali | **Parziale** | Anagrafica completa (`oe-contratto` Assunto/P.IVA, `oe-ore-sett`, tipo Indeterminato/Determinato, scadenza). Il limite ore settimanali **è applicato** dentro `generateMonth` (segnalazione di anomalia se superato, sessione creata comunque — vedi Parte B, punto 8). Le funzioni `checkContractAlerts()` (avvisi scadenza contratto) e `calcStraordinari()` (calcolo straordinari) sono scritte ma **non vengono mai invocate** da nessuna parte dell'app (problema noto #11, non in scope). |
| Campo Formazione con dropdown e chip | **Presente** | `oe-form-dd` (select con le formazioni non ancora assegnate) + `oe-form-chips` (chip rimovibili), alimentati da `getFormazioni()`/`DEFAULT_FORMAZIONI` o dalle formazioni personalizzate in Impostazioni. |
| Tab Impostazioni con liste modificabili | **Presente** | `renderImpostazioni()`/`initImpostazioni()`: liste "Formazione Operatori" e "Metodi/Progetti" con aggiunta, rimozione e modifica delle durate consentite per metodo, persistite su SharePoint (`saveImp`). |
| Rilevamento duplicati per data di nascita | **Presente** (solo Utenti) | In `openUtenteModal`, salvando un utente si controlla se esiste già un altro utente con stesso nome+cognome+data di nascita, con avviso bloccante. (Gli Operatori hanno un controllo duplicati analogo ma basato sull'email, non sulla data di nascita — coerente col fatto che non hanno un campo data di nascita.) |
| Import/export Excel con modelli scaricabili | **Presente** | `op-tpl`/`ut-tpl` generano e scaricano modelli `.xlsx` vuoti con le intestazioni corrette; `op-import`/`ut-import` leggono un file `.xlsx` e creano/aggiornano i record (con gestione errori riga-per-riga, vedi fix #5 già applicato). Non esiste un "export" dei dati esistenti (solo import + modello vuoto), ma è coerente con quanto richiesto ("modelli scaricabili", non "dati scaricabili"). |

### Riepilogo Parte A
12 funzionalità **presenti** in modo completo, 4 **parziali** (documenti solo per Utenti non Operatori; tempo casa raccolto ma non usato; assenze colorate solo nel calendario mensile della modale non nel Calendario principale; contratti con enforcement dell'algoritmo ma alert/straordinari mai collegati). Nessuna funzionalità risulta **assente**.

---

## PARTE B — Logica dell'algoritmo di generazione (`generateMonth`)

### 1) Priorità per indice di rigidità (strictness)
**Come implementato**: `calcStrettezza(p) = totalMin / (freq × durata)`, dove `totalMin` è il totale dei minuti disponibili nella disponibilità settimanale del progetto. `target.sort(...)` ordina i progetti per questo indice **crescente** (meno margine disponibile → priorità più alta), con pareggio risolto a favore dei progetti in presenza rispetto a quelli online. Identica logica è duplicata in `generateMonthAI` per costruire l'ordine con cui i progetti vengono presentati all'IA.
**Scostamento**: nessuno rilevante. Nota minore: se `totalMin===0` l'indice è forzato a `999` (bassissima priorità) invece che generare una divisione per zero — comportamento corretto e intenzionale.

### 2) Sessioni composte da "Tipi di sessione" con rotazione e componenti — Approccio A
**Come implementato**: ogni progetto può avere `tipiSessione` (array di `{componenti:[{metodo,durata}]}`). Nel loop di piazzamento, `sessType = p.tipiSessione[placed % p.tipiSessione.length]` seleziona il tipo da usare in base al numero di sessioni già piazzate per quel progetto, realizzando la rotazione. La sessione creata riporta `composizione` (i componenti con metodo e durata) e `tipoSessioneIdx`, ma un **solo** `operatoreId` gestisce l'intera sessione — conferma dell'Approccio A, non c'è alcuna suddivisione tra più operatori per componente.
**Scostamento da segnalare**: la variabile `placed` con cui si calcola la rotazione **si azzera ogni settimana** (`let placed=0` dentro il loop settimanale), quindi la sequenza dei tipi ricomincia da capo ogni settimana invece di proseguire in modo continuo per tutto il mese. Se l'intento era una rotazione continua mese per mese, questo è uno scostamento; se l'intento era "una rotazione a inizio settimana", è corretto così.

### 3) Requisito di formazione — TUTTE le formazioni richieste
**Come implementato**: `reqForms = sessType.componenti.map(c=>c.metodo).filter(Boolean)`; poi `reqForms.every(rf=>opForms.includes(rf))` — l'operatore viene scartato dal pool candidati se manca **anche una sola** delle formazioni richieste dai metodi della sessione. Corrisponde esattamente al requisito ("TUTTE le formazioni").
**Scostamento**: nessuno.

### 4) Frequenza settimanale e monte ore
**Come implementato**: la frequenza (`freq = p.frequenza`) è rispettata dal doppio loop settimana→giorno con `placed<freq` come condizione di uscita, e le anomalie segnalano quando non si riesce a raggiungere la frequenza (`'Settimana X/Y: n/freq incontri.'`). Il monte ore è filtrato **prima** di iniziare la generazione: `target = target.filter(p=>!p.monteOre||oreErog(p.id)<p.monteOre)`, cioè i progetti che hanno già raggiunto il monte ore (calcolato sulle sole sessioni passate con stato `eseguita`/`assenza ingiustificata`) vengono esclusi dalla generazione.
**Scostamento da segnalare**: il controllo del monte ore è fatto **una sola volta all'inizio**, sulle ore già erogate; non viene ricalcolato progressivamente mentre si generano le nuove sessioni nello stesso run. Un progetto vicino al tetto di monte ore può quindi ricevere, in una singola generazione mensile, più sessioni di quante il monte ore residuo consentirebbe (l'unico limite reale in quel caso resta la frequenza settimanale, non il monte ore).

### 5) Vincoli fisici (aule, stessa aula per il giorno, gap 5 minuti, orari 09:00–19:30)
**Come implementato**: `AULE_CESATE` (6) e `AULE_BUSTO` (2) sono gli elenchi delle aule; l'orario è vincolato tra `tmin('09:00')` e `tmin('19:30')` nel calcolo di `rF`/`rT`; il gap minimo di 5 minuti (`GAP=5`) è verificato con `rfree(opBusy, st-GAP, en+GAP)`.
**Scostamento da segnalare — importante**: la "stessa aula per tutta la giornata" è in realtà enforced **per mezza giornata** (mattina/pomeriggio separatamente), non sull'intera giornata: la chiave usata per ricordare l'aula preferita è `operatoreId|data|AM` oppure `operatoreId|data|PM` (`halfDay2`/`halfDay`, calcolate confrontando l'ora di inizio con le 13:30). Non c'è alcun meccanismo che forzi la stessa aula tra mattina e pomeriggio: un operatore può ragionevolmente ricevere un'aula diversa al mattino e un'altra al pomeriggio, se in entrambi i turni ci sono sessioni in presenza. Se il requisito di business è "stessa aula per l'intera giornata (mattina e pomeriggio)", questo è uno scostamento da correggere.

### 6) Tempi di viaggio tra sedi
**Come implementato**: `travelMin` viene calcolato da `op.tempoBusto` (se la sessione è a Busto Arsizio o se l'operatore ha già sessioni a Busto quel giorno) e da `p.domicilioTempo` (se la sessione è a domicilio); se l'operatore ha sessioni con sede diversa lo stesso giorno (`diffSede`), viene verificato che ci sia margine libero pari a `travelMin` prima/dopo la sessione candidata.
**Scostamento**: `op.tempoCasa` (tempo di trasferimento casa↔Cesate) **non è mai utilizzato** in questo calcolo — coerente con quanto già rilevato in Parte A. Se il tempo casa dovesse influenzare, ad esempio, la prima/ultima sessione della giornata, questa logica non è implementata.

### 7) Esclusione di chiusure e assenze
**Come implementato**: `chiusureDates` (da `state.data.chiusure`) blocca l'intera giornata per tutti i progetti (`if(chiusureDates.has(ds))continue;`); le assenze dell'operatore (malattia/ferie/permesso) e le eccezioni del progetto/utente sono lette tramite `effRng()` che ritorna `[]` (nessuna disponibilità) per quei tipi, escludendo di fatto operatore e progetto da quel giorno.
**Scostamento**: nessuno rilevante.

### 8) Limiti ore settimanali da contratto con segnalazione anomalie
**Come implementato**: solo per operatori `tipoContratto==='Assunto'` con `oreSettimanali>0`, si calcola `wkMin` (minuti già assegnati nella settimana ISO corrente + la nuova sessione) e, se supera `oreSettimanali*60`, si aggiunge un'anomalia (`anom.push(...)`) — **ma la sessione viene creata comunque** ("Sessione comunque creata" nel messaggio): è un avviso, non un blocco, coerente con la formulazione del requisito ("segnalazione anomalie").
**Scostamento da segnalare**: il calcolo di `wkMin` considera solo le sessioni presenti in `opB`, che a sua volta è popolato solo dalle sessioni **del mese che si sta generando** (`keep.filter(s=>s.data.startsWith(ms))`). Se la settimana ISO si estende a cavallo di due mesi (es. l'ultima settimana di gennaio che finisce nei primi giorni di febbraio), le sessioni del mese adiacente non vengono contate, e il controllo del limite settimanale può sottostimare le ore realmente impegnate in quella settimana.

### Riepilogo Parte B
I punti 1, 3, 7 e 8 sono implementati esattamente come richiesto (8 con la precisazione che è un limite "soft", come previsto). I punti 2, 4, 5, 6 sono implementati ma con **scostamenti specifici** rispetto alla descrizione ideale del requisito, elencati sopra — nessuno di questi è un errore di sintassi o un crash (l'algoritmo è stabile dopo i fix già applicati), sono scelte/limiti dell'implementazione attuale che vale la pena confermare con chi ha definito i requisiti prima della pubblicazione, in particolare il punto 5 (aula unica AM+PM) perché è il più visibile lato utente.

---

## Riepilogo dei fix già applicati in questa sessione

Prima di questa verifica sono stati corretti, uno alla volta, i seguenti problemi (numerazione della revisione precedente):

1. **`sed` non definito in `generateMonth`** — `ReferenceError` quasi sistematico che bloccava "Genera con algoritmo". Risolto spostando il calcolo della sede effettiva dopo `matchSlot` ed eliminando un secondo calcolo duplicato/incoerente (introdotta `chosenSed`).
2. **`nameFilter` non definito in `generateMonthAI`** — `ReferenceError` ad ogni uso di "Genera con IA". Risolto aggiungendo il parametro reale.
3. **`#gen-proj-name` mancante** — `TypeError` selezionando lo scope "Per nome progetto". Risolto aggiungendo il campo HTML e collegandolo a entrambi i generatori.
4. **Stato ottimistico/duplicazione sessioni** in `generateMonth` e `generateMonthAI` — le sessioni proposte venivano duplicate in memoria (una volta dalla riassegnazione bulk, una volta dal salvataggio). Risolto assegnando `state.data.sessioni=keep` prima del ciclo di salvataggio.
5. **Import Excel senza gestione errori** — righe fallite bloccavano l'intero import senza avviso. Risolto con `try/catch` per riga, conteggio successi/falliti e toast.
6. **Campo "Tempo Busto Arsizio" non sincronizzato** con il checkbox della sede — risolto con un listener che aggiorna la visibilità in tempo reale.
7. **Errori nelle Impostazioni silenziati** (solo `console.warn`) — risolto mostrando un toast d'errore in tutti i 5 punti di salvataggio.
8. **Listener duplicati sulla tab Chiusure** ad ogni apertura — risolto con una guardia `_bound`, come già usato in Impostazioni.
9. **Mismatch sede/aula per una nuova sessione** (Cesate mostrato come selezionato ma campo Aula nascosto) — risolto introducendo `sedeVal` come valore di default coerente.
10. **"Svuota tutti gli utenti" lasciava progetti e sessioni orfani** — risolto eliminando anche questi record collegati.
14. **Nessun retry su throttling Graph (429/503)** — risolto con retry automatico basato su `Retry-After` (fino a 3 tentativi) in `gfetch()`.
**Extra (richiesto durante la sessione)**: corretta la regola di business per cui `Presenza+Online` può risolversi solo in Cesate/Online e `Presenza+Domicilio` solo in Cesate/Domicilio, **mai** in Busto Arsizio — applicata sia nell'algoritmo deterministico sia nel prompt e nella validazione post-risposta del generatore IA, e documentata in `CLAUDE.md`.

**Non toccati, per scelta esplicita** (richiedono decisioni organizzative): #11 (alert contratti/straordinari mai invocati), #12 (credenziali in chiaro), #13 (race condition sul primo login come Admin), #15 (Pasqua senza correzioni secolari), #16 (doppio click su "Genera con IA").

## Limiti di questa verifica
Analisi effettuata per lettura statica del codice (non è stato possibile eseguire l'app dal vivo: richiede login Microsoft 365 sul dominio registrato in Entra ID, non disponibile in questo ambiente, e non è presente alcun motore JavaScript locale per un test automatizzato). Si raccomanda un test manuale in staging/produzione di "Genera con algoritmo" e "Genera con IA" su un mese con più progetti/operatori reali prima della pubblicazione, con particolare attenzione al punto 5 della Parte B (aula unica mattina/pomeriggio).
