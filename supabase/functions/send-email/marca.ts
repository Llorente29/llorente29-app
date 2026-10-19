// ============================================================
// send-email / marca.ts  (C06 · Contabilidad sola)
//
// Los correos con marca: quién los manda y cómo se ven. Puro, sin Deno: lo
// prueban las unitarias (tests/unit/modules/conta/correoC06.test.ts).
//
// SIN marca (todo lo que se manda hoy) el remitente y las plantillas son
// EXACTAMENTE los de siempre: REMITENTE_FOLVY es el FROM/REPLY_TO que tenía
// index.ts, y las plantillas de templates.ts no se tocan. CON marca, el
// remitente de la marca (marcas.ts); si la marca aún no tiene remitente
// (dominio sin verificar en Resend), NO se manda y se dice por qué: nunca se
// manda un correo de la marca desde la dirección de Folvy.
// ============================================================

import { MARCAS, esIdMarca, type Marca } from '../_shared/marcas.ts';

export const REMITENTE_FOLVY = { from: 'Folvy <no-reply@folvy.app>', replyTo: 'jgcolon@idasal.com' } as const;

export type Remitente =
  | { ok: true; from: string; replyTo: string | null; marca: Marca | null }
  | { ok: false; motivo: string };

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Quién manda el correo. Con marca, `responderA` (P01) pone el «responder a» de
 * ESTE envío —el correo de la asesoría que manda el resumen—; si no vale, se
 * dice y no se manda. Sin marca no se usa: Folvy sigue exactamente igual.
 */
export function remitenteDe(marca: unknown, responderA?: unknown): Remitente {
  if (marca === undefined || marca === null || marca === '') {
    return { ok: true, from: REMITENTE_FOLVY.from, replyTo: REMITENTE_FOLVY.replyTo, marca: null };
  }
  if (!esIdMarca(marca)) return { ok: false, motivo: `Marca desconocida: ${String(marca)}` };
  const m = MARCAS[marca];
  if (!m.remitente) {
    return { ok: false, motivo: `La marca «${m.nombre}» aún no tiene remitente: su dominio no está verificado en Resend. No se manda desde otra dirección.` };
  }
  if (responderA !== undefined && responderA !== null && responderA !== '') {
    const r = String(responderA).trim().toLowerCase();
    if (!CORREO.test(r) || /[\r\n,;<>]/.test(r)) return { ok: false, motivo: `El correo para las respuestas no vale: ${String(responderA).slice(0, 80)}` };
    return { ok: true, from: m.remitente, replyTo: r, marca: m };
  }
  return { ok: true, from: m.remitente, replyTo: m.responderA, marca: m };
}

export type Cerrojo = { abierto: true } | { abierto: false; motivo: string };

/**
 * P01 · EL FRENO DE LOS CORREOS CON MARCA, por tipo (decisión de Julio, 19/10).
 * Todos cerrados salvo lo que Julio abra en el secreto CORREO_MARCA_ABIERTOS de
 * send-email: una lista separada por comas, cada entrada
 *   · `plantilla`          abierta a cualquiera, o
 *   · `plantilla:correo`   abierta solo a ese destinatario (el de prueba).
 * Vacío o sin poner = todo cerrado. Sin marca (Folvy) no se frena nada: lo que
 * ya sale sigue saliendo igual.
 */
export function cerrojoMarca(marca: Marca | null, plantilla: string, destino: string, abiertos: string | undefined | null): Cerrojo {
  if (!marca) return { abierto: true };
  const para = destino.trim().toLowerCase();
  const entradas = String(abiertos ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const e of entradas) {
    const i = e.indexOf(':');
    const tipo = i < 0 ? e : e.slice(0, i);
    const solo = i < 0 ? null : e.slice(i + 1).trim();
    if (tipo !== plantilla.toLowerCase()) continue;
    if (solo === null || solo === para) return { abierto: true };
  }
  const soloA = entradas.filter((e) => e.startsWith(plantilla.toLowerCase() + ':')).length > 0;
  return {
    abierto: false,
    motivo: soloA
      ? `Los correos «${plantilla}» de ${marca.nombre} solo están abiertos para la prueba, no para ${para}. No se ha mandado nada.`
      : `Los correos «${plantilla}» de ${marca.nombre} están cerrados hasta que Julio los abra. No se ha mandado nada.`,
  };
}

