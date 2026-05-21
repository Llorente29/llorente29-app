// ============================================================
// Edge Function: create-account
// Porteria Folvy V1 — alta de cuenta cliente (Modalidad 3)
//
// Crea atomicamente: auth.user + cuenta + perfil admin + permisos
// + location + marca + suscripcion + items + audit.
// La parte Postgres va en la RPC create_account_tx (transaccional).
// Esta function orquesta Auth (que vive fuera de Postgres) + RPC.
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
  adminPassword: string;        // contrasena temporal (v1 sin welcome email)
  adminDisplayName: string;
  locationName: string;
  brandName: string;
  brandSlug: string;
  submoduleIds: string[];       // submodulos a activar
  planId: string | null;        // opcional
  status: string;               // 'active' | 'trialing'
}

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

    const required = ['accountName', 'accountSlug', 'adminEmail', 'adminPassword', 'adminDisplayName', 'locationName', 'brandName', 'brandSlug', 'status'];
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

    // --- 6. Crear el auth.user (email confirmado, sin welcome email en v1) ---
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: p.adminEmail,
      password: p.adminPassword,
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

    // --- 9. Exito ---
    return jsonResponse(200, {
      status: 'ok',
      account_id: accountId,
      admin_user_id: newUserId,
      slug: p.accountSlug,
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
