const SIZE = 6;
const P1 = "Blue";
const P2 = "Red";
const TURN_SECONDS = 25;

const unitIcons = { Commander: "♔", Soldier: "⚔", Scout: "➤", Tank: "🛡", Artillery: "✹" };

const maps = {
  center: {
    name: "Center Pressure",
    objective: { x: 2, y: 2 },
    cover: ["1,2", "1,3", "4,2", "4,3"],
    hills: ["2,1", "3,4"],
    desc: "Balanced center objective with two hills creating LOS lanes.",
  },
  ridge: {
    name: "Broken Ridge",
    objective: { x: 3, y: 2 },
    cover: ["0,2", "5,3", "2,4", "3,1"],
    hills: ["2,2", "3,2", "2,3"],
    desc: "Central hill ridge blocks ranged lanes unless flanked.",
  },
  split: {
    name: "Split Pass",
    objective: { x: 2, y: 3 },
    cover: ["1,1", "4,4", "0,3", "5,2"],
    hills: ["1,2", "4,3"],
    desc: "Split hill chokepoints reward mobile climbing units.",
  },
};

const rosterTemplate = [
  { type: "Commander", hp: 3, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: true },
  { type: "Soldier", hp: 2, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: false },
  { type: "Soldier", hp: 2, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: false },
  { type: "Scout", hp: 2, move: 2, minRange: 1, maxRange: 1, damage: 1, canClimb: true },
  { type: "Tank", hp: 4, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: false },
  { type: "Artillery", hp: 2, move: 1, minRange: 2, maxRange: 3, damage: 2, canClimb: false },
];

const state = {
  units: [], current: P1, round: 1, ap: 2, selectedUnitId: null,
  sprintedScouts: new Set(), objectiveOwner: null, objectiveHoldPending: null,
  winner: null, actionFeed: "No actions yet.", history: [], turnSecondsLeft: TURN_SECONDS,
  showThreatMap: true, mapKey: "center",
};

const boardEl = document.getElementById("board");
const mapSelectEl = document.getElementById("mapSelect");
const mapInfoEl = document.getElementById("mapInfo");
const turnPlayerEl = document.getElementById("turnPlayer");
const roundNumEl = document.getElementById("roundNum");
const apLeftEl = document.getElementById("apLeft");
const objectiveStatusEl = document.getElementById("objectiveStatus");
const turnTimerEl = document.getElementById("turnTimer");
const threatToggleEl = document.getElementById("threatToggle");
const messageEl = document.getElementById("message");
const unitInfoEl = document.getElementById("unitInfo");
const actionFeedEl = document.getElementById("actionFeed");
const historyFeedEl = document.getElementById("historyFeed");
const legendListEl = document.getElementById("legendList");

document.getElementById("endTurnBtn").addEventListener("click", endTurn);
document.getElementById("resetBtn").addEventListener("click", initGame);
threatToggleEl.addEventListener("change", () => { state.showThreatMap = threatToggleEl.checked; render(); });
mapSelectEl.addEventListener("change", () => { state.mapKey = mapSelectEl.value; initGame(); });
document.addEventListener("keydown", (event) => { if (event.key.toLowerCase() === "e") endTurn(); });

setInterval(() => {
  if (state.winner) return;
  state.turnSecondsLeft -= 1;
  if (state.turnSecondsLeft <= 0) { state.turnSecondsLeft = 0; setMessage(`${state.current} timed out. Turn auto-ended.`); endTurn(); }
  else renderHudOnly();
}, 1000);

function currentMap() { return maps[state.mapKey]; }
function mapSet(list) { return new Set(list); }
function hillSet() { return mapSet(currentMap().hills); }
function coverSet() { return mapSet(currentMap().cover); }
function objective() { return currentMap().objective; }
function tileKey(x, y) { return `${x},${y}`; }
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function getUnitAt(x, y) { return state.units.find(u => u.x === x && u.y === y); }
function getSelectedUnit() { return state.units.find(u => u.id === state.selectedUnitId); }
function isHill(x, y) { return hillSet().has(tileKey(x, y)); }

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function isLosBlocked(attacker, defender) {
  if (attacker.maxRange === 1) return false;
  const dx = defender.x - attacker.x;
  const dy = defender.y - attacker.y;

  // Keep ranged LOS deterministic and readable: orthogonal or diagonal lanes only.
  const isOrthogonal = dx === 0 || dy === 0;
  const isDiagonal = Math.abs(dx) === Math.abs(dy);
  if (!(isOrthogonal || isDiagonal)) return true;

  const stepDiv = gcd(dx, dy);
  const stepX = dx / stepDiv;
  const stepY = dy / stepDiv;
  for (let i = 1; i < stepDiv; i++) {
    const x = attacker.x + stepX * i;
    const y = attacker.y + stepY * i;
    if (isHill(x, y)) return true;
  }
  return false;
}