/**
 * El cuerpo que se manda a Resend. Sin marca, el MISMO JSON que antes del C06
 * (mismas claves, mismo orden: from, to, reply_to, subject, html, text).
 */
export function cuerpoResend(r: Extract<Remitente, { ok: true }>, to: string, subject: string, html: string, text: string): string {
  return JSON.stringify({
    from: r.from,
    to,
    ...(r.replyTo ? { reply_to: r.replyTo } : {}),
    subject,
    html,
    text,
  });
}

export interface CorreoMarca { subject: string; html: string; text: string }

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function urlSegura(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/"/g, '%22').replace(/'/g, '%27');
}

// Estilo nuevo (encargo C06, «Diseño»): Geist con sus alternativas, sin negro
// (tinta #0E1A2B), el azul de acción #2F5BFF y el cuadrado de la marca.
const TINTA = '#0E1A2B';
const APOYO = '#5B6678';
const AZUL = '#2F5BFF';
const BORDE = '#E6EAF0';
const FUENTE = "Geist, 'Helvetica Neue', Arial, sans-serif";

/** Los colores y la letra del correo: los de la marca si tiene tema (Sumied, C06b); si no, los de siempre. */
interface Colores { tinta: string; apoyo: string; azul: string; fuente: string }
function coloresDe(m: Marca): Colores {
  return m.tema
    ? { tinta: m.tema.tinta, apoyo: m.tema.apoyo, azul: m.tema.accion, fuente: m.tema.letra.replace(/'Inter Variable', /, '') }
    : { tinta: TINTA, apoyo: APOYO, azul: AZUL, fuente: FUENTE };
}

function pie(m: Marca): string {
  const APOYO = coloresDe(m).apoyo;
  const partes = [esc(m.nombre), m.direccionVisible ? esc(m.direccionVisible) : null].filter(Boolean);
  const legal = (texto: string, url: string | null) =>
    url ? `<a href="${urlSegura(url)}" style="color:${APOYO};">${texto}</a>` : texto;
  return `${partes.join(' · ')} · ${legal('Aviso legal', m.avisoLegal)} · ${legal('Privacidad', m.privacidad)}`;
}

