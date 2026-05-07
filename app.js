import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const TEAM_ALIASES = {
  ARI: ['ARI','ARIZONA','CARDINALS','ARIZONA CARDINALS'],
  ATL: ['ATL','ATLANTA','FALCONS','ATLANTA FALCONS'],
  BAL: ['BAL','BALTIMORE','RAVENS','BALTIMORE RAVENS'],
  BUF: ['BUF','BUFFALO','BILLS','BUFFALO BILLS'],
  CAR: ['CAR','CAROLINA','PANTHERS','CAROLINA PANTHERS'],
  CHI: ['CHI','CHICAGO','BEARS','CHICAGO BEARS'],
  CIN: ['CIN','CINCINNATI','BENGALS','CINCINNATI BENGALS'],
  CLE: ['CLE','CLEVELAND','BROWNS','CLEVELAND BROWNS'],
  DAL: ['DAL','DALLAS','COWBOYS','DALLAS COWBOYS'],
  DEN: ['DEN','DENVER','BRONCOS','DENVER BRONCOS'],
  DET: ['DET','DETROIT','LIONS','DETROIT LIONS'],
  GB: ['GB','GREEN BAY','PACKERS','GREEN BAY PACKERS'],
  HOU: ['HOU','HOUSTON','TEXANS','HOUSTON TEXANS'],
  IND: ['IND','INDIANAPOLIS','COLTS','INDIANAPOLIS COLTS'],
  JAX: ['JAX','JAC','JACKSONVILLE','JAGUARS','JACKSONVILLE JAGUARS'],
  KC: ['KC','KANSAS CITY','CHIEFS','KANSAS CITY CHIEFS'],
  LV: ['LV','LAS VEGAS','RAIDERS','LAS VEGAS RAIDERS'],
  LAC: ['LAC','LA CHARGERS','LOS ANGELES CHARGERS','CHARGERS'],
  LAR: ['LAR','LA RAMS','LOS ANGELES RAMS','RAMS'],
  MIA: ['MIA','MIAMI','DOLPHINS','MIAMI DOLPHINS'],
  MIN: ['MIN','MINNESOTA','VIKINGS','MINNESOTA VIKINGS'],
  NE: ['NE','NEW ENGLAND','PATRIOTS','NEW ENGLAND PATRIOTS'],
  NO: ['NO','NEW ORLEANS','SAINTS','NEW ORLEANS SAINTS'],
  NYG: ['NYG','NY GIANTS','NEW YORK GIANTS','GIANTS'],
  NYJ: ['NYJ','NY JETS','NEW YORK JETS','JETS'],
  PHI: ['PHI','PHILADELPHIA','EAGLES','PHILADELPHIA EAGLES'],
  PIT: ['PIT','PITTSBURGH','STEELERS','PITTSBURGH STEELERS'],
  SEA: ['SEA','SEATTLE','SEAHAWKS','SEATTLE SEAHAWKS'],
  SF: ['SF','SAN FRANCISCO','49ERS','SAN FRANCISCO 49ERS'],
  TB: ['TB','TAMPA BAY','BUCCANEERS','TAMPA BAY BUCCANEERS','BUCS'],
  TEN: ['TEN','TENNESSEE','TITANS','TENNESSEE TITANS'],
  WAS: ['WAS','WASHINGTON','COMMANDERS','WASHINGTON COMMANDERS']
};

const REQUIRED_TEAM_SLOTS = [
  'qb','rb1','rb2','wr1','wr2','te','k','teamOffense','teamDefense','idp1','idp2','idp3','idp4'
];
const REQUIRED_OT_SLOTS = ['qb','rb','wr'];
const FETCH_TIMEOUT_MS = 15000;
const SUMMARY_CONCURRENCY = 4;
const CACHE_TTL_MS = 10 * 60 * 1000;
const weekCache = new Map();

function normalizeName(name='') {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\.']/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTeam(input='') {
  const needle = String(input).toUpperCase().trim();
  for (const [abbr, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(needle)) return abbr;
  }
  return null;
}

