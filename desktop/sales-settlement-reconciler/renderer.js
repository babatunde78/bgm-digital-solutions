'use strict';

const $ = selector => document.querySelector(selector);
const state = { left: null, right: null, leftTable: null, rightTable: null, result: null, keys: [], manualLog: [], activeTab: 'overview', resultFilters: {} };

function escapeText(value) {
  const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML;
}

async function pick(side) {
  try {
    const file = await window.localFiles.pickWorkbook(); if (!file) return;
    state[side] = file;
    const selector = $(`#${side}-sheet`);
    selector.replaceChildren(...file.workbook.sheets.map(sheet => { const option = document.createElement('option'); option.value = sheet.name; option.textContent = `${sheet.name} (${sheet.rows.length} rows)`; return option; }));
    selector.disabled = !file.workbook.sheets.length;
    $(`#${side}-name`).textContent = file.fileName;
    selector.onchange = () => refreshTables(); $(`#${side}-header`).onchange = () => refreshTables();
    refreshTables();
  } catch (error) { alert(error.message); }
}

function refreshTables() {
  for (const side of ['left', 'right']) {
    const file = state[side];
    if (!file || !file.workbook.sheets.length) { state[`${side}Table`] = null; continue; }
    try {
      state[`${side}Table`] = WorkbookTable.from(file.workbook, $(`#${side}-sheet`).value, $(`#${side}-header`).value);
      state[`${side}Table`].rows.forEach(row => { row.side = side; });
      const first = file.workbook.sheets.find(sheet => sheet.name === $(`#${side}-sheet`).value)?.rows || [];
      const preview = $(`#${side}-preview`); preview.replaceChildren();
      const table = document.createElement('table'), row = document.createElement('tr');
      for (const cell of (first.find(item => item.rowNumber === Number($(`#${side}-header`).value))?.cells || []).slice(0, 7)) { const td = document.createElement('td'); td.textContent = cell?.shown || ''; row.append(td); }
      table.append(row); preview.append(table);
    } catch (error) { $(`#${side}-preview`).textContent = error.message; state[`${side}Table`] = null; }
  }
  if (state.leftTable && state.rightTable) drawMapping();
}

function guess(headers, pattern) { return headers.find(header => pattern.test(header)) || headers[0] || ''; }
function drawMapping() {
  const container = $('#mapping'); container.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'mapping-row mapping-head'; heading.innerHTML = '<span></span><span>Use key</span><span>Matching field</span><span>Sales register column</span><span>Bank / settlement column</span>'; container.append(heading);
  if (!state.keys.length) state.keys = [
    { id: 'reference', label: 'Reference', type: 'text', enabled: true, left: guess(state.leftTable.headers, /ref|invoice|transaction|receipt|id|order/i), right: guess(state.rightTable.headers, /ref|invoice|transaction|receipt|id|order/i) },
    { id: 'date', label: 'Date', type: 'date', enabled: true, left: guess(state.leftTable.headers, /date|posted|value/i), right: guess(state.rightTable.headers, /date|posted|value/i) },
    { id: 'amount', label: 'Amount', type: 'amount', enabled: true, left: guess(state.leftTable.headers, /amount|credit|paid|gross|net/i), right: guess(state.rightTable.headers, /amount|credit|paid|gross|net/i) }
  ];
  for (const key of state.keys) {
    const row = document.createElement('div'); row.className = 'mapping-row'; row.dataset.id = key.id;
    const checked = document.createElement('input'); checked.type = 'checkbox'; checked.checked = key.enabled; checked.setAttribute('aria-label', `Use ${key.label} as a matching key`);
    const name = document.createElement('input'); name.value = key.label; name.setAttribute('aria-label', 'Matching field label');
    const left = optionSelect(state.leftTable.headers, key.left), right = optionSelect(state.rightTable.headers, key.right);
    row.append(checked, name, document.createTextNode(key.type), left, right); container.append(row);
    checked.onchange = () => { key.enabled = checked.checked; };
    name.onchange = () => { key.label = name.value.trim() || key.id; };
    left.onchange = () => { key.left = left.value; };
    right.onchange = () => { key.right = right.value; };
  }
}
function optionSelect(headers, selected) {
  const select = document.createElement('select');
  select.append(new Option('— choose column —', ''));
  for (const header of headers) select.append(new Option(header, header, false, header === selected));
  return select;
}

