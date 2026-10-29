/** Shared, serializable simulation used by both the browser and room authority. */
export type MapId = 'candy' | 'forest' | 'snow';
export type CharacterId = 'blue' | 'pink' | 'orange' | 'mint';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type ItemType = 'capacity' | 'range' | 'speed' | 'shield';
export interface PlayerSpec { id: string; name: string; character: CharacterId; bot?: boolean; team?: string | number }
export interface GameInput { dx: number; dy: number; bomb?: boolean; rescue?: boolean }
export interface Player extends PlayerSpec {
  x: number; y: number; alive: boolean; trapped: number; capacity: number; range: number; speed: number;
  moveCooldown: number; shield: number; needles: number; invulnerable: number; facing: Direction; score: number;
  trappedBy?: string;
}
export interface Bomb { id: string; x: number; y: number; owner: string; remaining: number; range: number }
export interface Blast { x: number; y: number; remaining: number; owner: string }
export interface Item { x: number; y: number; type: ItemType }
export interface GameEvent { type: 'bomb' | 'explode' | 'crate' | 'pickup' | 'trap' | 'rescue' | 'eliminate' | 'finish'; x: number; y: number; playerId?: string; text?: string }
export interface GameState {
  width: 15; height: 11; tiles: number[][]; players: Player[]; bombs: Bomb[]; blasts: Blast[]; items: Item[];
  timeLeft: number; elapsed: number; status: 'playing' | 'finished'; winner: string | null; map: MapId;
  events: GameEvent[]; seed: number; nextBomb: number;
}
export const CHARACTERS: Record<CharacterId, { name: string; color: string; accent: string }> = {
  blue: { name: '蓝小泡', color: '#69b9ff', accent: '#236ee9' },
  pink: { name: '桃桃', color: '#ff92b8', accent: '#e74c91' },
  orange: { name: '橙小虎', color: '#ffc464', accent: '#ed8a24' },
  mint: { name: '薄荷', color: '#79dfc4', accent: '#2aab9a' },
};
export const MAPS: Record<MapId, { name: string; description: string }> = {
  candy: { name: '糖果花园', description: '甜蜜开场 · 经典地图' },
  forest: { name: '奇幻森林', description: '林间冒险 · 迂回作战' },
  snow: { name: '冰雪乐园', description: '冰爽对决 · 开阔战场' },
};
export const MATCH_DURATION = 180000;
export const BOMB_FUSE = 2200;
export const TRAP_DURATION = 4000;
const BLAST_DURATION = 550;
const DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
const NO_INPUT: GameInput = { dx: 0, dy: 0 };
const cellKey = (x: number, y: number) => y * 15 + x;

function random(state: GameState): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function inside(state: GameState, x: number, y: number) { return x >= 0 && y >= 0 && x < state.width && y < state.height; }
function isEmpty(state: GameState, x: number, y: number) { return inside(state, x, y) && state.tiles[y][x] === 0; }
function bombAt(state: GameState, x: number, y: number) { return state.bombs.some(b => b.x === x && b.y === y); }
function friends(a: Player, b: Player) { return a.team !== undefined && a.team === b.team; }
export function movementDelay(player: Player) { return Math.max(90, 185 - (player.speed - 1) * 22); }

