// src/modules/conta/lib/cobros.ts
//
// PC01 · Entrega 3 · Ventas › Cobros (tableros cobros-1 y cobros-2), sin React:
// las filas de conta_cobros_lista, su estado y su chip, las pestañas, las
// cifras de arriba, la próxima remesa, qué entra en una remesa de recibos y por
// qué no, los pasos de una remesa, y lo que Bancos propone para un abono o una
// devolución.
//
// Las pestañas (tablero cobros-1): Por cobrar · Vencidas · Próxima remesa ·
// Remesas · Devueltos · Cobrados. «Por cobrar» es todo lo que queda por cobrar
// (regla 7: ninguna fila se esconde); las demás son trozos de ella, «Remesas» es
// otra lista y «Cobrados» va aparte. El estado viene de la base
// (conta_factura_cobro, PC01 · E1), con dos capas más: «En la remesa» cuando lo
// pendiente ya está en una remesa que espera el abono, y «Devuelto».

export type FormaCobro = 'transfer' | 'direct_debit' | 'card' | 'cash' | 'prepaid' | 'plataforma' | null
export type EstadoCobro =
  | 'cobrada' | 'en_remesa' | 'devuelto' | 'vencida' | 'falta_liquidacion' | 'esperando_liquidacion'
  | 'falta_mandato' | 'proxima_remesa' | 'cobrada_parte' | 'vence_semana' | 'por_cobrar'

export interface FilaCobro {
  id: string
  clienteId: string | null
  cliente: string
  numero: string | null
  fecha: string | null
  vence: string | null
  total: number
  cobrado: number
  pendiente: number
  /** El de la base (conta_factura_cobro). */
  estadoBase: string
  diasVencida: number | null
  forma: FormaCobro
  localId: string | null
  local: string | null
  mandato: string | null
  mandatoFirmado: string | null
  conMandato: boolean
  iban4: string | null
  conCuenta: boolean
  remesa: { id: string; codigo: string; importe: number; cargo: string | null } | null
  devuelto: { linea: string; remesa: string; codigo: string; fecha: string | null; motivo: string | null; gastos: number } | null
}

const num = (x: unknown) => (x === null || x === undefined || x === '' ? 0 : Number(x))
const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
const FORMAS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'prepaid', 'plataforma'])
const r2 = (x: number) => Math.round(x * 100) / 100

export function filaCobro(f: Record<string, unknown>): FilaCobro {
  const r = f.remesa as Record<string, unknown> | null
  const d = f.devuelto as Record<string, unknown> | null
  return {
    id: String(f.id), clienteId: str(f.party_id), cliente: str(f.cliente) ?? 'Sin cliente', numero: str(f.numero), fecha: str(f.fecha),
    vence: str(f.vence), total: num(f.total), cobrado: num(f.cobrado), pendiente: num(f.pendiente), estadoBase: String(f.estado ?? ''),
    diasVencida: f.dias_vencida === null || f.dias_vencida === undefined ? null : Number(f.dias_vencida),
    forma: FORMAS.has(String(f.forma)) ? (String(f.forma) as FormaCobro) : null, localId: str(f.location_id), local: str(f.local),
    mandato: str(f.mandato), mandatoFirmado: str(f.mandato_firmado), conMandato: f.con_mandato === true, iban4: str(f.iban4), conCuenta: f.con_cuenta === true,
    remesa: r ? { id: String(r.id), codigo: String(r.codigo), importe: num(r.importe), cargo: str(r.cargo) } : null,
    devuelto: d ? { linea: String(d.linea), remesa: String(d.remesa), codigo: String(d.codigo), fecha: str(d.fecha), motivo: str(d.motivo), gastos: num(d.gastos) } : null,
  }
}

/** Lo que le queda sin remesa (lo que se puede cobrar hoy). */
export const libre = (f: FilaCobro) => r2(f.pendiente - (f.remesa?.importe ?? 0))
/** ¿Se cobra por remesa de recibos y tiene su mandato firmado? */
export const domiciliadaConMandato = (f: FilaCobro) => f.forma === 'direct_debit' && f.conMandato

