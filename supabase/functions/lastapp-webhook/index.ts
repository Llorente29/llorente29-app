// supabase/functions/lastapp-webhook/index.ts
// FASE 1: receptor de webhooks de Last.app. Solo registra el payload crudo
// en lastapp_webhook_log para inspeccionar qué manda Last (bill:created, etc).
// La lógica de escritura en sale/sale_line se añade en fase 2.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Capturar headers y body crudos
  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  let payload: unknown = null;
  let rawText = "";
  try {
    rawText = await req.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = { _unparsed: rawText };
  }

  // Guardar en log con service-role (la tabla tiene RLS)
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await sb.from("lastapp_webhook_log").insert({
      headers,
      payload,
      note: "fase1-receptor",
    });
  } catch (e) {
    // No fallar el webhook por un error de log; Last reintentaría si devolvemos error
    console.error("log insert error", e);
  }

  // Responder 200 siempre para que Last considere el evento entregado
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
