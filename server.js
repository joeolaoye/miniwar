import crypto from 'node:crypto';
import http from 'node:http';
import { applyAction, createInitialState } from './engine/index.js';
import { MessageType, wrapMessage } from './protocol/index.js';

const sessions = new Map();
const queuedSessionIds = [];
const rooms = new Map();
const roomTimers = new Map();

function createSession(socket) {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    socket,
    roomId: null,
    side: null,
    queued: false,
    disconnectedAt: null,
  };
  sessions.set(sessionId, session);
  return session;
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  if (length >= 126) throw new Error('Payload too large for simple server');
  return Buffer.concat([Buffer.from([0x81, length]), payload]);
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const opcode = first & 0x0f;
  if (opcode === 0x8) return null;
  const second = buffer[1];
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  const payload = buffer.subarray(offset, offset + length);
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return payload.toString('utf8');
}

function send(socket, obj) {
  if (!socket || socket.destroyed || !socket.writable) return;
  socket.write(encodeFrame(JSON.stringify(obj)));
}

function sendToSession(sessionId, obj) {
  const session = sessions.get(sessionId);
  if (!session) return;
  send(session.socket, obj);
}

function getRoomPlayers(room) {
  return Object.entries(room.players)
    .map(([side, sessionId]) => ({ side, sessionId, session: sessions.get(sessionId) }))
    .filter((entry) => entry.session);
}

function broadcastRoom(room, obj) {
  getRoomPlayers(room).forEach(({ session }) => send(session.socket, obj));
}

function stopTimer(roomId) {
  const timerHandle = roomTimers.get(roomId);
  if (timerHandle) clearInterval(timerHandle);
  roomTimers.delete(roomId);
}

function notifyQueue() {
  const waitingCount = queuedSessionIds.length;
  queuedSessionIds.forEach((sessionId, index) => {
    sendToSession(sessionId, wrapMessage(MessageType.QUEUE_STATUS, {
      status: 'in_queue',
      waitingCount,
      detail: waitingCount > 1 ? `Searching… ${index + 1}/${waitingCount} in queue.` : 'Searching for an opponent…',
    }));
  });
}

function sendRoomSnapshot(room) {
  broadcastRoom(room, wrapMessage(MessageType.STATE_SNAPSHOT, { state: room.state, roomId: room.id }));
}

function sendRoomPresence(room) {
  const players = getRoomPlayers(room).map(({ side, session }) => ({
    side,
    connected: Boolean(session.socket && !session.socket.destroyed),
  }));
  broadcastRoom(room, wrapMessage(MessageType.QUEUE_STATUS, {
    status: 'in_match',
    roomId: room.id,
    players,
    detail: players.every((player) => player.connected)
      ? 'Match ready.'
      : 'Opponent disconnected. Waiting for reconnect…',
  }));
}

function startTimer(roomId) {
  stopTimer(roomId);
  roomTimers.set(roomId, setInterval(() => {
    const room = rooms.get(roomId);
    if (!room || room.state.winner) return;
    room.state.turnSecondsLeft -= 1;
    if (room.state.turnSecondsLeft <= 0) {
      room.state = applyAction(room.state, { type: 'endTurn' });
    }
    sendRoomSnapshot(room);
  }, 1000));
}

function assignPlayerToRoom(session, room, side) {
  session.roomId = room.id;
  session.side = side;
  session.queued = false;
  session.disconnectedAt = null;
  room.players[side] = session.id;
}

function createRoom(sessionA, sessionB) {
  const room = {
    id: crypto.randomUUID(),
    state: createInitialState('center'),
    players: {},
  };
  assignPlayerToRoom(sessionA, room, 'Blue');
  assignPlayerToRoom(sessionB, room, 'Red');
  rooms.set(room.id, room);

  for (const [side, sessionId] of Object.entries(room.players)) {
    sendToSession(sessionId, wrapMessage(MessageType.MATCH_FOUND, { roomId: room.id }));
    sendToSession(sessionId, wrapMessage(MessageType.ASSIGNED_SIDE, { side, roomId: room.id }));
  }
  sendRoomPresence(room);
  sendRoomSnapshot(room);
  startTimer(room.id);
}

function tryMatchmake() {
  while (queuedSessionIds.length >= 2) {
    const firstId = queuedSessionIds.shift();
    const secondId = queuedSessionIds.shift();
    const first = sessions.get(firstId);
    const second = sessions.get(secondId);
    if (!first || !second || !first.socket || !second.socket) continue;
    createRoom(first, second);
  }
  notifyQueue();
}

