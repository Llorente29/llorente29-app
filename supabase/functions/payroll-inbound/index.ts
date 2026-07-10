// supabase/functions/payroll-inbound/index.ts
//
// Ingesta de NÓMINAS por correo (Resend Inbound). El cliente reenvía los correos
// de su gestoría a nominas-<cliente>@in.folvy.app; Resend dispara este webhook.
// Aquí: verificamos la firma → resolvemos la cuenta por el `to` → bajamos cada PDF
// (Attachments API) → lo subimos a Storage → lo pasamos a payroll-extract en modo
// INTERNO. Idempotente: el upsert de payroll-extract (empleado×mes×status) evita
// duplicados si Resend reintenta.
//
// DEPLOY: siempre con --no-verify-jwt (webhook externo; la seguridad la da la
// firma svix de Resend, no el gateway).

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Webhook } from 'npm:svix';

const BUCKET = 'employee-documents';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  if (!serviceKey || !resendKey || !webhookSecret) return json(500, { error: 'Servicio no configurado' });

  // ── 1) Verificar la firma svix de Resend ──
  const raw = await req.text();
  let event: {
    type: string;
    data: { email_id: string; to?: string[]; from?: string; subject?: string;
            attachments?: { id: string; filename: string; content_type: string }[] };
  };
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(raw, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as typeof event;
  } catch (e) {
    console.error('[payroll-inbound] firma inválida:', String(e));
    return json(401, { error: 'Firma no válida' });
  }

  // Devolvemos 200 a cualquier evento que no sea una recepción (para no reintentar).
  if (event.type !== 'email.received') return json(200, { ignored: event.type });

  const sb = createClient(supabaseUrl, serviceKey);

  // ── 2) Resolver la cuenta por el destinatario (alias) ──
  const to = (event.data.to?.[0] ?? '').toLowerCase().trim();
  if (!to) return json(200, { ignored: 'sin destinatario' });
  const { data: setting, error: setErr } = await sb
    .from('payroll_settings')
    .select('account_id, inbound_address')
    .ilike('inbound_address', to)
    .maybeSingle();
  if (setErr) console.error('[payroll-inbound] payroll_settings:', setErr.message);
  const accountId = setting?.account_id as string | undefined;
  if (!accountId) {
    console.warn('[payroll-inbound] sin cuenta para', to);
    return json(200, { ignored: 'destinatario no mapeado', to });
  }

  // ── 3) Bajar los adjuntos PDF (Attachments API por REST) ──
  // GET /emails/receiving/{email_id}/attachments → { data:[{ id, filename, content_type, download_url }] }
  let attachments: { id: string; filename: string; content_type?: string; download_url?: string }[] = [];
  try {
    const listResp = await fetch(
      `https://api.resend.com/emails/receiving/${event.data.email_id}/attachments`,
      { headers: { 'Authorization': `Bearer ${resendKey}` } },
    );
    if (!listResp.ok) {
      console.error('[payroll-inbound] list adjuntos', listResp.status, await listResp.text());
    } else {
      const listJson = await listResp.json();
      attachments = listJson?.data ?? [];
    }
  } catch (e) {
    console.error('[payroll-inbound] list adjuntos error:', String(e));
  }

  const results: unknown[] = [];
  for (const att of attachments) {
    const isPdf = (att.content_type ?? '').includes('pdf') || (att.filename ?? '').toLowerCase().endsWith('.pdf');
    if (!isPdf || !att.download_url) continue;

    try {
      const fileResp = await fetch(att.download_url);
      if (!fileResp.ok) { console.error('[payroll-inbound] descarga adjunto', fileResp.status); continue; }
      const bytes = new Uint8Array(await fileResp.arrayBuffer());

      const safeName = (att.filename || 'nomina.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `_inbox/${accountId}/${event.data.email_id}-${safeName}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
        contentType: 'application/pdf', upsert: true,
      });
      if (upErr) { console.error('[payroll-inbound] upload:', upErr.message); continue; }

      // Pasar al extractor en modo INTERNO (service key en Authorization + x-internal-key)
      const exResp = await fetch(`${supabaseUrl}/functions/v1/payroll-extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'x-internal-key': serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ account_id: accountId, file_paths: [path], source: 'gmail', email_id: event.data.email_id }),
      });
      const exData = await exResp.json().catch(() => null);
      results.push({ filename: att.filename, ok: exResp.ok, extract: exData });
    } catch (e) {
      console.error('[payroll-inbound] adjunto', att.filename, String(e));
      results.push({ filename: att.filename, ok: false, error: String(e) });
    }
  }

  return json(200, { received: true, account_id: accountId, processed: results.length, results });
});
