// social-publish — El brazo publicador de RRSS (v1: Instagram) · 05/07/2026
// Publica los social_post APROBADOS por el humano (modo b: la aprobación es la puerta;
// desde ahí, máquina). Instagram Graph API en dos pasos (contenedor → publish), token
// desde el Vault vía social_secret_read (jamás en tablas ni en código).
// Idempotente: claim optimista approved→publishing; attempts<5; errores con mensaje claro.
// El copy ya referencia "link en bio" — en el caption van copy + hashtags (los enlaces
// no son clicables en captions de IG; el UTM vive en la bio/stories y en la publicación
// asistida). Cron cada 15 min ('social-publish-worker') + invocable a mano.
// DESPLIEGUE: --no-verify-jwt (lo llama pg_cron; frontera = x-agent-secret).

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GRAPH = "https://graph.instagram.com/v23.0";

async function igToken(vaultName: string): Promise<string | null> {
  const { data } = await supa.rpc("social_secret_read", { p_name: vaultName });
  return (data as string) ?? null;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  const out: Array<Record<string, unknown>> = [];

  // Posts aprobados de cuentas de Instagram ENLAZADAS, sin programación futura
  const { data: posts } = await supa.from("social_post")
    .select("id, account_id, network, payload, attempts, social_account_id, social_account:social_account_id(link_status, config)")
    .eq("status", "approved").eq("network", "instagram")
    .lt("attempts", 5)
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .order("created_at").limit(5);

  for (const p of posts ?? []) {
    const sa: any = (p as any).social_account;
    if (!sa || sa.link_status !== "linked") { out.push({ id: p.id, skipped: "cuenta no enlazada" }); continue; }
    const igUserId = sa.config?.ig_user_id;
    const vaultName = sa.config?.token_vault_name;
    if (!igUserId || !vaultName) { out.push({ id: p.id, skipped: "config sin ig_user_id/token_vault_name" }); continue; }

    // claim optimista: solo uno se lo lleva
    const { data: claimed } = await supa.from("social_post")
      .update({ status: "publishing", attempts: (p.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", p.id).eq("status", "approved").select("id");
    if (!claimed?.length) continue;

    const fail = async (msg: string) => {
      await supa.from("social_post").update({ status: "error", last_error: msg.slice(0, 400), updated_at: new Date().toISOString() }).eq("id", p.id);
      out.push({ id: p.id, ok: false, error: msg.slice(0, 200) });
    };

    try {
      const token = await igToken(vaultName);
      if (!token) { await fail("token no encontrado en el Vault: " + vaultName); continue; }

      const pl: any = p.payload;
      const caption = [pl.copy, (pl.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
      if (!pl.image_url) { await fail("payload sin image_url"); continue; }

      // Paso 1: contenedor de medios
      const r1 = await fetch(`${GRAPH}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: pl.image_url, caption, access_token: token }),
      });
      const j1 = await r1.json();
      if (!r1.ok || !j1.id) { await fail(`IG media: ${JSON.stringify(j1?.error ?? j1).slice(0, 300)}`); continue; }

      // Paso 2: publicar el contenedor
      const r2 = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: j1.id, access_token: token }),
      });
      const j2 = await r2.json();
      if (!r2.ok || !j2.id) { await fail(`IG publish: ${JSON.stringify(j2?.error ?? j2).slice(0, 300)}`); continue; }

      await supa.from("social_post").update({
        status: "published", external_ref: String(j2.id),
        published_at: new Date().toISOString(), last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      out.push({ id: p.id, ok: true, ig_media_id: j2.id, brand: pl.brand_name });
    } catch (e) {
      await fail(String((e as Error).message));
    }
  }

  return Response.json({ ok: true, processed: out.length, results: out });
});
