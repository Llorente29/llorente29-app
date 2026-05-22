// ============================================================
// Edge Function: create-account
// Porteria Folvy V1 — alta de cuenta cliente (Modalidad 3)
//
// Crea atomicamente: auth.user + cuenta + perfil admin + permisos
// + location + marca + suscripcion + items + audit.
// La parte Postgres va en la RPC create_account_tx (transaccional).
// Esta function orquesta Auth (que vive fuera de Postgres) + RPC.
//
// ONBOARDING (Ses 18, welcome unica via):
//   El usuario se crea SIN password usable (aleatoria fuerte que nadie conoce).
//   Tras la RPC, se genera un enlace `recovery` (Supabase) y se envia el
//   email de welcome (motor send-email + Resend) para que el cliente ponga
//   su propia password. El cliente NUNCA recibe ni teclea password temporal.
//   El envio del welcome es best-effort: si falla, la cuenta YA esta creada;
//   se devuelve `welcome_sent: false` para que el panel avise/reintente.
//
// Endpoint: POST /functions/v1/create-account
// Auth: JWT de platform_admin obligatorio.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

interface CreateAccountPayload {
  accountName: string;
  accountSlug: string;
  adminEmail: string;
  adminDisplayName: string;
  locationName: string;
  brandName: string;
  brandSlug: string;
  submoduleIds: string[];       // submodulos a activar
  planId: string | null;        // opcional
  status: string;               // 'active' | 'trial'
  // adminPassword: ELIMINADO. El welcome es la unica via de acceso del cliente.
  // Si un cliente antiguo del wizard lo envia, se ignora (ver mas abajo).
}

// Dias de caducidad del enlace de welcome (informativo en el email).
// Supabase controla la caducidad real del recovery token segun config del proyecto.
const WELCOME_LINK_DAYS = 7;

