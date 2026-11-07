// src/modules/conta/gestoria/vista.ts
//
// G01 · Tarea 4 · Lo que deciden las pantallas de Clientes y cuotas sin pintar
// (con sus pruebas en tests/unit/modules/conta/gestoria/vista.test.ts):
//   · los chips de «Te toca hoy», cada uno con su número (el marco esconde los
//     que dan 0), y qué filas deja ver cada uno;
//   · las letras de servicios (C contabilidad y gestoría, L laboral, S otros);
//   · la figura (sociedad o autónomo) que dice el NIF;
//   · la ficha: cada servicio con su tarifa y, debajo, cada empleado con la
//     suya, el total, lo que cobra hoy GoCardless y la diferencia en palabras
//     (la misma comparación que la lectura: comparacion.ts).
// Palabras de oficina: domiciliación, tarifa, línea, cobro, mandato, empleado.

import {
  comparar, euros, tarifaDelMes, vale, type Comparacion, type Linea, type Mes, type SuscripcionActiva, type Tarifa,
} from '../../../../supabase/functions/conta-gocardless-leer/comparacion'

export type TipoDiferencia =
  | 'crm_sin_cobro' | 'gocardless_sin_ficha' | 'emisor_distinto' | 'nif_repetido_en_crm' | 'correo_repetido_en_crm'
  // G01c · Los de antes, mientras queden filas con ellos (el PR B las migra a los neutros y los quita).
  | 'bitrix_sin_cobro' | 'nif_repetido_en_bitrix' | 'correo_repetido_en_bitrix'
  | 'nif_distinto' | 'suscripcion_sin_convertir' | 'totales_distintos' | 'mandato_por_firmar' | 'falla_a_menudo' | 'abono_en_otra_cuenta'
  // G01b · De la lectura del CRM: un cliente con varias fichas, una ficha que entra sin NIF y una que no se ha podido guardar.
  | 'fichas_repetidas' | 'nif_no_valido' | 'ficha_no_guardada'
  // G01c · Un contacto con solo una negociación, y uno con empresa y con datos de cliente.
  | 'contacto_solo_negociacion' | 'contacto_empresa_con_datos'

export interface Diferencia {
  id: string
  tipo: TipoDiferencia
  porque: string
  clienteId: string | null
  emisorId: string | null
  gcClienteId: string | null
}

export interface Cobro { fecha: string; importeCent: number; estado: string; motivo: string | null }

/** Una fila de la tabla: un cliente con un emisor (o, sin ficha, alguien que solo está en GoCardless). */
export interface ClienteGestoria {
  id: string
  clienteId: string | null
  nombre: string
  nif: string | null
  emisorId: string
  emisor: string
  /** Lo que dice su CRM (de referencia). */
  bitrix: {
    situacion: string | null; formaPago: string | null; servicios: string[]
    /** G01b · El texto de la situación en Bitrix24 (para «Sin clasificar»), la dirección y de qué campo sale, y las otras, de referencia. */
    situacionTexto?: string | null; direccion?: string | null; direccionDe?: string | null; otrasDirecciones?: { etiqueta: string; texto: string }[]
    /** G01b · Las otras fichas del CRM del mismo cliente (el mismo NIF, con la unión aplicada). */
    otrasFichas?: { idExterno: string; tipoFicha?: 'empresa' | 'contacto'; nombre: string; situacion: string | null; situacionTexto: string | null }[]
    /** G01c · Si su ficha principal es una empresa o un contacto del CRM, y «Tipo de cliente» (de un contacto, de referencia). */
    tipoFicha?: 'empresa' | 'contacto'
    tipoCliente?: string | null
    /** G01c · Sus personas de contacto (los contactos del CRM con su empresa). */
    personas?: { nombre: string; correos: string[]; telefonos: string[] }[]
  } | null
  formaCobro: 'gocardless' | 'transferencia' | 'tarjeta' | 'efectivo' | null
  /** El estado del mandato en GoCardless, tal cual (active, pending_customer_approval…). */
  mandato: string | null
  cobros: Cobro[]
  diferencias: Diferencia[]
}

