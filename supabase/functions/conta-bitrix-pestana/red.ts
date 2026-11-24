// supabase/functions/conta-bitrix-pestana/red.ts
//
// GBd · El plan B, en PRUEBAS: la red de seguridad de la «Cuota mensual» de la
// ficha de empresa de Bitrix24. Si alguien la cambia en Bitrix24, Sumied, al
// momento, devuelve su valor, avisa por correo a quien la cambió y a la persona
// responsable, y lo apunta en el historial de la ficha.
//
// Lo decide este fichero, sin Deno ni red (lo prueban las unitarias):
//   · qué hacer (decidirRed): nada, devolver o parar (el freno del bucle);
//   · la nota del historial y el correo, en frases de oficina.
// La lectura, la escritura y el envío los hace index.ts (paso «red»).

import { centDeTexto, cuotaEnBitrix } from './escribir.ts'
import { PORTAL_DE_PRUEBAS } from './puro.ts'

/** Solo en el Bitrix24 de pruebas. En el real, más adelante y con el sí de Julio. */
export const redEnEstePortal = (portal: string | null) => portal === PORTAL_DE_PRUEBAS

/** Cuántas devoluciones de un mismo campo en 10 minutos antes de parar. */
export const DEVOLUCIONES_SEGUIDAS = 3

export type Decision =
  | { hacer: 'nada'; porque: string }
  | { hacer: 'devolver'; antes: string; despues: string }
  | { hacer: 'parar'; antes: string; despues: string }

/**
 * Qué hacer con la cuota que hay en Bitrix24 («actual») y la de Sumied (en
 * céntimos). Se compara el importe, no el texto («200», «200,00 €» y «200,00»
 * son lo mismo). Vacía en Bitrix24, también se devuelve. Sin cuota en Sumied (0 o
 * no se sabe), no se toca. Si en 10 minutos ya
 * se ha devuelto el campo DEVOLUCIONES_SEGUIDAS veces, se para: algo la está
 * cambiando sin parar y Sumied no se pelea con ello.
 * Nuestra propia escritura vuelve a disparar el aviso: entonces ya coincide, y
 * no se hace nada.
 */
export function decidirRed(o: { actual: unknown; sumiedCent: number | null; recientes: number }): Decision {
  if (o.sumiedCent === null) return { hacer: 'nada', porque: 'Sumied no sabe la cuota de este cliente' }
  // Sin cuota en Sumied (aún no se le cobra nada), no se pisa lo que haya escrito el equipo.
  if (o.sumiedCent === 0) return { hacer: 'nada', porque: 'Sumied no le cobra cuota' }
  const despues = cuotaEnBitrix(o.sumiedCent)
  const actual = centDeTexto(o.actual)
  if (actual === o.sumiedCent) return { hacer: 'nada', porque: 'coincide con Sumied' }
  const antes = actual === null ? 'vacía' : cuotaEnBitrix(actual)
  if (o.recientes >= DEVOLUCIONES_SEGUIDAS) return { hacer: 'parar', antes, despues }
  return { hacer: 'devolver', antes, despues }
}

const euros = (x: string) => (x === 'vacía' ? 'vacía' : `${x} €`)

/** La nota en el historial de la ficha. */
export function notaDeLaRed(antes: string, despues: string): string {
  return `Sumied deshizo un cambio en la Cuota mensual: ${euros(antes)} → ${euros(despues)}. Se cambia en la pestaña Sumied.`
}

/** Quién la cambió: el último que modificó la empresa. Si Bitrix24 no lo dice, «no se sabe»; nunca se inventa. */
export const quienDeLaRed = (nombre: string | null) => (nombre && nombre.trim() ? nombre.trim() : 'no se sabe')

const html = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface CorreoDeLaRed { asunto: string; html: string; texto: string }

/**
 * El correo a quien la cambió y a la persona responsable. Corto, sin jerga y
 * legible en el móvil: arriba qué ha pasado, una tabla de dos filas («Lo que
 * pusiste» y «Lo que queda») y el botón «Abrir la ficha».
 */
export function correoDeLaRed(d: { empresa: string; antes: string; despues: string; quien: string; cuando: string; enlace: string }): CorreoDeLaRed {
  const asunto = `Cambio deshecho en ${d.empresa}`
  const arriba = `Sumied ha vuelto a poner la Cuota mensual de ${d.empresa}: la cambió ${d.quien} el ${d.cuando}, y esa cuota la pone Sumied.`
  const donde = 'Si hay que cambiarla, se cambia en la pestaña Sumied de la ficha.'
  const texto = [arriba, '', `Lo que pusiste: ${euros(d.antes)}`, `Lo que queda: ${euros(d.despues)}`, '', donde, '', `Abrir la ficha: ${d.enlace}`].join('\n')
  const fila = (t: string, v: string, fuerte: boolean) =>
    `<tr><td style="padding:10px 12px;border-top:1px solid #E3E8F0;color:#4A5B74">${t}</td><td style="padding:10px 12px;border-top:1px solid #E3E8F0;text-align:right;${fuerte ? 'font-weight:700;color:#0F1B2D' : 'color:#4A5B74;text-decoration:line-through'}">${html(euros(v))}</td></tr>`
  const cuerpo = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(asunto)}</title></head>
<body style="margin:0;padding:0;background:#F4F6FA;font:15px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#0F1B2D">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:14px;padding:22px 20px">
<p style="margin:0 0 6px;font-weight:700;font-size:17px">${html(asunto)}</p>
<p style="margin:0 0 16px">${html(arriba)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">${fila('Lo que pusiste', d.antes, false)}${fila('Lo que queda', d.despues, true)}</table>
<p style="margin:16px 0 20px;color:#4A5B74">${html(donde)}</p>
<a href="${html(d.enlace)}" style="display:inline-block;background:#1F5BD8;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Abrir la ficha</a>
</div>
<p style="margin:14px 4px 0;font-size:12px;color:#8A97AB">Sumied · cuotas, recibos y facturas</p>
</div></body></html>`
  return { asunto, html: cuerpo, texto }
}

/** La fecha y la hora de Madrid, como en la oficina: «12/11/2026 a las 10:05». */
export function cuandoEnMadrid(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} a las ${p.hour}:${p.minute}`
}

/** La dirección de la ficha de empresa en Bitrix24. */
export const enlaceDeLaFicha = (portal: string, id: string) => `https://${portal}/crm/company/details/${id}/`

/** Qué hacer con la respuesta de Resend: enviado, sin cupo (429) o no enviado. Nunca se pierde en silencio. */
export function resultadoDelCorreo(status: number, cuerpo: unknown): { correo: 'enviado' | 'cupo' | 'no_enviado'; porque: string | null } {
  if (status >= 200 && status < 300) return { correo: 'enviado', porque: null }
  const msg = String((cuerpo as { message?: unknown } | null)?.message ?? '').slice(0, 120)
  if (status === 429) return { correo: 'cupo', porque: `Resend no deja mandar más correos ahora (429)${msg ? `: ${msg}` : ''}.` }
  return { correo: 'no_enviado', porque: `Resend contestó ${status}${msg ? `: ${msg}` : ''}.` }
}
