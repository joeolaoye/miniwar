import { maps, P1, P2, rosterTemplate, SIZE, TURN_SECONDS } from './maps.js';

export { maps, P1, P2, SIZE, TURN_SECONDS } from './maps.js';

export function tileKey(x, y) { return `${x},${y}`; }
export function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
export function currentMap(state) { return maps[state.mapKey]; }
export function hillSet(state) { return new Set(currentMap(state).hills); }
export function coverSet(state) { return new Set(currentMap(state).cover); }
export function objective(state) { return currentMap(state).objective; }
export function isHill(state, x, y) { return hillSet(state).has(tileKey(x, y)); }
export function getUnitAt(state, x, y) { return state.units.find((u) => u.x === x && u.y === y); }
export function getUnitById(state, unitId) { return state.units.find((u) => u.id === unitId); }

export function createInitialState(mapKey = 'center') {
  const state = {
    units: [],
    current: P1,
    round: 1,
    ap: 2,
    sprintedScouts: [],
    objectiveOwner: null,
    objectiveHoldPending: null,
    winner: null,
    actionFeed: 'No actions yet.',
    history: [],
    turnSecondsLeft: TURN_SECONDS,
    mapKey,
  };

  const p1Rows = [5, 4];
  const p2Rows = [0, 1];
  rosterTemplate.forEach((unit, idx) => {
    const col = idx;
    state.units.push({ id: `p1-${idx}`, owner: P1, x: col, y: p1Rows[idx > 2 ? 1 : 0], ...structuredClone(unit) });
    state.units.push({ id: `p2-${idx}`, owner: P2, x: col, y: p2Rows[idx > 2 ? 1 : 0], ...structuredClone(unit) });
  });
  state.history.unshift(`Round 1: ${state.current} starts on ${currentMap(state).name}.`);
  return state;
}

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

export function isLosBlocked(state, attacker, defender) {
  if (attacker.maxRange === 1) return false;
  const dx = defender.x - attacker.x;
  const dy = defender.y - attacker.y;
  const isOrthogonal = dx === 0 || dy === 0;
  const isDiagonal = Math.abs(dx) === Math.abs(dy);
  if (!(isOrthogonal || isDiagonal)) return true;
  const stepDiv = gcd(dx, dy);
  const stepX = dx / stepDiv;
  const stepY = dy / stepDiv;
  for (let i = 1; i < stepDiv; i++) {
    if (isHill(state, attacker.x + stepX * i, attacker.y + stepY * i)) return true;
  }
  return false;
}

export function canOccupyTile(state, unit, x, y) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  if (getUnitAt(state, x, y)) return false;
  if (isHill(state, x, y) && !unit.canClimb) return false;
  return true;
}

export function buildPathTo(state, unit, targetX, targetY) {
  const startKey = tileKey(unit.x, unit.y);
  const queue = [{ x: unit.x, y: unit.y }];
  const parents = new Map([[startKey, null]]);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.x === targetX && cur.y === targetY) break;
    const neighbors = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ];
    for (const next of neighbors) {
      const key = tileKey(next.x, next.y);
      if (parents.has(key)) continue;
      if (!canOccupyTile(state, unit, next.x, next.y)) continue;
      parents.set(key, cur);
      queue.push(next);
    }
  }
  const targetKey = tileKey(targetX, targetY);
  if (!parents.has(targetKey)) return [];
  const path = [];
  let curKey = targetKey;
  while (curKey && curKey !== startKey) {
    const [x, y] = curKey.split(',').map(Number);
    path.unshift({ x, y });
    const parent = parents.get(curKey);
    curKey = parent ? tileKey(parent.x, parent.y) : null;
  }
  return path;
}

export function legalMoves(state, unitId) {
  const unit = getUnitById(state, unitId);
  if (!unit) return [];
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
      if (!canOccupyTile(state, unit, next.x, next.y)) continue;
      result.push({ x: next.x, y: next.y });
      queue.push({ x: next.x, y: next.y, steps: cur.steps + 1 });
    }
  }
  return result;
}

export function legalAttacks(state, unitId) {
  const unit = getUnitById(state, unitId);
  if (!unit) return [];
  return state.units.filter((enemy) => {
    if (enemy.owner === unit.owner) return false;
    const d = manhattan(unit, enemy);
    if (d < unit.minRange || d > unit.maxRange) return false;
    if (unit.type === 'Scout' && state.sprintedScouts.includes(unit.id)) return false;
    if (isLosBlocked(state, unit, enemy)) return false;
    return true;
  });
}

export function threatenedTilesForUnit(state, unitId) {
  const unit = getUnitById(state, unitId);
  const threatened = new Set();
  if (!unit) return threatened;
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      if (x === unit.x && y === unit.y) continue;
      const distance = Math.abs(unit.x - x) + Math.abs(unit.y - y);
      if (distance < unit.minRange || distance > unit.maxRange) continue;
      if (unit.type === 'Scout' && state.sprintedScouts.includes(unit.id)) continue;
      if (isLosBlocked(state, unit, { x, y })) continue;
      threatened.add(tileKey(x, y));
    }
  }
  return threatened;
}

export function threatTiles(state, forPlayer) {
  const threat = new Set();
  state.units.filter((u) => u.owner !== forPlayer).forEach((enemy) => {
    threatenedTilesForUnit(state, enemy.id).forEach((key) => threat.add(key));
  });
  return threat;
}

