// ============================================================
// Edge Function: create-platform-admin
// Portería Folvy — alta de administrador de plataforma (Staff).
//
// Calca create-account: verifica platform_admin por el claim folvy del JWT,
// usa service_role para auth.admin, y separa Auth (aquí) de la parte Postgres
// transaccional (RPC create_platform_admin_tx).
//
// Diferencias de fondo (resueltas):
//   · Autorización fina: además del claim is_platform_admin, la RPC verifica
//     que el creador tiene platform_can_manage_admins (autoritativo en BBDD).
//   · Usuario existente: si el email ya tiene cuenta Auth, se REUTILIZA (no se
//     duplica) y NO se manda welcome (ya tiene acceso). Solo usuarios nuevos
//     reciben el welcome para fijar su password.
//
// Endpoint: POST /functions/v1/create-platform-admin
// Auth: JWT de platform_admin con permiso manage_admins.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

interface CreatePlatformAdminPayload {
  email: string;
  fullName: string;
  role: string;            // 'ceo' | 'senior_admin' | 'admin' | 'support'
}

const WELCOME_LINK_DAYS = 7;
const APP_BASE_URL = 'https://app.folvy.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    // --- 1. Verificar que el llamante es platform_admin (gate rápido) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }
    const jwt = authHeader.replace('Bearer ', '');
    const folvy = decodeFolvyClaims(jwt);
    if (!folvy || folvy.is_platform_admin !== true) {
      return jsonResponse(403, { error: 'Solo platform admins pueden gestionar admins' });
    }

    // --- 2. Parsear y validar payload ---
    let p: CreatePlatformAdminPayload;
    try {
      p = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body JSON inválido' });
    }
    for (const f of ['email', 'fullName', 'role'] as const) {
      if (!p[f]) return jsonResponse(400, { error: `Campo obligatorio ausente: ${f}` });
    }
    if (!['ceo', 'senior_admin', 'admin', 'support'].includes(p.role)) {
      return jsonResponse(400, { error: `Rol inválido: ${p.role}` });
    }

    // --- 3. Cliente service-role (auth.admin + RPC definer) ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // --- 4. Resolver el id del platform_admin que llama (created_by) ---
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) {
      return jsonResponse(401, { error: 'JWT inválido' });
    }
    const callerUserId = userData.user.id;

    // --- 5. Crear o reutilizar el usuario Auth ---
    // Intento de alta con password aleatoria fuerte (nadie la conoce). Si el
    // email ya existe, lo reutilizamos (promoción de un usuario existente).
    let targetUserId: string;
    let isNewUser = false;
    const randomPassword = generateStrongPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: p.email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { display_name: p.fullName },
    });

    if (created?.user) {
      targetUserId = created.user.id;
      isNewUser = true;
    } else {
      // ¿Falló por email ya registrado? Reutilizar el usuario existente.
      const { data: existingId, error: lookupErr } = await admin.rpc('get_auth_user_id_by_email', {
        p_email: p.email,
        p_created_by: callerUserId,
      });
      if (lookupErr) {
        return jsonResponse(403, { error: 'No autorizado o error resolviendo el usuario', detail: lookupErr.message });
      }
      if (!existingId) {
        return jsonResponse(500, { error: 'No se pudo crear el usuario', detail: createErr?.message });
      }
      targetUserId = existingId as string;
      isNewUser = false;
    }

    // --- 6. Parte transaccional: filas de admin + permisos + auditoría ---
    const { data: newAdminId, error: rpcErr } = await admin.rpc('create_platform_admin_tx', {
      p_user_id: targetUserId,
      p_full_name: p.fullName,
      p_role: p.role,
      p_created_by: callerUserId,
    });

    if (rpcErr) {
      // Rollback del usuario SOLO si lo creamos nosotros en este alta.
      if (isNewUser) {
        await admin.auth.admin.deleteUser(targetUserId);
      }
      return jsonResponse(400, {
        error: 'No se pudo dar de alta el admin',
        detail: rpcErr.message,
      });
    }

    // --- 7. WELCOME (best-effort) SOLO para usuarios nuevos ---
    let welcomeSent: boolean | null = null;
    let welcomeError: string | null = null;
    if (isNewUser) {
      welcomeSent = false;
      try {
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: p.email,
          options: { redirectTo: `${APP_BASE_URL}/welcome` },
        });
        if (linkErr || !linkData?.properties?.hashed_token) {
          welcomeError = linkErr?.message ?? 'No se pudo generar el enlace de welcome';
        } else {
          const hashedToken = linkData.properties.hashed_token;
          const activarUrl =
            `${APP_BASE_URL}/welcome?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
          const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader,
              'x-internal-key': serviceKey,
            },
            body: JSON.stringify({
              to: p.email,
              template: 'welcome',
              data: { nombre: p.fullName, activarUrl, diasCaducidad: WELCOME_LINK_DAYS },
            }),
          });
          if (sendRes.ok) {
            welcomeSent = true;
          } else {
            const body = await sendRes.text().catch(() => '');
            welcomeError = `send-email respondió ${sendRes.status}: ${body.slice(0, 200)}`;
          }
        }
      } catch (e) {
        welcomeError = e instanceof Error ? e.message : String(e);
      }
      if (!welcomeSent) {
        console.error('[create-platform-admin] welcome no enviado:', welcomeError);
      }
    }

    // --- 8. Éxito ---
    return jsonResponse(200, {
      status: 'ok',
      admin_id: newAdminId,
      user_id: targetUserId,
      is_new_user: isNewUser,
      welcome_sent: welcomeSent,   // null = usuario existente (no aplica)
      welcome_error: welcomeError,
    });

  } catch (error) {
    console.error('[create-platform-admin] unexpected error:', error);
    return jsonResponse(500, {
      error: 'Internal server error',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// ============================================================
// Helpers (idénticos a create-account)
// ============================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateStrongPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '');
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
