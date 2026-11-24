// src/modules/conta/nucleo/recibida/estado.ts
//
// K04 · Lo que decide la ficha de la recibida del núcleo, sin React ni red: la
// franja de la cabecera, las comprobaciones de la línea, la duda de la cuenta
// de gasto, la etiqueta del asiento que sale, el nombre de la pestaña y cuándo
// se enciende «Guardar y siguiente». Lo ámbar es lo único que hay que mirar: si
// todo está bien, no hay nada ámbar y basta Intro.
//
// Las frases de lo que falla son las de la base (la lectura, la propuesta del
// asiento, paraValidar): aquí no se inventa ninguna.

import { casaNif, nifValido, AVISO_NIF_LEIDO_MAL } from '@/modules/conta/documentos/paraValidar'
import type { UnaComprobacion, TonoEstado } from '../ficha/piezas'
import { cifra } from '../ficha/textos'
import { altaEnFactura } from '@/modules/conta/lib/proveedorDesdeFactura'

/** «3T de 2026» de una fecha AAAA-MM-DD; '' sin fecha. */
export function trimestreDe(fecha: string): string {
  if (!/^\d{4}-\d{2}/.test(fecha)) return ''
  const t = Math.floor((Number(fecha.slice(5, 7)) - 1) / 3) + 1
  return `${t}T de ${fecha.slice(0, 4)}`
}

/** Los meses del trimestre de una fecha («2026-07», «2026-08», «2026-09»). */
function mesesDelTrimestre(fecha: string): string[] {
  const y = fecha.slice(0, 4)
  const t = Math.floor((Number(fecha.slice(5, 7)) - 1) / 3)
  return [1, 2, 3].map((i) => `${y}-${String(t * 3 + i).padStart(2, '0')}`)
}

export interface Calendario { mesesCerrados: readonly string[]; ejercicios: readonly { inicio: string; fin: string; abierto: boolean }[] }

/** ¿Está abierto el trimestre de la fecha? Su mes sin cerrar y su ejercicio abierto. null sin fecha o sin calendario. */
export function periodoAbierto(fecha: string, c: Calendario | null): { abierto: boolean; texto: string } | null {
  if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const t = trimestreDe(fecha)
  const ej = c.ejercicios.find((e) => e.inicio <= fecha && fecha <= e.fin)
  if (ej && !ej.abierto) return { abierto: false, texto: `El ejercicio de ${fecha.slice(0, 4)} está cerrado: el asiento irá al primer día abierto.` }
  if (c.mesesCerrados.includes(fecha.slice(0, 7))) return { abierto: false, texto: `El mes de la factura está cerrado: el asiento irá al primer día abierto.` }
  const cerradosDelT = mesesDelTrimestre(fecha).filter((m) => c.mesesCerrados.includes(m))
  if (cerradosDelT.length === 3) return { abierto: false, texto: `El ${t} está cerrado: el asiento irá al primer día abierto.` }
  return { abierto: true, texto: `El ${t.replace(/ de \d{4}$/, '')} está abierto` }
}

export interface DatosComprobar {
  /** ¿Está escrita a mano (sin lectura)? Entonces solo se dice qué se comprueba al escribir. */
  aMano: boolean
  /** paraValidar.textoDuplicada, si puede estar repetida; null si no. */
  duplicada: string | null
  /** conta_factura_para_revisar.no_repetida: alguien ya confirmó que NO está repetida (not_duplicate_confirmed_at). */
  noRepetida: boolean
  fecha: string
  calendario: Calendario | null
  /** El número que hay en la casilla: sin él no se sabe si está repetida. */
  numero: string
  /** ¿Tiene proveedor (una ficha)? Sin ficha, el NIF que se comprueba es el leído (K04b). */
  hayFicha: boolean
  nifFicha: string | null
  nifLeido: string | null
  /** El total de lo escrito y el del documento (null si no hay documento leído). */
  total: number
  totalDocumento: number | null
  /** Las comprobaciones de la lectura del PDF que fallan (id, texto, grave). */
  lectura: readonly { id: string; ok: boolean; grave: boolean; texto: string }[]
  /** Los avisos de la propuesta del asiento, con su frase. */
  avisos: readonly string[]
}

/** Lo que la lectura ya dice en las cuatro de siempre (no se repite como una más). */
const YA_DICHAS = new Set(['nif', 'nif_forma', 'suma', 'total'])

