const SIZE = 6;
const P1 = "Blue";
const P2 = "Red";

const unitIcons = {
  Commander: "♔",
  Soldier: "⚔",
  Scout: "➤",
  Tank: "🛡",
  Artillery: "✹",
};

const rosterTemplate = [
  { type: "Commander", hp: 3, move: 1, minRange: 1, maxRange: 1, damage: 1 },
  { type: "Soldier", hp: 2, move: 1, minRange: 1, maxRange: 1, damage: 1 },
  { type: "Soldier", hp: 2, move: 1, minRange: 1, maxRange: 1, damage: 1 },
  { type: "Scout", hp: 2, move: 2, minRange: 1, maxRange: 1, damage: 1 },
  { type: "Tank", hp: 4, move: 1, minRange: 1, maxRange: 1, damage: 1 },
  { type: "Artillery", hp: 2, move: 1, minRange: 2, maxRange: 3, damage: 2 },
];

const state = {
  units: [],
  current: P1,
  round: 1,
  ap: 2,
  selectedUnitId: null,
  sprintedScouts: new Set(),
  objectiveOwner: null,
  objectiveHoldPending: null,
  winner: null,
  actionFeed: "No actions yet.",
  actionFx: [],
};

const objective = { x: 2, y: 2 };
const coverTiles = new Set(["1,2", "1,3", "4,2", "4,3"]);

const boardEl = document.getElementById("board");
const turnPlayerEl = document.getElementById("turnPlayer");
const roundNumEl = document.getElementById("roundNum");
const apLeftEl = document.getElementById("apLeft");
const objectiveStatusEl = document.getElementById("objectiveStatus");
const messageEl = document.getElementById("message");
const unitInfoEl = document.getElementById("unitInfo");
const actionFeedEl = document.getElementById("actionFeed");
const legendListEl = document.getElementById("legendList");

document.getElementById("endTurnBtn").addEventListener("click", endTurn);
document.getElementById("resetBtn").addEventListener("click", initGame);

function initLegend() {
  legendListEl.innerHTML = "";
  ["Commander", "Soldier", "Scout", "Tank", "Artillery"].forEach(type => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ico">${unitIcons[type]}</span><span>${type}</span>`;
    legendListEl.appendChild(li);
  });
}

function initGame() {
  state.units = [];
  state.current = P1;
  state.round = 1;
  state.ap = 2;
  state.selectedUnitId = null;
  state.sprintedScouts = new Set();
  state.objectiveOwner = null;
  state.objectiveHoldPending = null;
  state.winner = null;
  state.actionFeed = "No actions yet.";
  state.actionFx = [];

  const p1Rows = [5, 4];
  const p2Rows = [0, 1];
  rosterTemplate.forEach((unit, idx) => {
    const col = idx;
    state.units.push({ id: `p1-${idx}`, owner: P1, x: col, y: p1Rows[idx > 2 ? 1 : 0], ...structuredClone(unit) });
    state.units.push({ id: `p2-${idx}`, owner: P2, x: col, y: p2Rows[idx > 2 ? 1 : 0], ...structuredClone(unit) });
  });

  setMessage(`${state.current} to act.`);
  initLegend();
  render();
}

function tileKey(x, y) { return `${x},${y}`; }
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function getUnitAt(x, y) { return state.units.find(u => u.x === x && u.y === y); }
function getSelectedUnit() { return state.units.find(u => u.id === state.selectedUnitId); }

function pushFx(x, y, kind) {
  state.actionFx.push({ x, y, kind, ttl: 2 });
}

function ageFx() {
  state.actionFx = state.actionFx
    .map(fx => ({ ...fx, ttl: fx.ttl - 1 }))
    .filter(fx => fx.ttl > 0);
}

function legalMoves(unit) {
  const out = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      if (getUnitAt(x, y)) continue;
      const d = Math.abs(unit.x - x) + Math.abs(unit.y - y);
      if (d >= 1 && d <= unit.move) out.push({ x, y });
    }
  }
  return out;
}

