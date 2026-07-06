// social-image-sink — Recibe la imagen compuesta, la sube al bucket y parchea el post.
// Body JSON: { post_id, account_id, image_base64 }.
// Sube a social-media/{account_id}/{post_id}.jpg (service_role), obtiene la URL pública
// (con cache-buster) y llama a finish_image_job → image_url = compuesta, image_level = 'N1'.
// Si falla la subida, marca fail_image_job para no dejar el post colgado en 'N1-procesando'.
// Frontera = x-agent-secret (OFFERS_AGENT_SECRET). DESPLIEGUE: --no-verify-jwt.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  try {
    const { post_id, account_id, image_base64 } = await req.json();
    if (!post_id || !account_id || !image_base64)
      return Response.json({ ok: false, error: "faltan campos (post_id, account_id, image_base64)" }, { status: 400 });

    const bytes = b64ToBytes(image_base64);
    const path = `${account_id}/${post_id}.jpg`;

    const up = await supa.storage.from("social-media").upload(path, bytes, {
      contentType: "image/jpeg", upsert: true,
    });
    if (up.error) {
      await supa.rpc("fail_image_job", { p_post_id: post_id, p_err: "upload: " + up.error.message });
      return Response.json({ ok: false, error: up.error.message }, { status: 500 });
    }

    const { data: pub } = supa.storage.from("social-media").getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`; // cache-buster: si se recompone, Meta no cachea la vieja

    const { error: fe } = await supa.rpc("finish_image_job", { p_post_id: post_id, p_public_url: url });
    if (fe) return Response.json({ ok: false, error: fe.message }, { status: 500 });

    return Response.json({ ok: true, url });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
});
