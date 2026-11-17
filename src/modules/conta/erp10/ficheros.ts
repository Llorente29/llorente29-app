// src/modules/conta/erp10/ficheros.ts
//
// X03 · LO QUE ESCRIBE LOS FICHEROS DE LA SALIDA A ERP10: subcuentas.xlsx y
// recibidas.xlsx (encargo X03, 17/11). Puro: sin red ni base. Lo usará la
// pantalla «Salida a ERP10» (el PR siguiente) con lo que lea de
// conta_erp10_por_salir y de cada asiento.
//
//   · Las columnas salen de la configuración de ERP10 (configuracion.ts), no se
//     escriben a mano: las de recibidas, con columnas() de Diez tal cual; las de
//     subcuentas, con una copia mínima (su XML usa <Configuracion_Subcuentas>,
//     que el lector de Diez no busca). Nada de Diez se toca.
//   · La forma del fichero que entró en ERP10 el 15-16/11: una hoja, sin fila de
//     títulos, una fila por factura; fechas como fecha; subcuentas, número de
//     factura y NIF como texto; importes como número, con su signo (un abono, en
//     negativo entero); el % de IVA, entero.
//   · Cada fila cumple su regla de cuadre, o no sale:
//       OI:        total = bases + cuotas − cuota de la retención;
//       ISP y AIS: total = bases − cuota de la retención (la cuota va, pero no suma);
//       siempre:   las cuentas de gasto suman las bases.
//   · Lo que no puede salir no entra en el fichero y se dice antes, con una frase
//     para un administrativo («Qué mirar antes de sacarlo»).

import { colocar, columnas, type Celda } from '../../../../supabase/functions/_shared/diezExcel.ts'
import { libroXlsx } from '@/modules/conta/lib/traspasoExcelLibro'
import { XML_RECIBIDAS, XML_SUBCUENTAS } from '@/modules/conta/erp10/configuracion'

export type Fila = (string | number)[]

// ── Las cuentas, al largo de ERP10 ───────────────────────────────────────────────

/**
 * El código de una subcuenta de Sumied en ERP10: la misma regla que
 * public.conta_erp10_subcuenta (X02), para hacerlo en el navegador sin ir a la
 * base por cada cuenta. Igual si ya tiene el largo; si no, la plantilla y lo de
 * detrás sin sus ceros, rellenando con ceros por el medio. Nulo si no cabe.
 */
export function subcuentaErp10(codigo: string, plantilla: string, largo: number): string | null {
  if (!/^[0-9]+$/.test(codigo) || !plantilla || !codigo.startsWith(plantilla)) return null
  if (codigo.length === largo) return codigo
  const resto = codigo.slice(plantilla.length).replace(/^0+/, '')
  if (plantilla.length + resto.length > largo) return null
  return plantilla + resto.padStart(largo - plantilla.length, '0')
}

/** El plan de la empresa: código de Sumied → su plantilla (company_account.template_code). */
export type Plan = ReadonlyMap<string, string>

/**
 * Las cuentas de una salida, convertidas, con las que no caben y las que chocan
 * (dos de Sumied que darían la misma en ERP10, entre ellas o con una que ya
 * salió). Ninguna de las que chocan sale.
 */
export function convertirCuentas(codigos: Iterable<string>, plan: Plan, largo: number, yaSalidas: ReadonlyMap<string, string> = new Map()) {
  const erp = new Map<string, string>()
  const noCaben = new Map<string, string>()
  const porErp = new Map<string, string[]>()
  for (const c of new Set(codigos)) {
    const plantilla = plan.get(c)
    const x = plantilla === undefined ? null : subcuentaErp10(c, plantilla, largo)
    if (x === null) {
      noCaben.set(c, plantilla === undefined ? `La cuenta ${c} no está en el plan de la empresa.` : `La cuenta ${c} no cabe en ERP10, que usa ${largo} cifras.`)
      continue
    }
    erp.set(c, x)
    porErp.set(x, [...(porErp.get(x) ?? []), c])
  }
  for (const [x, cs] of porErp) {
    const salida = yaSalidas.get(x)
    const todas = [...new Set([...cs, ...(salida !== undefined ? [salida] : [])])].sort((a, b) => a.length - b.length || a.localeCompare(b))
    if (todas.length < 2) continue
    for (const c of cs) {
      erp.delete(c)
      noCaben.set(c, `Las cuentas ${todas.join(' y ')} quedarían en ERP10 como la misma, ${x}: no sale ninguna de las dos hasta que se cambie una.`)
    }
  }
  return { erp, noCaben }
}

