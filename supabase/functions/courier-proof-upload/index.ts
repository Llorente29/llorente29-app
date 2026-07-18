// supabase/functions/courier-proof-upload/index.ts
// Sube la prueba de entrega (foto/firma) del repartidor. Valida por TOKEN del
// courier (no hay sesión) y sube con service_role a un bucket público de solo
// lectura. Frontera: el token + que el pedido sea suyo.
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sb = createClient(url, key);

  let body: { token?: string; sale_id?: string; kind?: string; image_base64?: string };
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid json" }); }
  const { token, sale_id, kind, image_base64 } = body;
  if (!token || !sale_id || !image_base64) return json(400, { ok: false, error: "faltan campos" });
  const proofKind = kind === "signature" ? "signature" : "photo";

  const { data: courier } = await sb.from("courier")
    .select("id, account_id").eq("access_token", token).eq("active", true).maybeSingle();
  if (!courier) return json(401, { ok: false, error: "token no válido" });

  const { data: asg } = await sb.from("delivery_assignment")
    .select("id").eq("sale_id", sale_id).eq("courier_id", courier.id).maybeSingle();
  if (!asg) return json(403, { ok: false, error: "este pedido no es tuyo" });

  const b64 = image_base64.includes(",") ? image_base64.split(",")[1] : image_base64;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length > 5_000_000) return json(413, { ok: false, error: "imagen demasiado grande" });

  const path = `${courier.account_id}/${sale_id}/${proofKind}-${Date.now()}.png`;
  const { error: upErr } = await sb.storage.from("delivery-proof")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (upErr) return json(500, { ok: false, error: upErr.message });

  const { data: pub } = sb.storage.from("delivery-proof").getPublicUrl(path);
  return json(200, { ok: true, url: pub.publicUrl, kind: proofKind });
});