/** El estado de la fila: el de la base, con «En la remesa», «Devuelto», «Falta el mandato» y «Próxima remesa». */
export function estadoCobro(f: FilaCobro): EstadoCobro {
  if (f.estadoBase === 'cobrada' || f.pendiente < 0.005) return 'cobrada'
  if (f.remesa && libre(f) < 0.005) return 'en_remesa'
  if (f.devuelto) return 'devuelto'
  if (f.estadoBase === 'vencida') return 'vencida'
  if (f.estadoBase === 'falta_liquidacion' || f.estadoBase === 'esperando_liquidacion') return f.estadoBase
  if (f.forma === 'direct_debit') return f.conMandato ? 'proxima_remesa' : 'falta_mandato'
  if (f.estadoBase === 'cobrada_parte' || f.estadoBase === 'vence_semana') return f.estadoBase
  return 'por_cobrar'
}

export const NOMBRE_ESTADO: Record<EstadoCobro, string> = {
  cobrada: 'Cobrada', en_remesa: 'En la remesa', devuelto: 'Devuelto', vencida: 'Vencida', falta_liquidacion: 'Falta su liquidación',
  esperando_liquidacion: 'Esperando liquidación', falta_mandato: 'Falta el mandato', proxima_remesa: 'Próxima remesa',
  cobrada_parte: 'Cobrada en parte', vence_semana: 'Vence esta semana', por_cobrar: 'Por cobrar',
}

/** El chip del estado (tablero cobros-1): rojo vencida o devuelto, ámbar lo que pide algo, verde lo que va solo. */
export function chipEstado(f: FilaCobro): { texto: string; tono: 'falta' | 'duda' | 'seguro' | 'neutro' } {
  const e = estadoCobro(f)
  if (e === 'vencida') return { texto: `Vencida · ${f.diasVencida ?? 0} ${f.diasVencida === 1 ? 'día' : 'días'}`, tono: 'falta' }
  if (e === 'devuelto') return { texto: `Devuelto${f.devuelto?.motivo ? ` · ${f.devuelto.motivo}` : ''}`, tono: 'falta' }
  if (e === 'en_remesa') return { texto: `En la remesa ${f.remesa!.codigo}`, tono: 'seguro' }
  if (e === 'proxima_remesa' || e === 'cobrada') return { texto: NOMBRE_ESTADO[e], tono: 'seguro' }
  if (e === 'falta_mandato' || e === 'falta_liquidacion' || e === 'cobrada_parte' || e === 'vence_semana') return { texto: NOMBRE_ESTADO[e], tono: 'duda' }
  return { texto: NOMBRE_ESTADO[e], tono: 'neutro' }
}

export const NOMBRE_FORMA: Record<Exclude<FormaCobro, null>, string> = {
  transfer: 'Transferencia', direct_debit: 'Domiciliación', card: 'Tarjeta', cash: 'Efectivo', prepaid: 'Saldo prepago', plataforma: 'Plataforma',
}
export const nombreForma = (f: FormaCobro) => (f ? NOMBRE_FORMA[f] : 'Sin decir')

/** Por qué no se puede meter en una remesa de recibos (null = sí se puede). */
export function porQueNoEnRemesa(f: FilaCobro): string | null {
  if (estadoCobro(f) === 'cobrada') return 'ya está cobrada'
  if (libre(f) < 0.005) return `ya está en la remesa ${f.remesa!.codigo}`
  if (f.forma === 'plataforma') return 'la paga una plataforma: se cobra en Liquidaciones'
  if (f.forma !== 'direct_debit') {
    return f.forma === 'transfer' ? 'paga por transferencia' : f.forma === 'card' ? 'paga con tarjeta' : f.forma === 'cash' ? 'paga en efectivo'
      : f.forma === 'prepaid' ? 'paga del saldo prepago' : 'no dice cómo paga'
  }
  if (!f.conMandato) return `${f.cliente} no tiene mandato firmado`
  if (!f.conCuenta) return `${f.cliente} no tiene su cuenta de cliente (430)`
  return null
}