function marco(m: Marca, titulo: string, cuerpo: string, porQue: string): string {
  const { tinta: TINTA, apoyo: APOYO, fuente: FUENTE } = coloresDe(m);
  // El isotipo dibujado (Sumied) si la marca lo tiene; si no, el cuadrado con la inicial.
  const logo = m.logo && m.logoCorreo
    ? `<td style="width:40px;height:40px;"><img src="${urlSegura(m.logoCorreo)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;" /></td>`
    : `<td style="width:40px;height:40px;border-radius:13px;background:${esc(m.colorLogo)};color:#FFFFFF;font-size:18px;font-weight:700;text-align:center;vertical-align:middle;">${esc(m.inicial)}</td>`;
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#F5F7FA;font-family:${FUENTE};color:${TINTA};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid ${BORDE};border-radius:24px;">
        <tr><td style="padding:28px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            ${logo}
            <td style="padding-left:12px;font-size:20px;font-weight:700;letter-spacing:-0.5px;color:${TINTA};">${esc(m.nombre)}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">${cuerpo}</td></tr>
        <tr><td style="padding:18px 32px 24px;border-top:1px solid ${BORDE};font-size:13px;line-height:1.5;color:${APOYO};">
          ${esc(porQue)}<br />${pie(m)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function boton(url: string, texto: string, c: Colores): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr>
    <td style="border-radius:12px;background:${c.azul};">
      <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">${esc(texto)}</a>
    </td></tr></table>`;
}

const h1 = (t: string, c: Colores) => `<h1 style="margin:0 0 8px;font-size:28px;font-weight:600;letter-spacing:-1px;line-height:1.2;color:${c.tinta};">${esc(t)}</h1>`;
const p = (html: string, c: Colores) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:${c.tinta};">${html}</p>`;
const nota = (html: string, c: Colores) => `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:${c.apoyo};">${html}</p>`;

/**
 * La invitación (maqueta del C06, una sola acción: «Entrar en tu contabilidad»).
 * data: { nombre?, empresa, enlace, diasCaducidad? }
 */
export function invitacion(m: Marca, data: Record<string, unknown>): CorreoMarca {
  const c = coloresDe(m);
  // C06, respuesta 4: se saluda con el nombre de pila, como la maqueta («Hola, Ana.»).
  const nombre = String(data.nombre ?? '').trim().split(/\s+/)[0] ?? '';
  const empresa = String(data.empresa ?? '').trim();
  const url = urlSegura(data.enlace);
  const diasN = Number(data.diasCaducidad);
  const dias = Number.isFinite(diasN) && diasN > 0 ? Math.floor(diasN) : 7;
  const saludo = nombre ? `Hola, ${esc(nombre)}.` : 'Hola.';
  const frase = empresa
    ? `La contabilidad de <strong>${esc(empresa)}</strong> ya está en ${esc(m.nombre)}. Entra, pon tu contraseña y te pregunto lo poco que necesito para dejarla en marcha.`
    : `Tu contabilidad ya está en ${esc(m.nombre)}. Entra, pon tu contraseña y te pregunto lo poco que necesito para dejarla en marcha.`;
  const cuerpo = `${h1('Entra en tu contabilidad', c)}${p(saludo, c)}${p(frase, c)}
    ${url ? boton(url, 'Entrar en tu contabilidad', c) : p('<em>El enlace no está disponible. Responde a este correo y te mandamos otro.</em>', c)}
    ${nota(`El enlace caduca a los ${dias} días. Si el botón no funciona, copia esta dirección en tu navegador:<br /><span style="color:${c.tinta};word-break:break-all;">${url}</span>`, c)}`;
  const texto = `${nombre ? `Hola, ${nombre}.` : 'Hola.'}\n\n` +
    `${empresa ? `La contabilidad de ${empresa}` : 'Tu contabilidad'} ya está en ${m.nombre}. Entra, pon tu contraseña y te pregunto lo poco que necesito para dejarla en marcha.\n\n` +
    `Entrar en tu contabilidad: ${url || '(enlace no disponible; responde a este correo)'}\n\n` +
    `El enlace caduca a los ${dias} días.\n\n${m.nombre}`;
  return {
    subject: `${m.nombre} · Entra en tu contabilidad`,
    html: marco(m, 'Entra en tu contabilidad', cuerpo, `Te llega porque te han dado de alta en ${m.nombre}, la contabilidad de tu empresa.`),
    text: texto,
  };
}

/** Contraseña olvidada, con la marca. data: { enlace } */
export function contrasena(m: Marca, data: Record<string, unknown>): CorreoMarca {
  const c = coloresDe(m);
  const url = urlSegura(data.enlace);
  const cuerpo = `${h1('Pon una contraseña nueva', c)}${p('Alguien ha pedido cambiar la contraseña de esta cuenta. Si has sido tú, pulsa el botón y elige una nueva.', c)}
    ${url ? boton(url, 'Poner una contraseña nueva', c) : p('<em>El enlace no está disponible. Vuelve a pedirlo desde la pantalla de entrada.</em>', c)}
    ${nota(`Si no lo has pedido tú, no hagas nada: tu contraseña sigue igual. Si el botón no funciona, copia esta dirección:<br /><span style="color:${c.tinta};word-break:break-all;">${url}</span>`, c)}`;
  return {
    subject: `${m.nombre} · Contraseña nueva`,
    html: marco(m, 'Pon una contraseña nueva', cuerpo, `Te llega porque se ha pedido desde la entrada de ${m.nombre}.`),
    text: `Alguien ha pedido cambiar la contraseña de esta cuenta. Si has sido tú, elige una nueva aquí:\n\n${url || '(enlace no disponible)'}\n\nSi no lo has pedido tú, no hagas nada.\n\n${m.nombre}`,
  };
}

/**
 * Aviso de «contraseña cambiada», con la marca (Julio, C06 respuesta 2: lo
 * normal en cualquier producto serio). Sin botón para entrar: quien la cambió
 * ya está dentro. Si no fue la persona, el aviso le dice qué hacer.
 * data: { cuando (texto ya en hora de Madrid), entrar? (la entrada de la marca) }
 */
export function contrasenaCambiada(m: Marca, data: Record<string, unknown>): CorreoMarca {
  const c = coloresDe(m);
  const cuando = String(data.cuando ?? '').trim();
  const url = urlSegura(data.entrar);
  const cuandoHtml = cuando ? ` el <strong>${esc(cuando)}</strong>` : '';
  const siNo = url
    ? `Si no has sido tú, entra en <a href="${url}" style="color:${c.azul};">${esc(m.nombre)}</a>, pulsa «He olvidado la contraseña» y pon otra cuanto antes.`
    : `Si no has sido tú, pide una contraseña nueva desde la entrada de ${esc(m.nombre)} («He olvidado la contraseña») cuanto antes.`;
  const cuerpo = `${h1('Tu contraseña ha cambiado', c)}${p(`La contraseña de tu cuenta de ${esc(m.nombre)} se ha cambiado${cuandoHtml}.`, c)}
    ${p('Si has sido tú, no tienes que hacer nada.', c)}
    ${nota(siNo, c)}`;
  return {
    subject: `${m.nombre} · Tu contraseña ha cambiado`,
    html: marco(m, 'Tu contraseña ha cambiado', cuerpo, `Te llega porque se ha cambiado la contraseña de tu cuenta de ${m.nombre}. Lo avisamos siempre.`),
    text: `La contraseña de tu cuenta de ${m.nombre} se ha cambiado${cuando ? ` el ${cuando}` : ''}.\n\n` +
      `Si has sido tú, no tienes que hacer nada.\n\n` +
      `Si no has sido tú, pide una contraseña nueva desde la entrada${url ? ` (${url})` : ''} con «He olvidado la contraseña», cuanto antes.\n\n${m.nombre}`,
  };
}

/**
 * I01b · Una empresa invita a su asesoría a llevar sus impuestos.
 * data: { asesoria, empresa, invita, base ('social_collaborator' | 'power_of_attorney'), enlace, caduca ('dd/mm') }
 */
export function invitacionAsesoria(m: Marca, data: Record<string, unknown>): CorreoMarca {
  const c = coloresDe(m);
  const empresa = String(data.empresa ?? '').trim() || 'una empresa';
  const invita = String(data.invita ?? '').trim();
  const asesoria = String(data.asesoria ?? '').trim();
  const url = urlSegura(data.enlace);
  const caduca = String(data.caduca ?? '').trim();
  const como = data.base === 'power_of_attorney' ? 'con el poder que tiene en Hacienda' : 'como colaboradora social';
  const quien = invita ? `${esc(invita)}, de <strong>${esc(empresa)}</strong>,` : `<strong>${esc(empresa)}</strong>`;
  const frase = `${quien} te invita a llevar sus impuestos en ${esc(m.nombre)}${asesoria ? ` como ${esc(asesoria)}` : ''}, ${como}. Verás su calendario de impuestos, sus declaraciones y sus libros de IVA.`;
  const despues = 'Si ya usas Sumied con este correo, al aceptar la verás en Impuestos. Si no, aceptas y te damos de alta: te llegará otro correo para poner tu contraseña.';
  const cuerpo = `${h1('Te invitan a llevar sus impuestos', c)}${p('Hola.', c)}${p(frase, c)}${p(esc(despues), c)}
    ${url ? boton(url, 'Ver la invitación', c) : p('<em>El enlace no está disponible. Pide a la empresa que te mande otra.</em>', c)}
    ${nota(`${caduca ? `La invitación caduca el ${esc(caduca)}. ` : ''}Si el botón no funciona, copia esta dirección en tu navegador:<br /><span style="color:${c.tinta};word-break:break-all;">${url}</span>`, c)}`;
  const texto = `Hola.\n\n${invita ? `${invita}, de ${empresa},` : empresa} te invita a llevar sus impuestos en ${m.nombre}${asesoria ? ` como ${asesoria}` : ''}, ${como}.\n\n` +
    `${despues}\n\nVer la invitación: ${url || '(enlace no disponible)'}\n\n${caduca ? `La invitación caduca el ${caduca}.\n\n` : ''}${m.nombre}`;
  return {
    subject: `${m.nombre} · ${empresa} te invita a llevar sus impuestos`,
    html: marco(m, 'Te invitan a llevar sus impuestos', cuerpo, `Te llega porque ${empresa} ha escrito este correo como el de su asesoría. Si no es así, no hagas nada: sin aceptar, no pasa nada.`),
    text: texto,
  };
}

export const PLANTILLAS_MARCA: Record<string, (m: Marca, d: Record<string, unknown>) => CorreoMarca> = {
  invitacion_asesoria: invitacionAsesoria,
  invitacion_conta: invitacion,
  contrasena_conta: contrasena,
  contrasena_cambiada_conta: contrasenaCambiada,
};
