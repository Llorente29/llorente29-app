// supabase/functions/manage-employee/index.ts
// Edge Function: gestiona el ciclo de vida del empleado-con-cuenta.
// Acciones: create, deactivate, reactivate.
//
// El frontend llama así (autenticado con sesión de admin):
//   POST /functions/v1/manage-employee
//   Body: { action: 'create', employee: {...} }
//
// IMPORTANTE: solo admins pueden invocar esta función.
// La verificación se hace consultando user_profiles del caller.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Action = "create" | "deactivate" | "reactivate" | "delete_permanent";

interface EmployeeData {
  name: string;
  email: string;
  dni?: string;
  phone?: string;
  position?: string;
  department?: string;
  contractType?: string;
  locationId?: string;
  assignedLocations?: string[];
  weeklyHours?: number;
  salary?: number;
  startDate?: string;
  endDate?: string;
  pin?: string;
  birthDate?: string;
  trialPeriodDays?: number;
}

interface Payload {
  action: Action;
  employee?: EmployeeData;
  employeeId?: string;
  newEmail?: string;
  sendMagicLink?: boolean; // si es create, enviar email automáticamente
}

// ────────────────────────────────────────
// CORS helpers
// ────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

// ────────────────────────────────────────
// Main handler
// ────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // 1) Variables de entorno
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return errorResponse("Server misconfigured: missing env vars", 500);
  }

  // 2) Verificar autenticación del caller (debe ser admin)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Missing Authorization header", 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerUser) return errorResponse("Invalid session", 401);

  // 3) Verificar que el caller es admin
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerProfile, error: profileErr } = await adminClient
    .from("user_profiles")
    .select("role, active")
    .eq("user_id", callerUser.id)
    .eq("active", true)
    .maybeSingle();

  if (profileErr) return errorResponse(`Profile fetch error: ${profileErr.message}`, 500);
  if (!callerProfile || callerProfile.role !== "admin") {
    return errorResponse("Forbidden: only admins can manage employees", 403);
  }

  // 4) Parsear payload
  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // 5) Routing por acción
  switch (payload.action) {
    case "create":
      return await handleCreate(adminClient, payload, callerUser.id);
    case "deactivate":
      return await handleDeactivate(adminClient, payload, callerUser.id);
    case "reactivate":
      return await handleReactivate(adminClient, payload, callerUser.id);
    case "delete_permanent":
      return await handleDeletePermanent(adminClient, payload, callerUser.id);
    default:
      return errorResponse(`Unknown action: ${payload.action}`, 400);
  }
});

