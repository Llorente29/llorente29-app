// src/modules/conta/lib/libroRegistro.ts
//
// C05 · Libros registro del IVA (RIVA arts. 62–70) en el formato que pide la
// AEAT en un requerimiento: «Formatos de los Libros Registro de IVA e IRPF»
// (PDF, V.18.02.2026) y «Diseños de registro normalizados» (XLSX), los dos en
// docs/conta/fuentes/ con su huella. Núcleo puro: de las filas de
// vat_book_entry a las columnas exactas del diseño, el nombre del fichero, el
// cuadre con el diario (regla 6) y los filtros del listado de facturación de
// Diez (respuesta 1).
//
// Respuesta 1 del C05: el asiento resumen de tiques es F4 («asiento resumen
// de facturas»), con el primer y el último número y cuántos tiques; F2 queda
// para una factura simplificada suelta. La pantalla dice «F4 · resumen ·
// art. 63.4».

export type Libro = 'issued' | 'received' | 'investment' | 'not_subject'
export type TipoFactura = 'F1' | 'F2' | 'F3' | 'F4' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

export interface AnotacionLibro {
  id: string
  entryId: string
  book: Libro
  invoiceType: TipoFactura
  series: string | null
  number: string | null
  numberTo: string | null
  documentsCount: number
  issueDate: string
  operationDate: string | null
  receivedDate: string | null
  receivedNumber: string | null
  partyId: string | null
  counterpartTaxId: string | null
  counterpartIdType: string | null
  counterpartCountry: string | null
  counterpartName: string | null
  operationKey: string
  qualification: string | null
  exemptCause: string | null
  taxBase: number
  taxRate: number | null
  taxAmount: number
  surchargeRate: number | null
  surchargeAmount: number | null
  total: number | null
  deductibleAmount: number | null
  deductibleLater: boolean
  reverseCharge: boolean
  investmentGood: boolean
  withholdingRate: number | null
  withholdingAmount: number | null
  activityCode: string | null
  activityType: string | null
  activityIae: string | null
  correctsRef: string | null
  sourceType: string
  voidedAt: string | null
}

const c = (n: number) => Math.round(n * 100)

// ── Las columnas, literal del diseño de la AEAT (sin las llamadas a notas) ──
// La prueba tests/unit/modules/conta/libroRegistro.test.ts las saca otra vez
// del texto bajado y falla si la AEAT cambia el diseño.
export const COLUMNAS_EXPEDIDAS = [
  'Autoliquidación · Ejercicio', 'Autoliquidación · Periodo', 'Actividad · Código', 'Actividad · Tipo', 'Actividad · Grupo o Epígrafe del IAE',
  'Tipo de Factura', 'Concepto de Ingreso', 'Ingreso Computable', 'Fecha Expedición', 'Fecha Operación',
  'Identificación de la Factura · Serie', 'Identificación de la Factura · Número', 'Identificación de la Factura · Número-Final',
  'NIF Destinatario · Tipo', 'NIF Destinatario · Código País', 'NIF Destinatario · Identificación', 'Nombre Destinatario',
  'Clave de Operación', 'Calificación de la Operación', 'Operación Exenta', 'Total Factura', 'Base Imponible', 'Tipo de IVA',
  'Cuota IVA Repercutida', 'Tipo de Recargo Eq.', 'Cuota Recargo Eq.',
  'Cobro (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Fecha',
  'Cobro (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Importe',
  'Cobro (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Medio Utilizado',
  'Cobro (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Identificación Medio Utilizado',
  'Tipo Retención del IRPF', 'Importe Retenido del IRPF', 'Registro Acuerdo Facturación', 'Inmueble · Situación', 'Inmueble · Referencia Catastral',
  'Referencia Externa',
] as const

