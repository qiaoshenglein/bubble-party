import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, eliminatePlayer, TRAP_DURATION } from '../lib/game.ts';

const specs = [
  { id: 'a', name: 'Blue', character: 'blue' },
  { id: 'b', name: 'Pink', character: 'pink' },
];
function arena(players = specs) {
  const state = createGame(players, 'candy', 42);
  state.tiles = state.tiles.map((row, y) => row.map((_, x) => x === 0 || x === 14 || y === 0 || y === 10 ? 1 : 0));
  state.players.forEach((p, i) => { p.x = i === 0 ? 3 : 11; p.y = i === 0 ? 3 : 7; p.invulnerable = 0; });
  return state;
}
function bomb(state, x, y, range = 2, remaining = 50, owner = 'b') {
  state.bombs.push({ id: `test-${state.bombs.length}`, x, y, range, remaining, owner });
}

test('seeded maps reproduce and keep every spawn exit clear', () => {
  for (const map of ['candy', 'forest', 'snow']) {
    const a = createGame(specs, map, 123), b = createGame(specs, map, 123);
    assert.deepEqual(a, b);
    for (const p of a.players) {
      assert.equal(a.tiles[p.y][p.x], 0);
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => a.tiles[p.y + dy]?.[p.x + dx] === 0).length >= 2);
    }
  }
});

test('movement respects walls, cooldown, bomb occupancy and capacity', () => {
  const s = arena();
  s.tiles[3][4] = 1;
  stepGame(s, 50, { a: { dx: 1, dy: 0 } });
  assert.equal(s.players[0].x, 3);
  stepGame(s, 50, { a: { dx: -1, dy: 0, bomb: true } });
  assert.equal(s.players[0].x, 2);
  assert.equal(s.bombs.length, 1);
  stepGame(s, 50, { a: { dx: -1, dy: 0, bomb: true } });
  assert.equal(s.players[0].x, 2);
  assert.equal(s.bombs.length, 1);
  stepGame(s, 200, { a: { dx: 1, dy: 0 } });
  assert.equal(s.players[0].x, 2);
});

test('explosions stop at walls and the first crate', () => {
  const s = arena(); s.players[0].x = 1; s.players[0].y = 1;
  s.tiles[3][5] = 2; s.tiles[5][3] = 1;
  bomb(s, 3, 3, 4);
  stepGame(s, 50, {});
  assert.equal(s.tiles[3][5], 0);
  assert.ok(s.blasts.some(b => b.x === 5 && b.y === 3));
  assert.ok(!s.blasts.some(b => b.x === 6 && b.y === 3));
  assert.ok(!s.blasts.some(b => b.x === 3 && b.y === 5));
  assert.equal(s.tiles[5][3], 1);
});

test('a blast triggers an adjacent bomb before its fuse finishes', () => {
  const s = arena(); s.players[0].x = 1; s.players[0].y = 1;
  bomb(s, 3, 3, 2, 50); bomb(s, 4, 3, 3, 1900);
  stepGame(s, 50, {});
  assert.equal(s.bombs.length, 0);
  assert.ok(s.blasts.some(b => b.x === 7 && b.y === 3));
  assert.equal(s.events.filter(e => e.type === 'explode').length, 2);
});

test('bubble traps expire and award the attacker an elimination', () => {
  const s = arena(); bomb(s, 3, 3);
  stepGame(s, 50, {});
  assert.equal(s.players[0].trapped, TRAP_DURATION);
  stepGame(s, TRAP_DURATION, {});
  assert.equal(s.players[0].alive, false);
  assert.equal(s.winner, 'b');
  assert.equal(s.players[1].score, 100);
});

test('the one-use needle rescues and grants blast immunity', () => {
  const s = arena(); bomb(s, 3, 3);
  stepGame(s, 50, {});
  stepGame(s, 50, { a: { dx: 0, dy: 0, rescue: true } });
  assert.equal(s.players[0].trapped, 0);
  assert.equal(s.players[0].needles, 0);
  assert.ok(s.players[0].invulnerable > 0);
  stepGame(s, 600, {});
  assert.equal(s.players[0].alive, true);
  assert.equal(s.players[0].trapped, 0);
});

test('touching a trapped opponent finishes them', () => {
  const s = arena(); const [a, b] = s.players;
  a.x = 4; a.y = 3; a.trapped = 3000; b.x = 3; b.y = 3;
  stepGame(s, 50, { b: { dx: 1, dy: 0 } });
  assert.equal(a.alive, false); assert.equal(s.winner, 'b');
});

test('touching a trapped teammate rescues them', () => {
  const s = arena([{ ...specs[0], team: 'red' }, { ...specs[1], team: 'red' }, { id: 'c', name: 'Enemy', character: 'mint', team: 'blue' }]);
  const [a, b] = s.players; a.x = 4; a.y = 3; a.trapped = 3000; b.x = 3; b.y = 3;
  stepGame(s, 50, { b: { dx: 1, dy: 0 } });
  assert.equal(a.alive, true); assert.equal(a.trapped, 0); assert.equal(b.score, 30);
});

test('shield absorbs a blast and powerups respect their caps', () => {
  const s = arena(); s.players[0].shield = 1; s.players[0].capacity = 6;
  s.items.push({ x: 3, y: 3, type: 'capacity' }); bomb(s, 3, 3);
  stepGame(s, 50, {});
  assert.equal(s.players[0].capacity, 6); assert.equal(s.players[0].shield, 0); assert.equal(s.players[0].trapped, 0);
});

test('serialized simulation is reproducible across room-sized tick batches', () => {
  const a = arena(), b = JSON.parse(JSON.stringify(a));
  const input = { a: { dx: 1, dy: 0, bomb: true } };
  stepGame(a, 1000, input);
  for (let i = 0; i < 20; i++) stepGame(b, 50, input);
  a.events = []; b.events = [];
  assert.deepEqual(a, b);
});

test('four AI players plant, escape, gather items and complete a match', () => {
  const s = createGame([...specs, { id: 'c', name: 'Mint', character: 'mint' }, { id: 'd', name: 'Orange', character: 'orange' }].map(p => ({ ...p, bot: true })), 'candy', 42);
  for (let i = 0; i < 3600 && s.status === 'playing'; i++) stepGame(s, 50, {});
  assert.equal(s.status, 'finished');
  assert.ok(s.nextBomb > 10);
  assert.ok(s.players.some(p => p.score > 0));
  assert.ok(s.winner);
});

test('explicit departure concludes a room without waiting for a fuse', () => {
  const s = arena(); eliminatePlayer(s, 'a');
  assert.equal(s.status, 'finished'); assert.equal(s.winner, 'b');
});
