import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY;
const sb = createClient(url, anon);

const { data: auth, error: aerr } = await sb.auth.signInWithPassword({
  email: process.env.FOLVY_EMAIL, password: process.env.FOLVY_PASSWORD,
});
if (aerr) { console.error("login:", aerr.message); process.exit(1); }
const token = auth.session.access_token;

const ACCOUNT = "00000000-0000-0000-0000-000000000001";
// recipe_item de The Big Napo en Folvy Interno
const { data: dish } = await sb.from("recipe_item").select("id,name").eq("account_id", ACCOUNT).ilike("name", "%big napo%").limit(1).maybeSingle();
console.log("Plato:", dish?.name, dish?.id);

const resp = await fetch(`${url}/functions/v1/propose-modifier-impacts`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ account_id: ACCOUNT, recipe_item_id: dish?.id, dry_run: false }),
});
console.log("HTTP", resp.status);
console.log(JSON.stringify(await resp.json(), null, 2));

