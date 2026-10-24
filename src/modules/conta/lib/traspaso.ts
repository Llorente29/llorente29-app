// src/modules/conta/lib/traspaso.ts
//
// C12 (Julio, 24/10) · TRASPASAR EL MES A DIEZ: lo que la pantalla dice, sin
// tocar la base (lo prueba tests/conta/traspaso.test.ts). Palabras de la
// calle: traspasar, cerrar el mes. Nunca «cola», «envío» ni nada de dentro.
//
//   · fraseDelMes: el estado del mes en una frase («Octubre está listo para
//     traspasar», «Faltan 3 cosas antes de traspasar octubre»…).
//   · queFalta: cada cosa que falta, en una frase con su número.
//   · porTipo: lo que va, por tipo, con su nombre de calle.
//   · informe: el registro del traspaso para descargar (CSV, con «;»).

export type Falta = { codigo: 'asientos' | 'recibidas_sin_pdf' | 'cierres_en_espera' | 'liquidaciones_con_diferencia' | string; n: number }
export type PorTipo = { tipo: string; n: number }
export type PorCuenta = { cuenta: string; nombre: string | null; debe: number; haber: number }
export type FalloTraspaso = { entry_id: string; numero: number | null; motivo: string }
export type DiferenciaCuadre = { cuenta: string; nombre: string | null; sumied: { debe: number; haber: number }; diez: { debe: number; haber: number }; falta_debe: number; falta_haber: number }
export type Cuadre = { cuadra?: boolean; cuentas?: number; diferencias?: DiferenciaCuadre[]; solo_en_diez?: { cuenta: string; debe: number; haber: number }[]; error?: string; base?: string; comprobado_en?: string }