/** Los chips de «Te toca hoy», en su orden, con su texto. Fase 1: sin «Empleado que no está en Laboral». */
export type Conector = 'gocardless' | 'bitrix'
/** Cada chip, con los conectores que necesita: sin ellos, no sale (no hay nada que comparar). */
export const CHIPS: readonly { id: string; tipos: readonly TipoDiferencia[]; etiqueta: string; necesita: readonly Conector[] }[] = [
  { id: 'sin-cobro', tipos: ['crm_sin_cobro', 'bitrix_sin_cobro'], etiqueta: 'En tu CRM sin cobro en GoCardless', necesita: ['bitrix', 'gocardless'] },
  { id: 'sin-ficha', tipos: ['gocardless_sin_ficha'], etiqueta: 'En GoCardless sin ficha en tu CRM', necesita: ['bitrix', 'gocardless'] },
  { id: 'emisor', tipos: ['emisor_distinto'], etiqueta: 'Tu CRM y GoCardless no coinciden en el emisor', necesita: ['bitrix', 'gocardless'] },
  { id: 'sin-convertir', tipos: ['suscripcion_sin_convertir'], etiqueta: 'Suscripción sin convertir en tarifa', necesita: ['gocardless'] },
  { id: 'totales', tipos: ['totales_distintos'], etiqueta: 'Sumied y GoCardless no dan el mismo total', necesita: ['gocardless'] },
  { id: 'por-firmar', tipos: ['mandato_por_firmar'], etiqueta: 'Mandato pendiente de firma', necesita: ['gocardless'] },
  { id: 'fallan', tipos: ['falla_a_menudo'], etiqueta: 'Fallan a menudo (3 o más en 6 meses)', necesita: ['gocardless'] },
  // G01b · De la lectura del CRM (Julio, 07/11).
  { id: 'repetidas', tipos: ['fichas_repetidas'], etiqueta: 'Fichas repetidas en tu CRM', necesita: ['bitrix'] },
  { id: 'sin-nif', tipos: ['nif_no_valido'], etiqueta: 'NIF de tu CRM que no se usa', necesita: ['bitrix'] },
  { id: 'no-guardada', tipos: ['ficha_no_guardada'], etiqueta: 'Fichas de tu CRM sin guardar', necesita: ['bitrix'] },
  // G01c · Los contactos (Julio, 07/11).
  { id: 'contacto-negociacion', tipos: ['contacto_solo_negociacion'], etiqueta: 'Contacto con solo una negociación', necesita: ['bitrix'] },
  { id: 'contacto-con-datos', tipos: ['contacto_empresa_con_datos'], etiqueta: 'Contacto con empresa y con datos de cliente', necesita: ['bitrix'] },
]

/** Lo conectado: las empresas con GoCardless y si la cuenta tiene Bitrix24 (cada conector se enciende aparte). */
export interface Conectados { gocardless: ReadonlySet<string>; bitrix: boolean }

/**
 * Qué se ve con lo conectado, para la empresa elegida (o todas, con null):
 * lo de GoCardless (su total, el mandato, los cobros y sus chips) si alguna de
 * las elegidas lo tiene; lo de Bitrix24 (sus chips y «Lo que dice Bitrix24»)
 * si la cuenta lo tiene. Los chips que cruzan los dos piden los dos.
 */
export function queSeVe(c: Conectados, emisor: string | null, emisores: readonly string[]) {
  const elegidas = emisor ? [emisor] : emisores
  const gocardless = elegidas.some((e) => c.gocardless.has(e))
  const tiene = (n: Conector) => (n === 'gocardless' ? gocardless : c.bitrix)
  return { gocardless, bitrix: c.bitrix, chips: CHIPS.filter((x) => x.necesita.every(tiene)).map((x) => x.id), sinGocardless: elegidas.filter((e) => !c.gocardless.has(e)) }
}

/** Cuántos clientes tiene cada chip (un cliente con dos diferencias del mismo chip cuenta una vez). */
export function contarChips(filas: readonly ClienteGestoria[]): Record<string, number> {
  const r: Record<string, number> = {}
  for (const c of CHIPS) r[c.id] = filas.filter((f) => f.diferencias.some((d) => c.tipos.includes(d.tipo))).length
  return r
}

export function filtrarPorChip(filas: readonly ClienteGestoria[], chip: string | null): ClienteGestoria[] {
  const c = CHIPS.find((x) => x.id === chip)
  return c ? filas.filter((f) => f.diferencias.some((d) => c.tipos.includes(d.tipo))) : [...filas]
}

/** El emisor elegido en la barra: uno, o «Los dos» (todos). */
export const filtrarPorEmisor = (filas: readonly ClienteGestoria[], emisor: string | null) =>
  emisor ? filas.filter((f) => f.emisorId === emisor) : [...filas]

