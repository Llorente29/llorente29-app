// ============================================================
// Edge Function: account-email
// Bloque multi-canal Fase B (mayo 2026).
//
// Envia emails de cuenta cliente: admins/managers a empleados de SU cuenta.
// Distinto de send-email (que es solo para platform_admin / porteria de
// plataforma).
//
// Pipeline de seguridad (en orden):
//   1. Auth: JWT con firma verificada via supabase.auth.getUser(jwt). 401 si invalido.
//   2. accountId del payload validado: el caller debe tener user_profile activo
//      con role IN ('admin','manager') en ESA cuenta concreta. 403 si no.
//   3. Payload: template === 'account_message' unico permitido. 400 si otro.
//   4. Longitudes: title 1..200, body 1..5000, recipients 1..50. 400 si fuera.
//   5. Cross-tenant fail-closed: cada recipient.employeeId debe pertenecer a
//      la cuenta declarada via employees.location_id -> locations.account_id.
//      Si alguno no, rechaza el batch entero (no skip parcial).
//   6. to_email RECALCULADO server-side desde employees.email. NO se confia
//      en el payload (defensa contra relay SMTP).
//   7. Rate limit ESTRICTO por cuenta via account_email_log: si
//      currentCount + batchSize > LIMIT (50/h o 200/dia), 429 + log
//      status='rate_limited' para auditoria.
//   8. Envio Resend con From fijo 'Folvy <no-reply@folvy.app>'. senderName
//      solo en el body (mitiga phishing por display name custom).
//   9. Cada intento (sent/failed) se registra en account_email_log via
//      service_role (RLS solo permite escritura desde service_role).
//
// Endpoint: POST /functions/v1/account-email
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { renderAccountMessage } from './templates.ts';

// Sender fijo (anti-phishing por display name custom).
const FROM = 'Folvy <no-reply@folvy.app>';
const REPLY_TO = 'jgcolon@idasal.com';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Rate-limit por cuenta. Conservador para Fase B inicial.
const RATE_LIMIT_PER_HOUR = 50;
const RATE_LIMIT_PER_DAY = 200;

// Constraints de payload.
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;
const MAX_RECIPIENTS = 50;

interface Recipient {
  employeeId: string;
  // El email del payload se IGNORA en el envio (se recalcula server-side
  // desde employees.email). Se acepta para que el cliente lo pueda mostrar
  // en su UI sin pedir otra round-trip.
  email?: string;
}

interface AccountEmailPayload {
  accountId: string;        // requerido: cuenta desde la que se envia
  recipients: Recipient[];
  template: 'account_message';
  data: {
    title: string;
    body: string;
    senderName?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    // ────────────────────────────────────────────────────────────
    // 1. AUTH: JWT con firma verificada
    // ────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }
    const jwt = authHeader.slice('Bearer '.length).trim();
    if (!jwt) {
      return jsonResponse(401, { error: 'JWT vacio' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error('[account-email] Faltan SUPABASE_URL / ANON / SERVICE_ROLE_KEY');
      return jsonResponse(500, { error: 'Servicio no configurado' });
    }

    // Cliente con anon key para validar la firma del JWT del caller.
    // getUser verifica criptograficamente la firma contra el secret del
    // proyecto Supabase. Sin esto, un atacante podria fabricar un JWT con
    // cualquier sub.
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: 'JWT invalido' });
    }
    const callerUserId = userData.user.id;

    // Cliente service_role: bypass RLS para validar profile y queries cross-tenant
    // independientes del JWT del usuario.
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // ────────────────────────────────────────────────────────────
    // 2. PARSEAR PAYLOAD (necesario para validar accountId en paso 3)
    // ────────────────────────────────────────────────────────────
    let p: AccountEmailPayload;
    try {
      p = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body JSON invalido' });
    }

    if (typeof p.accountId !== 'string' || p.accountId.length === 0) {
      return jsonResponse(400, { error: 'accountId requerido' });
    }

    // ────────────────────────────────────────────────────────────
    // 3. AUTORIZACION POR CUENTA: el caller es admin/manager activo
    //    en la cuenta declarada en el payload
    // ────────────────────────────────────────────────────────────
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('user_profiles')
      .select('account_id, role, active, employee_id')
      .eq('user_id', callerUserId)
      .eq('account_id', p.accountId)
      .eq('active', true)
      .in('role', ['admin', 'manager'])
      .maybeSingle();

    if (profErr) {
      console.error('[account-email] Error consultando user_profiles', profErr);
      return jsonResponse(500, { error: 'Error validando perfil' });
    }
    if (!profile) {
      // Mensaje generico: no distingue "cuenta no existe" vs "no eres
      // admin/manager activo alli". Defensa contra enumeracion.
      return jsonResponse(403, {
        error: 'No autorizado para enviar emails desde esta cuenta',
      });
    }
    const callerAccountId = profile.account_id;       // == p.accountId verificado
    const callerEmployeeId = profile.employee_id ?? null;

