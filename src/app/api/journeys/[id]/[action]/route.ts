import { z } from "zod";
import { journeyService } from "@/server/services";
import { body,endpoint,json,requireUser } from "@/server/http";
const actionSchema=z.enum(["check-in","extend","complete","cancel"]);
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}){return endpoint(async()=>{const user=await requireUser(request);const params=await context.params;return json(journeyService().transition(user,params.id,actionSchema.parse(params.action),await body(request)));});}