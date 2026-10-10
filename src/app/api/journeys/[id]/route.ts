import { journeyService } from "@/server/services";
import { endpoint,json,requireUser } from "@/server/http";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{const user=await requireUser(request);return json(journeyService().get(user,(await context.params).id));});}