export type EstadoTraspaso = 'confirmado' | 'traspasando' | 'terminado' | 'con_fallos'
export type Traspaso = {
  id: string; mes: string; estado: EstadoTraspaso
  confirmado_por_nombre: string | null; confirmado_en: string
  faltaba: Falta[]; resumen?: { por_tipo?: PorTipo[]; por_cuenta?: PorCuenta[] }; van: number; llegaron: number; no_llegaron: number
  detalle?: FalloTraspaso[]; cuadre: Cuadre | null; cuadra: boolean | null
  mes_cerrado: boolean; cierre_motivo: string | null; terminado_en: string | null
}
export type Revision = {
  mes: string; faltan: Falta[]; van: number; por_tipo: PorTipo[]; por_cuenta: PorCuenta[]
  ya_en_diez: number; no_viajan: number; traspaso: Traspaso | null; mes_cerrado: boolean
  modo: 'al_validar' | 'mensual'; conectado: boolean
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «octubre» (del mes AAAA-MM-01). */
export const nombreDelMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

/** ¿Ha terminado el mes? (hoy, AAAA-MM-DD en Madrid). */
export const mesTerminado = (mes: string, hoy: string) => mes.slice(0, 7) < hoy.slice(0, 7)
/** El primer día del mes siguiente, en palabras («1 de noviembre»). */
export function primerDiaSiguiente(mes: string): string {
  const m = Number(mes.slice(5, 7))
  return `1 de ${MESES[m % 12]}`
}

/** Cuántas cosas faltan, sumadas (tres asientos sin validar son tres cosas). */
export const cuantasFaltan = (faltan: readonly Falta[]) => faltan.reduce((s, f) => s + Math.max(0, Number(f.n) || 0), 0)

/** El estado del mes en una frase. */
export function fraseDelMes(r: Revision, hoy: string): string {
  const mes = nombreDelMes(r.mes)
  const t = r.traspaso
  if (t?.estado === 'terminado') {
    if (r.mes_cerrado) return `${mayuscula(mes)} está traspasado a Diez y cerrado.`
    return `${mayuscula(mes)} está traspasado a Diez, pero sin cerrar${t.cierre_motivo ? `: ${t.cierre_motivo.replace(/^No se cierra el mes: /, '').replace(/\.$/, '')}` : ''}.`
  }
  if (t?.estado === 'con_fallos') return `${mayuscula(mes)} se traspasó, pero ${plural(t.no_llegaron, 'asiento no ha llegado', 'asientos no han llegado')} a Diez.`
  if (t?.estado === 'traspasando') return `${mayuscula(mes)} se está traspasando a Diez: van ${t.llegaron.toLocaleString('es-ES')} de ${t.van.toLocaleString('es-ES')}.`
  if (!mesTerminado(r.mes, hoy)) return `${mayuscula(mes)} aún no ha terminado: se traspasa a partir del ${primerDiaSiguiente(r.mes)}.`
  const n = cuantasFaltan(r.faltan)
  if (n > 0) return `${n === 1 ? 'Falta 1 cosa' : `Faltan ${n.toLocaleString('es-ES')} cosas`} antes de traspasar ${mes}.`
  if (r.van === 0) return `${mayuscula(mes)} no tiene nada por traspasar a Diez.`
  return `${mayuscula(mes)} está listo para traspasar.`
}

/** Cada cosa que falta, en una frase (las que no tienen nada no salen: «faltan» ya viene sin ceros). */
export function queFalta(faltan: readonly Falta[]): { codigo: string; texto: string }[] {
  return faltan.filter((f) => f.n > 0).map((f) => {
    switch (f.codigo) {
      case 'asientos': return { codigo: f.codigo, texto: `${plural(f.n, 'asiento', 'asientos')} del mes sin validar` }
      case 'recibidas_sin_pdf': return { codigo: f.codigo, texto: `${plural(f.n, 'factura recibida', 'facturas recibidas')} sin su PDF` }
      case 'cierres_en_espera': return { codigo: f.codigo, texto: `${plural(f.n, 'pedido cerrado sin cobrar espera', 'pedidos cerrados sin cobrar esperan')} que decidas qué hacer` }
      case 'liquidaciones_con_diferencia': return { codigo: f.codigo, texto: `${plural(f.n, 'liquidación cobrada', 'liquidaciones cobradas')} con diferencia` }
      default: return { codigo: f.codigo, texto: plural(f.n, 'cosa', 'cosas') }
    }
  })
}

const NOMBRE_TIPO: Record<string, string> = {
  ventas: 'Ventas', recibidas: 'Facturas recibidas', banco: 'Banco', liquidaciones: 'Liquidaciones',
  manuales: 'Asientos a mano', anulacion: 'Anulaciones de lo que ya estaba en Diez',
}
const ORDEN_TIPO = ['ventas', 'recibidas', 'banco', 'liquidaciones', 'manuales', 'anulacion']
/** Lo que va, por tipo, en el orden de siempre y con su nombre. */
export function porTipo(xs: readonly PorTipo[]): { tipo: string; nombre: string; n: number }[] {
  return [...xs].filter((x) => x.n > 0)
    .sort((a, b) => (ORDEN_TIPO.indexOf(a.tipo) + 1 || 99) - (ORDEN_TIPO.indexOf(b.tipo) + 1 || 99))
    .map((x) => ({ tipo: x.tipo, nombre: NOMBRE_TIPO[x.tipo] ?? x.tipo, n: x.n }))
}

/** El resultado del cuadre en una frase («Cuadra» o qué cuenta difiere y por cuánto). */
export function fraseDelCuadre(c: Cuadre | null, cuadra: boolean | null, euros: (x: number) => string): string {
  if (!c) return 'Aún no se ha comprobado con Diez.'
  if (c.error || cuadra === null) return `No se ha podido comprobar con Diez: ${c.error ?? 'sin respuesta'}.`
  if (cuadra) return `Cuadra: ${plural(c.cuentas ?? 0, 'cuenta tiene', 'cuentas tienen')} en Diez lo mismo que en Sumied.`
  const d = c.diferencias ?? []
  const primera = d[0]
  const cuanto = primera ? [primera.falta_debe ? `${euros(Math.abs(primera.falta_debe))} ${primera.falta_debe > 0 ? 'menos' : 'más'} en el debe` : null,
    primera.falta_haber ? `${euros(Math.abs(primera.falta_haber))} ${primera.falta_haber > 0 ? 'menos' : 'más'} en el haber` : null].filter(Boolean).join(' y ') : ''
  return d.length === 1
    ? `No cuadra la ${primera.cuenta}${primera.nombre ? ` (${primera.nombre})` : ''}: Diez tiene ${cuanto}.`
    : `No cuadran ${d.length} cuentas; la primera, la ${primera.cuenta}: Diez tiene ${cuanto}.`
}

const celda = (x: unknown) => {
  const s = x == null ? '' : String(x)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const fila = (...xs: unknown[]) => xs.map(celda).join(';')
const DOS = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
const num = (x: unknown) => DOS.format(Number(x) || 0)

/** El registro del traspaso, para descargar: quién, cuándo, cuántos y el resultado. */
export function informe(r: Revision, t: Traspaso): string {
  const l: string[] = []
  l.push(fila('Traspaso a Diez', `${nombreDelMes(r.mes)} de ${r.mes.slice(0, 4)}`))
  l.push(fila('Confirmado por', t.confirmado_por_nombre ?? ''), fila('Confirmado el', t.confirmado_en))
  l.push(fila('Estado', { confirmado: 'Confirmado', traspasando: 'Traspasándose', terminado: 'Terminado', con_fallos: 'Con fallos' }[t.estado]))
  l.push(fila('Iban', t.van), fila('Han llegado', t.llegaron), fila('No han llegado', t.no_llegaron))
  l.push(fila('Cuadre con Diez', t.cuadra === true ? 'Cuadra' : t.cuadra === false ? 'No cuadra' : 'Sin comprobar'))
  l.push(fila('Mes cerrado', t.mes_cerrado ? 'Sí' : 'No'), fila('Por qué no se cerró', t.cierre_motivo ?? ''), fila('Terminado el', t.terminado_en ?? ''))
  l.push('')
  l.push(fila('Lo que faltaba al confirmar'))
  const f = queFalta(t.faltaba ?? [])
  if (!f.length) l.push(fila('Nada'))
  for (const x of f) l.push(fila(x.texto))
  l.push('')
  l.push(fila('Lo que iba', 'Asientos'))
  for (const x of porTipo(t.resumen?.por_tipo ?? r.por_tipo)) l.push(fila(x.nombre, x.n))
  l.push('')
  l.push(fila('Lo que no ha llegado', 'Número', 'Por qué'))
  for (const x of t.detalle ?? []) l.push(fila(x.entry_id, x.numero ?? '', x.motivo))
  if (!(t.detalle ?? []).length) l.push(fila('Nada'))
  l.push('')
  l.push(fila('Cuenta', 'Nombre', 'Debe en Sumied', 'Haber en Sumied', 'Debe en Diez', 'Haber en Diez'))
  for (const d of t.cuadre?.diferencias ?? []) l.push(fila(d.cuenta, d.nombre ?? '', num(d.sumied.debe), num(d.sumied.haber), num(d.diez.debe), num(d.diez.haber)))
  if (!(t.cuadre?.diferencias ?? []).length) l.push(fila(t.cuadra ? 'Todas cuadran' : 'Sin diferencias apuntadas'))
  if ((t.cuadre?.solo_en_diez ?? []).length) {
    l.push('')
    l.push(fila('Solo en Diez (no las movió Sumied)', '', 'Debe', 'Haber'))
    for (const d of t.cuadre!.solo_en_diez!) l.push(fila(d.cuenta, '', num(d.debe), num(d.haber)))
  }
  return l.join('\r\n') + '\r\n'
}