// ────────────────────────────────────────
// ACCIÓN: CREATE
// Crea empleado + auth.user + user_profile + envía Magic Link
// IDEMPOTENTE: si ya existe auth.user con ese email, lo reutiliza.
//              si ya existe user_profile vinculado, devuelve el employee existente.
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleCreate(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employee) return errorResponse("Missing employee data", 400);
  const emp = payload.employee;

  if (!emp.name?.trim()) return errorResponse("Employee name is required", 400);
  if (!emp.email?.trim() || !emp.email.includes("@")) {
    return errorResponse("Valid email is required", 400);
  }

  const email = emp.email.trim().toLowerCase();

  // 1) Comprobar que no existe ya un auth.user con ese email
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existingAuth = existingUsers?.users?.find((u: { email?: string }) => u.email === email);

  let authUserId: string;
  let authWasCreated = false;

  if (existingAuth) {
    // Si ya existe, reutilizamos su id
    authUserId = existingAuth.id;
  } else {
    // 2) Crear cuenta en auth.users
    const { data: newAuth, error: authErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true, // auto-confirmar
      user_metadata: { display_name: emp.name },
    });

    if (authErr || !newAuth?.user) {
      return errorResponse(`Auth user creation failed: ${authErr?.message || "unknown"}`, 500);
    }
    authUserId = newAuth.user.id;
    authWasCreated = true;
  }

  // 3) Verificar si ya hay un user_profile vinculado a este auth_user
  const { data: existingProfile } = await admin
    .from("user_profiles")
    .select("id, employee_id, active")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (existingProfile?.employee_id) {
    // YA está vinculado a un empleado → devolver el empleado existente
    const { data: existingEmployee } = await admin
      .from("employees")
      .select("*")
      .eq("id", existingProfile.employee_id)
      .maybeSingle();

    if (existingEmployee) {
      return jsonResponse({
        ok: true,
        employee: existingEmployee,
        authUserId,
        magicLinkSent: false,
        message: "Empleado ya existía con esta cuenta. No se ha creado nada nuevo.",
        alreadyExisted: true,
      });
    }
  }

  // 4) Crear empleado en tabla employees
  const employeeRow: Record<string, unknown> = {
    name: emp.name,
    email,
    dni: emp.dni || null,
    phone: emp.phone || null,
    position: emp.position || null,
    department: emp.department || null,
    contract_type: emp.contractType || null,
    location_id: emp.locationId || null,
    assigned_locations: emp.assignedLocations || null,
    weekly_hours: emp.weeklyHours || null,
    salary: emp.salary || null,
    start_date: emp.startDate || null,
    end_date: emp.endDate || null,
    pin: emp.pin || null,
    birth_date: emp.birthDate || null,
    trial_period_days: emp.trialPeriodDays || null,
    active: true,
  };

  const { data: newEmployee, error: empErr } = await admin
    .from("employees")
    .insert(employeeRow)
    .select()
    .single();

  if (empErr || !newEmployee) {
    // Rollback: si creamos auth nuevo y falla employee, eliminar el auth para dejar BD limpia
    if (authWasCreated) {
      await admin.auth.admin.deleteUser(authUserId);
    }
    return errorResponse(`Employee insert failed: ${empErr?.message || "unknown"}`, 500);
  }

  // 5) Crear o actualizar user_profile
  if (existingProfile) {
    // El profile existía pero sin employee_id → actualizarlo para vincularlo al nuevo employee
    const { error: profileUpdErr } = await admin
      .from("user_profiles")
      .update({
        employee_id: newEmployee.id,
        role: "worker",
        active: true,
        display_name: emp.name,
      })
      .eq("id", existingProfile.id);

    if (profileUpdErr) {
      return errorResponse(`Profile update failed: ${profileUpdErr.message}`, 500);
    }
  } else {
    // No había profile → crearlo
    const { error: profileInsertErr } = await admin.from("user_profiles").insert({
      user_id: authUserId,
      employee_id: newEmployee.id,
      role: "worker",
      active: true,
      display_name: emp.name,
    });

    if (profileInsertErr) {
      // Rollback employee si falla el profile
      await admin.from("employees").delete().eq("id", newEmployee.id);
      if (authWasCreated) {
        await admin.auth.admin.deleteUser(authUserId);
      }
      return errorResponse(`Profile insert failed: ${profileInsertErr.message}`, 500);
    }
  }

  // 6) Enviar email de bienvenida (si se solicitó)
  // Estrategia: generar el Magic Link con Supabase y enviarlo nosotros vía Resend API.
  // Esto garantiza que pasa por nuestro SMTP profesional (Resend) y se ve en sus logs.
  let magicLinkSent = false;
  if (payload.sendMagicLink !== false) {
    try {
      // 6a) Generar el link sin enviarlo (Supabase devuelve la URL)
      // Usamos siempre 'magiclink' (funciona para usuarios nuevos y existentes).
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      if (linkErr || !linkData?.properties?.action_link) {
        console.error("generateLink error:", linkErr?.message || "no action_link");
      } else {
        const actionLink = linkData.properties.action_link;

        // 6b) Enviar email vía Resend API directamente
        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        if (!RESEND_API_KEY) {
          console.error("RESEND_API_KEY not configured");
        } else {
          const emailHtml = buildWelcomeEmail(emp.name, actionLink);
          const resendResp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Foodint <noreply@foodint.es>",
              to: [email],
              subject: "🍽️ Bienvenido a Foodint - Activa tu cuenta",
              html: emailHtml,
            }),
          });

          if (resendResp.ok) {
            magicLinkSent = true;
          } else {
            const errorText = await resendResp.text();
            console.error("Resend API error:", resendResp.status, errorText);
          }
        }
      }
    } catch (e) {
      console.error("Email send exception:", e);
    }
  }

  // 7) Audit log
  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: authUserId,
    action: "employee_created",
    details: {
      employee_id: newEmployee.id,
      employee_name: emp.name,
      email,
      magic_link_sent: magicLinkSent,
      auth_was_created: authWasCreated,
    },
  });

  return jsonResponse({
    ok: true,
    employee: newEmployee,
    authUserId,
    magicLinkSent,
  });
}