// ── Las recibidas ────────────────────────────────────────────────────────────────

/** Una línea del asiento de una recibida: lo de conta_recibida_envio, más lo que dice de IVA y retención la línea. */
export type LineaRecibida = {
  cuenta: string
  debe: number
  haber: number
  /** % del IVA y su base (en las líneas de IVA). */
  tipoIva: number | null
  baseIva: number | null
  /** journal_line.vat_deductible: «no» o «prorrata» no salen. */
  deducible?: 'yes' | 'no' | 'prorrata' | null
  /** % de recargo de equivalencia del tipo de la línea, si lo lleva. */
  recargo?: number | null
  /** journal_line.withholding_model de la línea de retención: 115 alquiler, 111 profesional. */
  modeloRetencion?: '111' | '115' | '123' | null
}

/**
 * De qué es la compra. Sumied no separa una intracomunitaria de servicios de una
 * de bienes (las dos con el tipo «ue_compra»): lo dice quien la monta.
 */
export type Operacion = 'interior' | 'isp' | 'intra_servicios' | 'intra_bienes' | 'importacion' | 'otra'

export type RecibidaParaErp10 = {
  entryId: string
  /** AAAA-MM-DD: la del asiento de Sumied (fecha contable, fiscal y de introducción). */
  fecha: string
  factura: { numero: string | null; fecha: string }
  proveedor: { nombre: string; nif: string | null }
  lineas: LineaRecibida[]
  operacion: Operacion
  /** Si Sumied tiene su PDF. */
  tienePdf: boolean
}

export type NoSale = { entryId: string; numero: string; porque: string }

const c = (x: number) => Math.round(Number(x) * 100)
const e = (x: number) => x / 100
const fechaCelda = (aaaammdd: string) => `${aaaammdd}T12:00:00.000Z`
const TIPO_OPERACION: Partial<Record<Operacion, string>> = { interior: 'OI', isp: 'ISP', intra_servicios: 'AIS' }
const NO_VA_OPERACION: Record<Exclude<Operacion, 'interior' | 'isp' | 'intra_servicios'>, string> = {
  intra_bienes: 'Es una compra de bienes en otro país de la UE, y ERP10 solo la admite al importar si es de servicios. Métela a mano en ERP10.',
  importacion: 'Es una importación, y ERP10 no la admite al importar. Métela a mano en ERP10.',
  otra: 'Tiene un tipo de operación que ERP10 no admite al importar. Métela a mano en ERP10.',
}

/** Lo que se ha leído de una recibida, en céntimos, antes de ponerla en su fila. */
export type RecibidaLeida = {
  entryId: string
  numero: string
  fechaFactura: string
  fechaAsiento: string
  nif: string
  nombre: string
  proveedor: string
  tipoOperacion: string
  gastos: { cuenta: string; importe: number }[]
  iva: { pct: number; base: number; cuota: number }[]
  retencion: { tipo: 'ALQ' | 'PRO'; cuenta: string; base: number; pct: number; cuota: number } | null
  total: number
  tienePdf: boolean
}