// ── Pestañas ────────────────────────────────────────────────────────────────

export type PestanaCobros = 'por_cobrar' | 'vencidas' | 'proxima' | 'remesas' | 'devueltos' | 'cobrados'
export const PESTANAS_COBROS: readonly { id: PestanaCobros; etiqueta: string }[] = [
  { id: 'por_cobrar', etiqueta: 'Por cobrar' }, { id: 'vencidas', etiqueta: 'Vencidas' }, { id: 'proxima', etiqueta: 'Próxima remesa' },
  { id: 'remesas', etiqueta: 'Remesas' }, { id: 'devueltos', etiqueta: 'Devueltos' }, { id: 'cobrados', etiqueta: 'Cobrados' },
]
export const leerPestana = (s: string | null): PestanaCobros => (PESTANAS_COBROS.some((p) => p.id === s) ? (s as PestanaCobros) : 'por_cobrar')

/** ¿Va esta fila en esta pestaña? «Remesas» no lleva facturas: es la lista de remesas. */
export function enPestana(f: FilaCobro, p: PestanaCobros): boolean {
  const e = estadoCobro(f)
  switch (p) {
    case 'por_cobrar': return e !== 'cobrada'
    case 'vencidas': return e === 'vencida'
    case 'proxima': return e !== 'cobrada' && domiciliadaConMandato(f) && libre(f) >= 0.005 && porQueNoEnRemesa(f) === null
    case 'devueltos': return e === 'devuelto'
    case 'cobrados': return e === 'cobrada'
    case 'remesas': return false
  }
}

export interface FiltrosCobros { buscar: string; hasta: string | null; forma: FormaCobro | 'todas'; local: string | null }

export function cumpleBuscar(f: FilaCobro, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  // Con coma, el punto es de los miles («1.105,30»); sin coma, el punto es el de los decimales («1105.30»).
  const comoNumero = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  if (Number.isFinite(comoNumero) && /\d/.test(t) && (Math.abs(f.total - comoNumero) < 0.005 || Math.abs(f.pendiente - comoNumero) < 0.005)) return true
  return f.cliente.toLowerCase().includes(t) || (f.numero ?? '').toLowerCase().includes(t)
}

export function filtrar(filas: readonly FilaCobro[], p: PestanaCobros, fl: FiltrosCobros): FilaCobro[] {
  return filas.filter((f) => enPestana(f, p) && cumpleBuscar(f, fl.buscar)
    && (!fl.hasta || !f.vence || f.vence <= fl.hasta)
    && (fl.forma === 'todas' || f.forma === fl.forma)
    && (!fl.local || f.localId === fl.local))
}

/** Primero lo que vence antes; sin vencimiento, al final. */
export function ordenarCobros(filas: readonly FilaCobro[]): FilaCobro[] {
  return [...filas].sort((a, b) => (a.vence ?? '9999').localeCompare(b.vence ?? '9999') || (a.fecha ?? '').localeCompare(b.fecha ?? '') || a.cliente.localeCompare(b.cliente))
}

// ── La próxima remesa y las cifras ──────────────────────────────────────────

const sumarDias = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
/** El siguiente día laborable (lunes a viernes) DESPUÉS de hoy. */
export function siguienteLaborable(hoy: string): string {
  let d = sumarDias(hoy, 1)
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = sumarDias(d, 1)
  return d
}

/**
 * El día de cargo de la próxima remesa: el vencimiento más cercano de las que
 * van en ella, pero nunca antes del siguiente laborable (el banco necesita el
 * fichero el día antes).
 */
export function cargoProximo(filas: readonly FilaCobro[], hoy: string): string {
  const pronto = siguienteLaborable(hoy)
  const vences = filas.filter((f) => enPestana(f, 'proxima') && f.vence).map((f) => f.vence!).sort()
  let d = vences[0] && vences[0] > pronto ? vences[0] : pronto
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = sumarDias(d, 1)
  return d
}

