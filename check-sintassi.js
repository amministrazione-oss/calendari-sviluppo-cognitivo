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
const EXTRACT_FUNZIONI = ['tmin', 'parseHM', 'fmtHM', 'tempoBustoOperatore', 'decidiOnlineDaCasa', 'bucketSettimana', 'maxNuoveSettimana', 'sediAmmesseProgetto'];
const EXTRACT_COSTANTI = ['pad2', 'AULE_CESATE', 'AULE_BUSTO'];

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
  const { parseHM, fmtHM, tempoBustoOperatore, decidiOnlineDaCasa, bucketSettimana, maxNuoveSettimana, sediAmmesseProgetto } = sandbox;
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