function addKey() {
  if (!state.leftTable || !state.rightTable) return alert('Choose both workbooks first.');
  const id = `key${state.keys.length + 1}`;
  state.keys.push({ id, label: `Text key ${state.keys.length - 2}`, type: 'text', enabled: false, left: '', right: '' }); drawMapping();
}

function mappedRows(side, keys) {
  const table = state[`${side}Table`];
  return table.rows.map(row => ({ ...row, values: Object.fromEntries(keys.map(key => [key.id, row.sourceValues[key[side]] ?? ''])) }));
}

function run() {
  try {
    if (!state.leftTable || !state.rightTable) throw new Error('Select a valid worksheet and header row from both files.');
    const keys = state.keys.filter(key => key.enabled && key.left && key.right);
    if (!keys.length) throw new Error('Choose at least one key and map its columns on both sides.');
    const amountTolerance = Number($('#amount-tolerance').value);
    const dateTolerance = Number($('#date-tolerance').value);
    if (!Number.isFinite(amountTolerance) || amountTolerance < 0 || !Number.isFinite(dateTolerance) || dateTolerance < 0) throw new Error('Tolerances must be zero or positive numbers.');
    state.activeKeys = keys;
    state.result = ReconcileCore.reconcile(mappedRows('left', keys), mappedRows('right', keys), keys.map(({ id, label, type }) => ({ id, label, type })), { dateOrder: $('#date-order').value, dateToleranceDays: dateTolerance, amountToleranceCents: Math.round(amountTolerance * 100) });
    state.manualLog = [];
    $('#results').classList.remove('hidden');
    $('#run-meta').textContent = `Run ${new Date().toLocaleString()} · ${state.left.fileName} / ${state.right.fileName}`;
    drawResults('overview'); $('#results').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { alert(error.message); }
}

function drawResults(tab) {
  const result = state.result; if (!result) return;
  state.activeTab = tab;
  const stats = ReconcileCore.summarize(result);
  const summary = $('#summary'); summary.replaceChildren();
  const metrics = [
    ['Sales rows', stats.salesRows], ['Bank rows', stats.bankRows], ['Matched sales', stats.matchedRows], ['Sales match rate', `${stats.matchRatePercent}%`]
  ];
  for (const [label, value] of metrics) {
    const div = document.createElement('div'); div.className = 'metric';
    const strong = document.createElement('strong'); strong.textContent = value;
    const caption = document.createElement('span'); caption.textContent = label;
    div.append(strong, caption); summary.append(div);
  }
  const tabs = [
    ['overview','Overview',null],['matched','Matched',stats.matchedRows],['ambiguous','Ambiguous review',stats.ambiguousSalesRows],
    ['sales','Unmatched sales',stats.unmatchedSalesRows],['bank','Unmatched bank',stats.unmatchedBankRows],
    ['duplicates','Duplicate groups',stats.duplicateSalesGroups + stats.duplicateBankGroups],
    ['invalid','Invalid rows',stats.invalidSalesRows + stats.invalidBankRows],['log','Processing log',null]
  ];
  $('#tabs').replaceChildren(...tabs.map(([id, label, count]) => {
    const button = document.createElement('button'); button.type = 'button';
    const text = document.createElement('span'); text.textContent = label; button.append(text);
    if (count !== null) { const badge = document.createElement('span'); badge.className = 'nav-count'; badge.textContent = count; button.append(badge); }
    if (id === tab) { button.className = 'active'; button.setAttribute('aria-current', 'page'); }
    button.onclick = () => drawResults(id); return button;
  }));
  const overview = $('#overview'); overview.replaceChildren(); overview.classList.toggle('hidden', tab !== 'overview');
  drawOverview(overview, stats);
  const searchLabel = $('#result-search-label'), search = $('#result-search');
  const showSearch = tab !== 'overview'; searchLabel.classList.toggle('hidden', !showSearch);
  search.value = state.resultFilters[tab] || '';
  const area = $('#report-view'); area.replaceChildren();
  area.classList.toggle('hidden', tab === 'overview');
  if (tab === 'overview') return;
  const table = document.createElement('table'); table.className = 'data'; const body = document.createElement('tbody');
  const headers = tab === 'matched' ? ['Sales row','Bank row','Decision','Why these values matched'] : tab === 'ambiguous' ? ['Sales row','Candidate bank rows','Sales original values','Bank candidate original values','Evidence','Human decision'] : tab === 'sales' || tab === 'bank' ? ['Source row','Original values','Status'] : tab === 'duplicates' ? ['Side','Source rows','Key values','Original values'] : tab === 'invalid' ? ['Side','Source row','Field','Issue'] : ['Time','Event','Details'];
  const thead = document.createElement('thead'), trh = document.createElement('tr'); headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.append(th); }); thead.append(trh); table.append(thead, body);
  const add = values => { const tr = document.createElement('tr'); values.forEach(value => { const td = document.createElement('td'); if (value instanceof Node) td.append(value); else td.textContent = String(value ?? ''); tr.append(td); }); body.append(tr); };
  if (tab === 'matched') for (const match of result.matched) add([sourceLabel(result.left[match.leftIndex]), sourceLabel(result.right[match.rightIndex]), match.decision, match.explanation]);
  if (tab === 'ambiguous') for (const item of result.ambiguous) {
    const select = document.createElement('select'); select.append(new Option('Choose candidate…', ''));
    for (const index of item.rightIndices) select.append(new Option(sourceLabel(result.right[index]) + ' · ' + item.explanation[item.rightIndices.indexOf(index)], String(index)));
    const button = document.createElement('button'); button.textContent = 'Confirm selected pair'; button.onclick = () => { if (select.value === '') return alert('Select a candidate first.'); const index = Number(select.value); ReconcileCore.confirmPair(result, item.leftIndex, index); state.manualLog.push({ time: new Date().toISOString(), event: 'Manual confirmation', details: `${$('#operator').value.trim() || 'Operator not named'}: ${sourceLabel(result.left[item.leftIndex])} paired with ${sourceLabel(result.right[index])}` }); drawResults('ambiguous'); };
    add([sourceLabel(result.left[item.leftIndex]), item.rightIndices.map(index => sourceLabel(result.right[index])).join(' · '), JSON.stringify(result.left[item.leftIndex].original), item.rightIndices.map(index => `${sourceLabel(result.right[index])}: ${JSON.stringify(result.right[index].original)}`).join(' || '), item.explanation.join(' || '), (() => { const wrap = document.createElement('span'); wrap.append(select, button); return wrap; })()]);
  }
  if (tab === 'sales' || tab === 'bank') {
    const side = tab === 'sales' ? 'left' : 'right'; const indexes = tab === 'sales' ? result.unmatchedLeft : result.unmatchedRight;
    indexes.forEach(index => add([sourceLabel(result[side][index]), JSON.stringify(result[side][index].original), 'No candidate on selected keys']));
  }
  if (tab === 'duplicates') for (const [side, groups] of [['Sales register', result.leftDuplicates], ['Bank / settlement', result.rightDuplicates]]) groups.forEach(group => add([side, group.map(index => sourceLabel((side === 'Sales register' ? result.left : result.right)[index])).join(' · '), group.map(index => JSON.stringify((side === 'Sales register' ? result.left : result.right)[index].values)).join(' || '), group.map(index => JSON.stringify((side === 'Sales register' ? result.left : result.right)[index].original)).join(' || ')]));
  if (tab === 'invalid') for (const issue of [...result.invalidLeft.map(row => ({ ...row, side: 'Sales register' })), ...result.invalidRight.map(row => ({ ...row, side: 'Bank / settlement' }))]) add([issue.side, issue.sourceRow, issue.key, issue.message]);
  if (tab === 'log') {
    add([new Date().toISOString(), 'Run started', `${state.left.fileName} / ${state.right.fileName}`]);
    add([new Date().toISOString(), 'Mapping / settings', JSON.stringify({ keys: state.activeKeys, tolerances: result.settings })]);
    for (const row of state.manualLog) add([row.time, row.event, row.details]);
    for (const match of result.matched) add([new Date().toISOString(), match.decision, `${sourceLabel(result.left[match.leftIndex])} ↔ ${sourceLabel(result.right[match.rightIndex])} · ${match.explanation}`]);
    for (const item of result.ambiguous) add([new Date().toISOString(), 'Ambiguous / awaiting human review', `${sourceLabel(result.left[item.leftIndex])} → ${item.rightIndices.map(index => sourceLabel(result.right[index])).join(', ')}`]);
    for (const index of result.unmatchedLeft) add([new Date().toISOString(), 'Unmatched sales row', sourceLabel(result.left[index])]);
    for (const index of result.unmatchedRight) add([new Date().toISOString(), 'Unmatched bank row', sourceLabel(result.right[index])]);
    for (const issue of [...result.invalidLeft.map(row => ({...row,side:'Sales'})),...result.invalidRight.map(row => ({...row,side:'Bank'}))]) add([new Date().toISOString(), 'Invalid key value', `${issue.side} row ${issue.sourceRow} / ${issue.key}: ${issue.message}`]);
    for (const [side,groups,rows] of [['Sales',result.leftDuplicates,result.left],['Bank',result.rightDuplicates,result.right]]) groups.forEach(group=>add([new Date().toISOString(),'Duplicate key group',`${side} source rows ${group.map(index=>rows[index].sourceRow).join(', ')}`]));
    add([new Date().toISOString(), 'Result totals', JSON.stringify({ matched: result.matched.length, ambiguous: result.ambiguous.length, unmatchedSales: result.unmatchedLeft.length, unmatchedBank: result.unmatchedRight.length, invalid: result.invalidLeft.length + result.invalidRight.length })]);
  }
  if (!body.children.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No records in this section for this reconciliation.'; area.append(empty); return; }
  const wrap = document.createElement('div'); wrap.className = 'table-wrap'; wrap.append(table); area.append(wrap); filterResultRows();
}

