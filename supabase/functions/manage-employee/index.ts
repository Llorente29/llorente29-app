// supabase/functions/manage-employee/index.ts
// Edge Function: gestiona el ciclo de vida del empleado-con-cuenta.
// Acciones: create, deactivate, reactivate, delete_permanent.
//
// MODELO C1 (sesión 25/05/2026): el trabajador accede con USUARIO + CONTRASEÑA
// PREFIJADA. NO usa email real ni magic link. Internamente se crea un auth.user
// con email SINTÉTICO {username}@empleado.folvy.app que el trabajador nunca ve.
// El login traduce el username a ese email sintético antes de signInWithPassword.
//
// El frontend llama así (autenticado con sesión de admin):
//   POST /functions/v1/manage-employee
//   Body create: { action: 'create', employee: { name, username, password, ... } }
//
// IMPORTANTE: solo admins pueden invocar esta función.
// La verificación se hace consultando user_profiles del caller.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Action = "create" | "deactivate" | "reactivate" | "delete_permanent" | "set_password";

// Dominio sintético interno. NO necesita estar verificado en Resend: nunca se
// envía correo a estas direcciones; son sólo el identificador en auth.users.
const SYNTHETIC_EMAIL_DOMAIN = "empleado.folvy.app";

interface EmployeeData {
  name: string;
  username: string; // C1: identificador de login (sin @). Requerido en create.
  password: string; // C1: contraseña prefijada elegida por el manager. Requerida en create.
  dni?: string;
  phone?: string;
  email?: string; // OPCIONAL e informativo (notificaciones futuras). NO es la llave de acceso.
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
  role?: "worker" | "manager"; // C1: rol del user_profile. Por defecto "worker". NUNCA admin desde el alta.
}

interface Payload {
  action: Action;
  employee?: EmployeeData;
  employeeId?: string;
  password?: string;
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
// Username helpers (C1)
// ────────────────────────────────────────

// Normaliza un username: minúsculas, sin tildes/diacríticos, sólo [a-z0-9._].
// El cliente DEBERÍA enviarlo ya normalizado; aquí re-normalizamos fail-safe.
function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita diacríticos
    .replace(/[^a-z0-9._]/g, "") // sólo letras, dígitos, punto, guion bajo
    .replace(/\.{2,}/g, ".") // colapsa puntos repetidos
    .replace(/^[._]+|[._]+$/g, ""); // sin separadores al inicio/fin
}

