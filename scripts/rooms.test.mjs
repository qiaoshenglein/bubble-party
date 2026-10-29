import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';

// Run the actual authority and SQL against SQLite without Cloudflare or a
// development server. Yield each query to exercise compare-and-swap retries.
const gameSource = await readFile(new URL('../lib/game.ts', import.meta.url), 'utf8');
const gameUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(gameSource)).toString('base64')}`;
const source = (await readFile(new URL('../lib/rooms.ts', import.meta.url), 'utf8')).replace('"./game"', JSON.stringify(gameUrl));
const { createRoom, listRooms, getRoom, actOnRoom, parseRoomBody } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`);

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)');
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { await Promise.resolve(); return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { await Promise.resolve(); return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { await Promise.resolve(); return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      };
    },
  };
}

async function withClock(fn) {
  const original = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try { await fn(ms => { now += ms; }); } finally { Date.now = original; }
}

test('room capabilities, readiness, authoritative start, and public privacy', async () => {
  const db = database();
  const host = await createRoom(db, { name: '房主', character: 'blue', map: 'forest' });
  const guest = await actOnRoom(db, host.code, { action: 'join', name: '伙伴', character: 'pink' });
  assert.equal(host.token.length, 64);
  assert.notEqual(host.token, guest.token);
  assert.equal(guest.room.players.length, 2);
  assert.ok(!JSON.stringify(guest.room).includes(host.token));
  assert.ok(!JSON.stringify(guest.room).includes(guest.token));
  await assert.rejects(actOnRoom(db, host.code, { action: 'start', token: guest.token }), error => error.status === 403);
  await assert.rejects(actOnRoom(db, host.code, { action: 'start', token: host.token }), error => error.status === 409);
  await assert.rejects(actOnRoom(db, host.code, { action: 'input', token: 'fake', seq: 0 }), error => error.status === 401);
  await actOnRoom(db, host.code, { action: 'ready', token: guest.token, ready: true });
  const match = await actOnRoom(db, host.code, { action: 'start', token: host.token });
  assert.equal(match.room.status, 'playing');
  assert.equal(match.room.game.players.length, 2);
  assert.equal(match.room.game.map, 'forest');
  await assert.rejects(actOnRoom(db, host.code, { action: 'join', name: '迟到' }), error => error.status === 409);
  const left = await actOnRoom(db, host.code, { action: 'leave', token: host.token });
  assert.equal(left.room.hostId, guest.playerId);
  assert.equal(left.room.status, 'finished');
  assert.equal(left.room.game.winner, guest.playerId);
  const replay = await actOnRoom(db, host.code, { action: 'start', token: guest.token, addBots: true });
  assert.equal(replay.room.players.length, 4);
  assert.equal(replay.room.status, 'playing');
  db.sqlite.close();
});

test('concurrent joins and inputs cannot overwrite successful mutations', async () => {
  const db = database();
  const host = await createRoom(db, { name: 'host' });
  const joined = await Promise.all(['a', 'b', 'c'].map(name => actOnRoom(db, host.code, { action: 'join', name })));
  const latest = await getRoom(db, host.code, host.token);
  assert.equal(latest.room.players.length, 4);
  assert.equal(new Set(joined.map(j => j.playerId)).size, 3);
  await assert.rejects(actOnRoom(db, host.code, { action: 'join', name: 'overflow' }), error => error.status === 409);
  await Promise.all(joined.map(j => actOnRoom(db, host.code, { action: 'ready', token: j.token, ready: true })));
  await actOnRoom(db, host.code, { action: 'start', token: host.token });
  await Promise.all([10, 11].map(seq => actOnRoom(db, host.code, { action: 'input', token: host.token, seq, dx: 1, dy: 0 })));
  const privateRoom = JSON.parse(db.sqlite.prepare('SELECT state FROM rooms WHERE code = ?').get(host.code).state);
  assert.equal(privateRoom.players.find(p => p.id === host.playerId).lastSeq, 11);
  db.sqlite.close();
});

test('server clock, one-shot bombs, duplicate inputs, and stale motion', async () => withClock(async advance => {
  const db = database();
  const host = await createRoom(db, { name: 'host' });
  const guest = await actOnRoom(db, host.code, { action: 'join', name: 'guest' });
  await actOnRoom(db, host.code, { action: 'ready', token: guest.token, ready: true });
  await actOnRoom(db, host.code, { action: 'start', token: host.token });
  await actOnRoom(db, host.code, { action: 'input', token: host.token, seq: 1, dx: 0, dy: 0, bomb: true });
  await actOnRoom(db, host.code, { action: 'input', token: host.token, seq: 1, dx: -1, dy: 0, bomb: true });
  advance(50);
  const tick = await getRoom(db, host.code, host.token);
  assert.equal(tick.room.game.elapsed, 50);
  assert.equal(tick.room.game.bombs.length, 1);
  assert.equal(tick.room.game.players[0].x, 1);
  await actOnRoom(db, host.code, { action: 'input', token: host.token, seq: 2, dx: 1, dy: 0 });
  advance(1000);
  const stale = await getRoom(db, host.code, host.token);
  const position = stale.room.game.players[0].x;
  assert.ok(position > 1);
  advance(600);
  const stopped = await getRoom(db, host.code, host.token);
  assert.equal(stopped.room.game.players[0].x, position);
  assert.equal(stopped.room.game.bombs.length, 1);
  advance(20_000);
  const bounded = await getRoom(db, host.code, host.token);
  assert.ok(bounded.room.game.elapsed - stopped.room.game.elapsed <= 3000);
  db.sqlite.close();
}));

test('chat bounds, expiration, and malformed payloads are enforced', async () => withClock(async advance => {
  const db = database();
  const host = await createRoom(db, { name: '12345678901234567890', map: 'unsupported' });
  assert.equal(host.room.players[0].name.length, 12);
  assert.equal(host.room.map, 'candy');
  const message = await actOnRoom(db, host.code, { action: 'chat', token: host.token, text: '你好' });
  assert.equal(message.room.messages[0].text, '你好');
  await assert.rejects(actOnRoom(db, host.code, { action: 'chat', token: host.token, text: '再见' }), error => error.status === 429);
  await assert.rejects(parseRoomBody(new Request('https://local/api/rooms', { method: 'POST', body: '[]' })), error => error.status === 400);
  await assert.rejects(getRoom(db, '../oops'), error => error.status === 400);
  advance(31 * 60 * 1000);
  await assert.rejects(getRoom(db, host.code), error => error.status === 404);
  assert.equal((await listRooms(db)).rooms.length, 0);
  await createRoom(db, { name: 'new' });
  assert.equal(db.sqlite.prepare('SELECT count(*) AS total FROM rooms').get().total, 1);
  db.sqlite.close();
}));