/** Las letras de lo que se le cobra: C (contabilidad y gestoría), L (laboral), S (otros servicios). */
export function letrasDeServicios(lineas: readonly Linea[]): ('C' | 'L' | 'S')[] {
  const s = new Set<'C' | 'L' | 'S'>()
  for (const l of lineas) s.add(l.servicio === 'gestoria_mensual' ? 'C' : l.servicio === 'gestion_laboral' ? 'L' : 'S')
  return (['C', 'L', 'S'] as const).filter((x) => s.has(x))
}
export const NOMBRE_LETRA = { C: 'Contabilidad', L: 'Laboral', S: 'Otros servicios' } as const
/** Las palabras de lo que se le cobra («Contabilidad, Laboral»). */
export const palabrasDeServicios = (lineas: readonly Linea[]) => letrasDeServicios(lineas).map((x) => NOMBRE_LETRA[x]).join(', ')

/** Sociedad o autónomo, por el NIF (la letra del principio). Sin NIF, no se dice. */
export function figura(nif: string | null): 'Sociedad' | 'Autónomo' | null {
  const n = (nif ?? '').trim().toUpperCase()
  if (!n) return null
  if (/^[0-9XYZKLM]/.test(n)) return 'Autónomo'
  if (/^[ABCDEFGHJNPQRSUVW]/.test(n)) return 'Sociedad'
  return null
}

export const empleadosDe = (lineas: readonly Linea[], mes: Mes) =>
  lineas.filter((l) => l.servicio === 'gestion_laboral' && l.empleado && vale(l.desde, l.hasta, mes)).length

export const FORMA_COBRO: Record<string, string> = {
  gocardless: 'Domiciliación', transferencia: 'Transferencia', tarjeta: 'Tarjeta', efectivo: 'Efectivo',
}

export function textoMandato(estado: string | null): { texto: string; tono: 'verde' | 'ambar' | 'gris' } {
  switch (estado) {
    case 'active': return { texto: 'Firmado', tono: 'verde' }
    case 'pending_submission': case 'submitted': return { texto: 'Camino del banco', tono: 'ambar' }
    case 'pending_customer_approval': return { texto: 'Por firmar', tono: 'ambar' }
    case 'cancelled': return { texto: 'Cancelado', tono: 'gris' }
    case 'failed': return { texto: 'Rechazado por el banco', tono: 'gris' }
    case 'expired': return { texto: 'Caducado', tono: 'gris' }
    case 'blocked': return { texto: 'Bloqueado', tono: 'gris' }
    case null: return { texto: 'Sin mandato', tono: 'gris' }
    default: return { texto: estado, tono: 'gris' }
  }
}

export function textoCobro(estado: string): { texto: string; tono: 'verde' | 'ambar' | 'rojo' | 'gris' } {
  if (['paid_out', 'confirmed'].includes(estado)) return { texto: 'Cobrado', tono: 'verde' }
  if (['pending_submission', 'submitted', 'pending_customer_approval'].includes(estado)) return { texto: 'Pendiente', tono: 'ambar' }
  if (['failed', 'charged_back', 'customer_approval_denied'].includes(estado)) return { texto: 'Devuelto', tono: 'rojo' }
  if (estado === 'cancelled') return { texto: 'Cancelado', tono: 'gris' }
  return { texto: estado, tono: 'gris' }
}

/** Lo de la ficha: cada servicio con su tarifa, los empleados debajo y lo que cobra GoCardless. */
export interface Ficha {
  /** Cada servicio con su tarifa; `filas`, solo si se cobra por trabajador (o tiene varias líneas): cada una con su línea, para darla de baja. */
  servicios: { servicio: string; nombre: string; porEmpleado: boolean; tarifa: string; filas: { lineaId: string; texto: string; importe: string }[]; total: string; totalCent: number }[]
  comparacion: Comparacion
  /** La diferencia en palabras: «Cuadra con GoCardless» o la explicación. */
  diferencia: string[]
}