function syntheticEmailFor(username: string): string {
  return `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
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

  // 3) Verificar que el caller es admin (verificación real con service_role).
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerProfile, error: profileErr } = await adminClient
    .from("user_profiles")
    .select("role, active, account_id")
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
      return await handleCreate(adminClient, payload, callerUser.id, callerProfile.account_id);
    case "deactivate":
      return await handleDeactivate(adminClient, payload, callerUser.id);
    case "reactivate":
      return await handleReactivate(adminClient, payload, callerUser.id);
    case "delete_permanent":
      return await handleDeletePermanent(adminClient, payload, callerUser.id);
    case "set_password":
      return await handleSetPassword(adminClient, payload, callerUser.id);
    default:
      return errorResponse(`Unknown action: ${payload.action}`, 400);
  }
});

// ────────────────────────────────────────
// ACCIÓN: CREATE (modelo C1)
// Crea empleado + auth.user (email sintético + password prefijada) + user_profile.
// El user_profile se marca welcome_completed_at + terms_accepted_at (el manager
// acepta T&C en nombre del trabajador), de modo que App.tsx NO fuerza /welcome.
// IDEMPOTENTE: si ya existe auth.user con el email sintético, se rechaza como
// username duplicado (no se reutiliza silenciosamente: en C1 el username es la
// identidad y reusarlo escondería un error del manager).
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleCreate(admin: any, payload: Payload, actorUserId: string, callerAccountId: string | null): Promise<Response> {
  if (!payload.employee) return errorResponse("Missing employee data", 400);
  const emp = payload.employee;

  if (!emp.name?.trim()) return errorResponse("El nombre del empleado es obligatorio", 400);

  if (!callerAccountId) {
    return errorResponse("El administrador no tiene cuenta asignada (estado inconsistente). No se puede crear el trabajador.", 500);
  }

  // C1: validar username y password.
  const username = normalizeUsername(emp.username || "");
  if (username.length < 3) {
    return errorResponse("El usuario debe tener al menos 3 caracteres válidos (a-z, 0-9, . _)", 400);
  }
  if (!emp.password || emp.password.length < 6) {
    return errorResponse("La contraseña debe tener al menos 6 caracteres", 400);
  }

  const syntheticEmail = syntheticEmailFor(username);

  // 1) Comprobar unicidad del username a nivel de tabla employees (índice único parcial).
  const { data: existingByUsername } = await admin
    .from("employees")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existingByUsername) {
    return errorResponse(`El usuario "${username}" ya está en uso. Elige otro.`, 409);
  }

  // 2) Comprobar que no exista ya un auth.user con ese email sintético (consistencia).
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existingAuth = existingUsers?.users?.find(
    (u: { email?: string }) => u.email === syntheticEmail,
  );
  if (existingAuth) {
    // No reutilizamos: en C1 el email sintético deriva del username, que ya hemos
    // verificado libre en employees. Si llega aquí, hay un huérfano en auth → error claro.
    return errorResponse(
      `Conflicto: ya existe una cuenta para el usuario "${username}". Contacta con soporte.`,
      409,
    );
  }

  // 3) Crear cuenta en auth.users CON password prefijada y email sintético confirmado.
  const { data: newAuth, error: authErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: emp.password,
    email_confirm: true, // auto-confirma: no hay verificación de email en C1
    user_metadata: { display_name: emp.name, login_username: username },
  });

  if (authErr || !newAuth?.user) {
    return errorResponse(`Auth user creation failed: ${authErr?.message || "unknown"}`, 500);
  }
  const authUserId: string = newAuth.user.id;

  // 4) Crear empleado en tabla employees (incluye username; email REAL opcional/informativo).
  const employeeRow: Record<string, unknown> = {
    name: emp.name,
    username, // C1: identidad de login
    email: emp.email?.trim().toLowerCase() || null, // informativo, NO llave de acceso
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
    // Rollback: borrar el auth.user recién creado para no dejar huérfanos.
    await admin.auth.admin.deleteUser(authUserId);
    return errorResponse(`Employee insert failed: ${empErr?.message || "unknown"}`, 500);
  }

  // 5) Crear user_profile y welcome+terms YA marcados (C1: sin /welcome).
  //    El constraint user_profiles_welcome_requires_terms exige terms <= welcome.
  //
  //    SEGURIDAD — lista blanca estricta del rol: el alta SOLO puede crear
  //    "worker" o "manager". Cualquier otro valor (incluido "admin" o undefined)
  //    cae a "worker" por defecto. Esto cierra el riesgo de escalada a admin
  //    desde el cliente: un admin existente puede crear encargados/trabajadores,
  //    pero NUNCA otro admin a través de esta Edge Function. La creación de
  //    admins se hace por otra vía (portería / SQL directo), fuera del alcance
  //    de manage-employee.
  const requestedRole = emp.role === "manager" ? "manager" : "worker";
  const nowIso = new Date().toISOString();
  const { error: profileInsertErr } = await admin.from("user_profiles").insert({
    user_id: authUserId,
    account_id: callerAccountId, // hereda la cuenta del admin que invoca (necesario para checkAccountStatus)
    employee_id: newEmployee.id,
    role: requestedRole,
    active: true,
    display_name: emp.name,
    terms_accepted_at: nowIso, // el manager acepta T&C en nombre del trabajador (R4)
    welcome_completed_at: nowIso, // sin pantalla de welcome en C1
  });

  if (profileInsertErr) {
    // Rollback en cascada: borrar employee y auth.user.
    await admin.from("employees").delete().eq("id", newEmployee.id);
    await admin.auth.admin.deleteUser(authUserId);
    return errorResponse(`Profile insert failed: ${profileInsertErr.message}`, 500);
  }

  // 6) Audit log.
  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: authUserId,
    action: "employee_created",
    details: {
      employee_id: newEmployee.id,
      employee_name: emp.name,
      username,
      synthetic_email: syntheticEmail,
      model: "C1",
      role: requestedRole,
    },
  });

  // NOTA: en C1 NO se envía email al trabajador. El manager recibe el usuario y la
  // contraseña en la UI (StaffPage) para entregárselos en mano.
  return jsonResponse({
    ok: true,
    employee: newEmployee,
    authUserId,
    username, // el cliente lo muestra al manager
  });
}

// ────────────────────────────────────────
// ACCIÓN: DEACTIVATE
// Marca empleado y user_profile como inactivos. NO borra el auth.user.
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleDeactivate(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);

  const { error: empErr } = await admin
    .from("employees")
    .update({ active: false })
    .eq("id", payload.employeeId);

  if (empErr) return errorResponse(`Employee update failed: ${empErr.message}`, 500);

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

  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: profile?.user_id || null,
    action: "employee_deactivated",
    details: { employee_id: payload.employeeId },
  });

  return jsonResponse({ ok: true, employeeId: payload.employeeId });
}

// ────────────────────────────────────────
// ACCIÓN: REACTIVATE (modelo C1)
// Reactiva empleado y user_profile. NO envía email ni magic link (C1): el
// trabajador sigue accediendo con su usuario + contraseña existentes. Si el
// manager quiere darle una contraseña nueva, usará la regeneración de contraseña
// (acción futura), no la reactivación.
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleReactivate(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);

  const { error: empErr } = await admin
    .from("employees")
    .update({ active: true })
    .eq("id", payload.employeeId);

  if (empErr) return errorResponse(`Employee update failed: ${empErr.message}`, 500);

  await admin
    .from("user_profiles")
    .update({ active: true })
    .eq("employee_id", payload.employeeId);

  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("employee_id", payload.employeeId)
    .maybeSingle();

  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: profile?.user_id || null,
    action: "employee_reactivated",
    details: { employee_id: payload.employeeId },
  });

  return jsonResponse({ ok: true, employeeId: payload.employeeId });
}

// ────────────────────────────────────────
// ACCIÓN: DELETE_PERMANENT
// Elimina TODO el rastro del empleado (employees + CASCADE, user_profiles,
// manager_locations, manager_permissions, auth.users). IRREVERSIBLE.
// Sin cambios respecto al original salvo limpieza.
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleDeletePermanent(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);

  const { data: employee } = await admin
    .from("employees")
    .select("name, username, email")
    .eq("id", payload.employeeId)
    .maybeSingle();

  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, user_id")
    .eq("employee_id", payload.employeeId)
    .maybeSingle();

  const auth_user_id = profile?.user_id || null;
  const user_profile_id = profile?.id || null;

  if (user_profile_id) {
    await admin.from("manager_permissions").delete().eq("user_profile_id", user_profile_id);
    await admin.from("manager_locations").delete().eq("user_profile_id", user_profile_id);
    await admin.from("user_profiles").delete().eq("id", user_profile_id);
  }

  const { error: empErr } = await admin
    .from("employees")
    .delete()
    .eq("id", payload.employeeId);

  if (empErr) return errorResponse(`Employee delete failed: ${empErr.message}`, 500);

  if (auth_user_id) {
    const { data: otherProfiles } = await admin
      .from("user_profiles")
      .select("id")
      .eq("user_id", auth_user_id)
      .limit(1);

    if (!otherProfiles || otherProfiles.length === 0) {
      const { error: authErr } = await admin.auth.admin.deleteUser(auth_user_id);
      if (authErr) console.error("Auth delete error:", authErr);
    }
  }

  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: auth_user_id,
    action: "employee_deleted_permanently",
    details: {
      employee_id: payload.employeeId,
      employee_name: employee?.name || null,
      employee_username: employee?.username || null,
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
// ACCIÓN: SET_PASSWORD (modelo C1)
// El manager regenera la contraseña de un empleado-con-cuenta. NO requiere
// conocer la antigua. Solo admins pueden invocar (gate ya aplicado arriba).
// El trabajador NO puede cambiar su propia contraseña en V1 (D2 de §7.7).
// ────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleSetPassword(admin: any, payload: Payload, actorUserId: string): Promise<Response> {
  if (!payload.employeeId) return errorResponse("Missing employeeId", 400);
  if (!payload.password || payload.password.length < 6) {
    return errorResponse("La contraseña debe tener al menos 6 caracteres", 400);
  }

  // Resolver user_id del auth.user asociado al empleado vía user_profiles.
  const { data: profile, error: profileErr } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("employee_id", payload.employeeId)
    .maybeSingle();

  if (profileErr) {
    return errorResponse(`Profile fetch error: ${profileErr.message}`, 500);
  }
  if (!profile?.user_id) {
    return errorResponse("El empleado no tiene cuenta de acceso", 404);
  }

  // Actualizar password via service_role.
  const { error: updateErr } = await admin.auth.admin.updateUserById(profile.user_id, {
    password: payload.password,
  });
  if (updateErr) {
    return errorResponse(`Auth password update failed: ${updateErr.message}`, 500);
  }

  // Audit log.
  await admin.from("security_audit_log").insert({
    actor_user_id: actorUserId,
    target_user_id: profile.user_id,
    action: "employee_password_reset",
    details: { employee_id: payload.employeeId },
  });

  return jsonResponse({ ok: true, employeeId: payload.employeeId });
}