function validateMatchup(body) {
  if (!body || !body.teamA || !body.teamB) return 'Missing matchup payload.';
  if (!Number.isInteger(Number(body.season))) return 'Season is required.';
  if (!Number.isInteger(Number(body.week)) || Number(body.week) < 1 || Number(body.week) > 18) return 'Week must be between 1 and 18.';
  if (!String(body.teamAName || '').trim()) return 'Team A name is required.';
  if (!String(body.teamBName || '').trim()) return 'Team B name is required.';
  for (const [label, team] of [['Team A', body.teamA], ['Team B', body.teamB]]) {
    for (const slot of REQUIRED_TEAM_SLOTS) {
      if (!String(team?.starters?.[slot] || '').trim()) return `${label} ${slot} is required.`;
    }
    for (const slot of REQUIRED_OT_SLOTS) {
      if (!String(team?.ot?.[slot] || '').trim()) return `${label} OT ${slot} is required.`;
    }
  }
  return null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FantasyMatchupTool/0.2' },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${url}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWeekEvents(season, week) {
  const scoreboard = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`);
  return scoreboard.events || [];
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function numberFromText(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseMadeAttempt(text) {
  const [made] = String(text || '0/0').split('/');
  return numberFromText(made);
}

function createEmptyPlayer(rawName, team='', gameId='') {
  return {
    playerName: rawName,
    normalizedName: normalizeName(rawName),
    team,
    gameId,
    passingYards: 0,
    passingTd: 0,
    passing2Pt: 0,
    rushingYards: 0,
    rushingTd: 0,
    rushing2Pt: 0,
    receivingYards: 0,
    receivingTd: 0,
    receiving2Pt: 0,
    xpMade: 0,
    fg0to39: 0,
    fg40to49: 0,
    fg50plus: 0,
    soloTackles: 0,
    assistTackles: 0,
    soloSacks: 0,
    halfSacks: 0,
    interceptions: 0,
    forcedFumbles: 0,
    fumbleRecoveries: 0,
    defensiveTd: 0,
  };
}

function mergePlayerStats(existing, incoming) {
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === 'number' && Number.isFinite(v)) existing[k] = (existing[k] || 0) + v;
  }
  return existing;
}

function extractStatMap(boxscoreGroup) {
  const result = {};
  const labels = boxscoreGroup?.labels || [];
  const athletes = boxscoreGroup?.athletes || [];
  for (const athleteGroup of athletes) {
    const entries = athleteGroup?.athletes || athleteGroup?.items || [];
    for (const athlete of entries) {
      const displayName = athlete?.athlete?.displayName || athlete?.displayName || athlete?.athlete?.shortName || '';
      if (!displayName) continue;
      const stats = athlete?.stats || [];
      const map = {};
      labels.forEach((label, idx) => {
        map[String(label).toLowerCase()] = stats[idx];
      });
      result[displayName] = map;
    }
  }
  return result;
}

function classifyScoringPlayForDefense(playText='') {
  const t = playText.toLowerCase();
  const isSafety = t.includes('safety');
  const isDefTd = t.includes('interception return') || t.includes('fumble return') || t.includes('punt return') || t.includes('kickoff return') || t.includes('blocked punt return') || t.includes('blocked field goal return');
  return { isSafety, isDefTd };
}

function applySummaryData(summary, playersByName, teamsByAbbr) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const gameId = summary?.header?.id || summary?.event?.id || '';

  for (const comp of competitors) {
    const abbr = comp?.team?.abbreviation;
    if (!abbr) continue;
    if (!teamsByAbbr.has(abbr)) {
      teamsByAbbr.set(abbr, {
        team: abbr,
        gameId,
        pointsScored: numberFromText(comp?.score),
        pointsAllowed: 0,
        defensiveTd: 0,
        safeties: 0,
      });
    } else {
      teamsByAbbr.get(abbr).pointsScored = numberFromText(comp?.score);
      teamsByAbbr.get(abbr).gameId = gameId;
    }
  }

  if (competitors.length === 2) {
    const [a,b] = competitors;
    const aAbbr = a?.team?.abbreviation;
    const bAbbr = b?.team?.abbreviation;
    if (aAbbr && teamsByAbbr.has(aAbbr)) teamsByAbbr.get(aAbbr).pointsAllowed = numberFromText(b?.score);
    if (bAbbr && teamsByAbbr.has(bAbbr)) teamsByAbbr.get(bAbbr).pointsAllowed = numberFromText(a?.score);
  }

  const scoringPlays = summary?.scoringPlays || [];
  for (const play of scoringPlays) {
    const teamAbbr = play?.team?.abbreviation;
    if (!teamAbbr || !teamsByAbbr.has(teamAbbr)) continue;
    const flags = classifyScoringPlayForDefense(play?.text || '');
    if (flags.isSafety) teamsByAbbr.get(teamAbbr).safeties += 1;
    if (flags.isDefTd) teamsByAbbr.get(teamAbbr).defensiveTd += 1;
  }

  const boxPlayers = summary?.boxscore?.players || [];
  for (const teamBlock of boxPlayers) {
    const teamAbbr = teamBlock?.team?.abbreviation || '';
    for (const statGroup of teamBlock?.statistics || []) {
      const category = String(statGroup?.name || '').toLowerCase();
      const statMap = extractStatMap(statGroup);
      for (const [displayName, statLine] of Object.entries(statMap)) {
        const base = playersByName.get(normalizeName(displayName)) || createEmptyPlayer(displayName, teamAbbr, gameId);
        const incoming = {};
        if (category.includes('passing')) {
          incoming.passingYards = numberFromText(statLine['yds'] ?? statLine['yards']);
          incoming.passingTd = numberFromText(statLine['td'] ?? statLine['touchdowns']);
          incoming.passing2Pt = numberFromText(statLine['2pt'] ?? statLine['2pt conv'] ?? statLine['2pt conversions']);
        } else if (category.includes('rushing')) {
          incoming.rushingYards = numberFromText(statLine['yds'] ?? statLine['yards']);
          incoming.rushingTd = numberFromText(statLine['td'] ?? statLine['touchdowns']);
          incoming.rushing2Pt = numberFromText(statLine['2pt'] ?? statLine['2pt conv'] ?? statLine['2pt conversions']);
        } else if (category.includes('receiving')) {
          incoming.receivingYards = numberFromText(statLine['yds'] ?? statLine['yards']);
          incoming.receivingTd = numberFromText(statLine['td'] ?? statLine['touchdowns']);
          incoming.receiving2Pt = numberFromText(statLine['2pt'] ?? statLine['2pt conv'] ?? statLine['2pt conversions']);
        } else if (category.includes('kicking')) {
          incoming.xpMade = parseMadeAttempt(statLine['xp'] ?? statLine['xpm']);
          const fgText = String(statLine['fg'] ?? statLine['fgm-l'] ?? '');
          incoming.fg0to39 = 0;
          incoming.fg40to49 = 0;
          incoming.fg50plus = 0;
          if (fgText.includes(',')) {
            fgText.split(',').map(s => s.trim()).forEach(segment => {
              const m = segment.match(/(\d+)/);
              if (!m) return;
              const dist = Number(m[1]);
              if (dist >= 50) incoming.fg50plus += 1;
              else if (dist >= 40) incoming.fg40to49 += 1;
              else incoming.fg0to39 += 1;
            });
          } else {
            incoming.fg0to39 = parseMadeAttempt(fgText);
          }
        } else if (category.includes('defensive')) {
          incoming.soloTackles = numberFromText(statLine['solo'] ?? statLine['tot']);
          incoming.assistTackles = numberFromText(statLine['ast']);
          const sacksRaw = numberFromText(statLine['sacks'] ?? statLine['sack']);
          incoming.soloSacks = Math.floor(sacksRaw);
          incoming.halfSacks = Math.round((sacksRaw - Math.floor(sacksRaw)) * 2) / 2;
          incoming.interceptions = numberFromText(statLine['int']);
          incoming.forcedFumbles = numberFromText(statLine['ff']);
          incoming.fumbleRecoveries = numberFromText(statLine['fr']);
          incoming.defensiveTd = numberFromText(statLine['td']);
        }
        playersByName.set(base.normalizedName, mergePlayerStats(base, incoming));
      }
    }
  }
}

async function fetchAndNormalizeWeekData(season, week) {
  const cacheKey = `${season}-${week}`;
  const cached = weekCache.get(cacheKey);
  if (cached && (Date.now() - cached.createdAt < CACHE_TTL_MS)) return cached.data;

  const events = await fetchWeekEvents(season, week);
  const playersByName = new Map();
  const teamsByAbbr = new Map();

  await mapWithConcurrency(events, SUMMARY_CONCURRENCY, async (event) => {
    const gameId = event.id;
    const summary = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`);
    applySummaryData(summary, playersByName, teamsByAbbr);
  });

  const data = { playersByName, teamsByAbbr, gamesFound: events.length };
  weekCache.set(cacheKey, { createdAt: Date.now(), data });
  return data;
}