function leaveQueue(session) {
  if (!session.queued) return;
  session.queued = false;
  const index = queuedSessionIds.indexOf(session.id);
  if (index >= 0) queuedSessionIds.splice(index, 1);
  send(session.socket, wrapMessage(MessageType.QUEUE_STATUS, {
    status: 'idle',
    waitingCount: queuedSessionIds.length,
    detail: 'Not currently queued.',
  }));
  notifyQueue();
}

function joinQueue(session) {
  if (session.roomId) {
    send(session.socket, wrapMessage(MessageType.QUEUE_STATUS, {
      status: 'in_match',
      roomId: session.roomId,
      detail: 'Already assigned to a match.',
    }));
    return;
  }
  if (!session.queued) {
    session.queued = true;
    queuedSessionIds.push(session.id);
  }
  notifyQueue();
  tryMatchmake();
}

function handleReconnect(socket, requestedSessionId) {
  const existing = sessions.get(requestedSessionId);
  if (!existing) return createSession(socket);
  existing.socket = socket;
  existing.disconnectedAt = null;
  return existing;
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const players = getRoomPlayers(room);
  const everyoneGone = players.every(({ session }) => !session.socket || session.socket.destroyed);
  if (everyoneGone) {
    stopTimer(roomId);
    rooms.delete(roomId);
  }
}

function handleDisconnect(session) {
  if (!session) return;
  session.socket = null;
  session.disconnectedAt = Date.now();
  leaveQueue(session);
  if (session.roomId) {
    const room = rooms.get(session.roomId);
    if (room) sendRoomPresence(room);
    cleanupRoomIfEmpty(session.roomId);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Mini War WebSocket server running\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'));

  let session = createSession(socket);
  send(socket, wrapMessage(MessageType.SERVER_READY, {
    sessionId: session.id,
    canResume: true,
  }));
  send(socket, wrapMessage(MessageType.QUEUE_STATUS, {
    status: 'idle',
    waitingCount: queuedSessionIds.length,
    detail: 'Connected to server.',
  }));

  socket.on('data', (chunk) => {
    const text = decodeFrame(Buffer.from(chunk));
    if (!text) return;
    const msg = JSON.parse(text);

    if (msg.type === MessageType.RECONNECT_RESUME) {
      session = handleReconnect(socket, msg.sessionId);
      send(socket, wrapMessage(MessageType.SERVER_READY, {
        sessionId: session.id,
        resumed: session.id === msg.sessionId,
        canResume: true,
      }));
      if (session.side) {
        send(socket, wrapMessage(MessageType.ASSIGNED_SIDE, { side: session.side, roomId: session.roomId }));
      }
      if (session.queued) {
        notifyQueue();
      } else if (session.roomId) {
        const room = rooms.get(session.roomId);
        if (room) {
          send(socket, wrapMessage(MessageType.MATCH_FOUND, { roomId: room.id }));
          sendRoomPresence(room);
          send(socket, wrapMessage(MessageType.STATE_SNAPSHOT, { state: room.state, roomId: room.id }));
        }
      } else {
        send(socket, wrapMessage(MessageType.QUEUE_STATUS, {
          status: 'idle',
          waitingCount: queuedSessionIds.length,
          detail: 'Reconnected to server.',
        }));
      }
      return;
    }

    if (msg.type === MessageType.QUEUE_JOIN) {
      joinQueue(session);
      return;
    }

    if (msg.type === MessageType.QUEUE_LEAVE) {
      leaveQueue(session);
      return;
    }

    if (!session.roomId) return;
    const room = rooms.get(session.roomId);
    if (!room) return;

    if (msg.type === MessageType.RESET_MATCH) {
      room.state = createInitialState(msg.mapKey ?? 'center');
      sendRoomSnapshot(room);
      startTimer(room.id);
      return;
    }

    if (msg.type === MessageType.ACTION) {
      try {
        if (session.side !== room.state.current) throw new Error('Not your turn');
        room.state = applyAction(room.state, msg.action);
        sendRoomSnapshot(room);
      } catch (error) {
        send(socket, wrapMessage(MessageType.ACTION_ERROR, { message: error.message }));
      }
    }
  });

  socket.on('close', () => handleDisconnect(session));
  socket.on('end', () => handleDisconnect(session));
  socket.on('error', () => handleDisconnect(session));
});

const port = 8080;
server.listen(port, () => {
  console.log(`Mini War WebSocket server listening on ws://127.0.0.1:${port}`);
});
