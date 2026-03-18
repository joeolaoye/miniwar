import crypto from 'node:crypto';
import http from 'node:http';
import { applyAction, createInitialState } from './engine/index.js';
import { MessageType, wrapMessage } from './protocol/index.js';

const clients = new Set();
let room = null;
let timerHandle = null;

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
  socket.write(encodeFrame(JSON.stringify(obj)));
}

function broadcast(obj) {
  if (!room) return;
  room.players.forEach((entry) => send(entry.socket, obj));
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function startTimer() {
  stopTimer();
  timerHandle = setInterval(() => {
    if (!room || room.state.winner) return;
    room.state.turnSecondsLeft -= 1;
    if (room.state.turnSecondsLeft <= 0) {
      room.state = applyAction(room.state, { type: 'endTurn' });
    }
    broadcast(wrapMessage(MessageType.STATE_SNAPSHOT, { state: room.state }));
  }, 1000);
}

function syncPlayers() {
  if (clients.size < 2) return;
  const sockets = [...clients].slice(0, 2);
  room = {
    state: createInitialState('center'),
    players: [
      { socket: sockets[0], side: 'Blue' },
      { socket: sockets[1], side: 'Red' },
    ],
  };
  room.players.forEach((player) => send(player.socket, wrapMessage(MessageType.ASSIGNED_SIDE, { side: player.side })));
  broadcast(wrapMessage(MessageType.STATE_SNAPSHOT, { state: room.state }));
  startTimer();
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

  clients.add(socket);
  send(socket, wrapMessage(MessageType.SERVER_READY));
  syncPlayers();

  socket.on('data', (chunk) => {
    const text = decodeFrame(Buffer.from(chunk));
    if (!text || !room) return;
    const msg = JSON.parse(text);
    const player = room.players.find((entry) => entry.socket === socket);
    if (msg.type === MessageType.RESET_MATCH) {
      room.state = createInitialState(msg.mapKey ?? 'center');
      broadcast(wrapMessage(MessageType.STATE_SNAPSHOT, { state: room.state }));
      startTimer();
      return;
    }
    if (msg.type === MessageType.ACTION) {
      try {
        if (player?.side !== room.state.current) throw new Error('Not your turn');
        room.state = applyAction(room.state, msg.action);
        broadcast(wrapMessage(MessageType.STATE_SNAPSHOT, { state: room.state }));
      } catch (error) {
        send(socket, wrapMessage(MessageType.ACTION_ERROR, { message: error.message }));
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    room = null;
    stopTimer();
  });
  socket.on('end', () => {
    clients.delete(socket);
    room = null;
    stopTimer();
  });
});

const port = 8080;
server.listen(port, () => {
  console.log(`Mini War WebSocket server listening on ws://127.0.0.1:${port}`);
});