/** Las comprobaciones de la línea: las cuatro de la maqueta y, detrás, las demás que fallan. */
export function comprobacionesDe(d: DatosComprobar): UnaComprobacion[] {
  const l: UnaComprobacion[] = []
  // 1 · Repetida: la dice duplicadaDe (la misma de la ficha de hoy), salvo que alguien ya confirmara que no lo es.
  // Sin número no se puede saber: no se dice «bien» (K04b).
  if (d.duplicada && !d.noRepetida) l.push({ id: 'repetida', tono: 'ambar', texto: d.duplicada })
  else if (d.numero.trim()) l.push({ id: 'repetida', tono: 'bien', texto: 'No está repetida' })
  // 2 · El periodo.
  const p = periodoAbierto(d.fecha, d.calendario)
  if (p) l.push({ id: 'periodo', tono: p.abierto ? 'bien' : 'ambar', texto: p.texto })
  // 3 · El NIF. Sin ficha, el leído del PDF (K04b): nunca «su ficha» si no hay ficha.
  const casa = casaNif(d.nifFicha, d.nifLeido)
  if (!d.hayFicha) {
    if (!d.nifLeido) l.push({ id: 'nif', tono: 'ambar', texto: 'La factura no trae NIF' })
    else if (nifValido(d.nifLeido)) l.push({ id: 'nif', tono: 'bien', texto: 'NIF correcto' })
    else l.push({ id: 'nif', tono: 'rojo', texto: 'NIF no válido' })
  } else if (!d.nifFicha) l.push({ id: 'nif', tono: 'ambar', texto: 'Su ficha no tiene NIF' })
  else if (casa === 'distinto') l.push({ id: 'nif', tono: 'rojo', texto: `El NIF de la factura (${d.nifLeido}) no es el de su ficha (${d.nifFicha})` })
  else if (casa === 'leido_mal') l.push({ id: 'nif', tono: 'ambar', texto: AVISO_NIF_LEIDO_MAL })
  else if (!nifValido(d.nifFicha)) l.push({ id: 'nif', tono: 'rojo', texto: `El NIF de su ficha (${d.nifFicha}) no es válido` })
  else l.push({ id: 'nif', tono: 'bien', texto: 'NIF correcto' })
  // 4 · Bases y cuotas suman el total del documento.
  if (d.totalDocumento !== null && Math.round(d.totalDocumento * 100) !== Math.round(d.total * 100)) {
    l.push({ id: 'suma', tono: 'ambar', texto: `Base + IVA = ${cifra(d.total)}, y la factura dice ${cifra(d.totalDocumento)}` })
  } else if (d.total > 0) l.push({ id: 'suma', tono: 'bien', texto: 'Bases y cuotas suman el total' })
  // Las demás de la lectura que fallan, y los avisos de la propuesta (sin repetir la suma).
  for (const c of d.lectura) if (!c.ok && !YA_DICHAS.has(c.id)) l.push({ id: `lectura-${c.id}`, tono: c.grave ? 'rojo' : 'ambar', texto: c.texto.replace(/\.$/, '') })
  for (const [i, a] of d.avisos.entries()) if (!/^Base \+ IVA = /.test(a)) l.push({ id: `aviso-${i}`, tono: 'ambar', texto: a.replace(/\.$/, '') })
  return l
}

export interface RepartoGasto { cuenta: string; nombre: string; facturas: number }

/**
 * La duda de la cuenta de gasto (0250): si sus facturas anteriores fueron a
 * varias cuentas. «Dejar» es la que tiene ahora la ficha; «Cambiar a», la otra
 * de las dos más recientes. La frase dice lo que dice la base: cuántas a cada
 * una y a cuál fue la última. null si no hay duda, si ya se ha decidido o si la
 * cuenta que hay no es ninguna de las dos.
 */
export function dudaDelGasto(o: { reparto: readonly RepartoGasto[]; confianza: 'seguro' | 'probable' | null; cuentaAhora: string; decidida: boolean }):
  { texto: string; dejar: RepartoGasto; cambiar: RepartoGasto } | null {
  if (o.decidida || o.confianza !== 'probable' || o.reparto.length < 2) return null
  const [a, b] = o.reparto
  const ahora = o.cuentaAhora || a.cuenta
  if (ahora !== a.cuenta && ahora !== b.cuenta) return null
  const [dejar, cambiar] = ahora === a.cuenta ? [a, b] : [b, a]
  const total = o.reparto.reduce((t, r) => t + r.facturas, 0)
  return {
    texto: `Sus ${total} facturas anteriores fueron ${a.facturas} a la ${a.cuenta} (la última) y ${b.facturas} a la ${b.cuenta}${o.reparto.length > 2 ? ', y otras a otras cuentas' : ''}.`,
    dejar, cambiar,
  }
}

