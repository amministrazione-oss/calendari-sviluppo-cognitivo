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
