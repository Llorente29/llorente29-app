// ============================================================
// Edge Function: send-email
// Plataforma Folvy V1 — motor de envio de correos (Bloque 1).
//
// Recibe { to, template, data } y envia el correo via Resend.
// Remitente fijo: no-reply@folvy.app. Reply-to: jgcolon@idasal.com.
// Gating: JWT de platform_admin obligatorio (igual que create-account).
//
// Bloque 1: envia y devuelve el id de Resend. SIN tabla de audit
// (pendiente: tabla propia de log de emails en Bloque 2).
//
// Endpoint: POST /functions/v1/send-email
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { renderTemplate, templateExists } from './templates.ts';

// Remitente y reply-to fijos de plataforma (Resend + folvy.app verificado).
const FROM = 'Folvy <no-reply@folvy.app>';
const REPLY_TO = 'jgcolon@idasal.com';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface SendEmailPayload {
  to: string;                       // destinatario
  template: string;                 // nombre de plantilla registrada
  data?: Record<string, unknown>;   // datos para la plantilla (opcional)
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
      return jsonResponse(403, { error: 'Solo platform admins pueden enviar correos' });
    }

    // --- 2. Parsear y validar payload ---
    let p: SendEmailPayload;
    try {
      p = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body JSON invalido' });
    }
    if (!p.to || typeof p.to !== 'string') {
      return jsonResponse(400, { error: 'Campo obligatorio ausente o invalido: to' });
    }
    if (!p.template || typeof p.template !== 'string') {
      return jsonResponse(400, { error: 'Campo obligatorio ausente o invalido: template' });
    }
    // Validacion minima del email destino (no exhaustiva, solo defensiva).
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to)) {
      return jsonResponse(400, { error: `Email destino con formato invalido: ${p.to}` });
    }
    if (!templateExists(p.template)) {
      return jsonResponse(400, { error: `Plantilla desconocida: ${p.template}` });
    }

    // --- 3. Leer la API key de Resend (SECRET de Supabase, NO en repo) ---
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.error('[send-email] RESEND_API_KEY no configurada');
      return jsonResponse(500, { error: 'Servicio de email no configurado' });
    }

    // --- 4. Renderizar la plantilla ---
    const rendered = renderTemplate(p.template, p.data ?? {});
    if (!rendered) {
      return jsonResponse(500, { error: `No se pudo renderizar la plantilla: ${p.template}` });
    }

    // --- 5. Sanitizar el subject (defensa contra inyeccion de cabeceras) ---
    const safeSubject = sanitizeHeader(rendered.subject);

    // --- 6. Enviar via Resend ---
    const resendRes = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: p.to,
        reply_to: REPLY_TO,
        subject: safeSubject,
        html: rendered.html,
        text: rendered.text,
      }),
    });

    const resendBody = await resendRes.json().catch(() => ({}));

    if (!resendRes.ok) {
      console.error('[send-email] Resend error:', resendRes.status, resendBody);
      return jsonResponse(502, {
        error: 'El proveedor de email rechazo el envio',
        detail: (resendBody as { message?: string })?.message ?? `HTTP ${resendRes.status}`,
      });
    }

    const emailId = (resendBody as { id?: string })?.id ?? null;
    console.log(`[send-email] OK template=${p.template} to=${p.to} id=${emailId}`);

    // --- 7. Exito (Bloque 1: sin persistir audit; pendiente tabla propia) ---
    return jsonResponse(200, { status: 'ok', email_id: emailId });

  } catch (error) {
    console.error('[send-email] unexpected error:', error);
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

// Elimina CR/LF y recorta: evita inyeccion de cabeceras de email via subject.
function sanitizeHeader(s: string): string {
  return String(s).replace(/[\r\n]/g, ' ').slice(0, 200);
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