export const COLUMNAS_RECIBIDAS = [
  'Autoliquidación · Ejercicio', 'Autoliquidación · Periodo', 'Actividad · Código', 'Actividad · Tipo', 'Actividad · Grupo o Epígrafe del IAE',
  'Tipo de Factura', 'Concepto de Gasto', 'Gasto Deducible', 'Fecha Expedición', 'Fecha Operación',
  'Identificación Factura del Expedidor · (Serie-Número)', 'Identificación Factura del Expedidor · Número-Final',
  'Fecha Recepción', 'Número Recepción', 'Número Recepción Final',
  'NIF Expedidor · Tipo', 'NIF Expedidor · Código País', 'NIF Expedidor · Identificación', 'Nombre Expedidor',
  'Clave de Operación', 'Bien de Inversión', 'Inversión del Sujeto Pasivo', 'Deducible en Periodo Posterior',
  'Periodo Deducción · Ejercicio', 'Periodo Deducción · Periodo',
  'Total Factura', 'Base Imponible', 'Tipo de IVA', 'Cuota IVA Soportado', 'Cuota Deducible', 'Tipo de Recargo Eq.', 'Cuota Recargo Eq.',
  'Pago (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Fecha',
  'Pago (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Importe',
  'Pago (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Medio Utilizado',
  'Pago (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF) · Identificación Medio Utilizado',
  'Tipo Retención del IRPF', 'Importe Retenido del IRPF', 'Registro Acuerdo Facturación', 'Inmueble · Situación', 'Inmueble · Referencia Catastral',
  'Referencia Externa',
] as const

export const COLUMNAS_BIENES = [
  'Autoliquidación · Ejercicio', 'Autoliquidación · Periodo', 'Actividad · Código', 'Actividad · Tipo', 'Actividad · Grupo o Epígrafe del IAE',
  'Tipo de Bien', 'Descripción del Bien · Identificador', 'Descripción del Bien · Literal', 'Fecha Inicio Utilización',
  'Valor Adquisición', 'Valor Amortizable', 'Método de Amortización', 'Porcentaje de Amortización',
  'Amortización · Acumulada al Inicio', 'Amortización · Cuota Resultante', 'Amortización · Acumulada al final', 'Amortización · Pendiente',
  'Fecha Expedición', 'Identificación Factura del Expedidor · (Serie-Número)', 'Identificación Factura del Expedidor · Número-Final',
  'Número Recepción', 'Número Recepción Final', 'NIF Expedidor · Tipo', 'NIF Expedidor · Código País', 'NIF Expedidor · Identificación', 'Nombre Expedidor',
  'Año de Inicio Utilización · Base Imponible', 'Año de Inicio Utilización · Tipo de IVA', 'Año de Inicio Utilización · Prorrata Definitiva',
  'Año de Inicio Utilización · Cuota Deducible', 'Regularización Anual · Prorrata Definitiva', 'Regularización Anual · Cuota Deducible',
  'Regularización Anual · Cuota a Regularizar', 'Baja del Bien · Fecha', 'Baja del Bien · Causa',
  'Identificación de la Factura de Transmisión del Bien · Serie', 'Identificación de la Factura de Transmisión del Bien · Número',
  'Identificación de la Factura de Transmisión del Bien · Número-Final', 'Registro Acuerdo Facturación', 'Referencia Externa',
] as const

/** Las hojas del fichero de libros del IVA (tipo «C»: todos los del IVA). */
export const HOJAS = { issued: 'EXPEDIDAS', received: 'RECIBIDAS', investment: 'BIENES-INVERSIÓN' } as const

