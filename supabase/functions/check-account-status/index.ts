// ============================================================
// Edge Function: check-account-status
// Sprint 2 Bloque A2 — Folvy V1
//
// Invocada por el frontend inmediatamente tras signInWithPassword.
// Decide el redirect post-login basandose en:
//   - JWT claims folvy.* (emitidos por custom_access_token_hook)
//   - Estado real de las cuentas del user en BBDD
//
// Endpoint: POST /functions/v1/check-account-status
// Auth: JWT obligatorio (verify_jwt=true en config.toml)
// Body: {} (no requiere payload, lee del JWT)
//
// Response 200:
//   { status, redirect_to, message }
//
// Response 401: JWT invalido o ausente (Supabase auto-responde)
// Response 500: error interno (raro)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

interface FolvyClaims {
  is_platform_admin: boolean;
  platform_admin_role: string | null;
  current_account_id: string | null;
  current_account_slug: string | null;
  current_account_role: string | null;
  active_accounts: Array<{
    id: string;
    slug: string;
    role: string;
    profile_id: string;
  }>;
  permission_set_id: string | null;
  impersonating: boolean;
  real_user_id: string | null;
  session_max_age: number;
}

interface CheckAccountStatusResponse {
  status:
    | 'ok'
    | 'no_active_profile'
    | 'all_accounts_suspended'
    | 'all_accounts_deleted';
  redirect_to: string | null;
  message: string | null;
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Solo aceptamos POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  try {
    // Extraer JWT del header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }

    const jwt = authHeader.replace('Bearer ', '');

    // Crear cliente Supabase con el JWT del usuario
    // (no usamos service_role: queremos que las queries respeten RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Verificar el JWT y obtener el user
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);

    if (userError || !userData.user) {
      return jsonResponse(401, { error: 'Invalid or expired JWT' });
    }

    // Decodificar claims folvy.* del JWT
    const folvy = decodeFolvyClaims(jwt);

    if (!folvy) {
      return jsonResponse(500, {
        error: 'JWT missing folvy claims (hook not running?)',
      });
    }

    // Resolver decision basada en folvy.*
    const decision = resolveRedirect(folvy);

    return jsonResponse(200, decision);
  } catch (error) {
    console.error('[check-account-status] unexpected error:', error);
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

function decodeFolvyClaims(jwt: string): FolvyClaims | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;

    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson = atob(payloadB64);
    const payload = JSON.parse(payloadJson);

    return payload.folvy ?? null;
  } catch {
    return null;
  }
}

function resolveRedirect(folvy: FolvyClaims): CheckAccountStatusResponse {
  // Caso 1: Platform admin sin profiles activos -> panel admin
  if (folvy.is_platform_admin && folvy.active_accounts.length === 0) {
    return {
      status: 'ok',
      redirect_to: '/_admin/dashboard',
      message: null,
    };
  }

  // Caso 2: Platform admin con profiles -> puede elegir
  if (folvy.is_platform_admin && folvy.active_accounts.length > 0) {
    return {
      status: 'ok',
      redirect_to: '/select-account',
      message: null,
    };
  }

  // Caso 3: User normal con 1 cuenta activa
  if (folvy.active_accounts.length === 1) {
    const account = folvy.active_accounts[0];
    return {
      status: 'ok',
      redirect_to: `/${account.slug}/personal`,
      message: null,
    };
  }

  // Caso 4: User normal con >1 cuenta activa
  if (folvy.active_accounts.length > 1) {
    return {
      status: 'ok',
      redirect_to: '/select-account',
      message: null,
    };
  }

  // Caso 5: User sin profiles activos NI platform admin
  // -> no_active_profile (acceso denegado, signOut implicito)
  return {
    status: 'no_active_profile',
    redirect_to: null,
    message:
      'Tu acceso ha sido desactivado en todas las cuentas. ' +
      'Si crees que es un error, contacta con el administrador.',
  };
}