import { createGame, stepGame, eliminatePlayer, type GameState, type GameInput } from "./game";

const CHARACTERS = ["blue", "pink", "orange", "mint"] as const;
const MAPS = ["candy", "forest", "snow"] as const;
type Character = typeof CHARACTERS[number];
type MapId = typeof MAPS[number];
const TTL = 30 * 60 * 1000;
const DISCONNECT_GRACE = 60 * 1000;
const STEP = 50;
const MAX_CATCHUP = 3000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

interface Member {
  id: string;
  name: string;
  character: Character;
  ready: boolean;
  bot?: boolean;
  token: string;
  lastSeen: number;
  lastSeq: number;
}
interface StoredInput extends GameInput { at: number }
export interface RoomMessage { id: string; playerId: string; name: string; text: string; at: number }
interface PrivateRoom {
  code: string;
  hostId: string;
  map: MapId;
  status: "waiting" | "playing" | "finished";
  players: Member[];
  game: GameState | null;
  inputs: Record<string, StoredInput>;
  messages: RoomMessage[];
  lastTick: number;
  createdAt: number;
}
interface RoomRow { code: string; state: string; version: number; updated_at: number }
export interface PublicRoom {
  code: string;
  hostId: string;
  map: MapId;
  status: PrivateRoom["status"];
  players: { id: string; name: string; character: Character; ready: boolean; bot?: boolean }[];
  game: GameState | null;
  messages: RoomMessage[];
  version: number;
  serverTime: number;
}
type Payload = Record<string, unknown>;

export function normalizeCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(normalized)) throw new RoomError("房间号应为 6 位字母或数字");
  return normalized;
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";
}
function character(value: unknown): Character {
  return CHARACTERS.includes(value as Character) ? value as Character : "blue";
}
function mapId(value: unknown): MapId {
  return MAPS.includes(value as MapId) ? value as MapId : "candy";
}
function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
}
function newMember(body: Payload, now: number): Member {
  return {
    id: crypto.randomUUID(), name: cleanText(body.name, 12) || "糖果玩家",
    character: character(body.character), ready: false,
    token: newToken(), lastSeen: now, lastSeq: -1,
  };
}
function snapshot(room: PrivateRoom, version: number, now: number): PublicRoom {
  return {
    code: room.code, hostId: room.hostId, map: room.map, status: room.status,
    players: room.players.map(({ id, name, character, ready, bot }) => ({ id, name, character, ready, bot })),
    game: room.game, messages: room.messages, version, serverTime: now,
  };
}
function authenticate(room: PrivateRoom, token: unknown): Member {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new RoomError("请先加入房间", 401);
  const member = room.players.find(p => !p.bot && p.token === token);
  if (!member) throw new RoomError("房间凭证已失效，请重新加入", 401);
  return member;
}

function removeMember(room: PrivateRoom, id: string) {
  if (room.game && room.status === "playing") {
    eliminatePlayer(room.game, id);
    if (room.game.status === "finished") room.status = "finished";
  }
  room.players = room.players.filter(p => p.id !== id);
  delete room.inputs[id];
  if (room.hostId === id) room.hostId = room.players.find(p => !p.bot)?.id || "";
  const nextHost = room.players.find(p => p.id === room.hostId);
  if (nextHost) nextHost.ready = true;
  if (!room.players.some(p => !p.bot)) {
    room.status = "finished";
    room.players = [];
    if (room.game) { room.game.status = "finished"; room.game.winner = null; }
  }
}

function removeDisconnected(room: PrivateRoom, now: number, currentToken?: unknown): boolean {
  const departed = room.players.filter(p => !p.bot && p.token !== currentToken && now - p.lastSeen > DISCONNECT_GRACE);
  for (const player of departed) removeMember(room, player.id);
  return departed.length > 0;
}