export function fichaDe(clienteId: string, emisor: string, mes: Mes, lineas: Linea[], tarifas: Tarifa[], suscripciones: SuscripcionActiva[],
  porEmpleado: (servicio: string) => boolean = (s) => s === 'gestion_laboral'): Ficha {
  const comp = comparar(clienteId, mes, lineas.filter((l) => l.emisor === emisor), tarifas, suscripciones.filter((s) => s.emisor === emisor))
  const delMes = new Map(comp.lineas.map((x) => [x.lineaId, x]))
  const porServicio = new Map<string, Linea[]>()
  for (const l of lineas) if (l.emisor === emisor && vale(l.desde, l.hasta, mes)) porServicio.set(l.servicio, [...(porServicio.get(l.servicio) ?? []), l])
  const servicios = [...porServicio.entries()].map(([servicio, ls]) => {
    const t = tarifaDelMes(tarifas, clienteId, emisor, servicio, mes)
    const tarifa = t ? `${euros(t.tarifa.importeCent)} ${t.tarifa.periodo === 'anio' ? 'al año' : 'al mes'} · ${t.propia ? 'tarifa propia' : 'tarifa general'}` : 'Sin tarifa'
    const pe = porEmpleado(servicio)
    // Un servicio fijo con una sola línea es una fila («Gestoría mensual · 60,50 €»): sin desglose.
    const filas = !pe && ls.length === 1 ? [] : ls.map((l) => {
      const d = delMes.get(l.id)
      return { lineaId: l.id, texto: l.empleado ?? l.detalle ?? l.nombreServicio, importe: d?.alMesCent == null ? 'Sin tarifa' : euros(d.alMesCent) }
    })
    const sinTarifa = ls.some((l) => delMes.get(l.id)?.alMesCent == null)
    const totalCent = ls.reduce((s, l) => s + (delMes.get(l.id)?.alMesCent ?? 0), 0)
    return { servicio, nombre: ls[0].nombreServicio, porEmpleado: pe, tarifa, filas, totalCent, total: sinTarifa && totalCent === 0 ? 'Sin tarifa' : euros(totalCent) }
  })
  const diferencia = comp.diferenciaCent === 0
    ? [`Cuadra con GoCardless: ${euros(comp.sumiedCent)} al mes en los dos.`]
    : [`Sumied ${euros(comp.sumiedCent)} y GoCardless ${euros(comp.gocardlessCent)} al mes: ${comp.diferenciaCent > 0 ? 'Sumied' : 'GoCardless'} ${euros(Math.abs(comp.diferenciaCent))} más.`, ...comp.explicaciones]
  return { servicios, comparacion: comp, diferencia }
}

/** Lo que se puede hacer con una diferencia desde la ficha. */
export type Resolver = 'linea_o_baja' | 'enlazar' | 'revisada'
export function comoResolver(d: Diferencia): Resolver[] {
  if (d.tipo === 'totales_distintos' || d.tipo === 'suscripcion_sin_convertir') return ['linea_o_baja', 'revisada']
  if (d.tipo === 'gocardless_sin_ficha') return ['enlazar', 'revisada']
  // G01b · Lo del CRM se corrige en el CRM: la próxima lectura lo renueva (no hay empresa a la que apuntar la revisión).
  if (['fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos'].includes(d.tipo)) return []
  return ['revisada']
}

/** Lo que cobra GoCardless a un cliente y no es ninguna línea en Sumied (para «Añadirla como línea» o «No la cuentes»). */
export function sinLinea(suscripciones: readonly SuscripcionActiva[], lineas: readonly Linea[], emisor: string): SuscripcionActiva[] {
  const conLinea = new Set(lineas.map((l) => l.suscripcionId).filter(Boolean))
  return suscripciones.filter((s) => s.emisor === emisor && !conLinea.has(s.id))
}

/** La frase de una diferencia para la tabla: cuántas y la primera. */
export function textoDiferencias(d: readonly Diferencia[]): string {
  if (d.length === 0) return 'Ninguna'
  return d.length === 1 ? CHIPS.find((c) => c.tipos.includes(d[0].tipo))?.etiqueta ?? d[0].porque : `${d.length} diferencias`
}

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** Los meses que se pueden elegir: este y los 11 siguientes. */
export function mesesDesde(mes: string, n = 12): { valor: string; texto: string }[] {
  let [a, m] = mes.split('-').map(Number)
  const r: { valor: string; texto: string }[] = []
  for (let i = 0; i < n; i++) {
    r.push({ valor: `${a}-${String(m).padStart(2, '0')}-01`, texto: `${MESES[m - 1]} de ${a}` })
    m += 1; if (m > 12) { m = 1; a += 1 }
  }
  return r
}
/** «24,20» → 24.2; null si no es un importe. */
export function leerImporte(t: string): number | null {
  const s = t.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Number(s)
}

export { euros }