function exactOrSuggestPlayer(inputName, playersByName) {
  const normalized = normalizeName(inputName);
  if (playersByName.has(normalized)) return { match: playersByName.get(normalized), suggestions: [] };
  const inputTokens = new Set(normalized.split(' ').filter(Boolean));
  const suggestions = [...playersByName.values()]
    .map(p => ({ ...p, score: [...inputTokens].filter(t => p.normalizedName.includes(t)).length }))
    .filter(p => p.score > 0)
    .sort((a,b) => b.score - a.score || a.playerName.localeCompare(b.playerName))
    .slice(0,5)
    .map(p => ({ id: `player:${p.playerName}:${p.team}`, label: `${p.playerName} (${p.team})` }));
  return { match: null, suggestions };
}

function resolvePlayerById(id, playersByName) {
  const parts = String(id).split(':');
  if (parts[0] !== 'player') return null;
  const name = parts[1];
  return playersByName.get(normalizeName(name)) || null;
}

function scoreOffensePlayer(p) {
  return (p.passingTd * 4) + (p.rushingTd * 6) + (p.receivingTd * 6) + ((p.passing2Pt + p.rushing2Pt + p.receiving2Pt) * 2);
}
function scoreKicker(p) {
  return (p.xpMade * 1) + (p.fg0to39 * 3) + (p.fg40to49 * 4) + (p.fg50plus * 5);
}
function scoreIDPPointsCategory(p) { return p.defensiveTd * 6; }
function scoreIDPCategory(p) {
  return (p.soloTackles * 1) + (p.assistTackles * 0.5) + (p.soloSacks * 10) + (p.halfSacks * 5) + (p.interceptions * 20) + (p.forcedFumbles * 10) + (p.fumbleRecoveries * 10);
}

