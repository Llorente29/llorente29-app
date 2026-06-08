import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".env","utf8").split(/\r?\n/).filter(Boolean)
    .map((l)=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];})
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
// últimos tab:closed del log para reproducir uno real
const { data, error } = await sb.from("lastapp_webhook_log")
  .select("payload").eq("note","frontera-tab-closed").order("created_at",{ascending:false}).limit(1);
// si aún no hay con la nota nueva, busca cualquier tab:closed
let payload = data?.[0]?.payload;
if (!payload) {
  const r = await sb.from("lastapp_webhook_log").select("payload").order("created_at",{ascending:false}).limit(50);
  payload = (r.data||[]).map(x=>x.payload).find(p=>p?.type==="tab:closed");
}
if (!payload) { console.log("No hay ningun tab:closed en el log para reproducir"); process.exit(0); }
console.log("Reenviando un tab:closed real al webhook. bill ids:", (payload.data?.bills||[]).map(b=>b.id));
const resp = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/lastapp-webhook`, {
  method:"POST",
  headers:{ "Content-Type":"application/json", "authorization": process.env.LASTAPP_WEBHOOK_TOKEN || "" },
  body: JSON.stringify(payload),
});
console.log("HTTP", resp.status, await resp.text());
