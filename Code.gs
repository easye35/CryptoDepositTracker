/**
 * CryptoDeposit Tracker (standalone)
 *
 * Scans your Gmail for Bitcoin deposit notification emails and logs them to a
 * Google Sheet. Everything runs inside your own Google account: no server, no
 * license key, nothing is sent anywhere.
 *
 * SETUP
 *   1. Create a Google Sheet, then open Extensions > Apps Script.
 *   2. Paste this file into Code.gs and save.
 *   3. Edit the CONFIG block below if needed.
 *   4. Run setup() once and approve the Gmail/Sheets permissions.
 *
 * Sheets created: Deposits, Summary, Reconciliation, Exceptions.
 * This script records what notification emails say. It does not verify
 * blockchain settlement and is not tax, legal, or accounting advice.
 */

/******************************
 * CONFIG
 ******************************/
const CONFIG = {
  // How often the time trigger runs, in hours (1, 2, 4, 6, 8, or 12 work with Apps Script; 24 = daily).
  scanEveryHours: 6,

  // Only look at emails newer than this many days.
  lookbackDays: 7,

  // Safety limits per run.
  maxThreads: 120,
  maxMessagesPerThread: 8,
  maxRuntimeMillis: 240000,

  // Label added to Gmail threads that produced a deposit row. Set to '' to disable.
  processedLabel: 'CDT Processed',

  // One entry per wallet/provider.
  //   sender:   text the From header must contain ('' = any sender)
  //   subject:  text to look for in the subject (used in the Gmail search)
  //   btcPatterns: regexes whose first capture group is the BTC amount
  //   cadPatterns: optional regexes whose first capture group is the CAD value
  wallets: [
    {
      name: 'ShakePay',
      enabled: true,
      sender: '',
      subject: 'You received',
      btcPatterns: [
        /You received\s+([\d.,]+)\s+BTC(?:\s+on\s+Lightning)?/i,
        /Quantity\s+([\d.,]+)\s+BTC/i,
        /([\d.,]+)\s+BTC\s+on\s+Lightning/i,
      ],
      cadPatterns: [],
    },
  ],
};

const DEPOSIT_HEADERS = ['Date', 'Amount', 'Currency', 'Source', 'TxID', 'Notes'];
const HEADER_COLOR = '#d8f7ef';

/******************************
 * MENU AND SETUP
 ******************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CryptoDeposit')
    .addItem('Scan now', 'scanDeposits')
    .addItem('Rescan lookback window', 'rescanDeposits')
    .addItem('Run setup', 'setup')
    .addToUi();
}

function setup() {
  const ss = getSpreadsheet();

  let deposits = ss.getSheetByName('Deposits');
  if (!deposits) {
    const first = ss.getSheets()[0];
    if (first.getName() === 'Sheet1' && first.getLastRow() === 0) {
      deposits = first.setName('Deposits');
    } else {
      deposits = ss.insertSheet('Deposits');
    }
  }
  if (deposits.getLastRow() === 0) {
    deposits.getRange(1, 1, 1, DEPOSIT_HEADERS.length).setValues([DEPOSIT_HEADERS]);
    deposits.getRange(1, 1, 1, DEPOSIT_HEADERS.length).setFontWeight('bold').setBackground(HEADER_COLOR);
    deposits.setFrozenRows(1);
  }

  const summary = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  summary.getRange(1, 1, 1, 3).setValues([['Total CAD', 'Total BTC', 'Last Updated']]);
  summary.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground(HEADER_COLOR);

  ensureScanTrigger();
  scanDeposits();
}

function ensureScanTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'scanDeposits')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  const hours = Math.max(1, Math.round(CONFIG.scanEveryHours));
  const builder = ScriptApp.newTrigger('scanDeposits').timeBased();
  if (hours >= 24) {
    builder.everyDays(1).create();
  } else {
    builder.everyHours(hours).create();
  }
}

/******************************
 * ENTRY POINTS
 ******************************/
function scanDeposits() {
  runScan();
}

function rescanDeposits() {
  runScan();
}

function runScan() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('Scan skipped: another scan is already running.');
    return;
  }

  try {
    const deposits = scanGmail();
    writeDeposits(deposits);
    updateSummary();
    updateReconciliation();
    console.log('Scan completed: ' + deposits.length + ' new deposit(s).');
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Open this script from a Google Sheet (Extensions > Apps Script).');
  }
  return ss;
}

/******************************
 * GMAIL SCAN
 ******************************/