function compare(a,b) {
  if (Math.abs(a-b) < 1e-9) return 'teamTie';
  return a > b ? 'teamA' : 'teamB';
}

function calcTeamTotals(teamInput, resolvedPlayers, resolvedTeams) {
  const offenseSlots = ['qb','rb1','rb2','wr1','wr2','te'];
  const idpSlots = ['idp1','idp2','idp3','idp4'];
  const offense = offenseSlots.map(slot => resolvedPlayers[slot]);
  const kicker = resolvedPlayers.k;
  const idps = idpSlots.map(slot => resolvedPlayers[slot]);
  const teamOffense = resolvedTeams.teamOffense;
  const teamDefense = resolvedTeams.teamDefense;

  const passingYards = offense.reduce((s,p)=>s+(p?.passingYards||0),0) / 1.5;
  const rushingYards = offense.reduce((s,p)=>s+(p?.rushingYards||0),0);
  const receivingYards = offense.reduce((s,p)=>s+(p?.receivingYards||0),0);
  const total = passingYards + rushingYards + receivingYards;
  const points = offense.reduce((s,p)=>s+scoreOffensePlayer(p||createEmptyPlayer('')),0) + scoreKicker(kicker||createEmptyPlayer('')) + idps.reduce((s,p)=>s+scoreIDPPointsCategory(p||createEmptyPlayer('')),0);
  const idp = idps.reduce((s,p)=>s+scoreIDPCategory(p||createEmptyPlayer('')),0);
  const adjustedAllowed = (teamDefense?.pointsAllowed||0) - ((teamDefense?.defensiveTd||0) * 6) - ((teamDefense?.safeties||0) * 2);
  const offenseDefense = (teamOffense?.pointsScored||0) - adjustedAllowed;
  return { standingsPoints: 0, passing: passingYards, rushing: rushingYards, receiving: receivingYards, total, idp, offenseDefense, points };
}

