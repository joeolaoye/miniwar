export const SIZE = 6;
export const P1 = "Blue";
export const P2 = "Red";
export const TURN_SECONDS = 25;

export const unitIcons = {
  Commander: "♔",
  Soldier: "⚔",
  Scout: "➤",
  Tank: "🛡",
  Artillery: "✹",
};

export const maps = {
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

export const rosterTemplate = [
  { type: "Commander", hp: 3, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: true },
  { type: "Soldier", hp: 2, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: false },
  { type: "Soldier", hp: 2, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: false },
  { type: "Scout", hp: 2, move: 2, minRange: 1, maxRange: 1, damage: 1, canClimb: true },
  { type: "Tank", hp: 4, move: 1, minRange: 1, maxRange: 1, damage: 1, canClimb: false },
  { type: "Artillery", hp: 2, move: 1, minRange: 2, maxRange: 3, damage: 2, canClimb: false },
];