// ────────────────────────────────────────
// ACCIÓN: DEACTIVATE
// Marca empleado y user_profile como inactivos.
// NO borra el auth.user (queda en BD pero con profile inactivo no entra).
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleDeactivate(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);

  // 1) Marcar empleado inactivo
  const { error: empErr } = await admin
    .from("employees")
    .update({ active: false })
    .eq("id", payload.employeeId);

  if (empErr) return errorResponse(`Employee update failed: ${empErr.message}`, 500);

  // 2) Marcar user_profile inactivo (si existe)
  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("employee_id", payload.employeeId)
    .maybeSingle();

  if (profile) {
    await admin
      .from("user_profiles")
      .update({ active: false })
      .eq("employee_id", payload.employeeId);
  }

  // 3) Audit
  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: profile?.user_id || null,
    action: "employee_deactivated",
    details: { employee_id: payload.employeeId },
  });

  return jsonResponse({ ok: true, employeeId: payload.employeeId });
}

// ────────────────────────────────────────
// ACCIÓN: REACTIVATE
// Reactiva empleado, user_profile y envía email avisando.
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleReactivate(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);

  // 1) Reactivar empleado
  const { data: updatedEmp, error: empErr } = await admin
    .from("employees")
    .update({ active: true })
    .eq("id", payload.employeeId)
    .select()
    .single();

  if (empErr) return errorResponse(`Employee update failed: ${empErr.message}`, 500);

  // 2) Reactivar user_profile
  await admin
    .from("user_profiles")
    .update({ active: true })
    .eq("employee_id", payload.employeeId);

  // 3) Conseguir email y user_id para enviar mail
  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("employee_id", payload.employeeId)
    .maybeSingle();

  let emailSent = false;
  let userEmail: string | undefined;

  if (profile?.user_id) {
    // Conseguir email del auth.users
    const { data: userData } = await admin.auth.admin.getUserById(profile.user_id);
    userEmail = userData?.user?.email;

    if (userEmail && payload.sendMagicLink !== false) {
      try {
        // Generar Magic Link
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: userEmail,
        });

        if (linkErr || !linkData?.properties?.action_link) {
          console.error("Reactivate generateLink error:", linkErr?.message || "no link");
        } else {
          const actionLink = linkData.properties.action_link;
          const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

          if (RESEND_API_KEY) {
            const emailHtml = buildReactivationEmail(updatedEmp?.name || "compañero/a", actionLink);
            const resendResp = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "Foodint <noreply@foodint.es>",
                to: [userEmail],
                subject: "🍽️ Tu cuenta de Foodint está reactivada",
                html: emailHtml,
              }),
            });
            emailSent = resendResp.ok;
            if (!resendResp.ok) {
              const errText = await resendResp.text();
              console.error("Reactivate Resend error:", resendResp.status, errText);
            }
          }
        }
      } catch (e) {
        console.error("Reactivate email exception:", e);
      }
    }
  }

  // 4) Audit log
  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: profile?.user_id || null,
    action: "employee_reactivated",
    details: {
      employee_id: payload.employeeId,
      email_sent: emailSent,
      email: userEmail || null,
    },
  });

  return jsonResponse({
    ok: true,
    employeeId: payload.employeeId,
    emailSent,
  });
}