function drawOverview(target, stats) {
  const grid = document.createElement('div'); grid.className = 'overview-grid';
  const sales = outcomeCard('Sales register outcomes', stats.salesRows, [
    ['Matched', stats.matchedRows, 'matched', 'matched'], ['Ambiguous', stats.ambiguousSalesRows, 'review', 'ambiguous'],
    ['Unmatched', stats.unmatchedSalesRows, 'unmatched', 'sales'], ['Invalid', stats.invalidSalesRows, 'invalid', 'invalid']
  ]);
  const bank = outcomeCard('Bank / settlement outcomes', stats.bankRows, [
    ['Matched', stats.matchedRows, 'matched', 'matched'], ['Ambiguous', stats.ambiguousBankRows, 'review', 'ambiguous'],
    ['Unmatched', stats.unmatchedBankRows, 'unmatched', 'bank'], ['Invalid', stats.invalidBankRows, 'invalid', 'invalid']
  ]);
  const followUp = document.createElement('section'); followUp.className = 'overview-card';
  const heading = document.createElement('h3'); heading.textContent = 'Review before export';
  const intro = document.createElement('p'); intro.textContent = 'Open a section to inspect exceptions. Ambiguous matches always need your decision.';
  const links = document.createElement('div'); links.className = 'review-list';
  const actions = [
    ['ambiguous','Ambiguous matches',stats.ambiguousSalesRows], ['sales','Unmatched sales rows',stats.unmatchedSalesRows],
    ['bank','Unmatched bank rows',stats.unmatchedBankRows], ['invalid','Invalid source rows',stats.invalidSalesRows + stats.invalidBankRows],
    ['duplicates','Duplicate key groups',stats.duplicateSalesGroups + stats.duplicateBankGroups]
  ];
  for (const [tab,label,count] of actions) {
    if (!count) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'review-link';
    const title = document.createElement('strong'); title.textContent = label;
    const badge = document.createElement('span'); badge.textContent = `${count} · Review`;
    button.append(title,badge); button.onclick = () => drawResults(tab); links.append(button);
  }
  if (!links.children.length) { const clear = document.createElement('p'); clear.className = 'empty-state'; clear.textContent = 'No exceptions were found in this run. Review the match explanations before using the report.'; links.append(clear); }
  const note = document.createElement('p'); note.className = 'dashboard-note';
  note.textContent = `Sales match rate means matched sales rows divided by ${stats.salesRows} imported sales rows. Duplicate groups are review flags and can overlap other outcomes.`;
  followUp.append(heading,intro,links,note);
  grid.append(sales,bank,followUp); target.append(grid);
}