export function createGame(specs: PlayerSpec[], map: MapId = 'candy', seed = Date.now()): GameState {
  const state: GameState = {
    width: 15, height: 11, tiles: [], players: [], bombs: [], blasts: [], items: [],
    timeLeft: MATCH_DURATION, elapsed: 0, status: 'playing', winner: null, map,
    events: [], seed: seed >>> 0, nextBomb: 1,
  };
  const density = map === 'forest' ? 0.68 : map === 'snow' ? 0.47 : 0.58;
  state.tiles = Array.from({ length: 11 }, (_, y) => Array.from({ length: 15 }, (_, x) => {
    if (x === 0 || y === 0 || x === 14 || y === 10 || (x % 2 === 0 && y % 2 === 0)) return 1;
    return random(state) < density ? 2 : 0;
  }));
  // Every corner has a generous, guaranteed escape route from a first bubble.
  const spawns = [[1, 1], [13, 9], [13, 1], [1, 9], [7, 1], [7, 9], [1, 5], [13, 5]];
  for (const [sx, sy] of spawns.slice(0, Math.max(4, specs.length))) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = sx + dx, y = sy + dy;
      if (Math.abs(dx) + Math.abs(dy) <= 2 && inside(state, x, y) && state.tiles[y][x] !== 1) state.tiles[y][x] = 0;
    }
  }
  state.players = specs.slice(0, 8).map((p, i) => ({
    ...p, x: spawns[i][0], y: spawns[i][1], alive: true, trapped: 0, capacity: 1, range: 2, speed: 1,
    moveCooldown: 0, shield: 0, needles: 1, invulnerable: 1200, facing: 'down', score: 0,
  }));
  return state;
}

function blastCells(state: GameState, bomb: Bomb): { x: number; y: number }[] {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const { dx, dy } of DIRS) {
    for (let d = 1; d <= bomb.range; d++) {
      const x = bomb.x + dx * d, y = bomb.y + dy * d;
      if (!inside(state, x, y) || state.tiles[y][x] === 1) break;
      cells.push({ x, y });
      if (state.tiles[y][x] === 2) break;
    }
  }
  return cells;
}

function eliminate(state: GameState, victim: Player, attacker?: string) {
  if (!victim.alive) return;
  victim.alive = false;
  victim.trapped = 0;
  const killer = state.players.find(p => p.id === attacker);
  if (killer && killer.id !== victim.id) killer.score += 100;
  state.events.push({ type: 'eliminate', x: victim.x, y: victim.y, playerId: victim.id, text: victim.name });
}

/** Used by the room authority when a participant explicitly leaves a running match. */
export function eliminatePlayer(state: GameState, playerId: string): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (player && state.status === 'playing') { eliminate(state, player); finishIfNeeded(state); }
  return state;
}

function hurt(state: GameState, player: Player, owner: string) {
  if (!player.alive || player.invulnerable > 0 || player.trapped > 0) return;
  if (player.shield > 0) { player.shield--; player.invulnerable = 1000; return; }
  player.trapped = TRAP_DURATION;
  player.trappedBy = owner;
  state.events.push({ type: 'trap', x: player.x, y: player.y, playerId: player.id });
}

function explode(state: GameState, initial: Bomb[]) {
  const queue = [...initial];
  const done = new Set<string>();
  while (queue.length) {
    const bomb = queue.shift()!;
    if (done.has(bomb.id) || !state.bombs.some(b => b.id === bomb.id)) continue;
    done.add(bomb.id);
    state.bombs = state.bombs.filter(b => b.id !== bomb.id);
    state.events.push({ type: 'explode', x: bomb.x, y: bomb.y, playerId: bomb.owner });
    // Determine the complete ray before destroying crates; a crate stops this explosion.
    const cells = blastCells(state, bomb);
    for (const cell of cells) {
      const existing = state.blasts.find(b => b.x === cell.x && b.y === cell.y);
      if (existing) { existing.remaining = BLAST_DURATION; existing.owner = bomb.owner; }
      else state.blasts.push({ ...cell, remaining: BLAST_DURATION, owner: bomb.owner });
      const chain = state.bombs.find(b => b.x === cell.x && b.y === cell.y);
      if (chain && !done.has(chain.id)) queue.push(chain);
      state.items = state.items.filter(item => item.x !== cell.x || item.y !== cell.y);
      if (state.tiles[cell.y][cell.x] === 2) {
        state.tiles[cell.y][cell.x] = 0;
        const owner = state.players.find(p => p.id === bomb.owner);
        if (owner) owner.score += 10;
        state.events.push({ type: 'crate', ...cell, playerId: bomb.owner });
        if (random(state) < 0.68) {
          const roll = random(state);
          const type: ItemType = roll < 0.35 ? 'capacity' : roll < 0.7 ? 'range' : roll < 0.93 ? 'speed' : 'shield';
          state.items.push({ ...cell, type });
        }
      }
      for (const player of state.players) if (player.x === cell.x && player.y === cell.y) hurt(state, player, bomb.owner);
    }
  }
}

