import { journeyService } from "@/server/services";
import { body,endpoint,json,requireUser } from "@/server/http";
export const runtime="nodejs";
export async function GET(request:Request){return endpoint(async()=>json(journeyService().list(await requireUser(request))));}
export async function POST(request:Request){return endpoint(async()=>{const user=await requireUser(request);return json(journeyService().create(user,await body(request)),201);});}