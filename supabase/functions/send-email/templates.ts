// ============================================================
// send-email / templates.ts
// Registro de plantillas de email de plataforma Folvy.
//
// Cada plantilla recibe un objeto `data` (libre, segun la plantilla)
// y devuelve { subject, html, text }.
//
// Bloque 1 (cimientos): test_ping (smoke test).
// Bloque 2 (porteria, Capa C): aviso_impago, aviso_suspension,
//   aviso_cancelacion, aviso_reactivacion.
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
                Este es un mensaje automático de Folvy. Si tienes dudas, responde a este correo.
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

// ---- Helpers de composicion de cuerpo ----
function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1f2e;">${escapeHtml(text)}</h1>`;
}

// Parrafo de texto. `rawHtml` permite inyectar <strong> ya formado por la plantilla
// (NUNCA datos del usuario sin escapar).
function paragraph(rawHtml: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3a4256;">${rawHtml}</p>`;
}

// ============================================================
// PLANTILLAS
// ============================================================

const test_ping: TemplateFn = (data) => {
  const nota = escapeHtml(data.nota ?? 'sin nota');
  const ts = new Date().toISOString();
  const bodyHtml = `
    ${heading('El envío funciona')}
    ${paragraph('Esto es un email de prueba del sistema de envío de Folvy (Edge Function <code>send-email</code> + Resend).')}
    ${paragraph(`Nota: ${nota}`)}
    <p style="margin:0;font-size:13px;color:#8a92a6;">Generado: ${ts}</p>`;
  return {
    subject: 'Folvy · prueba de envío',
    html: layout('Folvy · prueba de envío', bodyHtml),
    text: `El envío funciona.\n\nEmail de prueba del sistema de envío de Folvy (send-email + Resend).\nNota: ${String(data.nota ?? 'sin nota')}\nGenerado: ${ts}`,
  };
};

// ---- 1. IMPAGO (active/trial -> past_due) ----
const aviso_impago: TemplateFn = (data) => {
  const nombre = escapeHtml(data.nombreCuenta ?? 'cliente');
  const diasRaw = Number(data.diasGracia);
  const dias = Number.isFinite(diasRaw) && diasRaw > 0 ? Math.floor(diasRaw) : 7;
  const bodyHtml = `
    ${heading('Hay un problema con el pago de tu cuenta')}
    ${paragraph(`Hola, <strong>${nombre}</strong>.`)}
    ${paragraph('No hemos podido procesar el pago de tu suscripción a Folvy. Tu cuenta sigue activa, pero dispones de <strong>' + dias + ' días</strong> para regularizar el pago antes de que se suspenda el acceso.')}
    ${paragraph('Si crees que es un error o necesitas ayuda, responde a este correo y lo revisamos contigo.')}`;
  return {
    subject: 'Folvy · Hay un problema con el pago de tu cuenta',
    html: layout('Hay un problema con el pago de tu cuenta', bodyHtml),
    text:
      `Hola, ${String(data.nombreCuenta ?? 'cliente')}.\n\n` +
      `No hemos podido procesar el pago de tu suscripción a Folvy. Tu cuenta sigue activa, ` +
      `pero dispones de ${dias} días para regularizar el pago antes de que se suspenda el acceso.\n\n` +
      `Si crees que es un error o necesitas ayuda, responde a este correo y lo revisamos contigo.`,
  };
};

// ---- 2. SUSPENSION (-> suspended) ----
const aviso_suspension: TemplateFn = (data) => {
  const nombre = escapeHtml(data.nombreCuenta ?? 'cliente');
  const bodyHtml = `
    ${heading('Tu cuenta ha sido suspendida')}
    ${paragraph(`Hola, <strong>${nombre}</strong>.`)}
    ${paragraph('El acceso a tu cuenta de Folvy ha quedado suspendido temporalmente por falta de pago. Tus datos están a salvo y se conservan.')}
    ${paragraph('Para reactivar el acceso, ponte en contacto con nosotros respondiendo a este correo y te ayudamos a resolverlo cuanto antes.')}`;
  return {
    subject: 'Folvy · Tu cuenta ha sido suspendida',
    html: layout('Tu cuenta ha sido suspendida', bodyHtml),
    text:
      `Hola, ${String(data.nombreCuenta ?? 'cliente')}.\n\n` +
      `El acceso a tu cuenta de Folvy ha quedado suspendido temporalmente por falta de pago. ` +
      `Tus datos están a salvo y se conservan.\n\n` +
      `Para reactivar el acceso, ponte en contacto con nosotros respondiendo a este correo y te ayudamos a resolverlo cuanto antes.`,
  };
};

// ---- 3. CANCELACION (-> canceled) ----
const aviso_cancelacion: TemplateFn = (data) => {
  const nombre = escapeHtml(data.nombreCuenta ?? 'cliente');
  const bodyHtml = `
    ${heading('Tu cuenta ha sido cancelada')}
    ${paragraph(`Hola, <strong>${nombre}</strong>.`)}
    ${paragraph('Tu cuenta de Folvy ha sido cancelada. Lamentamos verte marchar.')}
    ${paragraph('Si necesitas exportar o recuperar tus datos, responde a este correo lo antes posible y te indicamos cómo hacerlo. Si esto no es lo que esperabas o ha sido un error, escríbenos y lo revisamos.')}`;
  return {
    subject: 'Folvy · Tu cuenta ha sido cancelada',
    html: layout('Tu cuenta ha sido cancelada', bodyHtml),
    text:
      `Hola, ${String(data.nombreCuenta ?? 'cliente')}.\n\n` +
      `Tu cuenta de Folvy ha sido cancelada. Lamentamos verte marchar.\n\n` +
      `Si necesitas exportar o recuperar tus datos, responde a este correo lo antes posible y te indicamos cómo hacerlo. ` +
      `Si esto no es lo que esperabas o ha sido un error, escríbenos y lo revisamos.`,
  };
};

// ---- 4. REACTIVACION (-> active) ----
const aviso_reactivacion: TemplateFn = (data) => {
  const nombre = escapeHtml(data.nombreCuenta ?? 'cliente');
  const bodyHtml = `
    ${heading('Tu cuenta vuelve a estar activa')}
    ${paragraph(`Hola, <strong>${nombre}</strong>.`)}
    ${paragraph('Buenas noticias: tu cuenta de Folvy vuelve a estar activa y ya tienes acceso completo con normalidad.')}
    ${paragraph('Gracias por seguir confiando en nosotros. Si necesitas cualquier cosa, responde a este correo.')}`;
  return {
    subject: 'Folvy · Tu cuenta vuelve a estar activa',
    html: layout('Tu cuenta vuelve a estar activa', bodyHtml),
    text:
      `Hola, ${String(data.nombreCuenta ?? 'cliente')}.\n\n` +
      `Buenas noticias: tu cuenta de Folvy vuelve a estar activa y ya tienes acceso completo con normalidad.\n\n` +
      `Gracias por seguir confiando en nosotros. Si necesitas cualquier cosa, responde a este correo.`,
  };
};

// ---- Registro ----
const TEMPLATES: Record<string, TemplateFn> = {
  test_ping,
  aviso_impago,
  aviso_suspension,
  aviso_cancelacion,
  aviso_reactivacion,
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
