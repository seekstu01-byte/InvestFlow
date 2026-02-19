// ═══════════════════════════════════════════════
//  AURUM 資產追蹤 - Google Apps Script 後端
// ═══════════════════════════════════════════════

function SS() { return SpreadsheetApp.getActiveSpreadsheet(); }

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('AURUM 資產追蹤')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function newId() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 5);
}

function initAndLoad() {
  const scan = _scanDatabase();
  _setupSheets();
  const wallets  = getWallets();
  const walletId = wallets.length > 0 ? wallets[0].id : null;
  return {
    db: {
      isNewInstall:     !scan.allExist,
      spreadsheetName:  scan.spreadsheetName,
      sheets:           scan.sheets,
      walletCount:      wallets.length,
      transactionCount: walletId ? getTransactions(walletId).length : 0,
      cashFlowCount:    walletId ? getCashFlows(walletId).length    : 0,
    },
    wallets,
    activeWalletId: walletId,
    transactions:   walletId ? getTransactions(walletId) : [],
    cashFlows:      walletId ? getCashFlows(walletId)    : [],
    prices:         getPrices(),
  };
}

function _scanDatabase() {
  const ss = SS();
  const required = ['_wallets','_transactions','_cashflows','_prices'];
  const sheets = {};
  required.forEach(name => {
    const s = ss.getSheetByName(name);
    sheets[name] = { exists: !!s, rows: s ? Math.max(0, s.getLastRow()-1) : 0 };
  });
  return { spreadsheetName: ss.getName(), sheets, allExist: required.every(n => sheets[n].exists) };
}

function _setupSheets() {
  const ss = SS();
  function ensure(name, headers) {
    let s = ss.getSheetByName(name);
    if (!s) { s = ss.insertSheet(name); s.appendRow(headers); s.setFrozenRows(1); s.hideSheet(); }
    return s;
  }
  ensure('_wallets',      ['id','name']);
  ensure('_transactions', ['id','walletId','symbol','name','type','currency','direction','shares','buyPrice','limitPrice','fee','broker','date']);
  ensure('_cashflows',    ['id','walletId','type','amount','note','isDividend','date']);
  ensure('_prices',       ['symbol','type','price']);
  const ws = ss.getSheetByName('_wallets');
  if (ws.getLastRow() <= 1) ws.appendRow([newId(),'主帳戶']);
}

function checkDatabase() {
  const scan = _scanDatabase();
  const wallets  = getWallets();
  const walletId = wallets.length > 0 ? wallets[0].id : null;
  return {
    ok: scan.allExist, spreadsheetName: scan.spreadsheetName, sheets: scan.sheets,
    walletCount: wallets.length,
    transactionCount: walletId ? getTransactions(walletId).length : 0,
    cashFlowCount:    walletId ? getCashFlows(walletId).length    : 0,
  };
}

function getWallets() { return sheetToObjects('_wallets'); }
function addWallet(name) { const id = newId(); SS().getSheetByName('_wallets').appendRow([id, name||'新錢包']); return id; }
function renameWallet(id, name) { const s = SS().getSheetByName('_wallets'), data = s.getDataRange().getValues(); for (let i=1;i<data.length;i++) if (String(data[i][0])===String(id)) { s.getRange(i+1,2).setValue(name); return; } }
function deleteWallet(id) { deleteRowById('_wallets', id); cascadeDelete('_transactions', 1, id); cascadeDelete('_cashflows', 1, id); }

function getTransactions(walletId) {
  return sheetToObjects('_transactions').filter(r => String(r.walletId)===String(walletId))
    .map(r => ({ 
      ...r, 
      direction: r.direction||'buy', 
      shares: parseFloat(r.shares)||0, 
      buyPrice: parseFloat(r.buyPrice)||0,
      limitPrice: r.limitPrice ? parseFloat(r.limitPrice) : null,
      fee: parseFloat(r.fee)||0,
      broker: r.broker||''
    }));
}
function addTransaction(data) {
  const id = newId();
  SS().getSheetByName('_transactions').appendRow([
    id, data.walletId, data.symbol, data.name, data.type, data.currency, 
    data.direction||'buy', data.shares, data.buyPrice, data.limitPrice||'', 
    data.fee||0, data.broker||'', data.date
  ]);
  updatePriceSheet(data.symbol, data.type);
  return id;
}
function deleteTransaction(id) { deleteRowById('_transactions', id); }
function batchSyncTransactions(adds, deletes) {
  const results = { added: [], deleted: [] };
  if (adds && adds.length > 0) adds.forEach(data => results.added.push(addTransaction(data)));
  if (deletes && deletes.length > 0) deletes.forEach(id => { deleteTransaction(id); results.deleted.push(id); });
  return results;
}

function getCashFlows(walletId) {
  return sheetToObjects('_cashflows').filter(r => String(r.walletId)===String(walletId)).map(r => ({...r, amount: parseFloat(r.amount)||0}));
}
function addCashFlow(data) { const id = newId(); SS().getSheetByName('_cashflows').appendRow([id, data.walletId, data.type, data.amount, data.note||'', data.date]); return id; }
function deleteCashFlow(id) { deleteRowById('_cashflows', id); }
function batchSyncCashFlows(adds, deletes) {
  const results = { added: [], deleted: [] };
  if (adds && adds.length > 0) adds.forEach(data => results.added.push(addCashFlow(data)));
  if (deletes && deletes.length > 0) deletes.forEach(id => { deleteCashFlow(id); results.deleted.push(id); });
  return results;
}

