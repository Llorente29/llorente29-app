// ============================================================
// send-email / templates.ts
// Registro de plantillas de email de plataforma Folvy.
//
// Cada plantilla recibe un objeto `data` (libre, segun la plantilla)
// y devuelve { subject, html, text }.
//
// Bloque 1 (cimientos): solo `test_ping` para el smoke test.
// Bloque 2 anadira: aviso_impago, aviso_suspension (Capa C porteria).
// Bloque 3 anadira: welcome (onboarding, roza AUTH).
// ============================================================

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// El render recibe data ya parseada. Devuelve null si la plantilla no existe.
export type TemplateFn = (data: Record<string, unknown>) => RenderedEmail;

// ---- Layout HTML comun (cabecera/pie sobrios, sin imagenes externas) ----
function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1f2e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#1e2a4a;padding:20px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Folvy</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f4f5f7;border-top:1px solid #e6e8ec;">
              <p style="margin:0;font-size:12px;color:#8a92a6;line-height:1.5;">
                Este es un mensaje automatico de Folvy. Si tienes dudas, responde a este correo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---- Escapado HTML para datos variables (defensa basica XSS en email) ----
function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ============================================================
// PLANTILLAS
// ============================================================

const test_ping: TemplateFn = (data) => {
  const nota = escapeHtml(data.nota ?? 'sin nota');
  const ts = new Date().toISOString();
  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1f2e;">El envio funciona</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3a4256;">
      Esto es un email de prueba del sistema de envio de Folvy (Edge Function <code>send-email</code> + Resend).
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3a4256;">
      Nota: ${nota}
    </p>
    <p style="margin:0;font-size:13px;color:#8a92a6;">Generado: ${ts}</p>`;
  return {
    subject: 'Folvy · prueba de envio',
    html: layout('Folvy · prueba de envio', bodyHtml),
    text: `El envio funciona.\n\nEmail de prueba del sistema de envio de Folvy (send-email + Resend).\nNota: ${String(data.nota ?? 'sin nota')}\nGenerado: ${ts}`,
  };
};

// ---- Registro ----
const TEMPLATES: Record<string, TemplateFn> = {
  test_ping,
};

export function renderTemplate(
  name: string,
  data: Record<string, unknown>,
): RenderedEmail | null {
  const fn = TEMPLATES[name];
  if (!fn) return null;
  return fn(data);
}

export function templateExists(name: string): boolean {
  return name in TEMPLATES;
}