// ────────────────────────────────────────
// ACCIÓN: DELETE_PERMANENT
// Elimina TODO el rastro del empleado:
// - employees (mediante CASCADE borra clockEntries, vacations, docs, etc.)
// - user_profiles
// - manager_locations
// - manager_permissions
// - auth.users (libera el email)
//
// Es IRREVERSIBLE. La UI debe haber confirmado dos veces.
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleDeletePermanent(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);

  // 1) Obtener datos antes de borrar (para audit log)
  const { data: employee } = await admin
    .from("employees")
    .select("name, email")
    .eq("id", payload.employeeId)
    .maybeSingle();

  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, user_id")
    .eq("employee_id", payload.employeeId)
    .maybeSingle();

  const auth_user_id = profile?.user_id || null;
  const user_profile_id = profile?.id || null;

  // 2) Borrar manager_permissions si existe (depende de user_profile_id)
  if (user_profile_id) {
    await admin
      .from("manager_permissions")
      .delete()
      .eq("user_profile_id", user_profile_id);
  }

  // 3) Borrar manager_locations si existe (depende de user_profile_id)
  if (user_profile_id) {
    await admin
      .from("manager_locations")
      .delete()
      .eq("user_profile_id", user_profile_id);
  }

  // 4) Borrar user_profile si existe
  if (user_profile_id) {
    await admin
      .from("user_profiles")
      .delete()
      .eq("id", user_profile_id);
  }

  // 5) Borrar empleado (con todo lo que depende de él vía CASCADE)
  const { error: empErr } = await admin
    .from("employees")
    .delete()
    .eq("id", payload.employeeId);

  if (empErr) {
    return errorResponse(`Employee delete failed: ${empErr.message}`, 500);
  }

  // 6) Borrar auth.users si existía y nadie más lo usa
  // Verificar que no haya otro user_profile usándolo (no debería pero por si acaso)
  if (auth_user_id) {
    const { data: otherProfiles } = await admin
      .from("user_profiles")
      .select("id")
      .eq("user_id", auth_user_id)
      .limit(1);

    if (!otherProfiles || otherProfiles.length === 0) {
      // Nadie más usa esa cuenta auth, la borramos
      const { error: authErr } = await admin.auth.admin.deleteUser(auth_user_id);
      if (authErr) {
        console.error("Auth delete error:", authErr);
        // No fallar la operación entera; el empleado ya está borrado
      }
    }
  }

  // 7) Audit log
  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: auth_user_id,
    action: "employee_deleted_permanently",
    details: {
      employee_id: payload.employeeId,
      employee_name: employee?.name || null,
      employee_email: employee?.email || null,
      auth_user_deleted: !!auth_user_id,
    },
  });

  return jsonResponse({
    ok: true,
    employeeId: payload.employeeId,
    authUserDeleted: !!auth_user_id,
  });
}

// ────────────────────────────────────────
// Plantilla de email de bienvenida (HTML con branding Foodint)
// ────────────────────────────────────────
function buildWelcomeEmail(employeeName: string, actionLink: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F5E9D9;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 480px;
      margin: 40px auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(124, 26, 26, 0.1);
    }
    .header {
      background: #7C1A1A;
      color: white;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-family: Georgia, serif;
      font-size: 32px;
      letter-spacing: 1px;
    }
    .content {
      padding: 32px 24px;
    }
    .content p {
      color: #333;
      line-height: 1.6;
      margin: 0 0 16px 0;
    }
    .button {
      display: inline-block;
      background: #7C1A1A;
      color: white !important;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
    }
    .footer {
      background: #f9f4ec;
      padding: 16px 24px;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    .small {
      font-size: 12px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Foodint</h1>
    </div>
    <div class="content">
      <p>¡Hola ${employeeName}!</p>
      <p>Te damos la bienvenida al equipo de Foodint. Pulsa el botón para activar tu cuenta y entrar a la app:</p>
      <p style="text-align: center;">
        <a href="${actionLink}" class="button">Entrar a Foodint</a>
      </p>
      <p class="small">Si tienes problemas con el botón, copia y pega este enlace en tu navegador:</p>
      <p class="small" style="word-break: break-all;">${actionLink}</p>
      <p class="small" style="margin-top: 24px;">Si no esperabas este email, ignóralo sin problema.</p>
    </div>
    <div class="footer">
      Foodint · App del equipo
    </div>
  </div>
</body>
</html>`;
}

// ────────────────────────────────────────
// Plantilla de email de REACTIVACIÓN
// ────────────────────────────────────────
function buildReactivationEmail(employeeName: string, actionLink: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F5E9D9;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 480px;
      margin: 40px auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(124, 26, 26, 0.1);
    }
    .header {
      background: #7C1A1A;
      color: white;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-family: Georgia, serif;
      font-size: 32px;
      letter-spacing: 1px;
    }
    .content {
      padding: 32px 24px;
    }
    .content p {
      color: #333;
      line-height: 1.6;
      margin: 0 0 16px 0;
    }
    .button {
      display: inline-block;
      background: #7C1A1A;
      color: white !important;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
    }
    .footer {
      background: #f9f4ec;
      padding: 16px 24px;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    .small {
      font-size: 12px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Foodint</h1>
    </div>
    <div class="content">
      <p>¡Hola ${employeeName}!</p>
      <p>Te damos la bienvenida de nuevo al equipo. Tu cuenta de Foodint ha sido <strong>reactivada</strong>.</p>
      <p>Pulsa el botón para entrar a la app:</p>
      <p style="text-align: center;">
        <a href="${actionLink}" class="button">Entrar a Foodint</a>
      </p>
      <p class="small">Si no esperabas este email, contacta con tu administrador.</p>
    </div>
    <div class="footer">
      Foodint · App del equipo
    </div>
  </div>
</body>
</html>`;
}