function syncAll(data) {
  return {
    transactions: batchSyncTransactions(data.addTransactions, data.deleteTransactions),
    cashFlows:    batchSyncCashFlows(data.addCashFlows, data.deleteCashFlows),
  };
}

function updatePriceSheet(symbol, type) {
  const s = SS().getSheetByName('_prices'), data = s.getDataRange().getValues();
  if (data.slice(1).some(r => String(r[0])===String(symbol))) return;
  let formula;
  if (type==='tw') formula=`=GOOGLEFINANCE("TPE:${symbol}","price")`;
  else if (type==='us') formula=`=GOOGLEFINANCE("${symbol}","price")`;
  else if (symbol==='BTC') formula=`=GOOGLEFINANCE("CURRENCY:BTCUSD","price")`;
  else if (symbol==='ETH') formula=`=GOOGLEFINANCE("CURRENCY:ETHUSD","price")`;
  else if (symbol==='SOL') formula=`=GOOGLEFINANCE("CURRENCY:SOLUSD","price")`;
  else return;
  const row = s.getLastRow()+1;
  s.getRange(row,1).setValue(symbol); s.getRange(row,2).setValue(type); s.getRange(row,3).setFormula(formula);
}

function getPrices() {
  const s = SS().getSheetByName('_prices');
  if (!s || s.getLastRow()<=1) return {};
  const data = s.getDataRange().getValues(), result={};
  data.slice(1).forEach(r=>{ if (r[0] && typeof r[2]==='number' && r[2]>0) result[String(r[0])]=r[2]; });
  return result;
}

function refreshPrices() {
  const s = SS().getSheetByName('_prices');
  if (!s || s.getLastRow()<=1) return { prices: {}, timestamp: null };
  
  // 檢查上次更新時間（5分鐘限制）
  const props = PropertiesService.getUserProperties();
  const lastUpdate = props.getProperty('lastPriceUpdate');
  const now = new Date().getTime();
  
  if (lastUpdate) {
    const elapsed = (now - parseInt(lastUpdate)) / 1000; // 秒
    if (elapsed < 300) { // 5分鐘 = 300秒
      const remaining = Math.ceil(300 - elapsed);
      throw new Error('RATE_LIMIT:' + remaining);
    }
  }
  
  const lastRow = s.getLastRow(), formulas = s.getRange(2,3,lastRow-1,1).getFormulas();
  s.getRange(2,3,lastRow-1,1).clearContent(); 
  SpreadsheetApp.flush(); 
  Utilities.sleep(1000);
  s.getRange(2,3,lastRow-1,1).setFormulas(formulas); 
  SpreadsheetApp.flush(); 
  Utilities.sleep(3000);
  
  // 記錄更新時間
  props.setProperty('lastPriceUpdate', now.toString());
  
  const prices = getPrices();
  return { 
    prices: prices, 
    timestamp: new Date().toISOString(),
    source: 'Google Finance'
  };
}

function searchSymbol(input) {
  const t = input.trim();
  if (!t) return { results: [] };
  const cryptoMap = { BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana' }, upper = t.toUpperCase();
  if (cryptoMap[upper]) return { results: [{ symbol:upper, name:cryptoMap[upper], type:'crypto', currency:'USD' }] };
  const isTW = /^\d{4,5}$/.test(t), candidates = [];
  if (isTW) { const res = _lookupGF(`TPE:${t}`, t, 'tw', 'TWD'); if (res) candidates.push(res); }
  else { const res = _lookupGF(upper, upper, 'us', 'USD'); if (res) candidates.push(res); }
  return { results: candidates };
}

function _lookupGF(gSym, displaySymbol, type, currency) {
  const ss = SS(); let temp = ss.getSheetByName('_temp');
  if (!temp) { temp=ss.insertSheet('_temp'); temp.hideSheet(); }
  try {
    temp.getRange('A1').setFormula(`=GOOGLEFINANCE("${gSym}","name")`);
    temp.getRange('B1').setFormula(`=GOOGLEFINANCE("${gSym}","price")`);
    SpreadsheetApp.flush(); Utilities.sleep(2500);
    const name = temp.getRange('A1').getValue(), price = temp.getRange('B1').getValue();
    temp.getRange('A1:B1').clearContent();
    if (name && typeof name==='string' && name.length>1 && !name.startsWith('#'))
      return { symbol: displaySymbol, name: name, type: type, currency: currency, price: (typeof price==='number' && price>0) ? price : null };
    return null;
  } catch(e) { try { temp.getRange('A1:B1').clearContent(); } catch(_){} return null; }
}

function loadWalletData(walletId) { return { transactions: getTransactions(walletId), cashFlows: getCashFlows(walletId), prices: getPrices() }; }

function sheetToObjects(name) {
  const s = SS().getSheetByName(name);
  if (!s || s.getLastRow()<=1) return [];
  const [headers,...rows] = s.getDataRange().getValues();
  return rows.map(r => Object.fromEntries(headers.map((h,i)=>[h, r[i]!=null ? String(r[i]) : ''])));
}
function deleteRowById(sheetName, id) { const s = SS().getSheetByName(sheetName); if (!s) return; const data = s.getDataRange().getValues(); for (let i=data.length-1;i>=1;i--) if (String(data[i][0])===String(id)) { s.deleteRow(i+1); return; } }
function cascadeDelete(sheetName, fkCol, fkValue) { const s = SS().getSheetByName(sheetName); if (!s || s.getLastRow()<=1) return; const data = s.getDataRange().getValues(); for (let i=data.length-1;i>=1;i--) if (String(data[i][fkCol])===String(fkValue)) s.deleteRow(i+1); }