function calcOT(_teamInput, resolvedPlayers) {
  const offense = [resolvedPlayers.qb, resolvedPlayers.rb, resolvedPlayers.wr];
  const passing = offense.reduce((s,p)=>s+(p?.passingYards||0),0) / 1.5;
  const rushing = offense.reduce((s,p)=>s+(p?.rushingYards||0),0);
  const receiving = offense.reduce((s,p)=>s+(p?.receivingYards||0),0);
  const total = passing + rushing + receiving;
  const points = offense.reduce((s,p)=>s+scoreOffensePlayer(p||createEmptyPlayer('')),0);
  return { passing, rushing, receiving, total, points };
}

function scoreMatchup(body, resolved) {
  const teamAResults = calcTeamTotals(body.teamA, resolved.teamA.starters, resolved.teamA.teams);
  const teamBResults = calcTeamTotals(body.teamB, resolved.teamB.starters, resolved.teamB.teams);
  const categoryWinners = {
    passing: compare(teamAResults.passing, teamBResults.passing),
    rushing: compare(teamAResults.rushing, teamBResults.rushing),
    receiving: compare(teamAResults.receiving, teamBResults.receiving),
    total: compare(teamAResults.total, teamBResults.total),
    idp: compare(teamAResults.idp, teamBResults.idp),
    offenseDefense: compare(teamAResults.offenseDefense, teamBResults.offenseDefense),
    points: compare(teamAResults.points, teamBResults.points),
  };
  let aWins=0,bWins=0,aStand=0,bStand=0;
  for (const winner of Object.values(categoryWinners)) {
    if (winner === 'teamA') { aWins += 1; aStand += 2; }
    else if (winner === 'teamB') { bWins += 1; bStand += 2; }
    else { aWins += 0.5; bWins += 0.5; aStand += 1; bStand += 1; }
  }
  teamAResults.standingsPoints = aStand;
  teamBResults.standingsPoints = bStand;

  let overtimeUsed = false;
  let overtime = undefined;
  let winnerName = '';

  if (aWins >= 4) winnerName = body.teamAName;
  else if (bWins >= 4) winnerName = body.teamBName;
  else if (Math.abs(aWins - 3.5) < 1e-9 && Math.abs(bWins - 3.5) < 1e-9 && aStand === 7 && bStand === 7) {
    overtimeUsed = true;
    const otA = calcOT(body.teamA.ot, resolved.teamA.ot);
    const otB = calcOT(body.teamB.ot, resolved.teamB.ot);
    const winners = {
      passing: compare(otA.passing, otB.passing),
      rushing: compare(otA.rushing, otB.rushing),
      receiving: compare(otA.receiving, otB.receiving),
      total: compare(otA.total, otB.total),
      points: compare(otA.points, otB.points),
    };
    const aOtWins = Object.values(winners).filter(w => w === 'teamA').length;
    const bOtWins = Object.values(winners).filter(w => w === 'teamB').length;
    winnerName = aOtWins >= 3 ? body.teamAName : bOtWins >= 3 ? body.teamBName : 'Tie';
    overtime = { teamA: otA, teamB: otB, winners, winner: winnerName };
  } else {
    winnerName = aStand > bStand ? body.teamAName : bStand > aStand ? body.teamBName : 'Tie';
  }

  return {
    season: Number(body.season),
    week: Number(body.week),
    teamAName: body.teamAName,
    teamBName: body.teamBName,
    teamAResults,
    teamBResults,
    categoryWinners,
    winner: winnerName,
    finalScore: `${aStand}-${bStand}`,
    overtimeUsed,
    overtime,
  };
}

