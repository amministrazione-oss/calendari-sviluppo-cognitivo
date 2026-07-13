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
