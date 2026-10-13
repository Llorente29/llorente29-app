// ============================================================
// Edge Function: conta-contrasena  (C06 · Contabilidad sola)
//
// «He olvidado la contraseña» desde la entrada de una marca (N18). El correo
// sale con la marca (send-email, plantilla contrasena_conta), no con la
// plantilla del panel de Supabase, que es una sola por proyecto y dice Folvy.
// Con Folvy, la pantalla sigue usando resetPasswordForEmail como siempre: lo
// que reciben Foodint y las demás cuentas no cambia.
//
// verify_jwt = false: quien la llama no tiene sesión (ha olvidado la
// contraseña). Su frontera:
//   · responde SIEMPRE lo mismo, exista o no el correo (no se enumeran correos);
//   · solo manda si el correo es de una persona activa de una cuenta de ESA
//     marca, y como mucho uno por minuto (conta_contrasena_de_marca);
//   · la marca tiene que ser de solo contabilidad y con remitente.
//
// Endpoint: POST /functions/v1/conta-contrasena   Body: { correo, marca }
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { MARCAS, enlaceDeMarca, esIdMarca } from '../_shared/marcas.ts';

const PRODUCCION = 'xzmpnchlguibclvxyynt';
const SIEMPRE = { status: 'ok', mensaje: 'Si ese correo tiene acceso, le llegará un enlace en unos minutos.' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    let b: Record<string, unknown> = {};
    try { b = await req.json(); } catch { b = {}; }
    const correo = String(b.correo ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return json(400, { error: 'Escribe un correo válido.' });
    if (!esIdMarca(b.marca) || !MARCAS[b.marca].soloContabilidad) return json(400, { error: 'Marca desconocida.' });
    const m = MARCAS[b.marca];

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: filas, error } = await admin.rpc('conta_contrasena_de_marca', { p_correo: correo, p_marca: m.id });
    if (error) { console.error('[conta-contrasena] rpc', error.message); return json(200, SIEMPRE); }
    const fila = (filas as { user_id: string; se_puede: boolean }[] | null)?.[0];
    if (!fila || !fila.se_puede) return json(200, SIEMPRE);

    const base = supabaseUrl.includes(PRODUCCION) ? null : (Deno.env.get('APP_BASE_URL_PRUEBAS') ?? null);
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: correo });
    if (linkErr || !link?.properties?.hashed_token) { console.error('[conta-contrasena] link', linkErr?.message); return json(200, SIEMPRE); }
    const enlace = enlaceDeMarca(m, '/reset-password/confirm', { token_hash: link.properties.hashed_token, type: 'recovery' }, base);
    if (!enlace) { console.error('[conta-contrasena] la marca no tiene dirección'); return json(200, SIEMPRE); }

    const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`, 'x-internal-key': serviceKey },
      body: JSON.stringify({ to: correo, template: 'contrasena_conta', marca: m.id, data: { enlace } }),
    });
    if (!r.ok) console.error('[conta-contrasena] send-email', r.status, (await r.text().catch(() => '')).slice(0, 300));
    return json(200, SIEMPRE);
  } catch (e) {
    console.error('[conta-contrasena]', e);
    return json(200, SIEMPRE);
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