export function calculateDamage(state, attackerId, defenderId) {
  const attacker = getUnitById(state, attackerId);
  const defender = getUnitById(state, defenderId);
  let damage = attacker.damage;
  const modifiers = [];
  const rangedAttack = attacker.maxRange > 1;
  if (coverSet(state).has(tileKey(defender.x, defender.y)) && rangedAttack) {
    damage = Math.max(1, damage - 1);
    modifiers.push('cover');
  }
  if (defender.type === 'Tank' && rangedAttack) {
    damage = Math.max(1, damage - 1);
    modifiers.push('tank armor');
  }
  return { damage, modifiers };
}

export function getAttackBlockReason(state, attackerId, defenderId) {
  const attacker = getUnitById(state, attackerId);
  const defender = getUnitById(state, defenderId);
  const distance = manhattan(attacker, defender);
  if (distance < attacker.minRange || distance > attacker.maxRange) return `Out of range (${distance}).`;
  if (attacker.type === 'Scout' && state.sprintedScouts.includes(attacker.id)) return 'Scout sprinted this turn and cannot attack.';
  if (isLosBlocked(state, attacker, defender)) return 'Hill blocks line of sight.';
  return null;
}

function addHistory(state, entry) {
  state.history.unshift(entry);
  state.history = state.history.slice(0, 12);
}

function evaluateObjective(state) {
  const obj = objective(state);
  const holder = getUnitAt(state, obj.x, obj.y);
  const owner = holder?.owner ?? null;
  if (owner !== state.objectiveOwner) {
    state.objectiveOwner = owner;
    state.objectiveHoldPending = owner;
    if (owner) addHistory(state, `${owner} captured objective.`);
    return;
  }
  if (owner && state.objectiveHoldPending === owner) {
    state.winner = owner;
    state.actionFeed = `${owner} wins by objective hold.`;
  }
}

function applyDangerRing(state) {
  if (state.round < 8) return;
  for (const unit of [...state.units]) {
    if (unit.x === 0 || unit.x === SIZE - 1 || unit.y === 0 || unit.y === SIZE - 1) {
      unit.hp -= 1;
      if (unit.hp <= 0) {
        const commander = unit.type === 'Commander';
        state.units = state.units.filter((u) => u.id !== unit.id);
        if (commander && !state.winner) {
          state.winner = unit.owner === P1 ? P2 : P1;
          state.actionFeed = `${state.winner} wins (enemy Commander lost in danger zone).`;
        }
      }
    }
  }
}

function tiebreakWinner(state) {
  const alive = (owner) => state.units.filter((u) => u.owner === owner);
  const p1 = alive(P1);
  const p2 = alive(P2);
  const p1Commander = p1.some((u) => u.type === 'Commander');
  const p2Commander = p2.some((u) => u.type === 'Commander');
  if (p1Commander !== p2Commander) return p1Commander ? P1 : P2;
  if (p1.length !== p2.length) return p1.length > p2.length ? P1 : P2;
  if (state.objectiveOwner) return state.objectiveOwner;
  const hp = (arr) => arr.reduce((sum, u) => sum + u.hp, 0);
  if (hp(p1) !== hp(p2)) return hp(p1) > hp(p2) ? P1 : P2;
  return null;
}

export function applyAction(inputState, action) {
  const state = structuredClone(inputState);
  if (state.winner) return state;

  if (action.type === 'move') {
    const unit = getUnitById(state, action.unitId);
    const moveTarget = legalMoves(state, action.unitId).find((t) => t.x === action.target.x && t.y === action.target.y);
    if (!unit || unit.owner !== state.current || state.ap < 1 || !moveTarget) throw new Error('Invalid move');
    const dist = manhattan(unit, moveTarget);
    unit.x = action.target.x;
    unit.y = action.target.y;
    state.ap -= 1;
    if (unit.type === 'Scout' && dist === 2) state.sprintedScouts.push(unit.id);
    state.actionFeed = `${unit.owner} moved ${unit.type} to (${unit.x}, ${unit.y}).`;
    addHistory(state, state.actionFeed);
    return state;
  }

  if (action.type === 'attack') {
    const attacker = getUnitById(state, action.unitId);
    const defender = getUnitById(state, action.targetId);
    if (!attacker || !defender || attacker.owner !== state.current || state.ap < 1) throw new Error('Invalid attack');
    const blockedReason = getAttackBlockReason(state, action.unitId, action.targetId);
    if (blockedReason) throw new Error(blockedReason);
    const { damage } = calculateDamage(state, action.unitId, action.targetId);
    defender.hp -= damage;
    state.ap -= 1;
    state.actionFeed = `${attacker.owner} ${attacker.type} hit ${defender.owner} ${defender.type} for ${damage}.`;
    addHistory(state, state.actionFeed);
    if (defender.hp <= 0) {
      const defeatedCommander = defender.type === 'Commander';
      state.units = state.units.filter((u) => u.id !== defender.id);
      state.actionFeed = `${attacker.owner} defeated ${defender.owner} ${defender.type}!`;
      addHistory(state, state.actionFeed);
      if (defeatedCommander) state.winner = attacker.owner;
    }
    return state;
  }

  if (action.type === 'endTurn') {
    evaluateObjective(state);
    if (!state.winner) applyDangerRing(state);
    if (!state.winner) {
      state.current = state.current === P1 ? P2 : P1;
      if (state.current === P1) state.round += 1;
      if (state.round > 20) {
        state.winner = tiebreakWinner(state);
        state.actionFeed = state.winner ? `${state.winner} wins by tiebreak.` : 'Draw by tiebreak.';
      } else {
        state.actionFeed = `${state.current} to act.`;
        addHistory(state, `Round ${state.round}: ${state.current} turn.`);
      }
    }
    state.ap = 2;
    state.sprintedScouts = [];
    state.turnSecondsLeft = TURN_SECONDS;
    return state;
  }

  throw new Error(`Unknown action type: ${action.type}`);
}