function canOccupyTile(unit, x, y) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  if (getUnitAt(x, y)) return false;
  if (isHill(x, y) && !unit.canClimb) return false;
  return true;
}

function legalMoves(unit) {
  const visited = new Set([tileKey(unit.x, unit.y)]);
  const queue = [{ x: unit.x, y: unit.y, steps: 0 }];
  const result = [];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.steps >= unit.move) continue;

    const neighbors = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ];

    for (const next of neighbors) {
      const key = tileKey(next.x, next.y);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!canOccupyTile(unit, next.x, next.y)) continue;
      result.push({ x: next.x, y: next.y });
      queue.push({ x: next.x, y: next.y, steps: cur.steps + 1 });
    }
  }

  return result;
}

function legalAttacks(unit) {
  const enemies = state.units.filter(u => u.owner !== unit.owner);
  return enemies.filter(enemy => {
    const d = manhattan(unit, enemy);
    if (d < unit.minRange || d > unit.maxRange) return false;
    if (isLosBlocked(unit, enemy)) return false;
    return true;
  });
}

function threatenedTilesForUnit(unit) {
  const threatened = new Set();
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      if (x === unit.x && y === unit.y) continue;
      const distance = Math.abs(unit.x - x) + Math.abs(unit.y - y);
      if (distance < unit.minRange || distance > unit.maxRange) continue;
      if (isLosBlocked(unit, { x, y, maxRange: 1 })) continue;
      threatened.add(tileKey(x, y));
    }
  }
  return threatened;
}

function threatTiles(forPlayer) {
  const enemies = state.units.filter(u => u.owner !== forPlayer);
  const threat = new Set();
  for (const enemy of enemies) {
    for (const key of threatenedTilesForUnit(enemy)) {
      threat.add(key);
    }
  }
  return threat;
}

function addHistory(entry) { state.history.unshift(entry); state.history = state.history.slice(0, 12); }

function initLegend() {
  legendListEl.innerHTML = "";
  ["Commander", "Soldier", "Scout", "Tank", "Artillery"].forEach(type => {
    const canClimb = rosterTemplate.find(u => u.type === type)?.canClimb ? "can climb" : "no climb";
    const li = document.createElement("li");
    li.innerHTML = `<span>${unitIcons[type]}</span><span>${type} (${canClimb})</span>`;
    legendListEl.appendChild(li);
  });
}

function initMapSelect() {
  mapSelectEl.innerHTML = Object.entries(maps).map(([key, m]) => `<option value="${key}">${m.name}</option>`).join("");
  mapSelectEl.value = state.mapKey;
}

function initGame() {
  state.units = []; state.current = P1; state.round = 1; state.ap = 2; state.selectedUnitId = null;
  state.sprintedScouts = new Set(); state.objectiveOwner = null; state.objectiveHoldPending = null;
  state.winner = null; state.actionFeed = "No actions yet."; state.history = []; state.turnSecondsLeft = TURN_SECONDS;
  threatToggleEl.checked = state.showThreatMap;

  const p1Rows = [5, 4], p2Rows = [0, 1];
  rosterTemplate.forEach((unit, idx) => {
    const col = idx;
    state.units.push({ id: `p1-${idx}`, owner: P1, x: col, y: p1Rows[idx > 2 ? 1 : 0], ...structuredClone(unit) });
    state.units.push({ id: `p2-${idx}`, owner: P2, x: col, y: p2Rows[idx > 2 ? 1 : 0], ...structuredClone(unit) });
  });

  addHistory(`Round 1: ${state.current} starts on ${currentMap().name}.`);
  setMessage(`${state.current} to act.`);
  mapInfoEl.textContent = currentMap().desc;
  initMapSelect();
  initLegend();
  render();
}

