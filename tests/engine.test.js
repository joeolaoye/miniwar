import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createInitialState, getAttackBlockReason, legalMoves, threatTiles } from '../engine/index.js';

test('soldier cannot move onto hill tile', () => {
  const state = createInitialState('center');
  const moves = legalMoves(state, 'p1-1');
  assert.equal(moves.some((m) => m.x === 2 && m.y === 1), false);
});

test('threat map returns coverage beyond occupied targets', () => {
  const state = createInitialState('center');
  const threats = threatTiles(state, 'Blue');
  assert.equal(threats.has('3,2'), true);
  assert.equal(threats.has('4,2'), true);
});

test('hill blocks artillery line of sight', () => {
  const state = createInitialState('ridge');
  state.units.find((u) => u.id === 'p1-5').x = 2;
  state.units.find((u) => u.id === 'p1-5').y = 0;
  state.units.find((u) => u.id === 'p2-0').x = 2;
  state.units.find((u) => u.id === 'p2-0').y = 3;
  assert.equal(getAttackBlockReason(state, 'p1-5', 'p2-0'), 'Hill blocks line of sight.');
});

test('move and end turn update deterministic state', () => {
  let state = createInitialState('center');
  state = applyAction(state, { type: 'move', unitId: 'p1-0', target: { x: 0, y: 4 } });
  assert.equal(state.ap, 1);
  state = applyAction(state, { type: 'endTurn' });
  assert.equal(state.current, 'Red');
  assert.equal(state.ap, 2);
});
