const seasonEl = document.getElementById('season');
const weekEl = document.getElementById('week');
const errorEl = document.getElementById('error');
const entryView = document.getElementById('entryView');
const confirmView = document.getElementById('confirmView');
const resultView = document.getElementById('resultView');

for (let y = 2025; y <= 2026; y++) {
  const opt = document.createElement('option'); opt.value = y; opt.textContent = y; if (y===2025) opt.selected = true; seasonEl.appendChild(opt);
}
for (let w = 1; w <= 18; w++) {
  const opt = document.createElement('option'); opt.value = w; opt.textContent = w; weekEl.appendChild(opt);
}

const starterSlots = [
  ['qb','QB'],['rb1','RB1'],['rb2','RB2'],['wr1','WR1'],['wr2','WR2'],['te','TE'],['k','K'],['teamOffense','Team Offense'],['teamDefense','Team Defense'],['idp1','IDP1'],['idp2','IDP2'],['idp3','IDP3'],['idp4','IDP4']
];
const otSlots = [['qb','OT QB'],['rb','OT RB'],['wr','OT WR']];

function renderTeamSection(el, prefix, title) {
  el.innerHTML = `<h2>${title}</h2><h3>Starting Lineup</h3><div class="grid two" id="${prefix}Starters"></div><h3>Overtime Lineup</h3><div class="grid two" id="${prefix}Ot"></div>`;
  const starters = el.querySelector(`#${prefix}Starters`);
  starterSlots.forEach(([slot,label]) => {
    starters.insertAdjacentHTML('beforeend', `<label>${label}<input id="${prefix}_${slot}" /></label>`);
  });
  const ot = el.querySelector(`#${prefix}Ot`);
  otSlots.forEach(([slot,label]) => {
    ot.insertAdjacentHTML('beforeend', `<label>${label}<input id="${prefix}_ot_${slot}" /></label>`);
  });
}
renderTeamSection(document.getElementById('teamASection'), 'teamA', 'Team A');
renderTeamSection(document.getElementById('teamBSection'), 'teamB', 'Team B');

function buildPayload() {
  const team = prefix => ({
    starters: Object.fromEntries(starterSlots.map(([slot]) => [slot, document.getElementById(`${prefix}_${slot}`).value.trim()])),
    ot: Object.fromEntries(otSlots.map(([slot]) => [slot, document.getElementById(`${prefix}_ot_${slot}`).value.trim()])),
  });
  return {
    season: Number(seasonEl.value),
    week: Number(weekEl.value),
    teamAName: document.getElementById('teamAName').value.trim(),
    teamBName: document.getElementById('teamBName').value.trim(),
    teamA: team('teamA'),
    teamB: team('teamB')
  };
}

function showError(msg) {
  errorEl.textContent = msg; errorEl.classList.remove('hidden');
}
function clearError() { errorEl.classList.add('hidden'); errorEl.textContent = ''; }

