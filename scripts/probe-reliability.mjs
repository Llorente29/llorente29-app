import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".env","utf8").split(/\r?\n/).filter(Boolean)
    .map((l)=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];})
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: auth, error: ae } = await sb.auth.signInWithPassword({
  email: process.env.FOLVY_EMAIL, password: process.env.FOLVY_PASSWORD });
if (ae) { console.error("login:", ae.message); process.exit(1); }
const { data, error } = await sb.rpc("sales_mapping_reliability", {
  p_account_id: "00000000-0000-0000-0000-000000000001" });
if (error) { console.error("rpc:", error.message); process.exit(1); }
console.log(JSON.stringify(data, null, 2));