/**
 * Las casillas que la ficha necesita y están vacías, dichas como en una frase
 * («el número y la fecha»). Con alguna vacía, la franja no dice «Rellenada» ni
 * «bien» (K04b, regla 7): dice lo que falta.
 */
export function casillasVacias(c: { proveedor: boolean; numero: string; fecha: string; total: number; cuentaGasto: boolean }): string[] {
  const l: string[] = []
  if (!c.proveedor) l.push('el proveedor')
  if (!c.numero.trim()) l.push('el número de factura')
  if (!c.fecha.trim()) l.push('la fecha')
  if (!(c.total > 0)) l.push('el importe')
  if (!c.cuentaGasto) l.push('la cuenta de gasto')
  return l
}

/** «a», «a y b», «a, b y c». */
const enFrase = (l: readonly string[]) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`)

export interface EstadoDeLaFicha { tono: TonoEstado; fuerte: string; resto: string }

/**
 * La pastilla de la cabecera. Lo que dice tiene que ser verdad con lo que hay
 * en la ficha (K04b): un emisor que no se conoce, «Mira esto · No conozco al
 * que la emite»; con casillas vacías, «Mira esto · Falta …»; si no, rellenada
 * por Sumied (con sus dudas) o escrita por ti.
 */
export function estadoDeLaFicha(o: { aMano: boolean; leida: boolean; comprobaciones: readonly UnaComprobacion[]; hayDudaGasto: boolean; desconocido?: boolean; vacias?: readonly string[] }): EstadoDeLaFicha {
  if (o.aMano) return { tono: 'gris', fuerte: 'La escribes tú.', resto: 'Se comprueba mientras escribes.' }
  if (o.desconocido) return { tono: 'ambar', fuerte: 'Mira esto ·', resto: 'No conozco al que la emite' }
  if (o.vacias?.length) return { tono: 'ambar', fuerte: 'Mira esto ·', resto: `Falta ${enFrase(o.vacias)}` }
  const bien = o.comprobaciones.filter((c) => c.tono === 'bien').length
  const dudas = o.comprobaciones.filter((c) => c.tono !== 'bien').length + (o.hayDudaGasto ? 1 : 0)
  const quien = o.leida ? 'Rellenada por Sumied' : 'Escrita a mano'
  const fuerte = dudas ? `${quien}, con ${dudas} duda${dudas === 1 ? '' : 's'}.` : `${quien}.`
  const resto = `${bien} comprobaci${bien === 1 ? 'ón' : 'ones'} bien · ${dudas ? 'mira lo ámbar y pulsa Intro.' : 'pulsa Intro.'}`
  return { tono: dudas ? 'ambar' : 'verde', fuerte, resto }
}

/**
 * El emisor que no se reconoce (K04b): una factura leída sin proveedor. Con el
 * NIF leído de uno que ya tienes, se ofrece ese (altaEnFactura, la misma de la
 * ficha de hoy); si no, «Darlo de alta» y «Es uno que ya tengo». null si tiene
 * proveedor, si es nueva o si no hay nada leído del emisor.
 */
export function emisorDesconocido(o: { aMano: boolean; proveedorId: string; leido: { nombre: string | null; nif: string | null } | null; proveedores: readonly { id: string; nombre: string; nif: string | null }[] }):
  { que: 'alta'; nombre: string | null; nif: string | null } | { que: 'es_uno_tuyo'; proveedorId: string; nombre: string; nif: string | null } | null {
  if (o.aMano || o.proveedorId) return null
  const nombre = o.leido?.nombre?.trim() || null
  const nif = o.leido?.nif?.trim() || null
  const a = altaEnFactura({ proveedorId: null, soloLectura: false, nifLeido: nif, proveedores: o.proveedores })
  if (a.que === 'es_uno_tuyo') return { que: 'es_uno_tuyo', proveedorId: a.proveedorId, nombre: a.nombre, nif }
  return { que: 'alta', nombre, nif }
}

/** La etiqueta del asiento: «Cuadra · 357,44», lo que le falta, o «Se forma al escribir». */
export function etiquetaDelAsiento(a: { debe: number; haber: number; cuadra: boolean; faltan: readonly string[]; lineas: number; sinPropuesta?: string | null }):
  { texto: string; tono: 'bien' | 'ambar' | 'vacio' } {
  // K10b · Sin propuesta (le falta el NIF, el tipo de gasto…) y sin nada escrito, no se calla con «Se forma al escribir»
  // (regla 8): «Sin propuesta», y el motivo debajo. Lo escrito a mano manda (regla 30).
  if (a.lineas === 0 || (a.debe === 0 && a.haber === 0)) return a.sinPropuesta ? { texto: 'Sin propuesta', tono: 'ambar' } : { texto: 'Se forma al escribir', tono: 'vacio' }
  if (a.faltan.length) return { texto: `Falta ${a.faltan[0]}`, tono: 'ambar' }
  if (a.cuadra) return { texto: `Cuadra · ${cifra(a.debe)}`, tono: 'bien' }
  const d = Math.round((a.debe - a.haber) * 100) / 100
  return { texto: d > 0 ? `Sobran ${cifra(d)} en el debe` : `Faltan ${cifra(-d)} en el debe`, tono: 'ambar' }
}

/**
 * El nombre de la pestaña: «Factura recibida · <proveedor>»; la nueva, a mano y
 * sin proveedor, «Factura recibida · nueva». Una que ya existe nunca se llama
 * «nueva» (K04b): sin proveedor, el nombre leído del emisor; sin nada, «sin
 * proveedor».
 */
export const nombreDePestana = (proveedor: string | null | undefined, existe = false): string =>
  `Factura recibida · ${proveedor?.trim() || (existe ? 'sin proveedor' : 'nueva')}`

/**
 * «Guardar y siguiente» se enciende siempre que quede algo por hacer: lo que no
 * se puede validar no lo apaga (se guarda, se dice por qué y no se pasa: regla
 * 8). Se apaga mientras guarda, y en una validada o descartada, que ya no se
 * tocan aquí.
 */
export function puedeGuardar(o: { guardando: boolean; validada: boolean; descartada: boolean }): boolean {
  return !o.guardando && !o.validada && !o.descartada
}

/**
 * Dónde va el foco al abrir una ficha (lo ámbar es lo único que hay que mirar):
 * en la nueva, el proveedor; en una con duda, su botón «Dejar …», y así la
 * duda se contesta solo con el teclado (Intro o Tab + Intro). Una vez por
 * factura, cuando la ficha YA está pintada (la duda puede llegar antes que la
 * ficha: entonces se espera a que se pinte) y solo si quien la usa no ha
 * empezado a escribir en ESTA factura. No mira dónde está el foco ahora: al
 * pasar con Intro a la siguiente, se queda en una casilla de la de antes, que
 * es la misma pantalla. null: todavía nada (o ya está).
 */
export function dondeVaElFoco(o: { pintada: boolean; yaPuesto: boolean; tocada: boolean; aMano: boolean; hayDuda: boolean }): 'proveedor' | 'duda' | null {
  if (!o.pintada || o.yaPuesto || o.tocada) return null
  if (o.aMano) return 'proveedor'
  return o.hayDuda ? 'duda' : null
}

/**
 * R14 · La franja del proveedor que Sumied le puso al leerla: «Proveedor nuevo: lo ha dado
 * de alta Sumied con lo que trae la factura» (o la plataforma, que es acreedor), con
 * «Deshacer» mientras no esté validada. null si no lo puso Sumied, si ya se deshizo o si en
 * la ficha hay ahora otro proveedor.
 */
export function franjaProveedorSolo(o: {
  aMano: boolean
  solo: { que: 'alta' | 'existente' | 'plataforma' | 'no'; supplierId: string | null; deshecho: boolean } | null
  proveedorId: string
  nombre: string | null
  validada: boolean
}): { fuerte: string; texto: string; deshacer: boolean } | null {
  const s = o.solo
  if (o.aMano || !s || s.deshecho || !s.supplierId || s.supplierId !== o.proveedorId) return null
  if (s.que === 'alta') return { fuerte: 'Proveedor nuevo:', texto: 'lo ha dado de alta Sumied con lo que trae la factura.', deshacer: !o.validada }
  if (s.que === 'plataforma') return { fuerte: 'Es una plataforma:', texto: `${o.nombre ?? 'la plataforma'} es acreedor; la factura va a su ficha y a su 410.`, deshacer: !o.validada }
  return null
}

/**
 * R14 · La cuenta de gasto propuesta sin historial (conta_gasto_propuesto), en ámbar y con
 * su porqué («Propuesta: vende pollo y alitas → 600 Compras de mercaderías»), para que
 * baste Intro. Solo mientras la casilla tenga esa misma cuenta y no haya nada aprendido.
 */
export function gastoEnAmbar(o: { aMano: boolean; propuesto: { cuenta: string | null; porque: string } | null; aprendida: string | null; cuentaAhora: string }): UnaComprobacion | null {
  if (o.aMano || o.aprendida || !o.propuesto?.cuenta || o.cuentaAhora !== o.propuesto.cuenta) return null
  return { id: 'gasto-propuesto', tono: 'ambar', texto: o.propuesto.porque }
}
