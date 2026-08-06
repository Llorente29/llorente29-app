// supabase/functions/compliance-doc-notify/index.ts
//
// WATCHDOG DEL ARCHIVO DOCUMENTAL (T5). Llamado por cron (net.http_post).
// ============================================================================
// 1. Marca 'expired' las fichas cuya caducidad ya pasó (compliance_doc_mark_expired).
// 2. Busca fichas que vencen/toca revisar en <=30 días y no recordadas este ciclo
//    (compliance_docs_due). Para cada una:
//      · avisa al MANAGER (appcc_notifications, su campana + email si aplica),
//      · si el proveedor tiene email, le escribe pidiendo la ficha actualizada
//        (Resend, patrón de account-email) y lo registra en compliance_reminder_log,
//      · marca compliance_document.last_reminder_at = now (una vez por ciclo).
//
// Auth INTERNA: x-internal-key === SERVICE_ROLE_KEY (patrón de ocr-albaran).
// Deploy con --no-verify-jwt (lo llama el cron sin sesión). Idempotente: repetir
// la llamada no reenvía nada (last_reminder_at ya fijado).
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

const FROM = 'Folvy <no-reply@folvy.app>';
const REPLY_TO = 'partners@folvy.app';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DUE_DAYS = 30;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

interface DueDoc {
  id: string;
  account_id: string;
  title: string;
  reference: string | null;
  expires_at: string | null;
  review_due_at: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_email: string | null;
  account_name: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = req.headers.get('x-internal-key') ?? '';
  if (!serviceKey || internalKey !== serviceKey) {
    return jsonResponse(401, { error: 'unauthorized' });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';

  // 1) Marcar caducados
  let expired = 0;
  try {
    const { data } = await sb.rpc('compliance_doc_mark_expired');
    expired = typeof data === 'number' ? data : 0;
  } catch (e) {
    console.error('[compliance-doc-notify] mark_expired', String(e));
  }

  // 2) Fichas que vencen y no recordadas este ciclo
  const { data: dueData, error: dueErr } = await sb.rpc('compliance_docs_due', { p_days: DUE_DAYS });
  if (dueErr) {
    console.error('[compliance-doc-notify] docs_due', dueErr.message);
    return jsonResponse(500, { error: 'No se pudo listar las fichas que vencen', detail: dueErr.message });
  }
  const due = (dueData ?? []) as DueDoc[];

  let emailsSent = 0, emailsFailed = 0, alerts = 0;

  for (const d of due) {
    const dueDate = d.expires_at ?? d.review_due_at ?? null;
    const dueTxt = dueDate ? new Date(dueDate).toLocaleDateString('es-ES') : 'pronto';

    // 2a) Aviso al manager (campana APPCC) — uno por admin/manager activo.
    try {
      const { data: mgrs } = await sb.from('user_profiles')
        .select('user_id')
        .eq('account_id', d.account_id).eq('active', true)
        .in('role', ['admin', 'manager']);
      const rows = (mgrs ?? []).map((m) => ({
        account_id: d.account_id,
        user_id: (m as { user_id: string }).user_id,
        type: 'compliance_doc_due',
        title: `Ficha por revisar: ${d.title}`,
        body: d.supplier_name
          ? `Caduca/revisa el ${dueTxt}. Conviene pedir la ficha actualizada a ${d.supplier_name}.`
          : `Caduca/revisa el ${dueTxt}. Conviene pedir la ficha actualizada al proveedor.`,
        link_type: 'compliance_document',
        link_id: d.id,
        severity: 'warning',
      }));
      if (rows.length > 0) {
        const { error: nErr } = await sb.from('appcc_notifications').insert(rows);
        if (nErr) console.error('[compliance-doc-notify] appcc_notifications', nErr.message);
        else alerts += rows.length;
      }
    } catch (e) {
      console.error('[compliance-doc-notify] managers', String(e));
    }

    // 2b) Email al proveedor (si tiene email y hay clave Resend)
    if (d.supplier_email && resendKey) {
      const subject = `Solicitud de ficha técnica actualizada — ${d.title}`;
      const refTxt = d.reference ? ` (referencia ${d.reference})` : '';
      const account = d.account_name ?? 'nuestro cliente';
      const text =
        `Estimado proveedor,\n\n` +
        `${account} gestiona su seguridad alimentaria con Folvy y necesita la ficha técnica ` +
        `ACTUALIZADA del producto "${d.title}"${refTxt}, cuya versión en archivo vence el ${dueTxt}.\n\n` +
        `Por favor, respondan a este correo adjuntando la ficha técnica vigente (con la declaración de ` +
        `alérgenos e ingredientes).\n\nGracias.\nFolvy — en nombre de ${account}`;
      const html =
        `<p>Estimado proveedor,</p>` +
        `<p><b>${esc(account)}</b> gestiona su seguridad alimentaria con Folvy y necesita la ficha técnica ` +
        `<b>actualizada</b> del producto "<b>${esc(d.title)}</b>"${esc(refTxt)}, cuya versión en archivo ` +
        `vence el ${esc(dueTxt)}.</p>` +
        `<p>Por favor, respondan a este correo adjuntando la ficha técnica vigente (con la declaración de ` +
        `alérgenos e ingredientes).</p><p>Gracias.<br>Folvy — en nombre de ${esc(account)}</p>`;

      let status: 'sent' | 'failed' = 'sent';
      let resendId: string | null = null;
      let errMsg: string | null = null;
      try {
        const r = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: d.supplier_email, reply_to: REPLY_TO, subject, html, text }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) { status = 'failed'; errMsg = (body as { message?: string })?.message ?? `HTTP ${r.status}`; emailsFailed++; }
        else { resendId = (body as { id?: string })?.id ?? null; emailsSent++; }
      } catch (e) {
        status = 'failed'; errMsg = e instanceof Error ? e.message : String(e); emailsFailed++;
      }
      const { error: logErr } = await sb.from('compliance_reminder_log').insert({
        account_id: d.account_id, document_id: d.id, to_email: d.supplier_email,
        subject, resend_email_id: resendId, status, error_message: errMsg,
      });
      if (logErr) console.error('[compliance-doc-notify] reminder_log', logErr.message);
    }

    // 2c) Marcar recordado (una vez por ciclo), aunque no hubiera email de proveedor.
    const { error: updErr } = await sb.from('compliance_document')
      .update({ last_reminder_at: new Date().toISOString() })
      .eq('id', d.id);
    if (updErr) console.error('[compliance-doc-notify] set last_reminder_at', updErr.message);
  }

  return jsonResponse(200, {
    status: 'ok',
    expired_marked: expired,
    docs_due: due.length,
    manager_alerts: alerts,
    emails_sent: emailsSent,
    emails_failed: emailsFailed,
  });
});
