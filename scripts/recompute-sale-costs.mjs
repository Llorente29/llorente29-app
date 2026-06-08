import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".env","utf8").split(/\r?\n/).filter(Boolean)
    .map((l)=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];})
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: ae } = await sb.auth.signInWithPassword({
  email: process.env.FOLVY_EMAIL, password: process.env.FOLVY_PASSWORD });
if (ae) { console.error("login:", ae.message); process.exit(1); }
const ACC = "00000000-0000-0000-0000-000000000001";

// Todas las líneas product de la cuenta
const { data: lines, error: le } = await sb
  .from("sale_line").select("id")
  .eq("account_id", ACC).eq("line_type", "product");
if (le) { console.error("list:", le.message); process.exit(1); }
console.log("Líneas product a recalcular:", lines.length);

let ok = 0, conCoste = 0, nul = 0, err = 0;
for (const l of lines) {
  const { data, error } = await sb.rpc("compute_sale_line_cost", { p_sale_line_id: l.id });
  if (error) { err++; continue; }
  ok++;
  if (data === null) nul++; else conCoste++;
}
console.log(`Recalculadas: ${ok} | con coste: ${conCoste} | NULL (falta coste): ${nul} | errores: ${err}`);