function resolveAttack(attacker, defender) {
  let damage = attacker.damage;
  const defenderOnCover = coverSet().has(tileKey(defender.x, defender.y));
  const rangedAttack = attacker.maxRange > 1;
  if (defenderOnCover && rangedAttack) damage = Math.max(1, damage - 1);
  if (defender.type === "Tank" && rangedAttack) damage = Math.max(1, damage - 1);

  defender.hp -= damage;
  state.actionFeed = `${attacker.owner} ${attacker.type} hit ${defender.owner} ${defender.type} for ${damage}.`;
  addHistory(state.actionFeed); setMessage(state.actionFeed);

  if (defender.hp <= 0) {
    const defeatedCommander = defender.type === "Commander";
    state.units = state.units.filter(u => u.id !== defender.id);
    state.actionFeed = `${attacker.owner} defeated ${defender.owner} ${defender.type}!`;
    addHistory(state.actionFeed); setMessage(state.actionFeed);
    if (defeatedCommander) { state.winner = attacker.owner; setMessage(`${state.winner} wins by Commander KO.`); }
  }
}

function onTileClick(x, y) {
  if (state.winner) return;
  const clicked = getUnitAt(x, y);
  const selected = getSelectedUnit();
  if (!selected) { if (clicked && clicked.owner === state.current) { state.selectedUnitId = clicked.id; render(); } return; }
  if (clicked && clicked.owner === state.current) { state.selectedUnitId = clicked.id; render(); return; }
  if (!(selected && selected.owner === state.current && state.ap > 0)) return;

  const moveTarget = legalMoves(selected).find(t => t.x === x && t.y === y);
  if (moveTarget && state.ap >= 1) {
    const dist = manhattan(selected, moveTarget);
    selected.x = x; selected.y = y; state.ap -= 1;
    if (selected.type === "Scout" && dist === 2) state.sprintedScouts.add(selected.id);
    state.actionFeed = `${selected.owner} moved ${selected.type} to (${x}, ${y}).`;
    addHistory(state.actionFeed); setMessage(state.actionFeed);
    if (state.ap <= 0 && !state.winner) endTurn(); else render();
    return;
  }

  if (clicked && clicked.owner !== state.current) {
    const canAttack = legalAttacks(selected).some(u => u.id === clicked.id);
    const scoutBlocked = selected.type === "Scout" && state.sprintedScouts.has(selected.id);
    if (canAttack && !scoutBlocked && state.ap >= 1) {
      resolveAttack(selected, clicked); state.ap -= 1;
      if (state.ap <= 0 && !state.winner) endTurn(); else render();
      return;
    }
    if (scoutBlocked) setMessage("Scout sprinted this turn and cannot attack.");
    if (!scoutBlocked && !canAttack) setMessage("Attack blocked (range or hill line-of-sight).");
  }
}

function evaluateObjective() {
  const obj = objective();
  const holder = getUnitAt(obj.x, obj.y);
  const owner = holder?.owner ?? null;
  if (owner !== state.objectiveOwner) { state.objectiveOwner = owner; state.objectiveHoldPending = owner; if (owner) addHistory(`${owner} captured objective.`); return; }
  if (owner && state.objectiveHoldPending === owner) { state.winner = owner; setMessage(`${owner} wins by objective hold.`); }
}

function applyDangerRing() {
  if (state.round < 8) return;
  for (const unit of [...state.units]) {
    if (unit.x === 0 || unit.x === SIZE - 1 || unit.y === 0 || unit.y === SIZE - 1) {
      unit.hp -= 1;
      if (unit.hp <= 0) {
        const commander = unit.type === "Commander";
        state.units = state.units.filter(u => u.id !== unit.id);
        if (commander && !state.winner) { state.winner = unit.owner === P1 ? P2 : P1; setMessage(`${state.winner} wins (enemy Commander lost in danger zone).`); }
      }
    }
  }
}