/** Lee el asiento de una recibida. Lo que no puede ir en el fichero de ERP10 devuelve su porqué. */
export function leerRecibida(r: RecibidaParaErp10): RecibidaLeida | NoSale {
  const numero = String(r.factura.numero ?? '').trim()
  const no = (porque: string): NoSale => ({ entryId: r.entryId, numero, porque })
  if (!numero) return no('No tiene número de factura.')
  const tipoOperacion = TIPO_OPERACION[r.operacion]
  if (!tipoOperacion) return no(NO_VA_OPERACION[r.operacion as keyof typeof NO_VA_OPERACION])

  const gastos = new Map<string, number>()
  const iva = new Map<number, { base: number; cuota: number }>()
  const prov = new Map<string, number>()
  const ret = new Map<string, { cuota: number; modelo: string | null }>()
  let autoliquidada = 0
  for (const l of r.lineas) {
    const neto = c(l.debe) - c(l.haber)
    if (/^[26]/.test(l.cuenta)) {
      if (l.tipoIva != null) return no('Lleva IVA no deducible, y ERP10 no lo admite al importar. Métela a mano en ERP10.')
      gastos.set(l.cuenta, (gastos.get(l.cuenta) ?? 0) + neto)
    } else if (/^472/.test(l.cuenta)) {
      if (l.deducible === 'no') return no('Lleva IVA no deducible, y ERP10 no lo admite al importar. Métela a mano en ERP10.')
      if (l.deducible === 'prorrata') return no('Lleva IVA con prorrata, y ERP10 no lo admite al importar. Métela a mano en ERP10.')
      if (l.recargo != null && Number(l.recargo) !== 0) return no('Lleva recargo de equivalencia, y ERP10 no lo admite al importar. Métela a mano en ERP10.')
      if (l.tipoIva == null || l.baseIva == null) return no(`La línea de IVA de la cuenta ${l.cuenta} no tiene su tipo y su base.`)
      const pct = Number(l.tipoIva)
      const x = iva.get(pct) ?? { base: 0, cuota: 0 }
      x.base += c(Math.abs(Number(l.baseIva))) * (neto < 0 ? -1 : 1); x.cuota += neto
      iva.set(pct, x)
    } else if (/^477/.test(l.cuenta)) {
      // La autoliquidación de la ISP o de la intracomunitaria: el repercutido que compensa el soportado.
      if (r.operacion === 'interior') return no(`Lleva IVA repercutido (cuenta ${l.cuenta}) sin ser una inversión del sujeto pasivo ni intracomunitaria.`)
      autoliquidada += -neto
    } else if (/^4[01]/.test(l.cuenta)) {
      prov.set(l.cuenta, (prov.get(l.cuenta) ?? 0) - neto)
    } else if (/^4751/.test(l.cuenta)) {
      const x = ret.get(l.cuenta) ?? { cuota: 0, modelo: null }
      x.cuota += -neto; x.modelo = x.modelo ?? l.modeloRetencion ?? null
      ret.set(l.cuenta, x)
    } else {
      return no(`Lleva la cuenta ${l.cuenta}, que no es de gasto, IVA, proveedor ni retención. Métela a mano en ERP10.`)
    }
  }

  const gastosVivos = [...gastos].filter(([, v]) => v !== 0)
  if (gastosVivos.length === 0) return no('No lleva ninguna cuenta de gasto.')
  if (gastosVivos.length > 2) return no(`Esta factura reparte el gasto en ${gastosVivos.length} cuentas y ERP10 admite 2 al importar. Métela a mano en ERP10.`)
  if (iva.size > 4) return no(`Esta factura lleva ${iva.size} tipos de IVA y ERP10 admite 4 al importar. Métela a mano en ERP10.`)
  if (prov.size !== 1) return no(prov.size === 0 ? 'No lleva la cuenta del proveedor.' : `Va a ${prov.size} cuentas de proveedor y tiene que ir a una.`)
  if (ret.size > 1) return no('Lleva más de una retención. Métela a mano en ERP10.')
  const [proveedor, total] = [...prov][0]
  if (total === 0) return no('El total de la factura es cero.')

  const sumaGastos = gastosVivos.reduce((t, [, v]) => t + v, 0)
  const ivas = iva.size
    ? [...iva].sort(([a], [b]) => a - b).map(([pct, x]) => ({ pct, base: x.base, cuota: x.cuota }))
    // Sin IVA: una línea al 0 %, con la base de los gastos (como en Diez).
    : [{ pct: 0, base: sumaGastos, cuota: 0 }]
  for (const x of ivas) if (!Number.isInteger(x.pct)) return no(`Lleva un IVA del ${x.pct} %, que no es un tipo entero.`)
  if (tipoOperacion !== 'OI' && autoliquidada !== ivas.reduce((t, x) => t + x.cuota, 0)) {
    return no('El IVA autoliquidado no es igual al soportado: revisa el asiento.')
  }

  let retencion: RecibidaLeida['retencion'] = null
  if (ret.size === 1) {
    const [cuenta, x] = [...ret][0]
    const tipo = x.modelo === '115' ? 'ALQ' : x.modelo === '111' ? 'PRO' : null
    if (!tipo) return no('Lleva una retención que no es de alquiler ni de profesional. Métela a mano en ERP10.')
    const pct = sumaGastos ? Math.round((x.cuota * 100) / sumaGastos) : 0
    if (Math.round((sumaGastos * pct) / 100) !== x.cuota) return no('La retención no es un tanto por ciento entero de la base.')
    retencion = { tipo, cuenta, base: sumaGastos, pct, cuota: x.cuota }
  }

  return {
    entryId: r.entryId, numero, fechaFactura: r.factura.fecha, fechaAsiento: r.fecha,
    nif: String(r.proveedor.nif ?? '').trim(), nombre: r.proveedor.nombre, proveedor, tipoOperacion,
    gastos: gastosVivos.map(([cuenta, importe]) => ({ cuenta, importe })),
    iva: ivas, retencion, total, tienePdf: r.tienePdf,
  }
}