function putBomb(state: GameState, player: Player): boolean {
  if (!player.alive || player.trapped || bombAt(state, player.x, player.y)) return false;
  if (state.bombs.filter(b => b.owner === player.id).length >= player.capacity) return false;
  state.bombs.push({ id: `b${state.nextBomb++}`, x: player.x, y: player.y, owner: player.id, remaining: BOMB_FUSE, range: player.range });
  state.events.push({ type: 'bomb', x: player.x, y: player.y, playerId: player.id });
  return true;
}

type Danger = Map<number, { start: number; end: number }[]>;
function dangerMap(state: GameState, extra?: Bomb): Danger {
  const danger: Danger = new Map();
  const bombs = extra ? [...state.bombs, extra] : state.bombs;
  // Propagate imminent fuse times through chains, so AI does not trust a newly placed bomb near another explosion.
  const fuses = new Map(bombs.map(b => [b.id, b.remaining]));
  for (let n = 0; n < bombs.length; n++) {
    let changed = false;
    for (const bomb of bombs) for (const cell of blastCells(state, bomb)) {
      const next = bombs.find(b => b.x === cell.x && b.y === cell.y);
      if (next && fuses.get(next.id)! > fuses.get(bomb.id)!) { fuses.set(next.id, fuses.get(bomb.id)!); changed = true; }
    }
    if (!changed) break;
  }
  for (const bomb of bombs) for (const cell of blastCells(state, bomb)) {
    const key = cellKey(cell.x, cell.y), list = danger.get(key) || [];
    const start = fuses.get(bomb.id)!;
    list.push({ start, end: start + BLAST_DURATION }); danger.set(key, list);
  }
  for (const blast of state.blasts) {
    const key = cellKey(blast.x, blast.y), list = danger.get(key) || [];
    list.push({ start: 0, end: blast.remaining }); danger.set(key, list);
  }
  return danger;
}
function safeAt(danger: Danger, x: number, y: number, arrival: number, dwell = 240) {
  return !(danger.get(cellKey(x, y)) || []).some(window => window.start <= arrival + dwell && window.end >= arrival);
}
type RouteNode = { x: number; y: number; distance: number; first: GameInput };
function reachable(state: GameState, player: Player, danger: Danger, maxDistance = 14): RouteNode[] {
  const queue: RouteNode[] = [{ x: player.x, y: player.y, distance: 0, first: NO_INPUT }];
  const seen = new Set<number>([cellKey(player.x, player.y)]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.distance >= maxDistance) continue;
    // Different characters prefer different initial directions to avoid identical AI patterns.
    const offset = (player.x + player.y + player.id.length) % 4;
    for (let j = 0; j < 4; j++) {
      const dir = DIRS[(j + offset) % 4], x = current.x + dir.dx, y = current.y + dir.dy;
      const key = cellKey(x, y), distance = current.distance + 1;
      if (seen.has(key) || !isEmpty(state, x, y) || bombAt(state, x, y)) continue;
      if (!safeAt(danger, x, y, distance * movementDelay(player), 130)) continue;
      seen.add(key);
      queue.push({ x, y, distance, first: current.distance === 0 ? dir : current.first });
    }
  }
  return queue;
}

function wantsBomb(state: GameState, player: Player) {
  const preview: Bomb = { id: 'preview', x: player.x, y: player.y, range: player.range, owner: player.id, remaining: BOMB_FUSE };
  const cells = blastCells(state, preview);
  return cells.some(cell => state.tiles[cell.y][cell.x] === 2 || state.players.some(p => p.alive && p.id !== player.id && !friends(player, p) && p.x === cell.x && p.y === cell.y));
}