async function calculate(payload) {
  clearError();
  const resp = await fetch('/api/matchups/calculate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await resp.json();
  if (!resp.ok || data.status === 'error') throw new Error(data.message || 'Request failed');
  if (data.requiresConfirmation) return renderConfirm(data.matchup || payload, data);
  renderResults(data.result);
}

function renderConfirm(matchup, data) {
  entryView.classList.add('hidden'); resultView.classList.add('hidden'); confirmView.classList.remove('hidden');
  const unresolved = [...(data.unresolvedPlayers||[]), ...(data.unresolvedTeams||[])];
  confirmView.innerHTML = `<section class="panel"><h2>Needs Confirmation</h2><div id="confirmList"></div><div class="actions"><button id="confirmBtn">Confirm and Calculate</button><button id="backBtn" class="secondary">Back to Edit Lineups</button></div></section>`;
  const list = document.getElementById('confirmList');
  unresolved.forEach((item, idx) => {
    if (item.suggestions && item.suggestions.length) {
      const options = item.suggestions.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
      list.insertAdjacentHTML('beforeend', `<div class="suggestions"><h3>${item.slot}</h3><div class="small">Typed: ${item.typedName}</div><label>Choose match<select data-slot="${item.slot}"><option value="">-- choose --</option>${options}</select></label></div>`);
    } else {
      list.insertAdjacentHTML('beforeend', `<div class="suggestions"><h3>${item.slot}</h3><div class="small">No ESPN player candidate found for: ${item.typedName}</div></div>`);
    }
  });
  document.getElementById('backBtn').onclick = () => { confirmView.classList.add('hidden'); entryView.classList.remove('hidden'); };
  document.getElementById('confirmBtn').onclick = async () => {
    try {
      const resolutions = {};
      let missingChoice = false;
      confirmView.querySelectorAll('select[data-slot]').forEach(sel => { if (sel.value) resolutions[sel.dataset.slot] = sel.value; else missingChoice = true; });
      if (missingChoice) throw new Error('Please choose a match for each unresolved player before calculating.');
      const resp = await fetch('/api/matchups/resolve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ matchup, resolutions }) });
      const out = await resp.json();
      if (!resp.ok || out.status === 'error') throw new Error(out.message || 'Resolve failed');
      renderResults(out.result);
    } catch (e) { showError(e.message); }
  };
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : Number(v).toFixed(1);
}

function line(label, value, unit, bold) {
  return `<div class="${bold ? 'boldline' : ''}">${label} = ${fmt(value)} ${unit}</div>`;
}

function buildCopyText(result) {
  const order = [
    ['passing','Passing','yards'],['rushing','Rushing','yards'],['receiving','Receiving','yards'],['total','Total','yards'],['idp','IDP','points'],['offenseDefense','Offense/Defense','points'],['points','Points','points']
  ];
  const makeBlock = (teamName, totals) => `${teamName} = ${totals.standingsPoints}\n` + order.map(([k,l,u]) => `${l} = ${fmt(totals[k])} ${u}`).join('\n');
  return `${makeBlock(result.teamAName, result.teamAResults)}\n\n${makeBlock(result.teamBName, result.teamBResults)}\n\nWinner = ${result.winner} ${result.finalScore}`;
}

function renderResults(result) {
  confirmView.classList.add('hidden'); entryView.classList.add('hidden'); resultView.classList.remove('hidden');
  const order = [
    ['passing','Passing','yards'],['rushing','Rushing','yards'],['receiving','Receiving','yards'],['total','Total','yards'],['idp','IDP','points'],['offenseDefense','Offense/Defense','points'],['points','Points','points']
  ];
  const block = (teamKey, name, totals) => `<div class="block"><div class="boldline">${name} = ${totals.standingsPoints}</div>${order.map(([key,label,unit]) => line(label, totals[key], unit, result.categoryWinners[key] === teamKey)).join('')}</div>`;
  let otHtml = '';
  if (result.overtimeUsed && result.overtime) {
    const otOrder = [['passing','Passing'],['rushing','Rushing'],['receiving','Receiving'],['total','Total'],['points','Points']];
    otHtml = `<section class="panel"><h2>Overtime</h2><div class="summary"><div class="block"><div class="boldline">${result.teamAName} OT</div>${otOrder.map(([k,l]) => line(l, result.overtime.teamA[k], k==='points'?'points':'yards', result.overtime.winners[k] === 'teamA')).join('')}</div><div class="block"><div class="boldline">${result.teamBName} OT</div>${otOrder.map(([k,l]) => line(l, result.overtime.teamB[k], k==='points'?'points':'yards', result.overtime.winners[k] === 'teamB')).join('')}</div></div></section>`;
  }
  resultView.innerHTML = `<section class="panel"><h2>Results</h2><div class="small">Season ${result.season} • Week ${result.week}</div><div class="summary">${block('teamA', result.teamAName, result.teamAResults)}${block('teamB', result.teamBName, result.teamBResults)}</div><div class="winner">Winner = ${result.winner} ${result.finalScore}</div><div class="actions"><button id="copyBtn">Copy Results</button><button id="editBtn" class="secondary">Back to Edit Lineups</button></div></section>${otHtml}`;
  document.getElementById('copyBtn').onclick = async () => { await navigator.clipboard.writeText(buildCopyText(result)); alert('Results copied.'); };
  document.getElementById('editBtn').onclick = () => { resultView.classList.add('hidden'); entryView.classList.remove('hidden'); };
}

document.getElementById('calcBtn').onclick = async () => {
  try { await calculate(buildPayload()); } catch (e) { showError(e.message); }
};
document.getElementById('clearBtn').onclick = () => location.reload();
