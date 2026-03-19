export const PROTOCOL_VERSION = 1;

export const MessageType = {
  SERVER_READY: 'server_ready',
  ASSIGNED_SIDE: 'assigned_side',
  STATE_SNAPSHOT: 'state_snapshot',
  ACTION_ERROR: 'action_error',
  ACTION: 'action',
  RESET_MATCH: 'reset_match',
  QUEUE_JOIN: 'queue_join',
  QUEUE_LEAVE: 'queue_leave',
  QUEUE_STATUS: 'queue_status',
  MATCH_FOUND: 'match_found',
  RECONNECT_RESUME: 'reconnect_resume',
};

export const ActionType = {
  MOVE: 'move',
  ATTACK: 'attack',
  END_TURN: 'endTurn',
};

export function wrapMessage(type, payload = {}) {
  return { version: PROTOCOL_VERSION, type, ...payload };
}