/** La regla de cuadre de cada fila (las 1.683 del fichero medido la cumplen todas). Nulo si cuadra; si no, por qué. */
export function cuadre(x: Pick<RecibidaLeida, 'tipoOperacion' | 'gastos' | 'iva' | 'retencion' | 'total'>): string | null {
  const bases = x.iva.reduce((t, i) => t + i.base, 0)
  const cuotas = x.iva.reduce((t, i) => t + i.cuota, 0)
  const ret = x.retencion?.cuota ?? 0
  if (x.gastos.reduce((t, g) => t + g.importe, 0) !== bases) return 'Las cuentas de gasto no suman las bases del IVA.'
  const esperado = x.tipoOperacion === 'OI' ? bases + cuotas - ret : bases - ret
  if (esperado !== x.total) {
    return x.tipoOperacion === 'OI'
      ? 'El total no es bases más cuotas menos la retención.'
      : 'El total no es la base menos la retención (en una inversión del sujeto pasivo o intracomunitaria, la cuota no suma).'
  }
  return null
}

/**
 * El nombre de un PDF en la carpeta de la salida: AAAAMMDD_proveedor_numero.pdf,
 * solo con letras sin tilde, cifras, guion y guion bajo. Si se repite dentro de
 * la salida, lleva _2, _3… detrás.
 */
