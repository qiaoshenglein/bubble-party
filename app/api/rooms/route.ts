import { env } from "cloudflare:workers";
import { createRoom, listRooms, parseRoomBody, roomResponse, roomFailure, RoomError } from "@/lib/rooms";

function database() {
  if (!env.DB) throw new RoomError("在线服务正在准备中，请稍后重试", 503);
  return env.DB;
}

export async function GET() {
  try { return roomResponse(await listRooms(database())); }
  catch (error) { return roomFailure(error); }
}

export async function POST(request: Request) {
  try { return roomResponse(await createRoom(database(), await parseRoomBody(request)), 201); }
  catch (error) { return roomFailure(error); }
}