function outcomeCard(title, total, outcomes) {
  const card = document.createElement('section'); card.className = 'overview-card';
  const heading = document.createElement('h3'); heading.textContent = title;
  const intro = document.createElement('p'); intro.textContent = `${total} imported rows classified by this run.`;
  const bars = document.createElement('div'); bars.className = 'outcome-bars';
  for (const [label,count,variant,tab] of outcomes) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'outcome-row';
    row.setAttribute('aria-label', `${label}: ${count} of ${total} rows. Open ${label.toLowerCase()} results.`);
    const name = document.createElement('span'); name.textContent = label;
    const track = document.createElement('span'); track.className = 'outcome-track';
    const fill = document.createElement('span'); fill.className = `outcome-fill ${variant}`;
    fill.style.width = `${total ? count * 100 / total : 0}%`; track.append(fill);
    const value = document.createElement('strong'); value.textContent = count;
    row.append(name,track,value); row.onclick = () => drawResults(tab); bars.append(row);
  }
  card.append(heading,intro,bars); return card;
}

function filterResultRows() {
  const query = ($('#result-search').value || '').trim().toLocaleLowerCase();
  for (const row of document.querySelectorAll('#report-view tbody tr')) row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
}

function sourceLabel(row) { return `${row.side === 'left' ? 'Sales' : 'Bank'} row ${row.sourceRow}`; }
function rawValue(row, side, field) { const column = field[side]; return row.original[column] ?? ''; }
function buildReport() {
  const r = state.result, leftKeys = state.activeKeys;
  const matrix = rows => rows.length ? rows : [['No records']];
  const matched = [['Sales source row','Bank source row','Decision','Explanation', ...state.leftTable.headers.map(name => `Sales: ${name}`), ...state.rightTable.headers.map(name => `Bank: ${name}`)]];
  r.matched.forEach(item => { const left = r.left[item.leftIndex], right = r.right[item.rightIndex]; matched.push([left.sourceRow,right.sourceRow,item.decision,item.explanation,...state.leftTable.headers.map(h => left.original[h]),...state.rightTable.headers.map(h => right.original[h])]); });
  const unmatchedSide = (indexes, rows, headers) => matrix([['Source row',...headers], ...indexes.map(i => [rows[i].sourceRow,...headers.map(h => rows[i].original[h])])]);
  const ambiguous = [['Sales source row','Sales original values','Candidate bank source rows','Candidate bank original values','Evidence']]; r.ambiguous.forEach(item => ambiguous.push([r.left[item.leftIndex].sourceRow,JSON.stringify(r.left[item.leftIndex].original),item.rightIndices.map(i => r.right[i].sourceRow).join(', '),item.rightIndices.map(i => `${r.right[i].sourceRow}: ${JSON.stringify(r.right[i].original)}`).join(' || '),item.rightIndices.map(i => item.explanation[item.rightIndices.indexOf(i)]).join(' || ')]));
  const duplicates = [['Side','Source row','Key values','Original values']]; for (const [side,groups,rows] of [['Sales',r.leftDuplicates,r.left],['Bank',r.rightDuplicates,r.right]]) groups.forEach(group => group.forEach(i => duplicates.push([side,rows[i].sourceRow,JSON.stringify(rows[i].values),JSON.stringify(rows[i].original)])));
  const invalid = [['Side','Source row','Field','Issue'],...r.invalidLeft.map(i=>['Sales',i.sourceRow,i.key,i.message]),...r.invalidRight.map(i=>['Bank',i.sourceRow,i.key,i.message])];
  const log = [['Time (local)','Event','Details'],[new Date().toLocaleString(),'Run started',`${state.left.fileName} / ${state.right.fileName}`],[new Date().toLocaleString(),'Mapping and tolerances',JSON.stringify({keys:leftKeys,settings:r.settings,operator:$('#operator').value.trim()||'Not named'})],...state.manualLog.map(item=>[item.time,item.event,item.details]),...r.matched.map(item=>[new Date().toLocaleString(),item.decision,`${r.left[item.leftIndex].sourceRow} ↔ ${r.right[item.rightIndex].sourceRow}; ${item.explanation}`]),...r.ambiguous.map(item=>[new Date().toLocaleString(),'Ambiguous / awaiting confirmation',`Sales row ${r.left[item.leftIndex].sourceRow}; candidate bank rows ${item.rightIndices.map(i=>r.right[i].sourceRow).join(', ')}`]),...r.unmatchedLeft.map(i=>[new Date().toLocaleString(),'Unmatched sales row',String(r.left[i].sourceRow)]),...r.unmatchedRight.map(i=>[new Date().toLocaleString(),'Unmatched bank row',String(r.right[i].sourceRow)]),...r.invalidLeft.map(i=>[new Date().toLocaleString(),'Invalid sales key',`Row ${i.sourceRow} / ${i.key}: ${i.message}`]),...r.invalidRight.map(i=>[new Date().toLocaleString(),'Invalid bank key',`Row ${i.sourceRow} / ${i.key}: ${i.message}`]),...r.leftDuplicates.map(group=>[new Date().toLocaleString(),'Duplicate sales keys',group.map(i=>r.left[i].sourceRow).join(', ')]),...r.rightDuplicates.map(group=>[new Date().toLocaleString(),'Duplicate bank keys',group.map(i=>r.right[i].sourceRow).join(', ')]),[new Date().toLocaleString(),'Totals',`Matched ${r.matched.length}; ambiguous ${r.ambiguous.length}; unmatched sales ${r.unmatchedLeft.length}; unmatched bank ${r.unmatchedRight.length}; invalid ${r.invalidLeft.length+r.invalidRight.length}`]];
  const settings = [['Setting','Value'],['Sales file',state.left.fileName],['Sales worksheet',state.leftTable.sheetName],['Bank file',state.right.fileName],['Bank worksheet',state.rightTable.sheetName],['Operator initials', $('#operator').value.trim()||'Not named'],['Date order',r.settings.dateOrder],['Amount tolerance (NGN)',r.settings.amountToleranceCents/100],['Date tolerance (days)',r.settings.dateToleranceDays],['Selection rule','Auto match only when each row has exactly one candidate and candidate is mutual; all other possible pairs require human confirmation.'],['Execution','Local-only; no source workbook edits.']];
  const stats = ReconcileCore.summarize(r);
  const summary = [['Reconciliation summary','Value'],['Imported sales rows',stats.salesRows],['Imported bank rows',stats.bankRows],['Matched rows',stats.matchedRows],['Sales match rate (%)',stats.matchRatePercent],['Match rate definition','Matched sales rows divided by imported sales rows'],['Ambiguous sales rows',stats.ambiguousSalesRows],['Ambiguous bank rows',stats.ambiguousBankRows],['Unmatched sales rows',stats.unmatchedSalesRows],['Unmatched bank rows',stats.unmatchedBankRows],['Invalid sales rows',stats.invalidSalesRows],['Invalid bank rows',stats.invalidBankRows],['Duplicate sales key groups',stats.duplicateSalesGroups],['Duplicate bank key groups',stats.duplicateBankGroups],['Automatically matched',r.matched.filter(item=>item.decision.startsWith('Auto:')).length],['Manually confirmed',r.matched.filter(item=>item.decision.startsWith('Manually')).length]];
  return [
    {name:'Summary',rows:summary},{name:'Matched',rows:matched},{name:'Unmatched_Sales',rows:unmatchedSide(r.unmatchedLeft,r.left,state.leftTable.headers)},{name:'Unmatched_Bank',rows:unmatchedSide(r.unmatchedRight,r.right,state.rightTable.headers)},
    {name:'Ambiguous',rows:matrix(ambiguous)},{name:'Duplicates',rows:matrix(duplicates)},{name:'Invalid_Rows',rows:matrix(invalid)},{name:'Processing_Log',rows:log},{name:'Settings',rows:settings}
  ];
}

$('#pick-left').onclick = () => pick('left'); $('#pick-right').onclick = () => pick('right'); $('#add-key').onclick = addKey; $('#run').onclick = run;
$('#result-search').addEventListener('input', event => { state.resultFilters[state.activeTab] = event.currentTarget.value; filterResultRows(); });
$('#export').onclick = async () => {
  try { const result = await window.localFiles.saveReport({ sheets: buildReport(), sourcePaths: [state.left.sourcePath,state.right.sourcePath] }); if (result) alert(`Saved ${result.fileName}.`); } catch (error) { alert(error.message); }
};
