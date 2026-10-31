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
//     marca, como mucho uno por minuto, 5 por hora por correo y 20 por hora
//     por conexión (conta_contrasena_pedir, C06b);
//   · la marca tiene que ser de solo contabilidad y con remitente.
//
// Endpoint: POST /functions/v1/conta-contrasena   Body: { correo, marca }
//
// Y el aviso de «contraseña cambiada» (C06, respuesta 2): Body { accion:
// 'cambiada' } con la sesión de quien la acaba de cambiar (Authorization). La
// marca NO la dice quien llama: sale de la cuenta que tiene abierta
// (_cuenta_activa, DM1; accounts.product_brand). Sin
// marca no se manda nada (Foodint y las demás, como hoy). Solo si la contraseña
// se tocó hace menos de 10 minutos. Contesta { avisado, a?, motivo? } para que
// la pantalla diga qué ha pasado (regla 8).
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
    if (b.accion === 'cambiada') return await avisarCambiada(req);
    const correo = String(b.correo ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return json(400, { error: 'Escribe un correo válido.' });
    if (!esIdMarca(b.marca) || !MARCAS[b.marca].soloContabilidad) return json(400, { error: 'Marca desconocida.' });
    const m = MARCAS[b.marca];

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // C06b (respuesta 6, tarea 3): con tope, 5 por hora por correo y 20 por
    // conexión. Se apunta SIEMPRE (exista o no el correo) y, pasado el tope,
    // no se manda nada; la respuesta es la misma y por el mismo camino.
    const { data: filas, error } = await admin.rpc('conta_contrasena_pedir', { p_correo: correo, p_marca: m.id, p_conexion: conexionDe(req) });
    if (error) { console.error('[conta-contrasena] rpc', error.message); return json(200, SIEMPRE); }
    const fila = (filas as { user_id: string; se_puede: boolean }[] | null)?.[0];
    if (!fila || !fila.se_puede) return json(200, SIEMPRE);

    // C06b (respuesta 5, punto 5): el enlace y el correo, en segundo plano.
    // Esperándolos, la respuesta tardaba más cuando el correo existe, y eso
    // decía por el reloj lo que el cuerpo calla. Ahora el que existe y el que
    // no contestan tras la misma consulta.
    await enSegundoPlano(enviarEnlace(admin, supabaseUrl, serviceKey, correo, m));
    return json(200, SIEMPRE);
  } catch (e) {
    console.error('[conta-contrasena]', e);
    return json(200, SIEMPRE);
  }
});

/** La conexión de quien llama: la primera IP de x-forwarded-for (la pone el borde de Supabase), o null. */
function conexionDe(req: Request): string | null {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || (req.headers.get('x-real-ip') ?? '').trim();
  return ip || null;
}

/** El enlace de recuperación con la marca. Los fallos van al registro: quien llama ya tiene su respuesta. */
async function enviarEnlace(admin: ReturnType<typeof createClient>, supabaseUrl: string, serviceKey: string, correo: string, m: (typeof MARCAS)[keyof typeof MARCAS]): Promise<void> {
  try {
    const base = supabaseUrl.includes(PRODUCCION) ? null : (Deno.env.get('APP_BASE_URL_PRUEBAS') ?? null);
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: correo });
    if (linkErr || !link?.properties?.hashed_token) { console.error('[conta-contrasena] link', linkErr?.message); return; }
    const enlace = enlaceDeMarca(m, '/reset-password/confirm', { token_hash: link.properties.hashed_token, type: 'recovery' }, base);
    if (!enlace) { console.error('[conta-contrasena] la marca no tiene dirección'); return; }
    const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`, 'x-internal-key': serviceKey },
      body: JSON.stringify({ to: correo, template: 'contrasena_conta', marca: m.id, data: { enlace } }),
    });
    if (!r.ok) console.error('[conta-contrasena] send-email', r.status, (await r.text().catch(() => '')).slice(0, 300));
  } catch (e) {
    console.error('[conta-contrasena] envío', e);
  }
}

/** Lo que sigue después de contestar (EdgeRuntime.waitUntil). Sin él (fuera de Supabase), se espera: mejor tarde que nunca. */
function enSegundoPlano(p: Promise<void>): Promise<void> | void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(p); return; }
  return p;
}

/** El aviso de «contraseña cambiada», a la propia persona y con la marca de su cuenta. */
async function avisarCambiada(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  const user = u?.user;
  if (uErr || !user?.email) return json(401, { error: 'Sin sesión.' });
  const hace = Date.now() - Date.parse(user.updated_at ?? '');
  if (!(hace >= 0 && hace < 10 * 60_000)) return json(200, { avisado: false, motivo: 'la contraseña no se ha cambiado ahora' });

  // DM1 · PR 1b (30/10): la marca de la empresa ABIERTA (_cuenta_activa, con la
  // sesión de quien llama). Antes era «su perfil» con maybeSingle: con dos
  // empresas fallaba y no avisaba.
  const comoEl = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: abierta, error: aErr } = await comoEl.rpc('_cuenta_activa');
  if (aErr || !abierta) { console.error('[conta-contrasena] cuenta abierta', aErr?.message ?? 'ninguna'); return json(200, { avisado: false, motivo: 'no he podido leer tu cuenta' }); }
  const { data: perfil, error: pErr } = await admin.from('user_profiles')
    .select('account_id, accounts(product_brand)').eq('user_id', user.id).eq('account_id', abierta as string).eq('active', true).maybeSingle();
  if (pErr) { console.error('[conta-contrasena] perfil', pErr.message); return json(200, { avisado: false, motivo: 'no he podido leer tu cuenta' }); }
  const marca = (perfil as { accounts?: { product_brand?: string | null } | null } | null)?.accounts?.product_brand ?? null;
  if (!esIdMarca(marca) || marca === 'folvy') return json(200, { avisado: false, motivo: 'tu cuenta no lleva marca propia' });
  const m = MARCAS[marca];

  const base = supabaseUrl.includes(PRODUCCION) ? null : (Deno.env.get('APP_BASE_URL_PRUEBAS') ?? null);
  const cuando = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`, 'x-internal-key': serviceKey },
    body: JSON.stringify({ to: user.email, template: 'contrasena_cambiada_conta', marca: m.id, data: { cuando, entrar: enlaceDeMarca(m, '/login', {}, base) } }),
  });
  if (r.ok) return json(200, { avisado: true, a: user.email });
  const texto = (await r.text().catch(() => '')).slice(0, 300);
  console.error('[conta-contrasena] aviso', r.status, texto);
  let motivo = 'el correo no ha salido';
  try { const e = JSON.parse(texto) as { error?: string }; if (e.error) motivo = e.error; } catch { /* el texto tal cual no se enseña */ }
  return json(200, { avisado: false, motivo });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
