import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Journey, JourneyAction, JourneyStatus } from "@/lib/journey-types";
import { EmergencyService, locationSchema } from "./emergency";
import { AppError } from "./http";
import { audit, throttle } from "./audit";

const createSchema = z.object({
  idempotency_key:z.uuid(), destination:z.string().trim().min(1,"Enter a destination.").max(200), origin:z.string().trim().max(200).optional(),
  expected_arrival_at:z.number().int().positive(), grace_period_minutes:z.number().int().min(1).max(60),
  contact_ids:z.array(z.uuid()).min(1,"Select at least one trusted contact.").max(20).refine(ids=>new Set(ids).size===ids.length,"Select each contact only once."),
  consent:z.literal(true), location:locationSchema.nullable().optional(),
}).strict();
const etaSchema = z.object({expected_arrival_at:z.number().int().positive()}).strict();
const emptySchema = z.object({}).strict();
const allowed:Record<JourneyAction,JourneyStatus[]> = {
  "check-in":["active","check_in_due"], extend:["active","check_in_due"],
  complete:["active","check_in_due","escalated"], cancel:["active","check_in_due","escalated"],
};
type JourneyRow=Omit<Journey,"contact_ids"|"events"|"alert">;
export class JourneyService {
  constructor(private db:Database.Database,private emergency:EmergencyService,private clock=Date.now) {}
  get(userId:string,id:string):Journey {
    const row=this.db.prepare("SELECT id,user_id,status,origin,destination,expected_arrival_at,grace_period_minutes,last_known_latitude,last_known_longitude,last_location_accuracy_meters,last_location_updated_at,started_at,completed_at,cancelled_at,escalated_at,alert_id,created_at,updated_at FROM journeys WHERE id=? AND user_id=?").get(id,userId) as JourneyRow|undefined;
    if(!row) throw new AppError(404,"NOT_FOUND","Journey not found.");
    return {...row,contact_ids:(this.db.prepare("SELECT contact_id FROM journey_contacts WHERE journey_id=? AND user_id=?").all(id,userId) as {contact_id:string}[]).map(c=>c.contact_id),events:this.db.prepare("SELECT kind,created_at FROM journey_events WHERE journey_id=? ORDER BY created_at,id").all(id) as Journey["events"],alert:row.alert_id?this.emergency.get(userId,row.alert_id):null};
  }
  list(userId:string) { return (this.db.prepare("SELECT id FROM journeys WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(userId) as {id:string}[]).map(row=>this.get(userId,row.id)); }
  private validateEta(eta:number) {
    const now=this.clock();
    if(eta<now+60000||eta>now+86400000) throw new AppError(400,"INVALID_ETA","Choose an arrival time between one minute and 24 hours from now.");
  }
  private event(userId:string,id:string,kind:string) {
    this.db.prepare("INSERT INTO journey_events VALUES(?,?,?,?)").run(randomUUID(),id,kind,this.clock());
    audit(this.db,userId,`journey.${kind}`,id,this.clock());
  }
  create(userId:string,input:unknown):Journey {
    const data=createSchema.parse(input);
    return this.db.transaction(()=>{
      const previous=this.db.prepare("SELECT id FROM journeys WHERE user_id=? AND idempotency_key=?").get(userId,data.idempotency_key) as {id:string}|undefined;
      if(previous)return this.get(userId,previous.id);
      this.validateEta(data.expected_arrival_at);
      throttle(this.db,userId,"journeys",30,this.clock());
      if(this.db.prepare("SELECT 1 FROM journeys WHERE user_id=? AND status IN ('active','check_in_due','escalated')").get(userId)) throw new AppError(409,"JOURNEY_OPEN","Complete or cancel your open journey before starting another.");
      for(const id of data.contact_ids) if(!this.db.prepare("SELECT 1 FROM contacts WHERE id=? AND user_id=? AND alert_enabled=1").get(id,userId)) throw new AppError(400,"CONTACT_SELECTION","Select only your sharing-enabled contacts.");
      const id=randomUUID(),now=this.clock();
      const loc=data.location && data.location.captured_at>=now-300000 && data.location.captured_at<=now+30000 ? data.location:null;
      this.db.prepare("INSERT INTO journeys(id,user_id,idempotency_key,status,origin,destination,expected_arrival_at,grace_period_minutes,last_known_latitude,last_known_longitude,last_location_accuracy_meters,last_location_updated_at,started_at,created_at,updated_at) VALUES(?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?)").run(id,userId,data.idempotency_key,data.origin||null,data.destination,data.expected_arrival_at,data.grace_period_minutes,loc?.latitude??null,loc?.longitude??null,loc?.accuracy??null,loc?.captured_at??null,now,now,now);
      for(const contactId of data.contact_ids)this.db.prepare("INSERT INTO journey_contacts VALUES(?,?,?)").run(id,contactId,userId);
      this.event(userId,id,"started");
      return this.get(userId,id);
    })();
  }
  transition(userId:string,id:string,action:JourneyAction,input:unknown):Journey {
    if(!(action in allowed))throw new AppError(404,"NOT_FOUND","Journey action not found.");
    const data=action==="check-in"||action==="extend"?etaSchema.parse(input):emptySchema.parse(input);
    return this.db.transaction(()=>{
      const journey=this.get(userId,id);
      if((action==="complete"&&journey.status==="completed")||(action==="cancel"&&journey.status==="cancelled"))return journey;
      if(!allowed[action].includes(journey.status)) throw new AppError(409,"INVALID_TRANSITION","This journey has changed or already ended. Refresh its status.");
      throttle(this.db,userId,"journey-actions",60,this.clock());
      if("expected_arrival_at" in data) {
        const eta=data.expected_arrival_at as number;
        this.validateEta(eta);
        if(action==="extend"&&eta<=journey.expected_arrival_at)throw new AppError(400,"INVALID_ETA","An extension must be later than the current arrival time.");
        this.db.prepare("UPDATE journeys SET status='active',expected_arrival_at=?,updated_at=? WHERE id=? AND user_id=?").run(eta,this.clock(),id,userId);
      } else {
        const column=action==="complete"?"completed_at":"cancelled_at";
        this.db.prepare(`UPDATE journeys SET status=?,${column}=?,updated_at=? WHERE id=? AND user_id=?`).run(action==="complete"?"completed":"cancelled",this.clock(),this.clock(),id,userId);
      }
      this.event(userId,id,action);
      return this.get(userId,id);
    })();
  }
}