function tiebreakWinner() {
  const alive = owner => state.units.filter(u => u.owner === owner);
  const p1 = alive(P1), p2 = alive(P2);
  const p1Commander = p1.some(u => u.type === "Commander"), p2Commander = p2.some(u => u.type === "Commander");
  if (p1Commander !== p2Commander) return p1Commander ? P1 : P2;
  if (p1.length !== p2.length) return p1.length > p2.length ? P1 : P2;
  if (state.objectiveOwner) return state.objectiveOwner;
  const hp = arr => arr.reduce((sum, u) => sum + u.hp, 0);
  if (hp(p1) !== hp(p2)) return hp(p1) > hp(p2) ? P1 : P2;
  return null;
}

function endTurn() {
  if (state.winner) return;
  evaluateObjective(); if (!state.winner) applyDangerRing();
  if (!state.winner) {
    state.current = state.current === P1 ? P2 : P1;
    if (state.current === P1) state.round += 1;
    if (state.round > 20) { state.winner = tiebreakWinner(); setMessage(state.winner ? `${state.winner} wins by tiebreak.` : "Draw by tiebreak."); }
    else { setMessage(`${state.current} to act.`); addHistory(`Round ${state.round}: ${state.current} turn.`); }
  }
  state.ap = 2; state.selectedUnitId = null; state.sprintedScouts.clear(); state.turnSecondsLeft = TURN_SECONDS; render();
}

function renderHudOnly() {
  turnTimerEl.textContent = `${state.turnSecondsLeft}s`;
  turnTimerEl.classList.remove("warning", "critical");
  if (state.turnSecondsLeft <= 10) turnTimerEl.classList.add("warning");
  if (state.turnSecondsLeft <= 5) turnTimerEl.classList.add("critical");
}

function render() {
  boardEl.innerHTML = "";
  const selected = getSelectedUnit();
  const moves = selected ? legalMoves(selected).map(t => tileKey(t.x, t.y)) : [];
  const attacks = selected ? legalAttacks(selected).map(u => tileKey(u.x, u.y)) : [];
  const threats = state.showThreatMap ? threatTiles(state.current) : new Set();
  const dangerOn = state.round >= 8;
  const hills = hillSet();
  const covers = coverSet();
  const obj = objective();

  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.onclick = () => onTileClick(x, y);
    const unit = getUnitAt(x, y);

    if (x === obj.x && y === obj.y) tile.classList.add("objective");
    if (covers.has(tileKey(x, y))) tile.classList.add("cover");
    if (hills.has(tileKey(x, y))) tile.classList.add("hill");
    if (dangerOn && (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1)) tile.classList.add("danger");
    if (selected?.x === x && selected?.y === y) tile.classList.add("selected");
    if (moves.includes(tileKey(x, y))) tile.classList.add("selectable");
    if (attacks.includes(tileKey(x, y))) tile.classList.add("attackable");
    if (threats.has(tileKey(x, y))) tile.classList.add("threat");

    if (unit) {
      tile.classList.add(unit.owner === P1 ? "p1" : "p2");
      tile.innerHTML = `<span class="unit-token" title="${unit.owner} ${unit.type}">${unitIcons[unit.type] ?? "?"}</span><span class="hp-badge">${unit.hp}</span>`;
    }
    boardEl.appendChild(tile);
  }

  turnPlayerEl.textContent = state.winner ? `Game over (${state.winner})` : state.current;
  roundNumEl.textContent = String(state.round);
  apLeftEl.textContent = String(state.ap);
  objectiveStatusEl.textContent = state.objectiveOwner ?? "Neutral";
  actionFeedEl.textContent = state.actionFeed;
  historyFeedEl.innerHTML = state.history.map(entry => `<li>${entry}</li>`).join("");
  mapInfoEl.textContent = currentMap().desc;
  renderHudOnly();

  unitInfoEl.textContent = selected
    ? `${unitIcons[selected.type] ?? "?"} ${selected.owner} ${selected.type}\nHP: ${selected.hp}\nMove: ${selected.move}\nRange: ${selected.minRange}-${selected.maxRange}\nDamage: ${selected.damage}\nClimb Hills: ${selected.canClimb ? "Yes" : "No"}`
    : "None";
}

function setMessage(msg) { messageEl.textContent = msg; }

initMapSelect();
initGame();