function botInput(state: GameState, player: Player): GameInput {
  if (player.trapped) return { ...NO_INPUT, rescue: player.trapped < 2600 && player.needles > 0 };
  if (player.moveCooldown > 0) return NO_INPUT;
  const danger = dangerMap(state);
  const routes = reachable(state, player, danger);
  const ownDanger = danger.get(cellKey(player.x, player.y));
  if (ownDanger?.length) {
    // A safe destination is outside every future blast; transit may cross a ray before its fuse expires.
    const escape = routes.find(r => r.distance > 0 && !danger.has(cellKey(r.x, r.y)));
    if (escape) return escape.first;
    const delayed = routes.filter(r => r.distance > 0).sort((a, b) => {
      const dangerStart = (r: RouteNode) => Math.min(...(danger.get(cellKey(r.x, r.y)) || [{ start: 99999 }]).map(w => w.start));
      return dangerStart(b) - dangerStart(a);
    });
    if (delayed.length) return delayed[0].first;
    return NO_INPUT;
  }
  if (!bombAt(state, player.x, player.y) && state.bombs.filter(b => b.owner === player.id).length < player.capacity && wantsBomb(state, player)) {
    const hypothetical: Bomb = { id: 'preview', x: player.x, y: player.y, range: player.range, owner: player.id, remaining: BOMB_FUSE };
    const after = dangerMap(state, hypothetical);
    const escape = reachable(state, player, after, 8).find(r => r.distance > 0 && !after.has(cellKey(r.x, r.y)) && r.distance * movementDelay(player) < BOMB_FUSE - 400);
    if (escape) return { ...escape.first, bomb: true };
  }
  let best: RouteNode | undefined, bestScore = -Infinity;
  for (const route of routes) {
    if (route.distance === 0 || danger.has(cellKey(route.x, route.y))) continue;
    let score = -route.distance * 2;
    const item = state.items.find(i => i.x === route.x && i.y === route.y);
    if (item) score += item.type === 'shield' ? 36 : 28;
    for (const dir of DIRS) if (state.tiles[route.y + dir.dy]?.[route.x + dir.dx] === 2) score += 8;
    const enemies = state.players.filter(p => p.alive && p.id !== player.id && !friends(player, p));
    const nearest = Math.min(30, ...enemies.map(p => Math.abs(p.x - route.x) + Math.abs(p.y - route.y)));
    score += 15 - nearest;
    if (enemies.some(p => p.trapped > 0 && p.x === route.x && p.y === route.y)) score += 80;
    if (state.players.some(p => p.alive && friends(player, p) && p.trapped > 0 && p.x === route.x && p.y === route.y)) score += 90;
    if (score > bestScore) { bestScore = score; best = route; }
  }
  return best?.first || NO_INPUT;
}

function finishIfNeeded(state: GameState) {
  const living = state.players.filter(p => p.alive);
  const teamVictory = living.length > 1 && living[0].team !== undefined && living.every(p => p.team === living[0].team);
  if (state.players.length > 1 && (living.length <= 1 || teamVictory)) {
    state.status = 'finished'; state.winner = living[0]?.id || null;
  } else if (state.timeLeft <= 0) {
    state.status = 'finished';
    const ranked = [...living].sort((a, b) => b.score - a.score);
    state.winner = ranked[0] && (!ranked[1] || ranked[0].score > ranked[1].score) ? ranked[0].id : null;
  }
  if (state.status === 'finished') state.events.push({ type: 'finish', x: 7, y: 5, playerId: state.winner || undefined });
}

