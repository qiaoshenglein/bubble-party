import { env } from "cloudflare:workers";
import { actOnRoom, getRoom, parseRoomBody, roomResponse, roomFailure, RoomError } from "@/lib/rooms";

type Context = { params: Promise<{ code: string }> };
function database() {
  if (!env.DB) throw new RoomError("在线服务正在准备中，请稍后重试", 503);
  return env.DB;
}

export async function GET(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    const token = new URL(request.url).searchParams.get("token") || undefined;
    return roomResponse(await getRoom(database(), code, token));
  } catch (error) { return roomFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    return roomResponse(await actOnRoom(database(), code, await parseRoomBody(request)));
  } catch (error) { return roomFailure(error); }
}