function legalAttacks(unit) {
  const enemies = state.units.filter(u => u.owner !== unit.owner);
  return enemies.filter(enemy => {
    const d = manhattan(unit, enemy);
    return d >= unit.minRange && d <= unit.maxRange;
  });
}

function canActUnit(unit) {
  return unit && unit.owner === state.current && state.ap > 0;
}

function onTileClick(x, y) {
  if (state.winner) return;
  const clicked = getUnitAt(x, y);
  const selected = getSelectedUnit();

  if (!selected) {
    if (clicked && clicked.owner === state.current) {
      state.selectedUnitId = clicked.id;
      render();
    }
    return;
  }

  if (clicked && clicked.owner === state.current) {
    state.selectedUnitId = clicked.id;
    render();
    return;
  }

  if (!canActUnit(selected)) return;

  const moveTarget = legalMoves(selected).find(t => t.x === x && t.y === y);
  if (moveTarget && state.ap >= 1) {
    const dist = manhattan(selected, moveTarget);
    selected.x = x;
    selected.y = y;
    state.ap -= 1;
    if (selected.type === "Scout" && dist === 2) state.sprintedScouts.add(selected.id);
    state.actionFeed = `${selected.owner} moved ${selected.type} to (${x}, ${y}).`;
    pushFx(x, y, "move");
    setMessage(state.actionFeed);
    maybeAutoEndTurn();
    render();
    return;
  }

  if (clicked && clicked.owner !== state.current) {
    const target = clicked;
    const canAttack = legalAttacks(selected).some(u => u.id === target.id);
    const scoutBlocked = selected.type === "Scout" && state.sprintedScouts.has(selected.id);
    if (canAttack && !scoutBlocked && state.ap >= 1) {
      resolveAttack(selected, target);
      state.ap -= 1;
      maybeAutoEndTurn();
      render();
      return;
    }

    if (scoutBlocked) setMessage("Scout sprinted this turn and cannot attack.");
  }
}

function resolveAttack(attacker, defender) {
  let damage = attacker.damage;
  const defenderOnCover = coverTiles.has(tileKey(defender.x, defender.y));
  const rangedAttack = attacker.maxRange > 1;
  if (defenderOnCover && rangedAttack) damage = Math.max(1, damage - 1);
  if (defender.type === "Tank" && rangedAttack) damage = Math.max(1, damage - 1);

  pushFx(attacker.x, attacker.y, "attack");
  pushFx(defender.x, defender.y, "hit");

  defender.hp -= damage;
  state.actionFeed = `${attacker.owner} ${attacker.type} hit ${defender.owner} ${defender.type} for ${damage}.`;
  setMessage(state.actionFeed);

  if (defender.hp <= 0) {
    const defeatedCommander = defender.type === "Commander";
    pushFx(defender.x, defender.y, "kill");
    state.units = state.units.filter(u => u.id !== defender.id);
    state.actionFeed = `${attacker.owner} defeated ${defender.owner} ${defender.type}!`;
    setMessage(state.actionFeed);
    if (defeatedCommander) {
      state.winner = attacker.owner;
      setMessage(`${state.winner} wins by Commander KO.`);
    }
  }
}

function maybeAutoEndTurn() {
  if (state.ap <= 0 && !state.winner) endTurn();
}

function evaluateObjective() {
  const holder = getUnitAt(objective.x, objective.y);
  const owner = holder?.owner ?? null;

  if (owner !== state.objectiveOwner) {
    state.objectiveOwner = owner;
    state.objectiveHoldPending = owner;
    return;
  }

  if (owner && state.objectiveHoldPending === owner) {
    state.winner = owner;
    setMessage(`${owner} wins by objective hold.`);
  }
}

function applyDangerRing() {
  if (state.round < 8) return;
  for (const unit of [...state.units]) {
    if (unit.x === 0 || unit.x === SIZE - 1 || unit.y === 0 || unit.y === SIZE - 1) {
      unit.hp -= 1;
      pushFx(unit.x, unit.y, "hit");
      if (unit.hp <= 0) {
        const commander = unit.type === "Commander";
        pushFx(unit.x, unit.y, "kill");
        state.units = state.units.filter(u => u.id !== unit.id);
        if (commander && !state.winner) {
          state.winner = unit.owner === P1 ? P2 : P1;
          setMessage(`${state.winner} wins (enemy Commander lost in danger zone).`);
        }
      }
    }
  }
}