// URL base de la app (produccion). No hay secret APP_URL en el proyecto, asi que
// se fija aqui de forma explicita (no via fallback silencioso). El enlace de
// welcome redirige a `${APP_BASE_URL}/welcome`, ruta ya enrutada en App.tsx.
const APP_BASE_URL = 'https://app.folvy.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    // --- 1. Verificar que el llamante es platform_admin ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }
    const jwt = authHeader.replace('Bearer ', '');
    const folvy = decodeFolvyClaims(jwt);
    if (!folvy || folvy.is_platform_admin !== true) {
      return jsonResponse(403, { error: 'Solo platform admins pueden crear cuentas' });
    }

    // --- 2. Parsear y validar payload ---
    let p: CreateAccountPayload;
    try {
      p = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body JSON invalido' });
    }

    // adminPassword ya NO es obligatorio (welcome unica via). Si llega, se ignora.
    const required = ['accountName', 'accountSlug', 'adminEmail', 'adminDisplayName', 'locationName', 'brandName', 'brandSlug', 'status'];
    for (const f of required) {
      if (!p[f as keyof CreateAccountPayload]) {
        return jsonResponse(400, { error: `Campo obligatorio ausente: ${f}` });
      }
    }
    if (!Array.isArray(p.submoduleIds)) {
      return jsonResponse(400, { error: 'submoduleIds debe ser un array' });
    }

    // --- 3. Cliente con service-role (necesario para auth.admin y RPC definer) ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // --- 4. Resolver el id del platform_admin que llama (para created_by) ---
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) {
      return jsonResponse(401, { error: 'JWT invalido' });
    }
    const callerUserId = userData.user.id;

    // --- 5. Comprobar slug libre (error bonito antes del constraint) ---
    const { data: existing, error: slugErr } = await admin
      .from('accounts')
      .select('id')
      .eq('slug', p.accountSlug)
      .maybeSingle();
    if (slugErr) {
      return jsonResponse(500, { error: 'Error comprobando slug', detail: slugErr.message });
    }
    if (existing) {
      return jsonResponse(409, { error: `El slug "${p.accountSlug}" ya esta en uso` });
    }

    // --- 6. Crear el auth.user con password ALEATORIA fuerte (nadie la conoce) ---
    // email_confirm: true para que el recovery link funcione sin paso de confirmacion.
    // El cliente establecera su password real via welcome (recovery link).
    const randomPassword = generateStrongPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: p.adminEmail,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { display_name: p.adminDisplayName },
    });
    if (createErr || !created.user) {
      return jsonResponse(500, { error: 'No se pudo crear el usuario', detail: createErr?.message });
    }
    const newUserId = created.user.id;

    // --- 7. Llamar a la RPC transaccional ---
    const { data: accountId, error: rpcErr } = await admin.rpc('create_account_tx', {
      p_account_name: p.accountName,
      p_account_slug: p.accountSlug,
      p_admin_user_id: newUserId,
      p_admin_display_name: p.adminDisplayName,
      p_location_name: p.locationName,
      p_brand_name: p.brandName,
      p_brand_slug: p.brandSlug,
      p_submodule_ids: p.submoduleIds,
      p_plan_id: p.planId,
      p_status: p.status,
      p_created_by: callerUserId,
    });

    // --- 8. Si la RPC falla, rollback manual del auth.user ---
    if (rpcErr) {
      await admin.auth.admin.deleteUser(newUserId);
      return jsonResponse(500, {
        error: 'Fallo en la transaccion de alta; usuario revertido',
        detail: rpcErr.message,
      });
    }

    // --- 9. WELCOME (best-effort): generar recovery link + enviar email ---
    // A partir de aqui, la cuenta YA esta creada. Cualquier fallo del welcome
    // NO revierte nada: se reporta para que el panel reintente.
    let welcomeSent = false;
    let welcomeError: string | null = null;
    try {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: p.adminEmail,
        options: { redirectTo: `${APP_BASE_URL}/welcome` },
      });
      if (linkErr || !linkData?.properties?.hashed_token) {
        welcomeError = linkErr?.message ?? 'No se pudo generar el enlace de welcome';
      } else {
        // PKCE: generateLink (admin) NO emite ?code=, emite un hashed_token.
        // Construimos un enlace propio a /welcome?token_hash=...&type=recovery
        // y la WelcomePage lo canjea con verifyOtp({ token_hash, type }).
        const hashedToken = linkData.properties.hashed_token;
        const activarUrl =
          `${APP_BASE_URL}/welcome?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
        // Llamada function-to-function a send-email con service-role.
        // send-email acepta la service-role key como vIa interna (ver su index.ts).
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // El gateway de Supabase valida el header Authorization como JWT.
            // Mandamos un JWT valido ahi (el del admin que llama) para pasar el
            // gateway, y la service-role en cabecera propia para la via interna.
            'Authorization': authHeader,
            'x-internal-key': serviceKey,
          },
          body: JSON.stringify({
            to: p.adminEmail,
            template: 'welcome',
            data: {
              nombre: p.adminDisplayName,
              activarUrl,
              diasCaducidad: WELCOME_LINK_DAYS,
            },
          }),
        });
        if (sendRes.ok) {
          welcomeSent = true;
        } else {
          const body = await sendRes.text().catch(() => '');
          welcomeError = `send-email respondio ${sendRes.status}: ${body.slice(0, 200)}`;
        }
      }
    } catch (e) {
      welcomeError = e instanceof Error ? e.message : String(e);
    }
    if (!welcomeSent) {
      console.error('[create-account] welcome no enviado:', welcomeError);
    }

    // --- 10. Exito (la cuenta esta creada aunque el welcome haya fallado) ---
    return jsonResponse(200, {
      status: 'ok',
      account_id: accountId,
      admin_user_id: newUserId,
      slug: p.accountSlug,
      welcome_sent: welcomeSent,
      welcome_error: welcomeError,
    });

  } catch (error) {
    console.error('[create-account] unexpected error:', error);
    return jsonResponse(500, {
      error: 'Internal server error',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// ============================================================
// Helpers
// ============================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Password aleatoria fuerte (cumple D-S2.14: minuscula+mayuscula+digito, min 8).
// Nadie la conoce: el cliente pone la suya via welcome. ~28 chars base64url.
function generateStrongPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let b64 = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '');
  // Garantizar que cumple la policy aunque el azar quite ciertos tipos.
  return `Aa1${b64}`;
}

interface FolvyClaims {
  is_platform_admin: boolean;
  [key: string]: unknown;
}

function decodeFolvyClaims(jwt: string): FolvyClaims | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64));
    return payload.folvy ?? null;
  } catch {
    return null;
  }
}