export interface CifrasCobros {
  porCobrar: { importe: number; n: number }
  vencido: { importe: number; n: number; dias: number | null }
  proxima: { importe: number; n: number; cargo: string }
  cobradoMes: { importe: number; n: number }
}
export function cifrasCobros(filas: readonly FilaCobro[], cobradoMes: number, cobradasMes: number, hoy: string): CifrasCobros {
  const vivas = filas.filter((f) => estadoCobro(f) !== 'cobrada')
  const vencidas = filas.filter((f) => estadoCobro(f) === 'vencida')
  const prox = filas.filter((f) => enPestana(f, 'proxima'))
  return {
    porCobrar: { importe: r2(vivas.reduce((t, f) => t + f.pendiente, 0)), n: vivas.length },
    vencido: { importe: r2(vencidas.reduce((t, f) => t + f.pendiente, 0)), n: vencidas.length, dias: vencidas.length ? Math.max(...vencidas.map((f) => f.diasVencida ?? 0)) : null },
    proxima: { importe: r2(prox.reduce((t, f) => t + libre(f), 0)), n: prox.length, cargo: cargoProximo(filas, hoy) },
    cobradoMes: { importe: r2(cobradoMes), n: cobradasMes },
  }
}

// ── Una remesa de recibos ───────────────────────────────────────────────────

export type EstadoRemesaCobros = 'preparada' | 'en_banco' | 'plazo' | 'cerrada' | 'vacia'
export const NOMBRE_ESTADO_REMESA: Record<EstadoRemesaCobros, string> = {
  preparada: 'Preparada', en_banco: 'En el banco', plazo: 'Abonada · plazo de devoluciones', cerrada: 'Cerrada', vacia: 'Sin recibos',
}

/** Los pasos de la ficha (tablero cobros-2): Preparada → En el banco → Abonada → Plazo de devoluciones · hasta el DD/MM. */
export function pasosRemesa(estado: EstadoRemesaCobros, plazoHasta: string | null): { etiqueta: string; hecho: boolean; actual: boolean }[] {
  const orden: EstadoRemesaCobros[] = ['preparada', 'en_banco', 'plazo', 'cerrada']
  const i = Math.max(orden.indexOf(estado), 0)
  const plazo = plazoHasta ? `Plazo de devoluciones · hasta el ${plazoHasta.slice(8, 10)}/${plazoHasta.slice(5, 7)}` : 'Plazo de devoluciones'
  return [
    { etiqueta: 'Preparada', hecho: i >= 1, actual: i === 0 },
    { etiqueta: 'En el banco', hecho: i >= 2, actual: i === 1 },
    { etiqueta: 'Abonada', hecho: i >= 2, actual: false },
    { etiqueta: estado === 'cerrada' ? 'Plazo de devoluciones · pasado' : plazo, hecho: i >= 3, actual: i === 2 },
  ]
}

/** Los motivos de devolución que dan los bancos (códigos SEPA), en palabras. */
export const MOTIVOS_DEVOLUCION = [
  'sin fondos', 'cuenta cancelada o bloqueada', 'el cliente no reconoce el cargo', 'el cliente pidió la devolución', 'cuenta o mandato no válidos', 'otro motivo',
] as const

// ── Lo que propone Bancos ───────────────────────────────────────────────────

export interface RemesaCobrosParaCasar { id: string; codigo: string; cargo: string; porAbonarCent: number; recibos: { id: string; importeCent: number; cliente: string; factura: string | null }[] }
export interface ReciboDevolvible { id: string; remesa: string; importeCent: number; cliente: string; factura: string | null; abonado: string | null }

