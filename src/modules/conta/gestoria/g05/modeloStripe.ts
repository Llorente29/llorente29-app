// src/modules/conta/gestoria/g05/modeloStripe.ts
//
// G05 · nº 61 · «Pagos con tarjeta» (maqueta Stripe.dc.html, v23): lo que
// dicen Ajustes › Cobros y la ficha del cliente de la cuenta del dinero de las
// tarjetas (Stripe) y del pago que espera a apuntarse. Puro: recibe lo que da la
// base (conta_cobro_cuenta_stripe_leer, conta_cobro_cuenta_stripe_poner y
// conta_recibo_apuntar_pendiente) y devuelve los textos de la maqueta. Lo
// prueban tests/unit/modules/conta/gestoria/g05/modeloStripe.test.ts.

export type MotivoCuenta = 'sin_cuenta' | 'de_banco' | 'otro_nombre' | null
export type Tono = 'ok' | 'mal' | 'ambar'

/** Cómo está la cuenta de Stripe (la puesta, o la que se ha intentado guardar). */
export interface EstadoCuenta { cuenta: string | null; nombre: string | null; motivo: MotivoCuenta; banco: string | null }

/** Un pago con tarjeta que espera, o uno apuntado hoy. */
export interface PagoTarjeta {
  id?: string
  recibo: string
  cliente: string | null
  partyId?: string | null
  mes: string
  importe: number
  referencia: string
  pagadoEl: string | null
  /** La factura que ya tiene el recibo (un retrocedido después de cobrarse); sin ella, sale al apuntar. */
  numero: string | null
}

export interface DatosStripe extends EstadoCuenta { pendientes: PagoTarjeta[]; apuntadosHoy: PagoTarjeta[] }

export interface Apunte { codigo: string; nombre: string; debe: number; haber: number }
export interface AsientoPago { tipo: 'factura' | 'cobro'; id: string; apuntes: Apunte[] }

/** Lo que devuelve «Apuntar el pago» cuando se apunta. */
export interface PagoApuntado {
  recibo: string; mes: string; importe: number; factura: string | null; numero: string | null; facturaNueva: boolean
  quien: string | null; cuando: string | null; cuenta: string; asientos: AsientoPago[]; frase: string
}

/** Lo que dijo el envío de su factura (conta-cobro, «rematar»): cuántas salieron y lo que no salió. */
export interface Envio { enviadas: number; sinEnviar: string[]; fallos: string[] }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const EJEMPLO = 'Elige otra 572, por ejemplo la 57200003.'

