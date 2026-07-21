# VERIFICA.md

Verifica delle 4 modifiche richieste all'algoritmo e all'interfaccia. Data: 2026-07-13.

---

## 1 — Rotazione tipi di sessione continua sul mese

**Cosa è stato fatto**: in `generateMonth`, la rotazione dei "Tipi di sessione" di un progetto usava `placed % p.tipiSessione.length`, dove `placed` è il contatore settimanale delle sessioni piazzate (si azzerava a ogni nuova settimana: `let placed=0` dentro `while(wk<=days)`). È stato introdotto un nuovo contatore `sessionCount`, dichiarato **una sola volta per progetto** (prima del loop settimanale) e incrementato solo quando una sessione viene effettivamente creata (`placed++;sessionCount++;`). Sia il controllo di formazione (`sessType`) sia la registrazione della sessione (`sessType2`, `tipoSessioneIdx`) ora usano `sessionCount % p.tipiSessione.length` invece di `placed % ...`: la sequenza Tipo1→Tipo2→Tipo1→… prosegue quindi ininterrotta per tutto il mese, indipendentemente dai confini di settimana.

| Parte | Stato |
|---|---|
| `generateMonth` | ✅ Fatto — nuovo contatore `sessionCount` persistente per progetto |
| `generateMonthAI` | ⚠️ Non applicabile — il generatore IA **non implementa affatto** la composizione per "Tipi di sessione" (il campo `tipiSessione`/`metodi` del progetto non viene nemmeno incluso nei dati inviati all'IA, `projData` in `generateMonthAI`). Non essendoci alcun meccanismo di rotazione da correggere in quel percorso, il punto 1 non si applica lì. Se in futuro si vuole che anche il generatore IA componga le sessioni per tipo, è un'estensione a parte (non richiesta ora) e non una correzione di bug. |
| UI | Nessuna modifica necessaria: l'interfaccia di configurazione dei "Tipi di sessione" (`pe-tipi-sess` nella modale progetto) non mostra né dipende dal contatore di rotazione. |
| Dati | Nessun nuovo campo dati richiesto: la rotazione è uno stato interno del calcolo, non persistito sul progetto. |

---

## 2 — Sessioni online da casa o in sede (regola del tempo di viaggio)

**Cosa è stato fatto**:
- Aggiunta una funzione condivisa `decidiOnlineDaCasa(op, sessioniGiorno, st, en)` (usata sia da `generateMonth` sia da `generateMonthAI`) che: individua le sessioni "in presenza" (Cesate/Busto Arsizio) dell'operatore in quella giornata; se la sessione online candidata è **dopo l'ultima presenza**, richiede che il margine fino a quel momento sia ≥ tempo di viaggio (usa `op.tempoCasa` se l'ultima presenza è a Cesate, `op.tempoBusto` se è a Busto Arsizio); se è **prima della prima presenza**, stessa regola simmetrica; se è "incastrata" tra due presenze nello stesso giorno (caso non previsto esplicitamente dalla regola), resta prudenzialmente in sede.
- Una sessione online già risolta "in sede" (perché non c'era margine) **conta essa stessa come presenza fisica** per le decisioni successive nella stessa giornata (l'operatore non è mai uscito dal centro): questo evita che una catena di sessioni online molto vicine tra loro venga erroneamente valutata "da casa" confrontando solo con l'ultima presenza *reale* invece che con l'ultimo momento in cui l'operatore era davvero al centro. Vedi l'esempio concreto sotto.
- In `generateMonth`: quando una sessione online risulta "in sede", viene riutilizzata l'aula già occupata dalla presenza più vicina (o quella assegnata a quel semi-giorno, o una aula libera come ultima risorsa) e registrata come occupata (`auB`), esattamente come per una sessione in presenza. Il flag `onlineDaCasa` (`true`/`false`, `null` se la sessione non è online) è salvato sul record della sessione.
- In `generateMonthAI`: dopo aver ricevuto e validato l'array di sessioni proposto dall'IA, un secondo passaggio deterministico applica **la stessa funzione** `decidiOnlineDaCasa` a ogni sessione con sede "Online", assegna `onlineDaCasa` e, se la sessione resta in sede, ne riusa l'aula della presenza più vicina. La scelta non è mai lasciata all'IA (che potrebbe sbagliare l'aritmetica dei margini): il prompt è stato aggiornato per spiegare la regola all'IA a scopo informativo, ma il risultato finale è sempre ricalcolato in modo deterministico dal codice.
- **UI**: nel Calendario, le sessioni online mostrano ora un'icona 🏠 (da casa) o 🏢 (in sede); nel dettaglio sessione (`openSessionDetail`) compare la riga "Modalità online" con la stessa informazione.
- La vecchia logica ("mantieni l'aula occupata se ci sono sessioni entro 15 minuti") è stata **rimossa** perché era di fatto inattiva: usava una chiave di lookup (`operatoreId|data`, senza distinzione mattina/pomeriggio) che non veniva mai scritta da nessuna sessione generata nello stesso run, solo dalle sessioni preesistenti del mese. La nuova logica basata sul margine di viaggio la sostituisce interamente.

| Parte | Stato |
|---|---|
| `generateMonth` | ✅ Fatto |
| `generateMonthAI` | ✅ Fatto (validazione deterministica post-risposta IA + nota nel prompt) |
| UI | ✅ Fatto (icona nel calendario + riga nel dettaglio sessione) |
| Dati | ✅ Fatto — nuovo campo `onlineDaCasa` (`true`/`false`/`null`) su ogni sessione |

### Esempio concreto (come richiesto)

Operatore **Marco**, `tempoCasa = 30 min` (Cesate → casa e viceversa), sedi abilitate: Cesate + Online. Giornata del 14/07:

| Sessione candidata | Tipo | Calcolo del margine | Esito |
|---|---|---|---|
| 09:00–10:00 | Presenza a Cesate, aula Verde | — | In presenza (riferimento) |
| 10:15–10:45 | Online | Fine ultima presenza 10:00 → inizio online 10:15 = **15 min** < 30 richiesti | ❌ Margine insufficiente → **online in sede**, aula Verde resta occupata, `onlineDaCasa:false` |
| 11:00–11:30 | Online | L'"ultima presenza" ora è la sessione online-in-sede appena decisa (finisce alle 10:45, non più le 10:00): 11:00 − 10:45 = **15 min** < 30 | ❌ Ancora insufficiente → **online in sede** (stessa aula Verde), `onlineDaCasa:false` |
| 11:45–12:15 | Online | Rispetto alla fine dell'ultima occupazione reale (10:45): 11:45 − 10:45 = **60 min** ≥ 30 | ✅ Margine sufficiente → **online da casa**, `onlineDaCasa:true`, nessuna aula |
| 08:40–08:55 | Online (prima della prima presenza) | Fine online 08:55 → inizio presenza 09:00 = **5 min** < 30 | ❌ Margine insufficiente → **online in sede** |
| 08:00–08:30 | Online (prima della prima presenza) | Fine online 08:30 → inizio presenza 09:00 = **30 min** ≥ 30 | ✅ Margine sufficiente → **online da casa** |

Questo esempio mostra perché è stato necessario far "contare" le sessioni online-in-sede come presenza fisica per i calcoli successivi (righe 2→3 della tabella): senza questa correzione, la sessione delle 11:00–11:30 sarebbe stata erroneamente valutata "da casa" confrontando il margine con le 10:00 (fine della presenza reale) invece che con le 10:45 (fine dell'ultima occupazione effettiva).

### Limite noto (da confermare)
La decisione viene presa nell'ordine in cui l'algoritmo genera le sessioni (progetto per progetto, giorno per giorno). Se una sessione online viene valutata **prima** che l'algoritmo abbia ancora generato una presenza dello stesso operatore più avanti nello stesso giorno (perché appartiene a un altro progetto elaborato successivamente), la regola "prima della prima presenza" potrebbe non vedere ancora quella presenza e risolvere "da casa" per default (nessuna presenza nota = nessun vincolo). È un limite intrinseco dell'algoritmo attuale (elabora un progetto alla volta, non l'intera giornata di un operatore in un colpo unico) — riguarda solo il caso, presumibilmente raro, di un operatore con sessioni sparse su più progetti nello stesso giorno. Non l'ho risolto perché richiederebbe una ristrutturazione più ampia (due passate: prima tutte le presenze, poi le sessioni online), non richiesta in queste 4 modifiche.

---

## 3 — Fascia oraria nelle assenze (permesso visita medica, permesso studio, ferie)

**Cosa è stato fatto**:
- **Dati**: le eccezioni di tipo `ferie`, `permesso_visita`, `permesso_studio` possono ora avere due campi opzionali `da`/`a` (orario). Se assenti, l'assenza vale l'intera giornata (comportamento identico a prima → **retrocompatibile** con tutte le assenze già salvate). `malattia` non ha mai la fascia oraria (resta sempre giornata intera, come richiesto).
- **Logica di disponibilità** (`effRng`, usata sia per operatori sia per progetti/utenti, quindi sia da `generateMonth` sia dagli editor UI): quando è presente una fascia, viene sottratta (nuova funzione `subtractWindow`) dalla disponibilità normale di quel giorno della settimana, spezzando eventualmente una fascia di disponibilità in due se l'assenza cade nel mezzo. L'operatore/progetto resta quindi disponibile nelle ore fuori dalla fascia di assenza.
- Rimosso in `generateMonth` un controllo ridondante (e ora sbagliato) che saltava **l'intera giornata** per un progetto con eccezione malattia/ferie/permesso, ignorando la fascia oraria: la logica corretta passa ora esclusivamente per `effRng`.
- **UI** (`renderMonthlyAvail`, editor mensile delle assenze operatore): per i tipi ferie/permesso visita/permesso studio compare un campo "Fascia oraria (facoltativa)" con due orari; se lasciati entrambi vuoti l'assenza è sull'intera giornata (con validazione: non è permesso indicare solo uno dei due orari). Il calendario mensile colorato mostra ora la fascia nel tooltip del giorno (es. "🏖 Ferie 14:00-18:00") quando presente, oppure "(giornata intera)" quando assente.
- **`generateMonthAI`**: il campo `eccezioni` degli operatori inviato nel prompt già includeva `e.da`/`e.a` quando presenti (codice preesistente) — scegliendo questi stessi nomi di campo per la nuova fascia, il dato arriva automaticamente e correttamente all'IA (es. `"2026-07-14 ferie 14:00-18:00"`) senza bisogno di modifiche aggiuntive. È stata comunque aggiunta una riga esplicita ai VINCOLI del prompt per chiarire che un'eccezione con orario vale solo per quella fascia.

| Parte | Stato |
|---|---|
| Dati (`eccezioni`) | ✅ Fatto — campi `da`/`a` opzionali, retrocompatibili |
| `effRng` (disponibilità) | ✅ Fatto — nuova funzione `subtractWindow` |
| `generateMonth` | ✅ Fatto — rimosso il controllo ridondante che ignorava la fascia |
| `generateMonthAI` | ✅ Fatto — dato già veicolato automaticamente, chiarito nel prompt |
| UI editor assenze | ✅ Fatto — campo fascia oraria facoltativo con validazione |
| UI calendario colorato | ✅ Fatto — fascia mostrata nel tooltip del giorno |

### Nota (limite preesistente, non introdotto da questa modifica)
Le eccezioni di tipo ferie/permesso/malattia sono selezionabili solo per gli **operatori**: l'editor mensile per i progetti/utenti (`isOperator=false`) offre solo l'opzione "Disponibile" nel menu Tipo, quindi un progetto non può avere oggi un'assenza di questi tipi tramite interfaccia (né con né senza fascia). Inoltre le eccezioni progetto/utente non vengono comunque inviate a `generateMonthAI` (il campo non è incluso in `projData`) — è un limite preesistente e indipendente da questa modifica, che non ho toccato perché non richiesto nei 4 punti.

---

## 4 — Ordinamento utenti nella sezione Progetti (Cognome Nome)

**Cosa è stato fatto**: aggiunta una nuova funzione `fullNameCN(r)` (Cognome Nome, simmetrica alla già esistente `fullName` che fa Nome Cognome), applicata nei due punti della sezione Progetti dove compaiono utenti:
- **Elenco progetti** (`renderProgetti`): la colonna "Utente" mostra ora "Cognome Nome"; l'ordinamento della tabella (che segue l'utente associato) confronta ora `cognome+nome` invece di solo `nome`.
- **Modale progetto** (`openProgettoModal`, dropdown "Utente \*"): le opzioni mostrano "Cognome Nome"; l'ordine delle opzioni era già corretto (la funzione `sortN`, già usata per popolare la select, ordina per cognome+nome — riutilizzata senza modifiche).

| Parte | Stato |
|---|---|
| Elenco progetti (`renderProgetti`) | ✅ Fatto — visualizzazione e ordinamento |
| Dropdown utente in modale progetto (`pe-utente`) | ✅ Fatto — visualizzazione (ordinamento già corretto) |
| Altre sezioni (Calendario, Sessioni, Genera, Assistente) | Non toccate intenzionalmente: la richiesta era scoped a "nella sezione progetti"; altrove l'app continua a mostrare "Nome Cognome" com'era prima. |

---

## Verifica automatica finale

| Punto | UI | Dati | `generateMonth` | `generateMonthAI` | Esito |
|---|---|---|---|---|---|
| 1. Rotazione continua tipi di sessione | n/a | n/a | ✅ | n/a (funzione non implementata lì) | **Completo per la parte esistente** |
| 2. Online da casa/in sede | ✅ | ✅ (`onlineDaCasa`) | ✅ | ✅ | **Completo**, con limite noto sull'ordine di elaborazione documentato sopra |
| 3. Fascia oraria nelle assenze | ✅ | ✅ (`da`/`a` retrocompatibili) | ✅ | ✅ (automatico + prompt aggiornato) | **Completo** per gli operatori (unico caso già supportabile da UI) |
| 4. Ordinamento utenti in Progetti | ✅ | n/a | n/a | n/a | **Completo** |

**Cosa manca / non è stato toccato, e perché**:
- Il generatore IA non compone le sessioni per "Tipi di sessione" (punto 1/2 del vecchio report B): non essendo un bug introdotto né toccato oggi, non l'ho implementato — resterebbe un'estensione futura separata.
- Le assenze ferie/permesso/malattia per i progetti/utenti (non operatori) non sono selezionabili da UI né inviate all'IA: limite preesistente, non in scope.
- L'ordine di elaborazione greedy (progetto per progetto) può, in casi rari con più progetti sullo stesso operatore nello stesso giorno, valutare una sessione online "prima della prima presenza" senza ancora conoscere una presenza che verrà generata più avanti nello stesso run: documentato come limite noto del punto 2, non risolto (richiederebbe una ristrutturazione a due passate).

## Limiti di questa verifica
Analisi per lettura statica del codice: non è stato possibile eseguire l'app dal vivo (richiede login Microsoft 365 su dominio registrato, non disponibile in questo ambiente) né un motore JavaScript locale per un test automatizzato. L'esempio del punto 2 è stato verificato "a mano" ripercorrendo il codice riga per riga con valori concreti, non eseguendo realmente `generateMonth`. Si raccomanda un test manuale in staging/produzione su un operatore con sessioni miste presenza/online nello stesso giorno prima di considerare il punto 2 definitivamente validato.

---

# Verifica — Vista cliente per operatori, consuntivazione sessioni, rimozione Bulk

Tre nuove funzionalità richieste. Data: 2026-07-13.

## 1 — Vista anagrafica cliente in sola lettura per gli operatori

**Cosa è stato fatto**:
- Nuova funzione `openUtenteReadonly(u)`: mostra nome/cognome utente, data di nascita, nome/cognome referente, telefono, email, indirizzo completo, paese, credenziali piattaforme (con occhio mostra/nascondi password, nessun campo modificabile), documenti collegati (solo link "Apri", nessun input/aggiungi/rimuovi) e note. L'intera modale ha un solo bottone: "Chiudi". Nessun input è editabile, nessun bottone salva/elimina.
- **Punto di accesso "naturale"**: in `openSessionDetail` (il dettaglio sessione, già raggiungibile dal Calendario cliccando una sessione e dalla tab Sessioni cliccando una riga — entrambe le vie già disponibili per l'operatore) il nome dell'utente nel titolo è ora un link cliccabile che apre `openUtenteReadonly`. Poiché le sessioni visibili a un Operatore sono già filtrate a sole quelle a lui assegnate (`sessioniVisibili()`), l'accesso a questa vista è automaticamente scoped ai clienti dei propri progetti/sessioni, senza bisogno di controlli aggiuntivi.
- **Non implementato**: l'accesso "dal progetto" citato come esempio nella richiesta — gli operatori non hanno (e non avevano già prima di questa modifica) alcuna tab "Progetti"; ho quindi implementato solo la via "dalla sessione", che è l'unica concretamente disponibile nell'interfaccia attuale. **Caso limite non coperto**: se un operatore è assegnato a un progetto (`operatoriAmmessi`) ma per quel progetto non esiste ancora nessuna sessione (calendario non ancora generato), non ha alcun modo di consultare l'anagrafica di quel cliente finché non viene creata almeno una sessione. Se questo caso è rilevante in pratica, andrebbe aggiunta una vista "I miei progetti" per gli operatori — non l'ho fatto perché non richiesto esplicitamente e sarebbe una nuova superficie UI, non una semplice apertura di una vista già esistente.

### Verifica esplicita: un Operatore non ha alcun modo di modificare l'anagrafica

| Livello di protezione | Prima di questa modifica | Dopo |
|---|---|---|
| Nav UI | La tab "Utenti" non viene mai creata per il ruolo Operatore (`TABS.Operatore` non la include) | Invariato |
| Funzione `showTab(id)` | **Nessun controllo di ruolo**: chiamando `showTab('utenti')` manualmente (es. dalla console del browser) si sarebbe comunque potuta rendere visibile la sezione Utenti con i suoi bottoni "+ Nuovo utente" ed "Elimina" | **Corretto**: `showTab()` ora verifica che l'id richiesto sia tra quelli ammessi per `TABS[state.role]`; se non lo è, la chiamata non ha alcun effetto |
| Funzione `openUtenteModal()` (la modale di modifica/creazione) | Nessun controllo interno: chiunque potesse invocarla (es. da console) poteva creare/modificare/eliminare utenti | **Corretto**: la funzione ora rifiuta l'esecuzione con un avviso se `state.role!=='Admin'`, indipendentemente da come viene chiamata |
| Vista di consultazione dell'operatore | Non esisteva | `openUtenteReadonly()` — nessun input, nessun bottone di salvataggio/eliminazione nel markup generato |

**Limite intrinseco, non risolvibile in questo file**: la protezione qui descritta è interamente lato client (JavaScript). Il token Microsoft Graph di un operatore ha lo stesso scope (`Sites.ReadWrite.All`) di quello di un Admin — necessario perché anche l'operatore deve poter scrivere legittimamente (proprie disponibilità, note, esito sessione). Questo significa che un operatore tecnicamente capace potrebbe, aprendo la console del browser, chiamare direttamente `saveRecord('utenti', {...})` bypassando **tutta** l'interfaccia (comprese le due protezioni appena aggiunte, che sono nel percorso della UI ma non dentro `saveRecord` stesso) — a meno che i permessi della lista SharePoint "Gestionale_Utenti" non siano configurati per negare la scrittura al gruppo Operatori a livello di sito. Questo è un limite architetturale preesistente e comune a **tutte** le altre sezioni Admin-only (Progetti, Operatori, Chiusure, Impostazioni), non specifico di questa funzionalità: la vera garanzia di sola lettura per un utente esterno alla UI richiede un intervento di permessi SharePoint, non ottenibile da `index.html`. Le due protezioni aggiunte (`showTab`, `openUtenteModal`) coprono comunque tutto l'uso reale dell'app (nessun pulsante, link o percorso di navigazione porta un Operatore a modificare un'anagrafica), che è l'obiettivo concreto della richiesta.

| Parte | Stato |
|---|---|
| UI vista sola lettura | ✅ Fatto (`openUtenteReadonly`) |
| Punto di accesso dalla sessione | ✅ Fatto (nome utente cliccabile in `openSessionDetail`) |
| Punto di accesso dal progetto | ⚠️ Non implementato — nessuna tab Progetti per l'operatore (limite preesistente) |
| Permessi: nessun modo di modificare (via UI) | ✅ Verificato e rinforzato (`showTab` + `openUtenteModal` ora controllano il ruolo) |
| Permessi: nessun modo di modificare (via Graph/console) | ⚠️ Non risolvibile da questo file — richiede permessi a livello di lista SharePoint |

---

## 2 — Consuntivazione sessioni da parte dell'operatore

**Cosa è stato fatto**:
- **Nota operatore** (a): il campo esisteva già ed era già salvabile da chiunque apra il dettaglio sessione; non ho dovuto crearlo, solo integrarlo nel nuovo flusso di salvataggio unico.
- **Esito sessione** (b): in `openSessionDetail`, quando la sessione è modificabile da chi la sta visualizzando (`canEdit`, vedi sotto), compare un nuovo campo "Esito sessione" con select limitata a **eseguita / annullata / assenza ingiustificata** (le uniche 3 richieste — non "proposta"/"confermata", che restano gestibili solo dall'Admin tramite "Modifica"). Il salvataggio (bottone unico "💾 Salva") aggiorna sia `noteOperatore` sia, se selezionato un valore, `stato`.
- **Permessi**: `canEdit = isAdmin || (Operatore && sessione assegnata a me)`. Se `canEdit` è falso, il campo Esito non viene nemmeno generato, la nota diventa `readonly` e il bottone Salva non viene creato. In pratica, dato che un Operatore vede solo le proprie sessioni (`sessioniVisibili()`), questa condizione è sempre vera per ciò che l'operatore può effettivamente apire — il controllo è comunque implementato esplicitamente (non per accidente del filtro a monte) per rispondere esattamente al requisito "solo delle proprie sessioni".
- **Logica monte ore** (già corretta, verificata): `oreErog(pid)` conta le ore di `eseguita` **e** `assenza ingiustificata`, esclude `annullata` — esattamente la regola richiesta. Non ho dovuto modificare questa funzione. Ho verificato tutti i suoi punti di utilizzo (elenco progetti, filtro progetti da calendarizzare in `generateMonth` e `generateMonthAI`): tutti ereditano automaticamente la logica corretta.
- **Correzioni di coerenza collegate** (perché una `assenza ingiustificata` è un fatto storico "consumato" al pari di `eseguita`, non una proposta da rigenerare):
  - `generateMonth`/`generateMonthAI`: le sessioni del mese da **conservare** (non rigenerare) ora includono anche quelle con stato `assenza ingiustificata`, non solo `eseguita` (prima sarebbero state cancellate e potenzialmente ri-schedulate a ogni rigenerazione del mese, nonostante contassero già nel monte ore).
  - `generateMonthAI`: le sessioni "già eseguite (non modificare)" indicate all'IA includono ora anche quelle in `assenza ingiustificata`.
  - "🗑 Svuota proposte del mese": non elimina più le sessioni in `assenza ingiustificata` insieme alle proposte (prima veniva eliminato tutto ciò che non era `eseguita`).
  - Calendario: le sessioni in `assenza ingiustificata` mostrano ora un'icona ⚠ (come `eseguita` mostra ✓ e `annullata` mostra ✕).

| Parte | Stato |
|---|---|
| UI nota operatore | ✅ Già presente, integrata nel nuovo flusso |
| UI esito sessione (select limitata a 3 stati) | ✅ Fatto |
| Permessi (operatore solo proprie, admin tutte) | ✅ Fatto — controllo esplicito `canEdit` |
| Logica monte ore (`oreErog`) | ✅ Già corretta, verificata in tutti i punti d'uso |
| Coerenza generazione/pulizia con `assenza ingiustificata` | ✅ Fatto (4 correzioni collegate elencate sopra) |

**Non toccato, fuori scope**: `calcStraordinari()` (calcolo straordinari operatore, concetto diverso dal monte ore progetto) resta funzione morta/non invocata come già documentato nella verifica precedente — non related al monte ore progetto, quindi non l'ho modificata.

---

## 3 — Rimozione pulsante Bulk

**Cosa è stato fatto**: rimosso l'elemento `<button id="cal-bulk">+ Bulk</button>` dalla vista Calendario e la relativa riga che ne gestiva la visibilità in `renderCalendar()` (`$('#cal-bulk').classList.toggle('hidden',!isAdmin)`). Verificato che non esistesse alcun `addEventListener` collegato all'id `cal-bulk` altrove nel file (confermato via ricerca testuale): il pulsante era davvero senza alcuna funzione collegata, come segnalato.

| Parte | Stato |
|---|---|
| Rimozione elemento HTML | ✅ Fatto |
| Rimozione gestione visibilità | ✅ Fatto |
| Verifica assenza di listener orfani | ✅ Verificato — nessuno presente |

---

## Verifica automatica finale (i 3 punti)

| Punto | UI | Permessi per ruolo | Logica monte ore | Esito |
|---|---|---|---|---|
| 1. Vista anagrafica sola lettura | ✅ | ✅ (rinforzata: `showTab` + `openUtenteModal`) | n/a | **Completo per la sessione**; accesso "dal progetto" non implementato (nessuna tab progetti per operatori, limite preesistente) |
| 2. Consuntivazione sessioni | ✅ | ✅ (`canEdit` esplicito) | ✅ (già corretta + 4 coerenze collegate) | **Completo** |
| 3. Rimozione Bulk | ✅ | n/a | n/a | **Completo** |

**Riepilogo di cosa manca**:
- Punto 1: nessun accesso "dal progetto" per l'operatore (non esiste una tab Progetti per quel ruolo); resta solo l'accesso dalla sessione, che copre l'uso reale dell'app ma non il caso limite di un progetto assegnato senza ancora nessuna sessione generata.
- Punto 1 (permessi): la sola-lettura è garantita a livello di interfaccia (rinforzata anche contro l'uso della console del browser per le funzioni toccate), ma **non** a livello di permessi SharePoint/Graph — un limite architetturale di tutta l'app, non specifico di questa funzionalità, che richiederebbe una configurazione lato Microsoft 365 fuori dalla portata di questo file.
- Nessun'altra lacuna rilevata per i punti 2 e 3.

## Limiti di questa verifica
Come per le verifiche precedenti: analisi per lettura statica del codice, senza possibilità di eseguire l'app dal vivo né un motore JavaScript locale. Si raccomanda un test manuale in staging con un account Operatore reale per confermare visivamente: (a) l'apertura della vista cliente in sola lettura dal dettaglio sessione; (b) il salvataggio di esito e nota su una propria sessione; (c) l'impossibilità di raggiungere in qualunque modo dall'interfaccia la modale di modifica utenti.

---

# Verifica — Ristrutturazione a due passate di `generateMonth`

Quattro interventi sull'algoritmo di generazione. Data: 2026-07-13.

## 1 — Architettura a due passate

**Cosa è stato fatto**: estratte 5 funzioni condivise (usate sia da `generateMonth` sia da `generateMonthAI`):
- `determinaAmbito(spid, nameFilter)` — calcola i progetti in ambito (scope) per il run corrente.
- `sessioniDaConservare(ms, scopeIds)` — le sessioni da NON toccare (vedi punto 4).
- `sedePriorita(sede)` — priorità di piazzamento per sede (vedi punto 2).
- `minutiSettimana(op, ds, opB, Y, M)` — minuti già assegnati all'operatore nella settimana ISO che contiene `ds` (fattorizzata dal calcolo che già esisteva solo per l'anomalia contrattuale, ora riusata anche per la priorità Assunti del punto 3).
- `risolviOnlineDaCasa(ms, newS, keep)` — la Passata 2.

**Passata 1** (dentro il ciclo di piazzamento di `generateMonth`, e nel ciclo di validazione della risposta IA in `generateMonthAI`): piazza tutte le sessioni (disponibilità, aule, gap 5 min, rotazione tipi, vincoli di formazione/frequenza/monte ore/orario di viaggio Cesate↔Busto) esattamente come prima, con un'unica differenza: quando la sede risolta è `Online`, non decide più nulla — il campo `onlineDaCasa` viene creato `null` e nessuna aula viene riservata in questa fase.

**Passata 2** (`risolviOnlineDaCasa`, chiamata una sola volta a fine generazione, sia in `generateMonth` sia in `generateMonthAI`): raggruppa **tutte** le sessioni del mese per operatore+giorno (unendo le nuove sessioni appena piazzate e quelle conservate/fuori ambito — quindi anche sessioni di progetti non in questo run), le ordina cronologicamente, e per ogni sessione Online **appena creata** applica `decidiOnlineDaCasa()` (la stessa funzione già esistente da un intervento precedente: margine di viaggio rispetto alla presenza più vicina, con le online-in-sede già decise che contano a loro volta come presenza). Le sessioni conservate non vengono mai modificate da questa passata (nemmeno il loro `onlineDaCasa`), solo lette come contesto.

| Parte | Stato |
|---|---|
| `generateMonth` — Passata 1 (piazzamento senza decisione online) | ✅ Fatto |
| `generateMonth` — Passata 2 (risoluzione online cronologica, cross-progetto) | ✅ Fatto |
| `generateMonthAI` — stessa struttura a due passate sulla validazione post-IA | ✅ Fatto |
| Riuso della logica esistente (online-in-sede conta come presenza, riuso aula) | ✅ Invariata, richiamata da entrambe le passate 2 |

## 2 — Priorità di piazzamento per sede

**Cosa è stato fatto**: il criterio di ordinamento secondario (usato solo a parità di indice di rigidità) è passato da un confronto binario "online sì/no" a `sedePriorita(sede)`: `0` per Cesate/Busto Arsizio (presenza), `1` per Presenza+Online/Presenza+Domicilio (composita), `2` per Online/Domicilio (remota). Applicato sia in `generateMonth` sia in `generateMonthAI` (che lo usa per ordinare `projData` prima di passarlo all'IA). Aggiunta anche una riga informativa nel prompt IA con la stessa regola (l'IA non ha un ordinamento deterministico enforced, ma viene istruita a rispettarlo).

| Parte | Stato |
|---|---|
| `generateMonth` | ✅ Fatto (`sedePriorita`) |
| `generateMonthAI` | ✅ Fatto per l'ordinamento dei dati + istruzione nel prompt (non enforced deterministicamente, l'IA decide comunque l'assegnazione finale) |

## 3 — Priorità agli Assunti sotto monte ore

**Cosa è stato fatto**: prima di iterare il pool di operatori idonei per uno slot candidato, `generateMonth` ora ordina il pool (`poolOrdinato`) mettendo per primi gli operatori `Assunto` con `oreSettimanali>0` che non hanno ancora raggiunto quel monte ore nella settimana corrente (`minutiSettimana(...) < oreSettimanali*60`); tutti gli altri (P.IVA, o Assunti già al/sopra il monte ore) restano nell'ordine originale del pool, ma dopo. Essendo `Array.prototype.sort` stabile in JavaScript, la preferenza tra operatori altrimenti equivalenti non viene alterata arbitrariamente. Il calcolo si aggiorna dinamicamente man mano che la generazione procede (usa lo stesso `opB` che si popola progressivamente). Aggiunta anche una riga informativa nel prompt IA (non enforced).

| Parte | Stato |
|---|---|
| `generateMonth` | ✅ Fatto (`poolOrdinato`, ricalcolato per ogni slot candidato) |
| `generateMonthAI` | ⚠️ Solo istruzione informativa nel prompt — l'IA non ha un meccanismo di scelta operatore su cui applicare un ordinamento deterministico (decide lei stessa; non c'è nulla da validare post-hoc per questo criterio, a differenza delle regole sulla sede) |

## 4 — Perimetro di intervento e sessioni confermate

**Cosa è stato fatto**:
- `determinaAmbito()` calcola `scopeIds` (i progetti selezionati: singolo/per nome/tutti gli attivi).
- `sessioniDaConservare(ms, scopeIds)` sostituisce il vecchio `keep`: ora conserva **tutto tranne** le sessioni `proposta` di progetti in `scopeIds`. Questo significa che, a differenza di prima, le sessioni `confermata` **non vengono più cancellate/ricreate** a ogni rigenerazione (era un bug pre-esistente: il vecchio filtro considerava "da conservare" solo `eseguita`/`assenza ingiustificata`, quindi una sessione confermata dentro il mese generato veniva silenziosamente scartata e potenzialmente rimpiazzata). Le proposte di progetti fuori ambito sono ugualmente protette.
- Tutte le sessioni conservate (tranne le `annullata`, che rappresentano uno slot liberato) pre-popolano i tracciamenti di occupazione operatore/aula **prima** che la Passata 1 inizi a piazzare — quindi occupano davvero operatore e aula durante la generazione, come richiesto.
- **`generateMonthAI`**: stessa logica di ambito/conservazione. In più, ho aggiunto una validazione che prima non esisteva: ogni sessione proposta dall'IA viene ora scartata (con anomalia) se si sovrappone, per operatore o per aula, a una sessione protetta/fuori ambito — prima l'IA veniva informata delle sole sessioni "già eseguite" ma non c'era alcun controllo automatico di conflitto.
- **"🗑 Svuota proposte del mese"**: ora legge anche lo scope selezionato (`#gen-scope`/`#gen-proj-sel`/`#gen-proj-name`, con lo stesso `determinaAmbito()`) ed elimina solo le sessioni `proposta` **in ambito** — prima eliminava indiscriminatamente tutto ciò che non era `eseguita`/`assenza ingiustificata` nel mese, incluse le `confermata` e le proposte di progetti non selezionati.

| Parte | Stato |
|---|---|
| `generateMonth` (cancellazione/ricreazione solo proposte in ambito) | ✅ Fatto |
| `generateMonthAI` (stessa regola + validazione conflitti contro vincoli attivi) | ✅ Fatto |
| "Svuota proposte del mese" (solo proposte in ambito) | ✅ Fatto |
| Sessioni intoccabili/fuori ambito trattate come vincoli attivi (occupano operatore/aula) | ✅ Fatto (tranne `annullata`, per scelta esplicita — vedi sotto) |

### Decisione interpretativa non esplicitata dalla richiesta
La richiesta elenca come "intoccabili" `confermata`, `eseguita` e `assenza ingiustificata`, e dice che "tutte le sessioni intoccabili e quelle fuori ambito restano vincoli attivi". Non specifica il trattamento di `annullata` (che comunque non è cancellabile, perché la regola ammette la cancellazione delle sole `proposta`). Ho scelto di **non farla contare come vincolo attivo** (un operatore/aula "annullata" sono di nuovo liberi per quello slot) ma di **conservarla comunque** (non viene cancellata). Motivazione: "annullata" significa letteralmente che l'appuntamento è stato disdetto — trattarla come se occupasse ancora l'aula sarebbe controintuitivo e impedirebbe di riutilizzare quello slot. Se l'intento reale era diverso (annullata anch'essa vincolo attivo), è una riga sola da cambiare in `generateMonth`, `risolviOnlineDaCasa` e nella pre-popolazione di `generateMonthAI` (tutte e tre usano lo stesso filtro `stato!=='annullata'`).

---

## Verifica automatica con esempio concreto multi-progetto

**Scenario**: mese 2026-07. Operatrice **Giulia Neri**, P.IVA, `tempoCasa = 20 min`, sedi abilitate Cesate + Online.

- **Progetto B — "Feuerstein BS1, cliente Bianchi"** (fuori ambito in questo run): il 2026-07-20 ha già una sessione **confermata** 09:00–10:00, sede Cesate, aula **Gialla**, con Giulia come operatrice. Creata in un run precedente.
- **Progetto A — "BrainRx, cliente Rossi"** (unico progetto in ambito: l'admin lancia "Genera con algoritmo" scegliendo "Singolo progetto → BrainRx, cliente Rossi"): sede Online, frequenza 2/settimana, durata 30 min, unico operatore ammesso Giulia.

**Esecuzione di `generateMonth('2026-07', idProgettoA, null)`**:

1. `determinaAmbito(idProgettoA, null)` → `scopeIds = {A}`. Il Progetto B non è in ambito.
2. `sessioniDaConservare('2026-07', {A})` → la sessione di B è conservata per **due motivi indipendenti**: non è `proposta`, e comunque B non è in `scopeIds`.
3. Pre-popolazione vincoli (Passata 1): la sessione confermata di B (non annullata) occupa `opB['Giulia']` (09:00–10:00) e `auB['Gialla']` (09:00–10:00).
4. **Passata 1** piazza per il Progetto A una sessione il 2026-07-20 alle **10:15–10:45**, sede Online (nessun conflitto con l'occupazione di Giulia 09:00-10:00, e nessun vincolo di viaggio applicabile in questa fase perché Online non richiede spostamento fisico). `onlineDaCasa` resta `null`, `aula` resta `null`.
5. **Passata 2** (`risolviOnlineDaCasa`): raccoglie **tutte** le sessioni di Giulia del 2026-07-20 — inclusa quella del Progetto B, mai toccata da questo run — le ordina cronologicamente: [B 09:00–10:00 Cesate, A 10:15–10:45 Online]. Per la sessione online di A chiama `decidiOnlineDaCasa`: l'unica presenza della giornata è B (Cesate, aula Gialla), che finisce alle 10:00; il margine fino alle 10:15 è **15 minuti**, inferiore ai 20 minuti di `tempoCasa` di Giulia → **margine insufficiente**.
6. Risultato sulla sessione di A: `onlineDaCasa: false`, `aula: "Gialla"` (riusata dalla sessione di B, che è nella stessa lista di aule Cesate).

**Cosa dimostra**: il Progetto B non è mai stato incluso in `target`, non ha mai generato nulla, non è stato cancellato né risalvato — eppure ha correttamente **vincolato** sia la disponibilità di Giulia (Passata 1, se A avesse provato a piazzare qualcosa alle 09:30 sarebbe stato respinto) sia la decisione online/in-sede del Progetto A (Passata 2), esattamente come richiesto dal punto 4 ("tutte le sessioni intoccabili e quelle fuori ambito restano vincoli attivi"), risolto però solo nella Passata 2 come richiesto dal punto 1.

### Esempi minori (punti 2 e 3, tracciati a mano sul codice)
- **Punto 2**: due progetti con lo stesso indice di rigidità (`calcStrettezza`), uno a Cesate e uno Online. Prima: ordine indeterminato tra i due (la vecchia regola distingueva solo "online sì/no", trattando Cesate e Domicilio come equivalenti). Ora: `sedePriorita('Cesate')=0` vs `sedePriorita('Online')=2` → il progetto Cesate viene sempre piazzato per primo a parità di rigidità, quindi in caso di scarsità di slot (stesso operatore/stessa fascia) vince la sessione in presenza.
- **Punto 3**: pool di due operatori idonei per uno slot: Marco (P.IVA) e Sara (Assunta, 20h/settimana, già a 15h quella settimana). `poolOrdinato` metterà Sara prima di Marco anche se nell'elenco `operatoriAmmessi` del progetto Marco era stato aggiunto prima — perché `15h<20h` la rende prioritaria. Se Sara avesse già raggiunto le 20h, l'ordine tornerebbe quello originale (entrambi priorità 1).

## Cosa manca
- Punto 3 non è applicabile a `generateMonthAI` in modo deterministico (solo istruzione nel prompt) — l'IA decide autonomamente l'operatore, non c'è un "pool ordinato" su cui intervenire dal codice.
- L'interpretazione di `annullata` come "non vincolante" (vedi sopra) è una scelta esplicita non confermata dal testo della richiesta — da validare con chi ha definito i requisiti.
- Non è stato verificato dal vivo (nessun ambiente di test disponibile in questa sessione): raccomando un test manuale in staging con il caso reale descritto sopra (operatore con sessioni confermate fuori ambito + progetto in ambito misto presenza/online lo stesso giorno) prima della pubblicazione.
- Durante la verifica ho notato — ma non modificato, perché fuori dai 4 punti richiesti — che il controllo del gap di 5 minuti tra sessioni (`if(!rfree(opBusy,st-GAP,en+GAP)&&!rfree(opBusy,st,en))continue;`) è logicamente ridondante rispetto al controllo di sovrapposizione stretta immediatamente successivo (una vera sovrapposizione implica sempre anche la violazione del gap, quindi l'AND tra i due equivale al solo controllo stretto): in pratica il gap minimo di 5 minuti non risulta mai imposto come vincolo autonomo. Segnalo la cosa per una eventuale correzione futura, separata da questa richiesta.

---

# Verifica — Passata 3 di riparazione e report unico di generazione

Due aggiunte al generatore. Data: 2026-07-13.

## 1 — Passata 3 di riparazione completezza

**Cosa è stato fatto**: dopo la Passata 1 (piazzamento) e prima della ri-valutazione finale della Passata 2, `generateMonth` esegue una nuova Passata 3 che, per ogni carenza rilevata (progetto/settimana con `piazzate < richieste`, escluse quelle dovute solo a disponibilità utente insufficiente — vedi limite sotto), prova a recuperare le sessioni mancanti:
- **Solo sessioni "proposta" in ambito** possono essere spostate: la funzione `trovaAlternativaBlocker()` cerca, per la sessione che blocca lo slot, un'alternativa valida nella **stessa settimana**, con lo stesso operatore, verificando tutti i vincoli (disponibilità progetto/operatore, sede, gap, aula, utente non doppio-impegnato) — esclude dal controllo la propria occupazione attuale per non auto-bloccarsi.
- **Due fasi**: prima si tenta usando solo operatori Assunti (`poolCompleto.filter(o=>o.tipoContratto==='Assunto')`), poi si estende a tutto il pool ammesso.
- **Nessuna mossa se il blocco non è modificabile**: se la sessione che occupa lo slot è `confermata`/`eseguita`/`assenza ingiustificata`, oppure una `proposta` di un progetto fuori ambito, la mossa non viene eseguita; viene invece registrato un suggerimento testuale (con destinazione calcolata, quando il blocco è una proposta fuori ambito, per renderlo concreto come nell'esempio della richiesta).
- **Limite di iterazioni**: un contatore globale `mosseTentate` con tetto `MAX_MOSSE=40` interrompe la Passata 3 anche se restano carenze irrisolte.
- **Compattezza**: tra più alternative valide per il blocco, `trovaAlternativaBlocker()` sceglie quella con il minor `gapMinutiGiorno()` (minuti di vuoto tra le sessioni in presenza di quell'operatore in quella giornata, ipotizzando l'inserimento) — ma solo per le sedi in presenza, come richiesto ("giornate con presenza").
- **Ri-valutazione della Passata 2**: dopo la Passata 3, `risolviOnlineDaCasa()` viene richiamata di nuovo sull'intero `newS`/`keep` aggiornato, così le sessioni spostate (che possono cambiare giorno/sede) vengono ricalcolate correttamente per online-da-casa/in-sede.
- **Rotazione dei "Tipi di sessione"**: le sessioni recuperate in Passata 3 continuano la stessa rotazione della Passata 1 (nuova mappa `sessionCountByProject`, popolata a fine Passata 1 e incrementata dalle riparazioni), quindi rispettano comunque il vincolo di formazione se il progetto usa `tipiSessione`.

| Parte | Stato |
|---|---|
| Ricerca mosse solo su "proposta" in ambito | ✅ Fatto |
| Due fasi (Assunti poi tutti) | ✅ Fatto |
| Nessuna mossa su fuori ambito/confermate + suggerimento registrato | ✅ Fatto |
| Rivalutazione con la Passata 2 | ✅ Fatto (richiamata di nuovo dopo la Passata 3) |
| Limite iterazioni | ✅ Fatto (`MAX_MOSSE=40`) |
| Preferenza per compattezza a parità di mosse | ✅ Fatto, limitata alle sedi in presenza |
| `generateMonthAI` | ⚠️ Non implementata (vedi limiti sotto) |

### Semplificazioni dichiarate (non nella lettera della richiesta, decisioni prese per tenere l'implementazione tracciabile)
- **Niente scambi di aula**: se il blocco è "aule piene" (nessuna aula libera per la sede in presenza), la Passata 3 non tenta di liberare un'aula spostando chi la occupa — tenta solo mosse per conflitti di operatore. Le carenze dovute solo a sala piena restano quindi diagnosticate ma non riparate automaticamente.
- **Un solo blocco per candidato**: se più sessioni bloccano contemporaneamente lo stesso slot (raro, ma possibile con gap-check), la Passata 3 salta il candidato invece di tentare uno scambio multiplo.
- **L'operatore del blocco non cambia**: quando si sposta una sessione bloccante, si cerca un nuovo giorno/orario per lo **stesso** operatore già assegnato, non si valuta di riassegnarla a un altro operatore ammesso.
- **Nessuna Passata 3 per `generateMonthAI`**: il percorso IA non ha una ricerca deterministica di slot su cui applicare scambi (il piazzamento è deciso dal modello linguistico); costruire un meccanismo equivalente richiederebbe reimplementare la ricerca di alternative anche lì, non richiesto esplicitamente per questo percorso (a differenza del punto 1 della richiesta precedente, che citava esplicitamente "anche la validazione post-IA" per la Passata 2 — qui non c'è un'indicazione equivalente).

## 2 — Report unico di generazione

**Cosa è stato fatto**:
- Nuove funzioni condivise `calcolaMetricheReport()` (metriche complessive), `costruisciReportGenerazione()` (assembla il report per utente/progetto + suggerimenti + metriche) e `riepilogoSettimanaleDaSessioni()` (ricostruisce a posteriori il confronto richieste/piazzate per il percorso IA, che non ha la diagnostica granulare dell'algoritmo).
- Sia `generateMonth` sia `generateMonthAI` ritornano ora `{count, anom, report}` (invece di solo `{count, anom}`).
- **Contenuto del report**: per ogni utente con almeno una carenza, un blocco con, per ciascun progetto, la tabella settimana→richieste→piazzate→causa (causa tra "disponibilità utente insufficiente" con i giorni specifici, "aule piene", "nessun operatore disponibile in fascia" — più "limite contrattuale", presente nella tassonomia ma che nella pratica non si attiva mai, vedi limite sotto); gli spostamenti effettivamente eseguiti dalla Passata 3; i suggerimenti di spostamento non eseguiti (fuori ambito/confermate); le richieste consigliate a utenti/operatori (generate da un template legato alla causa dominante, es. "Richiedi a [utente] disponibilità anche per Giovedì (progetto ...)"); infine le metriche complessive (buchi per operatore, % online da casa, saturazione aule per giorno, ore Assunti vs P.IVA).
- **Consultabile dopo la generazione**: il risultato viene salvato in `state.lastGenReport` e nella vista "Genera calendario" compare un bottone "📄 Report completo" (sia dopo l'algoritmo sia dopo l'IA) che apre una modale con `openGenReport()` — non è più solo un toast o l'elenco di anomalie inline già presente.

| Parte | Stato |
|---|---|
| Report per utente (richieste vs piazzate per settimana) | ✅ Fatto |
| Causa specifica per carenza | ✅ Fatto (3 delle 4 categorie richieste si attivano davvero, vedi limite sotto) |
| Suggerimenti azionabili (incl. spostamenti fuori ambito da Passata 3) | ✅ Fatto |
| Richieste consigliate a utenti/operatori | ✅ Fatto (template semplice legato alla causa) |
| Metriche complessive (4 richieste) | ✅ Fatte tutte e 4 |
| Consultabile dopo la generazione (non solo un toast) | ✅ Fatto (modale dedicata) |
| Anche per `generateMonthAI` | ✅ Fatto (con diagnostica più semplice, vedi limiti) |

### Limite dichiarato sulla causa "limite contrattuale"
Il monte ore settimanale contrattuale degli Assunti è, per scelta di design preesistente (non toccata in questa richiesta né nelle precedenti), un **limite morbido**: se un Assunto è l'unico operatore disponibile, viene comunque scelto e usato, con solo un avviso (`anom`), non un rifiuto. Questo significa che "limite contrattuale" non è di fatto mai la causa per cui una sessione NON viene piazzata nell'algoritmo attuale — l'ho lasciata nella tassonomia del report per completezza rispetto alla richiesta, ma è realisticamente sempre a zero. Se in futuro il limite contrattuale diventasse un vincolo duro (rifiuto invece di avviso), la causa comincerebbe a essere popolata automaticamente senza altre modifiche al report.

## Verifica automatica con esempio concreto

**Scenario**: mese 2026-07, ambito "Tutti i progetti attivi". Operatrice **Anna** (Assunta, 20h/settimana), collaboratore **Marco** (P.IVA, disponibile solo il lunedì per questi progetti).

- **Progetto Bianchi** (Cesate, freq 1/settimana, durata 60 min, unico operatore ammesso: Anna).
- **Progetto Rossi** (Cesate, freq 2/settimana, durata 60 min, operatori ammessi: Anna, Marco).
- Entrambi i clienti sono disponibili lunedì e martedì 10:00–11:00 quella settimana.

**Passata 1** (ordine per indice di rigidità, supponiamo Bianchi elaborato prima): piazza Bianchi il martedì 10:00–11:00 (aula Blu, Anna). Poi Rossi: lunedì 10:00–11:00 con Anna va bene (aula Blu, prima sessione) → 1/2. Per la seconda sessione di Rossi, martedì 10:00–11:00: Marco non è disponibile quel giorno; Anna è già occupata dalla sessione di Bianchi. **Nessun operatore disponibile in fascia** → Rossi resta a 1/2 quella settimana. `riepiloghi` registra `diagNessunOperatore=1` per Rossi/settimana 1.

**Passata 3**: carenza Rossi (1/2). Fase 1 (solo Assunti = Anna): candidato martedì 10:00–11:00. `slotCompatibile` per Anna passa, l'aula Verde è libera (`aulaLibera`). `opDaySess` di Anna quel giorno = [sessione di Bianchi] → un solo blocco. `movibile`: la sessione di Bianchi è in `newS`, `proposta`, progetto in ambito → **sì, movibile**. `trovaAlternativaBlocker` cerca nella stessa settimana un altro slot per Anna sul progetto Bianchi: trova mercoledì 10:00–11:00 (Anna libera, aula Blu libera). Esegue lo scambio: la sessione di Bianchi si sposta a mercoledì; la sessione mancante di Rossi viene piazzata martedì 10:00–11:00 (aula Verde). `missing=0`.

**Passata 2 ri-valutata**: nessuna sessione Online coinvolta in questo esempio, quindi non cambia nulla; viene comunque eseguita.

**Risultato nel report**: la riga di Rossi/settimana 1 mostra ora `piazzate:2/richieste:2` con ✓ (nessuna causa, perché la Passata 3 ha risolto la carenza); la sezione "🔧 Spostamenti effettuati" mostra: *"Bianchi — Progetto Bianchi: da [martedì] 10:00 a [mercoledì] 10:00 (liberato slot per Rossi (Progetto Rossi))"*. Anna non appare come utente da revisionare (nessuna carenza residua). Le metriche mostrano il carico di Anna (Assunta) vs Marco (P.IVA) e la saturazione delle aule Cesate nei tre giorni coinvolti.

**Variante con blocco non movibile**: se la sessione di Bianchi del martedì fosse già `confermata` (invece di `proposta`), la Passata 3 non l'avrebbe spostata: la carenza di Rossi sarebbe rimasta 1/2, con un suggerimento nel report — *"Le sessioni di Rossi (Progetto Rossi) entrerebbero martedì 10:00 — ma la sessione che occupa quello slot (Bianchi, Progetto Bianchi, confermata) non è modificabile in questo run."* — senza calcolo di una destinazione alternativa per Bianchi (dato che una sessione confermata non viene comunque proposta per lo spostamento, a differenza del caso "proposta fuori ambito" illustrato nella richiesta).

## Cosa manca
- Passata 3 non tenta scambi di aula (solo di operatore): le carenze dovute a "aule piene" restano diagnosticate ma non riparate automaticamente — semplificazione dichiarata sopra.
- Passata 3 non prova a riassegnare il blocco a un operatore diverso, solo a un altro orario/giorno per lo stesso operatore.
- Nessuna Passata 3 per `generateMonthAI` (solo report, senza riparazione automatica).
- La causa "limite contrattuale" non si attiva mai nella pratica attuale (limite morbido preesistente, non toccato).
- Non è stato possibile eseguire l'app dal vivo in questo ambiente: l'esempio sopra è stato verificato "a mano" ripercorrendo il codice nuovo riga per riga con valori concreti, non eseguendo realmente `generateMonth`. Raccomando un test manuale in staging con un caso reale di carenza multi-progetto prima di considerare la Passata 3 definitivamente validata, in particolare l'euristica di compattezza e il limite di 40 mosse su mesi con molte carenze contemporanee.

---

# Verifica — Ciclo di 4 fix UX + aggiornamenti documentali

Quattro fix UX su `index.html` più aggiornamenti a `CLAUDE.md`/`CONTESTO.md`. Data: 2026-07-15.

## 1 — Annulla completo nella scheda disponibilità

**Cosa è stato fatto**: ho riletto per intero il meccanismo di snapshot/ripristino in `renderMonthlyAvail` (`eccezioniSnapshot`, `persistEccezioni`, `wrap._restoreSnapshot`) e i due percorsi segnalati come non annullabili (click sul giorno, "Applica a più giorni"). **Per lettura statica del codice, il meccanismo di ripristino risultava già logicamente corretto**: lo snapshot viene catturato una sola volta all'apertura, non viene mai riassegnato dai salvataggi intermedi, ed entrambi i percorsi (click-giorno e bulk) scrivono sullo stesso array `eccezioni` che l'Annulla ripristina e ri-salva su SharePoint se il contenuto risulta cambiato. Non sono quindi riuscito a individuare, per sola lettura, la riga esatta che causa il comportamento segnalato da Simone nei test manuali — non avendo un ambiente per eseguire l'app dal vivo (richiede login Microsoft 365 su dominio registrato) né un motore JavaScript locale.

Ho comunque trovato e corretto un **difetto reale e concreto** nello strato di persistenza, che è un candidato diretto alla causa del bug e in ogni caso va corretto:
- **`saveRecord`**: dopo ogni `PATCH` riuscito, sostituiva l'oggetto nell'array (`arr[i]=updated`) invece di aggiornarlo sul posto. Questo **rompe l'identità dell'oggetto**: chiunque tenga un riferimento allo stesso record (come `entity` nella scheda modale aperta) smette di essere lo stesso oggetto di `state.data.operatori[i]`/`state.data.progetti[i]` dopo il primo salvataggio intermedio (click-giorno o bulk). Corretto: ora l'oggetto esistente viene aggiornato sul posto (`Object.assign` + rimozione dei campi non più presenti), preservando l'identità del riferimento per tutta la vita della scheda.
- **`renderMonthlyAvail`**: sostituito il flag booleano `dirty` (impostato manualmente a ogni salvataggio intermedio) con un **confronto di contenuto** (`JSON.stringify` tra lo stato corrente e lo snapshot) al momento dell'Annulla: il ripristino su SharePoint scatta ora ogni volta che il contenuto risulta effettivamente diverso dall'apertura, indipendentemente da quale codice l'abbia modificato — più robusto della dipendenza da un flag impostato a mano, e coerente con l'ipotesi di causa indicata nella richiesta ("eccezioniSnapshot perso dai salvataggi intermedi").

| Parte | Stato |
|---|---|
| `saveRecord` (identità dell'oggetto preservata) | ✅ Fatto — difetto reale trovato e corretto |
| `renderMonthlyAvail._restoreSnapshot` (rilevamento robusto delle modifiche) | ✅ Fatto — confronto di contenuto invece del flag `dirty` |
| Copertura di click-giorno e "Applica a più giorni" | ✅ Entrambi i percorsi scrivono sullo stesso array `eccezioni`, coperti dallo stesso ripristino |
| Riproduzione del bug originale | ⚠️ Non riprodotta dal vivo — vedi limiti sotto |

**⚠️ Da verificare manualmente da Simone prima di considerare il punto chiuso**: inserire un'eccezione col click su un giorno, poi con "Applica a più giorni", cliccare Annulla sulla scheda operatore/progetto, ricaricare la pagina e controllare che entrambe le modifiche siano sparite sia dal calendario sia (se verificabile) da SharePoint.

## 2 — Protezione modifiche non salvate nelle schede

**Cosa è stato fatto**: aggiunto un meccanismo generico di "dirty check" alle funzioni `openModal`/`openModalStacked` (nuovi parametri opzionali `isDirty`, `onSaveTrigger`, oltre al già esistente `onCancel`). Quando la scheda viene abbandonata (click fuori/backdrop, Esc, o pulsante di chiusura) e `isDirty()` risulta vero, compare un dialogo (`confirmUnsavedChanges()`) con tre scelte: **Salva ed esci** (simula il click sul pulsante di salvataggio della scheda), **Esci senza salvare** (procede con la chiusura/ripristino come prima), **Continua a modificare** (annulla la chiusura, compreso qualunque click fuori/Esc accidentale).

Applicato a tutte e 5 le schede richieste:
- **Operatori** (`openOperatoreModal`): confronta tutti i campi del form (nome, cognome, contatti, sedi, contratto, tempi di viaggio, ruolo, colore, stato, disponibilità settimanale, formazione, credenziali, note) — **esclude** le eccezioni giornaliere, perché quelle sono già salvate immediatamente a ogni click-giorno/bulk e già coperte dal ripristino del punto 1 (altrimenti l'avviso scatterebbe due volte per lo stesso cambiamento).
- **Utenti** (`openUtenteModal`): tutti i campi anagrafici, referente, contatti, indirizzo, paese, credenziali, documenti, note, stato.
- **Progetti** (`openProgettoModal`): tutti i campi (utente, nome, descrizione, monte ore, frequenza, durata, sede, domicilio, operatori ammessi, operatore fisso, metodi assegnati, tipi di sessione, disponibilità) — stessa esclusione delle eccezioni giornaliere per lo stesso motivo.
- **Sessioni** (`openSessionModal`): data, orari, utente, progetto, operatore, sede, aula, stato, note.
- **Disponibilità**: il popup del **click sul giorno** e quello di **"Applica a più giorni"** (dentro `renderMonthlyAvail`, aperti con `openModalStacked`) hanno ciascuno il proprio dirty-check sui campi del form (tipo, fasce orarie con sede, codice malattia, fascia oraria assenza) — coerente con la richiesta di applicare la protezione anche alla scheda disponibilità.

**Effetto collaterale corretto in corsa d'opera**: con la protezione aggiunta, una scheda può ora restare aperta sopra un popup impilato (disponibilità) e a sua volta sopra il dialogo di conferma — tre livelli di modale annidati. Il vecchio meccanismo Esc (un solo `addEventListener('keydown', escClose)` sospeso "a mano" tra i due livelli) avrebbe fatto reagire **più listener contemporaneamente** allo stesso tasto Esc col terzo livello. Ho quindi introdotto uno **stack di gestori Escape** (`pushEsc`/`popEsc`, in cima allo stack un solo listener alla volta) che sostituisce la sospensione manuale precedente, garantendo che Esc chiuda sempre e solo il livello più in alto.

| Parte | Stato |
|---|---|
| Operatori | ✅ Fatto |
| Utenti | ✅ Fatto |
| Progetti | ✅ Fatto |
| Sessioni | ✅ Fatto |
| Disponibilità (popup giorno + "Applica a più giorni") | ✅ Fatto |
| Dialogo a 3 scelte (Salva ed esci / Esci senza salvare / Continua) | ✅ Fatto (`confirmUnsavedChanges`) |
| Gestione Esc su modali annidate (scheda → popup → conferma) | ✅ Fatto (`pushEsc`/`popEsc`) |

**Non toccato, fuori dai 5 punti richiesti**: le modali minori "Durate" (Impostazioni) e "Nuova chiusura" (Chiusure) non hanno il dirty-check (non erano nell'elenco delle 5 schede indicate); usano ancora `onclick="closeModal()"` diretto, senza passare da `closeModalWithCancel`.

## 3 — Numerazione elenchi nelle Impostazioni

**Cosa è stato fatto**: nella scheda Impostazioni, aggiunto il numero progressivo (`i+1`) davanti al nome di ogni voce delle liste "Formazioni operatori" (`renderImpostazioni`, blocco `#imp-formazioni`) e "Metodi/progetti" (blocco `#imp-metodi`). Solo visualizzazione: nessuna modifica al formato dei dati salvati (`state.data.impostazioni.formazioni`/`.metodi` restano semplici array, la numerazione è calcolata dall'indice a ogni render).

| Parte | Stato |
|---|---|
| Formazioni operatori | ✅ Fatto |
| Metodi/progetti | ✅ Fatto |
| Formato dati invariato | ✅ Verificato — solo stringa `(i+1)+'. '` anteposta al nome nel template |

## 4 — Nuovo marchio nell'header

**Cosa è stato fatto**: chiesto chiarimento a Simone perché il markup dei "due pallini" (classe `.brandmark`, due `<span>`) è condiviso da 3 punti identici nel file: header dell'app, schermata di login, schermata di accesso negato. Simone ha scelto di sostituire ovunque per coerenza visiva. Sostituito il contenuto di `.brandmark` con l'SVG fornito, **esattamente come dato** (stesse coordinate/colori, nessuna reinterpretazione), nei 3 punti. CSS aggiornato: rimosse le regole per i vecchi `<span>` posizionati in assoluto, l'SVG scala tramite `width:100%;height:auto` dentro un contenitore `.brandmark` dimensionato in larghezza (56px nelle schermate di login/accesso negato, 34px nell'header — proporzioni coerenti con le dimensioni preesistenti). Rimosso `aria-hidden="true"` dal contenitore (l'SVG ha ora un proprio `role="img" aria-label="Logo Sviluppo Cognitivo")`, altrimenti l'etichetta accessibile sarebbe stata soppressa dall'antenato `aria-hidden`.

| Parte | Stato |
|---|---|
| SVG esatto fornito, colori/coordinate invariati | ✅ Fatto (verificato carattere per carattere contro il testo della richiesta) |
| Header app | ✅ Fatto |
| Schermata di login | ✅ Fatto (scelta di Simone, non era nella lettera del punto 4) |
| Schermata di accesso negato | ✅ Fatto (idem) |
| Dimensioni coerenti con l'header esistente | ✅ Fatto — contenitore ridimensionato, SVG scala proporzionalmente |

## 5 — Aggiornamenti documentali

**Cosa è stato fatto**:
- **CLAUDE.md**: aggiunta la sezione "Regole UX" con la regola del dialogo a 3 scelte per le modifiche non salvate (punto 2), e la sezione "Regole di business pianificate (non ancora implementate)" con la specifica completa della pausa pranzo fornita nella richiesta (finestra 12:00–14:30, pausa implicita se si inizia alle 13:30 o dopo / si finisce entro le 13:30, viaggio casa→sede che deve concludersi entro le 14:30 insieme alla pausa, possibilità per la Passata 2 di usare online-in-sede per far quadrare la pausa, suggerimenti nel report mai automatici). Aggiornato anche il punto 7 dell'architettura per menzionare i nuovi parametri di `openModal`/`openModalStacked` e lo stack Escape.
- **CONTESTO.md**: aggiunta al backlog (sezione 6, voce 13) "Calendari famiglie via inviti Outlook/Graph (opzione C scelta): eventi calendario M365 con la famiglia invitata, aggiornamenti in tempo reale, solo sessioni confermate, attenzione alle rigenerazioni" — rinumerata di conseguenza la lista "Strumenti" sottostante (14→18).

| Parte | Stato |
|---|---|
| CLAUDE.md — regola UX modifiche non salvate | ✅ Fatto |
| CLAUDE.md — regola business pausa pranzo (pianificata) | ✅ Fatto |
| CONTESTO.md — nuova voce di backlog | ✅ Fatto |

---

## Verifica automatica finale (i 4 punti + documentazione)

| Punto | Codice | Verificato dal vivo | Esito |
|---|---|---|---|
| 1. Annulla disponibilità | ✅ Difetto reale corretto (`saveRecord`) + ripristino reso più robusto (confronto di contenuto) | ⚠️ No — richiede test manuale in staging | **Da confermare da Simone** (vedi nota sopra) |
| 2. Modifiche non salvate | ✅ Applicato a operatori/utenti/progetti/sessioni/disponibilità + fix Esc annidato | ⚠️ No | **Completo per il codice**, da provare a video |
| 3. Numerazione Impostazioni | ✅ Fatto | ⚠️ No | **Completo** |
| 4. Nuovo logo header | ✅ Fatto (3 punti, per scelta di Simone) | ⚠️ No | **Completo** |
| 5. Documentazione | ✅ Fatto | n/a | **Completo** |

**Cosa manca / attenzione**:
- **Punto 1 è l'unico non chiuso con certezza**: ho corretto un difetto reale nello strato di persistenza (`saveRecord`) e reso il ripristino più robusto, ma non ho potuto riprodurre dal vivo il comportamento segnalato da Simone né confermare che fosse esattamente questa la causa. **Raccomando fortemente** di ripetere il test manuale descritto sopra prima di considerare il punto chiuso.
- Il dirty-check del punto 2 non copre le modali minori "Durate" (Impostazioni) e "Nuova chiusura" (Chiusure), non incluse nell'elenco delle 5 schede richieste.
- La pausa pranzo è **solo documentata** in CLAUDE.md come specifica per il prossimo ciclo: nessuna riga di `generateMonth`/`generateMonthAI`/Passata 2 è stata toccata in questo ciclo, come richiesto.

## Limiti di questa verifica
Come per tutte le verifiche precedenti: analisi per lettura statica del codice, verifica di bilanciamento sintattico (parentesi graffe/tonde) sull'intero file prima e dopo le modifiche, nessuna esecuzione dal vivo dell'app (richiede login Microsoft 365 su dominio registrato, non disponibile in questo ambiente) né un motore JavaScript locale per test automatizzati. In particolare il punto 1 (Annulla disponibilità) andrebbe verificato manualmente con priorità, essendo l'unico dei 4 punti per cui non è stato possibile confermare con certezza la causa esatta del comportamento segnalato.

---

# Verifica — Nuova favicon e controllo della regola "pausa pranzo"

Due interventi mirati. Data: 2026-07-15.

## 1 — Nuova favicon con il marchio aziendale

**Cosa è stato fatto**: sostituito l'unico `<link rel="icon" ...>` presente in `index.html` (riga 8, era l'unica favicon nel file — nessun `apple-touch-icon`/`shortcut icon` da rimuovere altrove, verificato con ricerca testuale su tutte le varianti di `rel`). Il nuovo tag ha `type="image/svg+xml"` esplicito e un `href` con l'SVG fornito incorporato come data URI: stessa griglia (`viewBox="0 0 42 28"`, 28×28), cielo navy (`#34388f`), tenda teal (`#10b3b8`), una sola stella grande gialla (`#f7d21e`), omino azzurro (`#a1daf8`) — nessuna coordinata o colore reinterpretato rispetto al testo fornito.

**Codifica scelta**: ho seguito la stessa convenzione già usata dalla favicon precedente in questo stesso file (unica codifica realmente necessaria per un data URI SVG dentro un attributo HTML a doppi apici: attributi SVG tra apici singoli per non confliggere con le doppie virgolette di `href`, e solo il carattere `#` percent-encodato in `%23`, perché altrimenti verrebbe interpretato come inizio di un fragment e troncherebbe l'URI). Ho verificato la sostituzione due volte: la prima stesura conteneva un refuso nel `viewBox` (mancava lo `0` di min-y, `viewBox='0 42 28'` invece di `'0 0 42 28'`) generato tentando erroneamente una codifica percent-encoding integrale (`encodeURIComponent`-style) di tutti i caratteri — corretto tornando alla codifica leggera coerente col resto del file, con il `viewBox` esatto.

| Parte | Stato |
|---|---|
| SVG esatto fornito (coordinate/colori invariati) | ✅ Fatto — verificato carattere per carattere |
| `type="image/svg+xml"` esplicito | ✅ Fatto |
| Data URI con codifica corretta (solo `#`→`%23`, apici singoli) | ✅ Fatto — stessa convenzione già in uso nel file, verificata funzionante |
| Rimozione favicon precedenti/conflitti | ✅ Verificato — era l'unica presente, nessun'altra da rimuovere |

**⚠️ Da verificare visivamente da Simone**: aprendo il sito, controllare che la scheda del browser mostri la nuova icona (cielo navy/tenda teal/omino azzurro/una stella) e non quella vecchia (due cerchi navy/ambra) — non è stato possibile controllare il rendering reale in questo ambiente (nessun browser con accesso al dominio pubblicato).

## 2 — Verifica della regola "pausa pranzo" nel CLAUDE.md

**Cosa è stato fatto**: la regola presente in `CLAUDE.md` (sezione "Regole di business pianificate", introdotta nel ciclo precedente) conteneva ancora la frase superata "pausa + viaggio devono concludersi entro le 14:30" e non distingueva il caso senza viaggio da quello con viaggio né prevedeva la tolleranza di riduzione. Sostituita integralmente con la versione definitiva fornita: pausa di 60 minuti nella finestra 12:00–14:30 (ultima fascia 13:30–14:30), implicita se si inizia alle 13:30 o dopo / si finisce entro le 13:30; **senza viaggio** (già in sede tutto il giorno o solo sessioni online) pausa tassativa di 60 minuti; **con viaggio casa→sede dopo la pausa** tolleranza solo in difetto fino a un minimo di 50 minuti (mai in eccesso, solo se serve a piazzare sessioni, l'algoritmo preferisce sempre i 60 minuti pieni); il viaggio avviene dopo la pausa e può estendersi oltre le 14:30 senza limite (con i due esempi numerici forniti); la Passata 2 può scegliere "online in sede" per far quadrare la pausa, nel qual caso l'operatore è considerato già in sede e la pausa torna tassativa di 60 minuti; il report può suggerire riduzioni oltre i limiti o spostamenti fuori finestra, mai eseguiti in automatico. Nessuna riga di codice toccata (`generateMonth`/`generateMonthAI`/`risolviOnlineDaCasa` restano invariati): la regola resta solo documentata, come richiesto ("da implementare in un prossimo ciclo").

| Parte | Stato |
|---|---|
| Rilevamento della frase superata | ✅ Confermato presente ("pausa + viaggio devono concludersi entro le 14:30") |
| Sostituzione integrale con la versione definitiva | ✅ Fatto |
| Distinzione senza viaggio (tassativa) / con viaggio (tolleranza -10 min) | ✅ Fatto |
| Esempi numerici (13:30–14:30/14:30–15:00 e 13:30–14:20/14:20–14:50) | ✅ Riportati integralmente |
| Nessuna modifica al codice (regola solo pianificata) | ✅ Verificato — nessun file JS toccato |

---

## Verifica automatica finale (i 2 interventi)

| Punto | Codice | Documentazione | Verificato dal vivo | Esito |
|---|---|---|---|---|
| 1. Nuova favicon | ✅ Fatto (`index.html`, riga 8) | n/a | ⚠️ No — consigliato controllo visivo | **Completo per il codice**, da confermare a video |
| 2. Regola pausa pranzo | n/a (solo documentazione, come richiesto) | ✅ Fatto (`CLAUDE.md`) | n/a | **Completo** |

**Cosa manca**: nessuna lacuna nota per questi due punti, a parte la verifica visiva della favicon in un browser reale (non eseguibile in questo ambiente).

## Limiti di questa verifica
Analisi per lettura statica del codice; verificato il bilanciamento sintattico (parentesi graffe/tonde) sull'intero file prima e dopo la modifica. Non è stato possibile aprire un browser con accesso al dominio pubblicato per controllare a video il rendering della favicon nella scheda del browser — si raccomanda una verifica visiva rapida dopo il deploy.

---

# Verifica — Grande ciclo di allineamento documentale

**Nessuna modifica al codice in questo ciclo**: solo `CLAUDE.md`, `CONTESTO.md` e questo file. Data: 2026-07-16.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale delle 9 richieste:*
- Dopo il prompt iniziale, un primo tentativo di modifica a `CLAUDE.md` (la correzione del conteggio righe) è stato respinto dallo strumento di editing; Simone ha chiarito che il rifiuto era involontario ("per errore"), ha chiesto di riproporre la stessa modifica e proseguire con **tutti** i punti del prompt, e ha esplicitamente **autorizzato tutte le modifiche di questa sessione** (a `CLAUDE.md`/`CONTESTO.md`/`VERIFICA.md` — nessuna modifica al codice era comunque richiesta né autorizzata).

*Domande poste a Simone e risposte ricevute:* nessuna. Il prompt iniziale conteneva già tutte le specifiche di contenuto (i 9 punti); l'unico scambio fuori dal prompt è quello riportato sopra (chiarimento sul rifiuto accidentale).

*Decisioni prese di conseguenza:*
- Proseguire in autonomia su tutti i 9 punti, verificando ogni affermazione tecnica nel codice reale di `index.html` prima di scriverla in `CLAUDE.md`/`CONTESTO.md`, come richiesto esplicitamente dal prompt ("leggendo il codice reale", "verificandole nel codice").
- Dove la verifica nel codice ha mostrato uno scostamento rispetto a quanto atteso dal prompt (vedi "Discrepanze da discutere" sotto), non toccare il codice e non correggere in silenzio il testo richiesto da Simone: la voce richiesta è stata comunque scritta come richiesto (es. la voce di backlog "multisessione giornaliera mai implementata"), con una nota di rinvio alla discrepanza accanto, così che la decisione su come interpretarla resti a Simone.
- Applicare da subito (già in questo ciclo) la nuova regola permanente "verifica multi-passata a quattro fonti" richiesta al punto 4c, descritta di seguito.

## Metodo di verifica: multi-passata a quattro fonti (prima applicazione)

Come da nuova regola permanente (`CLAUDE.md`, sezione "Prassi di chiusura ciclo", punto c), questo ciclo è stato verificato con più passate ad angoli complementari, incrociando le quattro fonti `CLAUDE.md` / `CONTESTO.md` / `VERIFICA.md` / `index.html`:

1. **Passata 1 — lettura del codice reale, punto per punto del prompt**: Passata 3 (righe 1728-1807), report di generazione e metriche (righe 1421-1480), limiti di `generateMonthAI` (righe 1915-1948), orari/domenica (righe 1874-1877, ricorrenze `dn==='Dom'`), formazioni (riga 1603), rotazione tipi sessione (righe 1516-1683), assenze/`effRng` (righe 603-628), disponibilità per fascia/`sedi` (righe 1541-1546), `noMonteOre` (righe 1359,1370), non sovrapposizione utente (righe 1563,1740,1758), `operatoreFisso` (riga 1860), `claudeProxy` (righe 1905-1908, 2001-2002), credenziali (righe 730, 967-968, 2056+), comunicazioni (righe 298, 1978-1988, 2311-2312), online-in-sede/aula (righe 1410-1417). Ogni riscontro è citato con numero di riga nei testi scritti.
2. **Passata 2 — stesura**: redazione di `CLAUDE.md`/`CONTESTO.md`, con doppio controllo di ogni frase scritta contro la citazione di codice raccolta nella Passata 1 (nessuna frase scritta senza un riscontro di riga).
3. **Passata 3 — coerenza interna**: rilettura di `CLAUDE.md`/`CONTESTO.md` aggiornati per contraddizioni interne — es. la sezione "Scheduling engine" non doveva più dire "two passes" da nessuna parte una volta introdotta la Passata 3; la nuova regola GDPR (punto 5) non doveva contraddire né duplicare senza coordinarsi la voce di backlog GDPR già esistente in `CONTESTO.md` (risolto allineando il testo della voce 2 del backlog al testo della nuova regola).
4. **Passata 4 — confronto incrociato fra le quattro fonti**: la Passata 3 è già descritta (senza il dettaglio operativo) in `CONTESTO.md` §4 dal 13-14/07 ("Blocco C1+C2... Passata 3") — coerente con la nuova descrizione dettagliata in `CLAUDE.md`; l'assenza di Passata 3 nel percorso IA era già annotata in `CONTESTO.md` §4 ("NON implementa... né la Passata 3") — coerente col codice e riportata identica in `CLAUDE.md`.
5. **Passata 5 (continuata perché ha trovato qualcosa di nuovo)** — verifica mirata sulla voce di backlog "multisessione giornaliera" del punto 9a: qui è emersa la discrepanza sul campo `maxSessioniGiorno` (vedi sotto), non individuata nelle passate 1-4 perché il punto 9a non richiedeva esplicitamente un riscontro nel codice (a differenza dei punti 1/2/6/7/8).
6. **Passata 6 — rilettura finale integrale** dei tre file dopo tutte le modifiche: ha trovato due incongruenze **interne a CONTESTO.md** non causate dal codice ma dalla stesura di questo stesso ciclo, corrette seduta stante perché di puro allineamento documentale (non discrepanze codice/regole, quindi non spostate in "Discrepanze da discutere"): (1) doppia intestazione `## 7.` — la nuova sezione "Registro delle decisioni" aveva riusato per errore lo stesso numero della sezione preesistente "Prassi operative da mantenere", che è stata rinumerata `## 8.`; (2) CONTESTO.md §1 riportava ancora "~2100 righe" per `index.html`, non allineato al conteggio reale "~2325" appena corretto in CLAUDE.md (punto 3) — allineato anch'esso a 2325.
7. **Passata 7 — rilettura finale bis** dopo le correzioni della Passata 6: nessuna ulteriore incongruenza trovata → passata "vuota", ciclo di verifica chiuso a 7 passate (minimo richiesto: 4).

## 1 — Scheduling engine a tre passate + Report completo (CLAUDE.md)

| Parte | Stato | Riscontro nel codice |
|---|---|---|
| Architettura corretta da "two passes" a "three passes" | ✅ Fatto | Commenti `PASSATA 1/2/3` nel codice (righe 1394,1556,1728,1809,1917,1941) |
| Passata 3: opera solo su utenti/progetti sotto il target settimanale | ✅ Descritto fedelmente | `carenze=riepiloghi.filter(r=>r.piazzate<r.richieste&&...)`, riga 1733 |
| Passata 3: sposta/scambia SOLO proposte in ambito | ✅ Descritto fedelmente | `movibile=newS.includes(blocco)&&blocco.stato==='proposta'&&scopeIds.has(...)`, riga 1782 |
| Passata 3: prima Assunti, poi tutti gli ammessi | ✅ Descritto fedelmente | `fasi=[poolCompleto.filter(o=>o.tipoContratto==='Assunto'),poolCompleto]`, riga 1742 |
| Passata 3: massimo 40 mosse | ✅ Descritto fedelmente | `MAX_MOSSE=40`, riga 1732 |
| Passata 3: niente scambi di aula, solo di operatore | ✅ Descritto fedelmente | Commento esplicito riga 1770; nessuna riga cambia `aula` di una sessione bloccante |
| Passata 3: fuori ambito/confermate → non esegue, suggerimento nel report | ✅ Descritto fedelmente | `suggerimentiFuoriAmbito.push(...)`, righe 1783-1788 |
| Report completo: richieste vs piazzate per utente/settimana | ✅ Documentato | `costruisciReportGenerazione`, righe 1454-1480 |
| Report completo: cause delle carenze | ✅ Documentato | `causeLbl` (disponibilità utente, aule piene, nessun operatore), righe 1461-1467 |
| Report completo: suggerimenti azionabili | ✅ Documentato | `suggerimentiRichieste`, righe 1472-1477 |
| Report completo: metriche (buchi, % online da casa, saturazione aule, carico Assunti/P.IVA) | ✅ Documentato | `calcolaMetricheReport`, righe 1421-1451 |
| generateMonthAI: NON tipi sessione, NON Passata 3 | ✅ Documentato | Nessun uso di `tipiSessione` in `generateMonthAI`; commento esplicito riga 1945 |
| generateMonthAI: risoluzione online ricalcolata deterministicamente post-risposta | ✅ Documentato, con precisazione | `risolviOnlineDaCasa` (Passata 2) gira sempre dopo la risposta IA (riga 1942) per `onlineDaCasa`/aula — **ma** la sede composita (`Presenza+Online`→Cesate/Online) proposta dall'IA viene solo validata e **scartata se non ammessa** (righe 1926-1929), non ricalcolata/corretta. Vedi nota in "Discrepanze" sulla formulazione preesistente in CONTESTO.md. |

## 2 — Key domain concepts arricchito (CLAUDE.md)

| Regola | Stato | Riscontro nel codice |
|---|---|---|
| Orari centro 09:00–19:30 | ✅ Verificato | `tmin('09:00')`/`tmin('19:30')`, righe 1581,1702,1754,1874 |
| Domenica esclusa dalla generazione | ✅ Verificato | `if(dn==='Dom')continue`, righe 1492,1570,1695,1747; prompt IA riga 1877 |
| Online in sede = aula resta occupata | ✅ Verificato | `s.aula=aula; auB[aula].push(...)` quando `daCasa===false`, righe 1412-1415 |
| Requisito formazioni: TUTTE le formazioni richieste | ✅ Verificato | `reqForms.every(rf=>opForms.includes(rf))`, riga 1603 |
| Rotazione tipi sessione continua sul mese, non si azzera a settimana | ✅ Verificato | `sessionCountByProject` per progetto, mai reimpostato a inizio settimana, righe 1516,1659,1680-1682 |
| Approccio A: un solo operatore per l'intera sessione | ✅ Verificato | Un solo `operatoreId` per sessione con tutti i `componenti` in `composizione`, righe 1643,1683 |
| Assenze: malattia sempre giornata intera | ✅ Verificato | `if(ex.tipo==='malattia')return[]`, riga 611 |
| Assenze: permesso/ferie con fascia facoltativa | ✅ Verificato | Righe 613-616 |
| Resto della giornata disponibile SOLO dentro le fasce dichiarate | ✅ Verificato | `subtractWindow(weekly(), ex.da, ex.a)` sottrae dalla disponibilità settimanale propria, non dall'intera giornata, riga 614 |
| Disponibilità per fascia: Cesate non implica Online | ✅ Verificato | `sdComp`/righe 1541-1546: uno slot deve elencare esplicitamente la sede remota |
| Progetti `noMonteOre` esclusi dalla generazione automatica | ✅ Verificato | `!p.noMonteOre&&...`, righe 1359,1370 |
| Sessioni di progetti diversi dello stesso utente non si sovrappongono mai | ✅ Verificato | `allPU`/`uBN` su tutti i progetti dell'utente, non solo quello in piazzamento, righe 1563,1586-1587,1740,1758-1759 |
| `operatoreFisso` già nel codice | ✅ Verificato | Campo su progetto, usato/mostrato riga 1860; checkbox `#pe-fisso` riga 1022 |

## 3 — Conteggio righe (CLAUDE.md)

| Parte | Stato |
|---|---|
| Conteggio reale (`wc -l index.html`) | **2325 righe** (era documentato "~1600") |
| Corretto in CLAUDE.md | ✅ Fatto |

## 4 — Prassi di chiusura ciclo (CLAUDE.md)

| Regola | Stato |
|---|---|
| (a) Chiusura standard (verifica + CONTESTO.md + commit descrittivo) | ✅ Aggiunta, e applicata in questo stesso ciclo |
| (b) Registro di sessione in ogni VERIFICA.md | ✅ Aggiunta, e applicata per la prima volta in questa stessa voce (sezione sopra) |
| (c) Verifica multi-passata a quattro fonti, minimo 4, senza numero fisso | ✅ Aggiunta, e applicata per la prima volta in questo ciclo (6 passate, vedi sopra) |

## 5 — Regola GDPR pseudonimizzazione verso l'IA (CLAUDE.md)

| Parte | Stato |
|---|---|
| Nuova regola in "Regole di business pianificate", priorità alta | ✅ Fatto |
| Copre sia `sendChat`/`bCtx` sia `generateMonthAI` | ✅ Fatto — entrambi chiamano `CFG.claudeProxy` (righe 1905,2001) |
| Copre nomi/cognomi/contatti/credenziali | ✅ Fatto, come richiesto dal prompt |
| Vincolo esplicito per ogni modifica alle funzioni IA fino all'implementazione | ✅ Fatto |
| Coerenza con backlog CONTESTO.md (voce preesistente) | ✅ Allineata — la voce 2 del backlog CONTESTO.md esisteva già ma era più stretta (solo `generateMonthAI`, solo nomi); aggiornata per coprire lo stesso perimetro della nuova regola |

## 6 — claudeProxy: client Claude / backend Gemini (CLAUDE.md)

| Parte | Stato | Riscontro nel codice |
|---|---|---|
| Il client parla formato Claude (Messages API) | ✅ Verificato | `{model:'claude-sonnet-4-6',max_tokens,messages:[{role,content}]}` in entrambi i punti di chiamata, righe 1907,2001; risposta letta come `data.content` filtrato per `type==='text'`, righe 1910,2002 |
| Il proxy traduce verso Gemini 2.0 Flash lato server | ⚠️ Non verificabile dal client | Informazione fornita da Simone (fatto lato server, fuori dal codice client); riportata come tale, non come riscontro di codice |
| Fatturazione in sospeso | ✅ Riportato come detto da Simone | Decisione non ancora presa, documentata come tale |
| Chiave API non presente nel file | ✅ Verificato | Nessuna stringa di chiave API in `index.html`, solo l'URL del proxy (riga 484) |

## 7 — Credenziali in chiaro su SharePoint (CLAUDE.md)

| Parte | Stato | Riscontro nel codice |
|---|---|---|
| Credenziali operatori e utenti salvate in chiaro | ✅ Verificato | Campo `credenziali[].password`, righe 909,951,967-968 |
| Nessuna cifratura client o server | ✅ Verificato | `saveRecord`: `Data:JSON.stringify(payload)` senza trasformazioni, riga 730 |
| Avvertenza aggiunta: solo per credenziali di lavoro, mai bancarie/critiche | ✅ Fatto |

## 8 — Comunicazioni nell'inventario architettura (CLAUDE.md)

| Parte | Stato | Riscontro nel codice |
|---|---|---|
| Messaggi settimanali WhatsApp/email per utente | ✅ Verificato e documentato | `mkWeekMsg`, righe 1979-1988; `#btn-wa`/`#btn-mail`, righe 2311-2312 |
| Export mensile | ⚠️ **Discrepanza** — vedi sotto | Pulsante presente (`#cal-send-month`, riga 298) ma **senza alcun listener collegato** nel codice: nessuna funzione di export mensile esiste. Documentato in CLAUDE.md come nota di fedeltà, non come funzionalità esistente. |

## 9 — CONTESTO.md: backlog + Registro delle decisioni

| Parte | Stato |
|---|---|
| (a) Voce backlog multisessione giornaliera | ✅ Aggiunta come richiesto, con nota di discrepanza (vedi sotto) |
| (b) Voce backlog invio automatico calendari domenica 15 | ✅ Aggiunta |
| (c) Sezione "Registro delle decisioni" con le 5 voci richieste | ✅ Aggiunta, ciascuna con decisione/motivazione/alternativa scartata |
| Regola permanente di alimentazione a ogni ciclo | ✅ Aggiunta (in CONTESTO.md §7 e richiamata in CLAUDE.md, sezione Manutenzione del CONTESTO.md) |

## Discrepanze da discutere

Come da regola del prompt, queste discrepanze **non sono state corrette nel codice** né risolte in autonomia nel testo: sono segnalate qui per una decisione di Simone.

1. **"Multisessione giornaliera nei progetti" — possibile funzionalità già presente**: il prompt (punto 9a) chiede di registrare a backlog che questa funzionalità "mai implementata" è "CONFERMATA necessaria da Simone". Leggendo il codice, però, esiste già un campo `maxSessioniGiorno` per progetto (esposto in UI come "Max sessioni/giorno" in Progetti, `#pe-maxday`, riga 1559) che è attivamente usato sia in Passata 1 (riga 1559: `todayPlaced>=maxDay` non blocca una seconda sessione lo stesso giorno se `maxDay>1`) sia in Passata 3 (riga 1750) per permettere più sessioni dello stesso progetto nello stesso giorno. Non è chiaro se: (a) questo campo risolva già ciò che Simone intende per "multisessione giornaliera" e la voce di backlog sia da chiudere; (b) "multisessione giornaliera" indichi qualcosa di più specifico che `maxSessioniGiorno` non copre (es. orari/fasce diverse per le due sessioni, gestione UI, o un caso che in pratica non funziona nonostante il campo esista); (c) il campo esista ma sia stato introdotto dopo la promessa del 10/07 e non fosse ancora lì quando la promessa è stata fatta. La voce di backlog è stata comunque scritta come richiesto, con un rimando a questa nota.
2. **Pulsante "📤 Invio mese" (Calendario) non funzionante**: presente in markup (riga 298, title "Esporta messaggi mese"), visibile solo per Admin, ma senza alcun `addEventListener` collegato nel codice attuale — nessuna funzione di generazione/export mensile esiste. Se questa funzionalità era attesa attiva (il punto 8 del prompt la cita come parte della funzione "comunicazioni" da documentare), va deciso se implementarla o rimuovere il pulsante morto; per ora è solo documentata come non funzionante, nessun codice toccato.
3. **Formulazione preesistente "risoluzione sede/online ricalcolata deterministicamente" (già in CONTESTO.md §4 prima di questo ciclo, ripresa nel punto 1 del prompt)**: è imprecisa su un dettaglio. Nel percorso IA, solo la decisione "online da casa/in sede" (Passata 2, `risolviOnlineDaCasa`) è davvero ricalcolata deterministicamente dopo la risposta. La *sede composita* (`Presenza+Online`→Cesate/Online, `Presenza+Domicilio`→Cesate/Domicilio) proposta dall'IA non viene invece ricalcolata: se non ammessa, la sessione viene scartata (righe 1926-1929), non corretta. In CLAUDE.md è stata scritta la versione precisa (vedi punto 1 della tabella sopra); la frase preesistente in CONTESTO.md resta invece nella formulazione originale — segnalato qui per decidere se allinearla in un prossimo ciclo.

## Verifica automatica finale (i 9 punti)

| Punto | Stato |
|---|---|
| 1. Scheduling engine a tre passate + Report completo | ✅ Completo (una precisazione, vedi Discrepanza 3) |
| 2. Key domain concepts arricchito | ✅ Completo |
| 3. Conteggio righe corretto | ✅ Completo |
| 4. Prassi di chiusura ciclo | ✅ Completo, applicata da subito |
| 5. Regola GDPR pseudonimizzazione | ✅ Completo |
| 6. claudeProxy Claude/Gemini | ✅ Completo (parte server non verificabile dal client, riportata come detto da Simone) |
| 7. Credenziali in chiaro | ✅ Completo |
| 8. Comunicazioni nell'inventario | ✅ Completo (con discrepanza sul pulsante mese, vedi sopra) |
| 9. CONTESTO.md backlog + Registro decisioni | ✅ Completo (con discrepanza sulla voce multisessione, vedi sopra) |

**Cosa manca / attenzione**: le tre discrepanze sopra restano aperte in attesa di una decisione di Simone; nessuna di esse blocca la chiusura di questo ciclo, essendo tutte discrepanze di documentazione/UI da chiarire, non difetti introdotti da questo ciclo.

## Limiti di questa verifica
Analisi per lettura statica del codice (nessun motore JavaScript locale, nessun browser con accesso al dominio pubblicato in questo ambiente). Tutte le citazioni di riga si riferiscono allo stato di `index.html` al 16/07/2026 (2325 righe) prima di questo ciclo, che non ha toccato il codice. Verificati con `wc -l` i conteggi di riga dei quattro file coinvolti; nessun controllo di bilanciamento sintattico necessario in questo ciclo poiché `index.html` non è stato modificato.

---

# Verifica — Ciclo di pulizia del CONTESTO.md

**Nessuna modifica al codice in questo ciclo**: solo `CONTESTO.md` (e verifica, senza modifiche, di `CLAUDE.md`) e questo file. Data: 2026-07-16. Ciclo di chiusura delle 3 discrepanze lasciate aperte dal ciclo precedente ("Grande ciclo di allineamento documentale", voce sopra).

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt iniziale (10 punti numerati) conteneva già tutte le specifiche di contenuto, incluse le tre decisioni datate 16/07 (colori, multisessione giornaliera, ciclo comunicazioni).

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:* eseguire i 10 punti in autonomia, verificando ogni affermazione tecnica citata nel prompt contro il codice reale di `index.html` prima di scriverla in `CONTESTO.md`, e correggendo — quando trovati durante la rilettura finale — anche riferimenti incrociati diventati stantii per effetto delle modifiche stesse (vedi Passata 4 sotto), come da regola "verifica multi-passata a quattro fonti".

## Metodo di verifica: multi-passata a quattro fonti

1. **Passata 1 — riscontro nel codice reale dei fatti citati nel prompt**: `wc -l index.html` → 2325 righe (invariato, già allineato in `CONTESTO.md` §1); grep di `maxSessioniGiorno` → righe 1559, 1699, 1750, 1859 (tetto massimo usato in Passata 1/3, nessun campo `minSessioniGiorno`/pausa presente); grep di `cal-send-month` → righe 298 (markup) e 800 (solo toggle visibilità admin), nessun `addEventListener` collegato, confermato non funzionante; righe 1926-1929 (`sediAmmesse`/"Sessione scartata") → confermato che la sede composita proposta dall'IA è validata e **scartata** se non ammessa, mai corretta; righe 1979-1988/2311-2312 (`mkWeekMsg`, `#btn-wa`, `#btn-mail`) → confermato che l'invio settimanale esistente copre solo un singolo utente, nessun ambito/filtro stato/destinatario multiplo.
2. **Passata 2 — stesura**: applicati i 10 punti a `CONTESTO.md` punto per punto (rimozione voce §2 su `BACKLOG.md`, sezione test manuali, backlog pausa pranzo/multisessione/ciclo comunicazioni, sezione colori, Registro delle decisioni, §4 sul percorso IA, cronologia), ciascuno con riscontro di riga dove il punto lo richiedeva (8, 9, 10).
3. **Passata 3 — coerenza interna di `CONTESTO.md`**: la riscrittura della voce di backlog "multisessione giornaliera" (da 14 a 15, con lo spostamento di una posizione dovuto all'inserimento della nuova voce "pausa pranzo" come voce 3) ha reso stantio il riferimento "voce di backlog 14" nella decisione 4 del Registro delle decisioni (scritta nel ciclo precedente) — **trovato e corretto** in questa stessa passata: aggiornato a "voce di backlog 15" e il rimando alla discrepanza `maxSessioniGiorno` sostituito con un rimando alla nuova decisione 7, che la chiarisce. Verificata anche la numerazione della sezione Strumenti (ora 18-22, invariata nel contenuto, solo scalata di due posizioni per le due voci funzionali aggiunte prima).
4. **Passata 4 — confronto incrociato con le altre tre fonti**: `CLAUDE.md` (sezione "Comunicazioni nell'inventario architettura", riga 44) già descrive correttamente il pulsante "Invio mese" come non funzionante ("non ha alcun listener collegato... è un elemento UI non funzionante") — **nessuna correzione necessaria** (punto 9 del prompt chiedeva di correggerla solo se citava un export mensile come già esistente: non lo fa). La formulazione precisa sul percorso IA già scritta in `CLAUDE.md` (sezione Scheduling engine, tabella "generateMonthAI: risoluzione online...") è coerente con la nuova formulazione scritta in `CONTESTO.md` §4 in questo ciclo (stessa distinzione: Passata 2 ricalcolata, sede composita validata/scartata non corretta). Le tre discrepanze lasciate aperte dal ciclo precedente (vedi sezione "Discrepanze da discutere" sopra) sono ora tutte risolte da decisioni esplicite di Simone datate 16/07: la 1 (multisessione) dalla nuova specifica minimo+pausa, la 2 (pulsante Invio mese) dalla nuova voce di backlog "Ciclo comunicazioni" che ne prevede la rimozione, la 3 (formulazione IA) dalla correzione diretta del testo in `CONTESTO.md` §4.
5. **Passata 5 — rilettura finale integrale** di `CONTESTO.md` dopo tutte le modifiche: nessuna ulteriore incongruenza trovata (numerazione backlog 1-22 sequenziale e senza salti, Registro delle decisioni 1-7 sequenziale, cronologia 16/07 con le voci 15 e 16 in ordine) → passata "vuota", ciclo di verifica chiuso a 5 passate (minimo richiesto: 4).

## Verifica automatica per punto

| Punto | Richiesta | Stato | Riscontro |
|---|---|---|---|
| 1 | Conteggio righe `index.html` allineato | ✅ Confermato, nessuna modifica necessaria | `wc -l` → 2325, già scritto in CONTESTO.md §1 dal ciclo precedente |
| 2 | Rimuovere voce superata su `BACKLOG.md` | ✅ Fatto | Rimossa da CONTESTO.md §2 (il backlog vive in §6) |
| 3 | Test manuali segnati eseguiti con esiti + test residuo | ✅ Fatto | CONTESTO.md, cronologia 14/07: Annulla = bug confermato e corretto (ciclo 15/07, voce 13); Impostazioni = ok dopo fix `findIndex`; aggiunto test residuo per ritestare l'Annulla |
| 4 | Backlog pausa pranzo, priorità alta | ✅ Fatto | Backlog voce 3, con rimando alla specifica già in CLAUDE.md |
| 5 | Registro decisioni colori + sezione colori aggiornata | ✅ Fatto | CONTESTO.md §3 (colori) e §7 (decisione 6); nessun colore funzionale sedi/assenze toccato; nessun codice toccato (attuazione rimandata) |
| 6 | Data intestazione aggiornata a oggi | ✅ Confermato, nessuna modifica necessaria | Intestazione già "16/07/2026" = data odierna |
| 7 | Voce "Cognome Nome" segnata completata | ✅ Fatto | CONTESTO.md §3, completata il 14/07 |
| 8 | Backlog multisessione riscritto (min+pausa) + decisione di chiarimento | ✅ Fatto | Backlog voce 15 riscritta; decisione 7 nel Registro; verificato nel codice che solo `maxSessioniGiorno` esiste (righe 1559,1699,1750,1859), nessun minimo/pausa |
| 9 | Backlog "Ciclo comunicazioni" + verifica CLAUDE.md | ✅ Fatto | Backlog voce 17; CLAUDE.md verificato, già corretto (non cita export mensile come esistente), nessuna modifica |
| 10 | Correzione frase imprecisa su percorso IA | ✅ Fatto | CONTESTO.md §4, distinzione Passata 2 ricalcolata / sede composita validata-scartata |

**Cosa manca**: nessuna lacuna nota. Le tre discrepanze del ciclo precedente sono chiuse da decisioni esplicite di Simone in questo prompt, non da correzioni autonome. Resta, come sempre, il test residuo sull'Annulla (punto 3) da eseguire dal vivo da Simone.

## Limiti di questa verifica
Analisi per lettura statica del codice — nessuna modifica a `index.html` in questo ciclo, quindi nessun controllo di bilanciamento sintattico necessario. Le citazioni di riga si riferiscono allo stato di `index.html` invariato dal 15/07/2026 (2325 righe).

---

# Verifica — Ciclo colori brand su index.html

**Prima modifica al codice dal 14/07** (i due cicli precedenti erano solo documentali). Data: 2026-07-16.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna prima dell'inizio lavori. Durante l'esecuzione è emersa una discrepanza bloccante (vedi sotto), su cui è stata posta una domanda diretta.

*Domande poste a Simone e risposte ricevute:* il prompt chiedeva di sostituire "ovunque il navy #38378d con #34388f". Verificando il codice reale (grep case-insensitive su tutto `index.html`), **#38378d non esiste da nessuna parte** — la variabile CSS realmente usata per il navy/testo principale è `--navy`/`--ink`:#1A2744 (un blu-grigio scuro diverso da quello sempre documentato in `CONTESTO.md`). Il teal invece corrispondeva davvero al codice (#15B4B7 → variabili `--primary`/`--teal`). Domanda posta: come procedere, dato che il colore letterale da sostituire non esiste? Tre opzioni proposte (sostituire #1A2744 con #34388f; non toccarlo e fare solo il teal; indicare un altro colore). **Risposta di Simone**: sostituire #1A2744 con #34388f (opzione consigliata) — il "navy" da allineare al logo è la variabile CSS reale usata per il testo principale, non il valore mai esistito nella documentazione.

*Decisioni prese di conseguenza:*
- Sostituire `--ink`/`--navy` (#1A2744→#34388f) e `--primary`/`--teal` (#15B4B7→#10b3b8), inclusa la `--shadow` che incorpora la stessa tinta navy in formato `rgba(26,39,68,...)`→`rgba(52,56,143,...)` (riscontro diretto della stessa costante di colore, non un valore indipendente).
- Introdurre il celeste #a1daf8 come accento SOLO su `.banner.info` (nuova variabile `--celeste-soft:#E7F4FC`), scartando l'idea di applicarlo a `--primary-soft` (condivisa da bottoni/chip/nav/spinner: un cambiamento lì avrebbe alterato il linguaggio visivo di hover/stati attivi in tutta l'app, non un semplice accento decorativo — violando il vincolo "senza stravolgere layout").
- Non modificare `--primary-dark`:#0E8E91 (sfumatura scura derivata del teal, usata per stati hover): il prompt chiedeva la sostituzione del teal base, non delle sfumature derivate, e i due valori di teal (vecchio #15B4B7, nuovo #10b3b8) sono comunque quasi identici visivamente.
- Segnalare la discrepanza nella documentazione (non correggerla in silenzio prima di aver avuto conferma) come da regola permanente "verifica multi-passata" — la conferma di Simone sana la discrepanza per il codice; resta comunque annotata in `CONTESTO.md` come nota di fedeltà, a beneficio di chi legge in futuro.

## Metodo di verifica: multi-passata a quattro fonti

1. **Passata 1 — mappatura di tutte le occorrenze nel codice reale**: grep case-insensitive di `38378d` (0 occorrenze in tutto il file), di `1A2744`/`15B4B7` (4 righe: 15, 16, 21, 23) e di `rgba(26,39,68` (dentro la riga 21, stessa costante di colore in altro formato). Verificato che i colori funzionali NON compaiono in queste righe: sedi (riga 107, `.ev.cesate`/`.ev.busto`/`.ev.online`/`.ev.domicilio`, tutti valori distinti tipo #2B5BA0/#2E7D4F/#8A4A7D/#B65E2E), `ASSENZA_COLORI` (riga 514, valori distinti), logo SVG e favicon (righe 217-270, già in #10b3b8/#34388f/#a1daf8 dal ciclo precedente, non toccate).
2. **Passata 2 — applicazione mirata**: sostituiti i 4 valori individuati (righe 15,16,21,23) e aggiunta `--celeste-soft:#E7F4FC` (nuova dichiarazione, nessuna riga esistente toccata); cambiata una sola regola CSS (`.banner.info`, riga ~75) per l'accento celeste.
3. **Passata 3 — verifica che nessun colore funzionale sia stato toccato**: rieseguito il grep di sedi/`ASSENZA_COLORI`/logo-favicon dopo la modifica → tutti i valori risultano identici a prima (nessuna riga cambiata all'infuori delle 5 individuate in Passata 1-2).
4. **Passata 4 — sintassi e struttura**: conteggio dei caratteri `{ } ( ) [ ]` sull'intero file, confrontato fra la versione committata (`git show HEAD:index.html`) e la copia di lavoro modificata → **identico** in entrambi i casi (1028/1028 `{}`,4179/4179 `()`,457/457 `[]`), a conferma che la modifica è una pura sostituzione di valori senza impatto strutturale. Nessun motore Node/Python disponibile in questo ambiente (confermato, coerente con `CONTESTO.md` §2) per un parse JS completo; il controllo per bilanciamento caratteri è il metodo alternativo già in uso nei cicli precedenti.
5. **Passata 5 — contrasto testo/sfondo dove i colori sono cambiati** (calcolo WCAG, luminanza relativa sRGB): nuovo `--ink` #34388f su sfondo bianco/`--surface` → contrasto ≈9,95:1 (era ≈14,8:1 col vecchio #1A2744: il contrasto **diminuisce ma resta ampiamente sopra la soglia AAA di 7:1** per testo normale); `--ink` su nuovo `--celeste-soft` #E7F4FC (banner info) → contrasto ≈8,9:1, ampiamente sopra AA (4,5:1) e AAA; nav attiva (`--teal-soft` di sfondo, testo `--navy` nuovo) → contrasto ≈8,8:1. Nessun problema di leggibilità riscontrato in nessuno dei punti dove il colore è cambiato.
6. **Passata 6 — rilettura finale integrale del diff** (`git diff -- index.html`): 3 righe di variabili CSS modificate + 1 riga nuova (`--celeste-soft`) + 1 riga di regola `.banner.info` modificata, nessun'altra riga toccata nell'intero file di 2325 righe → passata "vuota", nessuna ulteriore incongruenza trovata. Ciclo chiuso a 6 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Richiesta | Stato | Riscontro |
|---|---|---|
| Sostituire navy #38378d→#34388f (var. CSS + occorrenze dirette, ogni case) | ⚠️ **Discrepanza chiarita in sessione**, poi ✅ Fatto | #38378d non esisteva; sostituito il navy reale `--ink`/`--navy` (#1A2744→#34388f) su conferma di Simone |
| Sostituire teal #15b4b7→#10b3b8 (var. CSS + occorrenze dirette, ogni case) | ✅ Fatto | `--primary`/`--teal` righe 16,23; nessun'altra occorrenza nel file |
| Celeste #a1daf8 come accento solo su tinte chiare decorative esistenti | ✅ Fatto, ambito minimo | Solo `.banner.info`, unico sfondo chiaro decorativo isolato individuato senza impatto su elementi condivisi |
| Non toccare colori funzionali (sedi/assenze/stati/logo/favicon) | ✅ Verificato (Passata 1 e 3) | Nessuna di queste righe compare nel diff |
| Verificare contrasto testo/sfondo dove i colori cambiano | ✅ Fatto (Passata 5) | Tutti i contrasti ≥8,8:1, ben sopra AA/AAA |
| Aggiornare sezione colori di CONTESTO.md, attuazione completata | ✅ Fatto | CONTESTO.md §3, con nota di fedeltà sulla discrepanza #38378d |
| Verifica automatica + Registro di sessione + controllo sintassi + cronologia + commit/push | ✅ Fatto | Questa voce; cronologia CONTESTO.md voce 17; commit/push in coda |

**Cosa manca**: nessuna lacuna nota. Consigliato — non bloccante — un controllo visivo rapido a video dopo il deploy (nessun browser con accesso al dominio pubblicato disponibile in questo ambiente).

## Limiti di questa verifica
Analisi per lettura statica del codice e calcolo di contrasto WCAG per formula (nessun motore JS/browser locale disponibile). Il controllo di bilanciamento sintattico è per conteggio di caratteri (non un parser reale), ma la natura chirurgica del diff (sole 5 righe, solo valori di colore) rende questo controllo sufficiente a escludere errori strutturali.

---

# Verifica — Nuovo stato "calendarizzata" e riparazione interattiva (documentale)

**Nessuna modifica al codice in questo ciclo**: solo `CLAUDE.md` e `CONTESTO.md` (e questo file). Data: 2026-07-16. Aggiornamento documentale di roadmap: due nuove regole di business pianificate (non ancora implementate).

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (3 punti numerati) conteneva già tutta la specifica di contenuto.

*Domande poste a Simone e risposte ricevute:* nessuna in questo ciclo (a differenza del ciclo colori precedente, qui non è emersa alcuna ambiguità che richiedesse di interrompere il lavoro per una conferma).

*Decisioni prese di conseguenza:*
- Scrivere le due nuove regole pianificate in `CLAUDE.md` nella stessa sezione ("Regole di business pianificate") già usata per pausa pranzo e pseudonimizzazione IA, senza toccare la sezione "Scheduling engine" (che documenta il comportamento *attuale* del codice, non quello pianificato) né la descrizione della Passata 3 in `CONTESTO.md` §4 (idem: quella sezione descrive cosa fa oggi `generateMonth`, non cosa farà).
- Segnalare, non risolvere in autonomia, una discrepanza trovata durante la stesura (vedi sotto) invece di correggerla o ometterla in silenzio, come da regola permanente "verifica multi-passata".

## Metodo di verifica: multi-passata a quattro fonti

1. **Passata 1 — ricerca della voce di backlog preesistente citata dal prompt**: il punto 3 del prompt dice che "la voce riparazione interattiva assorbe questa specifica", il che presuppone che una voce con questo nome esistesse già. Grep case-insensitive di `interattiv`/`riparazione` su `CLAUDE.md` e `CONTESTO.md` (stato prima di questo ciclo): **nessun riscontro** in nessuno dei due file, nella sezione backlog o altrove. Verificata anche l'unica menzione di "collaudo automatico" citata come prerequisito (punto 2 del prompt): esiste solo come voce 3 del Registro delle decisioni (una scelta architetturale già presa), non come voce di backlog tracciata a sé — annotato come osservazione minore, non richiesta dal prompt, quindi non corretta in questo ciclo.
2. **Passata 2 — stesura mirata**: scritte le due regole in `CLAUDE.md` (stato calendarizzata + Passata 3 a convergenza; riparazione interattiva a due fasi) nella sezione "Regole di business pianificate"; in `CONTESTO.md` nuova voce di backlog 4 "Riparazione interattiva + nuovo stato calendarizzata" (con conseguente rinumerazione 5→23 di tutta la lista funzionalità/strumenti), aggiornamento delle voci "pausa pranzo" (voce 3) e "Ciclo comunicazioni" (voce 18) con i rimandi incrociati richiesti dal punto 3, e tre nuove voci nel Registro delle decisioni (8, 9, 10).
3. **Passata 3 — coerenza interna di `CONTESTO.md` dopo la rinumerazione**: la rinumerazione del backlog (inserimento della voce 4) rende stantii tutti i riferimenti a numeri di voce ≥4 scritti nei cicli precedenti. Cercati e corretti: Registro delle decisioni voce 4 ("vedi voce di backlog 15" → 16, la multisessione giornaliera è slittata di una posizione) e voce 7 ("backlog, voce 15" → 16). Verificato che non esistano altri riferimenti numerici stantii (cercati pattern "voce 1[4-9]" e "backlog 1[4-9]" in tutto il file dopo le modifiche).
4. **Passata 4 — confronto incrociato fra le fonti**: verificato che `CLAUDE.md` (regole pianificate) e `CONTESTO.md` (backlog voce 4) raccontino la stessa specifica senza contraddirsi (stessa terminologia: calendarizzata/proposta/confermata/esiti, Fase 1/Fase 2, Applica/Attesa/Ignora, MAX_MOSSE=40 come tetto attuale citato in entrambi). Verificato che `CONTESTO.md` §3/§4 (stati sessione e Passata 3 *attuali*) non siano stati toccati, perché descrivono il codice presente, non la roadmap — coerenza con la prassi già seguita per pausa pranzo e GDPR nei cicli precedenti (regole pianificate mai anticipate nelle sezioni "stato attuale").
5. **Passata 5 — rilettura finale integrale di `CONTESTO.md`**: numerazione backlog 1→23 sequenziale senza salti né duplicati; Registro delle decisioni 1→10 sequenziale; cronologia 16/07 con le voci 15-18 in ordine. Nessuna ulteriore incongruenza trovata → passata "vuota", ciclo chiuso a 5 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | CLAUDE.md: stato "calendarizzata" + Passata 3 a convergenza + passaggio automatico all'invio | ✅ Fatto | Sezione "Regole di business pianificate"; nota di revisione sulla catena di stati inclusa |
| 2 | CLAUDE.md: riparazione interattiva a due fasi (Applica/Attesa/Ignora) | ✅ Fatto | Stessa sezione; blocco Fase 2 finché Fase 1 non è tutta Applica/Ignora incluso |
| 3 | CONTESTO.md: backlog + Registro delle decisioni (3 voci con motivazione) | ✅ Fatto | Backlog voce 4 (nuova) + aggiornamento voci 3 e 18; decisioni 8, 9, 10 |

**Discrepanza segnalata (non risolta in autonomia)**: la voce di backlog "riparazione interattiva" che il prompt indicava come preesistente non è stata trovata in nessuna delle quattro fonti prima di questo ciclo — scritta qui per la prima volta, con nota di fedeltà esplicita nel backlog stesso. Segnalata anche una tensione di sequenza non risolta: il punto 1 del prompt lega l'introduzione dello stato calendarizzata al cantiere di riparazione interattiva ("da implementare insieme a"), mentre il punto 3 lega la conversione di Passata 3 a convergenza al ciclo pausa pranzo (precedente, non lo stesso cantiere) — non è chiaro se lo stato calendarizzata debba esistere già prima del cantiere di riparazione interattiva vero e proprio. Entrambe le note sono state scritte nel backlog (voce 4) esattamente come emerse, senza risolverle per conto di Simone.

**Cosa manca**: nessuna lacuna nota sui 3 punti richiesti. Restano aperte le due note di fedeltà/sequenza sopra, da chiarire con Simone in un prossimo ciclo — non bloccanti per la chiusura di questo, essendo entrambe di natura documentale/di pianificazione, non difetti introdotti da questo ciclo.

## Limiti di questa verifica
Analisi per lettura statica dei tre file coinvolti (`CLAUDE.md`, `CONTESTO.md`, `VERIFICA.md`); nessuna modifica a `index.html`, quindi nessun controllo di sintassi del codice necessario in questo ciclo.

---

# Verifica — Chiusura giornata 16/07: Audit doppio, procedura di apertura, Quadro di controllo

**Nessuna modifica al codice in questo ciclo**: solo `CONTESTO.md` (e questo file). Data: 2026-07-16.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (3 punti numerati) conteneva già tutta la specifica di contenuto.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Aggiungere la voce di backlog "Audit doppio" **in coda** alla lista "Funzionalità" (dopo la voce 18 "Ciclo comunicazioni", come voce 19), non in mezzo alla lista: evita di dover rinumerare e ricontrollare tutti i riferimenti incrociati già presenti (voci 3/4/16/18), a differenza dei due cicli precedenti dove un inserimento a metà lista aveva reso stantii dei riferimenti. Gli unici numeri che si spostano sono quelli della sezione "Strumenti" (19-23→20-24), che non risultava referenziata altrove nel file (verificato).
- Segnalare, non correggere in silenzio, che nessuna "tappa dell'audit" preesistente risultava scritta prima di oggi (il prompt chiedeva di "estendere" una tappa esistente) — stessa gestione già adottata per la discrepanza "riparazione interattiva" nel ciclo precedente.

## Metodo di verifica: multi-passata a quattro fonti

1. **Passata 1 — ricerca della "tappa dell'audit" citata dal prompt**: grep case-insensitive di `audit`/`collaudo` su `CONTESTO.md` e `CLAUDE.md` (stato prima di questo ciclo) → l'unico riscontro è "Collaudo automatico delle regole" nel Registro delle decisioni (voce 3, una scelta architetturale già presa, non una tappa di roadmap a sé) e i suoi due rimandi come prerequisito nella voce di backlog "Riparazione interattiva" (voce 4). **Nessuna voce di roadmap chiamata "audit" esisteva prima di oggi.**
2. **Passata 2 — verifica che l'inserimento in coda non spezzi riferimenti incrociati**: grep di `voce (di backlog )?(19|20|21|22|23)` su tutto il file prima della modifica → nessun riscontro fuori dalla sezione "Strumenti" stessa: confermato che spostare Graphify/Ruflo/Caveman/Node.js/claude doctor da 19-23 a 20-24 non richiede correzioni altrove.
3. **Passata 3 — coerenza interna dopo le modifiche**: riletti tutti i rimandi numerici del backlog (voce 3 → "voce 4 sotto" ✓, voce 4 → "voce 18 sotto" ✓, voce 18 → "voce 4 sopra" ✓, voce 19 nuova senza rimandi in entrata da correggere) e del Registro delle decisioni (voce 4 → "backlog 16" ✓, voce 7 → "backlog, voce 16" ✓, entrambi già corretti nel ciclo precedente e non toccati da questo): numerazione backlog 1→24 e Registro decisioni 1→11 sequenziali, senza salti né duplicati.
4. **Passata 4 — confronto fra le tre richieste del prompt e il testo scritto**: (punto 1) voce 19 "Audit doppio" contiene entrambe le parti (a) statica e (b) funzionale, l'ordine "dopo il primo test di generazione con i dati reali", e la nuova voce 11 nel Registro delle decisioni con motivazione e alternativa scartata, come richiesto; (punto 2) la procedura di apertura giornata in §2 riporta tutti gli elementi elencati dal prompt nello stesso ordine (PowerShell → cd → claude → prompt zero: git pull, lettura dei tre file, riassunto senza modifiche, attesa prompt); (punto 3) il "Quadro di controllo" è descritto in §2 con tutti gli elementi richiesti (documento Word personale, generato/aggiornato da Claude in chat, consolida regole/verifiche/roadmap/mancanze, codici sezione.riga con i due esempi dati nel prompt).
5. **Passata 5 — rilettura finale integrale di `CONTESTO.md`**: nessuna ulteriore incongruenza trovata (intestazione data 16/07/2026 = oggi, invariata e corretta; cronologia 16/07 con le voci 15-19 in ordine) → passata "vuota", ciclo chiuso a 5 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Backlog: "Audit doppio" (audit statico + collaudo funzionale con utenze ZZTEST) + voce nel Registro delle decisioni | ✅ Fatto | Backlog voce 19; Registro decisioni voce 11 |
| 2 | Metodo di lavoro: procedura fissa di apertura giornata | ✅ Fatto | CONTESTO.md §2 |
| 3 | Metodo di lavoro: menzione del "Quadro di controllo" | ✅ Fatto | CONTESTO.md §2 |

**Discrepanza segnalata (non risolta in autonomia)**: la "tappa dell'audit" che il prompt chiedeva di "estendere" in "Audit doppio" non esisteva in nessuna delle quattro fonti prima di oggi — scritta per la prima volta con il nome definitivo, nota di fedeltà inclusa nella voce di backlog stessa. A differenza della discrepanza "riparazione interattiva" del ciclo precedente, qui non c'era alcuna tensione di contenuto da segnalare oltre alla semplice assenza pregressa.

**Cosa manca**: nessuna lacuna nota sui 3 punti richiesti.

## Limiti di questa verifica
Analisi per lettura statica di `CONTESTO.md`; nessuna modifica a `index.html` o `CLAUDE.md` in questo ciclo, quindi nessun controllo di sintassi del codice necessario.

---

# Verifica — Snellimento di CLAUDE.md (regole operative vs storico)

**Nessuna modifica al codice in questo ciclo**: solo `CLAUDE.md`, `CONTESTO.md` e questo file. Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt iniziale (7 punti numerati) conteneva già tutta la specifica: classificare ogni blocco di `CLAUDE.md` in "regole/istruzioni operative" vs "storico/contesto", spostare il secondo gruppo in `CONTESTO.md` senza riassumere né tagliare, tenere in `CLAUDE.md` solo il primo gruppo riorganizzato in modo compatto, aggiungere una decisione datata 17/07 sul ruolo permanente dei tre file, verificare con almeno 4 passate incrociando anche `VERIFICA.md`/`index.html`, aggiornare il registro di sessione.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Classificare l'intero `CLAUDE.md` blocco per blocco contro le due categorie definite dal prompt, invece di assumere a priori che contenesse una sezione storica distinta da estrarre.
- Dove un singolo blocco conteneva sia una regola operativa sia un'attribuzione/motivazione storica intrecciata (es. "decisione di Simone del 16/07..."), separare chirurgicamente: la regola resta in `CLAUDE.md`, l'attribuzione/cornice storica si sposta in `CONTESTO.md`, senza toccare il resto della frase.
- Aggiungere la decisione richiesta (17/07, ruolo dei tre file come fonte di verità) come voce 12 del Registro delle decisioni esistente in `CONTESTO.md` §7, non come sezione a parte, per coerenza con la regola permanente già in vigore lì ("questa sezione va alimentata a ogni ciclo con le nuove decisioni prese").
- Segnalare, non correggere in autonomia, la discrepanza di conteggio righe trovata durante l'incrocio con `index.html` (vedi Passata 5 sotto) — come da regola permanente "verifica multi-passata a quattro fonti".

## Metodo di verifica: multi-passata a quattro fonti

1. **Passata 1 — classificazione blocco per blocco di `CLAUDE.md` originale (108 righe)**: ogni sezione (Language, What this repo is, Running/testing, Architecture 1-11, Key domain concepts, Regole UX, Regole di business pianificate, Avvertenze di sicurezza, Manutenzione del CONTESTO.md, Prassi di chiusura ciclo) confrontata contro le due categorie del prompt. **Esito**: l'intero file risultava già regole/istruzioni operative (coerente con la prassi seguita nei cicli precedenti di tenere lo storico solo in `CONTESTO.md`), con la sola eccezione di **tre frammenti** di storico/attribuzione annidati dentro blocchi altrimenti operativi: (a) l'inciso datato "billing/vendor decision still pending as of 16/07/2026" dentro la descrizione di `CFG.claudeProxy` (Architecture, punto 2); (b) l'attribuzione "(decisione di Simone del 16/07, da implementare insieme alla riparazione interattiva sotto)" nella regola pianificata sullo stato "calendarizzata"; (c) l'attribuzione "(decisione di Simone del 16/07, cantiere dedicato dopo il collaudo automatico...)" nella regola pianificata sulla riparazione interattiva. Nessun blocco di regola di business invariante (sedi, aule, orari, gap 5 minuti, tre passate, stati sessione, pausa pranzo) o di convenzione tecnica (liste SharePoint, formato Title+Data, funzioni chiave) è risultato classificabile come storico: tutti sono rimasti in `CLAUDE.md`.
2. **Passata 2 — spostamento e verifica di non perdita**: i tre frammenti (a)/(b)/(c) sono stati rimossi da `CLAUDE.md` (con riformulazione minima della frase circostante per restare grammaticalmente corretta) e copiati **integralmente, senza riassumere né tagliare**, nella nuova sezione `CONTESTO.md` §9 "Storico decisioni e implementazioni", ciascuno datato 16/07/2026 (data della decisione originale, non del ciclo odierno). Confermato per ciascuno che il testo copiato in `CONTESTO.md` riporta la stessa frase esatta rimossa da `CLAUDE.md` (confronto carattere per carattere).
3. **Passata 3 — verifica che nessuna regola invariante sia finita nello storico**: riletta per intero la nuova sezione `CONTESTO.md` §9 confermando che contiene **solo** attribuzioni/cornici temporali ("chi ha deciso, quando, in che sequenza"), mai la specifica della regola stessa (che resta interamente in `CLAUDE.md`). Riletto anche l'intero `CLAUDE.md` risultante per confermare che tutte le regole esplicitamente citate dal prompt come esempio di categoria A — sedi/aule/orari/gap 5 minuti (Key domain concepts), tre passate (Scheduling engine), stati sessione (Key domain concepts), pausa pranzo (Regole di business pianificate), verifiche multi-passata e registro di sessione (Prassi di chiusura ciclo), struttura liste SharePoint e formato Title+Data (Architecture punto 3) — sono ancora presenti per intero.
4. **Passata 4 — coerenza interna e riferimenti incrociati**: verificato che i nuovi rimandi aggiunti in `CLAUDE.md` ("vedi CONTESTO.md, Registro delle decisioni, voce 8" e "...voce 9") puntino alle voci corrette in `CONTESTO.md` §7 (voce 8 = stato "calendarizzata", voce 9 = domande interattive in due fasi — confermato, nessun disallineamento). Verificato che la nuova riga di rimando in testa a `CLAUDE.md` citi correttamente i nomi delle sezioni esistenti in `CONTESTO.md` ("Registro delle decisioni" §7, "Storico decisioni e implementazioni" §9). Verificata la numerazione di `CONTESTO.md` dopo le tre aggiunte (cronologia 1-20, backlog 1-24 invariato, Registro delle decisioni 1-12, nuova §9): sequenziale, senza salti né duplicati.
5. **Passata 5 — incrocio con `VERIFICA.md` e `index.html`**: confrontate le regole/fatti tecnici rimasti in `CLAUDE.md` (architettura a tre passate, `MAX_MOSSE=40`, gap 5 minuti, finestra 09:00–19:30, domenica esclusa, requisito TUTTE le formazioni, rotazione tipi sessione continua, `noMonteOre` escluso, non sovrapposizione progetti stesso utente, `operatoreFisso`, credenziali in chiaro, `claudeProxy`→Gemini) contro i riscontri di riga già raccolti nel ciclo "Grande ciclo di allineamento documentale" (16/07, sopra in questo stesso file): nessuna discrepanza, `index.html` non è stato toccato da allora. Eseguito anche un controllo diretto su `index.html` in questo ciclo: `grep` di `MAX_MOSSE`/liste `Gestionale_`/`09:00`/`19:30`/`GAP` → tutti presenti (23 occorrenze complessive), coerenti con quanto documentato. **Discrepanza minore trovata**: `wc -l index.html` restituisce oggi **2326** righe, non le 2325 documentate sia in `CLAUDE.md` sia in `CONTESTO.md` (verificato che il file termina con un ritorno a capo finale dopo `</html>`, verosimile causa della differenza di una riga) — **segnalata qui e in `CONTESTO.md` (cronologia, voce 20), non corretta in questo ciclo puramente documentale** come da regola permanente "segnalare, mai correggere in silenzio".
6. **Passata 6 — rilettura finale integrale** di `CLAUDE.md` e `CONTESTO.md` dopo tutte le modifiche: nessuna ulteriore incongruenza trovata (nessun blocco orfano, nessun rimando rotto, nessuna regola duplicata o mancante) → passata "vuota", ciclo di verifica chiuso a 6 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Lettura integrale dei tre file | ✅ Fatto | `CLAUDE.md` (108 righe), `CONTESTO.md` (154 righe), `VERIFICA.md` (832 righe) lette per intero prima di ogni modifica |
| 2 | Classificazione di ogni blocco in categoria A/B | ✅ Fatto | Passata 1 sopra — esito: quasi tutto il file era già categoria A, solo 3 frammenti storici trovati |
| 3 | Blocchi B spostati in CONTESTO.md, copia integrale, sezione datata | ✅ Fatto | Nuova sezione `CONTESTO.md` §9 "Storico decisioni e implementazioni", 3 voci datate 16/07/2026 |
| 4 | CLAUDE.md solo blocchi A, compatto ma completo, riga di rimando in testa | ✅ Fatto | Riga di rimando aggiunta subito dopo il titolo; nessun'altra riorganizzazione necessaria (il file era già organizzato per regole, non per cronologia) |
| 5 | Decisione 17/07 sui tre file come fonte di verità | ✅ Fatto | `CONTESTO.md` §7, Registro delle decisioni, voce 12 (testo fornito da Simone, riportato integralmente) |
| 6 | Verifica finale multi-passata (min. 4, con elenco di cosa è stato spostato) | ✅ Fatto | 6 passate sopra, elenco degli spostamenti in Passata 1-2 |
| 7 | Registro di sessione in VERIFICA.md | ✅ Fatto | Questa voce |

**Cosa è stato spostato (riepilogo)**:
1. L'inciso "(billing/vendor decision still pending as of 16/07/2026; keep the client-facing format in mind if this changes)" → tolto da `CLAUDE.md` Architecture punto 2, spostato in `CONTESTO.md` §9 (con il fatto operativo "il proxy traduce verso Gemini" lasciato in `CLAUDE.md`, perché necessario per modificare il codice IA).
2. L'attribuzione "(decisione di Simone del 16/07, da implementare insieme alla riparazione interattiva sotto)" → tolta dalla regola "calendarizzata" in `CLAUDE.md`, spostata in `CONTESTO.md` §9 (la regola stessa resta intatta in `CLAUDE.md`).
3. L'attribuzione "(decisione di Simone del 16/07, cantiere dedicato dopo il collaudo automatico — vedi CONTESTO.md, Registro delle decisioni)" → tolta dalla regola "riparazione interattiva" in `CLAUDE.md`, spostata in `CONTESTO.md` §9 (la regola stessa resta intatta in `CLAUDE.md`).

**Cosa manca / attenzione**: nessuna lacuna sui 7 punti richiesti. Resta aperta, non bloccante, la discrepanza minore sul conteggio righe di `index.html` (2326 vs 2325 documentato) segnalata alla Passata 5.

## Limiti di questa verifica
Analisi per lettura statica dei tre file e di `index.html` (nessuna modifica al codice in questo ciclo, quindi nessun controllo di bilanciamento sintattico necessario). L'incrocio con `index.html` per i fatti tecnici già verificati riga per riga nel ciclo del 16/07 si è appoggiato a quel riscontro esistente (il file non è cambiato da allora, confermato via `git log`) più un controllo diretto mirato (grep di alcuni identificatori chiave e conteggio righe) in questo stesso ciclo.

---

# Verifica — Aggiornamento roadmap e backlog: Superpowers e Find Skills

**Nessuna modifica al codice in questo ciclo**: solo `CONTESTO.md` e questo file. Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (4 punti numerati) conteneva già tutta la specifica di contenuto e di posizionamento ("immediatamente prima della tappa 4.1 (audit statico del codice)").

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Interpretare "tappa 4.1 (audit statico del codice)" come la parte (a) della voce di backlog 19 "Audit doppio" (l'unica tappa del backlog che si chiama esplicitamente "audit statico del codice"): inserita la nuova voce Superpowers come voce di backlog **19** a sé stante, spingendo "Audit doppio" alla voce **20** — invece di annidarla come terza parte dentro "Audit doppio" — perché il testo fornito da Simone descrive un'azione distinta (installare e provare un plugin su un ramo dedicato), non una parte dell'audit stesso; l'audit vi compare solo come "banco di prova" per valutarne l'esito.
- Di conseguenza, rinumerata la sezione "Strumenti" (20-24 → 21-25) e aggiunta "Find Skills" come nuova voce Strumenti **26** (stessa sezione di Graphify/Ruflo/Caveman/Node.js/claude doctor, essendo anch'essa uno strumento di metodo per Claude Code da rivalutare al bisogno, non una funzionalità dell'app).
- Non toccare le voci di Cronologia lavori del 16/07 che citano "voce 19" per "Audit doppio": sono narrazione storica di ciò che era vero quel giorno (coerente con il precedente già stabilito nel ciclo "Ciclo di pulizia del CONTESTO.md", dove riferimenti stantii nel Registro delle decisioni — non nella Cronologia — erano stati corretti, mentre le voci di Cronologia restano invariate come registrazione del passato).

## Metodo di verifica

1. **Passata 1 — mappatura di tutti i riferimenti numerici al backlog prima della modifica**: `grep` di "voce 19", "voce 20", ..., "voce 24" e "backlog 19".."backlog 24" su `CONTESTO.md`: nessun riscontro fuori dalla sezione backlog stessa (la voce 19 "Audit doppio" e la sezione Strumenti 20-24) — confermato che lo spostamento non avrebbe richiesto altre correzioni incrociate.
2. **Passata 2 — inserimento e rinumerazione**: aggiunta la voce 19 Superpowers (testo fornito da Simone, integrale) subito prima di "Audit doppio" (rinumerata 19→20); rinumerata la sezione Strumenti (20-24→21-25); aggiunta "Find Skills" come voce Strumenti 26 (testo fornito da Simone, integrale).
3. **Passata 3 — rilettura della sequenza completa della roadmap/backlog (voci 1-26)**: numerazione sequenziale senza salti né duplicati confermata; verificato che le voci 1-18 (invariate) mantengano intatti i propri rimandi interni ("voce 4 sopra/sotto", "voce 18 sotto", "voce 3", "backlog 16" nel Registro delle decisioni) — nessuno di questi rimandi cade nell'intervallo 19-24 toccato dallo spostamento, quindi nessuno è stato invalidato dalla rinumerazione.
4. **Passata 4 — grep di conferma post-modifica**: rieseguito il grep "voce 19".."voce 26" su `CONTESTO.md` dopo le modifiche → unico riscontro esterno alla sezione backlog è la Cronologia lavori (voce 19 del 16/07, storica, corretta lasciarla invariata come da decisione sopra) e il rimando interno "(voce 20 sotto)" appena aggiunto nella nuova voce Superpowers, che punta correttamente ad "Audit doppio". Nessuna ulteriore incongruenza trovata → passata "vuota", ciclo chiuso a 4 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Nuovo passo Superpowers, immediatamente prima della tappa audit statico | ✅ Fatto | Backlog voce 19 (nuova), "Audit doppio" spostato a voce 20 |
| 2 | Nuova voce di backlog "Find Skills" | ✅ Fatto | Sezione Strumenti, voce 26 |
| 3 | Registro di sessione in VERIFICA.md | ✅ Fatto | Questa voce |
| 4 | Verifica finale: ordine coerente, nessun passo precedente alterato | ✅ Fatto | Passate 3-4 sopra: voci 1-18 invariate nel testo, solo il numero delle voci 19 (ora 20) e 20-24 (ora 21-25) è cambiato per far posto alle due nuove voci |

**Cosa manca**: nessuna lacuna nota sui 4 punti richiesti.

## Limiti di questa verifica
Analisi per lettura statica di `CONTESTO.md`; nessuna modifica a `index.html` o `CLAUDE.md` in questo ciclo, quindi nessun controllo di sintassi del codice necessario.

---

# Verifica — Ciclo di chiusura code documentali (titolo sezione, conteggio righe, nota riparazione interattiva)

**Nessuna modifica al codice in questo ciclo**: solo `CLAUDE.md`, `CONTESTO.md` e questo file. Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (4 punti numerati) conteneva già tutta la specifica di contenuto, incluso il testo esatto delle tre chiusure e della nuova regola permanente.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Applicare la sostituzione "~2325"→"~2300 righe (valore indicativo...)" **solo** alle due occorrenze di documentazione corrente (`CLAUDE.md` §"What this repo is", `CONTESTO.md` §1), non alle occorrenze di "2325" (senza tilde) presenti dentro voci storiche di `VERIFICA.md` e della Cronologia lavori di `CONTESTO.md` (voci 16 e 20): quelle sono narrazione di un fatto verificato in una data passata, non un valore "vivo" da tenere aggiornato — coerente con la prassi già seguita in questo repo di non riscrivere la Cronologia a posteriori (vedi ciclo precedente, decisione di non toccare "voce 19" nella Cronologia del 16/07).
- Aggiornato anche il rimando interno nella voce di backlog 4 ("vedi nota di fedeltà sotto" → "vedi nota chiusa il 17/07 sotto"), non richiesto esplicitamente dal prompt ma necessario per coerenza interna dopo aver rinominato l'intestazione della nota.
- **Segnalazione (non risolta in autonomia)**: la vecchia nota sulla riparazione interattiva conteneva due parti — (a) l'assenza di una voce preesistente con questo nome, e (b) una "tensione di sequenza" non risolta fra "calendarizzata implementata insieme alla riparazione interattiva" (voce 4) e "convergenza nel ciclo pausa pranzo" (voce 3). Il testo di chiusura fornito da Simone copre solo il punto (a). Il punto (b) non è più esplicitamente tracciato in nessuna delle tre fonti dopo questa sostituzione: se la tensione di sequenza è stata chiarita a voce e non richiedeva più annotazione, nessuna azione necessaria; se invece è ancora aperta, andrebbe ri-annotata in un prossimo ciclo. Non l'ho ripristinata di mia iniziativa perché il prompt chiedeva una sostituzione testuale esatta e integrale della nota.

## Metodo di verifica: multi-passata

1. **Passata 1 — correttezza delle tre chiusure, verificate una per una contro il testo fornito**: (1) titolo sezione 5 → confermato ora "## 5. Cronologia lavori" in `CONTESTO.md`, senza il vecchio range di date; (2) conteggio righe → confermate le due sostituzioni esatte in `CLAUDE.md` e `CONTESTO.md` col testo richiesto ("~2300 righe (valore indicativo...)"), e nuova regola permanente aggiunta in `CLAUDE.md` §"Manutenzione del CONTESTO.md" nei termini richiesti; (3) nota riparazione interattiva → confermato il testo di chiusura fornito da Simone riportato integralmente in `CONTESTO.md`, backlog voce 4.
2. **Passata 2 — grep di tutto il repo (file `.md`) per "2325" e per il vecchio titolo "Cronologia lavori (13"**: nessuna occorrenza di "~2325" residua in `CLAUDE.md`/`CONTESTO.md`; le uniche occorrenze rimaste di "2325" (senza tilde) sono nelle voci storiche di `VERIFICA.md` (verifiche del 15-16/07, narrazione di un conteggio confermato in quella data) e in due voci di Cronologia lavori di `CONTESTO.md` (16 e 20) che raccontano lo stesso fatto storico — lasciate intenzionalmente invariate (vedi Registro di sessione sopra). Nessuna occorrenza residua del vecchio titolo datato della sezione 5 in nessuno dei tre file.
3. **Passata 3 — coerenza incrociata fra `CLAUDE.md` e `CONTESTO.md`**: la nuova regola permanente in `CLAUDE.md` ("non si scrive mai un conteggio esatto di righe") è coerente con il valore "~2300" ora usato in entrambi i file (nessuno dei due contiene più un numero esatto in un punto di documentazione corrente); il rimando aggiornato in `CONTESTO.md` backlog voce 4 ("vedi nota chiusa il 17/07 sotto") punta correttamente alla nota appena sotto, che riporta esattamente il testo fornito da Simone.
4. **Passata 4 — rilettura finale integrale di `CLAUDE.md` e `CONTESTO.md`**: nessun'altra incongruenza trovata (numerazione di Cronologia/Backlog/Registro delle decisioni invariata e sequenziale rispetto al ciclo precedente; nessun altro blocco fa riferimento al vecchio titolo di sezione o al conteggio esatto) → passata "vuota", ciclo chiuso a 4 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Titolo sezione 5: "Cronologia lavori" senza date | ✅ Fatto | `CONTESTO.md` §5 |
| 2 | Chiusura discrepanza conteggio righe: "~2325"→"~2300 (indicativo)" in CLAUDE.md/CONTESTO.md + nuova regola permanente | ✅ Fatto | `CLAUDE.md` §"What this repo is" e §"Manutenzione del CONTESTO.md"; `CONTESTO.md` §1 |
| 3 | Nota riparazione interattiva sostituita col testo fornito | ✅ Fatto | `CONTESTO.md`, backlog voce 4 — **segnalazione**: il sub-punto "tensione di sequenza" della vecchia nota non è coperto dal nuovo testo, vedi Registro di sessione |
| 4 | Registro di sessione + verifica multi-passata (min. 4) | ✅ Fatto | Questa voce |

**Cosa manca / attenzione**: nessuna lacuna sui 4 punti richiesti nella lettera. Resta la segnalazione (non bloccante) sulla "tensione di sequenza" non più tracciata esplicitamente, riportata sopra per trasparenza.

## Limiti di questa verifica
Analisi per lettura statica dei tre file; nessuna modifica a `index.html` in questo ciclo, quindi nessun controllo di sintassi del codice necessario. La chiusura della discrepanza sul conteggio righe si basa sul riscontro già raccolto nel ciclo precedente (differenza attribuita al ciclo colori brand del 16/07) più il fatto che nessuna modifica a `index.html` è intervenuta da allora (confermato via `git log`).

---

# Verifica — Correzione di sequenza: convergenza legata a "calendarizzata", non alla pausa pranzo

**Nessuna modifica al codice in questo ciclo**: solo `CONTESTO.md` e questo file (verificata, senza modifiche, la coerenza di `CLAUDE.md`). Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt conteneva già la spiegazione tecnica completa del perché la sequenza fosse sbagliata (la convergenza opera solo su sessioni `calendarizzata`, stato che nasce nel cantiere "riparazione interattiva", non nel ciclo pausa pranzo) e il testo esatto da inserire nel Registro delle decisioni.

*Domande poste a Simone e risposte ricevute:* nessuna — questa correzione risolve direttamente la "tensione di sequenza" che era stata segnalata come aperta e non risolta in autonomia in due punti precedenti: la Cronologia lavori, voce 18 (16/07), e il riepilogo di stato dato a Simone a inizio di questa sessione (dopo `/clear`), dove era stata rimessa in evidenza come punto ancora da chiarire.

*Decisioni prese di conseguenza:*
- Corretta solo la voce di backlog 3 (pausa pranzo), che conteneva la "Nota 16/07" erronea; non toccata la voce di backlog 4 (riparazione interattiva + calendarizzata), che già descriveva correttamente la convergenza come esclusiva del proprio cantiere — nessuna correzione necessaria lì.
- Non toccata la Cronologia lavori (voce 18, 16/07) che per prima aveva segnalato la tensione come "non risolta": è narrazione storica di cosa era vero quel giorno, coerente con la prassi già seguita in questo repo di non riscrivere le voci di Cronologia a posteriori. La nuova voce di Cronologia di oggi (23) richiama esplicitamente la voce 18 per chi legge in sequenza.
- Aggiunta la decisione richiesta come voce 13 del Registro delle decisioni (testo di Simone riportato, con l'aggiunta di una riga "perché"/alternativa scartata per coerenza con le altre 12 voci della sezione, come richiesto dalla regola permanente lì presente).

## Metodo di verifica: multi-passata

1. **Passata 1 — correttezza della correzione contro la spiegazione tecnica del prompt**: confermato che la voce di backlog 3 ora dice esplicitamente che la conversione a convergenza "non fa parte di questo ciclo" e appartiene al cantiere calendarizzata (voce 4), e che nel ciclo pausa pranzo "la Passata 3 resta invariata (tetto `MAX_MOSSE=40`)" — corrisponde esattamente alla correzione richiesta.
2. **Passata 2 — grep di "convergenza" e "MAX_MOSSE" su `CLAUDE.md` e `CONTESTO.md`**: in `CONTESTO.md`, le uniche menzioni di "convergenza" restano nella voce di backlog 3 (ora corretta), nella voce di backlog 4 (già corretta, cantiere calendarizzata), nel Registro delle decisioni voce 8 (stato calendarizzata) e nella nuova voce 13; nessuna menzione residua che leghi la convergenza al ciclo pausa pranzo. In `CLAUDE.md`, "convergenza" compare solo nella regola "Nuovo stato di sessione calendarizzata" e in quella "Riparazione interattiva" — **mai** nella regola "Pausa pranzo": confermato che non serviva alcuna modifica a `CLAUDE.md`, come anticipato dal prompt ("verifica... se non lo è, allineala").
3. **Passata 3 — coerenza incrociata con le voci correlate**: la voce di backlog 16 "Multisessione giornaliera" (che dice "da implementare nel ciclo pausa pranzo") non è stata toccata perché riguarda un campo diverso (`minSessioniGiorno`/pausa tra sessioni), non la Passata 3 a convergenza — nessuna confusione tra le due voci confermata per lettura diretta. Il rimando incrociato aggiunto nella nuova voce 13 del Registro delle decisioni ("backlog voce 4", "backlog voce 3") punta correttamente alle voci corrispondenti dopo tutte le rinumerazioni dei cicli precedenti (verificato che voce 3 = pausa pranzo e voce 4 = calendarizzata sono tuttora tali, invariate dai cicli precedenti).
4. **Passata 4 — rilettura finale integrale della sezione Backlog e del Registro delle decisioni di `CONTESTO.md`**: numerazione sequenziale confermata (backlog 1-26, Registro delle decisioni 1-13, Cronologia 1-23), nessun'altra voce fa più riferimento a "convergenza...pausa pranzo" insieme → passata "vuota", ciclo chiuso a 4 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Correggere la voce di backlog che lega la convergenza al ciclo pausa pranzo | ✅ Fatto | `CONTESTO.md`, backlog voce 3 |
| 2 | Verificare/allineare `CLAUDE.md` | ✅ Verificato, già coerente | Nessuna modifica necessaria (convergenza mai citata sotto "Pausa pranzo") |
| 3 | Nuova voce nel Registro delle decisioni | ✅ Fatto | `CONTESTO.md` §7, voce 13 (testo di Simone + motivazione/alternativa scartata) |
| 4 | Registro di sessione + verifica multi-passata (min. 4) + commit e push | ✅ Fatto (registro e verifica) | Commit e push a seguire |

**Cosa manca**: nessuna lacuna sui 4 punti richiesti. La correzione chiude anche la segnalazione aperta nel ciclo precedente (VERIFICA.md, "Ciclo di chiusura code documentali") sulla "tensione di sequenza" non più tracciata: ora è tracciata di nuovo, in forma corretta, nella voce 13 del Registro delle decisioni.

## Limiti di questa verifica
Analisi per lettura statica di `CONTESTO.md` e `CLAUDE.md`; nessuna modifica a `index.html` in questo ciclo, quindi nessun controllo di sintassi del codice necessario.

---

# Verifica — Ciclo documentale doppio: igiene del contesto + collaudo automatico anticipato

**Nessuna modifica al codice in questo ciclo**: solo `CLAUDE.md`, `CONTESTO.md` e questo file. Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (3 punti numerati) conteneva già il testo esatto delle due aggiunte e della motivazione da registrare.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Aggiunta la regola "Igiene del contesto" come **(d)** in `CLAUDE.md` §"Prassi di chiusura ciclo", aggiornando "Tre regole permanenti" in "Quattro regole permanenti" in testa alla sezione (non richiesto esplicitamente ma necessario per coerenza interna, altrimenti il conteggio sarebbe rimasto stantio).
- Inserita la decisione sul collaudo automatico **dentro** la voce di backlog 3 (pausa pranzo), in coda alla nota di correzione di sequenza del ciclo precedente, invece che come voce di backlog separata: il prompt la descrive come una specifica del *contenuto* di quel ciclo (cosa deve già coprire il collaudo automatico che vi nasce), non come un nuovo elemento di roadmap a sé.
- Verificato che "collaudo automatico" (funzione interna di test, Registro delle decisioni voce 3, ora richiamata anche dalla nuova voce 14) e "Audit doppio" (backlog voce 20: audit statico + collaudo funzionale manuale con utenze ZZTEST) restano due concetti distinti e non sovrapposti — nessuna correzione necessaria, ma verificato esplicitamente per escludere confusione fra i due prima di scrivere la voce 14.

## Metodo di verifica: multi-passata

1. **Passata 1 — le due aggiunte sono al posto giusto?** `CLAUDE.md`: la regola "Igiene del contesto" è stata inserita in §"Prassi di chiusura ciclo", la stessa sezione che già contiene le altre regole di prassi operativa/sessione (a-c) — posto corretto, non è una regola di dominio né un'istruzione tecnica. `CONTESTO.md`: la decisione sul collaudo automatico è stata inserita nella voce di backlog 3 (pausa pranzo), esattamente come richiesto dal prompt ("nella voce di roadmap/backlog del ciclo pausa pranzo"), e la voce 14 nel Registro delle decisioni, nella sezione che già raccoglie tutte le decisioni con motivazione — posto corretto per entrambe.
2. **Passata 2 — nessun conflitto con le regole esistenti?** Verificato che la nuova regola (d) non contraddica (a)/(b)/(c): (a) chiede comunque commit+push+verifica prima della chiusura, (d) aggiunge solo cosa fare *dopo* quella chiusura (`/clear`) e cosa fare se si vuole interrompere *prima* (`/compact` o commit documentale) — non sovrapposizione, solo un caso nuovo coperto. Verificato che la decisione 14 (collaudo automatico deve coprire gli stati attuali) non contraddica la decisione 13, appena aggiunta nel ciclo precedente (convergenza legata a calendarizzata): le due sono complementari, non in tensione — la 13 dice *quando* la convergenza può iniziare (dopo che calendarizzata esiste), la 14 dice che il collaudo automatico, costruito prima e sulle regole di *oggi*, non ha bisogno di aspettare calendarizzata per coprire gli stati già in vigore.
3. **Passata 3 — grep di conferma su entrambi i file**: `grep` di "Quattro regole permanenti"/"(d)" in `CLAUDE.md` → un solo riscontro, coerente; `grep` di "collaudo automatico" in `CONTESTO.md` → 5 riscontri (backlog voce 3 nuovo, backlog voce 4 preesistente, Registro decisioni voce 3 preesistente, Registro decisioni voce 14 nuovo, più l'occorrenza nel Registro di sessione di questa stessa voce) — nessuna occorrenza isolata o contraddittoria, tutte coerenti fra loro sul fatto che il collaudo automatico nasce nel ciclo pausa pranzo (backlog voce 3) e che il cantiere calendarizzata (backlog voce 4) viene dopo.
4. **Passata 4 — rilettura finale integrale delle sezioni toccate**: `CLAUDE.md` §"Prassi di chiusura ciclo" (a-d) e `CONTESTO.md` backlog (1-26) + Registro delle decisioni (1-14) rilette per intero: numerazione sequenziale, nessun riferimento incrociato rotto, nessun'altra incongruenza trovata → passata "vuota", ciclo chiuso a 4 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Nuova regola "Igiene del contesto" in CLAUDE.md, sezione "Prassi di chiusura ciclo" | ✅ Fatto | `CLAUDE.md`, regola (d) |
| 2 | Decisione sul collaudo automatico nella voce backlog pausa pranzo + voce nel Registro delle decisioni con la motivazione data | ✅ Fatto | `CONTESTO.md`, backlog voce 3 e Registro delle decisioni voce 14 |
| 3 | Registro di sessione + verifica multi-passata (le due aggiunte al posto giusto, nessun conflitto) + commit e push | ✅ Fatto (registro e verifica) | Commit e push a seguire |

**Cosa manca**: nessuna lacuna sui 3 punti richiesti.

## Limiti di questa verifica
Analisi per lettura statica di `CLAUDE.md` e `CONTESTO.md`; nessuna modifica a `index.html` in questo ciclo, quindi nessun controllo di sintassi del codice necessario.

---

# Verifica — Ciclo 0: registrazione "Modifiche dal campo" del 17/07 (S1-S11)

**Nessuna modifica al codice in questo ciclo**: solo `CLAUDE.md`, `CONTESTO.md` e questo file. Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt conteneva già le 11 specifiche tecniche complete, il piano dei 7 cicli (A-G) con l'assegnazione di ciascuna specifica, e le istruzioni di collocazione (regole in CLAUDE.md, pianificazione in CONTESTO.md, decisioni con motivazione nel Registro).

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Collocata ciascuna delle 11 specifiche come voce a sé nel Registro delle decisioni (voci 15-25), invece di un'unica voce cumulativa: il prompt chiedeva esplicitamente "ogni decisione con motivazione", e le 11 specifiche sono decisioni indipendenti (ciascuna con un perché proprio), non sfaccettature di un'unica decisione. Aggiunta una dodicesima voce (26) per la decisione sul piano di rilascio in sé (l'ordine dei 7 cicli), distinta dalle decisioni sul contenuto delle singole specifiche.
- La voce di backlog nuova (21, "Modifiche dal campo — piano cicli A-G") è stata inserita **in coda** alla lista Funzionalità (dopo "Audit doppio", voce 20) e non in mezzo, seguendo lo stesso criterio già adottato per "Audit doppio" nel ciclo del 16/07: evita di dover rinumerare e ricontrollare le voci 1-20 già referenziate altrove nel file. Solo la sezione Strumenti si è dovuta rinumerare (21-26→22-27), verificato che non fosse referenziata altrove (vedi Passata 4).
- Per S3 (report persistenti, UI da decidere), registrata una **decisione esplicitamente aperta** nel Registro (voce 17) invece di una decisione chiusa: il prompt chiede di "registrare come decisione aperta, non implementare interfacce provvisorie" — coerente con lo stile del Registro (che normalmente registra decisioni prese), qui si registra la scelta di costruire subito la lista SharePoint ma di rimandare la sola collocazione UI, con la motivazione esplicita del perché rimandarla (non costruire un'interfaccia provvisoria).
- Per S4 (rinomina sedi composite), aggiunta nella specifica stessa (non richiesta esplicitamente dal prompt, ma necessaria per non lasciare un buco) una nota che quando la rinomina sarà implementata andranno aggiornate anche le altre menzioni di `Presenza+Online`/`Presenza+Domicilio` nel file (non solo "Key domain concepts", citata nel prompt come sezione da tenere a mente): la Passata 1 (riga 37) e i limiti di `generateMonthAI` (riga 43) citano gli stessi nomi e andrebbero aggiornati insieme.

## Metodo di verifica: multi-passata

1. **Passata 1 — ogni specifica presente e fedele al testo del prompt?** Rilette S1-S11 in `CLAUDE.md` una per una contro il testo esatto del prompt: tutti gli elementi tecnici richiesti sono presenti (avviso graduato per stato in S1, filtro a cascata in S2, schema Title+Data e UI da decidere in S3, migrazione + regola Busto invariata in S4, campo Sede in S5, minuti interni + nota vincolante in S6, "mai superata... nemmeno dalla Passata 3" in S7, due campi + migrazione in S8, permessi differenziati + esclusione esplicita di "calendarizzata" in S9, alternanza + rimando a riparazione interattiva in S10, finestra 23-30gg + vincolo cross-mese esplicito in S11). Nessuna specifica riassunta o tagliata.
2. **Passata 2 — coerenza con le regole esistenti, nessun conflitto?** `S4` non contraddice la regola invariante "mai Busto Arsizio nelle composite" (Key domain concepts, riga 50): la specifica lo dice esplicitamente ("la regola invariante... resta identica — cambia solo l'etichetta"). `S7` non contraddice la descrizione attuale della Passata 3 (Architecture, riga 39): quella descrive cosa fa *oggi* il codice (recupera un deficit), S7 è una regola *pianificata* che si aggiunge come vincolo duro, non una correzione contraddittoria. `S9` non contraddice la sezione "Sessioni states" (Key domain concepts, riga 58): i 5 stati restano gli stessi, cambia solo il numero di campi che li rappresentano. `S1` non contraddice il sistema di ruoli esistente (Auth + role resolution, riga 32): "solo Admin" è coerente con la distinzione Admin/Operatore già in `TABS`. Nessun conflitto trovato.
3. **Passata 3 — nessun conflitto con la sequenza calendarizzata (Registro decisioni voce 13)?** `S9` include esplicitamente la clausola "lo stato calendarizzata NON entra in questo ciclo... appartiene al cantiere dedicato" — coerente con la decisione 13 (la convergenza, e quindi lo stato calendarizzata, restano legati al cantiere "Riparazione interattiva", non anticipati altrove). `S10` rimanda esplicitamente al cantiere riparazione interattiva la sola parte che userebbe l'ordine dei tipi di sessione come leva di scambio, senza anticiparla. Nessuna delle 11 specifiche introduce lo stato `calendarizzata` o la Passata 3 a convergenza fuori dal cantiere dedicato: verificato con `grep` di "calendarizzata" nella nuova sottosezione — unica occorrenza è la clausola di esclusione in S9.
4. **Passata 4 — il piano cicli è completo?** Mappatura incrociata specifiche↔cicli: S1→D, S2→E, S3→E, S4→A, S5→C, S6→B, S7→C, S8→B, S9→D, S10→G, S11→F — tutte e 11 le specifiche compaiono esattamente una volta, nessun duplicato, nessuna omessa, tutti e 7 i cicli (A-G) hanno almeno una specifica assegnata, corrispondente esattamente al piano dato nel prompt. Verificato anche (`grep` "voce 21".."voce 27" su `CONTESTO.md`) che la rinumerazione della sezione Strumenti (21-26→22-27) non lasci riferimenti incrociati rotti: nessun riscontro esterno alla sezione Strumenti stessa.
5. **Passata 5 — coerenza incrociata backlog↔Registro delle decisioni↔CLAUDE.md**: la voce di backlog 21 cita "decisione aperta nel Registro delle decisioni" per S3 → corrisponde alla voce 17, effettivamente aperta. La specifica S9 in `CLAUDE.md` cita "Registro delle decisioni voce 8" per lo stato calendarizzata → confermato che la voce 8 è proprio "Stato di sessione calendarizzata". Numerazione del Registro delle decisioni (1-26) e del backlog (1-27) sequenziali, senza salti né duplicati.
6. **Passata 6 — rilettura finale integrale** delle sezioni toccate di `CLAUDE.md` (sottosezione S1-S11 per intero) e `CONTESTO.md` (backlog 1-27, Registro delle decisioni 1-26, Cronologia lavori voce 25): nessun'altra incongruenza trovata → passata "vuota", ciclo chiuso a 6 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Specifica | In CLAUDE.md | Ciclo assegnato | Decisione nel Registro | Nota |
|---|---|---|---|---|
| S1 — Eliminazione multipla sessioni | ✅ | D | ✅ voce 15 | — |
| S2 — Filtri utente→progetto | ✅ | E | ✅ voce 16 | — |
| S3 — Report persistenti | ✅ | E | ✅ voce 17 | **Decisione aperta**: collocazione UI, come richiesto |
| S4 — Rinomina sedi composite | ✅ | A | ✅ voce 18 | Nota aggiunta su altre menzioni da aggiornare (righe 37, 43 oltre a Key domain concepts) |
| S5 — Disponibilità limitata alla sede | ✅ | C | ✅ voce 19 | — |
| S6 — Monte ore/ore Metodo in h:mm | ✅ | B | ✅ voce 20 | — |
| S7 — Vincolo duro frequenza settimanale | ✅ | C | ✅ voce 21 | — |
| S8 — Tempo Busto sdoppiato | ✅ | B | ✅ voce 22 | — |
| S9 — Campo stato unico | ✅ | D | ✅ voce 23 | Esclusione esplicita di "calendarizzata" verificata |
| S10 — Tipi di sessione con sede | ✅ | G | ✅ voce 24 | Leva riparazione interattiva rimandata, come richiesto |
| S11 — Frequenza mensile | ✅ | F | ✅ voce 25 | Vincolo cross-mese esplicito riportato |
| Piano di rilascio A-G (voce a sé) | n/a | n/a | ✅ voce 26 | — |

**Cosa manca**: nessuna lacuna sulle 11 specifiche né sul piano cicli. Registro di sessione e verifica multi-passata completati in questa stessa voce.

## Limiti di questa verifica
Analisi per lettura statica di `CLAUDE.md` e `CONTESTO.md`; nessuna modifica a `index.html` in questo ciclo (nessuna delle 11 specifiche è stata implementata: sono tutte pianificate), quindi nessun controllo di sintassi del codice necessario. Le specifiche restano da collaudare contro il codice reale nei rispettivi cicli di implementazione (A-G).

---

# Verifica — Ciclo A: rinomina sedi composite (S4)

**Prima modifica al codice dal ciclo colori brand del 16/07**: `index.html`, `CLAUDE.md`, `CONTESTO.md` e questo file. Data: 2026-07-17.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (4 punti numerati) conteneva già la specifica completa, incluso il rimando esplicito a lasciare a me la scelta implementativa su valori interni vs sole etichette, a patto di dichiararla con motivazione.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- **Scelta dichiarata (punto 1 del prompt): rinominare il valore memorizzato stesso, non solo un'etichetta di visualizzazione.** Motivazione: in questo codice il campo `sede` di un progetto è una stringa semplice usata direttamente sia come valore di confronto nella logica (`p.sede==='Presenza+Online'` ecc., in `sdComp`, `sedePriorita`, `slotCompatibile`, validazione post-IA) sia come testo mostrato nella `<select>` (`<option>` senza attributo `value` separato dal testo — l'opzione usa la stessa stringa come valore e come contenuto visibile). Non esiste nel codice uno strato "valore interno" ↔ "etichetta" per questo campo (a differenza, per dire, degli stati sessione che hanno un `STATI_SESS` con eventuali etichette/icone separate). Introdurre un simile strato di traduzione solo per questa rinomina — mantenendo il valore salvato `Presenza+Online` ma mostrando `Cesate+Online` in UI — avrebbe significato aggiungere una mappa valore→etichetta e toccare ogni punto di confronto per farlo passare dal valore "grezzo", più complesso e più a rischio di disallineamento (bug: un punto dimenticato confronterebbe ancora col valore visualizzato invece che con quello salvato) rispetto a rinominare direttamente la stringa e migrare i dati esistenti. Scartata quindi l'opzione "solo etichetta".
- Non toccate le sessioni (`s.sede`): verificato che una sessione non assume mai il valore composito (si risolve sempre a un sito concreto — `Cesate`/`Online`/`Busto Arsizio`/`Domicilio` — tramite `slotCompatibile`/`decidiOnlineDaCasa`), quindi nessuna migrazione né rinomina necessaria sulla lista `sessioni`, solo su `progetti`.
- Aggiornate anche le menzioni operative dei nomi vecchi in `CLAUDE.md` ("Key domain concepts", Architecture punto 3) e in `CONTESTO.md` (§3 Specifiche di dominio, §4 Architettura algoritmo) perché descrivono lo stato *corrente* del codice, non lo storico — lasciate invariate le voci di Cronologia lavori e del Registro delle decisioni che narrano cosa era vero il 16-17/07 prima di questa modifica (coerente con la prassi già seguita nei cicli documentali precedenti).
- Nella sottosezione "Modifiche dal campo — 17/07" di `CLAUDE.md` e nella voce di backlog 21 di `CONTESTO.md`, la voce S4/Ciclo A è stata marcata **✅ completata** invece di rimossa, per non spezzare la numerazione S1-S11 e i suoi riferimenti incrociati (usati anche dalle altre voci del piano cicli e del Registro delle decisioni).

## Metodo di verifica: multi-passata

1. **Passata 1 — nessun nome vecchio residuo attivo, fuori dallo storico?** `grep` di `Presenza+Online`/`Presenza+Domicilio` su `index.html`: **zero occorrenze** (erano 19, su 12 righe, nella versione precedente al commit). Su `CLAUDE.md`: 3 occorrenze residue, tutte intenzionalmente storiche/esplicative (la nota sulla migrazione in Architecture, la nota "erano..." nella regola Sedi, il marcatore ✅ completato di S4) — nessuna delle tre afferma che il nome vecchio sia ancora in uso. Su `CONTESTO.md`: 3 occorrenze residue, stesso trattamento (§3 con "erano...", voce di backlog 21 col marcatore ✅ e la freccia `vecchio→nuovo`, Registro delle decisioni voce 18 che narra la decisione presa il 17/07 con la motivazione — tutte narrative/storiche, nessuna operativa). Confermato che le sezioni operative correnti (Key domain concepts, Architecture, CONTESTO §3/§4) non contengono più il nome vecchio come fatto attuale.
2. **Passata 2 — l'invariante "mai Busto Arsizio nelle composite" è rimasta identica nella logica?** Confronto riga per riga fra la versione committata (`git show HEAD:index.html`) e quella nuova sui tre punti dove la regola è applicata: (a) validazione post-IA — `sediAmmesse=pr.sede==='Presenza+Online'?['Cesate','Online']:pr.sede==='Presenza+Domicilio'?['Cesate','Domicilio']:null` → `sediAmmesse=pr.sede==='Cesate+Online'?['Cesate','Online']:pr.sede==='Cesate+Domicilio'?['Cesate','Domicilio']:null` — gli array `['Cesate','Online']`/`['Cesate','Domicilio']` (l'elenco delle sedi ammesse, che esclude sempre Busto Arsizio) sono **identici, carattere per carattere**, cambia solo la stringa a sinistra del `?`; (b) `slotCompatibile` (Passata 1) — stessa cosa: `r.sedi.includes('Cesate')||r.sedi.includes('Online')` e `r.sedi.includes('Cesate')||r.sedi.includes('Domicilio')` invariati, cambia solo la condizione d'ingresso `p.sede===...`; (c) prompt IA — la riga "usa SOLO Cesate oppure Online: mai Busto Arsizio" e "usa SOLO Cesate oppure Domicilio: mai Busto Arsizio" sono testualmente invariate a parte il nome della sede citato. In nessuno dei tre punti è cambiato l'insieme delle sedi ammesse o escluse: solo l'etichetta che vi si arriva.
3. **Passata 3 — la migrazione è corretta e sarà collaudata sui dati di prova?** Riletto il nuovo blocco in `loadAll()`: itera `state.data.progetti`, riscrive `p.sede` da `Presenza+Online`/`Presenza+Domicilio` a `Cesate+Online`/`Cesate+Domicilio`, e se almeno un progetto è stato modificato salva **tutti** i progetti (stesso pattern, non ottimale ma coerente, della migrazione nome→nome+cognome già presente in questo stesso file). **Non è stato possibile eseguirla dal vivo**: nessun ambiente con login Microsoft 365 disponibile in questa sessione (limite noto, documentato in tutti i cicli precedenti che toccano `index.html`). **Raccomando fortemente a Simone di aprire il sito subito dopo il deploy e verificare**: (a) in console del browser compare il log `Migration: sedi composite rinominate in Cesate+Online/Cesate+Domicilio` se esistono progetti di test con la sede vecchia; (b) riaprendo la scheda di quei progetti, il campo "Sede" mostra ora `Cesate+Online`/`Cesate+Domicilio` selezionato; (c) l'algoritmo di generazione continua a funzionare normalmente su quei progetti (nessuna sessione smette di rispettare "mai Busto Arsizio"). Come richiesto dal prompt, i dati di prova esistenti sono il banco di prova — non ne ho eliminato né modificato nessuno.
4. **Passata 4 — sintassi di `index.html` integra?** Nessun motore JavaScript disponibile in questo ambiente (Node.js non installato, confermato coerente con `CONTESTO.md` §2). Controllo per bilanciamento caratteri fra la versione committata e quella nuova: `{`/`}` 1028→1034 (+6/+6, bilanciato), `(`/`)` 4179→4189 (+10/+10, bilanciato), `[`/`]` 457→457 (invariato). Conteggio righe 2326→2335 (+9, corrispondente esattamente al blocco di migrazione aggiunto). `git diff` riletto per intero riga per riga: ogni modifica è o (a) una sostituzione letterale di stringa nello stesso punto logico di prima, o (b) il nuovo blocco di migrazione — nessuna riga toccata al di fuori di queste 12+1 zone.
5. **Passata 5 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (Key domain concepts, Architecture, sottosezione S4) e `CONTESTO.md` (§3, §4, backlog voce 21/Ciclo A) descrivono ora lo stesso stato corrente con gli stessi nomi nuovi, senza contraddirsi; entrambi rimandano coerentemente alla stessa motivazione (decisione 17/07). Verificato che nessuna voce storica di Cronologia o Registro delle decisioni sia stata alterata (solo narrazione del passato, mai riscritta, come da prassi permanente).
6. **Passata 6 — rilettura finale integrale** delle sezioni toccate nei tre documenti + del diff completo di `index.html`: nessun'altra incongruenza trovata → passata "vuota", ciclo chiuso a 6 passate (minimo richiesto: 4).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Rinomina nel codice (etichette + valori interni o solo etichette, scelta dichiarata) | ✅ Fatto | Scelta: rinominato il valore stesso (motivazione nel Registro di sessione sopra) — 19 occorrenze su 12 righe |
| 2 | Migrazione dati progetti esistenti, banco di prova sui dati di test | ✅ Codice fatto, ⚠️ non eseguibile dal vivo in questo ambiente | Migrazione one-time in `loadAll()`, stesso pattern di nome→nome+cognome; da confermare da Simone dopo il deploy |
| 3 | Documenti aggiornati (Key domain concepts + altre menzioni CLAUDE.md; menzioni operative CONTESTO.md, non lo storico) | ✅ Fatto | `CLAUDE.md`: Architecture punto 3 (nota migrazione), Passata 1 (riga 37) e limiti `generateMonthAI` (riga 43), "Key domain concepts" righe 50/53 — tutte e 4 le menzioni operative trovate in Passata 1 sono state aggiornate; `CONTESTO.md` §3 e §4 |
| 4 | Invariante "mai Busto Arsizio" dimostrata identica | ✅ Dimostrato | Passata 2 sopra: stessi array di sedi ammesse, cambiata solo la stringa-condizione |

**Cosa manca / attenzione**: l'unico punto non chiudibile in questa sessione è la conferma dal vivo della migrazione sui dati di prova (nessun ambiente di test disponibile qui) — raccomandazione esplicita a Simone riportata alla Passata 3.

## Limiti di questa verifica
Analisi per lettura statica del codice; verificato il bilanciamento sintattico (parentesi graffe/tonde/quadre) sull'intero file prima e dopo la modifica, nessun motore JavaScript locale né browser con accesso al dominio pubblicato disponibile in questo ambiente per un test dal vivo della migrazione o della generazione. Si raccomanda il test manuale descritto alla Passata 3 subito dopo il deploy.

---

# Verifica — Chiusura test dal vivo Ciclo A + novità Node.js — Ciclo B: S6 + S8

Data: 2026-07-17.

## Chiusura punto aperto dal ciclo precedente (Ciclo A/S4)

Simone ha eseguito il test dal vivo raccomandato alla Passata 3 della verifica precedente: dopo il deploy, la console del browser ha mostrato il log `Migration: sedi composite rinominate in Cesate+Online/Cesate+Domicilio` e la scheda del progetto di test ha mostrato correttamente il campo Sede aggiornato a `Cesate+Online`/`Cesate+Domicilio`. **L'unico punto rimasto aperto nella verifica del Ciclo A è quindi chiuso**: la migrazione S4 è confermata funzionante anche dal vivo, non solo per lettura statica del codice.

## Novità d'ambiente: Node.js v24 (LTS) installato

Da questo ciclo, Node.js è disponibile sul PC (assente nei cicli precedenti — vedi `CONTESTO.md` §1 e backlog Strumenti). Questo cambia concretamente il tipo di verifica possibile:
- **Prima** (cicli 13/07–17/07 Ciclo A): unico controllo sintattico disponibile era il conteggio di bilanciamento `{}`/`()`/`[]` prima/dopo la modifica — non un vero parser, non in grado di rilevare errori sintattici che non alterano il bilanciamento (es. virgole mancanti, operatori malformati).
- **Da questo ciclo**: `node --check` su ciascun blocco `<script>` estratto da `index.html` — un parser JavaScript reale, in grado di rilevare qualunque errore di sintassi. Inoltre, per la prima volta, è stato possibile estrarre le funzioni pure toccate in questo ciclo (`parseHM`, `fmtHM`, `tempoBustoOperatore`, `decidiOnlineDaCasa`) **direttamente dal file reale** (non da una copia ritrascritta) ed eseguirle in Node con casi di test concreti — un livello di verifica comportamentale mai stato possibile nei cicli precedenti, che si fermavano alla lettura statica.
- Registrato come prassi permanente in `CLAUDE.md` (sezione "Running / testing changes") e come voce di backlog Strumenti completata in `CONTESTO.md`.

## S6 — Monte ore e ore per Metodo in formato h:mm

**Cosa è stato fatto**:
- Nuove funzioni condivise `parseHM(str)` (stringa → minuti interi, o `null` se vuota/non valida) e `fmtHM(min)` (minuti → stringa `H:MM`). `parseHM` riconosce `:`, `.` e `,` come separatore ore:minuti sessantesimi (mai come decimale: `1.30`/`1,30` → 90 minuti, non 1,3 ore); un numero senza separatore è interpretato come minuti secchi (`90` → 90 minuti), come richiesto.
- `oreErog(pid)` ora restituisce **minuti** (prima ore decimali): rimossa la sola divisione `/60` nel reduce, nessun'altra modifica alla logica di filtro (eseguita+assenza ingiustificata, esclude annullata).
- **Editor progetto**: campo "Monte ore totale" (`#pe-ore`) da `type="number"` a `type="text"`, mostra/accetta h:mm; al salvataggio `monteOre:parseHM(...)`. Campo "Ore totali" per ogni Metodo assegnato (`.met-ore`) stesso trattamento. `updateMonteOre()` (somma dei Metodi, mostrata sopra e autocompilata nel campo Monte ore quando ci sono Metodi assegnati) ora somma minuti e mostra/scrive h:mm.
- **Lista progetti** (`renderProgetti`): colonna "Monte ore" mostra ora `fmtHM(oreErog)/fmtHM(monteOre)` invece di `X.Y h/Z h`.
- **`calcStraordinari`** (funzione orfana, non collegata a UI — CLAUDE.md backlog voce 8): convertita a calcolo interamente in minuti (`totMin`/`previsteMin`/`extraMin`), con `totOre`/`previste`/`extra` ora stringhe h:mm invece di ore decimali arrotondate. Nessun punto del codice la invoca (verificato via grep, nessun consumer da aggiornare).
- **Migrazione one-time** in `loadAll()`: per ogni progetto non ancora marcato (`!p.oreInMinuti`), converte `monteOre` e ciascun `metodi[].oreTotali` da ore decimali a minuti (`Math.round(parseFloat(v)*60)`), poi imposta `p.oreInMinuti=true` su **tutti** i progetti (marcatore di idempotenza, stesso ruolo di `hasOwnProperty('cognome')` nella migrazione nome/cognome). Il salvataggio da editor imposta `oreInMinuti:true` su ogni progetto creato/modificato da questo ciclo in poi, così un progetto nuovo non verrà mai ririconvertito da una `loadAll()` futura.

### Nota di attenzione (non una correzione, un rischio d'uso da segnalare)
La regola "numero senza separatore = minuti secchi" è quella esplicitamente richiesta, ma ha una conseguenza pratica: chi digita oggi "40" nel campo Monte ore pensando a 40 ore (comportamento pre-Ciclo-B) otterrebbe ora 40 **minuti**. Il rischio è mitigato dove il valore nasce automaticamente dalla somma dei Metodi (sempre in h:mm), ma resta per l'inserimento manuale diretto nel campo Monte ore quando non si usano i Metodi. Non ho corretto questo comportamento perché è esattamente quanto specificato nel prompt ("accetta anche '90' come minuti secchi") — segnalo qui il rischio, non lo risolvo in autonomia.

| Parte | Stato |
|---|---|
| Parsing/formattazione h:mm condivisi (`parseHM`/`fmtHM`) | ✅ Fatto — testato con casi concreti estratti dal codice reale (vedi Passata 2 sotto) |
| Salvataggio interno in minuti (monte ore progetto + ore Metodo) | ✅ Fatto |
| Visualizzazione h:mm (editor, lista progetti, totali Metodi) | ✅ Fatto |
| `oreErog`/calcoli monte ore (consumo, confronto con target generazione) | ✅ Fatto — `target=scopeProjects.filter(p=>!p.monteOre||oreErog(p.id)<p.monteOre)` invariato nella forma, coerente perché entrambi i lati sono ora minuti |
| `calcStraordinari` (straordinari) | ✅ Fatto, convertito ai minuti (funzione orfana, nessun consumer da rompere) |
| Migrazione one-time (monte ore + ore Metodo) | ✅ Fatto, stesso pattern (marcatore di idempotenza) delle migrazioni precedenti — non eseguibile dal vivo in questo ambiente (nessun login M365 disponibile), da confermare da Simone dopo il deploy |

## S8 — Tempi di viaggio Busto Arsizio sdoppiati per operatore

**Cosa è stato fatto**:
- Editor operatore: campo unico "Tempo Busto Arsizio (min)" sostituito da due campi — "Tempo Busto da Cesate (min)" (`tempoBustoCesate`, può restare vuoto) e "Tempo Busto da casa (min)" (`tempoBustoCasa`). Il toggle di visibilità legato alla sede "Busto Arsizio" tra le sedi abilitate dell'operatore resta identico nel comportamento (corretto anche un dettaglio di CSS: il contenitore dei due campi ora usa un `display:flex` esplicito invece di ereditare `display:none` dalla stessa stringa di stile, per evitare un conflitto tra due dichiarazioni `display` nello stesso attributo `style` che avrebbe reso i campi sempre visibili anche a operatore non abilitato a Busto Arsizio — bug individuato e corretto durante l'implementazione, prima del commit).
- **Nuova funzione condivisa `tempoBustoOperatore(op, giaACesate)`**: se `giaACesate` è vero e `tempoBustoCesate` non è `null`, restituisce quel valore; altrimenti restituisce `tempoBustoCasa||0` e segnala `fallback:true` solo se `giaACesate` era vero (cioè: si voleva il valore "da Cesate" ma non è ancora compilato).
- **`decidiOnlineDaCasa`** (Passata 2): per ogni sessione online in valutazione, `giaACesate` è vero se, tra le presenze della stessa giornata dell'operatore, ce n'è almeno una a Cesate. Se l'ancora (prima/ultima presenza della giornata) è a Busto Arsizio, il margine di viaggio usa `tempoBustoOperatore(op, giaACesate)` invece del vecchio `op.tempoBusto` unico. Se l'ancora è a Cesate, invariato (`op.tempoCasa`).
- **`generateMonth`, Passata 1** (vincolo di gap per cambi di sede nello stesso giorno): stessa logica — se l'operatore ha (o sta per avere) una sessione a Busto Arsizio quel giorno, il tempo di viaggio richiesto usa `tempoBustoOperatore(op, giaACesate)` dove `giaACesate` verifica se l'operatore ha già una sessione a Cesate quel giorno tra quelle piazzate finora in questo run + quelle conservate.
- **Segnalazione del ripiego**: quando manca `tempoBustoCesate` e serve, viene aggiunta una voce in `anom` (una sola volta per operatore, sia nel percorso algoritmico sia — tramite `risolviOnlineDaCasa(ms,newS,keep,anom)`, ora con un quarto parametro opzionale — nel percorso IA), visibile nell'esito di generazione subito dopo il run (stesso meccanismo già usato per altri avvisi, es. sforamento ore settimanali Assunti).
- **Migrazione one-time** in `loadAll()`: per ogni operatore con `tempoBusto` (vecchio campo) e senza ancora `tempoBustoCasa` (marcatore di idempotenza, stesso pattern della migrazione nome/cognome — `hasOwnProperty`), imposta `tempoBustoCasa=tempoBusto`, `tempoBustoCesate=null`, e rimuove il vecchio campo `tempoBusto`. Il salvataggio da editor operatore rimuove esplicitamente `tempoBusto` da ogni record salvato (`delete rec.tempoBusto`), così anche un operatore già in memoria con residuo del vecchio campo (per qualunque motivo) non lo riporta mai su SharePoint dopo un salvataggio.

### Decisione interpretativa non esplicitata dalla richiesta (dichiarata, come richiesto per le scelte implementative non specificate)
Il prompt descrive la regola come "usa il valore coerente con la posizione reale dell'operatore... da Cesate se è già in sede a Cesate, da casa altrimenti", senza specificare **come** il codice deve determinare se l'operatore è "già in sede a Cesate" in un dato istante — il codice attuale (sia in `decidiOnlineDaCasa` sia nella Passata 1) ragiona per confini di giornata (prima presenza/ultima presenza), non per un tracciamento posizione-per-istante. Ho scelto: **"già in sede a Cesate" = l'operatore ha almeno un'altra sessione a Cesate quella stessa giornata** (oltre a quella/e a Busto Arsizio). Motivazione: è l'unico segnale già disponibile nel codice esistente senza una ristrutturazione più ampia (che non è stata richiesta), rappresenta fedelmente il caso reale per cui questa specifica è nata — un operatore che nello stesso giorno lavora sia a Cesate sia a Busto Arsizio usa il tempo di trasferimento Cesate↔Busto, non quello casa↔Busto — e riusa lo stesso genere di segnale (presenze della giornata) già usato da `decidiOnlineDaCasa` per la decisione online-da-casa/in-sede. Scartata l'ipotesi di un tracciamento posizione-per-istante più fine (richiederebbe ricostruire la sequenza cronologica completa della giornata anche nella Passata 1, non solo in Passata 2): sproporzionato per il beneficio, dato che il caso "operatore su entrambe le sedi lo stesso giorno" è già interamente catturato dal segnale scelto. **Non risolta con una domanda a Simone in sessione** (il prompt non lasciava previsto uno scambio di domande per questo ciclo) — segnalata qui per eventuale revisione.

| Parte | Stato |
|---|---|
| Due campi in editor operatore (`tempoBustoCesate`/`tempoBustoCasa`) | ✅ Fatto |
| Passata 2 (`decidiOnlineDaCasa`) posizione-aware | ✅ Fatto — interpretazione dichiarata sopra |
| Passata 1 (`generateMonth`, vincolo di gap) posizione-aware | ✅ Fatto — stessa interpretazione |
| Ripiego prudente + segnalazione quando manca "da Cesate" | ✅ Fatto (`anom`, un avviso per operatore, entrambi i percorsi di generazione) |
| Migrazione one-time (valore attuale → "da casa", "da Cesate" vuoto) | ✅ Fatto — non eseguibile dal vivo in questo ambiente, da confermare da Simone dopo il deploy |
| Bug di visibilità CSS individuato e corretto durante l'implementazione | ✅ Corretto (vedi sopra) |

## Metodo di verifica: multi-passata

1. **Passata 1 — lettura del codice, punto per punto delle due specifiche**: rilette entrambe le implementazioni (S6, S8) contro il testo esatto del prompt, una voce per volta (formato input, salvataggio in minuti, visualizzazione h:mm, migrazione per S6; due campi, logica posizione-aware, ripiego+segnalazione, migrazione per S8). Nessun elemento richiesto risulta mancante.
2. **Passata 2 — controllo sintattico reale con Node (novità di questo ciclo)**: `node --check` sui 3 blocchi `<script>` estratti da `index.html` (183, 1162, 185.934 caratteri) — **tutti OK**, nessun errore di sintassi. Inoltre, estratte le funzioni pure toccate (`parseHM`, `fmtHM`, `tempoBustoOperatore`, `decidiOnlineDaCasa`) **direttamente dal file reale** (non ritrascritte) ed eseguiti 19 casi di test in Node con `tmin`/`pad2`/`AULE_CESATE`/`AULE_BUSTO` reali: parsing/formattazione h:mm (incl. `1:30`/`1.30`/`1,30`→90, `90`→90, vuoto→`null`), `tempoBustoOperatore` nei 4 casi (senza Cesate, con Cesate e valore presente, con Cesate e valore mancante con fallback, valore `0` legittimo senza falso-fallback), `decidiOnlineDaCasa` nei 4 scenari (solo Busto→usa "da casa", margine sufficiente→da casa, presenza anche a Cesate→usa "da Cesate", "da Cesate" mancante→ripiega su "da casa" e segnala) — **tutti i 19 test passano**. Individuato e corretto in questa stessa passata il bug di visibilità CSS descritto sopra (rilevato leggendo con attenzione la concatenazione della stringa di stile, non dal test automatico).
3. **Passata 3 — nessun calcolo rimasto in ore decimali**: grep di `toFixed`/`parseFloat` sull'intero file — le uniche due occorrenze di `parseFloat` sono nella migrazione S6 stessa (conversione una tantum, intenzionale); nessuna occorrenza residua di `toFixed`. Grep di `oreErog(` — 4 occorrenze (definizione + lista progetti + i due `target=scopeProjects.filter(...)` di `generateMonth`/`generateMonthAI`), tutte coerenti con minuti su entrambi i lati del confronto. Grep di `.tempoBusto\b` (vecchio campo singolo) — solo 2 occorrenze residue, entrambe intenzionali (la riga di migrazione che legge il vecchio valore, e la `delete rec.tempoBusto` difensiva nel salvataggio).
4. **Passata 4 — migrazioni coerenti col pattern esistente**: confrontate le due nuove migrazioni (S6, S8) con le migrazioni preesistenti (nome→nome+cognome, sedi composite Ciclo A): stessa struttura `try/catch` con log di skip, stesso stile di marcatore di idempotenza (`hasOwnProperty`/flag dedicato invece di riconvertire ad ogni load), stesso salvataggio in blocco (`for(...)await saveRecord(...)`) solo se `migrated*` è vero, stesso posizionamento in `loadAll()` dopo le migrazioni esistenti (ordine: nome/cognome → sedi composite Ciclo A → monte ore/Metodo S6 → tempo Busto S8). Nessuna discrepanza di stile trovata.
5. **Passata 5 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (sottosezione S6/S8, ora marcate ✅ Implementato) e questo file descrivono la stessa implementazione con gli stessi nomi di campo (`tempoBustoCesate`/`tempoBustoCasa`, `oreInMinuti`, `parseHM`/`fmtHM`/`tempoBustoOperatore`); nessuna discrepanza fra le sezioni "Modifiche dal campo" di `CLAUDE.md` e questa voce di `VERIFICA.md`. Verificato che la nota di rischio sul parsing "numero secco = minuti" (S6) non contraddica la specifica (è la specifica stessa), quindi non richiede una modifica al codice, solo la segnalazione fatta sopra.
6. **Passata 6 — rilettura finale integrale** del diff completo di `index.html` (`git diff`) riga per riga: ogni modifica è o (a) una delle funzioni condivise nuove, (b) una sostituzione mirata in un punto già identificato nelle passate precedenti, o (c) uno dei due blocchi di migrazione — nessuna riga toccata fuori da queste zone, nessun'altra incongruenza trovata → passata "vuota", ciclo chiuso a 6 passate (minimo richiesto: 4).

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt di questo ciclo conteneva già: la conferma del test dal vivo del Ciclo A da registrare, la novità Node.js con le due modifiche documentali richieste (CLAUDE.md, CONTESTO.md), e le specifiche tecniche complete di S6 e S8.

*Domande poste a Simone e risposte ricevute:* nessuna — l'unico punto ambiguo (come determinare "già in sede a Cesate" per S8) non è stato chiesto in sessione ma risolto con una scelta implementativa dichiarata ed esplicitamente segnalata sopra, secondo la prassi già seguita per scelte analoghe nei cicli precedenti (es. l'interpretazione di `annullata` come vincolo non attivo, ciclo "Ristrutturazione a due passate").

*Decisioni prese di conseguenza:*
- Interpretazione di "posizione reale... già in sede a Cesate" per S8 come "presenza a Cesate nella stessa giornata" (vedi sezione dedicata sopra) — non confermata da Simone, segnalata per eventuale revisione.
- Bug di visibilità CSS nel wrapper dei due campi Tempo Busto individuato e corretto senza attendere conferma (rientra nell'implementazione richiesta, non una richiesta a sé).
- Nota di rischio sul parsing "numero secco = minuti" per il campo Monte ore: segnalata, non risolta in autonomia (il comportamento è quello esplicitamente specificato).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 0a | Chiusura test dal vivo Ciclo A | ✅ Registrato | Vedi sezione dedicata sopra |
| 0b | Novità Node.js: prassi in CLAUDE.md | ✅ Fatto | "Running / testing changes" |
| 0b | Novità Node.js: chiusura backlog Strumenti in CONTESTO.md | ✅ Fatto | Vedi `CONTESTO.md` |
| S6 | Formato h:mm, salvataggio minuti, visualizzazione h:mm, migrazione | ✅ Fatto | Nota di rischio segnalata (non un difetto, comportamento specificato) |
| S8 | Due campi, Passata 2 posizione-aware, migrazione, editor operatore | ✅ Fatto | Interpretazione "già a Cesate" dichiarata; estesa anche alla Passata 1 (stesso segnale) |
| Verifica | Multi-passata (min. 4, incl. `node --check`, no calcoli decimali residui, migrazioni coerenti, Passata 2 corretta nei due scenari) | ✅ Fatto | 6 passate, incl. 19 test funzionali eseguiti su codice reale estratto |

**Cosa manca**: nessuna lacuna sui punti richiesti. Resta da confermare dal vivo (dopo il deploy, come per il Ciclo A) l'esecuzione delle due nuove migrazioni sui dati di test — non eseguibile in questo ambiente (nessun login M365 disponibile).

## Limiti di questa verifica
Per la prima volta disponibile un controllo sintattico reale (`node --check`) e un'esecuzione funzionale delle funzioni pure toccate, entrambi su codice estratto direttamente dal file reale — un salto di qualità rispetto ai cicli precedenti (solo lettura statica + bilanciamento parentesi). Resta non eseguibile in questo ambiente: il login Microsoft 365/SharePoint (le due migrazioni non sono state osservate scrivere davvero sui dati di test), e qualunque interazione DOM/browser reale (il test dei due campi Tempo Busto nell'editor operatore, il toggle di visibilità, il campo Monte ore in h:mm nell'editor progetto sono stati verificati leggendo il markup generato, non cliccando in un browser). Si raccomanda a Simone lo stesso test dal vivo già fatto per il Ciclo A: aprire un progetto/operatore di test dopo il deploy e verificare i log di migrazione in console, i nuovi campi visibili e corretti, e una generazione di prova su un caso con operatore su entrambe le sedi lo stesso giorno.

---

# Verifica — Ciclo B.1: rifinitura input h:mm (fix su S6)

Data: 2026-07-17. Emerso dal collaudo dal vivo di Simone sul Ciclo B appena deployato: nessuna novità funzionale, solo correzione del parsing/validazione dei campi h:mm (monte ore progetto, ore per Metodo).

## Cosa è stato fatto

- **`parseHM`**: la regex passa da `^(\d+)[:.,](\d{1,2})$` (entrambi i lati obbligatori, minuti fino a 2 cifre senza limite di valore) a `^(\d*)[:.,](\d*)$` (ciascun lato può mancare). Se un lato manca viene trattato come `0`: `"30:"` → ore=30, minuti=0 → 1800; `":30"` → ore=0, minuti=30 → 30. Se **entrambi** i lati mancano (input = solo il separatore, es. `":"`) l'input è rifiutato. Se i minuti sono presenti ma **fuori dall'intervallo 00-59** (es. `"30:70"`), l'input è rifiutato — prima venivano accettati e usati così com'erano (`parseInt('70',10)=70`), producendo un valore in minuti "sporco" (30*60+70=1870, cioè 31:10, un totale silenziosamente sbagliato rispetto a quanto scritto in campo).
- **Distinzione campo vuoto vs input non valido**: `parseHM` ora restituisce **`null`** per un campo vuoto (nessun valore, comportamento invariato — es. monte ore non impostato) e **`NaN`** per un input scritto ma non valido (nuovo). I due casi erano indistinguibili prima (non serviva, perché prima ogni stringa non vuota che superava la regex o il parse a numero secco produceva comunque un risultato "accettabile"); ora il chiamante controlla `Number.isNaN(...)` per decidere se rifiutare.
- **UI — editor progetto**: campo "Monte ore totale" (`#pe-ore`) e ciascun campo "Ore totali" per Metodo (`.met-ore`) hanno un listener `input` (non più solo `change`, per un riscontro immediato mentre si digita) che: calcola `parseHM(valore)`; se `NaN` aggiunge la classe CSS `hm-invalid` (nuova regola: bordo e sfondo rossi, riusa le variabili `--danger`/`--danger-soft` già presenti nel foglio stile) e **non** scrive il valore nel modello (`pMetodi`) né aggiorna il totale — il valore starato resta quindi "in sospeso" solo a schermo, mai nei dati; se valido, rimuove la classe e procede come prima.
- **Blocco al salvataggio**: il click su "Salva" del progetto ora controlla anche `Number.isNaN(parseHM($('#pe-ore').value))` e ciascun `.met-ore` prima di procedere; se uno qualunque è fuori regola, il salvataggio si ferma con un avviso ("Correggi i campi ore evidenziati in rosso...") nello stesso banner già usato per "Nome e utente obbligatori" — non basta quindi lasciare il campo rosso e uscire dal focus: il progetto non si salva finché il valore non è corretto o svuotato.

| Parte | Stato |
|---|---|
| `parseHM`: lato mancante = 0 (`30:`→30:00, `:30`→0:30) | ✅ Fatto |
| `parseHM`: minuti 00-59, fuori range rifiutato (mai normalizzato in silenzio) | ✅ Fatto — restituisce `NaN`, distinto da `null` (campo vuoto) |
| UI: bordo rosso in tempo reale, totale non aggiornato finché non corretto | ✅ Fatto (`.hm-invalid`, listener `input` su `#pe-ore` e `.met-ore`) |
| Blocco del salvataggio progetto se un campo ore resta fuori regola | ✅ Fatto (stesso banner di avviso esistente) |

## Metodo di verifica: multi-passata

1. **Passata 1 — i 3 casi del prompt, uno per uno**: `"30:"` (minuti assenti) → verificato a mano sulla nuova regex: gruppo minuti vuoto → trattato come `0` → 1800 corretto. `":30"` (ore assenti) → gruppo ore vuoto → trattato come `0` → 30 corretto. `"30:70"` → gruppo minuti `"70"` → `70>59` → `NaN`, e verificato che il percorso UI (listener `input` + blocco al salvataggio) impedisca sia l'aggiornamento del totale sia il salvataggio con quel valore.
2. **Passata 2 — `node --check` + test funzionale esteso**: `node --check` sui 3 blocchi `<script>` di `index.html` — **tutti OK**. Estratta la nuova versione di `parseHM` direttamente dal file reale ed eseguiti gli 11 casi di parsing/formattazione (i 6 già coperti nel Ciclo B + i 5 nuovi di questo ciclo: `"30:"`→1800, `":30"`→30, `"30:00"`→1800, `"30:70"`→`NaN`, `":"`→`NaN`) più i 13 casi già coperti su `tempoBustoOperatore`/`decidiOnlineDaCasa` (invariati, non toccati in questo ciclo) — **tutti i 24 test passano**. Nota tecnica sul test stesso: `JSON.stringify(NaN)` restituisce `"null"`, quindi il confronto usato per gli altri casi (`JSON.stringify` di atteso vs ottenuto) avrebbe fatto passare un `NaN` scambiandolo per `null` — aggiunta una funzione di controllo dedicata (`checkNaN`, verifica esplicita `Number.isNaN`) per i 2 casi che si aspettano un rifiuto, cosa verificata rileggendo il codice del test stesso prima di fidarsi del risultato "tutto ok".
3. **Passata 3 — nessuna regressione sui casi già validati nel Ciclo B**: rieseguiti i 6 casi di parsing precedenti (`1:30`, `1.30`, `1,30`, `90`, vuoto, null) — tutti invariati. Riletta la sezione "Nota di attenzione" del Ciclo B (numero secco = minuti, non toccata da questa rifinitura): confermato che resta valida e non in conflitto con la nuova regola (il ramo "numero secco" non passa mai dalla nuova regex con separatore, quindi il vincolo 00-59 non lo riguarda).
4. **Passata 4 — percorso UI end-to-end letto sul codice**: seguito a mano il percorso di un input `"30:70"` in `.met-ore`: listener `input` → `parseHM` restituisce `NaN` → classe `hm-invalid` aggiunta, `pMetodi`/`updateMonteOre()` **non** chiamati (il valore precedente resta nel modello) → click su Salva → guardia rilegge lo stesso input da `$$('.met-ore')`, lo trova ancora `NaN` → salvataggio bloccato con banner, nessuna scrittura su SharePoint. Stesso percorso verificato per `#pe-ore`. Verificato che un campo lasciato vuoto (cancellato del tutto) non attivi il blocco (`parseHM('')` → `null`, non `NaN` → considerato valido, come un monte ore non impostato).
5. **Passata 5 — coerenza fra le fonti**: aggiornata la nota S6 in `CLAUDE.md` ("Input validato 00-59") con lo stesso comportamento descritto qui; nessuna voce di `CONTESTO.md` (Cronologia, Backlog, Registro delle decisioni) cita dettagli di parsing h:mm da disallineare — solo la Cronologia riceve la nuova voce di questo ciclo.
6. **Passata 6 — rilettura finale del diff** (`git diff index.html`): le uniche zone toccate sono `parseHM` (regex + gestione lati mancanti/fuori range), la nuova regola CSS `.hm-invalid`, i due listener `input` (`#pe-ore`, `.met-ore`) e la nuova guardia nel click di `#pe-save` — nessuna riga toccata fuori da queste zone, nessun'altra incongruenza trovata → passata "vuota", ciclo chiuso a 6 passate (minimo richiesto: 4).

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt conteneva già i 3 punti tecnici completi (lati mancanti = 00, validazione 00-59 con segnalazione visiva, casi di test da aggiungere), lasciando a me la scelta del meccanismo di segnalazione ("scegli tu il meccanismo").

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- Meccanismo di segnalazione scelto: classe CSS `hm-invalid` (bordo/sfondo rossi, riusa `--danger`/`--danger-soft` già esistenti) applicata in tempo reale sull'evento `input`, **più** un blocco esplicito al salvataggio (non richiesto testualmente ma implicito in "il valore fuori regola non deve mai finire nei dati": senza il blocco al salvataggio, un campo lasciato rosso e un click diretto su Salva avrebbe comunque salvato il valore precedente al modello in silenzio, senza dare a Simone modo di accorgersene se non guardava lo schermo in quel momento).
- Introdotta la distinzione `null` (campo vuoto, valido) vs `NaN` (input scritto ma fuori regola) nel valore di ritorno di `parseHM`, non richiesta esplicitamente ma necessaria per poter distinguere "nessun valore" da "valore da rifiutare" nei punti che chiamano la funzione.
- Il ramo "numero secco = minuti" (S6) non è stato toccato: il vincolo 00-59 si applica solo quando è presente un separatore (`:`/`.`/`,`), perché in quel caso i "minuti" sono un componente ore:minuti, mentre un numero secco rappresenta minuti totali senza struttura ore:minuti da validare.

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | `"30:"`→30:00, `":30"`→0:30 | ✅ Fatto | Lato mancante trattato come `0` nella nuova regex |
| 2 | Minuti solo 00-59, fuori range rifiutato (mai normalizzato in silenzio), segnalazione visiva | ✅ Fatto | `NaN` + classe `hm-invalid` + blocco al salvataggio (non solo segnalazione passiva) |
| 3 | Casi di test aggiunti (`"30:"`, `":30"`, `"30:70"`, `"30:00"` + casi già coperti) | ✅ Fatto | 5 nuovi casi, 24 test totali, tutti passano |
| Verifica | Multi-passata (min. 4, incl. `node --check` e test funzionale esteso) | ✅ Fatto | 6 passate |

**Cosa manca**: nessuna lacuna sui punti richiesti. Come per i cicli precedenti, il test dal vivo nell'editor (digitare `"30:70"` in un campo reale e vedere il bordo rosso comparire, provare a salvare e vedere il blocco) non è stato eseguibile in questo ambiente — raccomandato a Simone dopo il deploy.

## Limiti di questa verifica
Analisi statica + `node --check` + esecuzione in Node delle funzioni pure toccate (stesso livello di verifica introdotto nel Ciclo B); il comportamento visivo (bordo rosso, banner di blocco) è stato verificato leggendo il codice generato (markup, classi, listener), non osservato in un browser reale. Si raccomanda a Simone di riprovare dal vivo dopo il deploy proprio i casi che avevano fatto emergere il problema.

---

# Verifica — Ciclo C: strumento di collaudo stabile, rifiniture B.1, S5 + S7

Data: 2026-07-17.

## `check-sintassi.js` — strumento di collaudo ufficiale

**Cosa è stato fatto**: creato `check-sintassi.js` nella radice del repo, sostituendo gli script temporanei riscritti nello scratchpad a ogni ciclo (B, B.1). Un solo comando, `node check-sintassi.js`, esegue in sequenza:
1. `node --check` su ogni blocco `<script>` estratto da `index.html` (scritto in una cartella temporanea di sistema via `fs.mkdtempSync`, ripulita a fine esecuzione).
2. Estrazione **diretta dal file reale** (non da una copia ritrascritta) delle funzioni pure toccate nei cicli di lavoro — liste `EXTRACT_FUNZIONI`/`EXTRACT_COSTANTI` in testa al file, oggi: `tmin`, `parseHM`, `fmtHM`, `tempoBustoOperatore`, `decidiOnlineDaCasa`, `bucketSettimana`, `maxNuoveSettimana`, `sediAmmesseProgetto` (funzioni) + `pad2`, `AULE_CESATE`, `AULE_BUSTO` (costanti di supporto).
3. Una batteria di 40 test funzionali su queste funzioni (tutti i casi già coperti nei cicli B/B.1 più i nuovi di questo ciclo, vedi sotto), con un'uscita di processo non-zero se qualcosa fallisce (utilizzabile anche in automatismi futuri, es. hook pre-commit, se mai introdotto).

Registrato come strumento ufficiale in `CLAUDE.md` (sezione "Running / testing changes"), con l'istruzione di estendere le liste di estrazione e la sezione test a ogni ciclo futuro che tocchi altre funzioni pure, invece di riscrivere script a parte.

| Parte | Stato |
|---|---|
| Script unico `node check-sintassi.js` (sintassi + test funzionali) | ✅ Fatto |
| Estrazione dal file reale (non da copie ritrascritte) | ✅ Fatto, stesso principio dei cicli B/B.1 |
| Registrato in `CLAUDE.md` come strumento ufficiale | ✅ Fatto |

## Rifinitura 1 (dal collaudo B.1): `parseHM("abc")` → NaN, non null

**Cosa è stato fatto**: nel ramo "numero secco" (nessun separatore `:`/`.`/`,`) di `parseHM`, `isNaN(n)?null:n` → `isNaN(n)?NaN:n`. Un input non vuoto ma non numerico (es. `"abc"`) è ora un input **rifiutato** (bordo rosso, non conteggiato), mai confuso con un campo vuoto (che resta `null`, valido, significa "nessun valore"). Caso aggiunto al test.

## Rifinitura 2 (dal collaudo dal vivo di Simone, caso `30:70`): somma live esclude i campi non validi

**Causa del bug segnalato**: nel Ciclo B.1, il listener `input` di `.met-ore` **non richiamava affatto `updateMonteOre()`** quando il campo era invalido (`if(!invalid){...;updateMonteOre();}`) — il totale mostrato restava quindi fermo sull'**ultimo stato transitorio valido** prima dell'input invalido finale. Esempio concreto (quello di Simone): un Metodo già a `30:00` (1800 min) + un secondo Metodo che l'utente sta digitando verso `30:70` — durante la digitazione, allo stato intermedio `"30:7"` (valido: 30·60+7=1807 min), il totale si aggiornava correttamente a `60:07` (1800+1807); ma appena si completa `"30:70"` (non valido, minuti 70>59), il listener smetteva di richiamare `updateMonteOre()` **lasciando lo schermo fermo su quel `60:07`** invece di tornare a `30:00` (il solo contributo valido rimasto).
**Correzione**: (a) il listener chiama **sempre** `updateMonteOre()`, anche quando il campo corrente è invalido (scrive nel modello `pMetodi` solo se valido, ma ricalcola comunque il totale mostrato); (b) `updateMonteOre()` non somma più `pMetodi` (il modello, che può essere disallineato dal campo appena digitato) ma legge **dal vivo** ogni input `.met-ore` presente nel DOM tramite `parseHM`, trattando ogni risultato `NaN` come contributo `0`. Un campo invalido non fa quindi mai comparire un valore transitorio nel totale, né lo blocca su uno stato precedente: contribuisce sempre e solo `0` finché non è corretto.
**Verifica che valga ovunque ci sia una somma live di campi h:mm**: cercata ogni occorrenza di somma (`reduce`) su campi `.met-ore`/h:mm nel file — l'unica trovata è `updateMonteOre()` (Monte ore totale dei Metodi). Nessun'altra somma live di questo tipo esiste nel codice.

| Parte | Stato |
|---|---|
| `parseHM("abc")` → NaN (rifinitura 1) | ✅ Fatto, testato |
| Somma live "Monte ore totale" esclude campi NaN (rifinitura 2) | ✅ Fatto, testato con caso `30:00 + [invalido→0] + 10:00 = 40:00` |
| Verificate altre somme live di campi h:mm nel codice | ✅ Verificato: nessun'altra esiste |

## S5 — Disponibilità limitate alle sedi del progetto

**Cosa è stato fatto**: nuova funzione condivisa `sediAmmesseProgetto(sede)` (sede singola → solo quel tag; composite → Cesate + il remoto; sede assente/sconosciuta → `null`, nessuna restrizione) e costante `AVAIL_SEDI_TAGS` (estratta dai tre punti che la duplicavano). Applicata in **tre** editor di disponibilità del progetto (tutti e tre quelli esistenti, non solo quello principale):
1. **Fasce settimanali ricorrenti** (`renderAvailEditor`, `pe-av`) — nuovo 4° parametro `sediAmmesse`.
2. **Eccezioni giornaliere "Disponibile"** (`renderFasce`, dentro `renderMonthlyAvail`) — nuovo 5° parametro `sediAmmesseIniziali`.
3. **"Applica a più giorni"** (`renderFasceB`, `openBulkApply`, che vive nello stesso scope di `renderMonthlyAvail` e quindi eredita la stessa variabile) — stesso meccanismo.

In tutti e tre, i tag proposti = sedi ammesse **∪** sedi già selezionate su quello specifico slot: un tag fuori dalle sedi ammesse ma già spuntato su un dato esistente **non sparisce mai** — resta visibile, spuntato, e marcato con la classe CSS `sede-extra` (bordo tratteggiato rosso + tooltip) invece di essere rimosso in silenzio.

**Cambio Sede a metà modifica**: `#pe-sede` ha un nuovo listener `change` che (a) legge lo stato attuale (`readAvailEditor('pe-av')`, cattura anche modifiche non ancora salvate), (b) calcola le nuove sedi ammesse, (c) se qualche fascia esistente ha una sede non più ammessa mostra un banner esplicito con i giorni coinvolti (mai una cancellazione silenziosa), (d) ri-renderizza `pe-av` con **gli stessi dati** (nessuna perdita) e le nuove sedi ammesse, e (e) aggiorna anche l'editor delle eccezioni giornaliere/bulk tramite un nuovo metodo esposto `wrap._setSediAmmesse()` (la variabile `sediAmmesse` è catturata per riferimento dalle chiusure già agganciate ai click sui giorni, quindi si aggiorna senza dover ri-renderizzare tutto il calendario mensile).

| Parte | Stato |
|---|---|
| Fasce settimanali limitate alla Sede del progetto | ✅ Fatto |
| Eccezioni giornaliere "Disponibile" limitate | ✅ Fatto |
| "Applica a più giorni" limitato | ✅ Fatto |
| Cambio Sede: segnalazione esplicita, nessuna cancellazione silenziosa | ✅ Fatto (banner + classe `sede-extra`, dato mai perso) |
| Operatori (editor disponibilità) invariati (nessuna restrizione) | ✅ Verificato — `sediAmmesse` omesso per gli operatori, comportamento identico a prima |

## S7 — Vincolo duro sulla frequenza settimanale

**Cosa è stato fatto**:
- Nuove funzioni condivise `bucketSettimana(giorno)` (identifica la finestra di 7 giorni dal 1° del mese a cui appartiene una data — lo stesso schema già usato da `riepiloghi`/Passata 1/3 e da `riepilogoSettimanaleDaSessioni`, non settimane ISO lun-dom) e `maxNuoveSettimana(frequenza, giaEsistenti)` (quante sessioni nuove restano ammissibili in una finestra, mai negativo).
- **Passata 1** (`generateMonth`): prima si contavano solo le sessioni **nuove** piazzate questo run contro `frequenza`, ignorando le sessioni **esistenti** (kept: confermate/eseguite/proposte fuori ambito) dello stesso progetto già presenti in quella finestra — un progetto con 2 confermate manuali e frequenza 2 poteva quindi ricevere fino a 2 nuove proposte in più dalla stessa settimana, arrivando a un totale di 4. Corretto: a inizio di ogni finestra si calcola `giaEsistenti` (dalle sessioni già in `prB[p.id]`, popolato prima della Passata 1 con le sessioni conservate) e si piazzano al massimo `maxNuoveSettimana(frequenza, giaEsistenti)` sessioni nuove, mai `frequenza` da sola.
- **Riepiloghi/report**: `piazzate` in ogni riepilogo settimanale è ora il **totale** (esistenti + nuove), non solo le nuove — coerente con quanto già faceva `riepilogoSettimanaleDaSessioni` (usata dal percorso IA), che calcolava il totale a posteriori dall'insieme newS+keep e non aveva bisogno di correzioni.
- **Passata 3**: **nessuna modifica di codice necessaria** — eredita automaticamente il vincolo, perché `missing = richieste - piazzate` ora usa il `piazzate` corretto (il vero totale); la Passata 3 non piazza mai più di `missing` sessioni per costruzione, quindi non può mai superare `frequenza`. Verificato inoltre che lo scambio "sposta il blocco altrove" (`trovaAlternativaBlocker`) cerchi un'alternativa **solo nella stessa finestra di 7 giorni** del progetto bloccante e **rilocalizzi** (non duplichi) la sua sessione — non altera mai il conteggio settimanale di quel progetto, quindi non introduce un rischio di violazione indiretta della sua frequenza.
- **Percorso IA** (`generateMonthAI`): nuovo conteggio `settimanaConteggi` (chiave progetto+finestra), seminato dalle sessioni esistenti (`vincoli`) prima della validazione; ogni sessione proposta dall'IA che porterebbe il conteggio della sua finestra a superare la frequenza del progetto è **scartata** (stesso meccanismo di rigetto già usato per sede non ammessa/conflitti operatore/aula), con voce dedicata in `anom` ("Frequenza settimanale superata").
- **Report — nuovo avviso strutturale** (`avvisiFrequenza`, sezione dedicata in `openGenReport`): per ogni progetto con monte ore residuo, calcola quante sessioni servirebbero per esaurirlo e le confronta con il massimo consentito dalla frequenza nelle settimane effettivamente in ambito questo run; se il residuo richiederebbe più sessioni di quelle ammesse, lo segnala esplicitamente — distinto dalle carenze settimanali già esistenti (che riguardano il non aver raggiunto la frequenza per mancanza di disponibilità/aule/operatori, non la relazione monte-ore/frequenza).
- **Discrepanza documentale trovata e corretta** (non introdotta da questo ciclo): la sezione Architecture di `CLAUDE.md` sulla Passata 2 citava ancora il vecchio campo singolo `tempoBusto` per il margine di viaggio verso Busto Arsizio, superato dal Ciclo B/S8 (`tempoBustoCesate`/`tempoBustoCasa` via `tempoBustoOperatore`) — corretta.

| Parte | Stato |
|---|---|
| Passata 1: non piazza mai oltre `frequenza - esistenti` | ✅ Fatto (`maxNuoveSettimana`) |
| Passata 3: eredita il vincolo senza modifiche di codice | ✅ Verificato (dimostrazione sotto, Passata 2 del metodo di verifica) |
| Percorso IA: sessione scartata se supera la frequenza | ✅ Fatto (`settimanaConteggi`) |
| Sessioni manuali/confermate preesistenti contano fin da subito | ✅ Fatto (seminate in `giaEsistenti`/`settimanaConteggi` prima di ogni piazzamento) |
| Report segnala monte ore che richiederebbe più sessioni della frequenza | ✅ Fatto (`avvisiFrequenza`) |

### Scenario simulato (tracciato a mano sul codice, come richiesto)

Progetto **"BrainRx, cliente Bianchi"**, frequenza 3/settimana, durata 60 min. Nella settimana 1 del mese (giorni 1-7) esistono già **2 sessioni confermate** (manuali, protette) il giorno 2 e il giorno 4.

1. `sessioniDaConservare` conserva le 2 confermate (non sono `proposta`); la pre-popolazione di `prB` (righe prima della Passata 1) le registra in `prB[progettoId]` con le rispettive date.
2. Passata 1, primo giro (`wk=1,we=7`): `dsWk='2026-07-01'`, `dsWe='2026-07-07'`. `giaEsistenti=(prB[p.id]||[]).filter(b=>b.date in [dsWk,dsWe]).length = 2`. `maxNuove=maxNuoveSettimana(3,2)=1`.
3. Il day-loop tenta di piazzare **al massimo 1** nuova sessione `proposta` questa settimana (`placed<maxNuove` → `placed<1`), anche se in linea di principio ci fosse disponibilità per 3. Se riesce, `placed=1`, `totSettimana=1+2=3=frequenza` esatto — nessuna violazione.
4. **Comportamento pre-Ciclo-C (bug)**: la condizione era `placed<freq` (cioè `placed<3`), quindi la Passata 1 avrebbe potuto piazzare fino a 3 nuove proposte oltre le 2 già confermate, arrivando a un totale di **5** sessioni quella settimana — la violazione che S7 chiede di correggere.
5. Se in un secondo momento (settimana risultasse comunque corta, `totSettimana<freq`) Passata 3 tentasse di recuperare, il suo `missing=richieste-piazzate=3-3=0` (dopo il punto 3): nessuna mossa viene tentata per quella settimana, correttamente.

## Metodo di verifica: multi-passata

1. **Passata 1 — `node check-sintassi.js` (sintassi reale + funzionale)**: 3 blocchi `<script>` tutti OK; 40 test funzionali (i 27 già coperti nei cicli B/B.1 + 13 nuovi: 1 su `parseHM("abc")`, 1 sulla somma con campo invalido, 4 su `bucketSettimana`, 4 su `maxNuoveSettimana` inclusi i due scenari "settimana parzialmente occupata" e "sovra-occupata da sessioni manuali", 5 su `sediAmmesseProgetto`) — **tutti passano**.
2. **Passata 2 — S7 su Passata 3, dimostrazione che non serve alcuna modifica**: riletto `trovaAlternativaBlocker` riga per riga: la ricerca di un'alternativa per la sessione bloccante resta sempre `for(let d=wkB;d<=weB;d++)` con `wkB=bucketSettimana(day0)` — la **stessa** finestra di 7 giorni del progetto bloccante, mai un'altra; il blocco viene **rilocalizzato** (`blocco.data=alt.ds;...`), non duplicato — il conteggio settimanale di quel progetto resta invariato (ancora esattamente 1 sessione quella settimana, solo a un altro orario/giorno). Confermato quindi che la Passata 3 non necessita di modifiche dirette: eredita il vincolo dal `piazzate` (totale) corretto a monte in Passata 1/riepiloghi.
3. **Passata 3 — scenario simulato S7 (settimana parzialmente occupata)**: vedi sezione dedicata sopra, tracciato a mano su `generateMonth` con valori concreti; confermato anche via test automatico (`maxNuoveSettimana(3,2)=1`, `maxNuoveSettimana(2,2)=0`, `maxNuoveSettimana(2,5)=0`) che l'aritmetica del vincolo è corretta nei casi limite (settimana già al completo, settimana sovra-occupata da sessioni manuali oltre la frequenza).
4. **Passata 4 — scenario simulato S5 (cambio sede a posteriori)**: progetto con sede iniziale `Cesate+Online`, fasce già configurate `Lun:[sedi:['Cesate']]` e `Mer:[sedi:['Online']]`. Cambio Sede a `Cesate`: `nuoveAmmesse=['Cesate']`; il controllo trova Mercoledì con una sede (`Online`) non più ammessa → banner mostrato, `giorniFuoriAmbito=['Mer']`. Ri-render con gli stessi dati (`avAttuale`, non svuotati) e `nuoveAmmesse=['Cesate']`: per Mercoledì, `tagOptions` include sia `Cesate` (ammesso) sia `Online` (non ammesso ma già presente in `sedi`) → il tag `Online` compare con classe `on sede-extra` (ancora spuntato, evidenziato). Nessun dato perso, nessuna cancellazione silenziosa, segnalazione esplicita presente.
5. **Passata 5 — nessuna regressione sui cicli precedenti**: rieseguiti tutti i 27 test di B/B.1 (inclusi in `check-sintassi.js`) — tutti invariati. Verificato che l'editor di disponibilità **operatore** (`oe-av`, `oe-monthly`) non riceva mai un `sediAmmesse`/`sediAmmesseIniziali` (chiamate invariate, senza il nuovo parametro) — comportamento identico a prima di questo ciclo, nessuna restrizione introdotta per gli operatori.
6. **Passata 6 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (S5/S7 marcate ✅ Implementato, Architecture Passata 2/3 aggiornata, nuovo strumento `check-sintassi.js` registrato) e questo file descrivono la stessa implementazione con gli stessi nomi di funzione. Corretta una discrepanza pre-esistente trovata durante questa passata (non introdotta da questo ciclo): `CLAUDE.md`, sezione Passata 2, citava ancora il vecchio campo singolo `tempoBusto` invece di `tempoBustoOperatore`/`tempoBustoCesate`/`tempoBustoCasa` (Ciclo B/S8) — segnalata e corretta, come da prassi (le incongruenze si segnalano, non si nascondono).
7. **Passata 7 — rilettura finale integrale del diff** (`git diff index.html`): confermato che ogni modifica rientra in una delle zone già descritte sopra (nuove funzioni condivise, i tre editor di disponibilità, Passata 1/IA di `generateMonth`/`generateMonthAI`, report) — nessuna riga toccata fuori da queste zone, nessun'altra incongruenza trovata → passata "vuota", ciclo chiuso a 7 passate (minimo richiesto: 4).

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (check-sintassi.js, 2 rifiniture, S5, S7) conteneva già le specifiche tecniche complete.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:*
- **S5, meccanismo di segnalazione al cambio Sede**: banner esplicito con i giorni coinvolti + classe CSS `sede-extra` sui tag non più ammessi ma già selezionati (mai nascosti/deselezionati). Scelto perché soddisfa contemporaneamente sia "propone solo le sedi ammesse" (per le nuove selezioni) sia "segnala, non cancella in silenzio" (per i dati già presenti), senza dover scegliere fra le due.
- **S5, estensione a tutti e tre gli editor di disponibilità del progetto** (non solo quello principale `pe-av`, richiesto esplicitamente): trovati durante l'esplorazione anche l'editor delle eccezioni giornaliere e il pannello "Applica a più giorni" con lo stesso identico elenco di sedi hardcoded — estesa la stessa restrizione a tutti e tre per coerenza, altrimenti l'ammissione sarebbe stata parziale e incoerente tra le tre superfici.
- **S7, nessuna modifica a Passata 3**: dimostrato (Passata 2 del metodo di verifica sopra) che il vincolo si eredita automaticamente dal `piazzate` corretto — scartata l'idea di aggiungere un controllo ridondante direttamente nel ciclo di Passata 3, per non introdurre due fonti di verità sulla stessa invariante.
- **S7, avviso monte-ore-vs-frequenza collocato come nuova sezione del report** (`avvisiFrequenza`), non tra i suggerimenti generici esistenti: è concettualmente un vincolo strutturale progetto/mese, distinto dalle carenze settimanali per disponibilità/aule/operatori già presenti — tenerlo separato evita di confondere le due diagnosi.
- **Discrepanza `tempoBusto` in `CLAUDE.md`**: corretta direttamente (non solo segnalata) perché è un refuso puramente documentale del Ciclo B (descrive lo stato attuale del codice, non una decisione storica), coerente con la prassi già seguita nei cicli precedenti di tenere accurate le sezioni operative.

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 0 | `check-sintassi.js` in radice, un comando, registrato in CLAUDE.md | ✅ Fatto | Sostituisce gli script temporanei dei cicli B/B.1 |
| Rifinitura 1 | `parseHM("abc")` → NaN, non null | ✅ Fatto | Testato |
| Rifinitura 2 | Somma live esclude campi invalidi, verificato ovunque serva | ✅ Fatto | Unica occorrenza trovata (`updateMonteOre`), testata |
| S5 | Disponibilità limitate alla Sede, segnalazione su cambio sede | ✅ Fatto | Estesa a tutti e tre gli editor di disponibilità progetto |
| S7 | Frequenza mai superata in nessuna passata, sessioni manuali contate, report | ✅ Fatto | Passata 1 + percorso IA modificati, Passata 3 eredita, avviso monte-ore-vs-frequenza aggiunto |
| Verifica | Multi-passata (min. 4, incl. `node check-sintassi.js`, test S7 simulato, S5 con cambio sede, somma con campo invalido) | ✅ Fatto | 7 passate |

**Cosa manca**: nessuna lacuna sui punti richiesti. Non eseguibile in questo ambiente (nessun login M365/browser reale): il test dal vivo dell'intera generazione con un caso reale di settimana parzialmente occupata da sessioni confermate — raccomandato a Simone come primo test dopo il deploy di questo ciclo, insieme alla verifica visiva dei tre editor di disponibilità con una Sede composita.

## Limiti di questa verifica
`check-sintassi.js` verifica sintassi reale e comportamento delle funzioni pure estratte dal file reale — un livello di garanzia comportamentale genuino, non simulato. Non è stato invece possibile eseguire l'intera `generateMonth`/`generateMonthAI` (funzioni profondamente legate a `state`, MSAL, SharePoint) in questo ambiente: lo scenario S7 e quello S5 sopra sono stati tracciati a mano riga per riga sul codice reale con valori concreti, non osservati da un'esecuzione dal vivo. Si raccomanda il test manuale descritto nella sezione precedente subito dopo il deploy.

---

# Verifica — Ciclo D: S9 (campo stato unico) + S1 (eliminazione multipla)

Data: 2026-07-17.

## Nota di fedeltà preliminare: il "doppio campo Stato/Esito" non è mai esistito come campo dati

Prima di implementare la migrazione richiesta dal punto 2 di S9, ho verificato se un campo `esito` separato fosse mai stato scritto dal codice, in qualunque versione precedente: `git log --all -p -- index.html | grep -n "\.esito\|esito:"` non restituisce **alcun** risultato, e nessuna occorrenza di `.esito` (accesso a proprietà) esiste nel file attuale. Quello che il prompt/CLAUDE.md descrivevano come "doppio campo" era in realtà una **doppia interfaccia sullo stesso dato**: `openSessionDetail` mostrava da tempo un tag "Stato" di sola lettura (nella `<dl>`) **e**, separatamente, un controllo "Esito sessione" (`sd-stato-op`, opzioni fisse `eseguita`/`annullata`/`assenza ingiustificata`) che scriveva — da sempre — sullo stesso identico campo `s.stato`, mai su un campo `esito` a parte. Segnalo questa discrepanza come da prassi (non corretta in silenzio); ho comunque implementato la migrazione richiesta al punto 2 come rete di sicurezza difensiva, per l'ipotesi (non verificabile con certezza assoluta dal solo codice applicativo) che qualche record nella lista SharePoint `Gestionale_Sessioni` porti un campo `esito` letterale scritto da uno strumento esterno a questa app (es. una chiamata Graph/SharePoint diretta durante un test).

## S9 — Campo stato sessione unico

**Cosa è stato fatto**:
- **Unificazione dell'interfaccia** (`openSessionDetail`): rimossa la coppia "Stato" (tag di sola lettura, sempre mostrato) + "Esito sessione" (select separata, sempre mostrata se `canEdit`). Ora un'unica variabile `opzStato=canEdit?statiSelezionabili(state.role,statoAttuale):null` decide la presentazione: se `opzStato` è `null`, resta **solo** il tag di sola lettura nella `<dl>`; se è valorizzato, il tag di sola lettura **sparisce** e al suo posto compare un unico campo "Stato" editabile con **solo** le opzioni ammesse (mai un elenco più ampio "filtrato solo al salvataggio"). Non esistono più due rappresentazioni contemporanee dello stesso dato nella stessa schermata.
- **Due nuove funzioni pure condivise** (`statiSelezionabili(role,statoAttuale)`, `transizioneAmmessa(role,statoAttuale,statoNuovo)`):
  - Admin: `statiSelezionabili` restituisce sempre tutti e 5 gli stati (`STATI_SESS`), da qualunque stato di partenza — copre esplicitamente `proposta`↔`confermata` in entrambe le direzioni, richiesto dal punto 3.
  - Operatore: `null` (nessuna modifica ammessa) da qualunque stato **tranne** `confermata`; da `confermata` restituisce `['confermata','eseguita','assenza ingiustificata','annullata']` (la propria stessa voce + i tre esiti, mai `proposta`).
  - `transizioneAmmessa` è la stessa logica riusata come guardia: `statoNuovo===statoAttuale` è sempre ammesso (nessun cambiamento); altrimenti verifica che `statoNuovo` sia tra le opzioni di `statiSelezionabili` per quel ruolo/stato di partenza.
- **Validazione anche al salvataggio, non solo nelle opzioni mostrate** (richiesto esplicitamente dal punto 3, "mai fidarsi della sola UI"): il gestore di `#sd-save-note` rilegge `nuovoStato` dal select e, se diverso dallo stato catturato all'apertura della scheda, richiama `transizioneAmmessa(state.role,statoAttuale,nuovoStato)` prima di scrivere su `s.stato` — se la transizione non è ammessa la scrittura viene **ignorata** (con un `console.warn`), non silenziosamente accettata. Questo neutralizza anche il caso limite di un elemento `<select>` iniettato via console con un valore fuori dalle opzioni previste (vedi scenario tracciato sotto).
- **Migrazione** in `loadAll()`: `state.data.sessioni.filter(s=>s.hasOwnProperty('esito')&&s.esito)` individua eventuali record legacy, sposta il valore su `stato` e rimuove `esito`; si salvano **solo** i record effettivamente toccati (non l'intera lista sessioni, a differenza delle migrazioni precedenti su operatori/progetti che sono liste tipicamente piccole — le sessioni possono essere molte). **Nessun marcatore anti-doppia-applicazione**: a differenza della migrazione h:mm (che richiede `oreInMinuti` perché un valore già in minuti è indistinguibile da uno in ore senza un marcatore), qui la condizione stessa (presenza del campo `esito`) sparisce non appena la migrazione gira una volta — è già idempotente per costruzione.
- **Semi-trasparenza `proposta`**: nuova classe CSS `.ev.proposta{opacity:.55}` applicata in `evChip()` (Calendario) e `tr.rowlink.stato-proposta{opacity:.7}` applicata alla riga in `renderSessioni()` (lista Sessioni) — quest'ultima in aggiunta al tag colorato già esistente (`statoTag`), non in sostituzione.
- **Regole di monte ore e protezione dalla rigenerazione (punto 5), dimostrazione che restano intatte**: nessuna di queste letture è stata toccata da questo ciclo — `oreErog(pid)` (riga 659) filtra ancora `s.stato==='eseguita'||s.stato==='assenza ingiustificata'`; `sessioniDaConservare(ms,scopeIds)` (riga 1594) filtra ancora `!(s.data.startsWith(ms)&&s.stato==='proposta'&&scopeIds.has(s.progettoId))` — cioè conserva tutto tranne le `proposta` in ambito, `confermata`/`eseguita`/`assenza ingiustificata` restano sempre vincoli attivi indipendentemente da chi/come le ha portate a quello stato. Poiché S9 non introduce nuovi valori di stato né un campo diverso da `s.stato` (la migrazione converge sempre sullo stesso campo), queste due funzioni non necessitavano di alcuna modifica — verificato leggendole riga per riga, non solo per assunzione.

| Parte | Stato |
|---|---|
| Unico campo "Stato" (select o tag, mai entrambi) | ✅ Fatto |
| Permessi Admin: tutte le transizioni incl. proposta↔confermata | ✅ Fatto (`statiSelezionabili`) |
| Permessi Operatore: solo confermata→esiti, mai su proposta/esiti già definiti | ✅ Fatto |
| Validazione anche al salvataggio (non solo opzioni mostrate) | ✅ Fatto (`transizioneAmmessa` nel gestore salvataggio) |
| Migrazione one-time campo esito legacy → stato | ✅ Fatto (rete di sicurezza; campo mai trovato scritto dal codice, vedi nota di fedeltà) |
| Proposta semi-trasparente nel Calendario | ✅ Fatto (`.ev.proposta`) |
| Proposta distinguibile nella lista Sessioni | ✅ Fatto (tag colorato preesistente + nuova classe di riga `.stato-proposta`) |
| Monte ore (`oreErog`) invariato | ✅ Verificato, nessuna modifica necessaria |
| Protezione da rigenerazione (`sessioniDaConservare`) invariata | ✅ Verificato, nessuna modifica necessaria |

### Scenario tracciato a mano: permessi in UI e al salvataggio

**Caso 1 — Operatore, sessione propria `confermata`**: apre il dettaglio, `canEdit=true` (proprietario), `statoAttuale='confermata'`, `statiSelezionabili('Operatore','confermata')=['confermata','eseguita','assenza ingiustificata','annullata']` → select con 4 opzioni, `confermata` preselezionata. Sceglie `eseguita` e salva: `nuovoStato='eseguita'≠statoAttuale` → `transizioneAmmessa('Operatore','confermata','eseguita')` → `true` → `s.stato='eseguita'` scritto.

**Caso 2 — Operatore, sessione propria `proposta`, tentativo di forzatura da console**: apre il dettaglio, `statiSelezionabili('Operatore','proposta')=null` → nessun select creato (solo il tag di sola lettura). Ipotesi: un utente tecnicamente capace inietta da devtools un `<select id="sd-stato-op">` con valore `confermata` e preme "Salva". Il gestore rilegge comunque `$('#sd-stato-op')` (trova l'elemento iniettato), `nuovoStato='confermata'≠statoAttuale='proposta'` → `transizioneAmmessa('Operatore','proposta','confermata')` → `statiSelezionabili('Operatore','proposta')` è `null` → `false` → la scrittura viene **ignorata**, `s.stato` resta `proposta`. Dimostra che il controllo al salvataggio non dipende dal fatto che il select "regolare" non fosse mai stato creato.

**Limite non risolvibile da questo file** (stesso già documentato per `openUtenteReadonly` in un ciclo precedente): un utente che chiami direttamente `saveRecord('sessioni',{...s,stato:'confermata'})` da console, bypassando interamente `openSessionDetail`, aggirerebbe comunque `transizioneAmmessa` — la vera garanzia richiederebbe permessi a livello di lista SharePoint (`Gestionale_Sessioni`), non ottenibile da `index.html`. La rivalidazione al salvataggio implementata qui alza la soglia oltre la sola interfaccia visibile (soddisfa la richiesta esplicita "mai fidarsi della sola UI"), ma non è un confine di sicurezza assoluto.

---

## S1 — Eliminazione multipla (solo Admin)

**Cosa è stato fatto**:
- **Selezione multipla** in "Sessioni", visibile **solo per Admin** (colonna checkbox e barra azioni assenti per l'Operatore, che non vede mai i controlli di massa): checkbox per riga (`class="sess-chk"`) più un "seleziona tutte" nell'intestazione (`#sess-selall`, riflette se **tutte** le righe attualmente visibili — cioè dopo i filtri correnti — sono selezionate). Il click sulla checkbox ferma la propagazione (`e.stopPropagation()`) per non aprire anche il dettaglio della riga. La selezione è tenuta in `state.selSessioni` (un `Set`, mai persistito) e viene ripulita dagli id non più visibili quando cambia un filtro, così una sessione filtrata via non resta "selezionata alla cieca".
- **Barra azioni di massa** (compare solo quando `state.selSessioni.size>0`): conteggio selezionati, select con i 5 `STATI_SESS` + pulsante "Cambia stato", pulsante "🗑 Elimina selezionate", pulsante "Deseleziona tutte".
- **Cambio stato di massa**: applica `transizioneAmmessa('Admin',...)` per ciascuna sessione selezionata (sempre vero per Admin da/verso qualunque stato, ma il controllo resta per coerenza col punto S9 e per non dipendere da un'assunzione impliciita se in futuro i permessi Admin dovessero mai restringersi) — con una conferma semplice prima di procedere (non richiesta esplicitamente per il cambio stato, solo per l'eliminazione, ma aggiunta per prevenire un click accidentale su una barra che appare solo con selezione attiva).
- **Eliminazione di massa con avviso graduato** (`confermaEliminazioneMultipla`, richiama le funzioni pure `pesoMassimoSelezione`/`riepilogoStati`): calcola il peso più alto nella selezione (`pesoStato`: 0 per `proposta`/`annullata`, 1 per `confermata`, 2 per `eseguita`/`assenza ingiustificata`) e mostra, in tutti e tre i casi, il riepilogo per stato (`riepilogoStati`, es. "2 proposta, 1 confermata, 3 eseguita"): peso 0 → un solo `confirm()`; peso 1 → un `confirm()` con testo esplicito "ATTENZIONE... CONFERMATE"; peso 2 → **due** `confirm()` in sequenza (il primo annullabile interrompe subito l'intera operazione), il secondo esplicitamente "DEFINITIVAMENTE", entrambi ricordano che quelle sessioni contano nel monte ore.
- **Non implementato in questo ciclo, come da istruzione esplicita**: la scorciatoia dal Calendario "gestisci sessioni di questo utente" (punto 8) — annotata come rimandata al Ciclo E in `CLAUDE.md`/`CONTESTO.md` (si aggancia al filtro utente→progetto di S2), nessuna versione provvisoria costruita nel frattempo.

| Parte | Stato |
|---|---|
| Selezione multipla (solo Admin) | ✅ Fatto (`state.selSessioni`, checkbox + seleziona tutte) |
| Cambio stato di massa (stessi permessi S9) | ✅ Fatto (`transizioneAmmessa`) |
| Eliminazione di massa con avviso graduato a 3 livelli | ✅ Fatto (`pesoMassimoSelezione`) |
| Riepilogo per stato nell'avviso | ✅ Fatto (`riepilogoStati`) |
| Scorciatoia dal Calendario | ⚠️ Rimandata al Ciclo E, come da istruzione esplicita del prompt |

### Scenario tracciato a mano: avviso graduato

Selezione di 4 sessioni: 2 `proposta`, 1 `confermata`, 1 `eseguita`. `riepilogoStati` → `{proposta:2, confermata:1, eseguita:1}` → dettaglio "2 proposta, 1 confermata, 1 eseguita". `pesoMassimoSelezione` → `Math.max(pesoStato('proposta')=0, pesoStato('proposta')=0, pesoStato('confermata')=1, pesoStato('eseguita')=2) = 2` → ramo "doppia conferma esplicita", con il riepilogo completo (non solo "1 eseguita") mostrato in **entrambi** i dialoghi. Se l'utente annulla il primo `confirm`, la funzione ritorna `false` immediatamente: il secondo dialogo non compare e nessuna sessione viene eliminata.

## Estensione di `check-sintassi.js`

Aggiunte alle liste di estrazione le 5 nuove funzioni pure: `statiSelezionabili`, `transizioneAmmessa`, `pesoStato`, `pesoMassimoSelezione`, `riepilogoStati`. 23 nuovi casi di test (40→63 totali): 6 su `statiSelezionabili` (Admin da qualunque stato, Operatore da `confermata`/`proposta`/`eseguita`/`annullata`), 7 su `transizioneAmmessa` (nessun cambiamento sempre ammesso, Admin avanti e indietro, Operatore consentito da confermata, Operatore negato su proposta e all'indietro e da un esito già definito), 5 su `pesoStato`, 4 su `pesoMassimoSelezione` (incluso array vuoto), 1 su `riepilogoStati` (incluso un record senza `stato`, che deve contare come `proposta`).

## Metodo di verifica: multi-passata

1. **Passata 1 — `node check-sintassi.js`**: 3 blocchi `<script>` OK; 63 test funzionali (40 preesistenti + 23 nuovi) — **tutti passano**.
2. **Passata 2 — verifica punto per punto del prompt** (S9 punti 1-5, S1 punti 6-8): vedi tabelle sopra, incrociate con il codice reale (numeri di riga citati per `oreErog`/`sessioniDaConservare`).
3. **Passata 3 — scenario tracciato a mano sui permessi** (S9): vedi "Scenario tracciato a mano: permessi in UI e al salvataggio" sopra, inclusa la simulazione di un tentativo di forzatura da console.
4. **Passata 4 — scenario tracciato a mano sull'avviso graduato** (S1): vedi sopra, con verifica esplicita che un annullamento sul primo dialogo del livello "doppia conferma" interrompe subito l'intera operazione.
5. **Passata 5 — cronologia git per la nota di fedeltà**: `git log --all -p -- index.html | grep esito:` e ricerca di `.esito` nel file attuale, entrambi senza risultati — base della segnalazione in apertura.
6. **Passata 6 — nessuna regressione sui cicli precedenti**: i 40 test già esistenti (Cicli B/B.1/C) restano invariati e passano; verificato che `openSessionModal` (Admin, "Modifica") e il suo select `se-stato` con tutti i `STATI_SESS` non sono stati toccati; verificato che `sessioniVisibili()` (Operatore vede solo le proprie sessioni, in ogni stato) non è stato toccato.
7. **Passata 7 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (S9/S1 marcate ✅ Implementato con il dettaglio tecnico, scorciatoia Calendario esplicitamente rimandata), `CONTESTO.md` (Cronologia voce 30, Backlog voce 21/Ciclo D, Registro delle decisioni voci 34-38) e questo file descrivono la stessa implementazione con gli stessi nomi di funzione; nessuna incongruenza trovata.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (S9 punti 1-5, S1 punti 6-8, estensione `check-sintassi.js`, verifica multi-passata) conteneva già le specifiche tecniche complete.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 34-38 (nota di fedeltà sul campo esito mai esistito nei dati; unico controllo "Stato" invece di tag+select; validazione anche al salvataggio; due conferme sequenziali invece di una sola rafforzata; scorciatoia Calendario rimandata senza versione provvisoria).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| S9.1 | Eliminare il doppio campo, un solo `stato` per l'intera catena | ✅ Fatto | Il dato era già unico; unificata anche l'interfaccia (un solo controllo, non due) |
| S9.2 | Migrazione one-time con marcatore anti-doppia-applicazione | ✅ Fatto (rete di sicurezza) | Nessun campo `esito` mai trovato nei dati storici (nota di fedeltà); nessun marcatore necessario, condizione auto-eliminante |
| S9.3 | Permessi Admin/Operatore, applicati in UI e al salvataggio | ✅ Fatto | `statiSelezionabili` (UI) + `transizioneAmmessa` (salvataggio), scenario di forzatura tracciato |
| S9.4 | Proposta semi-trasparente nel Calendario, distinguibile in Sessioni | ✅ Fatto | `.ev.proposta` + `.stato-proposta`, in aggiunta al tag colorato preesistente |
| S9.5 | Monte ore/rigenerazione invariati, dimostrarlo | ✅ Verificato | `oreErog`/`sessioniDaConservare` non toccate, lette riga per riga |
| S1.6 | Selezione multipla, cambio stato ed eliminazione di massa | ✅ Fatto | Checkbox + barra azioni, solo Admin |
| S1.7 | Avviso graduato con riepilogo per stato | ✅ Fatto | 3 livelli, doppia conferma per eseguita/assenza ingiustificata |
| S1.8 | Scorciatoia Calendario rimandata al Ciclo E, annotata | ✅ Fatto | Annotata in `CLAUDE.md`/`CONTESTO.md`, non implementata |
| Verifica | Multi-passata (min. 4, incl. `node check-sintassi.js`, migrazione idempotente, permessi in UI e al salvataggio per entrambi i ruoli, regole monte ore invariate) | ✅ Fatto | 7 passate |

**Cosa manca**: nessuna lacuna sui punti richiesti (S1.8 è un rimando esplicitamente richiesto, non una lacuna). Non eseguibile in questo ambiente (nessun login M365/browser reale): il test dal vivo dell'intero flusso — aprire una sessione `confermata` come Operatore di test e verificare che il select mostri solo i 4 stati attesi; selezionare sessioni miste in "Sessioni" come Admin e verificare i tre livelli di avviso; verificare visivamente la semi-trasparenza delle `proposta` nel Calendario — raccomandato a Simone come primo collaudo dopo il deploy.

## Limiti di questa verifica
`check-sintassi.js` verifica sintassi reale e le 5 nuove funzioni pure con casi concreti — un livello di garanzia comportamentale genuino sulla logica di permesso, non simulato. Non è stato invece possibile osservare dal vivo il rendering condizionale di `openSessionDetail`/`renderSessioni` (markup, classi CSS, comparsa/scomparsa dei controlli) in un browser reale: il comportamento è stato tracciato a mano leggendo il codice generato riga per riga con valori concreti (vedi i due scenari sopra), non osservato in esecuzione. Si raccomanda il test manuale descritto nella sezione precedente subito dopo il deploy, con particolare attenzione al caso "Operatore su una propria sessione confermata" (l'unico in cui l'Operatore ottiene un controllo di stato editabile).

---

# Verifica — Ciclo E: S2 (filtri utente→progetto) + S3 (report persistenti)

Data: 2026-07-20.

## ⚠️ Azione richiesta a Simone prima che lo storico dei report sia utilizzabile

Questo ciclo introduce, per la prima volta da quando il gestionale è in produzione (13/07), una lista SharePoint che **non esiste ancora**: `Gestionale_Report`. È stata deliberatamente registrata come **opzionale** (vedi sezione S3 sotto e Registro delle decisioni, voce 40): la sua assenza **non blocca l'app** né la generazione dei calendari, che funzionano esattamente come prima. Finché la lista non viene creata, la sola conseguenza è che la sezione "📚 Report precedenti" (pagina Genera) mostra un avviso invece dello storico. **Per attivarla**: creare su SharePoint una lista `Gestionale_Report` con due colonne, `Title` (testo) e `Data` (testo multiriga) — stesso schema esatto delle altre sei liste già esistenti (`Gestionale_Operatori`, ecc.). Nessuna azione è invece necessaria per il resto del ciclo (S2): funziona con i dati già presenti.

## S2 — Filtri utente→progetto

**Cosa è stato fatto**:
- **Filtro a cascata** (`sess-f-utente`/`sess-f-progetto` in "Sessioni", `cal-f-utente`/`cal-f-progetto` nel "Calendario", solo Admin — coerente con gli altri filtri di queste due viste, già Admin-only): selezionato un utente, la tendina progetti si ricostruisce con **solo** i progetti di quell'utente (`state.data.progetti.filter(p=>p.utenteId===utenteId)`); il cambio di utente azzera sempre la selezione progetto (mai un progetto di un altro utente rimasto selezionato per errore). La selezione progetto **persiste** invece tra i re-render non causati da un cambio utente (es. dopo un'azione di massa in Sessioni), perché il valore corrente viene letto e ripristinato dopo la ricostruzione delle opzioni, se ancora valido per l'utente corrente.
- **Riepilogo condiviso** (`renderRiepilogoUtente(wrapId,bodyId,utenteId,mostraScorciatoia)`, un'unica funzione invocata sia da `renderSessioni()` sia da `renderCalendar()` — per non duplicare la stessa logica in due punti che potrebbero disallinearsi, vedi Registro delle decisioni voce 41): quando un utente è selezionato, mostra per ciascun suo progetto le sessioni per stato (`riepilogoStatoProgetto`, nuova funzione pura — a differenza di `riepilogoStati` già esistente dal Ciclo D, elenca **tutti** gli stati anche a zero, più leggibile in un riepilogo tabellare) e il monte ore h:mm erogato/residuo (riusa `oreErog`/`fmtHM` esistenti, nessuna nuova logica di calcolo).
- **Scorciatoia dal Ciclo D agganciata qui** (S1 punto 8, rimasta annotata come rimandata fino a oggi): nel pannello di riepilogo del **Calendario** (non in quello di Sessioni, che non ne ha bisogno essendo già la destinazione), un pulsante "🗂 Gestisci sessioni di questo utente" chiama `vaiASessioniPerUtente(utenteId)`, che imposta `state.sessFiltroUtentePreset` e passa alla tab Sessioni; al render successivo di `renderSessioni()`, il preset viene letto, applicato a `sess-f-utente` e consumato (azzerato) una sola volta.
- **Scelta consapevole**: gli utenti proposti in questi due filtri **non** sono limitati agli "attivi" (a differenza, per esempio, del dropdown utente nella modale sessione) — si tratta di consultare sessioni già esistenti, non di assegnare nuovo lavoro; un utente disattivato può avere ancora sessioni storiche da rivedere (Registro delle decisioni, voce 45).

| Parte | Stato |
|---|---|
| Cascata utente→progetto in Sessioni | ✅ Fatto |
| Cascata utente→progetto in Calendario | ✅ Fatto |
| Riepilogo per progetto: sessioni per stato + monte ore h:mm erogato/residuo | ✅ Fatto (`renderRiepilogoUtente`, condivisa) |
| Scorciatoia Calendario→Sessioni (rimandata dal Ciclo D) | ✅ Fatto (`vaiASessioniPerUtente`) |

### Scenario tracciato a mano: cascata con utente multi-progetto (in Sessioni)

Utente "Rossi Anna" con 2 progetti, "BrainRx" e "Feuerstein". Admin seleziona Rossi Anna in `sess-f-utente`: il listener azzera subito `sess-f-progetto` e richiama `renderSessioni()`. Dentro la funzione: `progettiUt` = [BrainRx, Feuerstein]; `fPr.innerHTML` ricostruito con queste 2 opzioni + "Tutti i progetti"; `progPrec` (letto prima della ricostruzione) era `''` → resta su "Tutti i progetti". Il riepilogo mostra 2 card. La lista sessioni è filtrata per `utenteId` ma non ancora per progetto. Admin seleziona poi "BrainRx" in `sess-f-progetto`: il listener (semplice, nessun azzeramento) richiama `renderSessioni()`; questa volta `progPrec=fPr.value` letto **prima** della ricostruzione vale già "BrainRx" (il browser ha già applicato la selezione dell'utente prima che scattasse l'evento `change`); dopo la ricostruzione (stesse 2 opzioni, utente non cambiato), `progettiUt.some(p=>p.id===progPrec)` è vero → `fPr.value` viene ripristinato a "BrainRx". La lista si filtra ora anche per quel progetto. Se successivamente Admin spunta una checkbox di selezione multipla (S1), che richiama di nuovo `renderSessioni()`, "BrainRx" resta selezionato (stesso meccanismo di conferma) — la cascata non si "dimentica" della scelta a ogni render.

**Cambio utente con progetto già selezionato**: da questo stato (Rossi Anna + BrainRx), Admin cambia utente a "Bianchi Mario". Il listener imposta `fPr.value=''` **prima** di richiamare `renderSessioni()`; dentro la funzione `progPrec` vale quindi già `''`, i nuovi `progettiUt` sono quelli di Bianchi Mario, e nessun progetto di Rossi Anna resta selezionato per errore.

### Scenario tracciato a mano: scorciatoia dal Calendario

Admin nel Calendario seleziona "Rossi Anna" in `cal-f-utente`. `renderCalFilters()` (chiamata da `renderCalendar()` prima del riepilogo) aggiorna `state.cal.filterUtente`; subito dopo `renderRiepilogoUtente('cal-riepilogo-utente',...,state.cal.filterUtente,true)` mostra il pannello con il pulsante e il riepilogo dei 2 progetti di Rossi Anna. Click sul pulsante → `vaiASessioniPerUtente('u1')` → `state.sessFiltroUtentePreset='u1'` e `showTab('sessioni')`. In `showTab`, la sezione Sessioni diventa visibile e `renderSessioni()` viene eseguita: le opzioni di `sess-f-utente` vengono costruite per prime (se non già presenti, `dataset.ready`), **poi** viene letto e applicato il preset (`fUt.value='u1'`, preset azzerato) — l'ordine garantisce che l'opzione esista già quando si tenta di selezionarla, anche alla primissima apertura della tab Sessioni in questa sessione utente. Risultato: Admin si ritrova in Sessioni con "Rossi Anna" già filtrata, esattamente come richiesto.

### Correzione di un difetto trovato durante la stesura (non nella lettera della richiesta)

Durante la scrittura di `renderRiepilogoUtente`, il pulsante "🗂 Gestisci sessioni di questo utente" veniva cercato con un selettore globale (`$('#riep-vai-sessioni')`, che interroga tutto il documento) invece che scoperto solo dentro il contenitore appena scritto. Poiché Sessioni e Calendario condividono la stessa funzione ma solo il Calendario genera quel pulsante, un render di Sessioni (senza pulsante proprio) avrebbe comunque trovato — e agganciato un altro `addEventListener` a — il pulsante (nascosto, non cliccabile in quel momento) rimasto nella sezione Calendario da un render precedente, accumulando ascoltatori ridondanti sullo stesso nodo a ogni render di Sessioni. Effetto pratico nullo (il nodo è irraggiungibile mentre nascosto, e viene comunque sostituito interamente al prossimo render del Calendario, portando via con sé tutti gli ascoltatori accumulati) ma comunque un difetto di correttezza. Corretto usando `body.querySelector(...)`, scoperto al contenitore effettivamente appena scritto da quella chiamata.

---

## S3 — Report di generazione persistenti

**Cosa è stato fatto**:
- **Nuova lista SharePoint `Gestionale_Report`** aggiunta a `CFG.lists` (stesso schema Title+Data delle altre sei). **Decisione architetturale** (Registro delle decisioni, voce 40): registrata anche in una nuova costante `CFG.listeOpzionali=['report']`, e `tryResolveLists()` modificata per non far fallire la risoluzione se una lista lì elencata non viene trovata (prima, la mancanza di **una sola** lista qualsiasi bloccava l'intera app per **tutti** gli utenti, "Liste SharePoint non trovate"). Questa è la prima lista introdotta dopo la messa in produzione iniziale (13/07): senza questa modifica, il solo deploy di questo ciclo avrebbe reso il gestionale interamente inutilizzabile per chiunque finché Simone non avesse creato la lista su SharePoint — un rischio giudicato non accettabile per una funzionalità accessoria (lo storico dei report), quindi evitato.
- **Salvataggio automatico** (`persistReport(report)`, chiamata — senza `await` — subito dopo ogni generazione, sia algoritmo sia IA): costruisce un record `{id, generatoIl (ISO datetime), mese, metodo, esito, report}` dove `report` è l'intero oggetto già prodotto da `costruisciReportGenerazione` (usato identico da entrambi i percorsi di generazione, quindi stessa struttura garantita), e lo salva con `saveRecord('report',rec)`. Se `state.listIds.report` non è definito (lista non ancora creata) la funzione non fa nulla, silenziosamente. Se il salvataggio fallisce per un altro motivo (rete, permessi), l'errore è intercettato e solo loggato (`console.warn`) — **la generazione non viene mai segnalata come fallita per una causa che riguarda solo la persistenza opzionale dello storico** (Registro delle decisioni, voce 44).
- **UI — "📚 Report precedenti"** (decisione UI di Simone del 17/07, chiusa in questo ciclo — Registro delle decisioni, voce aggiornata 17): nuova sezione nella pagina "Genera" (`renderReportStorico()`, chiamata da `refreshGenSel()` ogni volta che si apre quella tab), tabella con Generato il/Mese/Metodo/Esito e un pulsante "Apri" per riga, ordinata per data decrescente. "Apri" richiama `openGenReport(rec.report)` — la **stessa** funzione già usata per il report appena prodotto da una generazione: nessuna vista duplicata da mantenere.
- **Vista filtrabile per utente** (richiesta esplicita, punto 5): `openGenReport(report,filtroUtenteId)` ora accetta un secondo parametro opzionale; se `report.utenti.length>0` mostra un select "Filtra per utente" che, al cambio, richiude e riapre il modale con il nuovo filtro (`openModal()` chiude sempre l'eventuale modale precedente prima di aprirne uno nuovo — nessuna gestione speciale necessaria). Il filtro (`filtraReportUtenti`, nuova funzione pura) si applica **solo** alla sezione utenti/progetti: le sezioni spostamenti/suggerimenti/metriche restano relative all'intero mese, non essendo strutturate per utente nel report attuale — ristrutturarle sarebbe la revisione di contenuto esplicitamente dichiarata fuori ambito (punto 6, Registro delle decisioni voce 43).
- **Fuori ambito, come richiesto esplicitamente** (punto 6): nessuna modifica al contenuto/aspetto grafico del report stesso, oltre al select di filtro aggiunto in testa.

| Parte | Stato |
|---|---|
| Lista `Gestionale_Report` (schema Title+Data) | ✅ Fatto — codice pronto, lista da creare su SharePoint (vedi avviso in apertura) |
| Salvataggio automatico a ogni generazione (algoritmo e IA) | ✅ Fatto (`persistReport`) |
| Record con data/ora, mese, esito, dettaglio completo (utenti/progetti, anomalie, avvisiFrequenza) | ✅ Fatto — nessuna informazione del report originale persa |
| UI: sezione "Report precedenti" in Genera | ✅ Fatto (`renderReportStorico`) |
| Apertura di un report salvato nella stessa vista del report "fresco" | ✅ Fatto — nessuna vista duplicata |
| Vista filtrabile per utente | ✅ Fatto (`filtraReportUtenti`), limitata alla sezione utenti/progetti (scelta esplicita, vedi sopra) |
| Nessuna revisione grafica/contenutistica del report | ✅ Rispettato, come richiesto |
| Assenza della lista non blocca l'app | ✅ Fatto (`CFG.listeOpzionali`) |

### Scenario tracciato a mano: salvataggio e riapertura di un report

Admin genera con l'algoritmo per "2026-08" con una carenza per l'utente "Rossi Anna" (`u1`). `res.report={mese:'2026-08',metodo:'algoritmo',utenti:[{utenteId:'u1',nome:'Rossi Anna',progetti:[...]}], mosseRiparazione:[...],...}`. `persistReport(res.report)` viene invocata (non attesa dal chiamante): costruisce `rec` con un nuovo `id`, `generatoIl` all'istante corrente, ed `esito='con carenze'` (perché `utenti.length===1>0`); `saveRecord('report',rec)` la scrive su SharePoint e la aggiunge a `state.data.report` (lo stesso array, mutato per riferimento — meccanismo già esistente di `saveRecord`, non modificato); infine `renderReportStorico()` aggiorna la tabella (anche se l'Admin in quel momento non è più sulla tab Genera, la scrittura nel DOM avviene comunque, pronta al prossimo `showTab('genera')`). Più avanti (anche in una sessione di login successiva, dopo che `loadAll()` ha ripopolato `state.data.report` da SharePoint), Admin apre "Genera": la riga compare con "Generato il" formattato (`fmtDateTime`), "Agosto 2026", "Algoritmo", tag arancione "con carenze". Click "Apri" → `openGenReport(rec.report)` mostra un contenuto **identico bit-per-bit** a quello mostrato subito dopo la generazione originale (stesso oggetto, salvato tale e quale). Selezionando "Rossi Anna" nel filtro utente del modale, la vista si richiude e riapre mostrando solo la sua card.

## Correzione di una discrepanza pre-esistente trovata in `CLAUDE.md` (non introdotta da questo ciclo)

Durante l'estensione della lista di liste (`CFG.lists`), ho riletto la sezione Architecture di `CLAUDE.md` (punto 3, data layer) per aggiornare il conteggio delle liste da sei a sette: descriveva ancora **solo le prime due** delle **cinque** migrazioni one-time oggi presenti in `loadAll()` (nome→nome+cognome, sede composita — mancavano monte ore h:mm/S6, tempo Busto sdoppiato/S8, ed esito legacy/S9, introdotte nei cicli B e D senza mai aggiornare questo punto). Corretta l'elencazione completa. Segnalata come da prassi (trovata durante un'altra modifica, non lasciata in silenzio) invece di limitarmi ad aggiungere la sola nuova voce.

## Estensione di `check-sintassi.js`

Aggiunte alle liste di estrazione due nuove funzioni pure (`riepilogoStatoProgetto`, `filtraReportUtenti`) e la costante `STATI_SESS` (necessaria a `riepilogoStatoProgetto`, che ora la referenzia). 6 nuovi casi di test (63→69 totali): 3 su `riepilogoStatoProgetto` (tutti gli stati presenti anche a zero, lista vuota, record senza `stato`), 3 su `filtraReportUtenti` (senza filtro, con filtro su match esistente, con filtro su utente assente → array vuoto).

## Metodo di verifica: multi-passata

1. **Passata 1 — `node check-sintassi.js`**: 3 blocchi `<script>` OK; 69 test funzionali (63 preesistenti + 6 nuovi) — **tutti passano**.
2. **Passata 2 — verifica punto per punto del prompt** (S2 punti 1-3, S3 punti 4-6): vedi tabelle sopra.
3. **Passata 3 — scenario tracciato a mano: cascata con utente multi-progetto**, incluso il cambio di utente con progetto già selezionato (vedi sopra); trovato e corretto durante questa passata il difetto di scoping del selettore `$('#riep-vai-sessioni')` descritto sopra.
4. **Passata 4 — scenario tracciato a mano: salvataggio e riapertura di un report**, incluso il filtro per utente (vedi sopra).
5. **Passata 5 — scenario tracciato a mano: scorciatoia dal Calendario a Sessioni**, con verifica esplicita dell'ordine "popola opzioni → applica preset" anche alla primissima apertura della tab (vedi sopra).
6. **Passata 6 — verifica che la lista opzionale non comprometta il comportamento esistente**: riletto `tryResolveLists()` riga per riga — per le sei liste già richieste, il comportamento (fallimento se una manca) è identico a prima; solo la lista elencata in `CFG.listeOpzionali` ha il nuovo ramo. Riletto `loadAll()`: il caricamento di `report` è condizionato su `state.listIds.report`, con fallback a `[]` sia se la lista non è risolta sia se il caricamento fallisce per un altro motivo — nessun percorso porta a un'eccezione non gestita che blocchi il resto di `loadAll()`.
7. **Passata 7 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (S2/S3 marcate ✅ Implementato con il dettaglio tecnico, Architecture punto 3 corretto), `CONTESTO.md` (Cronologia voce 31, Backlog voce 21/Ciclo E, Registro delle decisioni voci 40-45 nuove + voce 17 chiusa) e questo file descrivono la stessa implementazione con gli stessi nomi di funzione; nessuna incongruenza trovata oltre a quella già segnalata e corretta sopra.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* la nota correttiva preliminare sulla data di completamento del Ciclo D (17/07→20/07, con nuova regola permanente "data di completamento = data del commit") — applicata prima di iniziare S2/S3, vedi Registro delle decisioni voce 39 in `CONTESTO.md` e nuova regola (e) in `CLAUDE.md`, sezione "Prassi di chiusura ciclo".

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 40-45 (lista `Gestionale_Report` opzionale/non bloccante; riepilogo condiviso fra Sessioni e Calendario; scorciatoia agganciata al pannello di riepilogo del Calendario; filtro per utente limitato alla sola sezione utenti/progetti del report; `persistReport` senza `await`; filtri utente non limitati agli "attivi").

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| Nota corr. | Data di completamento Ciclo D = commit (20/07), non definizione specifica (17/07) | ✅ Fatto | Corretta Cronologia/Backlog/Registro decisioni; nuova regola permanente in `CLAUDE.md` |
| S2.1 | Filtro a cascata utente→progetto in Sessioni e Calendario | ✅ Fatto | `sess-f-utente`/`sess-f-progetto`, `cal-f-utente`/`cal-f-progetto` |
| S2.2 | Riepilogo per progetto: sessioni per stato, monte ore h:mm erogato/residuo | ✅ Fatto | `renderRiepilogoUtente`, condivisa fra le due viste |
| S2.3 | Scorciatoia dal Ciclo D agganciata al Calendario | ✅ Fatto | `vaiASessioniPerUtente`, dal pannello di riepilogo |
| S3.4 | Lista `Gestionale_Report`, un record per generazione con dettaglio completo | ✅ Fatto | Lista da creare su SharePoint (vedi avviso), codice pronto e non bloccante nel frattempo |
| S3.5 | UI in Genera, "Report precedenti", apribili, filtrabili per utente | ✅ Fatto | Decisione UI del 17/07 chiusa; stessa vista `openGenReport` riusata |
| S3.6 | Salvataggio automatico; revisione contenuto report fuori ambito | ✅ Fatto | `persistReport` automatico; nessuna modifica al contenuto oltre al filtro |
| Verifica | Multi-passata (min. 4, incl. `node check-sintassi.js`, cascata multi-progetto, salvataggio/riapertura report, scorciatoia dal Calendario) | ✅ Fatto | 7 passate |

**Cosa manca**: nessuna lacuna sui punti richiesti. **Azione da completare fuori da questo file**: creazione della lista SharePoint `Gestionale_Report` (vedi avviso in apertura) — finché non esiste, S3 resta con lo storico non attivo ma senza alcun impatto sul resto dell'app. Non eseguibile in questo ambiente (nessun login M365/browser reale): il test dal vivo dei tre scenari tracciati a mano sopra (cascata, salvataggio/riapertura report, scorciatoia) — raccomandato a Simone come primo collaudo dopo il deploy, insieme alla creazione della lista `Gestionale_Report` per poter verificare anche il salvataggio reale.

## Limiti di questa verifica
`check-sintassi.js` verifica sintassi reale e le 2 nuove funzioni pure con casi concreti. Il resto della logica di questo ciclo (cascata di filtri, riepilogo, persistenza su SharePoint, risoluzione lista opzionale) è profondamente legato a `state`/DOM/Graph e non è extraibile in una sandbox Node: tutti gli scenari sopra sono stati tracciati a mano leggendo il codice reale riga per riga con valori concreti, non osservati in esecuzione. In particolare, il comportamento di `tryResolveLists()` con la lista `Gestionale_Report` realmente assente su SharePoint non è stato osservato dal vivo (richiederebbe un ambiente con login M365 su un sito SharePoint reale, non disponibile qui) — raccomandato come primo test dopo il deploy, prima ancora di creare la lista, per confermare che l'app si comporti normalmente anche senza.

---

# Verifica — Ciclo E.1: HOTFIX (proposte non eliminate, report più robusto, cascata in Genera)

Data: 2026-07-20. Tre correzioni emerse dal primo collaudo di generazione di Simone con dati reali.

## FIX 1 — Le proposte sostituite non venivano mai eliminate da SharePoint (BUG GRAVE)

**Cosa è stato fatto**:
- **Diagnosi confermata leggendo il codice riga per riga**: in `generateMonth` e `generateMonthAI`, la riga finale `state.data.sessioni=keep;` sostituiva SOLO la variabile locale in memoria — nessuna chiamata a `deleteRecord` per le vecchie sessioni `proposta` in ambito che il run stava sostituendo. Quei record restavano sulla lista SharePoint `Gestionale_Sessioni`; al prossimo `loadAll()` (ricarica pagina, nuovo login) tornavano a far parte di `state.data.sessioni`, comparendo come sessioni duplicate accanto a quelle appena create (id diversi, stesso slot logico).
- **Nuova funzione pura `proposteDaSostituire(sessioni,ms,scopeIds)`**: stessa identica condizione di `sessioniDaConservare` (`s.data.startsWith(ms)&&s.stato==='proposta'&&scopeIds.has(s.progettoId)`), **non negata** — il complemento esatto, non un'approssimazione. Presa come parametro esplicito (non letta da `state.data.sessioni` internamente) per restare testabile in isolamento.
- **Entrambi i percorsi di generazione** (`generateMonth`, riga della Passata 2 finale; `generateMonthAI`, subito dopo `risolviOnlineDaCasa`): calcolano `daEliminare=proposteDaSostituire(state.data.sessioni,ms,scopeIds)` e le eliminano da SharePoint con `deleteRecord` **prima** di eseguire `state.data.sessioni=keep` e il ciclo di `saveRecord` per le nuove sessioni. Se una `deleteRecord` fallisce, viene lanciato un `Error` che interrompe immediatamente la funzione — **nessuna nuova sessione viene salvata** in quel caso, per non creare i duplicati che il fix esiste per evitare. L'errore risale al gestore del click (`try/catch` già esistente su entrambi i pulsanti "Genera") e appare come banner "Errore: ...", stesso canale già usato per ogni altro fallimento della generazione.
- **Nessun rollback delle eliminazioni già riuscite in caso di fallimento a metà** (scelta esplicita, vedi `CONTESTO.md`, Registro delle decisioni, voce 46): `deleteRecord` aggiorna `state.data.sessioni` a ogni successo, quindi un tentativo successivo dello stesso run ricalcola naturalmente un `daEliminare` più piccolo (solo i residui non ancora eliminati) — converge da solo, senza bisogno di ricreare record già correttamente rimossi.
- **Riuso in "🗑 Svuota proposte del mese"**: quel pulsante calcolava già inline la stessa identica condizione con un filtro separato — sostituito con una chiamata a `proposteDaSostituire`, eliminando una duplicazione pre-esistente (non richiesto esplicitamente dal prompt, ma occasione naturale trovata durante il fix, per non lasciare la stessa regola scritta in tre punti diversi che potrebbero disallinearsi in futuro).
- **Nota di fedeltà richiesta dal prompt** ("probabile residuo dell'era localStorage, documentalo") — **verificato con la cronologia git, con un esito più preciso e più interessante dell'ipotesi originale**: un'era `localStorage` è realmente esistita in questo repository. Il primo commit che introduce `index.html` (7944aa8, 07/07/2026) usa davvero `localStorage.setItem('csdc:'+k,...)` per la persistenza (3 occorrenze, commento nel codice: "salvataggio immediato ad ogni modifica" — coerente con un modello dove riassegnare l'intero oggetto in memoria **è** l'intero passo di persistenza, nessun bug possibile in quel modello). La migrazione a SharePoint via Microsoft Graph è avvenuta il giorno dopo (prima occorrenza di `graph.microsoft.com` nel commit 3b7d29f, 08/07/2026). **Ma**: `generateMonth` non esiste ancora in nessuno dei due commit del 07-08/07 — è stata scritta successivamente (con tutta probabilità nel ciclo "Blocco C: architettura a tre passate" del 13/07, documentato in `CONTESTO.md`), cioè **dopo** che l'app era già passata a SharePoint. Il bug non è quindi un letterale "leftover" di codice mai aggiornato dall'era localStorage (quel codice specifico non è mai esistito prima della migrazione), ma verosimilmente un **disallineamento tra modello mentale e persistenza reale**: chi ha scritto `generateMonth` ha probabilmente ragionato nei termini più semplici ("sostituisci l'elenco delle sessioni") legittimi per un'app che tiene tutto in un unico oggetto in memoria — un'abitudine plausibilmente ereditata dal periodo, brevissimo ma reale, in cui l'app lo era — senza portare fino in fondo la conseguenza che, sotto SharePoint, "sostituire l'elenco" richiede un'eliminazione esplicita per ogni record che non fa più parte del nuovo elenco. Corretta quindi l'ipotesi dal prompt (non un "residuo di codice", ma un'abitudine di modello mentale coerente con quel periodo) invece di lasciarla passare come accertata senza verifica.

| Parte | Stato |
|---|---|
| Diagnosi confermata (nessuna `deleteRecord` sulle proposte sostituite) | ✅ Confermata leggendo il codice |
| `proposteDaSostituire` — funzione pura, complemento esatto di `sessioniDaConservare` | ✅ Fatto |
| `generateMonth`: elimina prima di salvare, con interruzione su fallimento | ✅ Fatto |
| `generateMonthAI`: stesso fix | ✅ Fatto |
| Test funzionale incluso lo scenario "seconda generazione = zero zombie" | ✅ Fatto (`check-sintassi.js`) |
| Documentata l'ipotesi "residuo dell'era localStorage" | ✅ Fatto, esplicitamente come ipotesi non accertata |
| Riuso in "Svuota proposte del mese" (bonus, non richiesto) | ✅ Fatto |

### Scenario tracciato a mano: genera → ricarica → rigenera → nessun duplicato

**Stato iniziale**: progetto "BrainRx, cliente Rossi" (`pA`), nessuna sessione. Admin genera per "2026-08": `generateMonth('2026-08',pA,null)` piazza 2 sessioni `newS=[n1,n2]` (entrambe `proposta`, `progettoId:pA`). `keep` (calcolato all'inizio della funzione, su `state.data.sessioni` allora vuoto) è `[]`. Al punto del fix: `daEliminare=proposteDaSostituire([],'2026-08',{pA})=[]` (niente da eliminare, prima generazione) — nessuna `deleteRecord` chiamata. `state.data.sessioni=[]`; poi `n1`,`n2` salvate con `saveRecord`, che le aggiunge a `state.data.sessioni` (side-effect già esistente di `saveRecord`, non toccato da questo fix). Stato finale in memoria e su SharePoint: `[n1,n2]`. Coerente, nessuna differenza dal comportamento pre-fix in questo primo giro (il bug si manifesta solo alla **seconda** generazione).

**Ricarica pagina**: `loadAll()` rilegge `Gestionale_Sessioni` da SharePoint — `state.data.sessioni=[n1,n2]` (corretto: solo le 2 sessioni realmente esistenti, perché il fix le aveva salvate correttamente e non ne aveva lasciate altre indietro).

**Rigenerazione** (stesso progetto, stesso mese, es. per applicare una disponibilità aggiornata): `generateMonth('2026-08',pA,null)` di nuovo. `keep=sessioniDaConservare('2026-08',{pA})` — se `n1`/`n2` sono ancora `proposta` (non confermate nel frattempo), `keep=[]` (esclude entrambe, come sempre). L'algoritmo piazza `newS=[n3,n4]` (nuove sessioni, id diversi da n1/n2). **Punto critico**: `daEliminare=proposteDaSostituire([n1,n2],'2026-08',{pA})=[n1,n2]` — **questa volta trova le due sessioni della generazione precedente** (a differenza del primo giro, dove non c'era nulla da trovare). Vengono eliminate da SharePoint con `deleteRecord` (2 chiamate, entrambe riuscite in questo scenario). Solo dopo, `state.data.sessioni=keep=[]`, poi `n3`,`n4` salvate. **Stato finale**: `[n3,n4]`, esattamente 2 sessioni — non 4. Se il fix non ci fosse (comportamento pre-20/07): `daEliminare` non sarebbe mai stato calcolato/eliminato, `n1` e `n2` sarebbero rimaste su SharePoint (semplicemente "dimenticate" dalla variabile locale ma non dal server), e alla **prossima ricarica** `loadAll()` le avrebbe ripescate insieme a `n3`/`n4`: **4 sessioni per una richiesta di 2** — esattamente il bug segnalato da Simone.

### Scenario tracciato a mano: fallimento di un'eliminazione a metà rigenerazione

Stesso stato di partenza `[n1,n2]` (entrambe `proposta`, progetto `pA`). Rigenerazione: `daEliminare=[n1,n2]`. Il loop tenta `deleteRecord('sessioni',n1)` → riesce (SharePoint conferma, `state.data.sessioni` diventa `[n2]` per il side-effect di `deleteRecord`). Poi tenta `deleteRecord('sessioni',n2)` → **fallisce** (es. errore di rete transitorio). Il `catch` lancia un nuovo `Error` con un messaggio esplicito; la funzione `generateMonth` si interrompe **immediatamente** — `state.data.sessioni` resta `[n2]` (non ancora `keep`), nessuna `newS` viene salvata. Il gestore del click mostra il banner d'errore. Admin riprova: nuova chiamata a `generateMonth`. Questa volta `sessioniDaConservare`/`daEliminare` vengono ricalcolati da `state.data.sessioni=[n2]` (non più `[n1,n2]`, perché `n1` è stata davvero eliminata al tentativo precedente): `daEliminare=[n2]` — un solo elemento, non due. Il secondo tentativo elimina `n2` e procede normalmente. **Nessun duplicato, nessuna eliminazione ripetuta di `n1`** (che non esiste più, né nell'array né su SharePoint): il sistema converge da solo senza bisogno di logica di rollback, confermando la decisione presa (Registro delle decisioni, voce 46).

---

## FIX 2 — Report storico più robusto (ritentativo di risoluzione lista)

**Cosa è stato fatto**: `persistReport(report)` ora, se `state.listIds.report` non è definito, ritenta `tryResolveLists(state.siteId)` (la stessa funzione usata al login) prima di arrendersi. Se questo ritentativo trova finalmente la lista `Gestionale_Report` (creata da Simone su SharePoint dopo che la pagina era già stata caricata), viene anche eseguito `loadListRecords('report')` per recuperare lo storico eventualmente già presente — senza questo passaggio aggiuntivo, "Report precedenti" avrebbe mostrato solo la generazione di adesso, non un vero storico, finché qualcuno non avesse ricaricato la pagina (Registro delle decisioni, voce 48). Solo se la lista resta assente anche dopo il ritentativo, la funzione salta con lo stesso comportamento silenzioso di prima.

| Parte | Stato |
|---|---|
| Ritentativo di `tryResolveLists()` se la lista non è risolta | ✅ Fatto |
| Recupero dello storico esistente se risolta solo ora | ✅ Fatto (bonus, coerente con lo scopo del ritentativo) |
| Nessun impatto se la lista resta assente | ✅ Verificato — stesso comportamento silenzioso di prima |

### Scenario tracciato a mano

Admin ha caricato "Genera" prima che Simone creasse `Gestionale_Report` su SharePoint: `state.listIds.report` è `undefined`, "Report precedenti" mostra l'avviso. Simone crea la lista nel frattempo (stessa sessione browser di Admin, nessun ricaricamento). Admin genera un calendario: `persistReport(res.report)` trova `state.listIds.report` ancora `undefined` → chiama `tryResolveLists(state.siteId)`; questa volta la lista esiste → la funzione restituisce `true` e popola `state.listIds` (incluso `report`, ora trovato). Il codice prosegue: `state.listIds.report` è ora valorizzato → `state.data.report=await loadListRecords('report')` (in questo caso probabilmente `[]`, essendo una lista appena creata, ma il codice lo gestirebbe comunque correttamente se non lo fosse) → si procede al salvataggio del report appena prodotto e a `renderReportStorico()`. Alla generazione successiva, `state.listIds.report` è già valorizzato dal giro precedente: il ramo di ritentativo non viene nemmeno eseguito (`if(!state.listIds.report&&...)` è falso), comportamento identico a se la lista fosse sempre esistita.

---

## FIX 3 — Cascata utente→progetto nella pagina Genera

**Cosa è stato fatto**: nel campo "Ambito" = "Singolo progetto", aggiunta una tendina "Utente" (`gen-utente-sel`) prima di "Progetto": selezionato un utente, `#gen-proj-sel` mostra solo i suoi progetti attivi (stesso pattern di `sess-f-utente`/`sess-f-progetto` e `cal-f-utente`/`cal-f-progetto`, S2). **Nessuna modifica ai tre punti che leggono `$('#gen-proj-sel').value`** (i due generatori e "Svuota proposte del mese"): l'id e il significato della tendina progetti restano identici, cambia solo quali opzioni vengono proposte (Registro delle decisioni, voce 49).

| Parte | Stato |
|---|---|
| Cascata utente→progetto in Ambito "Singolo progetto" | ✅ Fatto (`gen-utente-sel`) |
| Nessuna modifica necessaria ai punti che leggono `#gen-proj-sel` | ✅ Verificato |
| Selezione utente/progetto preservata tra re-render (stesso meccanismo di S2) | ✅ Fatto |

## Estensione di `check-sintassi.js`

Aggiunta `proposteDaSostituire` alle funzioni estratte. 4 nuovi casi (69→73 totali): selezione corretta di proposta+in ambito+nel mese con quattro casi limite nella stessa asserzione (confermata nello stesso progetto/mese, proposta fuori ambito, proposta in ambito ma mese diverso), verifica di copertura totale/nessuna sovrapposizione col complemento, e lo scenario esplicito "seconda generazione = zero zombie" (una confermata mai toccata + due proposte del "run 1" — verificato che vengano individuate esattamente, senza residui né omissioni).

## Metodo di verifica: multi-passata

1. **Passata 1 — `node check-sintassi.js`**: 3 blocchi `<script>` OK; 73 test funzionali (69 preesistenti + 4 nuovi) — **tutti passano**.
2. **Passata 2 — verifica punto per punto del prompt** (FIX 1, FIX 2, FIX 3): vedi tabelle sopra.
3. **Passata 3 — scenario tracciato a mano: genera → ricarica → rigenera → nessun duplicato** (FIX 1, il caso esplicitamente richiesto dalla verifica): vedi sopra, con il confronto esplicito fra comportamento pre-fix (4 sessioni per 2 richieste) e post-fix (2 sessioni).
4. **Passata 4 — scenario tracciato a mano: fallimento di un'eliminazione a metà rigenerazione** (FIX 1, robustezza): vedi sopra, verificata la convergenza senza rollback.
5. **Passata 5 — scenario tracciato a mano: ritentativo di risoluzione lista report** (FIX 2): vedi sopra.
6. **Passata 6 — nessuna regressione sui cicli precedenti**: riletti `sessioniDaConservare`, `risolviOnlineDaCasa`, la Passata 3 di `generateMonth` — nessuno di questi punti è stato toccato dal fix, solo il punto di salvataggio finale; i 69 test preesistenti restano invariati e passano. Verificato che il nuovo blocco di eliminazione si trovi **dopo** la Passata 3/Passata 2 (quindi non interferisce con la logica di piazzamento/riparazione, che continua a leggere `keep` come vincolo attivo per tutta la durata dell'algoritmo) e **prima** di `state.data.sessioni=keep` (quindi `daEliminare` è calcolato sull'array ancora integro, con la stessa base usata per `keep`).
7. **Passata 7 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (Architecture punto 8/Scheduling engine corretto con la cronologia del bug; S2/S3 aggiornate con i tre FIX), `CONTESTO.md` (Cronologia voce 32, Registro delle decisioni voci 46-49) e questo file descrivono la stessa implementazione con gli stessi nomi di funzione; nessuna incongruenza trovata.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (tre fix con specifica tecnica, incluso il nome suggerito `proposteDaSostituire` per FIX 1) conteneva già tutto il necessario.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 46-49 (nessun rollback delle eliminazioni riuscite; riuso di `proposteDaSostituire` in "Svuota proposte del mese"; ricaricamento dello storico esistente al momento della risoluzione tardiva; `#gen-proj-sel` invariato nell'id/comportamento).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| FIX 1 | Eliminare da SharePoint le proposte sostituite prima di salvare le nuove, funzione pura, test incluso "zero zombie", interrompere se un'eliminazione fallisce, documentare l'ipotesi localStorage | ✅ Fatto | `proposteDaSostituire`, entrambi i generatori, nessun salvataggio se l'eliminazione fallisce |
| FIX 2 | Ritentare la risoluzione della lista report prima di arrendersi | ✅ Fatto | `persistReport`, con recupero dello storico se risolta solo ora |
| FIX 3 | Cascata utente→progetto anche in Genera, Ambito "Singolo progetto" | ✅ Fatto | `gen-utente-sel`, nessuna modifica ai punti che leggono `#gen-proj-sel` |
| Verifica | Multi-passata (min. 4, incl. `node check-sintassi.js`, scenario genera→ricarica→rigenera→nessun duplicato) | ✅ Fatto | 7 passate |

**Cosa manca**: nessuna lacuna sui punti richiesti. Non eseguibile in questo ambiente (nessun login M365/browser reale): il test dal vivo dello scenario completo — generare, ricaricare la pagina, rigenerare lo stesso mese/progetto, verificare che il numero di sessioni non raddoppi — è il collaudo più importante da fare per primo dopo il deploy, dato che verifica esattamente il bug segnalato da Simone. Raccomandato anche un controllo diretto su SharePoint (lista `Gestionale_Sessioni`) per confermare che le vecchie proposte siano davvero scomparse dalla lista, non solo dalla vista dell'app.

## Limiti di questa verifica
`check-sintassi.js` verifica la logica di selezione (`proposteDaSostituire`) con casi concreti, incluso lo scenario a due generazioni richiesto — un livello di garanzia comportamentale genuino sulla funzione pura. Non è stato invece possibile eseguire dal vivo l'intera `generateMonth`/`generateMonthAI` con vere chiamate `deleteRecord`/`saveRecord` verso Microsoft Graph (richiede login M365 su un sito SharePoint reale, non disponibile in questo ambiente): gli scenari "genera→ricarica→rigenera" e "fallimento a metà" sopra sono stati tracciati a mano riga per riga sul codice reale con valori concreti, non osservati in esecuzione. Si raccomanda il test manuale descritto nella sezione precedente come priorità del prossimo collaudo, essendo la correzione di un bug che produceva dati duplicati reali.

---

# Verifica — Ciclo E.2: diagnosi "report non persistiti" (caso prioritario segnalato da Simone dal vivo)

Data: 2026-07-20. Richiesta esplicita: diagnosticare l'intero percorso end-to-end e riferire i risultati **prima** di correggere in autonomia.

## Diagnosi punto per punto (come richiesto dal prompt)

**a) `persistReport` costruisce il record e chiama `saveRecord('report',rec)`: il record arriva davvero a una scrittura Graph? L'errore è silenziato da un catch?**

**Sì, il catch nasconde davvero un possibile errore reale.** Letto `gfetch` (la funzione HTTP di base usata da ogni chiamata Graph): su risposta non-OK lancia `throw new Error('Graph '+res.status+': '+(body?.error?.message||res.statusText))` — un errore con un messaggio diagnostico reale (codice di stato + messaggio di Graph). Questo errore risale attraverso `saveRecord` (che non lo intercetta) fino a `persistReport`, dove **prima di questo ciclo** veniva intercettato con `try{await saveRecord('report',rec);}catch(e){console.warn('Salvataggio report saltato:',e);}` — **solo `console.warn`, mai mostrato a schermo**. Simone non apre mai la console del browser: se ogni tentativo di salvataggio fallisse silenziosamente da settimane, il sintomo osservato ("il report compare subito ma sparisce dopo il ricaricamento") sarebbe **esattamente** quello segnalato, senza alcun indizio visibile della causa reale. Lo stesso identico schema (catch con solo `console.warn`) esisteva anche nel caricamento in `loadAll()` e nel ritentativo tardivo in `persistReport` (Ciclo E.1) — tre punti, non uno solo, dove un errore reale sarebbe stato invisibile.

**b) `saveRecord` tratta `'report'` come array o come oggetto singolo?**

Prima di questo ciclo: `const arr=state.data[key];const isArray=Array.isArray(arr);` — la decisione dipendeva da **cosa si trova in quel momento** in `state.data.report`, non da un elenco esplicito di cosa quella lista *sia*. Verificato che, nel flusso normale, `state.data.report` è sempre inizializzato come array da `loadAll()` (riga per riga: il ramo che gestisce `report` imposta sempre `state.data.report=await loadListRecords(...)` — che restituisce sempre un array — oppure `state.data.report=[]`, mai lasciato `undefined`) **prima** di qualunque chiamata a `saveRecord('report',...)` nel ciclo di vita normale dell'app. Quindi **questo difetto da solo non spiega il sintomo esatto segnalato da Simone** (il caso "già esistente su SharePoint al login" esclude il ramo di ritentativo tardivo dove la popolazione potrebbe essere più fragile) — ma resta comunque un difetto strutturale reale, esattamente come descritto nella richiesta ("non deve dipendere da come/quando la lista è stata creata"): corretto comunque, come richiesto esplicitamente, indipendentemente dall'esito della diagnosi.

**c) Al caricamento, `'report'` viene letta con `loadListRecords` come le altre liste-array, o gestita come record singolo?**

Come le altre liste-array — stesso trattamento di `operatori`/`utenti`/`progetti`/`sessioni` in `loadAll()`, corretto. **Ma soffre dello stesso problema di (a)**: se `loadListRecords('report')` lancia un'eccezione (es. perché la colonna attesa non esiste con quel nome — vedi punto d), il catch di `loadAll()` la logga solo con `console.warn` e imposta `state.data.report=[]` — **indistinguibile, a schermo, da "nessuna generazione ancora fatta"**. Questo è un secondo possibile punto di fallimento silenzioso, completamente indipendente da (a): anche se il salvataggio fosse riuscito perfettamente, un fallimento del *caricamento* produrrebbe lo stesso identico sintomo (storico apparentemente vuoto dopo il ricaricamento).

**d) La colonna su SharePoint è "Data" (maiuscola) come si aspetta `saveRecord`?**

**Non verificabile da questo ambiente** (nessun accesso al tenant SharePoint reale di Simone). Combinando (a)+(c)+la dimensione tipica di un report rispetto a una sessione/progetto, la mia ipotesi principale è che **la colonna "Data" della nuova lista sia di tipo "Una sola riga di testo"** (limite tipico ~255 caratteri in SharePoint) invece di "Più righe di testo" come le altre sei liste: un report include `utenti`/`progetti`/`settimane` annidati, `mosseRiparazione`, `suggerimenti*`, `metriche` — un JSON facilmente molto più grande di 255 caratteri, che Graph rifiuterebbe con un errore 400 alla scrittura (spiegherebbe (a)) mentre la lettura (c) potrebbe comunque non fallire (il campo esisterebbe, solo troncato o mai valorizzato con successo). Ipotesi alternativa, meno probabile ma plausibile: il **nome interno** della colonna non corrisponde esattamente a `Data` — capita in SharePoint se una colonna viene rinominata dopo la creazione (il nome interno resta quello scelto alla creazione, anche se il nome visualizzato cambia), nel qual caso sia la scrittura (POST con `fields:{Data:...}`) sia la lettura (`$select=Title,Data`) fallirebbero con un errore di campo non riconosciuto. **Non è possibile distinguere con certezza le due ipotesi senza vedere il messaggio d'errore reale di Graph — che prima di questo ciclo era invisibile.**

## Correzione applicata (diagnosi + correzione di fondo)

Invece di scegliere alla cieca una delle due ipotesi in (d) e "correggerla" (rischiando di non risolvere nulla se sbagliata — Registro delle decisioni, voce 50), ho reso l'errore reale visibile: al prossimo tentativo, il messaggio esatto di Graph confermerà quale delle due ipotesi (o un'altra ancora) è quella giusta, permettendo una correzione mirata.

- **`state.reportErrore`** (nuovo campo di stato): valorizzato con `e.message` ogni volta che il caricamento (`loadAll`, sia al login sia nel ritentativo tardivo di `persistReport`) o il salvataggio (`persistReport`) di `'report'` falliscono; azzerato a `null` a ogni successo.
- **`renderReportStorico()`** ora distingue esplicitamente tre stati, prima confusi in due: (1) lista non risolta → invito a crearla (invariato); (2) lista risolta ma `state.reportErrore` valorizzato → **nuovo** banner di avviso col messaggio esatto di Graph e le due ipotesi principali elencate come suggerimento diagnostico; (3) nessun errore, storico vuoto → messaggio "Nessun report salvato finora" (invariato, ma ora genuinamente corretto: prima veniva mostrato anche nel caso (2), un'affermazione falsa quando in realtà il caricamento/salvataggio falliva silenziosamente).
- **Correzione di fondo (b/c)**: nuova costante esplicita `LISTE_RECORD_SINGOLO=['chiusure','impostazioni']` e funzione `isRecordSingolo(key)`; `saveRecord()` ora decide array-vs-record-singolo da questo elenco fisso, non da `Array.isArray(state.data[key])` a runtime. Aggiunta anche un'inizializzazione difensiva (`if(!isRecordSingolo(key)&&!Array.isArray(state.data[key]))state.data[key]=[];`): se una lista-array non fosse ancora inizializzata al momento del salvataggio, viene creata come array invece di cadere silenziosamente nel ramo "record singolo".

| Punto della diagnosi | Esito |
|---|---|
| a) Catch che nasconde un errore reale | ✅ Confermato — 3 punti (persistReport save, persistReport retry-load, loadAll load), tutti corretti per renderlo visibile |
| b) Array-vs-oggetto per `report` | ⚠️ Non spiega da solo il sintomo esatto nel flusso normale, ma difetto strutturale reale — corretto come richiesto |
| c) Caricamento `report` come le altre liste-array | ✅ Confermato corretto, ma soggetto allo stesso problema di (a) — corretto |
| d) Colonna "Data" su SharePoint | ⚠️ Non verificabile da qui — due ipotesi documentate, il prossimo tentativo rivelerà quale |
| Correzione di fondo (array-vs-oggetto da elenco esplicito) | ✅ Fatto (`isRecordSingolo`/`LISTE_RECORD_SINGOLO`) |
| Errore reale visibile invece di solo `console.warn` | ✅ Fatto (`state.reportErrore`, banner in "Report precedenti") |

### Scenario tracciato a mano: il prossimo tentativo dopo questo fix

Simone genera un calendario. `persistReport(res.report)` chiama `saveRecord('report',rec)`. **Ipotesi A (colonna a riga singola)**: Graph rifiuta la POST con un 400, es. `Error("Graph 400: ...")`; il catch imposta `state.reportErrore="Graph 400: ..."`; `renderReportStorico()` mostra il banner con quel messaggio esatto e le due ipotesi. Simone (o chi legge lo schermo con lui) può ora leggere il messaggio e confermarlo/riportarlo. **Ipotesi B (colonna letta correttamente, tutto ok)**: `saveRecord` completa senza eccezioni, `state.reportErrore=null`, il record compare nella tabella "Report precedenti" **anche dopo un ricaricamento della pagina** (perché `loadAll()` lo ritrova via `loadListRecords('report')` al prossimo login) — il bug sarebbe quindi risolto, e lo si vedrebbe subito dal comportamento, non solo dall'assenza di errori.

## Estensione di `check-sintassi.js`

Aggiunta `isRecordSingolo` (e la costante `LISTE_RECORD_SINGOLO`) alle funzioni/costanti estratte. 8 nuovi casi (73→81 totali): le due liste a record singolo (`chiusure`, `impostazioni` → `true`), le cinque liste-array esistenti (`report`, `sessioni`, `operatori`, `utenti`, `progetti` → `false`) e una chiave sconosciuta/futura (→ `false` per default, mai "record singolo per errore").

## Metodo di verifica: multi-passata

1. **Passata 1 — `node check-sintassi.js`**: 3 blocchi `<script>` OK; 81 test funzionali (73 preesistenti + 8 nuovi) — **tutti passano**.
2. **Passata 2 — diagnosi punto per punto del prompt** (a-d): vedi sezione dedicata sopra, con citazione diretta del codice (`gfetch`, `saveRecord`, `loadAll`, `persistReport`) per ciascun punto.
3. **Passata 3 — scenario tracciato a mano: i due esiti possibili del prossimo tentativo** (ipotesi A confermata vs. bug già risolto): vedi sopra.
4. **Passata 4 — verifica che `renderReportStorico()` non confonda più i tre stati**: riletta la funzione riga per riga — l'ordine dei tre `if` (lista non risolta → errore presente → storico vuoto) garantisce che ciascuno stato produca un messaggio distinto e mai lo stato sbagliato (es. un errore non può più essere scambiato per "storico vuoto", perché il controllo su `state.reportErrore` precede quello sulla lunghezza dell'elenco).
5. **Passata 5 — nessuna regressione sui percorsi già corretti nei cicli E/E.1**: verificato che `proposteDaSostituire`, la cascata utente→progetto (Sessioni/Calendario/Genera) e il resto della logica di generazione non siano stati toccati da questo ciclo — solo `saveRecord`, `loadAll` (ramo report) e `persistReport`/`renderReportStorico`; i 73 test preesistenti restano invariati e passano.
6. **Passata 6 — verifica che la correzione di fondo non alteri il comportamento per le liste esistenti**: per `chiusure`/`impostazioni`, `isRecordSingolo(key)` restituisce `true` esattamente come prima restituiva `Array.isArray(state.data[key])===false` (dato che quelle due chiavi in `state.data` sono sempre oggetti, mai array, in ogni punto del codice che le popola — verificato leggendo `loadAll()` e `renderChiusure`/`initImpostazioni`); per tutte le altre chiavi, `isRecordSingolo(key)` restituisce sempre `false`, coerente col comportamento preesistente nel flusso normale (dove quelle liste erano già sempre array). Nessuna differenza di comportamento osservabile per i casi già funzionanti, solo per i casi limite (lista non ancora inizializzata) che prima non erano garantiti.
7. **Passata 7 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (Architecture punto 3 aggiornato con `isRecordSingolo`/`LISTE_RECORD_SINGOLO`; S3 aggiornata con la diagnosi e le due correzioni), `CONTESTO.md` (Cronologia voce 33, Registro delle decisioni voci 50-52) e questo file descrivono la stessa diagnosi e le stesse correzioni con gli stessi nomi di funzione; nessuna incongruenza trovata.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (diagnosi end-to-end su 4 punti espliciti, correzione di fondo con specifica tecnica, "riferisci prima di correggere in autonomia") conteneva già tutto il necessario; la diagnosi stessa è stata riportata per intero nella risposta di chat, non solo qui.

*Domande poste a Simone e risposte ricevute:* nessuna — impossibile porre domande di conferma sulla configurazione reale della lista SharePoint dati i limiti di questo ambiente; la richiesta di verifica è stata girata a Simone tramite il messaggio d'errore ora visibile in "Report precedenti", non tramite una domanda diretta in chat.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 50-52 (errore reale reso visibile invece di indovinare la causa esatta; distinzione esplicita fra "storico vuoto" e "caricamento/salvataggio fallito"; elenco esplicito e fisso per array-vs-record-singolo).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| a | `saveRecord` scrive davvero su Graph? Il catch nasconde un errore? | ✅ Diagnosticato | Confermato: catch con solo `console.warn`, in 3 punti — ora tutti visibili |
| b | Array o oggetto singolo per `report`? | ✅ Diagnosticato | Non spiega da solo il sintomo nel flusso normale, ma corretto comunque come richiesto |
| c | Caricamento come le altre liste-array o come record singolo? | ✅ Diagnosticato | Corretto come le altre, ma stesso problema di (a) — ora corretto |
| d | Colonna "Data" su SharePoint conforme? | ⚠️ Non verificabile da qui | Due ipotesi documentate, errore reale ora visibile per confermarle |
| Correzione di fondo | Array-vs-oggetto da elenco esplicito, non da come/quando creata | ✅ Fatto | `isRecordSingolo`/`LISTE_RECORD_SINGOLO`, con inizializzazione difensiva |
| Verifica | Multi-passata (min. 4, incl. `node check-sintassi.js`) | ✅ Fatto | 7 passate |

**Cosa manca**: il punto (d) resta esplicitamente non risolvibile da questo ambiente — richiede che Simone rigeneri un calendario e legga il messaggio che ora comparirà in "Report precedenti" (se l'errore persiste), oppure verifichi la persistenza corretta (se il fix era sufficiente). **Prossimo passo raccomandato**: dopo il deploy, generare un calendario di prova e controllare "Report precedenti" — se compare un banner d'errore, il messaggio esatto (e le colonne del tipo giusto da verificare su SharePoint) risolveranno definitivamente la diagnosi; se il report compare e sopravvive a un ricaricamento, il problema era esattamente uno dei punti corretti qui.

## Limiti di questa verifica
Questo ciclo è principalmente diagnostico: non è stato possibile eseguire dal vivo alcuna chiamata reale a Microsoft Graph verso il tenant di Simone (nessun accesso in questo ambiente), quindi il punto (d) — la causa ultima del fallimento — resta un'ipotesi, non un fatto accertato. `check-sintassi.js` verifica solo la nuova funzione pura `isRecordSingolo` con casi concreti. Tutto il resto (il comportamento di `saveRecord`/`loadAll`/`persistReport`/`renderReportStorico` di fronte a un vero errore Graph) è stato tracciato a mano leggendo il codice reale riga per riga, non osservato in esecuzione. Si raccomanda esplicitamente che Simone riporti il messaggio esatto che comparirà nel banner d'errore (se compare) per una diagnosi definitiva.

---

# Verifica — Ciclo E.3: etichetta utente/progetto in "Report precedenti"

Data: 2026-07-20. Novità di sola UI (nessun tocco all'algoritmo di generazione né migrazioni), richiesta esplicita.

## Cosa è stato fatto

- **Nuova colonna "Utente/Progetto"** nella tabella "Report precedenti" (`renderReportStorico`), fra "Mese" e "Metodo".
- **Nuova funzione pura `etichettaAmbitoReport(scope,scopeProjects,utenti)`**: se `scopeProjects.length===1` (indipendentemente da quale Ambito fosse selezionato — "Singolo progetto", ma anche "Tutti i progetti attivi" se per caso ne esiste uno solo, o un filtro per nome risolto a un solo risultato) restituisce `"Cognome Nome — NomeProgetto"`; altrimenti, se `scope==='all'`, `"Tutti i progetti"`; altrimenti (filtro per nome con più — o zero — risultati) `"N utenti"` (utenti **distinti**, non progetti — Registro delle decisioni voce 54) o, per zero risultati, `"Nessun progetto in ambito"`. Il conteggio a 1 progetto vince sempre sulla scelta di ambito (Registro delle decisioni, voce 53): descrive cosa è successo davvero in quella generazione, non quale opzione era selezionata nel menu.
- **Calcolo al momento del salvataggio, non propagato dai generatori**: `generateMonth`/`generateMonthAI` calcolano già `scopeProjects` internamente ma non lo restituiscono; invece di cambiare la loro firma di ritorno (avrebbe accoppiato la UI dei report al valore di ritorno dei generatori), i due gestori dei pulsanti "Genera" richiamano una seconda volta `determinaAmbito(spid,projNameFilter)` — con gli **stessi identici argomenti** già usati per la chiamata di generazione appena conclusa, e `state.data.progetti` invariato nel frattempo (nessun `await` fra le due chiamate che potrebbe permettere una modifica) — garantendo lo stesso identico `scopeProjects` che la generazione ha effettivamente usato (Registro delle decisioni, voce 55).
- **`persistReport(report,ambitoLabel)`**: nuovo secondo parametro opzionale; il record salvato include ora `ambitoLabel` (o `null` se non fornito). **Nessuna migrazione dei report già salvati** (come richiesto esplicitamente): quei record non hanno il campo, `renderReportStorico()` mostra `'—'` per loro (`r.ambitoLabel||'—'`).
- **Nessuna modifica al contenuto del report aperto** (`openGenReport`): la colonna nuova vive solo nella tabella riassuntiva di "Report precedenti", non nella vista di dettaglio di un singolo report — coerente con "nessun tocco al contenuto interno, è la revisione già rimandata".

| Parte | Stato |
|---|---|
| Colonna "Utente/Progetto" in "Report precedenti" | ✅ Fatto |
| Etichetta diretta per esattamente 1 progetto, a prescindere dall'ambito scelto | ✅ Fatto (`etichettaAmbitoReport`) |
| Riepilogo sintetico ("Tutti i progetti" / "N utenti") per più progetti, mai un elenco completo | ✅ Fatto |
| Nessuna migrazione dei report esistenti; riepilogo generico (`—`) per quelli | ✅ Fatto |
| Nessun tocco al contenuto interno del report aperto | ✅ Verificato — `openGenReport` invariato |

### Scenario tracciato a mano: i quattro casi di ambito

1. **Ambito "Singolo progetto"**, `spid='pA'` (progetto "BrainRx" di Rossi Anna, `utenteId:'u1'`): `determinaAmbito('pA',null).scopeProjects` → `[pA]` (un solo elemento, per costruzione di `determinaAmbito` quando `spid` è valorizzato). `etichettaAmbitoReport('single',[pA],utenti)` → length===1 → `"Rossi Anna — BrainRx"`.
2. **Ambito "Tutti i progetti attivi"**, 5 progetti attivi di 4 utenti diversi: `scopeProjects.length===5` → non 1 → `scope==='all'` → `"Tutti i progetti"` (non "4 utenti": l'ambito "tutti" ha sempre questa etichetta, indipendentemente da quanti progetti/utenti coinvolge davvero — coerente con la richiesta "riepilogo sintetico tipo... 'Tutti i progetti'" per questo caso specifico).
3. **Ambito "Per nome progetto"**, filtro `"feuerstein"` che risolve a 2 progetti di 2 utenti diversi: `scopeProjects.length===2`, `scope==='byname'` (non `'all'`) → conta utenti distinti: `2` → `"2 utenti"`.
4. **Ambito "Per nome progetto"**, filtro che risolve a 2 progetti **dello stesso utente** (es. "Feuerstein BS1" e "Feuerstein BS2" di Bianchi Mario): `scopeProjects.length===2` → non 1 → `scope!=='all'` → utenti distinti: `new Set(['u2','u2']).size===1` → `"1 utente"` (singolare corretto, non "1 utenti").
5. **Caso limite**: ambito "Tutti i progetti attivi" ma con un solo progetto attivo in quel momento (es. centro appena avviato, un solo cliente): `scopeProjects.length===1` → **vince il ramo "un solo progetto"**, non `scope==='all'` → mostra comunque `"Cognome Nome — NomeProgetto"`, non "Tutti i progetti" (Registro delle decisioni, voce 53 — verificato che l'ordine dei controlli in `etichettaAmbitoReport` metta il check di lunghezza PRIMA del check su `scope`, garantendo questa precedenza).

## Estensione di `check-sintassi.js`

Aggiunta `etichettaAmbitoReport` alle funzioni estratte. 8 nuovi casi (81→89 totali): ambito "single" con un progetto, ambito "byname" risolto a un solo progetto (stessa etichetta diretta, non "1 utente" — verifica esplicita che il tipo di ambito non influenzi questo caso), ambito "all" con più progetti, ambito "all" con un solo progetto attivo (verifica esplicita del caso limite 5 sopra), "byname" con più utenti distinti, "byname" con più progetti dello stesso utente (singolare "1 utente"), "byname" senza risultati, e un progetto con `utenteId` non risolvibile (fallback `"?"`, mai un'eccezione).

## Metodo di verifica: multi-passata

1. **Passata 1 — `node check-sintassi.js`**: 3 blocchi `<script>` OK; 89 test funzionali (81 preesistenti + 8 nuovi) — **tutti passano**.
2. **Passata 2 — verifica punto per punto del prompt**: vedi tabella sopra.
3. **Passata 3 — scenario tracciato a mano sui quattro casi di ambito + il caso limite "tutti con un solo progetto"**: vedi sopra, incluso il caso limite esplicitamente menzionato nella richiesta implicita di "sempre sensata a prescindere dall'ambito".
4. **Passata 4 — verifica che il ricalcolo di `determinaAmbito()` nel gestore del click sia coerente con quello usato dalla generazione**: riletti `generateMonth`/`generateMonthAI` — entrambi chiamano `determinaAmbito(spid,nameFilter)` con gli stessi parametri all'inizio della funzione; il gestore del click li richiama con gli stessi `spid`/`projNameFilter` subito dopo che `await generateMonth(...)`/`await generateMonthAI(...)` si sono risolti, senza alcun `await` intermedio che possa aver modificato `state.data.progetti` — garantendo lo stesso risultato.
5. **Passata 5 — nessuna regressione sui cicli E/E.1/E.2**: verificato che `openGenReport`, `costruisciReportGenerazione`, `proposteDaSostituire`, `isRecordSingolo`, `state.reportErrore` non siano stati toccati da questo ciclo — solo `persistReport` (nuovo parametro opzionale, retrocompatibile: chiamarla senza secondo argomento produce `ambitoLabel:null`, comportamento innocuo), `renderReportStorico` (nuova colonna) e i due gestori dei pulsanti "Genera" (una riga aggiuntiva ciascuno); gli 81 test preesistenti restano invariati e passano.
6. **Passata 6 — verifica retrocompatibilità con i report già salvati (nessuna migrazione)**: un record persistito prima di questo ciclo non ha la proprietà `ambitoLabel` — `r.ambitoLabel||'—'` in `renderReportStorico` gestisce correttamente sia `undefined` sia `null` (entrambi falsy in JavaScript), mostrando `'—'` senza errori né necessità di normalizzare i dati esistenti.
7. **Passata 7 — coerenza incrociata fra le quattro fonti**: `CLAUDE.md` (S3 estesa con la nuova colonna e la funzione), `CONTESTO.md` (Cronologia voce 34, Registro delle decisioni voci 53-55) e questo file descrivono la stessa implementazione con gli stessi nomi di funzione; nessuna incongruenza trovata.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna — il prompt (regola di etichettatura con i due casi espliciti, indicazione di determinare il caso dai dati esistenti o aggiungere un campo di comodo in `persistReport`, nessuna migrazione) conteneva già tutto il necessario.

*Domande poste a Simone e risposte ricevute:* nessuna.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 53-55 (il conteggio vince sempre sull'ambito scelto; "N utenti" conta utenti distinti non progetti; ambito ricalcolato con `determinaAmbito()` invece di propagato dai generatori).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Un solo progetto → "Cognome Nome — NomeProgetto" | ✅ Fatto | Vince sempre sul tipo di ambito scelto |
| 2 | Più progetti → riepilogo sintetico ("N utenti" / "Tutti i progetti"), mai un elenco completo | ✅ Fatto | `scope==='all'` → "Tutti i progetti"; altrimenti "N utenti" (distinti) |
| 3 | Determinare il caso dai dati esistenti; se serve un campo di comodo, aggiungerlo in `persistReport`, nessuna migrazione | ✅ Fatto | `ambitoLabel` opzionale, calcolato al momento e passato a `persistReport` |
| 4 | Nessuna modifica al contenuto interno del report aperto | ✅ Verificato | `openGenReport` invariato |
| Verifica | Multi-passata (min. 4, incl. `node check-sintassi.js`) | ✅ Fatto | 7 passate |

**Cosa manca**: nessuna lacuna sui punti richiesti. Non eseguibile in questo ambiente (nessun login M365/browser reale): il test dal vivo — generare con i tre ambiti diversi (singolo progetto, tutti, per nome con più risultati) e verificare a schermo l'etichetta corretta in "Report precedenti" — raccomandato a Simone come collaudo dopo il deploy, insieme alla verifica visiva che un report salvato prima di questo ciclo mostri "—" senza errori.

## Limiti di questa verifica
`check-sintassi.js` verifica `etichettaAmbitoReport` con casi concreti, incluso il caso limite "ambito tutti con un solo progetto attivo" esplicitamente richiesto dalla logica "sempre sensata a prescindere dall'ambito". Non è stato possibile osservare dal vivo il rendering della nuova colonna in un browser reale, né generare realmente con i tre ambiti per vedere l'etichetta a schermo: il comportamento è stato tracciato a mano leggendo il codice generato riga per riga con valori concreti (i quattro scenari sopra), non osservato in esecuzione. Si raccomanda il test manuale descritto nella sezione precedente dopo il deploy.

---

# Verifica — Chiusura giornata 20/07

Prompt di fine giornata: nessuna modifica al codice, ricostruzione dai dati reali (git log + diff) di tutto il lavoro odierno, verifica multi-passata di coerenza fra le quattro fonti, commit di chiusura.

## Giornata del 20/07: cinque cicli, cinque commit

Ricostruito da `git log`/`git show` (non a memoria) — tutti e cinque i commit odierni:

| Ora | Commit | Ciclo | Sintesi |
|---|---|---|---|
| 09:36 | `7882b19` | D | S9 (campo stato sessione unico) + S1 (eliminazione multipla) |
| 16:13 | `f18e8df` | E | S2 (filtri utente→progetto) + S3 (report persistenti) |
| 17:47 | `426382d` | E.1 | HOTFIX: proposte duplicate (bug grave), report più robusto, cascata in Genera |
| 18:21 | `5e70d60` | E.2 | Diagnosi "report non persistiti" + correzione di fondo (array-vs-oggetto) |
| 18:50 | `28cae1a` | E.3 | Etichetta utente/progetto in "Report precedenti" |

`check-sintassi.js`: 40 test a inizio giornata (eredità del Ciclo C, 17/07) → 89 a fine giornata (+49 nuovi casi su 12 nuove funzioni pure: `statiSelezionabili`, `transizioneAmmessa`, `pesoStato`, `pesoMassimoSelezione`, `riepilogoStati`, `riepilogoStatoProgetto`, `filtraReportUtenti`, `proposteDaSostituire`, `isRecordSingolo`, `etichettaAmbitoReport`, più `fmtDateTime` non estratta perché non pura). Tutti i test passano a fine giornata (verificato con `node check-sintassi.js` prima di questa chiusura).

**Correzione di sequenza propria della giornata**: il Ciclo D era stato inizialmente documentato con data di completamento 17/07 (la data delle specifiche S9/S1), ma il commit reale è di oggi (09:36) — corretto durante il Ciclo E con una nuova regola permanente ("data di completamento = data del commit", `CLAUDE.md` §Prassi di chiusura ciclo, lettera e).

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna oltre al prompt di chiusura giornata stesso, che ha specificato la procedura in 5 passi (ricostruzione e conferma, aggiornamento file, verifica multi-passata, riepilogo e conferma, commit).

*Domande poste a Simone e risposte ricevute:*
- Presentata la ricostruzione dei 5 commit odierni (file per file, per ciascuno dei cicli D/E/E.1/E.2/E.3) → Simone ha risposto "confermo", nessuna correzione richiesta alla ricostruzione.

*Decisioni prese di conseguenza:* nessuna nuova decisione tecnica in questo ciclo di chiusura (è un ciclo puramente documentale/di verifica) — le decisioni della giornata sono già registrate per intero nel Registro delle decisioni (`CONTESTO.md` §7, voci 34-55) durante i cinque cicli stessi; qui in `CONTESTO.md` §9 viene aggiunta solo una sintesi narrativa per cronologia, con rimando alle voci numerate per il dettaglio completo (stesso pattern già in uso per le voci del 16/07/2026 in quella sezione).

## Esito consolidato dei cinque cicli (verificato a fine giornata, non solo riportato)

| Ciclo | Punti richiesti | Esito |
|---|---|---|
| D | S9 (5 punti) + S1 (3 punti) | ✅ Tutti implementati e verificati (7 passate) |
| E | S2 (3 punti) + S3 (3 punti) | ✅ Tutti implementati e verificati (7 passate) |
| E.1 | FIX 1 (bug grave) + FIX 2 + FIX 3 | ✅ Tutti implementati e verificati (7 passate); FIX 1 è la correzione più critica della giornata (duplicazione reale di sessioni) |
| E.2 | Diagnosi a-d + correzione di fondo | ✅ Diagnosi riportata (punto d non verificabile da questo ambiente, richiede il tenant reale); correzione di fondo fatta (7 passate) |
| E.3 | Etichetta ambito in "Report precedenti" | ✅ Implementato e verificato (7 passate) |

**Punti ancora aperti, riportati per completezza** (nessuno bloccante, nessuno di competenza di questo ciclo di chiusura):
- **Azione richiesta a Simone** (Ciclo E): creare su SharePoint la lista `Gestionale_Report` (colonne `Title`+`Data`, tipo "Più righe di testo") se non ancora fatto.
- **Diagnosi aperta** (Ciclo E.2, punto d): il messaggio di errore reale che comparirà in "Report precedenti" al prossimo tentativo di generazione confermerà la causa esatta del problema "report non persistiti" — nessuna azione di codice ulteriore possibile da qui finché quel messaggio non è noto.
- **Collaudo dal vivo** (tutti i cicli di oggi): nessuno dei cinque cicli è stato eseguito in un browser reale con login M365 (limite dell'ambiente, non della verifica) — il test più urgente resta lo scenario "genera → ricarica → rigenera → nessun duplicato" del Ciclo E.1, che verifica un bug che produceva dati duplicati reali.

## Metodo di verifica: multi-passata (chiusura giornata)

Vedi la sezione "Verifica multi-passata di chiusura giornata" più sotto in questo stesso ciclo (dopo l'aggiornamento di `CONTESTO.md`) per le passate dedicate al controllo incrociato delle quattro fonti.

---

# Verifica — Ciclo H: Unificazione UI Chiusure + Impostazioni

Data: 2026-07-21. Richiesta a sé di Simone (non una delle 11 specifiche S1-S11), fuori sequenza rispetto ai cicli F/G ancora da fare — da qui la lettera H. Solo interfaccia: nessun tocco all'algoritmo di generazione, agli stati sessione, alle liste SharePoint; nessuna migrazione dati.

## Cosa è stato fatto

**Parte 1 — Menu a discesa:**
- `TABS.Admin` non ha più una voce `chiusure` separata: l'entry `impostazioni` porta ora un campo `children:[{id:'impostazioni',...},{id:'chiusure',...}]`.
- `buildNav()` distingue le entry con `children`: per queste crea un wrapper `.nav-drop` con un pulsante padre `.nav-drop-toggle` e un pannello `.nav-drop-menu` con un pulsante per figlio; le entry senza `children` sono renderizzate esattamente come prima (nessuna regressione per `TABS.Operatore`, che non ha entry con figli).
- **Apertura su hover** (desktop/dispositivi con puntatore): CSS `@media (hover:hover){.nav-drop:hover>.nav-drop-menu{display:flex}}` — gated dietro la media query, non scatta su touch.
- **Apertura su click/tap** (necessaria su mobile, dove l'hover non esiste): il pulsante padre, al click, alterna una classe `.open` sul wrapper (`.nav-drop.open>.nav-drop-menu{display:flex}`); un click sui pulsanti figli chiude sempre il menu e naviga (`showTab`). Un listener `click` a livello di `document` (`chiudiNavDrop()`) richiude qualunque menu aperto quando si clicca/tocca fuori; i pulsanti dentro il menu chiamano `e.stopPropagation()` per non farsi richiudere dal proprio stesso click prima di aver navigato.
- **Voce padre sempre evidenziata quando si è su una pagina figlia**: `showTab(id)` esegue prima l'evidenziazione generica esistente (`dataset.tab===id`), poi un passaggio supplementare che, per ogni `.nav-drop`, controlla se `id` compare fra i `dataset.tab` dei suoi pulsanti figli e in tal caso aggiunge `.active` anche al pulsante padre.
- **Guardia di accesso per ruolo**: sostituito il controllo piatto `TABS[state.role].some(t=>t.id===id)` con `trovaTabById(role,id)`, che cerca sia fra le entry di primo livello sia fra i `children` di quelle con menu a discesa — stessa garanzia di prima (nessun id non ammesso per il ruolo corrente è raggiungibile, nemmeno da console), ora estesa a `chiusure`/`impostazioni` nidificati.
- **`refreshCurrent()`** adattata: esclude il pulsante padre (`:not(.nav-drop-toggle)`) dalla ricerca del pulsante attivo, perché ora — quando si è su Chiusure — sia il padre sia il pulsante figlio "📅 Chiusure" portano la classe `active`, ma solo il figlio ha il `dataset.tab` della pagina realmente aperta.

**Parte 2 — Uniformazione visiva (nessuna funzione spostata, nessun ID cambiato):**
- Entrambe le intestazioni ora seguono lo stesso schema già in uso da Utenti/Progetti/Operatori: `<h2>` + `<p class="sub" style="margin:0 0 0 8px">` sulla stessa riga, invece del `<p>` libero sotto il blocco `view-title` usato prima da entrambe. Testo delle due descrizioni **invariato** (solo spostato/restilizzato, non riscritto — Registro delle decisioni, voce 57).
- Il toolbar di Chiusure (select anno + i due pulsanti) è stato spostato dentro la riga `view-title` (dopo un `<div class="grow">`), lo stesso pattern già usato da Utenti/Sessioni/Operatori per i controlli di pagina — prima stava in un blocco separato sotto il paragrafo descrittivo.
- Margini allineati a **16px** per il primo blocco di contenuto su entrambe le pagine (il `grid2` di Impostazioni li aveva già; il toolbar di Chiusure aveva 10px e la lista 12px, ora entrambi 16px) — stesso valore già usato altrove nell'app per "primo blocco sotto l'intestazione" (Registro delle decisioni, voce 58).
- Corretti i due `<h3>` interni alle card di Impostazioni ("Formazione Operatori", "Metodi / Progetti"), che non avevano lo stile standard `font-size:15px;margin-bottom:8px` usato altrove per le intestazioni di card (Disponibilità, "📚 Report precedenti" in Genera) — un'incoerenza preesistente al ciclo, corretta di passata.
- Corretto un commento HTML stantio (`<!-- GENERA CALENDARIO -->`, refuso preesistente sopra la sezione Impostazioni) in `<!-- IMPOSTAZIONI ... -->`, e aggiunto un commento `<!-- CHIUSURE ... -->` prima mancante sopra la sezione Chiusure.
- **Non toccato**: `initChiusureTab`, `renderChiusure`, `initImpostazioni`, `renderImpostazioni`, `saveImp` — nessuna riga di logica cambiata, solo la posizione/stile degli elementi HTML che quelle funzioni già trovano per `id` (verificato: tutti gli `id` usati da quelle funzioni — `#chiusure-anno`, `#btn-add-chiusura`, `#btn-load-festivita`, `#chiusure-list`, `#imp-formazioni`, `#imp-metodi`, `#imp-f-new`, `#imp-f-add`, `#imp-m-new`, `#imp-m-tipo`, `#imp-m-add` — sono identici a prima).

| Parte | Stato |
|---|---|
| Un'unica voce "Impostazioni" nel menu principale | ✅ Fatto |
| Menu a discesa con Impostazioni + Chiusure, apertura su hover (desktop) | ✅ Fatto (`@media (hover:hover)`) |
| Apertura anche su click/tap (mobile/tablet) | ✅ Fatto (classe `.open`, toggle su click) |
| Voce padre evidenziata quando si è su una delle due pagine | ✅ Fatto |
| Pagine di destinazione invariate (contenuti/funzioni/ID/handler) | ✅ Verificato |
| Uniformazione intestazioni/pulsanti/spaziature | ✅ Fatto |
| Nessuna sezione cambiata di pagina, nessuna funzione spostata | ✅ Verificato |
| Nessun tocco ad algoritmo/stati sessione/liste SharePoint/migrazioni | ✅ Verificato |

### Scenario tracciato a mano: desktop (hover) e mobile (tap)

1. **Desktop, hover**: il mouse entra in `.nav-drop` → la media query `(hover:hover)` è vera → `.nav-drop:hover>.nav-drop-menu{display:flex}` mostra il menu senza alcun click. L'utente clicca "📅 Chiusure": handler del figlio → `stopPropagation()` (irrilevante qui, ma innocuo) → `chiudiNavDrop()` (rimuove un'eventuale classe `.open` residua, il menu resta comunque visibile finché il mouse è sopra) → `showTab('chiusure')` → `trovaTabById('Admin','chiusure')` la trova fra i `children` → passa la guardia → sezione `#view-chiusure` mostrata, `initChiusureTab()` eseguito (guardia `_bound` intatta, nessuna doppia registrazione di listener anche navigando avanti e indietro più volte).
2. **Mobile, tap**: l'utente tocca "⚙️ Impostazioni" → `click` handler del padre: `era=false` → `chiudiNavDrop()` (no-op) → `wrap.classList.add('open')` → CSS `.open` mostra il menu. L'utente tocca "📅 Chiusure" → `stopPropagation()` impedisce che il click raggiunga il listener `document` prima di chiudere il menu esplicitamente → `chiudiNavDrop()` chiude → `showTab('chiusure')` naviga. Nessun momento in cui Chiusure sia irraggiungibile.
3. **Mobile, tap fuori per annullare**: menu aperto (`wrap.classList` contiene `open`), l'utente tocca altrove nella pagina (es. il calendario) → il click non ha `stopPropagation()` → risale fino a `document` → `chiudiNavDrop()` chiude il menu; nessuna navigazione avviene (il tap era su un elemento che non ha un proprio handler di navigazione, o se lo aveva, esegue anche la sua azione — comportamento atteso, non diverso da un click fuori da un qualunque menu a tendina).
4. **Evidenziazione persistente**: da `#view-chiusure` aperto, si richiama `renderCalendar()` altrove nel codice (es. cambio mese) che a sua volta non tocca la nav — l'evidenziazione del padre "⚙️ Impostazioni" resta finché non si chiama di nuovo `showTab()` con un `id` diverso da `impostazioni`/`chiusure`.
5. **Ruolo Operatore**: `TABS.Operatore` non ha alcuna entry con `children` → il ramo `if(t.children)` di `buildNav()` non scatta mai per questo ruolo → nav identica a prima, nessuna regressione.

## Decisione su `check-sintassi.js`: non estesa in questo ciclo

`trovaTabById`/`chiudiNavDrop` sono tecnicamente pure (deterministiche, senza effetti collaterali se isolate dal DOM che manipolano) ma sono plumbing di navigazione dipendente dalla struttura `TABS` — una configurazione di interfaccia, non una regola di dominio come `parseHM`/`tempoBustoOperatore`/`decidiOnlineDaCasa`, il cui malfunzionamento avrebbe conseguenze su monte ore, aule o assegnazioni reali. Estrarle avrebbe richiesto anche estrarre `TABS` (un oggetto di configurazione, non una costante di dominio come `AULE_CESATE`/`STATI_SESS` già in `EXTRACT_COSTANTI`) per un beneficio marginale. Verificate invece a mano con gli scenari sopra. Registro delle decisioni, voce 59.

## Metodo di verifica: multi-passata

1. **Passata 1 — per punto del prompt**: rilette singolarmente PARTE 1 (menu a discesa, hover, tap mobile, evidenziazione voce padre, nessun cambiamento alle pagine di destinazione), PARTE 2 (uniformazione intestazioni/pulsanti/spaziature/ordine sezioni) e VINCOLI (nessun tocco ad algoritmo/stati/liste/migrazioni) — vedi tabella sopra, tutti soddisfatti.
2. **Passata 2 — coerenza interna di `index.html`**: `node check-sintassi.js` (3 blocchi `<script>` OK, 89 test funzionali invariati e tutti passano — nessuna funzione pura esistente toccata); riletta la CSS aggiunta (`.nav-drop`/`.nav-drop-toggle`/`.nav-drop-menu`, parentesi bilanciate, nessuna proprietà malformata — non coperta da `node --check`, che valida solo i blocchi `<script>`, verificata quindi a occhio); grep di tutte le occorrenze di `chiusure`/`impostazioni` nel file (48 righe) per confermare che nessun altro punto del codice assumesse l'esistenza di un pulsante di primo livello con `dataset.tab==='chiusure'` fuori da `buildNav`/`showTab`/`refreshCurrent` — nessuno trovato.
3. **Passata 3 — confronto incrociato fra le quattro fonti**: `CLAUDE.md` (punto 6 dell'architettura, aggiornato con la nuova struttura `children`/`.nav-drop`); `CONTESTO.md` (Cronologia voce 35, Backlog voce 21 con Ciclo H aggiunto alla lista A-G, Registro delle decisioni voci 56-59); questo file; il codice reale — stessi nomi di funzione (`trovaTabById`, `chiudiNavDrop`, `buildNav`, `showTab`, `refreshCurrent`) in tutte e quattro le fonti, nessuna incongruenza trovata.
4. **Passata 4 — scenari tracciati a mano**: i cinque scenari sopra (hover desktop, tap mobile, tap fuori per annullare, persistenza dell'evidenziazione, nessuna regressione per l'Operatore).
5. **Passata 5 — rilettura completa del diff** (`git diff -- index.html`): confermato che le uniche righe toccate sono la CSS del menu a discesa, le due sezioni HTML Impostazioni/Chiusure, e il blocco `TABS`/`buildNav`/`showTab`/`refreshCurrent` — nessuna modifica accidentale altrove (algoritmo di generazione, `renderChiusure`, `renderImpostazioni`, liste SharePoint, `LISTE_RECORD_SINGOLO` tutti confermati invariati).

Nessuna passata aggiuntiva ha trovato nulla di nuovo dopo la quinta: verifica chiusa a 5 passate.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna oltre al prompt di apertura del ciclo, che già specificava obiettivo, vincoli e chiusura ciclo in dettaglio (menu a discesa desktop+mobile, uniformazione visiva senza spostare funzioni, nessun tocco ad algoritmo/stati/liste/migrazioni, estensione di `check-sintassi.js` solo se si introducono funzioni pure riutilizzabili, riepilogo prima del commit).

*Domande poste a Simone e risposte ricevute:* nessuna — il prompt copriva già i casi rilevanti (comportamento hover vs. tap, persistenza dell'evidenziazione, vincolo "nessuna funzione si sposta").

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 56-59 (la voce padre del menu non naviga da sola, apre solo il sottomenu; le descrizioni di pagina spostate senza riscriverne il testo; margini allineati al valore di 16px già in uso altrove; `trovaTabById`/`chiudiNavDrop` non aggiunte a `check-sintassi.js` perché plumbing di navigazione, non regola di dominio).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| 1 | Una sola voce "Impostazioni" nel menu principale | ✅ Fatto | `TABS.Admin` non ha più l'entry `chiusure` di primo livello |
| 2 | Hover (desktop) apre il menu con Impostazioni + Chiusure | ✅ Fatto | `@media (hover:hover)` |
| 3 | Click/tap sulla voce padre apre il menu anche su mobile | ✅ Fatto | classe `.open`, toggle su click |
| 4 | Voce padre evidenziata come attiva quando si è in una delle due pagine | ✅ Fatto | passaggio supplementare in `showTab()` |
| 5 | Nessun cambiamento alle pagine di destinazione (contenuti/funzioni/ID/handler) | ✅ Verificato | solo `buildNav`/`showTab`/`refreshCurrent` toccate lato JS di navigazione |
| 6 | Uniformazione intestazioni/pulsanti/spaziature/ordine sezioni | ✅ Fatto | vedi Parte 2 sopra |
| 7 | Nessuna sezione cambia pagina, nessuna funzione si sposta | ✅ Verificato | `renderChiusure`/`renderImpostazioni`/`initChiusureTab`/`initImpostazioni` invariate |
| 8 | Nessun tocco ad algoritmo/stati sessione/liste SharePoint, nessuna migrazione | ✅ Verificato | grep mirato, nessuna occorrenza fuori posto |
| 9 | `node check-sintassi.js` deve passare | ✅ Verificato | 89 test, invariati |
| 10 | Verifica multi-passata (min. 4) a quattro fonti | ✅ Fatto | 5 passate |
| 11 | Registro di sessione in `VERIFICA.md` | ✅ Fatto | sopra |
| 12 | Riepilogo prima del commit | ⏳ Da fare subito dopo, prima di `git add`/commit/push |

**Cosa manca**: nessuna lacuna sui punti richiesti dal prompt. Non eseguibile in questo ambiente (nessun login M365/browser reale): il collaudo dal vivo del menu a discesa — hover su desktop, tap su un telefono/tablet reale, verifica visiva dell'uniformità fra le due pagine — resta da fare da Simone dopo il deploy.

## Limiti di questa verifica

Il comportamento di hover/tap/click-fuori è stato tracciato a mano leggendo il codice e le regole CSS riga per riga con gli scenari sopra, non osservato in un browser reale (limite dell'ambiente, non della verifica — nessun DOM/browser disponibile qui). Si raccomanda a Simone, dopo il deploy, di verificare in particolare: (a) su un telefono reale, che toccare "⚙️ Impostazioni" apra il menu e che toccare "📅 Chiusure" navighi correttamente; (b) su desktop, che l'hover apra il menu senza click; (c) visivamente, che le due pagine appaiano ora coerenti fra loro (intestazioni, pulsanti, spaziature).

## Discrepanze da discutere

- **Non introdotta da questo ciclo, trovata rileggendo la chiusura di ieri**: la voce "Chiusura giornata 20/07" in questo stesso file termina (sezione "Metodo di verifica: multi-passata (chiusura giornata)", subito sopra questa nuova voce) con un rimando a una sezione "Verifica multi-passata di chiusura giornata... più sotto in questo stesso ciclo" — quella sezione non risulta presente da nessuna parte nel file: il file terminava esattamente a quel rimando. Segnalato qui come richiesto dalla prassi (mai corretto in silenzio); non è stato ricostruito perché non di competenza di questo ciclo (riguarda la chiusura di una sessione precedente, il 20/07) e perché non è possibile ricostruire con certezza cosa quella sezione mancante dovesse contenere di preciso senza inventarlo.

---

# Verifica — Ciclo F.1: Frequenza a distanza di giorni (quindicinale/mensile) + fix margine 5 minuti

Data: 2026-07-21. Tocca l'algoritmo (Passata 1 di `generateMonth`), nessuna migrazione distruttiva. Prima tappa del Ciclo F (approccio a tappe): Passata 3, `generateMonthAI`, report e sconfinamento cross-mese restano fuori scopo (Ciclo F.2).

## Cosa è stato fatto

**Parte A — tre modalità mutuamente esclusive:**
- Nuovo campo `modalitaFrequenza` sul progetto (`settimanale`/`quindicinale`/`mensile`), letto tramite la funzione pura `modalitaFrequenza(p)`: qualunque valore diverso dai due espliciti (`quindicinale`/`mensile`) — campo assente, `null`, `'settimanale'` letterale, o un valore non riconosciuto — ricade su `'settimanale'`. **Nessuna migrazione**: i progetti esistenti continuano a comportarsi esattamente come oggi, senza bisogno di scrivere nulla nei loro record.
- Editor progetto: nuovo select "Modalità frequenza" prima del campo "Frequenza settimanale"; quest'ultimo si nasconde (`#pe-freq-wrap`) quando la modalità non è settimanale. Al salvataggio, `frequenza` è scritta solo in modalità settimanale, altrimenti `null` esplicito. `collectPeState()` (confronto per il dialogo "modifiche non salvate") include il nuovo campo, altrimenti un cambio di sola modalità non sarebbe stato rilevato come modifica.
- Riga della tabella Progetti aggiornata per mostrare "Quindicinale"/"Mensile" invece di un fuorviante "—x/sett" quando `frequenza` è `null`.

**Parte B — logica a distanza di giorni (solo Passata 1, `generateMonth`):**
- `ultimaLezioneValida(sessioni,progettoId)`: ultima sessione `proposta`/`confermata`/`eseguita` del progetto (annullata/assenza ingiustificata escluse, si prende la valida precedente), cercata su `keep` — l'array che `generateMonth` già costruisce con `sessioniDaConservare(ms,scopeIds)` e che esclude **solo** le "proposta" di questo mese in ambito che il run sta per sostituire, non l'intero storico per gli altri criteri: include quindi correttamente sessioni di mesi precedenti, come richiesto esplicitamente dal vincolo tecnico cross-mese.
- Candidata: `slittaGiornoValido(addGiorni(ultima,min),chiusureDates)` — parte dal minimo della finestra (12 per quindicinale, 23 per mensile), poi avanza di un giorno alla volta finché non trova un giorno che non sia domenica né una chiusura centro (`Gestionale_Chiusure`). Lo slittamento ha priorità sulla finestra: se il risultato finale cade fuori da [min,max] (`finestraOk`/`giorniTraDate`), un'anomalia esplicita lo segnala, ma la sessione viene comunque tentata.
- Un solo giorno candidato per l'intero mese per progetto: se `candidataYM===ms`, si tenta il piazzamento (stessa logica di scelta operatore/aula della modalità settimanale, tramite `sceglieOperatoreEAula`); se `candidataYM<ms` (candidata scaduta, nel passato rispetto al mese generato), un'anomalia esplicita invita a verificare; se `candidataYM>ms` (non ancora dovuta questo mese — il caso normale per la maggior parte dei mesi con cadenze superiori alla settimana), nessuna azione né avviso.
- Nessuno sconfinamento: il ciclo giorni (`for(let d=wk;d<=we...)`) della modalità settimanale non supera mai `days` (ultimo giorno del mese `ms`); la modalità a distanza di giorni non genera mai una data fuori da `ms` per costruzione (il controllo `candidataYM===ms` la esclude a monte).

**Parte C — fix del margine 5 minuti (backlog CONTESTO.md #13):**
- Nuova funzione pura `rfreeConGap(busy,st,en)` = `rfree(busy,st-GAP_MINUTI,en+GAP_MINUTI)` (`GAP_MINUTI=5`), sostituisce ovunque in Passata 1 le chiamate a `rfree` nude su operatore, aula e utente (fra i progetti diversi della stessa persona). Prima del fix, il controllo operatore era due righe (`if(!rfree(gap)&&!rfree(raw))continue;` seguita da `if(!rfree(raw))continue;`) che si annullavano a vicenda: la seconda riga, da sola, bloccava già ogni sovrapposizione oraria vera e propria, rendendo la prima (quella con il margine) incapace di bloccare mai un caso "vicino ma non sovrapposto" che la seconda non avrebbe già bloccato. Verificato con un caso concreto: operatore libero 10:00-11:00 (`{from:600,to:660}`), candidata 11:01-11:40 (`st=661`) — prima del fix, veniva piazzata (nessuna sovrapposizione esatta); con `rfreeConGap` viene correttamente bloccata (margine di 1 minuto, sotto i 5 richiesti).

**Refactoring di supporto (comportamento della modalità settimanale dimostrato invariato):**
- `sceglieOperatoreEAula(p,ds,dn,st,en,pool,sessionCount)`: estrae la scelta operatore/aula (sede compatibile, formazioni, margine, viaggio, aula per mezza giornata) dal ciclo settimanale in una funzione condivisa, riusata identica dal nuovo ramo. Stesso ordine di condizioni, stessi effetti collaterali (`anom` per il ripiego Busto, `opRoom` per la stanza di mezza giornata) del codice originale — solo la forma cambia.
- `creaSessionePiazzata(p,ds,st,en,op,sed,cAula,sessionCount)`: estrae la costruzione dell'oggetto sessione "proposta", identica al literal originale.
- `calcStrettezza` resa mode-aware: per settimanale la formula resta `p.frequenza||1` (letterale, invariata); per quindicinale/mensile usa una frequenza equivalente settimanale nominale (7 / punto medio della finestra) solo per l'ordinamento di priorità fra progetti, senza introdurre alcun vincolo di piazzamento.

| Parte | Stato |
|---|---|
| Tre modalità mutuamente esclusive nell'editor progetto, settimanale invariata come default | ✅ Fatto |
| Query cross-mese sull'ultima lezione valida (proposta/confermata/eseguita) | ✅ Fatto (`ultimaLezioneValida` su `keep`) |
| Slittamento domenica/chiusura con priorità sulla finestra | ✅ Fatto (`slittaGiornoValido`) |
| Nessuno sconfinamento oltre il mese generato | ✅ Verificato |
| Fix del margine 5 minuti, applicato a operatore/aula/utente in Passata 1 | ✅ Fatto (`rfreeConGap`) |
| Comportamento della modalità settimanale invariato (a parte il fix del margine, esplicitamente richiesto anche lì) | ✅ Dimostrato (vedi Passata 2 sotto) |
| Nessuna migrazione distruttiva | ✅ Verificato |
| Vincoli invariati (aule fisse mezza giornata, orari 09:00-19:30, confermate mai toccate, regole sede, domenica esclusa) | ✅ Verificato — nessuna di queste logiche toccata |

### Scenario tracciato a mano: progetto quindicinale, generazione di settembre 2026

1. **Caso normale**: ultima lezione valida (eseguita) il 2026-08-20 (giovedì). Candidata grezza = `addGiorni('2026-08-20',12)` = 2026-09-01 (martedì — verificato con `new Date(...).getDay()`, non a memoria). Non è domenica né chiusura → `slittaGiornoValido` la restituisce invariata. `candidataYM='2026-09'===ms` → si tenta il piazzamento quel giorno esatto. `giorniTraDate('2026-08-20','2026-09-01')=12`, dentro [12,16] → nessuna anomalia di finestra. Se operatore e utente sono disponibili quel giorno, la sessione viene creata; il riepilogo registra `richieste:1,piazzate:1`.
2. **Slittamento con più giorni non validi consecutivi**: chiusura centro il 2026-08-15 (sabato) + 2026-08-16 è domenica (verificato) — `slittaGiornoValido('2026-08-15',{'2026-08-15'})` avanza da sabato (chiusura) a domenica (weekend) a lunedì 2026-08-17 (primo giorno valido) — stesso identico caso già coperto come test unitario in `check-sintassi.js`, qui ricondotto allo scenario applicativo: se questa fosse la candidata grezza di un progetto quindicinale con ultima lezione il 2026-08-05, la distanza finale (`giorniTraDate('2026-08-05','2026-08-17')=12`) resterebbe comunque dentro la finestra, nessuna anomalia.
3. **Candidata scaduta**: se per qualche motivo si genera settembre ma l'ultima lezione valida risale a giugno (progetto trascurato per mesi), la candidata calcolata cadrebbe in luglio o agosto — `candidataYM<ms` → anomalia esplicita "la prossima lezione risulterebbe già scaduta", nessun piazzamento silenzioso.
4. **Non ancora dovuta**: progetto mensile con ultima lezione il 2026-09-10, si genera ottobre — candidata ≈ 2026-10-03/10 → `candidataYM='2026-10'===ms` in questo caso specifico verrebbe comunque tentata (è il caso normale); se invece l'ultima fosse stata il 2026-09-25 e si generasse ottobre, candidata ≈ 2026-10-18/25, ancora `candidataYM==='2026-10'` — il caso "candidata in un mese successivo a quello generato" si verifica tipicamente generando **due mesi dopo** l'ultima lezione di un progetto mensile: nessuna azione, nessun avviso, verificato che il codice non produca falsi allarmi per la situazione normale.
5. **Nessun avviso di finestra quando lo slittamento non è necessario**: verificato che `finestraOk(modo,giorniTraDate(ultima,candidata))` sia sempre vero quando `candidata===addGiorni(ultima,min)` non slittata (la distanza è esattamente `min`, sempre dentro [min,max] per costruzione) — l'anomalia di finestra scatta solo quando lo slittamento ha effettivamente spostato la data.

### Scenario tracciato a mano: comportamento invariato della modalità settimanale

Confrontato riga per riga il nuovo codice col codice originale (`git diff`): stesso ordine — controllo utente (ora con margine), poi `sceglieOperatoreEAula` (stesso ordine interno: sede, slot, formazioni, margine operatore, viaggio, aula/mezza giornata), poi controllo ore contrattuali Assunto, poi costruzione e inserimento della sessione, stessi effetti su `opB`/`prB`/`auB`/`opRoom`/`sessionCount`/`placed`. L'unica differenza di comportamento (non di struttura) è il margine di 5 minuti, ora realmente applicato anche lì — cambiamento esplicitamente richiesto dalla Parte C per l'intera Passata 1, non un effetto collaterale involontario del refactoring.

## Estensione di `check-sintassi.js`

33 nuovi casi (89→122 totali) su 10 funzioni pure nuove (`modalitaFrequenza`, `finestraOk`, `dateToISO`, `addGiorni`, `giorniTraDate`, `slittaGiornoValido`, `rfreeConGap`, `ultimaLezioneValida`, più `dname`/`rfree` — preesistenti ma mai estratte prima) e su `calcStrettezza` (preesistente, mai testata prima, ora coperta anche per la modifica mode-aware). Le date usate nei test (`2026-07-19` domenica, `2026-08-15` sabato, `2026-08-16` domenica) sono state verificate con `new Date(...).getDay()` in Node prima di scriverle nei test, non assunte a memoria.

## Metodo di verifica: multi-passata

1. **Passata 1 — per punto del prompt**: riletti singolarmente Parte A (tre modalità, editor, default settimanale), Parte B (query cross-mese, slittamento, priorità sulla finestra, un solo giorno candidato, niente sconfinamento), Parte C (fix margine, applicato ovunque in Passata 1), Vincoli invariati (aule/orari/confermate/sede/domenica) e Chiusura ciclo (check-sintassi.js, verifica multi-passata, CLAUDE.md/CONTESTO.md aggiornati, Registro di sessione) — vedi tabella sopra, tutti soddisfatti.
2. **Passata 2 — coerenza interna di `index.html`**: `node check-sintassi.js` (3 blocchi `<script>` OK, 122 test funzionali, tutti passano); grep mirato per `GAP` residuo (nessuno, tutto migrato a `GAP_MINUTI`/`rfreeConGap`); grep di tutte le occorrenze di `modalitaFrequenza(` (5: definizione, `calcStrettezza`, il ciclo di Passata 1, la riga tabella Progetti, il markup dell'editor) per confermare che ogni punto d'uso sia coerente; verificato che nessuna variabile locale (`chosen`/`cAula`/`chosenSed`/`tentAulaPiena`) sia rimasta dichiarata fuori dalla funzione estratta.
3. **Passata 3 — rilettura completa del `git diff` di `index.html`**: confermato che le uniche modifiche sono la riga della tabella Progetti, l'editor progetto (markup + 3 punti JS: listener modalità, `collectPeState`, salvataggio), il blocco di nuove funzioni pure dopo `maxNuoveSettimana`, `calcStrettezza`, e il blocco di Passata 1 (helper + ciclo per-progetto) — nessuna modifica accidentale a Passata 2, Passata 3, `generateMonthAI`, liste SharePoint, `LISTE_RECORD_SINGOLO`, stati sessione.
4. **Passata 4 — scenari tracciati a mano**: i cinque scenari quindicinale/mensile sopra (caso normale, slittamento multiplo, candidata scaduta, non ancora dovuta, nessun falso avviso di finestra) più il confronto riga-per-riga della modalità settimanale (invariata a parte il fix del margine, esplicitamente richiesto anche lì).
5. **Passata 5 — confronto incrociato fra le quattro fonti**: `CLAUDE.md` (bullet Passata 1 e Progetti aggiornati, voce S11 riscritta con nota di fedeltà sulla discrepanza "quindicinale" vs. "2 volte/mese" originale), `CONTESTO.md` (Cronologia voce 36, Backlog voce 21 con Ciclo F diviso in F.1/F.2, backlog voce 13 chiusa, Registro delle decisioni voci 60-66), questo file, il codice reale — stessi nomi di funzione in tutte e quattro le fonti, nessuna incongruenza propria di questo ciclo trovata.

Nessuna passata aggiuntiva ha trovato nulla di nuovo dopo la quinta: verifica chiusa a 5 passate.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna oltre al prompt di apertura del ciclo, che specificava già in dettaglio le tre parti (A/B/C), i vincoli invariati, e la chiusura ciclo completa (estensione check-sintassi.js con quattro categorie di test, verifica multi-passata, aggiornamento CLAUDE.md/CONTESTO.md, Registro di sessione, riepilogo prima del commit).

*Domande poste a Simone e risposte ricevute:* nessuna in questo ciclo — il prompt copriva già i casi rilevanti (punto di partenza del conteggio, priorità dello slittamento sulla finestra, stati sessione validi). Due decisioni implementative non specificate esplicitamente nel prompt sono state prese e dichiarate (non chieste a Simone, dato il contesto "sola lettura" delle due sessioni precedenti che avevano preceduto questo ciclo di lavoro effettivo): candidata calcolata al minimo della finestra (non al punto medio), e un solo giorno candidato per mese senza ricerca di alternative nella finestra.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 60-66 (terminologia "quindicinale" al posto di "2 volte/mese"; un solo giorno candidato senza ricerca di alternative; candidata al minimo della finestra; query su `keep` non su tutto lo storico grezzo; candidata scaduta segnalata vs. non ancora dovuta silenziosa; estrazione di `sceglieOperatoreEAula`/`creaSessionePiazzata`; margine di 5 minuti esteso a utente e aula, non solo operatore).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| A.1 | Frequenza come scelta fra tre modalità mutuamente esclusive | ✅ Fatto | select `#pe-freqmodo`, campo numero nascosto per le altre due |
| A.2 | Settimanale = comportamento attuale invariato | ✅ Dimostrato | confronto riga-per-riga nel diff |
| A.3 | Quindicinale = 12-16 giorni; Mensile = 23-30 giorni | ✅ Fatto | `FINESTRE_FREQUENZA` |
| A.4 | Migrazione non distruttiva, default settimanale per progetti esistenti | ✅ Fatto | `modalitaFrequenza(p)`, nessuna scrittura richiesta |
| B.1 | Punto di partenza: ultima proposta/confermata/eseguita, annullata/assenza esclusa | ✅ Fatto | `ultimaLezioneValida` |
| B.2 | Query esplicita cross-mese, non solo mese corrente | ✅ Fatto | su `keep`, non su `state.data.sessioni` filtrato per `ms` |
| B.3 | Nessuno sconfinamento: solo datazione del primo incontro del mese | ✅ Verificato | `candidataYM===ms` come unico caso che piazza |
| B.4 | Slittamento su domenica/chiusura, primo giorno utile successivo | ✅ Fatto | `slittaGiornoValido` |
| B.5 | Slittamento ha priorità sulla finestra | ✅ Fatto | mai un `continue`/blocco per finestra, solo segnalazione |
| B.6 | Nota sul trascinamento del ritmo, per il futuro collaudo automatico | ✅ Fatto | commento dedicato su `slittaGiornoValido` |
| C.1 | Margine 5 minuti sempre rispettato fra sessioni consecutive | ✅ Fatto | `rfreeConGap`/`GAP_MINUTI` |
| C.2 | Fix coerente ovunque `rfree` usato in Passata 1 | ✅ Fatto | operatore, aula, utente |
| Vincoli | Aule fisse mezza giornata, orari 09:00-19:30, confermate intoccabili, regole sede, domenica esclusa | ✅ Verificato | nessuna di queste logiche toccata |
| Chiusura | `check-sintassi.js` esteso e passante, verifica multi-passata (min. 4), CLAUDE.md/CONTESTO.md aggiornati, Registro di sessione | ✅ Fatto | 5 passate, 122 test |

**Cosa manca**: nessuna lacuna sui punti richiesti per F.1. Esplicitamente fuori scopo (Ciclo F.2, non di questo ciclo): estensione a Passata 3 (riparazione), `generateMonthAI`, report di generazione (diagnostica granulare), sconfinamento cross-mese con relativa protezione anti-doppione. Non eseguibile in questo ambiente: nessun test dal vivo con login M365/browser reale — il collaudo più utile per Simone sarebbe generare un mese reale con un progetto quindicinale/mensile di prova e verificare a schermo la singola sessione piazzata nel giorno atteso.

## Limiti di questa verifica

Gli scenari applicativi (candidata normale, slittamento, candidata scaduta/non ancora dovuta) sono stati tracciati a mano leggendo il codice con valori concreti e verificando le date di calendario con Node (`new Date(...).getDay()`), non osservati in esecuzione reale — nessun ambiente con login M365/browser disponibile qui. Le funzioni pure sottostanti (distanza in giorni, verifica finestra, slittamento, margine 5 minuti) sono invece verificate con `check-sintassi.js`, che le esegue realmente con `node --check` + casi concreti, non solo tracciate a mano. Si raccomanda a Simone, dopo il deploy, di generare un mese con un progetto di prova in ciascuna delle due nuove modalità per osservare dal vivo la sessione candidata, e di verificare in particolare il caso "candidata scaduta" (impostando ad arte un progetto quindicinale/mensile con un'ultima lezione lontana nel tempo) per vedere l'anomalia comparire nel banner dei risultati di generazione.

## Discrepanze da discutere

- **Segnalata, non risolta in autonomia**: la specifica S11 originale (17/07, in `CLAUDE.md`) descriveva la modalità "2 volte/mese" come un'alternanza di settimane (settimana con incontro, settimana vuota); l'implementazione di oggi (Ciclo F.1), su indicazione diretta di Simone in sessione, usa invece "quindicinale" come distanza pura di 12-16 giorni dall'ultima lezione — un meccanismo diverso da quello originale. Il testo originale di S11 è stato conservato in `CLAUDE.md` (sotto "Testo originale S11") per lo storico, non riscritto: la discrepanza è dichiarata esplicitamente lì e qui, non nascosta.

---

# Verifica — Ciclo F1.1: HOTFIX modalità quindicinale (bootstrap + protezione lezione manuale)

Data: 2026-07-21. HOTFIX su due bug emersi dal collaudo di Simone sul Ciclo F.1, entrambi testati su un progetto quindicinale nuovo senza alcuna sessione pregressa. Tocca solo la Passata 1 di `generateMonth` e le funzioni condivise `sessioniDaConservare`/`proposteDaSostituire`; nessuna migrazione distruttiva.

## Causa reale (indagata prima di correggere, come richiesto dal prompt)

Il prompt di apertura proponeva un'ipotesi per il Bug 2: "la pulizia delle proposte avviene prima della ricerca dell'ancora". **Verificato leggendo il codice che l'ipotesi non è quella esatta** — la cancellazione reale su SharePoint (`deleteRecord`, riga ~2445 di `generateMonth`) avviene sì cronologicamente dopo Passata 1, ma non è quello il punto in cui la lezione manuale si perdeva.

La causa reale è a monte, nella riga `const keep=sessioniDaConservare(ms,scopeIds);` calcolata in testa alla funzione, **prima** di qualunque piazzamento: `sessioniDaConservare` (prima di questo hotfix) escludeva già dalla sua definizione ogni `proposta` del mese in generazione appartenente a un progetto in ambito, senza distinguere fra una proposta generata dall'algoritmo e una inserita a mano — perché non esisteva alcun campo per distinguerle. Di conseguenza:
- `ultimaLezioneValida(keep,p.id)` (usata per calcolare l'ancora, Ciclo F.1) riceveva un `keep` già privo della lezione manuale e restituiva `null` **indipendentemente** dall'ordine in cui la cancellazione SharePoint sarebbe avvenuta più tardi nella stessa run — da cui il Bug 1 (nessuna ancora → nessun bootstrap → 0 sessioni, con lo stesso identico sintomo sia che la lezione manuale esistesse sia che non esistesse alcuna lezione precedente).
- La lezione manuale, rientrando nella stessa definizione di "proposta sostituibile" di `proposteDaSostituire` (complemento esatto di `sessioniDaConservare`), veniva poi effettivamente cancellata da SharePoint in coda alla run — da cui il Bug 2.

Un'unica causa strutturale comune a entrambi i sintomi osservati da Simone, non due bug indipendenti: l'assenza di un modo per distinguere una sessione manuale da una generata.

## Cosa è stato fatto

**Bug 2 — protezione della lezione manuale (corretto a monte, risolve anche l'ancora):**
- Nuovo campo `s.origine` (`'manuale'` / `'generata'`) su ogni sessione. `openSessionModal()` lo imposta a `'manuale'` **solo alla creazione** (`isNew`) — un'edit successiva non lo tocca mai, grazie allo spread `{...s}` nel record salvato (decisione 69, `CONTESTO.md`): correggere a mano un dettaglio di una sessione già generata non la rende "manuale".
- I tre punti di generazione automatica — `creaSessionePiazzata` (Passata 1), `creaSessioneRiparata` (Passata 3), e il record costruito nella validazione post-IA di `generateMonthAI` — impostano sempre `origine:'generata'` esplicito.
- Retrocompatibilità: sessioni preesistenti senza il campo sono trattate come `'generata'` (nessuna migrazione, come da istruzione esplicita del prompt).
- `sessioniDaConservare(ms,scopeIds)`/`proposteDaSostituire(sessioni,ms,scopeIds)` — restano l'esatto complemento l'una dell'altra — escludono ora sempre `s.origine==='manuale'` dalla sostituibilità, qualunque sia lo stato della sessione. Effetto: sia la rigenerazione (`generateMonth`/`generateMonthAI`) sia "🗑 Svuota proposte del mese" (riusa `proposteDaSostituire`) non toccano mai più una proposta manuale.
- **Effetto collaterale corretto, non un secondo intervento**: una volta che `keep` include di nuovo la lezione manuale, `ultimaLezioneValida(keep,p.id)` la trova naturalmente come ancora — non è stata necessaria alcuna modifica a `ultimaLezioneValida` stessa (decisione implicita: la causa era a monte, non lì).

**Bug 1 — bootstrap del primissimo incontro:**
- Nuovo ramo in `generateMonth`, attivo solo quando `ultimaLezioneValida(keep,p.id)` restituisce `null` (nessuna lezione precedente valida in nessun mese): invece del solo avviso precedente, scorre i giorni del mese di generazione dal giorno 1 in avanti (decisione 67, `CONTESTO.md` — a differenza del ramo con ancora, qui non c'è un giorno "naturale" da cui slittare solo per domenica/chiusura), saltando domeniche e chiusure centro, e per ciascun giorno prova la stessa ricerca giorno/fascia già usata dalla modalità settimanale (disponibilità utente `effRng`, poi per ogni fascia oraria uno scorrimento a passi di 30 minuti con `rfreeConGap`/`sceglieOperatoreEAula`, stessa gestione del tetto ore contrattuali Assunto).
- Si ferma al **primo** piazzamento riuscito (`piazzata=true`, mai più di una sessione bootstrap per run, coerente col limite "al più una candidata per mese" già esistente per questa modalità dal Ciclo F.1).
- Se nessun giorno del mese ammette un piazzamento (nessuna eccezione (`throw`) sollevata in alcun caso), resta un avviso esplicito che invita a inserire la sessione a mano — stesso stile testuale dell'avviso precedente, riformulato per riflettere che ora è stata tentata una ricerca su tutto il mese, non un solo giorno.
- Le sessioni successive del progetto continuano a cascata nei run dei mesi successivi, usando questa come nuova `ultimaLezioneValida` — nessuna modifica necessaria a quella logica, già esistente dal Ciclo F.1.

| Punto | Stato |
|---|---|
| Bug 1: bootstrap piazza la prima sessione nel primo giorno utile del mese quando non esiste ancora un'ancora | ✅ Fatto |
| Bug 1: rispetta disponibilità utente/operatore, sedi progetto, chiusure, orari 09:00-19:30, gap 5 minuti | ✅ Fatto (riusa `effRng`/`sceglieOperatoreEAula`/`rfreeConGap`, stessa Passata 1) |
| Bug 1: sessioni successive a cascata dai run dei mesi successivi | ✅ Verificato (nessuna modifica necessaria a `ultimaLezioneValida`) |
| Bug 2: causa reale indagata e riportata prima di correggere | ✅ Fatto (vedi sezione sopra — ipotesi del prompt confutata, causa reale diversa) |
| Bug 2: sessione manuale mai eliminata da una rigenerazione, qualunque stato | ✅ Fatto (`origine!=='manuale'` in `sessioniDaConservare`/`proposteDaSostituire`) |
| Bug 2: sessione manuale usata come ancora se compatibile con la cadenza | ✅ Verificato (effetto collaterale della correzione a monte, non un intervento separato) |
| Campo origine con retrocompatibilità (assente → "generata") | ✅ Fatto |
| Nessuna migrazione distruttiva | ✅ Verificato |

### Scenario tracciato a mano: i due bug, prima e dopo

1. **Bug 1, prima**: progetto quindicinale creato oggi, nessuna sessione. `ultimaLezioneValida(keep,p.id)` → `null` → ramo `if(!ultima)` → solo `anom.push(...)`, nessun piazzamento. Riepilogo: `piazzate:0,richieste:1`. **Dopo**: stesso progetto, il nuovo ciclo bootstrap scorre i giorni dal 1°; assumendo che il progetto abbia disponibilità utente dichiarata e un operatore del pool libero al giorno 3 del mese (i giorni 1-2 fossero indisponibili per l'utente), la sessione viene piazzata al giorno 3, `piazzata=true`, riepilogo `piazzate:1,richieste:1`.
2. **Bug 2, prima**: Simone crea a mano una sessione il 2026-08-05 per lo stesso progetto (stato `proposta`, nessun campo `origine` prima di questo hotfix). Genera con algoritmo per agosto: `keep=sessioniDaConservare('2026-08',scopeIds)` la esclude (proposta+in ambito+nel mese) → `ultimaLezioneValida(keep,...)` → `null` → stesso Bug 1 (0 sessioni piazzate) **e** in coda alla run `proposteDaSostituire` la include fra le "da eliminare" → la sessione manuale del 05/08 viene cancellata da SharePoint. **Dopo**: la stessa sessione, creata da `openSessionModal` con `isNew=true`, riceve `origine:'manuale'`. Rigenerando agosto: `sessioniDaConservare` non la esclude più (origine manuale) → resta in `keep` → `ultimaLezioneValida(keep,p.id)` la trova (`'2026-08-05'`, stato `proposta`, valida) → il ramo con ancora (non più il bootstrap) calcola la candidata successiva a partire da lì; `proposteDaSostituire` non la seleziona più per la cancellazione → sopravvive alla rigenerazione.
3. **Retrocompatibilità verificata**: una sessione preesistente (creata prima di questo hotfix, quindi senza campo `origine`) risulta `s.origine!=='manuale'` (undefined !== 'manuale' → true) → resta sostituibile come sempre, nessun cambio di comportamento per i dati già in SharePoint.

## Estensione di `check-sintassi.js`

4 nuovi casi (122→126 totali): 3 su `proposteDaSostituire` (una proposta con `origine:'manuale'` non è mai fra le "da sostituire"; una con `origine:'generata'` lo è come prima; una senza il campo lo è ugualmente, a riprova della retrocompatibilità) + 1 su `ultimaLezioneValida` (trova correttamente una proposta di origine manuale mantenuta in un `keep` simulato, a riprova che l'ancora torna a funzionare una volta risolto il Bug 2 a monte). **Non estratta** `sessioniDaConservare` stessa: a differenza di `proposteDaSostituire` (riceve `sessioni` come parametro esplicito, per restare testabile in isolamento — nota già presente nel codice dal Ciclo E.1), `sessioniDaConservare` legge `state.data.sessioni` direttamente, quindi fallirebbe in sandbox per assenza del globale `state`; la sua logica condivisa resta comunque coperta dai test su `proposteDaSostituire`, che ne sono l'esatto complemento per costruzione nel codice sorgente (annotato con un commento dedicato in `check-sintassi.js`). Il ramo di bootstrap in `generateMonth` (Bug 1) non è estraibile come funzione pura isolata — è codice inline con chiusure su molte strutture locali della Passata 1 (`opB`/`prB`/`auB`/`opRoom`/`newS`/`anom`), stessa limitazione già presente per il resto di Passata 1/3 fin dal Ciclo F.1 — verificato a mano per coerenza (vedi scenario sopra) invece che con un test automatico dedicato.

## Metodo di verifica: multi-passata

1. **Passata 1 — per punto del prompt**: rilette singolarmente le richieste sui due bug (bootstrap compatibile con tutte le regole esistenti, causa reale indagata prima di correggere, sessione manuale mai eliminata qualunque stato, usata come ancora, campo origine con retrocompatibilità, chiusura ciclo con check-sintassi/CLAUDE.md/CONTESTO.md/registro/commit) — vedi tabella sopra, tutte soddisfatte.
2. **Passata 2 — coerenza interna di `index.html`**: `node check-sintassi.js` (3 blocchi `<script>` OK, 126 test funzionali, tutti passano); grep di tutte le occorrenze di `stato:'proposta'` per confermare che i quattro punti di creazione sessione (modale manuale, `creaSessionePiazzata`, `creaSessioneRiparata`, validazione IA) siano stati tutti coperti dal campo `origine` — nessun quinto punto di creazione trovato (verificato anche che `handleImport`/Excel non crei mai sessioni, solo operatori/utenti).
3. **Passata 3 — rilettura completa del `git diff` di `index.html`**: confermato che le uniche modifiche sono `sessioniDaConservare`/`proposteDaSostituire` (condizione `origine`), i tre punti di generazione automatica (`origine:'generata'` esplicito), `openSessionModal` (`origine:'manuale'` solo su `isNew`), e il nuovo ramo di bootstrap dentro il blocco `if(!ultima)` — nessuna modifica accidentale a Passata 2, alla modalità settimanale, a `generateMonthAI` (il bootstrap resta esplicitamente fuori scopo lì, come F.2), a `sceglieOperatoreEAula`/`creaSessionePiazzata` stesse (solo riusate, non modificate).
4. **Passata 4 — scenari tracciati a mano**: i tre scenari sopra (Bug 1 prima/dopo, Bug 2 prima/dopo, retrocompatibilità) più una verifica esplicita che il bootstrap non possa mai piazzare più di una sessione per run (il ciclo `for(let d=1;d<=days&&!piazzata;d++)` si ferma al primo `piazzata=true`, stessa guardia usata dal ramo con ancora).
5. **Passata 5 — confronto incrociato fra le quattro fonti**: `CLAUDE.md` (sezione Scheduling engine, nuovo paragrafo "Origine manuale vs generata" + bootstrap aggiunto al bullet Passata 1; "Sessioni states" aggiornato), `CONTESTO.md` (Cronologia voce 37 con causa reale e correzione, Backlog voce "Ciclo F1.1" sotto Ciclo F, Registro delle decisioni voci 67-69), questo file, il codice reale — stessi nomi di campo/funzione (`origine`, `'manuale'`/`'generata'`) in tutte e quattro le fonti, nessuna incongruenza propria di questo ciclo trovata.

Nessuna passata aggiuntiva ha trovato nulla di nuovo dopo la quinta: verifica chiusa a 5 passate.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna oltre al prompt di apertura del ciclo, che specificava già in dettaglio i due bug, il comportamento atteso per ciascuno, l'indagine richiesta prima di correggere (con l'ipotesi di partenza da verificare, non da assumere vera), e la chiusura ciclo completa (check-sintassi.js, verifica automatica con elenco fatto/resta, copertura del collaudo sugli stati sessione, CLAUDE.md/CONTESTO.md, registro di sessione, commit e push).

*Domande poste a Simone e risposte ricevute:* nessuna in questo ciclo — il prompt copriva già i casi rilevanti, incluso il chiedere esplicitamente di riportare la causa reale se l'ipotesi fornita fosse risultata sbagliata (è quanto accaduto: vedi "Causa reale" sopra). Tre decisioni implementative non specificate esplicitamente nel prompt sono state prese e dichiarate: la ricerca del bootstrap su tutti i giorni del mese (non un giorno fisso), il campo `origine` esplicito invece di un'euristica sul testo delle note, e `origine` marcata solo alla creazione (non su ogni edit).

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 67-69 (bootstrap su tutti i giorni del mese, non un giorno fisso; campo `origine` esplicito invece di un'euristica su `note`; `origine` impostata solo alla creazione, mai in un'edit successiva).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| Bug 1 | Generazione non si ferma più con 0 sessioni quando non esiste lezione precedente | ✅ Fatto | nuovo ramo di bootstrap in `generateMonth` |
| Bug 1 | Prima sessione nel primo giorno utile del mese, rispettando tutte le regole esistenti | ✅ Fatto | riusa `effRng`/`sceglieOperatoreEAula`/`rfreeConGap`, stesse regole della modalità settimanale |
| Bug 1 | Sessioni successive a cascata rispettando la finestra 12-16/23-30 già implementata | ✅ Verificato | nessuna modifica a `ultimaLezioneValida`/finestra, già esistenti dal Ciclo F.1 |
| Bug 2 | Indagine della causa reale PRIMA di correggere, con verifica esplicita dell'ipotesi fornita | ✅ Fatto | vedi sezione "Causa reale" — l'ipotesi sull'ordine cancellazione/ricerca non era quella esatta |
| Bug 2 | Ricerca dell'ancora prima di qualunque cancellazione | N/D | non applicabile alla causa reale trovata: il problema non era l'ordine di esecuzione ma la definizione di `keep`, corretta a monte |
| Bug 2 | Sessioni manuali mai eliminate dalla rigenerazione, qualunque stato | ✅ Fatto | `origine!=='manuale'` in `sessioniDaConservare`/`proposteDaSostituire` |
| Bug 2 | Campo origine con retrocompatibilità (assente → "generata") | ✅ Fatto | `openSessionModal` (`isNew`) vs. i tre punti di generazione automatica |
| Bug 2 | Lezione manuale usata come ancora se compatibile con la cadenza | ✅ Verificato | effetto automatico della correzione a monte |
| Chiusura | `check-sintassi.js` esteso e passante, copertura stati sessione (proposta/confermata/esiti) | ✅ Fatto | 4 nuovi casi (126 totali) — la protezione origine si applica solo a `proposta`, gli altri stati erano già sempre protetti indipendentemente dall'origine (invariato) |
| Chiusura | CLAUDE.md/CONTESTO.md aggiornati, Registro di sessione | ✅ Fatto | questa voce |

**Cosa manca**: bootstrap non implementato in `generateMonthAI` (stesso limite F.2 della modalità a distanza di giorni in generale, già dichiarato fuori scopo dal Ciclo F.1 — non ampliato da questo hotfix). Non eseguibile in questo ambiente: nessun test dal vivo con login M365/browser reale — il collaudo più utile per Simone è esattamente lo scenario che ha segnalato il bug (progetto quindicinale nuovo, generare con algoritmo, verificare la prima sessione piazzata; poi inserire a mano una sessione su un altro progetto quindicinale nuovo e rigenerare, verificando che sopravviva e che la successiva venga calcolata da quella).

## Limiti di questa verifica

I due scenari (Bug 1, Bug 2) e la retrocompatibilità sono stati tracciati a mano leggendo il codice con valori concreti, non osservati in esecuzione reale — nessun ambiente con login M365/browser disponibile qui. Le funzioni pure coinvolte (`proposteDaSostituire`, `ultimaLezioneValida`) sono invece verificate con `check-sintassi.js`, che le esegue realmente con `node --check` + casi concreti. Il ramo di bootstrap stesso resta verificato solo per lettura/ragionamento (non estraibile in sandbox, vedi sopra): si raccomanda a Simone di ripetere dal vivo il test esatto che ha fatto emergere il Bug 1 (progetto quindicinale nuovo, "Genera con algoritmo") e di verificare a schermo che la prima sessione compaia nel giorno atteso, oltre al test del Bug 2 descritto in "Cosa manca".

## Discrepanze da discutere

Nessuna discrepanza aperta in questo ciclo: entrambi i bug sono stati riprodotti a mano leggendo il codice, la causa reale del Bug 2 è risultata diversa dall'ipotesi del prompt (segnalato sopra, non nascosto) ma pienamente coerente con il sintomo descritto da Simone.

---

# Verifica — Ciclo F1.2: HOTFIX bootstrap quindicinale — cascata intra-mese + aggancio cross-mese

Data: 2026-07-21. HOTFIX del bootstrap introdotto dal Ciclo F1.1, emerso dal collaudo di Simone su "prova 4 psico" (progetto quindicinale, generazione di settembre 2026). Tocca solo il blocco quindicinale/mensile di `generateMonth` (confermato col diff: due soli hunk, righe 2234-2373, nessun altro punto del file toccato); nessuna migrazione, nessun tocco a `generateMonthAI`/Passata 3/modalità settimanale.

## Sintomo riportato da Simone

Progetto quindicinale "prova 4 psico", nessuna lezione pregressa, generazione di settembre 2026: il bootstrap (Ciclo F1.1) ha piazzato correttamente la prima sessione (**venerdì 4 settembre** — verificato con `dname`/`getDay` in Node, non assunto a memoria: coincide esattamente con la data reale del test di Simone). Non ha piazzato la seconda, attesa 12-16 giorni dopo (~16-20 settembre), pur essendo quella data ancora dentro il mese generato.

## Indagine richiesta prima di correggere: come termina il bootstrap oggi, come itera il ramo con ancora

Rilette entrambe le strutture prima di scrivere qualunque modifica:
- **Il ramo bootstrap** (Ciclo F1.1): un `for(let d=1;d<=days&&!piazzata;d++)` che scorre i giorni del mese; alla prima sessione piazzata mette `piazzata=true`, la guardia del `for` (`&&!piazzata`) interrompe il ciclo, e non c'è alcun codice successivo che tenti una seconda sessione — il flusso finisce lì, delegando esplicitamente (per commento nel codice) "le sessioni successive... ai run dei mesi successivi".
- **Il ramo con ancora** (Ciclo F.1, invariato prima di questo ciclo): calcola **una sola** candidata (`candidata=slittaGiornoValido(addGiorni(ultima,min),chiusureDates)`) a partire dall'ancora (`ultima`, da `ultimaLezioneValida`), la tenta, e si ferma — non c'era alcun meccanismo di ripetizione neppure lì, semplicemente perché ogni run di `generateMonth` chiama questo codice una volta sola per progetto, e la "ripetizione" avviene solo a distanza di run (mese dopo mese), non dentro allo stesso run.

**Punto di innesto individuato**: il ramo con ancora calcola-e-tenta esattamente l'operazione di cui il bootstrap ha bisogno per proseguire dopo la prima sessione — la stessa identica candidata-da-distanza-minima, lo stesso identico piazzamento in un solo giorno esatto. Bastava estrarla in una funzione richiamabile e richiamarla in un ciclo dal bootstrap, usando la sessione appena piazzata come nuovo ancoraggio ad ogni iterazione, fino a quando la candidata non esce dal mese o non trova più uno slot compatibile.

## Cosa è stato fatto

- Estratta `tentaProssimaLezioneDistanza(ancora)`: dato un ancoraggio (una data reale da `ultimaLezioneValida`, o una sessione appena piazzata dal bootstrap), calcola la candidata (`slittaGiornoValido(addGiorni(ancora,min),...)`), verifica la finestra (`finestraOk`/`giorniTraDate`, stesso avviso se lo slittamento la porta fuori range), e:
  - se la candidata è in un mese precedente a `ms` → avviso "già scaduta", nessun piazzamento (`oltreMese:false`);
  - se è in un mese successivo a `ms` → nessun piazzamento, `oltreMese:true` (segnale di stop per un'eventuale cascata);
  - se cade in `ms` → tenta il piazzamento in quel giorno esatto con la stessa identica logica di sempre (`effRng`, `rfreeConGap`, `sceglieOperatoreEAula`, `creaSessionePiazzata`, controllo ore contrattuali Assunto) — un solo giorno tentato, nessuna ricerca di alternative nella finestra (limite Ciclo F.1 invariato).
  - Restituisce `{piazzata,data,oltreMese,diagNoUtente,diagAulaPiena,diagNessunOperatore,giorniNoUtente}` (contatori locali alla chiamata, non condivisi fra chiamate — ogni tentativo ha i propri, per un riepilogo corretto per occorrenza).
- **Ramo con ancora**: ora una singola chiamata `tentaProssimaLezioneDistanza(ultima)` — stesso comportamento di prima, stesso testo, stessi effetti, solo spostato dentro la funzione condivisa (confrontato riga per riga col codice precedente).
- **Ramo bootstrap**: invariato fino al primo piazzamento; se piazzata, invece di fermarsi, entra in un `while(continua)` che richiama `tentaProssimaLezioneDistanza(ancora)` partendo da `ancora=primaData` (la data appena piazzata dal bootstrap), avanzando `ancora` a ogni sessione piazzata (`r.piazzata` → `ancora=r.data`) e fermandosi (`continua=false`) al primo tentativo non piazzato (per `oltreMese` o per mancanza di slot compatibile quel giorno) — mai un salto al tentativo "successivo" quando uno fallisce (coerente col limite già esistente sul ramo con ancora, decisione 61/70 in `CONTESTO.md`).
- Un riepilogo (`riepiloghi.push`) per ogni tentativo (bootstrap iniziale incluso), non più uno solo per progetto — necessario perché ora un progetto bootstrappato può avere più occorrenze piazzate nello stesso run; ciascuna riga porta i contatori diagnostici propri di quel tentativo specifico.

| Punto | Stato |
|---|---|
| Bootstrap piazza la prima sessione come già faceva (invariato) | ✅ Verificato — nessuna modifica al codice prima del primo piazzamento |
| Subito dopo, senza fermarsi, calcola a cascata le successive nella finestra 12-16/23-30 | ✅ Fatto (`while` su `tentaProssimaLezioneDistanza`) |
| Piazza TUTTE le occorrenze che ricadono ancora nel mese di generazione | ✅ Fatto — si ferma solo per `oltreMese` o mancanza di slot, mai per un tetto arbitrario |
| Ogni occorrenza rispetta tutte le regole esistenti (disponibilità, sedi, chiusure, orari, gap, aula) | ✅ Verificato — stessa `tentaProssimaLezioneDistanza` usata dal ramo con ancora, nessuna logica alternativa |
| Nessuna duplicazione di codice: confluisce nel ramo di calcolo-da-ancora esistente | ✅ Fatto — funzione condivisa, non due copie |
| Continuità cross-mese dei run successivi invariata (nessuna regressione) | ✅ Verificato — il ramo con ancora resta a una sola chiamata, comportamento Ciclo F.1 identico |
| Nessuna migrazione, nessun tocco a `generateMonthAI`/Passata 3/modalità settimanale | ✅ Verificato (`git diff`, due soli hunk) |

### Scenario tracciato a mano, con le date reali del test di Simone (settembre 2026, progetto quindicinale)

Tutte le date verificate con `dname`/`getDay` in Node (non assunte a memoria), usando la stessa logica di `dateToISO`/`addGiorni` del codice sorgente (non `toISOString()`, che introdurrebbe uno sfasamento di fuso orario — errore commesso e corretto durante questa stessa verifica, vedi nota sotto).

1. **Bootstrap**: prima sessione piazzata venerdì **04/09/2026** (coincide con il test reale di Simone).
2. **Cascata, 1° giro**: `ancora=04/09`, candidata = `slittaGiornoValido(addGiorni('2026-09-04',12))` = **16/09/2026** (mercoledì, non domenica né chiusura, nessuno slittamento) → `candidataYM='2026-09'===ms` → tentativo di piazzamento quel giorno; assumendo operatore/utente disponibili, piazzata. `giorniTraDate(04/09,16/09)=12`, dentro `[12,16]`.
3. **Cascata, 2° giro**: `ancora=16/09`, candidata = **28/09/2026** (lunedì) → ancora dentro settembre (30 giorni nel mese) → tentativo, piazzata. Distanza 12, dentro finestra.
4. **Cascata, 3° giro (fine cascata)**: `ancora=28/09`, candidata = **10/10/2026** (sabato) → `candidataYM='2026-10'` ≠ `ms='2026-09'` → `oltreMese:true`, nessun piazzamento, `continua=false`: la cascata di settembre si ferma con **3 sessioni piazzate** (04, 16, 28/09).
5. **Continuità cross-mese**: al run di ottobre, `ultimaLezioneValida(keep,p.id)` trova **28/09** come sessione più recente valida del progetto (l'unica fra le tre di settembre più recente); il ramo con ancora (una sola chiamata, invariato) calcola `tentaProssimaLezioneDistanza('2026-09-28')` → stessa identica candidata **10/10/2026** che aveva fermato la cascata di settembre. **Nessun buco** (la distanza resta 12 giorni, dentro `[12,16]`, nessun avviso di finestra) e **nessun doppione** (10/10 è strettamente successiva alle tre sessioni di settembre, mai ricalcolata o ripiazzata). Verificato anche l'inverso: se ottobre venisse generato PRIMA che settembre fosse mai stato generato (scenario non realistico nell'uso normale, ma verificato per sicurezza), `ultimaLezioneValida` troverebbe comunque null e attiverebbe di nuovo il bootstrap per ottobre, con lo stesso comportamento — nessuno stato "a metà" possibile.

**Nota metodologica**: durante la preparazione di questo scenario, un primo script di verifica ad-hoc (fuori da `index.html`, solo per calcolare le date) usava `new Date(...).toISOString().slice(0,10)` per convertire le date, che ha prodotto un risultato sbagliato di un giorno (28/09+12 → 09/10 invece di 10/10) per uno sfasamento di fuso orario introdotto da `toISOString()` (converte in UTC, mentre `dateToISO()` nel codice sorgente usa sempre i componenti locali `getFullYear/getMonth/getDate`). Individuato e corretto **prima** di scrivere i test in `check-sintassi.js`, rifacendo il calcolo con la stessa identica logica di `dateToISO`/`addGiorni` del file reale — le date nei test sotto sono quindi verificate con la logica corretta, non con lo script inizialmente sbagliato.

## Estensione di `check-sintassi.js`

9 nuovi casi (126→135 totali), tutti nella stessa sezione dedicata a Ciclo F1.2. Non estratta `tentaProssimaLezioneDistanza` in isolamento: chiude su troppo stato di `generateMonth` (`opB`/`prB`/`auB`/`newS`/`anom`/`pool`/`sessionCount`/`allPU`), stessa limitazione già documentata per il ramo di bootstrap del Ciclo F1.1 — estrarla avrebbe richiesto o riscriverla con una sandbox che replica tutto quello stato (rischio di testare una copia, non il codice reale) o cambiarne la firma con dozzine di parametri solo per la testabilità (decisione 72, `CONTESTO.md`). I nuovi test compongono invece le stesse primitive pure già estratte (`addGiorni`/`slittaGiornoValido`/`giorniTraDate`/`finestraOk`) con le date reali del test di Simone, in due scenari: (1) **cascata intra-mese** — la catena 04/09→16/09→28/09 resta dentro settembre, la successiva (10/10) ne esce; (2) **continuità cross-mese** — la candidata che ferma la cascata di settembre coincide esattamente con quella che il run di ottobre calcolerebbe dall'ancora 28/09, nessun buco (distanza dentro finestra) e nessun doppione (data strettamente crescente).

## Metodo di verifica: multi-passata

1. **Passata 1 — per punto del prompt**: rilette singolarmente le richieste (bootstrap piazza la prima come oggi, poi cascata senza fermarsi, tutte le occorrenze nel mese, nessuna regola aggirata, nessuna duplicazione — confluenza nel ramo con ancora, continuità cross-mese invariata, indagine richiesta prima di correggere, almeno due nuovi casi di test, chiusura ciclo) — vedi tabella sopra, tutte soddisfatte.
2. **Passata 2 — coerenza interna di `index.html`**: `node check-sintassi.js` (3 blocchi `<script>` OK, 135 test funzionali, tutti passano); `git diff index.html` mostra solo due hunk (righe 2234-2373), confermando che nessun'altra parte del file (Passata 2/3, `generateMonthAI`, modalità settimanale, liste SharePoint, stati sessione) è stata toccata.
3. **Passata 3 — rilettura completa della nuova funzione**: verificato che `tentaProssimaLezioneDistanza` sia byte-per-byte la stessa logica che il ramo con ancora aveva prima (stesso ordine di controlli: finestra → scaduta → non ancora dovuta → ricerca slot → contratto Assunto → creazione sessione → registri di occupazione), solo racchiusa in una funzione con contatori locali (`diagNoUtenteL` ecc., invece delle variabili condivise di prima) e un valore di ritorno strutturato al posto delle variabili mutate in-place.
4. **Passata 4 — scenari tracciati a mano**: la catena di cinque passi sopra (bootstrap, due cascate, fine cascata, ripresa cross-mese), con tutte le date verificate in Node con la stessa logica del codice sorgente (non `toISOString()`, errore individuato e corretto durante questa stessa verifica, vedi nota metodologica sopra).
5. **Passata 5 — confronto incrociato fra le quattro fonti**: `CLAUDE.md` (bullet bootstrap riscritto: "non si ferma più alla prima", cascata + nota sul limite non esteso del ramo con ancora, segnalata per F.2), `CONTESTO.md` (Cronologia voce 38 con causa/correzione/verifica cross-mese, Backlog "Ciclo F1.2" sotto Ciclo F, Registro delle decisioni voci 70-72), questo file, il codice reale — stessi nomi (`tentaProssimaLezioneDistanza`, `oltreMese`, `primaData`) in tutte e quattro le fonti.

Nessuna passata aggiuntiva ha trovato nulla di nuovo dopo la quinta: verifica chiusa a 5 passate.

## Registro di sessione

*Istruzioni date da Simone in sessione, oltre al prompt iniziale:* nessuna oltre al prompt di apertura del ciclo, che specificava già in dettaglio il sintomo osservato dal vivo (prima sessione piazzata, seconda mancante), il comportamento atteso (fix A: cascata confluendo nel ramo con ancora, senza duplicare codice), l'indagine richiesta prima di correggere (mostrare come termina il bootstrap e come itera il ramo con ancora), la richiesta esplicita di segnalare — non forzare una soluzione — se fosse emerso un rischio di doppione cross-mese, e la chiusura ciclo completa.

*Domande poste a Simone e risposte ricevute:* nessuna in questo ciclo — il prompt copriva già i casi rilevanti. Una decisione implementativa non specificata esplicitamente nel prompt è stata presa e dichiarata: la cascata si ferma alla prima candidata non piazzabile (nessun salto al tentativo "successivo"), per coerenza col limite già esistente sul ramo con ancora.

*Decisioni prese di conseguenza:* vedi `CONTESTO.md`, Registro delle decisioni, voci 70-72 (cascata che si ferma alla prima candidata non piazzabile; ramo con ancora non esteso, solo segnalato per F.2; funzione condivisa come closure invece che pura-ma-estraibile).

## Verifica automatica per punto del prompt

| Punto | Richiesta | Stato | Nota |
|---|---|---|---|
| Indagine | Mostrare come termina oggi il bootstrap e come itera il ramo con ancora, per individuare il punto di confluenza | ✅ Fatto | vedi sezione dedicata sopra |
| Fix A | Bootstrap piazza la prima come oggi | ✅ Invariato | nessuna modifica al codice prima del primo piazzamento |
| Fix A | Subito dopo, senza fermarsi, cascata alla cadenza quindicinale/mensile | ✅ Fatto | `while` su `tentaProssimaLezioneDistanza` |
| Fix A | Piazza TUTTE le occorrenze ancora nel mese, rispettando tutte le regole | ✅ Fatto | stessa funzione del ramo con ancora, nessuna regola aggirata |
| Fix A | Nessuna duplicazione: confluisce nel ramo di calcolo-da-ancora esistente | ✅ Fatto | `tentaProssimaLezioneDistanza` condivisa |
| Invariato | Continuità cross-mese dei mesi successivi come già avviene oggi | ✅ Verificato | ramo con ancora a singola chiamata, invariato |
| Aggancio cross-mese | Nessun buco né doppione sul confine fra mesi | ✅ Verificato | scenario tracciato a mano, passo 5 |
| Aggancio cross-mese | Se emerge un rischio non coperto, segnalarlo per F.2 invece di forzarne la soluzione | ✅ Fatto | segnalato: il ramo con ancora resta a una sola candidata/run anche quando la cadenza ne ammetterebbe una seconda nello stesso mese — limite preesistente (F.1), non generalizzato da F1.2 |
| Chiusura | `check-sintassi.js` con almeno 2 nuovi casi (cascata intra-mese, continuità cross-mese) | ✅ Fatto | 9 nuovi casi, 135 totali |
| Chiusura | CLAUDE.md/CONTESTO.md aggiornati, Registro di sessione, commit e push | ✅ Fatto | questa voce; commit/push in coda |

**Cosa manca**: nessuna lacuna sui punti richiesti da F1.2. Segnalato (non corretto qui, per esplicita richiesta di non forzare soluzioni fuori ambito): il ramo con ancora reale resta limitato a una sola candidata per run anche quando la cadenza ne ammetterebbe una seconda nello stesso mese — stesso limite F.1 (decisione 61), qui solo confermato non esteso, candidato per il Ciclo F.2. Non eseguibile in questo ambiente: nessun test dal vivo con login M365/browser reale — il collaudo più utile per Simone è rigenerare esattamente "prova 4 psico" per settembre 2026 e verificare a schermo che compaiano ora tre sessioni (04, 16, 28/09) invece di una sola, poi generare ottobre e verificare che la prima sessione di ottobre cada il 10/10 senza doppioni.

## Limiti di questa verifica

La catena di cinque passi (bootstrap, due cascate, fine cascata, ripresa cross-mese) è stata tracciata a mano leggendo il codice con valori concreti e verificando le date con Node, non osservata in esecuzione reale — nessun ambiente con login M365/browser disponibile qui. Le primitive pure sottostanti (distanza in giorni, verifica finestra, slittamento) sono invece verificate con `check-sintassi.js`, che le esegue realmente. La funzione `tentaProssimaLezioneDistanza` nel suo insieme (inclusa la ricerca effettiva di operatore/aula/utente disponibili in un giorno reale) resta verificata solo per lettura/ragionamento, non esistendo dati reali (operatori, disponibilità, aule) in questo ambiente con cui simulare un piazzamento vero. Si raccomanda a Simone di ripetere dal vivo il test che ha fatto emergere il bug ("prova 4 psico", settembre 2026) e verificare a schermo il numero di sessioni piazzate e le loro date esatte.

## Discrepanze da discutere

Nessuna discrepanza aperta in questo ciclo. Segnalazione per il Ciclo F.2 (non una discrepanza di questo ciclo, un limite dichiarato e confermato, non esteso): il ramo con ancora reale (progetti già avviati) resta a una sola candidata per run anche quando la cadenza ammetterebbe matematicamente una seconda occorrenza nello stesso mese — stesso limite architetturale del Ciclo F.1, qui solo verificato e confermato per il caso bootstrap, non generalizzato.
