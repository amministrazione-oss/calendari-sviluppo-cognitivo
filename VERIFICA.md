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