function endTurn() {
  if (state.winner) return;

  evaluateObjective();
  if (!state.winner) applyDangerRing();
  if (!state.winner) {
    state.current = state.current === P1 ? P2 : P1;
    if (state.current === P1) state.round += 1;
    if (state.round > 20) {
      state.winner = tiebreakWinner();
      setMessage(state.winner ? `${state.winner} wins by tiebreak.` : "Draw by tiebreak.");
    } else {
      setMessage(`${state.current} to act.`);
    }
  }

  state.ap = 2;
  state.selectedUnitId = null;
  state.sprintedScouts.clear();
  render();
}

function tiebreakWinner() {
  const alive = owner => state.units.filter(u => u.owner === owner);
  const p1 = alive(P1);
  const p2 = alive(P2);
  const p1Commander = p1.some(u => u.type === "Commander");
  const p2Commander = p2.some(u => u.type === "Commander");
  if (p1Commander !== p2Commander) return p1Commander ? P1 : P2;
  if (p1.length !== p2.length) return p1.length > p2.length ? P1 : P2;
  if (state.objectiveOwner) return state.objectiveOwner;
  const hp = arr => arr.reduce((sum, u) => sum + u.hp, 0);
  if (hp(p1) !== hp(p2)) return hp(p1) > hp(p2) ? P1 : P2;
  return null;
}

function tileFxClass(x, y) {
  const fx = state.actionFx.find(entry => entry.x === x && entry.y === y);
  if (!fx) return null;
  if (fx.kind === "move") return "action-move";
  if (fx.kind === "attack") return "action-attack";
  if (fx.kind === "hit") return "action-hit";
  if (fx.kind === "kill") return "action-kill";
  return null;
}

function render() {
  ageFx();
  boardEl.innerHTML = "";
  const selected = getSelectedUnit();
  const moves = selected ? legalMoves(selected).map(t => tileKey(t.x, t.y)) : [];
  const attacks = selected ? legalAttacks(selected).map(u => tileKey(u.x, u.y)) : [];
  const dangerOn = state.round >= 8;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.onclick = () => onTileClick(x, y);
      const unit = getUnitAt(x, y);

      if (x === objective.x && y === objective.y) tile.classList.add("objective");
      if (coverTiles.has(tileKey(x, y))) tile.classList.add("cover");
      if (dangerOn && (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1)) tile.classList.add("danger");
      if (selected?.x === x && selected?.y === y) tile.classList.add("selected");
      if (moves.includes(tileKey(x, y))) tile.classList.add("selectable");
      if (attacks.includes(tileKey(x, y))) tile.classList.add("attackable");

      const fxClass = tileFxClass(x, y);
      if (fxClass) tile.classList.add(fxClass);

      if (unit) {
        tile.classList.add(unit.owner === P1 ? "p1" : "p2");
        tile.innerHTML = `
          <span class="unit-token" title="${unit.owner} ${unit.type}">${unitIcons[unit.type] ?? "?"}</span>
          <span class="hp-badge">${unit.hp}</span>
        `;
      }

      boardEl.appendChild(tile);
    }
  }

  turnPlayerEl.textContent = state.winner ? `Game over (${state.winner})` : state.current;
  roundNumEl.textContent = String(state.round);
  apLeftEl.textContent = String(state.ap);
  objectiveStatusEl.textContent = state.objectiveOwner ?? "Neutral";
  actionFeedEl.textContent = state.actionFeed;

  unitInfoEl.textContent = selected
    ? `${unitIcons[selected.type] ?? "?"} ${selected.owner} ${selected.type}\nHP: ${selected.hp}\nMove: ${selected.move}\nRange: ${selected.minRange}-${selected.maxRange}\nDamage: ${selected.damage}`
    : "None";
}

function setMessage(msg) {
  messageEl.textContent = msg;
}

initGame();