    // ────────────────────────────────────────────────────────────
    // 4. VALIDAR template + longitudes + count
    // ────────────────────────────────────────────────────────────
    if (p.template !== 'account_message') {
      return jsonResponse(400, { error: `Plantilla no permitida: ${p.template}` });
    }
    if (!p.data || typeof p.data.title !== 'string' || typeof p.data.body !== 'string') {
      return jsonResponse(400, { error: 'Faltan data.title / data.body' });
    }
    if (p.data.title.length === 0 || p.data.title.length > MAX_TITLE_LENGTH) {
      return jsonResponse(400, { error: `title debe tener 1..${MAX_TITLE_LENGTH} caracteres` });
    }
    if (p.data.body.length === 0 || p.data.body.length > MAX_BODY_LENGTH) {
      return jsonResponse(400, { error: `body debe tener 1..${MAX_BODY_LENGTH} caracteres` });
    }
    if (p.data.senderName !== undefined && typeof p.data.senderName !== 'string') {
      return jsonResponse(400, { error: 'senderName debe ser string si se proporciona' });
    }
    if (!Array.isArray(p.recipients) || p.recipients.length < 1 || p.recipients.length > MAX_RECIPIENTS) {
      return jsonResponse(400, { error: `recipients debe tener 1..${MAX_RECIPIENTS} elementos` });
    }
    const recipientIds = p.recipients.map(r => r.employeeId);
    if (recipientIds.some(id => typeof id !== 'string' || id.length === 0)) {
      return jsonResponse(400, { error: 'Cada recipient debe tener employeeId no vacio' });
    }

    // ────────────────────────────────────────────────────────────
    // 5. CROSS-TENANT (fail-closed) + to_email server-side
    //    Resuelve cada recipient via employees.location_id -> locations.account_id.
    //    Si alguno NO pertenece a callerAccountId, o no existe, o no tiene
    //    email -> rechaza el batch entero.
    // ────────────────────────────────────────────────────────────
    const { data: employees, error: empErr } = await supabaseAdmin
      .from('employees')
      .select('id, email, location_id, locations!inner(account_id)')
      .in('id', recipientIds);

    if (empErr) {
      console.error('[account-email] Error consultando employees', empErr);
      return jsonResponse(500, { error: 'Error validando destinatarios' });
    }
    if (!employees || employees.length !== recipientIds.length) {
      // Algun ID no existe (o no es accesible). Mensaje generico.
      return jsonResponse(403, { error: 'Algun destinatario no existe o esta fuera de alcance' });
    }

    interface EmployeeRow {
      id: string;
      email: string | null;
      location_id: string;
      locations: { account_id: string } | { account_id: string }[] | null;
    }
    const resolvedRecipients: Array<{ employeeId: string; toEmail: string }> = [];
    for (const eRaw of employees as EmployeeRow[]) {
      // PostgREST puede devolver locations como objeto o array segun la inferencia.
      // Normalizamos a objeto.
      const loc = Array.isArray(eRaw.locations) ? eRaw.locations[0] : eRaw.locations;
      const accountId = loc?.account_id;
      if (!accountId) {
        return jsonResponse(403, { error: `Destinatario ${eRaw.id} sin cuenta asociada` });
      }
      if (accountId !== callerAccountId) {
        // CROSS-TENANT: destinatario de otra cuenta. Abort batch.
        return jsonResponse(403, { error: 'Algun destinatario fuera de tu cuenta' });
      }
      if (!eRaw.email || eRaw.email.trim() === '') {
        // Fail-closed: si falta email, rechaza batch entero.
        return jsonResponse(400, { error: `Destinatario ${eRaw.id} no tiene email registrado` });
      }
      resolvedRecipients.push({
        employeeId: eRaw.id,
        toEmail: eRaw.email,
      });
    }

    // ────────────────────────────────────────────────────────────
    // 6. RATE LIMIT ESTRICTO por cuenta via account_email_log
    //    Calculo: currentCount + batchSize > LIMIT -> rechazar.
    // ────────────────────────────────────────────────────────────
    const nowMs = Date.now();
    const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const batchSize = resolvedRecipients.length;

    const { count: hourCount, error: hourErr } = await supabaseAdmin
      .from('account_email_log')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', callerAccountId)
      .gte('sent_at', hourAgo);

    if (hourErr) {
      console.error('[account-email] Error consultando rate_limit hourly', hourErr);
      return jsonResponse(500, { error: 'Error consultando rate limit' });
    }
    const currentHour = hourCount ?? 0;
    if (currentHour + batchSize > RATE_LIMIT_PER_HOUR) {
      await logRateLimited(
        supabaseAdmin,
        resolvedRecipients,
        {
          callerAccountId,
          callerUserId,
          callerEmployeeId,
          subject: sanitizeHeader(p.data.title),
          errorMessage: `Rate limit horario: ${RATE_LIMIT_PER_HOUR}/h (actual ${currentHour}, batch ${batchSize})`,
        },
      );
      return jsonResponse(429, {
        error: `Rate limit horario: ${RATE_LIMIT_PER_HOUR}/h. Actuales ${currentHour}, batch ${batchSize}.`,
      });
    }