export function nombrePdf(o: { fechaFactura: string; proveedor: string; numero: string }, usados: Set<string>): string {
  const limpio = (s: string, max: number) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'sin-nombre'
  const base = `${o.fechaFactura.replace(/-/g, '')}_${limpio(o.proveedor, 30)}_${limpio(o.numero, 30)}`
  let n = `${base}.pdf`
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base}_${i}.pdf`
  usados.add(n.toLowerCase())
  return n
}

/** La ruta del PDF en el ordenador donde se importa: la carpeta (de la ficha de la empresa) y el nombre. */
export function rutaPdf(carpeta: string, nombre: string): string {
  const sep = carpeta.includes('/') && !carpeta.includes('\\') ? '/' : '\\'
  return `${carpeta.replace(/[\\/]+$/, '')}${sep}${nombre}`
}

/** La fila del fichero de recibidas: cada dato en la columna que dice la configuración de ERP10. */
export function filaRecibida(x: RecibidaLeida, cuentas: ReadonlyMap<string, string>, ruta: string, xml = XML_RECIBIDAS): Fila {
  const cta = (k: string) => cuentas.get(k) ?? k
  const v: Record<string, Celda> = {
    '002': fechaCelda(x.fechaFactura), '004': cta(x.proveedor), '006': x.numero,
    '057': ruta, '045': e(x.total), '003': x.nif,
    '041': cta(x.gastos[0].cuenta), '043': e(x.gastos[0].importe),
    '092': x.gastos[1] ? cta(x.gastos[1].cuenta) : '', '094': x.gastos[1] ? e(x.gastos[1].importe) : '',
    '001': fechaCelda(x.fechaAsiento), '090': fechaCelda(x.fechaAsiento), '118': fechaCelda(x.fechaAsiento),
    '009': x.tipoOperacion,
  }
  // IVA 1 a 4: base, % y cuota (010-012, 013-015, 016-018, 019-021).
  x.iva.forEach((i, k) => {
    const b = 10 + k * 3
    v[String(b).padStart(3, '0')] = e(i.base); v[String(b + 1).padStart(3, '0')] = i.pct; v[String(b + 2).padStart(3, '0')] = e(i.cuota)
  })
  if (x.retencion) {
    v['038'] = cta(x.retencion.cuenta); v['035'] = e(x.retencion.base); v['036'] = x.retencion.pct
    v['037'] = e(x.retencion.cuota); v['034'] = x.retencion.tipo
  }
  return colocar(v, columnas(xml)) as Fila
}

/** Los tipos de operación que conoce la configuración de recibidas (Configuracion2 › Campo009). */
export function tiposOperacionDelXml(xml = XML_RECIBIDAS): string[] {
  const b = xml.match(/<Configuracion2>[\s\S]*?<Campo009>([\s\S]*?)<\/Campo009>/)?.[1] ?? ''
  return [...b.matchAll(/<Valor\d+>([^<]+)<\/Valor\d+>/g)].map((m) => m[1])
}
/** Los tipos de retención que conoce (Configuracion2 › Campo034). */
export function tiposRetencionDelXml(xml = XML_RECIBIDAS): string[] {
  const b = xml.match(/<Configuracion2>[\s\S]*?<Campo034>([\s\S]*?)<\/Campo034>/)?.[1] ?? ''
  return [...b.matchAll(/<Valor\d+>([^<]+)<\/Valor\d+>/g)].map((m) => m[1])
}

export type SalidaRecibidas = {
  filas: { entryId: string; numero: string; fila: Fila; pdf: string | null }[]
  noSalen: NoSale[]
  /** Las cuentas de Sumied que usan las filas que salen (para el fichero de subcuentas). */
  cuentas: Set<string>
}

/**
 * Las recibidas de una salida: las que van al fichero, con su fila y el nombre de
 * su PDF, y las que no, con su porqué. Las cuentas se convierten todas juntas,
 * para ver las que chocan entre sí o con las que ya salieron.
 */
export function prepararRecibidas(lista: readonly RecibidaParaErp10[], o: {
  plan: Plan; largo: number; carpetaPdf: string; yaSalidas?: ReadonlyMap<string, string>; xml?: string
}): SalidaRecibidas {
  const xml = o.xml ?? XML_RECIBIDAS
  const operaciones = tiposOperacionDelXml(xml); const retenciones = tiposRetencionDelXml(xml)
  const noSalen: NoSale[] = []
  const leidas: RecibidaLeida[] = []
  for (const r of lista) {
    const x = leerRecibida(r)
    if ('porque' in x) { noSalen.push(x); continue }
    if (!operaciones.includes(x.tipoOperacion)) { noSalen.push({ entryId: x.entryId, numero: x.numero, porque: `La configuración de ERP10 no conoce el tipo de operación «${x.tipoOperacion}».` }); continue }
    if (x.retencion && !retenciones.includes(x.retencion.tipo)) { noSalen.push({ entryId: x.entryId, numero: x.numero, porque: `La configuración de ERP10 no conoce la retención «${x.retencion.tipo}».` }); continue }
    const mal = cuadre(x)
    if (mal) { noSalen.push({ entryId: x.entryId, numero: x.numero, porque: `${mal} No sale.` }); continue }
    leidas.push(x)
  }
  const usadasPor = (x: RecibidaLeida) => [x.proveedor, ...x.gastos.map((g) => g.cuenta), ...(x.retencion ? [x.retencion.cuenta] : [])]
  const { erp, noCaben } = convertirCuentas(leidas.flatMap(usadasPor), o.plan, o.largo, o.yaSalidas)
  const filas: SalidaRecibidas['filas'] = []
  const cuentas = new Set<string>()
  const usados = new Set<string>()
  for (const x of leidas) {
    const malas = usadasPor(x).filter((k) => noCaben.has(k))
    if (malas.length) { noSalen.push({ entryId: x.entryId, numero: x.numero, porque: noCaben.get(malas[0])! }); continue }
    const pdf = x.tienePdf ? nombrePdf({ fechaFactura: x.fechaFactura, proveedor: x.nombre, numero: x.numero }, usados) : null
    filas.push({ entryId: x.entryId, numero: x.numero, fila: filaRecibida(x, erp, pdf ? rutaPdf(o.carpetaPdf, pdf) : '', xml), pdf })
    for (const k of usadasPor(x)) cuentas.add(k)
  }
  return { filas, noSalen, cuentas }
}

// ── Las subcuentas ─────────────────────────────────────────────────────────────────

/** Código de la configuración → columna (1 = A). Copia mínima de columnas() de Diez para <Configuracion_Subcuentas>. */
export function columnasSubcuentas(xml = XML_SUBCUENTAS): Record<string, number> {
  const bloque = xml.match(/<Configuracion_Subcuentas>([\s\S]*?)<\/Configuracion_Subcuentas>/)?.[1]
  if (!bloque) throw new Error('La configuración de subcuentas no trae <Configuracion_Subcuentas>.')
  const m: Record<string, number> = {}
  for (const [, cod, col] of bloque.matchAll(/<Campo(\d{3})>(\d+)<\/Campo\1>/g)) m[cod] = Number(col)
  return m
}

export type CuentaNueva = {
  codigo: string
  nombre: string
  /** El NIF, si es de un tercero. */
  nif?: string | null
  /** La cuenta de gasto habitual de un proveedor, si la tiene. */
  gastoHabitual?: string | null
}

/** La fila de una cuenta nueva: subcuenta convertida, nombre, NIF y cuenta de gasto habitual (convertida). */
export function filaSubcuenta(x: CuentaNueva, cuentas: ReadonlyMap<string, string>, xml = XML_SUBCUENTAS): Fila {
  const col = columnasSubcuentas(xml)
  const v: Record<string, string> = {
    '001': cuentas.get(x.codigo) ?? x.codigo, '002': x.nombre.trim(), '004': String(x.nif ?? '').trim(),
    '023': x.gastoHabitual ? cuentas.get(x.gastoHabitual) ?? '' : '',
  }
  const fila: Fila = Array(Math.max(...Object.values(col))).fill('')
  for (const [cod, val] of Object.entries(v)) {
    if (!val) continue
    if (!(cod in col)) throw new Error(`La configuración de subcuentas no tiene columna para el campo ${cod}.`)
    fila[col[cod] - 1] = val
  }
  return fila
}

// ── Los libros y las huellas ─────────────────────────────────────────────────────────

/** La huella de una fila: la que se apunta en el lote (conta_erp10_lote_apuntar) y dice si después ha cambiado. */
export async function huellaFila(fila: Fila): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(fila))
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * El libro de un fichero: una hoja, sin títulos, con la misma función que la
 * salida a Diez (libroXlsx: textos en sharedStrings, fechas como día de Excel con
 * dd/mm/yyyy). Las celdas vacías no se escriben (en vez de un texto vacío).
 */
export async function libroErp10(filas: readonly Fila[]): Promise<ArrayBuffer> {
  const sinVacias = filas.map((f) => f.map((v) => (v === '' ? undefined : v)))
  return libroXlsx(sinVacias as unknown as (string | number)[][], 'Hoja1')
}

export const FICHERO_SUBCUENTAS = 'subcuentas.xlsx'
export const FICHERO_RECIBIDAS = 'recibidas.xlsx'