// Progress the deterministic engine exclusively with server time and
// authenticated commands. Clients never submit game state.
function advance(room: PrivateRoom, now: number): boolean {
  if (!room.game || room.status !== "playing") return false;
  const elapsed = Math.max(0, Math.min(MAX_CATCHUP, now - room.lastTick));
  const steps = Math.floor(elapsed / STEP);
  if (!steps) return false;
  const tickOrigin = Math.max(room.lastTick, now - MAX_CATCHUP);
  for (let i = 0; i < steps && room.game.status === "playing"; i++) {
    const stepTime = tickOrigin + (i + 1) * STEP;
    const inputs: Record<string, GameInput> = {};
    for (const [id, input] of Object.entries(room.inputs)) {
      if (stepTime - input.at <= 400) inputs[id] = { dx: input.dx, dy: input.dy, bomb: input.bomb, rescue: input.rescue };
      input.bomb = false;
      input.rescue = false;
    }
    stepGame(room.game, STEP, inputs);
  }
  room.lastTick = now - (elapsed % STEP);
  if (room.game.status === "finished") room.status = "finished";
  return true;
}

async function rowFor(db: D1Database, code: string, now: number): Promise<RoomRow> {
  const row = await db.prepare("SELECT code, state, version, updated_at FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
  if (!row || row.updated_at < now - TTL) throw new RoomError("房间不存在或已过期，请创建新房间", 404);
  return row;
}

async function mutate<T>(db: D1Database, code: string, mutation: (room: PrivateRoom, now: number) => { value: T; changed: boolean }, token?: unknown) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const now = Date.now();
    const row = await rowFor(db, code, now);
    const room = JSON.parse(row.state) as PrivateRoom;
    const disconnected = removeDisconnected(room, now, token);
    const advanced = advance(room, now);
    const result = mutation(room, now);
    if (!disconnected && !advanced && !result.changed) return { room: snapshot(room, row.version, now), value: result.value };
    const update = await db.prepare("UPDATE rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?")
      .bind(JSON.stringify(room), now, code, row.version).run();
    if (update.meta.changes === 1) return { room: snapshot(room, row.version + 1, now), value: result.value };
  }
  throw new RoomError("房间同步繁忙，请稍后重试", 409);
}

