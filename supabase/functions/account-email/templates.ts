// ============================================================
// account-email / templates.ts
// Plantilla account_message para mensajes de manager/admin de cuenta a
// empleados de SU cuenta (bloque multi-canal Fase B, mayo 2026).
//
// UNA sola plantilla por diseno: account_message. Texto libre (title +
// body), opcionalmente firmado con senderName.
//
// Restricciones de seguridad (defensa anti-phishing relay):
//   - escapeHtml en title, body y senderName.
//   - SIN links cliqueables: URLs en el body se renderizan como texto.
//   - SIN attachments.
//   - SenderName va SOLO en el cuerpo del email (no en el From).
// ============================================================

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface AccountMessageData {
  title: string;
  body: string;
  senderName?: string;
}

// URL publica del isotipo (servido por Vercel desde public/email/).
// Misma URL que send-email/templates.ts.
const LOGO_URL = 'https://app.folvy.app/email/folvy-isotipo-email.png';

// ---- Layout HTML comun (clonado de send-email/templates.ts) ----
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
            <td style="background:#f5f4f0;padding:22px 32px;border-bottom:1px solid #e6e4dd;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <img src="${LOGO_URL}" width="40" height="40" alt="Folvy"
                         style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#1e3a5f;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Folvy</span>
                  </td>
                </tr>
              </table>
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
                Mensaje enviado desde tu cuenta de Folvy. Si tienes dudas, responde a este correo.
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

// ---- Escapado HTML (identico a send-email/templates.ts) ----
function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ============================================================
// PLANTILLA UNICA: account_message
// ============================================================

export function renderAccountMessage(data: AccountMessageData): RenderedEmail {
  const safeTitle = escapeHtml(data.title);
  // body: escapar HTML, luego convertir saltos de linea a <br>.
  // NO se convierten URLs en <a> (decision deliberada anti-phishing relay).
  const safeBodyHtml = escapeHtml(data.body).replace(/\n/g, '<br>');
  const safeSenderName = data.senderName ? escapeHtml(data.senderName) : null;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1f2e;">${safeTitle}</h1>
    <div style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3a4256;">
      ${safeBodyHtml}
    </div>
    ${safeSenderName ? `
      <p style="margin:24px 0 0;font-size:13px;color:#8a92a6;border-top:1px solid #e6e8ec;padding-top:16px;">
        — ${safeSenderName}
      </p>
    ` : ''}`;

  const text = textVersion(data);

  return {
    subject: data.title,
    html: layout(data.title, bodyHtml),
    text,
  };
}

function textVersion(data: AccountMessageData): string {
  return (
    String(data.title) + '\n\n' +
    String(data.body) +
    (data.senderName ? `\n\n— ${String(data.senderName)}` : '')
  );
}
