import {
  P1,
  applyAction,
  buildPathTo,
  calculateDamage,
  createInitialState,
  currentMap,
  getAttackBlockReason,
  getUnitAt,
  getUnitById,
  hillSet,
  coverSet,
  legalAttacks,
  legalMoves,
  maps,
  objective,
  threatTiles,
  tileKey,
  unitIcons,
} from './engine/index.js';
import { ActionType, MessageType, wrapMessage } from './protocol/index.js';

const SESSION_STORAGE_KEY = 'miniwar-session-id';

const boardEl = document.getElementById('board');
const mapSelectEl = document.getElementById('mapSelect');
const mapInfoEl = document.getElementById('mapInfo');
const turnPlayerEl = document.getElementById('turnPlayer');
const roundNumEl = document.getElementById('roundNum');
const apLeftEl = document.getElementById('apLeft');
const objectiveStatusEl = document.getElementById('objectiveStatus');
const turnTimerEl = document.getElementById('turnTimer');
const threatToggleEl = document.getElementById('threatToggle');
const messageEl = document.getElementById('message');
const unitInfoEl = document.getElementById('unitInfo');
const actionFeedEl = document.getElementById('actionFeed');
const historyFeedEl = document.getElementById('historyFeed');
const legendListEl = document.getElementById('legendList');
const previewInfoEl = document.getElementById('previewInfo');
const connectionModeEl = document.getElementById('connectionMode');
const playerSideEl = document.getElementById('playerSide');
const queueStatusEl = document.getElementById('queueStatus');
const connectBtnEl = document.getElementById('connectBtn');
const queueBtnEl = document.getElementById('queueBtn');
const leaveQueueBtnEl = document.getElementById('leaveQueueBtn');
const rematchBtnEl = document.getElementById('rematchBtn');

const ui = {
  pendingQueueJoin: false,
  state: createInitialState('center'),
  selectedUnitId: null,
  hoveredTile: null,
  showThreatMap: true,
  connection: 'local',
  socket: null,
  assignedSide: null,
  queueStatus: 'offline',
  queueDetail: 'Offline',
  roomId: null,
  sessionId: localStorage.getItem(SESSION_STORAGE_KEY),
};

document.getElementById('endTurnBtn').addEventListener('click', () => performAction({ type: ActionType.END_TURN }));
document.getElementById('resetBtn').addEventListener('click', () => resetMatch());
mapSelectEl.addEventListener('change', () => resetMatch(mapSelectEl.value));
threatToggleEl.addEventListener('change', () => { ui.showThreatMap = threatToggleEl.checked; render(); });
connectBtnEl.addEventListener('click', () => connectWebSocket(true));
queueBtnEl.addEventListener('click', () => updateQueue(true));
leaveQueueBtnEl.addEventListener('click', () => updateQueue(false));
rematchBtnEl.addEventListener('click', () => resetMatch());
document.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'e') performAction({ type: ActionType.END_TURN }); });

setInterval(() => {
  if (ui.connection === 'remote') return;
  if (ui.state.winner) return;
  ui.state.turnSecondsLeft -= 1;
  if (ui.state.turnSecondsLeft <= 0) {
    ui.state.turnSecondsLeft = 0;
    setMessage(`${ui.state.current} timed out. Turn auto-ended.`);
    performAction({ type: ActionType.END_TURN });
  } else {
    renderHudOnly();
  }
}, 1000);

function setMessage(msg) { messageEl.textContent = msg; }

function setSessionId(sessionId) {
  ui.sessionId = sessionId;
  if (sessionId) localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
}

function queueJoinAfterConnect() {
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) return;
  ui.pendingQueueJoin = false;
  ui.socket.send(JSON.stringify(wrapMessage(MessageType.QUEUE_JOIN)));
}

function initMapSelect() {
  mapSelectEl.innerHTML = Object.entries(maps).map(([key, map]) => `<option value="${key}">${map.name}</option>`).join('');
  mapSelectEl.value = ui.state.mapKey;
}