function scanGmail() {
  const deadline = Date.now() + CONFIG.maxRuntimeMillis;
  const wallets = CONFIG.wallets.filter(wallet => wallet.enabled && wallet.subject);
  if (!wallets.length) return [];

  const lookbackDays = Math.max(1, Math.min(30, CONFIG.lookbackDays));
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const existingKeys = loadExistingKeys();
  const threads = GmailApp.search(buildGmailQuery(wallets, lookbackDays), 0, CONFIG.maxThreads);
  const deposits = [];

  for (const thread of threads) {
    if (Date.now() >= deadline) {
      console.warn('Scan stopped early: runtime limit reached.');
      break;
    }

    const all = thread.getMessages();
    const messages = all.length > CONFIG.maxMessagesPerThread
      ? all.slice(all.length - CONFIG.maxMessagesPerThread)
      : all;

    for (const message of messages) {
      const date = message.getDate();
      if (date < cutoff) continue;

      const subject = message.getSubject() || '';
      const text = (subject + '\n' + (message.getPlainBody() || '')).replace(/\u00a0/g, ' ');

      for (const wallet of wallets) {
        if (!senderMatches(message.getFrom(), wallet.sender)) continue;
        if (!subjectMatches(subject, wallet.subject)) continue;

        const amountBTC = firstNumber(text, wallet.btcPatterns);
        const amountCAD = firstNumber(text, wallet.cadPatterns);
        if (amountBTC === null && amountCAD === null) continue;

        const currency = amountBTC !== null ? 'BTC' : 'CAD';
        const amount = amountBTC !== null ? amountBTC : amountCAD;
        const key = depositKey(date, amount, currency, wallet.name);
        if (existingKeys.has(key)) break;

        existingKeys.add(key);
        deposits.push({
          date: date,
          amount: amount,
          currency: currency,
          source: wallet.name,
          txid: '',
          notes: currency === 'BTC' && amountCAD !== null ? 'CAD: ' + amountCAD : '',
          threadId: thread.getId(),
        });
        break;
      }
    }
  }

  return deposits;
}

function buildGmailQuery(wallets, lookbackDays) {
  const subjects = wallets.map(wallet => 'subject:"' + escapeGmail(wallet.subject) + '"');
  const senders = wallets.filter(wallet => wallet.sender).map(wallet => 'from:' + escapeGmail(wallet.sender));
  const terms = ['newer_than:' + lookbackDays + 'd', '(' + subjects.join(' OR ') + ')'];
  // Only restrict by sender if every wallet specifies one; otherwise it would hide the others.
  if (senders.length === wallets.length) {
    terms.push('(' + senders.join(' OR ') + ')');
  }
  return terms.join(' ');
}