/** 181,5 → «181,50 €» (con el punto de los miles también en las de 4 cifras). */
export const euros = (n: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(n)} €`

/** «2026-11» → «noviembre». */
export const nombreMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes

/** Una fecha (ISO) en Madrid: «9 de diciembre». */
export function dia(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })
}

/** La hora (ISO) en Madrid: «20:52». */
export const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '')

/** La referencia, corta: «ch_000…4F2A» (las seis primeras y las cuatro últimas). */
export const referenciaCorta = (r: string) => (r.length > 12 ? `${r.slice(0, 6)}…${r.slice(-4)}` : r)

/** El mensaje de la cuenta, con sus cuatro casos de la maqueta (y el de un error de forma, al guardar). */
export function mensajeCuenta(e: EstadoCuenta, guardada = false): { tono: Tono; titulo: string; texto: string } {
  if (e.motivo === 'sin_cuenta' || !e.cuenta) return {
    tono: 'ambar', titulo: 'Falta la cuenta',
    texto: 'Mientras no la pongas, los pagos con tarjeta no se apuntan: esperan aquí y en la ficha de cada cliente. Puedes usar una nueva, por ejemplo la 57200003: la creamos con el nombre «Plataforma Stripe».',
  }
  if (e.motivo === 'otro_nombre') return {
    tono: 'mal', titulo: `Esa cuenta ya existe y se llama «${e.nombre ?? ''}»`, texto: `No la usamos para no mezclar dinero distinto. ${EJEMPLO}`,
  }
  if (e.motivo === 'de_banco') return {
    tono: 'mal', titulo: `La ${e.cuenta} es tu banco${e.banco ? ` (${e.banco})` : ''}`,
    texto: `El dinero de las tarjetas no entra directo en el banco: pasa antes por Stripe. ${EJEMPLO}`,
  }
  return {
    tono: 'ok', titulo: `${guardada ? 'Guardada · ' : ''}${e.cuenta} «${e.nombre ?? 'Plataforma Stripe'}»`,
    texto: 'Los pagos con tarjeta entran aquí.',
  }
}

/** El error de forma al guardar (no es una 572 o no tiene las cifras del plan), con el texto de la base. */
export const mensajeError = (texto: string) => ({ tono: 'mal' as Tono, titulo: 'No se ha guardado', texto })

export const vale = (e: EstadoCuenta) => !!e.cuenta && e.motivo === null

/** La línea de un pago en Ajustes: «Recibo de noviembre · pagó el 9 de diciembre · ch_000…4F2A». */
export const detallePago = (p: PagoTarjeta) =>
  [`Recibo de ${nombreMes(p.mes)}`, p.pagadoEl ? `pagó el ${dia(p.pagadoEl)}` : null, referenciaCorta(p.referencia)].filter(Boolean).join(' · ')

/** El título de la lista de Ajustes. */
export function tituloLista(d: Pick<DatosStripe, 'pendientes' | 'apuntadosHoy'>): string {
  if (d.pendientes.length > 0) return `Pagos con tarjeta que esperan · ${d.pendientes.length} · ${euros(d.pendientes.reduce((s, p) => s + p.importe, 0))}`
  if (d.apuntadosHoy.length > 0) return 'Pagos con tarjeta · apuntados hoy'
  return 'Pagos con tarjeta que esperan'
}

/** El botón de la lista: «Apuntar los 2 pagos» (con uno, «Apuntar el pago»). */
export const botonTodos = (n: number) => (n === 1 ? 'Apuntar el pago' : `Apuntar los ${n} pagos`)

/** El porqué del aviso de la ficha, según cómo está ahora la cuenta. */
export function porQue(e: EstadoCuenta): string {
  if (e.motivo === 'sin_cuenta' || !e.cuenta) return 'falta decir en qué cuenta de tu contabilidad entra el dinero de las tarjetas.'
  if (e.motivo === 'otro_nombre') return `la cuenta que pusiste (${e.cuenta}) ya existe con otro nombre.`
  if (e.motivo === 'de_banco') return `la cuenta que pusiste (${e.cuenta}) es tu banco.`
  return 'ya está la cuenta de Stripe: puedes apuntarlo.'
}

/** El aviso de la ficha, «Pagó con tarjeta y falta apuntarlo». */
export function avisoFicha(p: PagoTarjeta, e: EstadoCuenta) {
  const mes = nombreMes(p.mes)
  return {
    titulo: `Pagó con tarjeta y falta apuntarlo · ${euros(p.importe)}`,
    texto: `${p.pagadoEl ? `El ${dia(p.pagadoEl)} pagó` : 'Pagó'} desde su portal el recibo de ${mes} que se había devuelto. El dinero está en Stripe, pero`,
    porQue: porQue(e),
    detalle: [`Recibo de ${mes}`, p.numero ? `su factura ${p.numero} ya estaba emitida` : 'sin factura hasta que se apunte el pago', `referencia ${referenciaCorta(p.referencia)}`].join(' · '),
    puede: vale(e),
    enlace: vale(e) ? 'Ver en Ajustes › Cobros' : 'Poner la cuenta en Ajustes › Cobros →',
  }
}

/** Lo que pasó con el correo de su factura, en la frase del bloque verde. */
function correo(envio: Envio | null): string {
  if (!envio) return ''
  if (envio.enviadas > 0) return ' y se le ha enviado por correo'
  return ''
}

/** El bloque verde, al apuntar: el título, la frase y, si el correo no salió, por qué. */
export function bloqueHecho(a: PagoApuntado, envio: Envio | null, hoy: string) {
  const esHoy = a.cuando ? new Date(a.cuando).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }) === hoy : true
  const cuando = a.cuando ? `${esHoy ? 'hoy' : `el ${dia(a.cuando)}`} a las ${hora(a.cuando)}` : 'ahora'
  const factura = a.numero
    ? a.facturaNueva ? `Ha salido la factura ${a.numero}${correo(envio)}.` : `Su factura ${a.numero} ya estaba emitida.`
    : ''
  const noSalio = envio && envio.enviadas === 0 ? [...envio.sinEnviar, ...envio.fallos] : []
  return {
    titulo: `Apuntado: el recibo de ${nombreMes(a.mes)} está pagado · ${euros(a.importe)}`,
    texto: `Lo apuntaste tú, ${cuando}. ${factura}${factura ? ' ' : ''}Ya no está en «Te deben» ni en «Pendiente de revisar».`,
    numero: a.numero,
    noSalio,
  }
}

/** Las filas de un asiento como en la maqueta: cada «Debe» en la suya y los «Haber» juntos en una. */
export function filasAsiento(a: AsientoPago, numero: string | null) {
  const debe = a.apuntes.filter((x) => x.debe > 0)
  const haber = a.apuntes.filter((x) => x.haber > 0)
  return {
    titulo: a.tipo === 'factura' ? `Factura ${numero ?? ''}`.trim() : 'Cobro con tarjeta',
    filas: [
      ...debe.map((x) => ({ lado: 'Debe' as const, cuentas: [{ codigo: x.codigo, nombre: x.nombre }], importe: euros(x.debe) })),
      ...(haber.length ? [{ lado: 'Haber' as const, cuentas: haber.map((x) => ({ codigo: x.codigo, nombre: x.nombre })), importe: haber.map((x) => euros(x.haber)).join(' · ') }] : []),
    ],
  }
}