function collectResolutions(input, weekData) {
  const unresolvedPlayers = [];
  const unresolvedTeams = [];
  const resolved = { teamA: { starters: {}, ot: {}, teams: {} }, teamB: { starters: {}, ot: {}, teams: {} } };

  for (const teamKey of ['teamA','teamB']) {
    for (const slot of ['qb','rb1','rb2','wr1','wr2','te','k','idp1','idp2','idp3','idp4']) {
      const name = input[teamKey].starters[slot];
      const { match, suggestions } = exactOrSuggestPlayer(name, weekData.playersByName);
      if (!match) unresolvedPlayers.push({ slot: `${teamKey}.starters.${slot}`, typedName: name, suggestions });
      else resolved[teamKey].starters[slot] = match;
    }
    for (const slot of ['qb','rb','wr']) {
      const name = input[teamKey].ot[slot];
      const { match, suggestions } = exactOrSuggestPlayer(name, weekData.playersByName);
      if (!match) unresolvedPlayers.push({ slot: `${teamKey}.ot.${slot}`, typedName: name, suggestions });
      else resolved[teamKey].ot[slot] = match;
    }
    for (const slot of ['teamOffense','teamDefense']) {
      const abbr = normalizeTeam(input[teamKey].starters[slot]);
      if (!abbr || !weekData.teamsByAbbr.has(abbr)) unresolvedTeams.push({ slot: `${teamKey}.starters.${slot}`, typedName: input[teamKey].starters[slot] });
      else resolved[teamKey].teams[slot] = weekData.teamsByAbbr.get(abbr);
    }
  }
  return { unresolvedPlayers, unresolvedTeams, resolved };
}

function applyResolutions(input, resolutions, weekData) {
  const base = collectResolutions(input, weekData).resolved;
  for (const [slot, id] of Object.entries(resolutions || {})) {
    const player = resolvePlayerById(id, weekData.playersByName);
    if (!player) continue;
    const [teamKey, area, position] = slot.split('.');
    if (teamKey && area && position) base[teamKey][area][position] = player;
  }
  return base;
}

app.post('/api/matchups/calculate', async (req, res) => {
  try {
    const error = validateMatchup(req.body);
    if (error) return res.status(400).json({ status: 'error', message: error });
    const weekData = await fetchAndNormalizeWeekData(Number(req.body.season), Number(req.body.week));
    if (!weekData.gamesFound) return res.status(404).json({ status: 'error', message: 'No ESPN game data was found for that season/week.' });
    const { unresolvedPlayers, unresolvedTeams, resolved } = collectResolutions(req.body, weekData);
    if (unresolvedPlayers.length || unresolvedTeams.length) {
      return res.json({ status: 'ok', requiresConfirmation: true, unresolvedPlayers, unresolvedTeams, matchup: req.body });
    }
    const result = scoreMatchup(req.body, resolved);
    return res.json({ status: 'ok', requiresConfirmation: false, result });
  } catch (err) {
    console.error('calculate failed', err);
    return res.status(500).json({ status: 'error', message: 'Stats could not be fetched right now. Please try again.' });
  }
});

app.post('/api/matchups/resolve', async (req, res) => {
  try {
    const { matchup, resolutions } = req.body || {};
    const error = validateMatchup(matchup);
    if (error) return res.status(400).json({ status: 'error', message: error });
    const weekData = await fetchAndNormalizeWeekData(Number(matchup.season), Number(matchup.week));
    const resolved = applyResolutions(matchup, resolutions, weekData);
    const result = scoreMatchup(matchup, resolved);
    return res.json({ status: 'ok', requiresConfirmation: false, result });
  } catch (err) {
    console.error('resolve failed', err);
    return res.status(500).json({ status: 'error', message: 'Stats could not be fetched right now. Please try again.' });
  }
});

app.get('/api/weeks/:season/:week/status', async (req, res) => {
  try {
    const events = await fetchWeekEvents(Number(req.params.season), Number(req.params.week));
    return res.json({ status: 'ok', season: Number(req.params.season), week: Number(req.params.week), gamesFound: events.length });
  } catch (_err) {
    return res.status(500).json({ status: 'error', message: 'Week status unavailable.' });
  }
});

app.get('/api/teams', (_req, res) => {
  const teams = Object.entries(TEAM_ALIASES).map(([abbr, aliases]) => ({ abbr, name: aliases[aliases.length - 1], aliases }));
  return res.json({ teams });
});

export default app;