function initLegend() {
  legendListEl.innerHTML = '';
  ui.state.units
    .filter((unit, index, arr) => arr.findIndex((entry) => entry.type === unit.type) === index)
    .forEach((unit) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${unitIcons[unit.type]}</span><span>${unit.type} (${unit.canClimb ? 'can climb' : 'no climb'})</span>`;
      legendListEl.appendChild(li);
    });
}

function getSelectedUnit() {
  return ui.selectedUnitId ? getUnitById(ui.state, ui.selectedUnitId) : null;
}

function canControlCurrentTurn() {
  return ui.connection !== 'remote' || (ui.assignedSide && ui.assignedSide === ui.state.current && ui.roomId);
}

function performAction(action) {
  if (!canControlCurrentTurn()) {
    setMessage(ui.roomId ? `Waiting for ${ui.state.current}.` : 'Join a match to play online.');
    return;
  }
  if (ui.connection === 'remote' && ui.socket?.readyState === WebSocket.OPEN) {
    ui.socket.send(JSON.stringify(wrapMessage(MessageType.ACTION, { action })));
    return;
  }

  try {
    ui.state = applyAction(ui.state, action);
    ui.selectedUnitId = null;
    render();
  } catch (error) {
    setMessage(error.message);
  }
}

function resetMatch(mapKey = ui.state.mapKey) {
  if (ui.connection === 'remote' && ui.socket?.readyState === WebSocket.OPEN && ui.roomId) {
    ui.socket.send(JSON.stringify(wrapMessage(MessageType.RESET_MATCH, { mapKey })));
    return;
  }
  ui.state = createInitialState(mapKey);
  ui.selectedUnitId = null;
  ui.hoveredTile = null;
  initMapSelect();
  initLegend();
  render();
}

function updateQueue(joinQueue) {
  if (joinQueue) ui.pendingQueueJoin = true;
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) {
    if (!joinQueue) ui.pendingQueueJoin = false;
    connectWebSocket(true, joinQueue);
    return;
  }
  if (!joinQueue) ui.pendingQueueJoin = false;
  ui.socket.send(JSON.stringify(wrapMessage(joinQueue ? MessageType.QUEUE_JOIN : MessageType.QUEUE_LEAVE)));
}

function applyQueueStatus(msg) {
  ui.queueStatus = msg.status ?? 'idle';
  ui.queueDetail = msg.detail ?? ui.queueDetail;
  if (msg.roomId) ui.roomId = msg.roomId;
  queueStatusEl.textContent = ui.queueDetail;
  queueStatusEl.className = ui.queueStatus;
  queueBtnEl.disabled = ui.queueStatus === 'in_queue' || ui.queueStatus === 'in_match';
  leaveQueueBtnEl.classList.toggle('visible', ui.queueStatus === 'in_queue');
  leaveQueueBtnEl.disabled = ui.queueStatus !== 'in_queue';
}

function getPreviewText(x, y) {
  const selected = getSelectedUnit();
  if (!selected) return 'Select a unit to preview moves, paths, and attacks.';

  const occupant = getUnitAt(ui.state, x, y);
  const moveTarget = legalMoves(ui.state, selected.id).find((tile) => tile.x === x && tile.y === y);
  if (moveTarget) {
    const path = buildPathTo(ui.state, selected, x, y);
    const terrain = [
      hillSet(ui.state).has(tileKey(x, y)) ? 'hill' : null,
      coverSet(ui.state).has(tileKey(x, y)) ? 'cover' : null,
      threatTiles(ui.state, ui.state.current).has(tileKey(x, y)) ? 'enemy threat' : null,
    ].filter(Boolean);
    const terrainText = terrain.length ? ` Terrain: ${terrain.join(', ')}.` : '';
    return `Move ${selected.type} to (${x}, ${y}) in ${path.length} step${path.length === 1 ? '' : 's'}.${terrainText}`;
  }

  if (occupant && occupant.owner !== ui.state.current) {
    const blockedReason = getAttackBlockReason(ui.state, selected.id, occupant.id);
    if (blockedReason) return `Cannot attack ${occupant.type} at (${x}, ${y}). ${blockedReason}`;
    const { damage, modifiers } = calculateDamage(ui.state, selected.id, occupant.id);
    const modifierText = modifiers.length ? ` Reduced by ${modifiers.join(' and ')}.` : '';
    const lethalText = occupant.hp - damage <= 0 ? ' Lethal hit.' : '';
    return `Attack ${occupant.type} for ${damage} damage.${modifierText}${lethalText}`;
  }

  if (occupant && occupant.owner === ui.state.current) return `Friendly ${occupant.type}. Click to select it.`;
  if (hillSet(ui.state).has(tileKey(x, y)) && !selected.canClimb) return `${selected.type} cannot climb hills.`;
  return 'No valid action on this tile.';
}

function onTileClick(x, y) {
  if (ui.state.winner || !canControlCurrentTurn()) return;
  const clicked = getUnitAt(ui.state, x, y);
  const selected = getSelectedUnit();

  if (!selected) {
    if (clicked && clicked.owner === ui.state.current) {
      ui.selectedUnitId = clicked.id;
      render();
    }
    return;
  }

  if (clicked && clicked.owner === ui.state.current) {
    ui.selectedUnitId = clicked.id;
    render();
    return;
  }

  const moveTarget = legalMoves(ui.state, selected.id).find((tile) => tile.x === x && tile.y === y);
  if (moveTarget) {
    performAction({ type: ActionType.MOVE, unitId: selected.id, target: { x, y } });
    return;
  }

  if (clicked && clicked.owner !== ui.state.current) {
    performAction({ type: ActionType.ATTACK, unitId: selected.id, targetId: clicked.id });
  }
}

function renderHudOnly() {
  turnTimerEl.textContent = `${ui.state.turnSecondsLeft}s`;
  turnTimerEl.classList.remove('warning', 'critical');
  if (ui.state.turnSecondsLeft <= 10) turnTimerEl.classList.add('warning');
  if (ui.state.turnSecondsLeft <= 5) turnTimerEl.classList.add('critical');
}

function connectWebSocket(manual = false, autoJoinQueue = false) {
  if (ui.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(ui.socket.readyState)) return;
  const socket = new WebSocket('ws://127.0.0.1:8080');
  ui.socket = socket;

  socket.addEventListener('open', () => {
    ui.connection = 'remote';
    connectBtnEl.textContent = 'Connected';
    setMessage('Connected to local WebSocket server.');
    if (ui.sessionId) {
      socket.send(JSON.stringify(wrapMessage(MessageType.RECONNECT_RESUME, { sessionId: ui.sessionId })));
    } else if (autoJoinQueue || ui.pendingQueueJoin) {
      queueJoinAfterConnect();
    }
    render();
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === MessageType.SERVER_READY && msg.sessionId) {
      setSessionId(msg.sessionId);
      if ((autoJoinQueue || ui.pendingQueueJoin) && !ui.roomId && !ui.assignedSide) {
        queueJoinAfterConnect();
      }
      return;
    }
    if (msg.type === MessageType.MATCH_FOUND) {
      ui.roomId = msg.roomId;
      setMessage(`Match found${msg.roomId ? `: ${msg.roomId.slice(0, 8)}` : ''}.`);
      render();
      return;
    }
    if (msg.type === MessageType.ASSIGNED_SIDE) {
      ui.assignedSide = msg.side;
      ui.roomId = msg.roomId ?? ui.roomId;
      setMessage(`Connected as ${msg.side}.`);
      render();
      return;
    }
    if (msg.type === MessageType.QUEUE_STATUS) {
      applyQueueStatus(msg);
      render();
      return;
    }
    if (msg.type === MessageType.STATE_SNAPSHOT) {
      ui.state = msg.state;
      ui.roomId = msg.roomId ?? ui.roomId;
      if (mapSelectEl.value !== ui.state.mapKey) mapSelectEl.value = ui.state.mapKey;
      render();
      return;
    }
    if (msg.type === MessageType.ACTION_ERROR) {
      setMessage(msg.message);
    }
  });

  socket.addEventListener('close', () => {
    ui.pendingQueueJoin = false;
    ui.connection = 'local';
    ui.socket = null;
    ui.assignedSide = null;
    ui.roomId = null;
    ui.queueStatus = 'offline';
    ui.queueDetail = 'Offline';
    connectBtnEl.textContent = 'Connect Server';
    setMessage(manual ? 'WebSocket server disconnected. Running in local mode.' : 'WebSocket server unavailable. Running in local mode.');
    render();
  });

  socket.addEventListener('error', () => {
    socket.close();
  });
}

function render() {
  boardEl.innerHTML = '';
  const selected = getSelectedUnit();
  const moves = selected ? legalMoves(ui.state, selected.id).map((tile) => tileKey(tile.x, tile.y)) : [];
  const attacks = selected ? legalAttacks(ui.state, selected.id).map((unit) => tileKey(unit.x, unit.y)) : [];
  const threats = ui.showThreatMap ? threatTiles(ui.state, ui.state.current) : new Set();
  const hoveredPath = selected && ui.hoveredTile ? buildPathTo(ui.state, selected, ui.hoveredTile.x, ui.hoveredTile.y).map((tile) => tileKey(tile.x, tile.y)) : [];
  const dangerOn = ui.state.round >= 8;
  const hills = hillSet(ui.state);
  const covers = coverSet(ui.state);
  const obj = objective(ui.state);

  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.onclick = () => onTileClick(x, y);
      tile.onmouseenter = () => {
        if (ui.hoveredTile?.x === x && ui.hoveredTile?.y === y) return;
        ui.hoveredTile = { x, y };
        previewInfoEl.textContent = getPreviewText(x, y);
        render();
      };
      tile.onfocus = tile.onmouseenter;

      const unit = getUnitAt(ui.state, x, y);
      if (x === obj.x && y === obj.y) tile.classList.add('objective');
      if (covers.has(tileKey(x, y))) tile.classList.add('cover');
      if (hills.has(tileKey(x, y))) tile.classList.add('hill');
      if (dangerOn && (x === 0 || y === 0 || x === 5 || y === 5)) tile.classList.add('danger');
      if (selected?.x === x && selected?.y === y) tile.classList.add('selected');
      if (moves.includes(tileKey(x, y))) tile.classList.add('selectable');
      if (attacks.includes(tileKey(x, y))) tile.classList.add('attackable');
      if (hoveredPath.includes(tileKey(x, y))) tile.classList.add('path');
      if (threats.has(tileKey(x, y))) tile.classList.add('threat');
      tile.disabled = !canControlCurrentTurn() && !(selected?.x === x && selected?.y === y);

      if (unit) {
        tile.classList.add(unit.owner === P1 ? 'p1' : 'p2');
        tile.innerHTML = `<span class="unit-token" title="${unit.owner} ${unit.type}">${unitIcons[unit.type] ?? '?'}</span><span class="hp-badge">${unit.hp}</span>`;
      }
      boardEl.appendChild(tile);
    }
  }

  turnPlayerEl.textContent = ui.state.winner ? `Game over (${ui.state.winner})` : ui.state.current;
  roundNumEl.textContent = String(ui.state.round);
  apLeftEl.textContent = String(ui.state.ap);
  objectiveStatusEl.textContent = ui.state.objectiveOwner ?? 'Neutral';
  connectionModeEl.textContent = ui.connection === 'remote' ? 'Online' : 'Local';
  connectionModeEl.className = ui.connection;
  playerSideEl.textContent = ui.assignedSide ?? 'Any';
  queueStatusEl.textContent = ui.queueDetail;
  queueStatusEl.className = ui.queueStatus;
  actionFeedEl.textContent = ui.state.actionFeed;
  historyFeedEl.innerHTML = ui.state.history.map((entry) => `<li>${entry}</li>`).join('');
  mapInfoEl.textContent = `${currentMap(ui.state).desc}${ui.connection === 'remote' ? ` Connected as ${ui.assignedSide ?? 'unassigned'}. ${ui.roomId ? `Room ${ui.roomId.slice(0, 8)}.` : 'Not currently in a room.'}` : ' Local mode.'}`;
  renderHudOnly();
  previewInfoEl.textContent = ui.hoveredTile ? getPreviewText(ui.hoveredTile.x, ui.hoveredTile.y) : 'Hover or focus a tile to preview move paths, attacks, and invalid reasons.';
  rematchBtnEl.classList.toggle('visible', Boolean(ui.state.winner));
  queueBtnEl.disabled = ui.connection !== 'remote' && ui.socket?.readyState !== WebSocket.CONNECTING;
  unitInfoEl.textContent = selected
    ? `${unitIcons[selected.type] ?? '?'} ${selected.owner} ${selected.type}\nHP: ${selected.hp}\nMove: ${selected.move}\nRange: ${selected.minRange}-${selected.maxRange}\nDamage: ${selected.damage}\nClimb Hills: ${selected.canClimb ? 'Yes' : 'No'}`
    : 'None';
}

initMapSelect();
initLegend();
render();
connectWebSocket();
