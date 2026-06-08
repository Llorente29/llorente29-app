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
const { data: loc, error: le } = await sb.from("lastapp_location_map")
  .select("lastapp_location_id")
  .eq("account_id","00000000-0000-0000-0000-000000000001").limit(1).maybeSingle();
if (le) { console.error("loc:", le.message); process.exit(1); }
if (!loc) { console.log("No hay location mapeada"); process.exit(1); }
const billId = "TEST-" + Date.now();
const payload = {
  type: "tab:closed",
  data: {
    id: "tab-"+billId,
    locationId: loc.lastapp_location_id,
    source: "glovo", pickupType: "delivery", closeTime: new Date().toISOString(),
    products: [
      { name: "Alitas Crispy Spicy", quantity: 2, price: 1190,
        catalogProductId: "925deb41-a758-4535-8c36-6c8bf1847d3d",
        organizationProductId: "15fcac38-5ca1-4810-b43b-99017be08ba4" }
    ],
    bills: [
      { id: billId, total: 2380, deliveryFee: 0, discountTotal: 0,
        tax: 216, taxableBase: 2164, creationTime: new Date().toISOString(),
        payments: [{ type: "glovo" }] }
    ]
  }
};
console.log("Enviando tab:closed sintetico, bill:", billId);
const resp = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/lastapp-webhook`, {
  method:"POST",
  headers:{ "Content-Type":"application/json", "authorization": process.env.LASTAPP_WEBHOOK_TOKEN || "" },
  body: JSON.stringify(payload),
});
console.log("HTTP", resp.status, await resp.text());
const { data: sale } = await sb.from("sale").select("id, brand_id, total, channel_id")
  .eq("external_ref", billId).maybeSingle();
console.log("SALE:", JSON.stringify(sale));
if (sale) {
  const { data: lines } = await sb.from("sale_line")
    .select("line_type, product_name, menu_item_id, computed_cost, map_source")
    .eq("sale_id", sale.id);
  console.log("LINEAS:", JSON.stringify(lines, null, 2));
}