/** Nombre del fichero: ejercicio + NIF + «C» (libros del IVA) + nombre o razón social. */
export function nombreFichero(ejercicio: number, nif: string, razonSocial: string): string {
  const limpio = razonSocial.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${ejercicio}${nif.replace(/[\s.-]/g, '').toUpperCase()}C${limpio}.xlsx`
}

/** «1T»…«4T» de una fecha 'YYYY-MM-DD'. */
export const trimestre = (fecha: string) => `${Math.floor((Number(fecha.slice(5, 7)) - 1) / 3) + 1}T`
const fechaAeat = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '')

export type Celda = string | number | null

/** Una anotación de expedidas en las 36 columnas. */
export function filaExpedidas(a: AnotacionLibro): Celda[] {
  const fechaRef = a.operationDate ?? a.issueDate
  return [
    Number(fechaRef.slice(0, 4)), trimestre(fechaRef), a.activityCode, a.activityType, a.activityIae,
    a.invoiceType, null, null, fechaAeat(a.issueDate), a.operationDate && a.operationDate !== a.issueDate ? fechaAeat(a.operationDate) : '',
    a.series, a.number, a.numberTo,
    a.counterpartIdType, a.counterpartIdType && a.counterpartIdType !== '02' ? a.counterpartCountry : null, a.counterpartTaxId, a.counterpartName,
    a.operationKey, a.qualification, a.exemptCause, a.total, a.taxBase, a.taxRate, a.taxAmount, a.surchargeRate, a.surchargeAmount,
    null, null, null, null,
    a.withholdingRate, a.withholdingAmount, null, null, null, a.entryId,
  ]
}

/** Una anotación de recibidas en las 42 columnas. */
export function filaRecibidas(a: AnotacionLibro): Celda[] {
  const fechaRef = a.operationDate ?? a.issueDate
  return [
    Number(fechaRef.slice(0, 4)), trimestre(fechaRef), a.activityCode, a.activityType, a.activityIae,
    a.invoiceType, null, null, fechaAeat(a.issueDate), a.operationDate && a.operationDate !== a.issueDate ? fechaAeat(a.operationDate) : '',
    [a.series, a.number].filter(Boolean).join('-') || null, a.numberTo,
    fechaAeat(a.receivedDate), a.receivedNumber, null,
    a.counterpartIdType, a.counterpartIdType && a.counterpartIdType !== '02' ? a.counterpartCountry : null, a.counterpartTaxId, a.counterpartName,
    a.operationKey, a.investmentGood ? 'S' : 'N', a.reverseCharge ? 'S' : 'N', a.deductibleLater ? 'S' : 'N', null, null,
    a.total, a.taxBase, a.taxRate, a.taxAmount, a.deductibleAmount, a.surchargeRate, a.surchargeAmount,
    null, null, null, null,
    a.withholdingRate, a.withholdingAmount, null, null, null, a.entryId,
  ]
}

/** Lo que falta para que una anotación valga en un requerimiento (ámbar con «Completar»). */
export function faltaParaCompletar(a: AnotacionLibro): string[] {
  const f: string[] = []
  const simplificada = a.invoiceType === 'F2' || a.invoiceType === 'F4' || a.invoiceType === 'R5'
  if (!simplificada && !a.counterpartTaxId) f.push(a.book === 'issued' ? 'NIF del destinatario' : 'NIF del expedidor')
  if (!a.number) f.push('número de factura')
  if (a.invoiceType === 'F4' && !a.numberTo) f.push('último número del resumen')
  if (a.book === 'issued' && !a.qualification && !a.exemptCause) f.push('calificación o causa de exención')
  return f
}

/** El texto del tipo de factura en pantalla. F4 lleva su artículo y su rango. */
export function etiquetaTipo(a: Pick<AnotacionLibro, 'invoiceType' | 'number' | 'numberTo' | 'documentsCount'>): string {
  if (a.invoiceType === 'F4') {
    const rango = a.number && a.numberTo ? ` · ${a.number}–${a.numberTo}` : ''
    return `F4 · resumen · art. 63.4${rango} · ${a.documentsCount} ${a.documentsCount === 1 ? 'tique' : 'tiques'}`
  }
  return ({ F1: 'F1 · factura', F2: 'F2 · simplificada', F3: 'F3 · sustitutiva', R1: 'R1 · rectificativa', R2: 'R2 · rectificativa (concurso)', R3: 'R3 · rectificativa (incobrable)', R4: 'R4 · rectificativa', R5: 'R5 · rectificativa de simplificada' } as const)[a.invoiceType]
}

// ── Regla 6: el libro cuadra con el diario ──────────────────────────────────

export interface CuadreLibro { libro: number; diario: number; diferencia: number; cuadra: boolean; frase: string }

/**
 * Suma de cuotas del libro del periodo frente al saldo del periodo de la 477
 * (expedidas) o la 472 (recibidas y bienes de inversión). Las anuladas no
 * cuentan: su asiento y su contraasiento se compensan también en el diario.
 */
export function cuadreConDiario(anotaciones: AnotacionLibro[], libro: 'issued' | 'received', movimientoDiario: number): CuadreLibro {
  const cuentaDe = libro === 'issued' ? '477' : '472'
  const vivas = anotaciones.filter((a) => !a.voidedAt && (libro === 'issued' ? a.book === 'issued' : a.book === 'received' || a.book === 'investment'))
  const suma = vivas.reduce((x, a) => x + c(a.taxAmount), 0) / 100
  const diferencia = (c(suma) - c(movimientoDiario)) / 100
  const cuadra = c(diferencia) === 0
  return {
    libro: suma, diario: movimientoDiario, diferencia, cuadra,
    frase: cuadra ? `Cuadra con el diario: ${fmt(suma)} en el libro y en la ${cuentaDe}.`
      : `No cuadra con el diario: el libro suma ${fmt(suma)} y la ${cuentaDe} ${fmt(movimientoDiario)} (${fmt(Math.abs(diferencia))} de diferencia). Suele ser un apunte de IVA sin libro registro o un asiento traído sin sus facturas.`,
  }
}

/** Las cuatro cifras de la cabecera de N15: base, cuota, cuadre y estado para el 303. */
export function cifrasLibro(anotaciones: AnotacionLibro[]): { base: number; cuota: number; anotaciones: number; porCompletar: number } {
  const vivas = anotaciones.filter((a) => !a.voidedAt)
  return {
    base: vivas.reduce((x, a) => x + c(a.taxBase), 0) / 100,
    cuota: vivas.reduce((x, a) => x + c(a.taxAmount), 0) / 100,
    anotaciones: vivas.length,
    porCompletar: vivas.filter((a) => faltaParaCompletar(a).length > 0).length,
  }
}

// ── Listado de facturación de Diez, como filtros del libro (respuesta 1) ───

export interface FiltrosLibro {
  subcuenta?: string
  nif?: string
  importeSuperiorA?: number
  tipos?: TipoFactura[]
  /** Solo los terceros que entran en el 347 (más de 3.005,06 € al año con el mismo NIF). */
  solo347?: boolean
  verAnuladas?: boolean
}

export const UMBRAL_347 = 3005.06

export function filtrar(anotaciones: AnotacionLibro[], f: FiltrosLibro, cuentasPorAsiento: Map<string, string[]> = new Map()): AnotacionLibro[] {
  let r = anotaciones.filter((a) => f.verAnuladas || !a.voidedAt)
  if (f.subcuenta) r = r.filter((a) => (cuentasPorAsiento.get(a.entryId) ?? []).some((x) => x.startsWith(f.subcuenta!)))
  if (f.nif) { const n = f.nif.toUpperCase().replace(/\s/g, ''); r = r.filter((a) => (a.counterpartTaxId ?? '').toUpperCase().includes(n)) }
  if (f.importeSuperiorA !== undefined) r = r.filter((a) => (a.total ?? a.taxBase + a.taxAmount) > f.importeSuperiorA!)
  if (f.tipos?.length) r = r.filter((a) => f.tipos!.includes(a.invoiceType))
  if (f.solo347) {
    const porNif = agruparPorNif(r)
    const entran = new Set(porNif.filter((g) => g.nif && Math.abs(g.total) > UMBRAL_347).map((g) => g.nif))
    r = r.filter((a) => a.counterpartTaxId && entran.has(a.counterpartTaxId))
  }
  return r
}

export interface GrupoNif { nif: string | null; nombre: string | null; anotaciones: number; base: number; cuota: number; total: number }

/** «Agrupar por NIF»: lo de cada tercero junto (las simplificadas sin NIF, juntas). */
export function agruparPorNif(anotaciones: AnotacionLibro[]): GrupoNif[] {
  const m = new Map<string, GrupoNif & { cb: number; cc: number; ct: number }>()
  for (const a of anotaciones.filter((x) => !x.voidedAt)) {
    const k = a.counterpartTaxId ?? '—'
    const g = m.get(k) ?? { nif: a.counterpartTaxId, nombre: a.counterpartName, anotaciones: 0, base: 0, cuota: 0, total: 0, cb: 0, cc: 0, ct: 0 }
    g.anotaciones++; g.cb += c(a.taxBase); g.cc += c(a.taxAmount); g.ct += c(a.total ?? a.taxBase + a.taxAmount)
    m.set(k, g)
  }
  return [...m.values()].map(({ cb, cc, ct, ...g }) => ({ ...g, base: cb / 100, cuota: cc / 100, total: ct / 100 }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
}

function fmt(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
