// social-dress — N2 (06/07/2026): Gemini "viste" la imagen.
//   dress → cambia SOLO el entorno; el plato es el REAL, intocable (guarda explícita).
//   mood  → la IA imagina la escena (persona comiendo, calle...); la comida es generada
//           (contenido de marca), con la foto real como referencia de estilo.
// Clave del Vault (google_ai_key vía social_secret_read). Tope server-side (claim_n2_budget):
// si N2 off / tope alcanzado / fallo → devuelve ok:false y el worker cae a N1.
// Frontera x-agent-secret (IMAGE_AGENT_SECRET). DESPLIEGUE: --no-verify-jwt.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("IMAGE_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MODEL = "gemini-2.5-flash-image";
const GENAI = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function readKey(): Promise<string | null> {
  const { data } = await supa.rpc("social_secret_read", { p_name: "google_ai_key" });
  return (data as string) ?? null;
}
async function fetchImageB64(url: string): Promise<{ data: string; mime: string } | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  const mime = r.headers.get("content-type") || "image/jpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { data: btoa(bin), mime };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const accountId: string = body.account_id;
  const imageUrl: string = body.image_url;
  const forceMode: string | undefined = body.mode;   // 'dress'|'mood' opcional (regenerar fondo)
  if (!accountId || !imageUrl) return Response.json({ ok: false, reason: "faltan account_id/image_url" }, { status: 400 });

  // Tope + habilitado (atómico). Si N2 off o tope alcanzado → false → el worker usa N1.
  const { data: canSpend } = await supa.rpc("claim_n2_budget", { p_account_id: accountId });
  if (!canSpend) return Response.json({ ok: false, reason: "n2_off_or_cap" });

  // Modo: forzado (regenerar) o por peso mood de la cuenta.
  let mode: "dress" | "mood" = (forceMode === "mood" || forceMode === "dress") ? forceMode : "dress";
  if (!forceMode) {
    const { data: cfg } = await supa.from("social_config").select("n2_mood_ratio").eq("account_id", accountId).maybeSingle();
    const ratio = (cfg as any)?.n2_mood_ratio ?? 5;
    mode = ratio > 0 && Math.random() < (1 / ratio) ? "mood" : "dress";
  }

  const { data: prompt } = await supa.rpc("pick_social_scene", { p_mode: mode, p_account_id: accountId });
  if (!prompt) return Response.json({ ok: false, reason: `sin escena activa (${mode})` });

  const key = await readKey();
  if (!key) return Response.json({ ok: false, reason: "sin google_ai_key en el Vault" });

  const hero = await fetchImageB64(imageUrl);
  if (!hero) return Response.json({ ok: false, reason: "no se pudo bajar la foto héroe" });

  const guard = mode === "dress"
    ? " Absolutely do not change, redraw, restyle or replace the food itself — keep every detail of the dish identical to the reference. Output one single photorealistic image."
    : " Use the reference only for the style of the food. Output one single photorealistic image.";

  const r = await fetch(`${GENAI}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: hero.mime, data: hero.data } },
        { text: (prompt as string) + guard },
      ] }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ ok: false, reason: "gemini: " + JSON.stringify(j?.error ?? j).slice(0, 300) });

  const parts = j?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
  const out = img?.inlineData ?? img?.inline_data;
  if (!out?.data) return Response.json({ ok: false, reason: "gemini no devolvió imagen" });

  return Response.json({ ok: true, mode, mime: out.mimeType ?? out.mime_type ?? "image/png", image_b64: out.data });
});
