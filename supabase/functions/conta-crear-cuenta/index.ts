// ============================================================
// Edge Function: conta-crear-cuenta  (C06 · Contabilidad sola)
//
// El alta de una cuenta SOLO de contabilidad, desde el panel de plataforma:
// nombre de la empresa, correo del administrador del cliente, marca y por qué.
//
//   1. Quien llama es administrador ACTIVO de la plataforma (se mira en
//      platform_admins con su usuario, no en un claim: staging no tiene el
//      hook de claims). La función de la base lo vuelve a comprobar.
//   2. Si la marca no se puede invitar desde aquí (producción y sin dominio),
//      se para ANTES de crear nada.
//   3. Crea el usuario con una contraseña al azar que nadie conoce (como
//      create-account): el cliente pone la suya en la bienvenida.
//   4. conta_crear_cuenta_sola: cuenta sin Cocina, interruptor `conta` con
//      quién y por qué, y su apunte en platform_audit_log. Si falla, se borra
//      el usuario.
//   5. La invitación con la marca (send-email, plantilla invitacion_conta),
//      con el enlace al dominio de la marca (o, fuera de producción y sin
//      dominio, a APP_BASE_URL_PRUEBAS con ?marca=). Es «lo intento»: la cuenta
//      ya está; la respuesta dice si se mandó y, si no, por qué (regla 8).
//
// Endpoint: POST /functions/v1/conta-crear-cuenta
// Body: { empresa, correo, nombre?, marca, motivo }
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { enlaceDeMarca } from '../_shared/marcas.ts';
import { baseDelEnlace, leerPedido, slugDe } from './pedido.ts';

const PRODUCCION = 'xzmpnchlguibclvxyynt';
const DIAS_ENLACE = 7;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Falta la cabecera Authorization.' });
    const jwt = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // --- 1. Quien llama: administrador activo de la plataforma ---
    const { data: quien, error: quienErr } = await admin.auth.getUser(jwt);
    if (quienErr || !quien.user) return json(401, { error: 'Sesión no válida.' });
    const { data: pa } = await admin.from('platform_admins').select('id').eq('user_id', quien.user.id).eq('active', true).maybeSingle();
    if (!pa) return json(403, { error: 'Solo un administrador de la plataforma da de alta cuentas.' });

    // --- 2. El pedido y la marca ---
    let cuerpo: Record<string, unknown> | null = null;
    try { cuerpo = await req.json(); } catch { cuerpo = null; }
    const leido = leerPedido(cuerpo);
    if (!leido.ok) return json(400, { error: leido.error });
    const p = leido.pedido;
    const esProduccion = supabaseUrl.includes(PRODUCCION);
    const base = baseDelEnlace(p.marca, esProduccion, Deno.env.get('APP_BASE_URL_PRUEBAS') ?? null);
    if (!base.ok) return json(400, { error: base.error });

    // --- 3. El usuario del cliente ---
    const { data: creado, error: creadoErr } = await admin.auth.admin.createUser({
      email: p.correo, password: contrasenaAlAzar(), email_confirm: true,
      user_metadata: p.nombre ? { display_name: p.nombre } : {},
    });
    if (creadoErr || !creado.user) {
      return json(409, { error: `No se pudo crear el usuario ${p.correo}: ${creadoErr?.message ?? 'sin detalle'}` });
    }
    const usuario = creado.user.id;

    // --- 4. La cuenta, sin Cocina ---
    const slug = slugDe(p.empresa, crypto.randomUUID().slice(0, 4));
    const { data: cuenta, error: rpcErr } = await admin.rpc('conta_crear_cuenta_sola', {
      p_nombre: p.empresa, p_slug: slug, p_admin_user_id: usuario, p_admin_nombre: p.nombre ?? '',
      p_marca: p.marca.id, p_motivo: p.motivo, p_creada_por: quien.user.id,
    });
    if (rpcErr) {
      await admin.auth.admin.deleteUser(usuario);
      return json(500, { error: `No se dio de alta la cuenta (el usuario se ha quitado): ${rpcErr.message}` });
    }

    // --- 5. La invitación con la marca ---
    let enviada = false;
    let motivo: string | null = null;
    let enlace: string | null = null;
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: p.correo });
    if (linkErr || !link?.properties?.hashed_token) {
      motivo = `No se pudo generar el enlace: ${linkErr?.message ?? 'sin detalle'}`;
    } else {
      enlace = enlaceDeMarca(p.marca, '/welcome', { token_hash: link.properties.hashed_token, type: 'recovery' }, base.base);
      if (!enlace) {
        motivo = 'La marca no tiene dirección para el enlace.';
      } else {
        const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader, 'x-internal-key': serviceKey },
          body: JSON.stringify({
            to: p.correo, template: 'invitacion_conta', marca: p.marca.id,
            data: { nombre: p.nombre, empresa: p.empresa, enlace, diasCaducidad: DIAS_ENLACE },
          }),
        });
        if (r.ok) enviada = true;
        else motivo = `El correo no salió: ${(await r.text().catch(() => '')).slice(0, 300)}`;
      }
    }

    return json(200, {
      status: 'ok', account_id: cuenta, slug, marca: p.marca.id,
      invitacion_enviada: enviada, motivo,
      // Fuera de producción, el enlace va en la respuesta: la marca de pruebas
      // no tiene remitente y así se puede probar la entrada. En producción, nunca.
      enlace: esProduccion ? null : enlace,
    });
  } catch (e) {
    console.error('[conta-crear-cuenta]', e);
    return json(500, { error: 'Error interno', detail: e instanceof Error ? e.message : String(e) });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function contrasenaAlAzar(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return `Aa1${btoa(String.fromCharCode(...b)).replace(/[^a-zA-Z0-9]/g, '')}`;
}
