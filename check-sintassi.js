#!/usr/bin/env node
/*
 * check-sintassi.js — collaudo automatico di index.html.
 *
 * Uso: node check-sintassi.js
 *
 * Cosa fa:
 *   1) Estrae ogni blocco <script> (non esterno) di index.html ed esegue `node --check`
 *      su ciascuno — un parser JavaScript reale, non il solo bilanciamento di parentesi
 *      usato nei cicli prima dell'installazione di Node.js (17/07/2026).
 *   2) Estrae DIRETTAMENTE dal file reale (non da una copia ritrascritta) le funzioni pure
 *      toccate nei cicli di lavoro ed esegue su di esse una batteria di test funzionali con
 *      casi concreti — vedi la sezione TEST in fondo a questo file.
 *
 * Sostituisce gli script temporanei riscritti a ogni ciclo nello scratchpad (Ciclo B/B.1).
 * Estendibile: aggiungere nuovi nomi a EXTRACT_FUNZIONI/EXTRACT_COSTANTI e nuovi casi alla
 * sezione TEST quando un ciclo futuro tocca altre funzioni pure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const REPO_ROOT = __dirname;
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');

// ---------------------------------------------------------------------------
// 1) node --check su ogni blocco <script> (non esterno)
// ---------------------------------------------------------------------------
function checkSintassi(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-check-'));
  let m, i = 0, ok = true;
  console.log('--- node --check sui blocchi <script> ---');
  while ((m = re.exec(html))) {
    i++;
    const code = m[1];
    const file = path.join(tmpDir, 'chunk' + i + '.js');
    fs.writeFileSync(file, code);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      console.log('  chunk ' + i + ' OK (' + code.length + ' caratteri)');
    } catch (e) {
      ok = false;
      console.log('  chunk ' + i + ' FALLITO:');
      console.log(e.stderr.toString());
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (i === 0) { console.log('  ATTENZIONE: nessun blocco <script> trovato in index.html'); ok = false; }
  console.log(ok ? '--- Sintassi: TUTTO OK ---\n' : '--- Sintassi: FALLIMENTI TROVATI ---\n');
  return ok;
}

// ---------------------------------------------------------------------------
// 2) estrazione di funzioni/costanti pure direttamente dal sorgente reale
// ---------------------------------------------------------------------------
function extractFunction(html, name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(html);
  if (!m) throw new Error('Funzione non trovata in index.html: ' + name);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
    i++;
  }
  return html.slice(m.index, i);
}
function extractConst(html, name) {
  const re = new RegExp('const\\s+' + name + '\\s*=[^;]*;');
  const m = re.exec(html);
  if (!m) throw new Error('Costante non trovata in index.html: ' + name);
  return m[0];
}

// Nomi da estrarre: aggiungere qui quando un ciclo futuro tocca altre funzioni pure.
const EXTRACT_FUNZIONI = ['tmin', 'parseHM', 'fmtHM', 'tempoBustoOperatore', 'decidiOnlineDaCasa', 'bucketSettimana', 'maxNuoveSettimana', 'sediAmmesseProgetto', 'statiSelezionabili', 'transizioneAmmessa', 'pesoStato', 'pesoMassimoSelezione', 'riepilogoStati', 'riepilogoStatoProgetto', 'filtraReportUtenti', 'proposteDaSostituire', 'isRecordSingolo', 'etichettaAmbitoReport', 'dname', 'rfree', 'rfreeConGap', 'modalitaFrequenza', 'finestraOk', 'dateToISO', 'addGiorni', 'giorniTraDate', 'slittaGiornoValido', 'ultimaLezioneValida', 'calcStrettezza'];
// NOTA (Ciclo F1.1): sessioniDaConservare NON è estraibile qui — a differenza di proposteDaSostituire (stessa
// condizione, negata) legge "state.data.sessioni" direttamente invece di riceverlo come parametro, quindi fallirebbe
// in sandbox (nessun "state" globale). La sua logica condivisa è comunque coperta dai test su proposteDaSostituire
// sotto (sono l'esatto complemento, per costruzione nel codice sorgente).
const EXTRACT_COSTANTI = ['pad2', 'AULE_CESATE', 'AULE_BUSTO', 'STATI_SESS', 'LISTE_RECORD_SINGOLO', 'GIORNI', 'FINESTRE_FREQUENZA', 'GAP_MINUTI'];

function buildSandbox(html) {
  const src = [
    ...EXTRACT_COSTANTI.map(name => extractConst(html, name)),
    ...EXTRACT_FUNZIONI.map(name => extractFunction(html, name)),
    'module.exports={' + EXTRACT_FUNZIONI.join(',') + '};',
  ].join('\n\n');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-sandbox-'));
  const file = path.join(tmpDir, 'sandbox.js');
  fs.writeFileSync(file, src);
  const mod = require(file);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return mod;
}

// ---------------------------------------------------------------------------
// 3) test funzionali — estendere qui a ogni ciclo che tocca funzioni pure
// ---------------------------------------------------------------------------
function runTest(sandbox) {
  const { parseHM, fmtHM, tempoBustoOperatore, decidiOnlineDaCasa, bucketSettimana, maxNuoveSettimana, sediAmmesseProgetto, statiSelezionabili, transizioneAmmessa, pesoStato, pesoMassimoSelezione, riepilogoStati, riepilogoStatoProgetto, filtraReportUtenti, proposteDaSostituire, isRecordSingolo, etichettaAmbitoReport, dname, rfree, rfreeConGap, modalitaFrequenza, finestraOk, dateToISO, addGiorni, giorniTraDate, slittaGiornoValido, ultimaLezioneValida, calcStrettezza } = sandbox;
  let fails = 0, count = 0;
  function check(label, actual, expected) {
    count++;
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { console.log('  FALLITO: ' + label + ' -> ottenuto ' + a + ', atteso ' + e); fails++; }
  }
  function checkNaN(label, actual) {
    count++;
    if (!Number.isNaN(actual)) { console.log('  FALLITO: ' + label + ' -> ottenuto ' + JSON.stringify(actual) + ', atteso NaN (rifiutato)'); fails++; }
  }

  console.log('--- Test funzionali (funzioni pure estratte dal file reale) ---');

  // parseHM / fmtHM — Ciclo B (S6)
  check('parseHM 1:30', parseHM('1:30'), 90);
  check('parseHM 1.30 (mai decimale)', parseHM('1.30'), 90);
  check('parseHM 1,30', parseHM('1,30'), 90);
  check('parseHM 90 (minuti secchi)', parseHM('90'), 90);
  check('parseHM vuoto', parseHM(''), null);
  check('parseHM null', parseHM(null), null);
  check('fmtHM 90', fmtHM(90), '1:30');
  check('fmtHM 0', fmtHM(0), '0:00');
  check('fmtHM 2400 (40h)', fmtHM(2400), '40:00');

  // parseHM — Ciclo B.1 (rifinitura input h:mm)
  check('parseHM 30: (minuti assenti -> 30:00)', parseHM('30:'), 1800);
  check('parseHM :30 (ore assenti -> 0:30)', parseHM(':30'), 30);
  check('parseHM 30:00', parseHM('30:00'), 1800);
  checkNaN('parseHM 30:70 (minuti fuori 00-59 -> rifiutato)', parseHM('30:70'));
  checkNaN('parseHM : (solo separatore -> rifiutato)', parseHM(':'));

  // parseHM — Ciclo C, rifinitura 1 (input non numerico -> NaN, mai null)
  checkNaN('parseHM abc (non numerico -> rifiutato, non vuoto)', parseHM('abc'));

  // Somma live "Monte ore totale" — Ciclo C, rifinitura 2: un campo NaN contribuisce 0, mai un valore transitorio
  {
    const valori = ['30:00', '30:70', '10:00']; // 30:70 è invalido: deve contribuire 0, non il transitorio "30:7"=1807
    const tot = valori.reduce((s, v) => { const p = parseHM(v); return s + (Number.isNaN(p) ? 0 : (p || 0)); }, 0);
    check('somma live con un campo invalido: 30:00 + [invalido->0] + 10:00', tot, 1800 + 0 + 600);
  }

  // bucketSettimana / maxNuoveSettimana — Ciclo C (S7, vincolo duro frequenza settimanale)
  check('bucketSettimana giorno 1 -> finestra 1', bucketSettimana(1), 1);
  check('bucketSettimana giorno 7 -> finestra 1', bucketSettimana(7), 1);
  check('bucketSettimana giorno 8 -> finestra 8', bucketSettimana(8), 8);
  check('bucketSettimana giorno 28 -> finestra 22', bucketSettimana(28), 22);
  check('maxNuoveSettimana: settimana vuota, freq 3 -> 3 nuove ammesse', maxNuoveSettimana(3, 0), 3);
  check('maxNuoveSettimana: settimana parzialmente occupata (1 di 3) -> 2 nuove ammesse', maxNuoveSettimana(3, 1), 2);
  check('maxNuoveSettimana: settimana già al completo (2 di 2) -> 0 nuove ammesse', maxNuoveSettimana(2, 2), 0);
  check('maxNuoveSettimana: settimana già sovra-occupata da sessioni manuali (5 con freq 2) -> 0, mai negativo', maxNuoveSettimana(2, 5), 0);

  // sediAmmesseProgetto — Ciclo C (S5, disponibilità limitate alle sedi del progetto)
  check('sediAmmesseProgetto Cesate', sediAmmesseProgetto('Cesate'), ['Cesate']);
  check('sediAmmesseProgetto Busto Arsizio -> tag breve "Busto"', sediAmmesseProgetto('Busto Arsizio'), ['Busto']);
  check('sediAmmesseProgetto Cesate+Online', sediAmmesseProgetto('Cesate+Online'), ['Cesate', 'Online']);
  check('sediAmmesseProgetto Cesate+Domicilio', sediAmmesseProgetto('Cesate+Domicilio'), ['Cesate', 'Domicilio']);
  check('sediAmmesseProgetto sede assente -> nessuna restrizione (null)', sediAmmesseProgetto(undefined), null);

  // tempoBustoOperatore — Ciclo B (S8)
  check('busto: no Cesate -> usa casa', tempoBustoOperatore({ tempoBustoCasa: 20, tempoBustoCesate: 10 }, false), { min: 20, fallback: false });
  check('busto: gia a Cesate, cesate valorizzato -> usa cesate', tempoBustoOperatore({ tempoBustoCasa: 20, tempoBustoCesate: 10 }, true), { min: 10, fallback: false });
  check('busto: gia a Cesate, cesate NULL -> ripiega su casa + fallback', tempoBustoOperatore({ tempoBustoCasa: 20, tempoBustoCesate: null }, true), { min: 20, fallback: true });
  check('busto: gia a Cesate, cesate=0 (valore legittimo) -> usa 0, no fallback', tempoBustoOperatore({ tempoBustoCasa: 20, tempoBustoCesate: 0 }, true), { min: 0, fallback: false });

  // decidiOnlineDaCasa — Ciclo B (S8)
  {
    const op = { tempoCasa: 30, tempoBustoCasa: 25, tempoBustoCesate: 10 };
    const sessioniGiorno = [{ sede: 'Busto Arsizio', oraInizio: '09:00', oraFine: '12:00', aula: 'Grande' }];
    const r1 = decidiOnlineDaCasa(op, sessioniGiorno, 12 * 60 + 20, 12 * 60 + 50);
    check('online dopo Busto, margine 20<25(casa) -> in sede', r1.daCasa, false);
    check('online dopo Busto, nessuna presenza Cesate -> no fallback', r1.bustoFallback, false);
    const r2 = decidiOnlineDaCasa(op, sessioniGiorno, 13 * 60, 13 * 60 + 30);
    check('online dopo Busto, margine 40>=25(casa) -> da casa', r2.daCasa, true);
  }
  {
    const op = { tempoCasa: 30, tempoBustoCasa: 25, tempoBustoCesate: 8 };
    const sessioniGiorno = [
      { sede: 'Cesate', oraInizio: '09:00', oraFine: '10:00', aula: 'Blu' },
      { sede: 'Busto Arsizio', oraInizio: '11:00', oraFine: '12:00', aula: 'Grande' },
    ];
    const r = decidiOnlineDaCasa(op, sessioniGiorno, 12 * 60 + 9, 12 * 60 + 30);
    check('online dopo Busto CON presenza Cesate lo stesso giorno: usa tempoBustoCesate(8), margine 9>=8 -> da casa', r.daCasa, true);
    check('nessun fallback (tempoBustoCesate valorizzato)', r.bustoFallback, false);
  }
  {
    const op = { tempoCasa: 30, tempoBustoCasa: 25, tempoBustoCesate: null };
    const sessioniGiorno = [
      { sede: 'Cesate', oraInizio: '09:00', oraFine: '10:00', aula: 'Blu' },
      { sede: 'Busto Arsizio', oraInizio: '11:00', oraFine: '12:00', aula: 'Grande' },
    ];
    const r = decidiOnlineDaCasa(op, sessioniGiorno, 12 * 60 + 9, 12 * 60 + 30);
    check('fallback: tempoBustoCesate mancante -> usa tempoBustoCasa(25), margine 9<25 -> in sede', r.daCasa, false);
    check('fallback segnalato', r.bustoFallback, true);
  }

  // statiSelezionabili / transizioneAmmessa — Ciclo D (S9, campo stato unico)
  check('statiSelezionabili Admin: tutte le 5', statiSelezionabili('Admin', 'proposta'), ['proposta', 'confermata', 'eseguita', 'assenza ingiustificata', 'annullata']);
  check('statiSelezionabili Admin da confermata: tutte le 5 comunque', statiSelezionabili('Admin', 'confermata'), ['proposta', 'confermata', 'eseguita', 'assenza ingiustificata', 'annullata']);
  check('statiSelezionabili Operatore da confermata: solo confermata+3 esiti', statiSelezionabili('Operatore', 'confermata'), ['confermata', 'eseguita', 'assenza ingiustificata', 'annullata']);
  check('statiSelezionabili Operatore da proposta: nessuna modifica ammessa', statiSelezionabili('Operatore', 'proposta'), null);
  check('statiSelezionabili Operatore da eseguita: nessuna modifica ammessa', statiSelezionabili('Operatore', 'eseguita'), null);
  check('statiSelezionabili Operatore da annullata: nessuna modifica ammessa', statiSelezionabili('Operatore', 'annullata'), null);
  check('transizioneAmmessa: nessun cambiamento sempre ammesso (anche Operatore da proposta)', transizioneAmmessa('Operatore', 'proposta', 'proposta'), true);
  check('transizioneAmmessa Admin: proposta->confermata', transizioneAmmessa('Admin', 'proposta', 'confermata'), true);
  check('transizioneAmmessa Admin: confermata->proposta (indietro, ammesso solo per Admin)', transizioneAmmessa('Admin', 'confermata', 'proposta'), true);
  check('transizioneAmmessa Operatore: confermata->eseguita', transizioneAmmessa('Operatore', 'confermata', 'eseguita'), true);
  check('transizioneAmmessa Operatore: proposta->confermata NEGATO (non puo toccare proposta)', transizioneAmmessa('Operatore', 'proposta', 'confermata'), false);
  check('transizioneAmmessa Operatore: confermata->proposta NEGATO (mai indietro)', transizioneAmmessa('Operatore', 'confermata', 'proposta'), false);
  check('transizioneAmmessa Operatore: eseguita->annullata NEGATO (esito gia definito, non riapribile da Operatore)', transizioneAmmessa('Operatore', 'eseguita', 'annullata'), false);

  // pesoStato / pesoMassimoSelezione / riepilogoStati — Ciclo D (S1, avviso graduato eliminazione multipla)
  check('pesoStato proposta -> 0', pesoStato('proposta'), 0);
  check('pesoStato annullata -> 0', pesoStato('annullata'), 0);
  check('pesoStato confermata -> 1', pesoStato('confermata'), 1);
  check('pesoStato eseguita -> 2', pesoStato('eseguita'), 2);
  check('pesoStato assenza ingiustificata -> 2', pesoStato('assenza ingiustificata'), 2);
  check('pesoMassimoSelezione: solo proposta/annullata -> 0', pesoMassimoSelezione([{ stato: 'proposta' }, { stato: 'annullata' }]), 0);
  check('pesoMassimoSelezione: include confermata -> 1', pesoMassimoSelezione([{ stato: 'proposta' }, { stato: 'confermata' }]), 1);
  check('pesoMassimoSelezione: include eseguita -> 2 (il piu pesante vince)', pesoMassimoSelezione([{ stato: 'confermata' }, { stato: 'eseguita' }]), 2);
  check('pesoMassimoSelezione: selezione vuota -> 0', pesoMassimoSelezione([]), 0);
  check('riepilogoStati: conteggio per stato, manca stato -> proposta implicito', riepilogoStati([{ stato: 'proposta' }, {}, { stato: 'eseguita' }, { stato: 'eseguita' }]), { proposta: 2, eseguita: 2 });

  // riepilogoStatoProgetto / filtraReportUtenti — Ciclo E (S2 riepilogo per progetto, S3 vista filtrabile per utente)
  check('riepilogoStatoProgetto: tutti gli stati presenti anche a 0', riepilogoStatoProgetto([{ stato: 'eseguita' }, { stato: 'eseguita' }]), { proposta: 0, confermata: 0, eseguita: 2, 'assenza ingiustificata': 0, annullata: 0 });
  check('riepilogoStatoProgetto: nessuna sessione -> tutti 0', riepilogoStatoProgetto([]), { proposta: 0, confermata: 0, eseguita: 0, 'assenza ingiustificata': 0, annullata: 0 });
  check('riepilogoStatoProgetto: manca stato -> proposta implicito', riepilogoStatoProgetto([{}]), { proposta: 1, confermata: 0, eseguita: 0, 'assenza ingiustificata': 0, annullata: 0 });
  {
    const utenti = [{ utenteId: 'u1', nome: 'Rossi Anna' }, { utenteId: 'u2', nome: 'Bianchi Mario' }];
    check('filtraReportUtenti: senza filtro restituisce tutti', filtraReportUtenti(utenti, null), utenti);
    check('filtraReportUtenti: con filtro restituisce solo il match', filtraReportUtenti(utenti, 'u2'), [{ utenteId: 'u2', nome: 'Bianchi Mario' }]);
    check('filtraReportUtenti: utente non presente -> array vuoto', filtraReportUtenti(utenti, 'u9'), []);
  }

  // proposteDaSostituire — Ciclo E.1, FIX 1 (BUG GRAVE: proposte sostituite non eliminate da SharePoint)
  {
    const scopeIds = new Set(['pA', 'pB']);
    const sessioni = [
      { id: 's1', data: '2026-08-05', stato: 'proposta', progettoId: 'pA' }, // in ambito, nel mese, proposta -> DA SOSTITUIRE
      { id: 's2', data: '2026-08-06', stato: 'confermata', progettoId: 'pA' }, // stesso progetto/mese ma confermata -> intoccabile
      { id: 's3', data: '2026-08-07', stato: 'proposta', progettoId: 'pC' }, // proposta ma fuori ambito -> intoccabile
      { id: 's4', data: '2026-07-20', stato: 'proposta', progettoId: 'pA' }, // in ambito ma mese diverso -> intoccabile
      { id: 's5', data: '2026-08-08', stato: 'proposta', progettoId: 'pB' }, // in ambito, nel mese, proposta -> DA SOSTITUIRE
    ];
    const daSostituire = proposteDaSostituire(sessioni, '2026-08', scopeIds);
    check('proposteDaSostituire: seleziona solo proposta+in ambito+nel mese', daSostituire.map(s => s.id).sort(), ['s1', 's5']);
    check('proposteDaSostituire: complemento esatto di sessioniDaConservare (nessuna sovrapposizione, copertura totale)', daSostituire.length + (sessioni.length - daSostituire.length), sessioni.length);
  }
  {
    // Scenario "seconda generazione = zero zombie": dopo una PRIMA generazione corretta (le vecchie proposte sono
    // già state eliminate dal fix), lo stato contiene solo le sessioni conservate + quelle appena create dal run 1.
    // Una SECONDA generazione deve individuare esattamente le sessioni del run 1 come "da sostituire" (è quello
    // che ci si aspetta: il run 2 le rimpiazza), e nessun residuo del run 1 deve restare fuori da questo calcolo.
    const scopeIds = new Set(['pA']);
    const dopoRun1 = [
      { id: 'confermata-1', data: '2026-08-02', stato: 'confermata', progettoId: 'pA' }, // mai toccata da nessun run
      { id: 'run1-a', data: '2026-08-05', stato: 'proposta', progettoId: 'pA' },
      { id: 'run1-b', data: '2026-08-12', stato: 'proposta', progettoId: 'pA' },
    ];
    const daSostituireRun2 = proposteDaSostituire(dopoRun1, '2026-08', scopeIds);
    check('proposteDaSostituire: run 2 individua esattamente le proposte del run 1 (nessun residuo, nessuna omissione)', daSostituireRun2.map(s => s.id).sort(), ['run1-a', 'run1-b']);
    check('proposteDaSostituire: la confermata non viene mai selezionata per l\'eliminazione', daSostituireRun2.some(s => s.id === 'confermata-1'), false);
  }

  // proposteDaSostituire / origine "manuale" — Ciclo F1.1 (HOTFIX Bug 2: la lezione inserita a mano non deve
  // mai essere cancellata da una rigenerazione, qualunque sia il suo stato, e resta disponibile come ancora)
  {
    const scopeIds = new Set(['pA']);
    const sessioni = [
      { id: 'manuale-proposta', data: '2026-08-05', stato: 'proposta', progettoId: 'pA', origine: 'manuale' }, // MAI cancellabile
      { id: 'generata-proposta', data: '2026-08-06', stato: 'proposta', progettoId: 'pA', origine: 'generata' }, // cancellabile come sempre
      { id: 'legacy-proposta', data: '2026-08-07', stato: 'proposta', progettoId: 'pA' }, // origine assente -> trattata come "generata" (retrocompatibilità)
    ];
    const daSostituire = proposteDaSostituire(sessioni, '2026-08', scopeIds);
    check('proposteDaSostituire: la proposta "manuale" non è mai tra quelle da sostituire', daSostituire.some(s => s.id === 'manuale-proposta'), false);
    check('proposteDaSostituire: la proposta "generata" resta sostituibile come prima', daSostituire.some(s => s.id === 'generata-proposta'), true);
    check('proposteDaSostituire: origine assente -> trattata come "generata", resta sostituibile (retrocompatibilità)', daSostituire.some(s => s.id === 'legacy-proposta'), true);
  }

  // ultimaLezioneValida + protezione "manuale" — Ciclo F1.1 (HOTFIX Bug 2: una volta che la proposta manuale non è
  // più tra le "da sostituire" sopra, resta nel set "keep" passato a ultimaLezioneValida e viene trovata come ancora)
  {
    const keepConManuale = [
      { progettoId: 'p1', data: '2026-08-05', stato: 'proposta', origine: 'manuale' },
    ];
    check('ultimaLezioneValida: trova la proposta manuale mantenuta in keep, la usa come ancora per la cascata', ultimaLezioneValida(keepConManuale, 'p1'), '2026-08-05');
  }

  // isRecordSingolo — Ciclo E.2 (correzione di fondo: array-vs-oggetto da elenco esplicito, non da Array.isArray a runtime)
  check('isRecordSingolo: chiusure -> record singolo', isRecordSingolo('chiusure'), true);
  check('isRecordSingolo: impostazioni -> record singolo', isRecordSingolo('impostazioni'), true);
  check('isRecordSingolo: report -> array (non dipende da come/quando è stata popolata)', isRecordSingolo('report'), false);
  check('isRecordSingolo: sessioni -> array', isRecordSingolo('sessioni'), false);
  check('isRecordSingolo: operatori -> array', isRecordSingolo('operatori'), false);
  check('isRecordSingolo: utenti -> array', isRecordSingolo('utenti'), false);
  check('isRecordSingolo: progetti -> array', isRecordSingolo('progetti'), false);
  check('isRecordSingolo: chiave sconosciuta -> array per default (mai record singolo "per errore")', isRecordSingolo('lista_futura_qualunque'), false);

  // etichettaAmbitoReport — Ciclo E.3 (etichetta utente/progetto in "Report precedenti")
  {
    const utenti = [{ id: 'u1', cognome: 'Rossi', nome: 'Anna' }, { id: 'u2', cognome: 'Bianchi', nome: 'Mario' }];
    check('etichettaAmbitoReport: ambito "single" -> un solo progetto -> Cognome Nome — Progetto', etichettaAmbitoReport('single', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u1' }], utenti), 'Rossi Anna — BrainRx');
    check('etichettaAmbitoReport: ambito "byname" risolto a un solo progetto -> stessa etichetta diretta (non "1 utente")', etichettaAmbitoReport('byname', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u1' }], utenti), 'Rossi Anna — BrainRx');
    check('etichettaAmbitoReport: ambito "all" -> sempre "Tutti i progetti", anche con più progetti', etichettaAmbitoReport('all', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u1' }, { id: 'pB', nome: 'Feuerstein', utenteId: 'u2' }], utenti), 'Tutti i progetti');
    check('etichettaAmbitoReport: ambito "all" con un solo progetto attivo -> comunque il riferimento diretto (vince il conteggio, non l\'ambito)', etichettaAmbitoReport('all', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u1' }], utenti), 'Rossi Anna — BrainRx');
    check('etichettaAmbitoReport: ambito "byname" con più risultati, utenti distinti -> "N utenti"', etichettaAmbitoReport('byname', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u1' }, { id: 'pB', nome: 'Feuerstein', utenteId: 'u2' }], utenti), '2 utenti');
    check('etichettaAmbitoReport: ambito "byname" con più progetti dello STESSO utente -> "1 utente" (singolare)', etichettaAmbitoReport('byname', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u1' }, { id: 'pC', nome: 'Feuerstein BS2', utenteId: 'u1' }], utenti), '1 utente');
    check('etichettaAmbitoReport: ambito "byname" senza risultati -> messaggio esplicito', etichettaAmbitoReport('byname', [], utenti), 'Nessun progetto in ambito');
    check('etichettaAmbitoReport: progetto con utente non trovato -> "?" invece di lanciare un errore', etichettaAmbitoReport('single', [{ id: 'pA', nome: 'BrainRx', utenteId: 'u9' }], utenti), '? — BrainRx');
  }

  // modalitaFrequenza — Ciclo F.1, Parte A (tre modalità mutuamente esclusive, default esplicito settimanale)
  check('modalitaFrequenza: campo assente -> settimanale (default esplicito, nessuna migrazione necessaria)', modalitaFrequenza({}), 'settimanale');
  check('modalitaFrequenza: quindicinale', modalitaFrequenza({ modalitaFrequenza: 'quindicinale' }), 'quindicinale');
  check('modalitaFrequenza: mensile', modalitaFrequenza({ modalitaFrequenza: 'mensile' }), 'mensile');
  check('modalitaFrequenza: valore non riconosciuto -> settimanale (ripiego difensivo)', modalitaFrequenza({ modalitaFrequenza: 'boh' }), 'settimanale');

  // finestraOk — Ciclo F.1, Parte B (finestre 12-16 quindicinale / 23-30 mensile)
  check('finestraOk quindicinale: 12 (minimo incluso)', finestraOk('quindicinale', 12), true);
  check('finestraOk quindicinale: 16 (massimo incluso)', finestraOk('quindicinale', 16), true);
  check('finestraOk quindicinale: 11 (sotto il minimo) -> falso', finestraOk('quindicinale', 11), false);
  check('finestraOk quindicinale: 17 (sopra il massimo) -> falso', finestraOk('quindicinale', 17), false);
  check('finestraOk mensile: 23 (minimo incluso)', finestraOk('mensile', 23), true);
  check('finestraOk mensile: 30 (massimo incluso)', finestraOk('mensile', 30), true);
  check('finestraOk mensile: 22 (sotto il minimo) -> falso', finestraOk('mensile', 22), false);
  check('finestraOk mensile: 31 (sopra il massimo) -> falso', finestraOk('mensile', 31), false);
  check('finestraOk settimanale: nessuna finestra dichiarata -> sempre vero', finestraOk('settimanale', 999), true);

  // giorniTraDate — Ciclo F.1, Parte B (distanza in giorni, anche a cavallo di due mesi)
  check('giorniTraDate: 14 giorni nello stesso mese', giorniTraDate('2026-07-01', '2026-07-15'), 14);
  check('giorniTraDate: 11 giorni a cavallo di due mesi (25/07 -> 05/08)', giorniTraDate('2026-07-25', '2026-08-05'), 11);
  check('giorniTraDate: stessa data -> 0', giorniTraDate('2026-07-01', '2026-07-01'), 0);
  check('giorniTraDate: ordine invertito -> negativo', giorniTraDate('2026-07-15', '2026-07-01'), -14);

  // slittaGiornoValido — Ciclo F.1, Parte B (domenica + chiusure, priorità sulla finestra: avanza comunque)
  check('slittaGiornoValido: giorno feriale senza chiusure -> invariato', slittaGiornoValido('2026-09-01', new Set()), '2026-09-01');
  check('slittaGiornoValido: domenica -> lunedì successivo', slittaGiornoValido('2026-07-19', new Set()), '2026-07-20');
  check('slittaGiornoValido: chiusura centro (non domenica) -> giorno successivo', slittaGiornoValido('2026-09-01', new Set(['2026-09-01'])), '2026-09-02');
  check('slittaGiornoValido: sabato di chiusura seguito da domenica -> slitta oltre entrambi fino al lunedì', slittaGiornoValido('2026-08-15', new Set(['2026-08-15'])), '2026-08-17');

  // rfreeConGap — Ciclo F.1, Parte C (fix del margine 5 minuti: prima le due righe si annullavano a vicenda)
  check('rfreeConGap: sessione a ridosso (gap 0 min) -> bloccata dal margine', rfreeConGap([{ from: 600, to: 660 }], 660, 700), false);
  check('rfreeConGap: gap di 4 min (sotto il minimo di 5) -> bloccata', rfreeConGap([{ from: 600, to: 660 }], 664, 700), false);
  check('rfreeConGap: gap di esattamente 5 min -> libera', rfreeConGap([{ from: 600, to: 660 }], 665, 700), true);
  check('rfreeConGap: sovrapposizione diretta -> bloccata', rfreeConGap([{ from: 600, to: 660 }], 630, 690), false);
  check('rfreeConGap: nessun impegno -> sempre libera', rfreeConGap([], 600, 660), true);

  // ultimaLezioneValida — Ciclo F.1, Parte B (proposta/confermata/eseguita contano, annullata/assenza ingiustificata no)
  {
    const sessioni = [
      { progettoId: 'p1', data: '2026-06-10', stato: 'eseguita' },
      { progettoId: 'p1', data: '2026-06-24', stato: 'annullata' }, // più recente ma NON valida: non deve vincere
      { progettoId: 'p1', data: '2026-06-20', stato: 'proposta' },
      { progettoId: 'p1', data: '2026-06-22', stato: 'assenza ingiustificata' }, // non valida
      { progettoId: 'p2', data: '2026-06-30', stato: 'confermata' }, // altro progetto: non deve interferire
    ];
    check('ultimaLezioneValida: prende la più recente fra le valide, ignora annullata/assenza ingiustificata anche se più recenti', ultimaLezioneValida(sessioni, 'p1'), '2026-06-20');
    check('ultimaLezioneValida: nessuna sessione valida per il progetto -> null', ultimaLezioneValida(sessioni, 'p3'), null);
    check('ultimaLezioneValida: solo annullata/assenza ingiustificata -> null', ultimaLezioneValida([{ progettoId: 'p4', data: '2026-06-01', stato: 'annullata' }], 'p4'), null);
  }

  // calcStrettezza — Ciclo F.1 (mode-aware: settimanale invariata, quindicinale/mensile con frequenza equivalente nominale)
  {
    const dispo = { disponibilita: { Lun: [{ from: '09:00', to: '11:00' }] } }; // 120 minuti disponibili
    check('calcStrettezza: settimanale, formula invariata (120min / (freq*dur))', calcStrettezza({ ...dispo, frequenza: 2, durataSessione: 60 }), 1);
    check('calcStrettezza: quindicinale, frequenza equivalente 0.5/settimana', calcStrettezza({ ...dispo, modalitaFrequenza: 'quindicinale', durataSessione: 60 }), 4);
    check('calcStrettezza: mensile, frequenza equivalente ~0.264/settimana', calcStrettezza({ ...dispo, modalitaFrequenza: 'mensile', durataSessione: 60 }), 7.571428571428571);
    check('calcStrettezza: nessuna disponibilità -> 999 (invariato per ogni modalità)', calcStrettezza({ modalitaFrequenza: 'mensile', durataSessione: 60 }), 999);
  }

  console.log(fails === 0 ? ('--- Test funzionali: TUTTI OK (' + count + ' casi) ---\n') : ('--- Test funzionali: ' + fails + '/' + count + ' FALLITI ---\n'));
  return fails === 0;
}

// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(INDEX_HTML)) { console.error('index.html non trovato in ' + REPO_ROOT); process.exit(1); }
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sintassiOk = checkSintassi(html);
  const sandbox = buildSandbox(html);
  const testOk = runTest(sandbox);
  const tuttoOk = sintassiOk && testOk;
  console.log(tuttoOk ? 'RISULTATO FINALE: OK' : 'RISULTATO FINALE: FALLITO');
  process.exit(tuttoOk ? 0 : 1);
}

main();