function escapeGmail(value) {
  return String(value || '').replace(/["\\]/g, '\\$&');
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function senderMatches(from, sender) {
  const wanted = String(sender || '').trim().toLowerCase();
  return !wanted || String(from || '').toLowerCase().includes(wanted);
}

function subjectMatches(subject, wanted) {
  const wantedText = normalize(wanted);
  return !wantedText || normalize(subject).includes(wantedText);
}

function firstNumber(text, patterns) {
  for (const pattern of patterns || []) {
    const match = text.match(pattern);
    if (!match) continue;
    for (let i = 1; i < match.length; i++) {
      const value = parseFloat(String(match[i] || '').replace(/,/g, ''));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function depositKey(date, amount, currency, source) {
  const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return [Math.floor(time / 1000), Number(amount), String(currency).toUpperCase(), source].join('|');
}

function loadExistingKeys() {
  const keys = new Set();
  const sheet = getSpreadsheet().getSheetByName('Deposits');
  if (!sheet || sheet.getLastRow() < 2) return keys;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().forEach(row => {
    keys.add(depositKey(row[0], parseFloat(row[1]), row[2], String(row[3]).trim()));
  });
  return keys;
}

/******************************
 * WRITE TO SHEET
 ******************************/
function writeDeposits(deposits) {
  if (!deposits.length) return;

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Deposits') || ss.insertSheet('Deposits');
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, DEPOSIT_HEADERS.length).setValues([DEPOSIT_HEADERS]);
  }

  deposits.sort((a, b) => a.date - b.date);
  const rows = deposits.map(d => [d.date, d.amount, d.currency, d.source, d.txid, d.notes]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, DEPOSIT_HEADERS.length).setValues(rows);
  SpreadsheetApp.flush();

  labelThreads(deposits);
}

function labelThreads(deposits) {
  if (!CONFIG.processedLabel) return;

  try {
    const label = GmailApp.getUserLabelByName(CONFIG.processedLabel) || GmailApp.createLabel(CONFIG.processedLabel);
    const seen = new Set();
    deposits.forEach(d => {
      if (seen.has(d.threadId)) return;
      seen.add(d.threadId);
      const thread = GmailApp.getThreadById(d.threadId);
      if (thread) thread.addLabel(label);
    });
  } catch (err) {
    console.warn('Labeling skipped: ' + err);
  }
}

/******************************
 * SUMMARY AND RECONCILIATION
 ******************************/
function readDepositRows() {
  const sheet = getSpreadsheet().getSheetByName('Deposits');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, DEPOSIT_HEADERS.length).getValues();
}

function cadFromRow(amount, currency, notes) {
  if (currency === 'CAD') return amount;
  if (currency === 'BTC') {
    const match = String(notes || '').match(/CAD:\s*([\d.]+)/i);
    return match ? parseFloat(match[1]) || 0 : 0;
  }
  return 0;
}

function updateSummary() {
  const ss = getSpreadsheet();
  const summary = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  let totalCAD = 0;
  let totalBTC = 0;

  readDepositRows().forEach(row => {
    const amount = parseFloat(row[1]) || 0;
    const currency = String(row[2] || '').trim().toUpperCase();
    if (currency === 'BTC') totalBTC += amount;
    totalCAD += cadFromRow(amount, currency, row[5]);
  });

  summary.getRange(1, 1, 1, 3).setValues([['Total CAD', 'Total BTC', 'Last Updated']]);
  summary.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground(HEADER_COLOR);
  summary.getRange(2, 1, 1, 3).setValues([[totalCAD, totalBTC, new Date()]]);
}

function updateReconciliation() {
  const ss = getSpreadsheet();
  const rows = readDepositRows();
  const timeZone = Session.getScriptTimeZone();
  const walletTotals = {};
  const monthlyTotals = {};
  const duplicateCounts = {};
  let totalBTC = 0;
  let totalCAD = 0;
  let incomplete = 0;

  const keyFor = row => [
    row[0] instanceof Date ? row[0].getTime() : new Date(row[0]).getTime(),
    parseFloat(row[1]),
    String(row[2] || '').trim().toUpperCase(),
    String(row[3] || '').trim() || 'Unknown wallet',
  ].join('|');

  rows.forEach(row => {
    const key = keyFor(row);
    duplicateCounts[key] = (duplicateCounts[key] || 0) + 1;

    const amount = parseFloat(row[1]);
    const currency = String(row[2] || '').trim().toUpperCase();
    const source = String(row[3] || '').trim() || 'Unknown wallet';
    const time = row[0] instanceof Date ? row[0].getTime() : new Date(row[0]).getTime();
    if (!row[0] || Number.isNaN(time) || Number.isNaN(amount) || !currency) {
      incomplete++;
      return;
    }

    const cad = cadFromRow(amount, currency, row[5]);
    const btc = currency === 'BTC' ? amount : 0;
    const month = Utilities.formatDate(new Date(time), timeZone, 'yyyy-MM');
    totalBTC += btc;
    totalCAD += cad;

    [[walletTotals, source], [monthlyTotals, month]].forEach(([totals, name]) => {
      if (!totals[name]) totals[name] = { count: 0, btc: 0, cad: 0 };
      totals[name].count++;
      totals[name].btc += btc;
      totals[name].cad += cad;
    });
  });

  const duplicateRows = Object.keys(duplicateCounts).filter(key => duplicateCounts[key] > 1).length;
  const dashboard = ss.getSheetByName('Reconciliation') || ss.insertSheet('Reconciliation');
  dashboard.clear();
  dashboard.getRange('A1').setValue('Reconciliation Dashboard');
  dashboard.getRange('A2').setValue('Generated from the Deposits sheet: ' + new Date());
  dashboard.getRange('A4:B7').setValues([
    ['Metric', 'Value'],
    ['Total BTC received', totalBTC],
    ['Total CAD value', totalCAD],
    ['Rows needing review', incomplete + duplicateRows],
  ]);

  const toRows = (header, totals, reverse) => {
    const names = Object.keys(totals).sort();
    if (reverse) names.reverse();
    return [header].concat(names.map(name => [name, totals[name].count, totals[name].btc, totals[name].cad]));
  };
  const walletRows = toRows(['Wallet', 'Deposits', 'BTC', 'CAD value'], walletTotals, false);
  const monthRows = toRows(['Month', 'Deposits', 'BTC', 'CAD value'], monthlyTotals, true);
  dashboard.getRange(10, 1, walletRows.length, 4).setValues(walletRows);
  dashboard.getRange(10, 6, monthRows.length, 4).setValues(monthRows);

  dashboard.getRange('A1:I1').setFontWeight('bold').setFontSize(14).setBackground('#08745f').setFontColor('#ffffff');
  dashboard.getRange('A2').setFontColor('#5c6777');
  ['A4:B4', 'A10:D10', 'F10:I10'].forEach(range => {
    dashboard.getRange(range).setFontWeight('bold').setBackground(HEADER_COLOR);
  });
  dashboard.autoResizeColumns(1, 9);

  const exceptions = ss.getSheetByName('Exceptions') || ss.insertSheet('Exceptions');
  exceptions.clear();
  exceptions.getRange(1, 1, 1, 7).setValues([['Date', 'Amount', 'Currency', 'Wallet', 'TxID', 'Notes', 'Issue']]);
  exceptions.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#ffe1d8');

  const exceptionRows = [];
  rows.forEach(row => {
    const issues = [];
    if (!row[0] || Number.isNaN(parseFloat(row[1])) || !String(row[2] || '').trim()) issues.push('Incomplete row');
    if (duplicateCounts[keyFor(row)] > 1) issues.push('Possible duplicate');
    if (issues.length) exceptionRows.push(row.concat([issues.join('; ')]));
  });
  if (exceptionRows.length) exceptions.getRange(2, 1, exceptionRows.length, 7).setValues(exceptionRows);
  exceptions.setFrozenRows(1);
  exceptions.autoResizeColumns(1, 7);
}