/** Para un ABONO: la remesa entera que espera justo ese importe, o un recibo suyo (si el banco los abona uno a uno). */
export function abonosQueCuadran(abonoCent: number, remesas: readonly RemesaCobrosParaCasar[]) {
  return remesas.flatMap((r) => [
    ...(r.porAbonarCent === abonoCent ? [{ clave: r.id, remesaId: r.id, codigo: r.codigo, lineas: null as string[] | null, texto: `Remesa de recibos ${r.codigo}`, apoyo: r.recibos.length === 1 ? `${r.recibos[0].cliente} · ${r.recibos[0].factura ?? 'sin número'}` : `${r.recibos.length} recibos, con cargo el ${r.cargo.slice(8, 10)}/${r.cargo.slice(5, 7)}` }] : []),
    ...(r.recibos.length > 1 ? r.recibos.filter((x) => x.importeCent === abonoCent).map((x) => ({ clave: x.id, remesaId: r.id, codigo: r.codigo, lineas: [x.id], texto: `Un recibo de la remesa ${r.codigo}`, apoyo: `${x.cliente} · ${x.factura ?? 'sin número'}` })) : []),
  ])
}

/** Para un CARGO: los recibos cobrados que puede ser su devolución (el recibo, más hasta 30 € de gastos del banco). */
export function devolucionesQueCuadran(cargoCent: number, recibos: readonly ReciboDevolvible[]): (ReciboDevolvible & { gastosCent: number })[] {
  return recibos.filter((r) => cargoCent >= r.importeCent && cargoCent - r.importeCent <= 3000)
    .map((r) => ({ ...r, gastosCent: cargoCent - r.importeCent }))
    .sort((a, b) => a.gastosCent - b.gastosCent)
}

// ── PC01 · Entrega 4 · Los recordatorios ────────────────────────────────────

/** Por qué una factura no lleva recordatorios (la base lo decide: _pc01e4_sin_recordatorio). */
export type SinRecordatorio = 'cobrada' | 'plataforma' | 'domiciliada' | 'en_remesa' | 'apagados' | 'cliente' | 'sin_vencimiento' | 'sin_correo'
export interface RecordatoriosFactura { id: string; enviados: number; ultimo: string | null; proximo: string | null; sin: SinRecordatorio | null; noSalio: { toca: string; motivo: string | null } | null }

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** La columna «Recordatorios» de Cobros, como en el tablero: «3 enviados · próximo 01/11», «no hacen falta»… */
export function textoRecordatorios(r: RecordatoriosFactura | null | undefined): string {
  if (!r) return '—'
  const enviados = r.enviados ? `${r.enviados} ${r.enviados === 1 ? 'enviado' : 'enviados'}` : null
  switch (r.sin) {
    case 'plataforma': case 'domiciliada': case 'en_remesa': return 'no hacen falta'
    case 'apagados': return enviados ? `${enviados} · apagados` : 'apagados'
    case 'cliente': return enviados ? `${enviados} · apagados para este cliente` : 'apagados para este cliente'
    case 'sin_correo': return 'sin correo del cliente'
    case 'sin_vencimiento': return 'sin vencimiento'
    case 'cobrada': return enviados ?? '—'
  }
  const proximo = r.proximo ? `próximo ${ddmm(r.proximo)}` : null
  return [enviados, proximo].filter(Boolean).join(' · ') || 'ya no quedan'
}

/** Los días de los recordatorios, en palabras: «3 días antes, el día que vence y a los 7 y 15 días». */
export function textoDias(dias: readonly number[]): string {
  const orden = [...new Set(dias)].sort((a, b) => a - b)
  const antes = orden.filter((d) => d < 0).map((d) => -d).sort((a, b) => a - b)
  const despues = orden.filter((d) => d > 0)
  const y = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
  const partes: string[] = []
  if (antes.length) partes.push(`${y(antes.map(String))} ${antes.length === 1 && antes[0] === 1 ? 'día' : 'días'} antes`)
  if (orden.includes(0)) partes.push('el día que vence')
  if (despues.length) partes.push(`a los ${y(despues.map(String))} ${despues.length === 1 && despues[0] === 1 ? 'día' : 'días'}`)
  return y(partes)
}

/** Lo que se escribe en el campo de los días («-3, 0, 7, 15»), leído; null si algo no es un número entero. */
export function leerDias(texto: string): number[] | null {
  const xs = texto.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  if (!xs.length || xs.some((x) => !/^[-+]?\d{1,3}$/.test(x))) return null
  return [...new Set(xs.map(Number))].sort((a, b) => a - b)
}