export async function createRoom(db: D1Database, body: Payload) {
  const now = Date.now();
  await db.prepare("DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE updated_at < ? LIMIT 40)").bind(now - TTL).run();
  for (let attempt = 0; attempt < 8; attempt++) {
    const random = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(random, n => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
    const host = newMember(body, now);
    host.ready = true;
    const room: PrivateRoom = {
      code, hostId: host.id, map: mapId(body.map), status: "waiting", players: [host], game: null,
      inputs: {}, messages: [], lastTick: now, createdAt: now,
    };
    const insert = await db.prepare("INSERT OR IGNORE INTO rooms (code, state, version, updated_at) VALUES (?, ?, 0, ?)")
      .bind(code, JSON.stringify(room), now).run();
    if (insert.meta.changes === 1) return { code, token: host.token, playerId: host.id, room: snapshot(room, 0, now) };
  }
  throw new RoomError("创建房间失败，请重试", 503);
}

export async function listRooms(db: D1Database) {
  const now = Date.now();
  const result = await db.prepare("SELECT code, state, version, updated_at FROM rooms WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 60")
    .bind(now - TTL).all<RoomRow>();
  return { rooms: result.results.map(row => {
    const room = JSON.parse(row.state) as PrivateRoom;
    const available = room.players.filter(p => !p.bot && now - p.lastSeen <= DISCONNECT_GRACE);
    return { code: room.code, hostName: available.find(p => p.id === room.hostId)?.name || available[0]?.name || "糖果玩家", map: room.map, status: room.status, playerCount: available.length, maxPlayers: 4 };
  }).filter(room => room.playerCount > 0 && room.playerCount < 4 && room.status !== "playing").slice(0, 30) };
}

export async function getRoom(db: D1Database, rawCode: string, token?: string) {
  const code = normalizeCode(rawCode);
  const result = await mutate(db, code, (room, now) => {
    const player = token ? authenticate(room, token) : undefined;
    const changed = Boolean(player && now - player.lastSeen > 5000);
    if (player && changed) player.lastSeen = now;
    return { value: player?.id, changed };
  }, token);
  return { room: result.room, playerId: result.value };
}

export async function actOnRoom(db: D1Database, rawCode: string, body: Payload) {
  const code = normalizeCode(rawCode);
  const action = body.action;
  const result = await mutate<{ token?: string; playerId: string }>(db, code, (room, now) => {
    if (action === "join") {
      if (typeof body.token === "string") {
        const existing = room.players.find(p => !p.bot && p.token === body.token);
        if (existing) {
          existing.lastSeen = now;
          return { value: { token: existing.token, playerId: existing.id }, changed: true };
        }
      }
      if (room.status === "playing") throw new RoomError("对战进行中，等待本局结束后再加入", 409);
      room.players = room.players.filter(p => !p.bot);
      if (room.players.length >= 4) throw new RoomError("房间已经满员了", 409);
      const player = newMember(body, now);
      room.players.push(player);
      if (!room.players.some(p => p.id === room.hostId)) { room.hostId = player.id; player.ready = true; }
      return { value: { token: player.token, playerId: player.id }, changed: true };
    }
    const player = authenticate(room, body.token);
    player.lastSeen = now;
    if (action === "input") {
      if (typeof body.seq !== "number" || !Number.isSafeInteger(body.seq) || body.seq < 0) throw new RoomError("无效的操作序号");
      if (body.seq <= player.lastSeq) return { value: { playerId: player.id }, changed: false };
      player.lastSeq = body.seq;
      if (room.status === "playing") {
        const axis = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.sign(value) : 0;
        const oldInput = room.inputs[player.id];
        room.inputs[player.id] = {
          dx: axis(body.dx), dy: axis(body.dy), bomb: body.bomb === true || Boolean(oldInput?.bomb),
          rescue: body.rescue === true || Boolean(oldInput?.rescue), at: now,
        };
      }
      return { value: { playerId: player.id }, changed: true };
    }
    if (action === "ready") {
      if (room.status === "playing") throw new RoomError("对战开始后无法修改准备状态", 409);
      player.ready = player.id === room.hostId || body.ready === true;
    } else if (action === "start") {
      if (player.id !== room.hostId) throw new RoomError("只有房主可以开始游戏", 403);
      if (room.status === "playing") throw new RoomError("游戏已经开始", 409);
      const humans = room.players.filter(p => !p.bot);
      if (humans.some(p => p.id !== room.hostId && !p.ready)) throw new RoomError("请等待所有玩家准备", 409);
      if (humans.length < 2 && body.addBots !== true) throw new RoomError("至少需要 2 名玩家，或添加电脑陪练", 409);
      room.players = humans;
      if (body.addBots === true) {
        const botNames = ["棉花糖", "泡泡龙", "甜甜圈"];
        let botIndex = 0;
        while (room.players.length < 4) {
          const idx = room.players.length;
          room.players.push({ id: `bot-${crypto.randomUUID()}`, name: botNames[botIndex++], character: CHARACTERS[idx], ready: true, bot: true, token: "", lastSeen: now, lastSeq: -1 });
        }
      }
      room.game = createGame(room.players.map(({ id, name, character, bot }) => ({ id, name, character, bot })), room.map, crypto.getRandomValues(new Uint32Array(1))[0]);
      room.status = "playing";
      room.lastTick = now;
      room.inputs = {};
    } else if (action === "leave") {
      removeMember(room, player.id);
    } else if (action === "chat") {
      const text = cleanText(body.text, 100);
      if (!text) throw new RoomError("消息不能为空");
      const latest = [...room.messages].reverse().find(message => message.playerId === player.id);
      if (latest && now - latest.at < 1000) throw new RoomError("消息发送得太快了", 429);
      room.messages.push({ id: crypto.randomUUID(), playerId: player.id, name: player.name, text, at: now });
      room.messages = room.messages.slice(-30);
    } else {
      throw new RoomError("未知的房间操作");
    }
    return { value: { playerId: player.id }, changed: true };
  }, body.token);
  return { code, ...result.value, room: result.room };
}

export async function parseRoomBody(request: Request): Promise<Payload> {
  if (Number(request.headers.get("content-length") || 0) > 4096) throw new RoomError("请求内容过长", 413);
  if (!request.body) throw new RoomError("请求格式错误");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        throw new RoomError("请求内容过长", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError("请求格式错误");
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Payload;
  } catch { throw new RoomError("请求格式错误"); }
}

export function roomResponse(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function roomFailure(error: unknown) {
  if (error instanceof RoomError) return roomResponse({ error: error.message }, error.status);
  console.error("Room request failed", error);
  return roomResponse({ error: "在线服务暂时不可用，请稍后重试。你仍可以体验单人练习。" }, 503);
}