    const { count: dayCount, error: dayErr } = await supabaseAdmin
      .from('account_email_log')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', callerAccountId)
      .gte('sent_at', dayAgo);

    if (dayErr) {
      console.error('[account-email] Error consultando rate_limit daily', dayErr);
      return jsonResponse(500, { error: 'Error consultando rate limit' });
    }
    const currentDay = dayCount ?? 0;
    if (currentDay + batchSize > RATE_LIMIT_PER_DAY) {
      await logRateLimited(
        supabaseAdmin,
        resolvedRecipients,
        {
          callerAccountId,
          callerUserId,
          callerEmployeeId,
          subject: sanitizeHeader(p.data.title),
          errorMessage: `Rate limit diario: ${RATE_LIMIT_PER_DAY}/dia (actual ${currentDay}, batch ${batchSize})`,
        },
      );
      return jsonResponse(429, {
        error: `Rate limit diario: ${RATE_LIMIT_PER_DAY}/dia. Actuales ${currentDay}, batch ${batchSize}.`,
      });
    }

    // ────────────────────────────────────────────────────────────
    // 7. RESEND API key disponible
    // ────────────────────────────────────────────────────────────
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.error('[account-email] RESEND_API_KEY no configurada');
      return jsonResponse(500, { error: 'Servicio de email no configurado' });
    }

    // ────────────────────────────────────────────────────────────
    // 8. RENDERIZAR plantilla account_message
    //    (escapeHtml interno, sin links cliqueables, sin attachments)
    // ────────────────────────────────────────────────────────────
    const rendered = renderAccountMessage({
      title: p.data.title,
      body: p.data.body,
      senderName: p.data.senderName,
    });
    const safeSubject = sanitizeHeader(rendered.subject);

    // ────────────────────────────────────────────────────────────
    // 9. ENVIAR a cada recipient + LOG cada intento
    // ────────────────────────────────────────────────────────────
    let sent = 0;
    let failed = 0;

    for (const r of resolvedRecipients) {
      let resendId: string | null = null;
      let status: 'sent' | 'failed' = 'sent';
      let errorMessage: string | null = null;

      try {
        const resendRes = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM,
            to: r.toEmail,
            reply_to: REPLY_TO,
            subject: safeSubject,
            html: rendered.html,
            text: rendered.text,
          }),
        });
        const resendBody = await resendRes.json().catch(() => ({}));
        if (!resendRes.ok) {
          status = 'failed';
          errorMessage = (resendBody as { message?: string })?.message ?? `HTTP ${resendRes.status}`;
          failed++;
        } else {
          resendId = (resendBody as { id?: string })?.id ?? null;
          sent++;
        }
      } catch (err) {
        status = 'failed';
        errorMessage = err instanceof Error ? err.message : String(err);
        failed++;
      }

      // LOG SIEMPRE (sent o failed). Errores de insert se loggean sin
      // romper el flujo: el email ya se envio (o se intento).
      const { error: logErr } = await supabaseAdmin
        .from('account_email_log')
        .insert({
          account_id: callerAccountId,
          sender_user_id: callerUserId,
          sender_employee_id: callerEmployeeId,
          recipient_employee_id: r.employeeId,
          to_email: r.toEmail,
          template: 'account_message',
          subject: safeSubject,
          resend_email_id: resendId,
          status,
          error_message: errorMessage,
        });
      if (logErr) {
        console.error('[account-email] insert account_email_log error', logErr);
      }
    }

    return jsonResponse(200, {
      status: 'ok',
      sent,
      failed,
    });

  } catch (error) {
    console.error('[account-email] unexpected error:', error);
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

// Elimina CR/LF y recorta. Evita inyeccion de cabeceras de email via subject.
function sanitizeHeader(s: string): string {
  return String(s).replace(/[\r\n]/g, ' ').slice(0, 200);
}

interface RateLimitLogMeta {
  callerAccountId: string;
  callerUserId: string;
  callerEmployeeId: string | null;
  subject: string;
  errorMessage: string;
}

// Inserta una fila status='rate_limited' por cada recipient cuando se
// rechaza el batch por rate limit. Auditoria.
async function logRateLimited(
  supabaseAdmin: ReturnType<typeof createClient>,
  recipients: Array<{ employeeId: string; toEmail: string }>,
  meta: RateLimitLogMeta,
): Promise<void> {
  if (recipients.length === 0) return;
  const rows = recipients.map(r => ({
    account_id: meta.callerAccountId,
    sender_user_id: meta.callerUserId,
    sender_employee_id: meta.callerEmployeeId,
    recipient_employee_id: r.employeeId,
    to_email: r.toEmail,
    template: 'account_message',
    subject: meta.subject,
    resend_email_id: null,
    status: 'rate_limited',
    error_message: meta.errorMessage,
  }));
  const { error } = await supabaseAdmin.from('account_email_log').insert(rows);
  if (error) {
    console.error('[account-email] logRateLimited insert error', error);
  }
}