function tick(state: GameState, dt: number, inputs: Record<string, GameInput>) {
  state.elapsed += dt; state.timeLeft = Math.max(0, MATCH_DURATION - state.elapsed);
  for (const blast of state.blasts) blast.remaining -= dt;
  state.blasts = state.blasts.filter(b => b.remaining > 0);
  for (const player of state.players) {
    player.moveCooldown = Math.max(0, player.moveCooldown - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    if (!player.alive) continue;
    if (player.trapped > 0) {
      player.trapped = Math.max(0, player.trapped - dt);
      if (player.trapped === 0) eliminate(state, player, player.trappedBy);
    }
  }
  // Plant first, then walk: an AI can plant a bubble and start escaping during this step.
  for (const player of state.players) {
    if (!player.alive) continue;
    const input = player.bot ? botInput(state, player) : (inputs[player.id] || NO_INPUT);
    if (input.rescue && player.trapped > 0 && player.needles > 0) {
      player.needles--; player.trapped = 0; player.invulnerable = 1200; player.trappedBy = undefined;
      state.events.push({ type: 'rescue', x: player.x, y: player.y, playerId: player.id });
    }
    if (player.trapped > 0) continue;
    if (input.bomb) putBomb(state, player);
    if (player.moveCooldown <= 0) {
      const rawX = Number.isFinite(input.dx) ? Math.sign(input.dx) : 0;
      const rawY = Number.isFinite(input.dy) ? Math.sign(input.dy) : 0;
      const dx = rawX, dy = rawX ? 0 : rawY;
      if (dx || dy) {
        player.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
        const x = player.x + dx, y = player.y + dy;
        if (isEmpty(state, x, y) && !bombAt(state, x, y)) { player.x = x; player.y = y; player.moveCooldown = movementDelay(player); }
      }
    }
    const itemIndex = state.items.findIndex(item => item.x === player.x && item.y === player.y);
    if (itemIndex >= 0) {
      const [item] = state.items.splice(itemIndex, 1);
      if (item.type === 'capacity') player.capacity = Math.min(6, player.capacity + 1);
      if (item.type === 'range') player.range = Math.min(7, player.range + 1);
      if (item.type === 'speed') player.speed = Math.min(5, player.speed + 1);
      if (item.type === 'shield') player.shield = Math.min(2, player.shield + 1);
      player.score += 20;
      state.events.push({ type: 'pickup', x: item.x, y: item.y, playerId: player.id, text: item.type });
    }
  }
  for (const bomb of state.bombs) bomb.remaining -= dt;
  const ready = state.bombs.filter(b => b.remaining <= 0 || state.blasts.some(blast => blast.x === b.x && blast.y === b.y));
  if (ready.length) explode(state, ready);
  for (const player of state.players) {
    if (!player.alive) continue;
    const blast = state.blasts.find(b => b.x === player.x && b.y === player.y);
    if (blast) hurt(state, player, blast.owner);
  }
  for (const trapped of state.players) {
    if (!trapped.alive || !trapped.trapped) continue;
    const toucher = state.players.find(p => p.id !== trapped.id && p.alive && !p.trapped && p.x === trapped.x && p.y === trapped.y);
    if (!toucher) continue;
    if (friends(trapped, toucher)) {
      trapped.trapped = 0; trapped.invulnerable = 1200; trapped.trappedBy = undefined;
      toucher.score += 30;
      state.events.push({ type: 'rescue', x: trapped.x, y: trapped.y, playerId: trapped.id });
    } else eliminate(state, trapped, toucher.id);
  }
  finishIfNeeded(state);
}

/** Advances in bounded substeps, so room polling and frame rate use the same rules. */
export function stepGame(state: GameState, dtMs: number, inputs: Record<string, GameInput> = {}): GameState {
  state.events = [];
  if (state.status !== 'playing' || !Number.isFinite(dtMs) || dtMs <= 0) return state;
  let remaining = Math.min(10000, dtMs);
  while (remaining > 0 && state.status === 'playing') {
    const dt = Math.min(50, remaining);
    tick(state, dt, inputs);
    remaining -= dt;
  }
  return state;
}
