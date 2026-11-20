// supabase/functions/_shared/erp10Ficheros.ts (antes src/modules/conta/erp10/ficheros.ts)
//
// X10c (19/11): aquí, sin nada del navegador, para que el servidor (conta-erp10-escribir) arme
// lo que escribe en ERP10 desde la base con las MISMAS reglas que el Excel. El libro .xlsx
// (libroErp10) se queda en src/modules/conta/erp10/ficheros.ts, que vuelve a exportar esto.
//
// X03 · LO QUE ESCRIBE LOS FICHEROS DE LA SALIDA A ERP10: subcuentas.xlsx y
// recibidas.xlsx (encargo X03, 17/11); X05, expedidas.xlsx. Puro: sin red ni
// base. Lo usa la pantalla «Salida a ERP10» con lo que lee de
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

import { colocar, columnas, type Celda } from './diezExcel.ts'
import { XML_ASIENTOS, XML_EXPEDIDAS, XML_RECIBIDAS, XML_SUBCUENTAS } from './erp10Configuracion.ts'

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

/**
 * X10b · La recibida para sacarla a ERP10 por la conexión (conta-erp10-escribir): lo mismo que
 * va a su fila del Excel (la leída, en céntimos), con las cuentas YA en ERP10. La factura la
 * arma el servidor (_shared/erp10Escribir.ts, RecibidaParaApi: la misma forma).
 */
export type RecibidaParaApi = Omit<RecibidaLeida, 'tienePdf' | 'gastos' | 'retencion'> & {
  gastos: { cuenta: string; importe: number }[]
  retencion: RecibidaLeida['retencion']
}
export function recibidaParaApi(x: RecibidaLeida, erp: ReadonlyMap<string, string>): RecibidaParaApi {
  const a = (k: string) => erp.get(k) ?? k
  return {
    entryId: x.entryId, numero: x.numero, fechaFactura: x.fechaFactura, fechaAsiento: x.fechaAsiento, nif: x.nif, nombre: x.nombre,
    proveedor: a(x.proveedor), tipoOperacion: x.tipoOperacion, gastos: x.gastos.map((g) => ({ cuenta: a(g.cuenta), importe: g.importe })),
    iva: x.iva, retencion: x.retencion ? { ...x.retencion, cuenta: a(x.retencion.cuenta) } : null, total: x.total,
  }
}
/** X10b · ¿Sale por la conexión? Lo medido: operación interior, sin retención, hasta tres tipos de IVA. Lo demás, con el Excel. */
export function salePorLaConexion(x: RecibidaParaApi): boolean {
  return x.tipoOperacion === 'OI' && !x.retencion && x.iva.length >= 1 && x.iva.length <= 3 && !!x.numero.trim()
}

export type SalidaRecibidas = {
  /** `usa`: las cuentas de Sumied de la fila (para ver, con las emitidas, las que chocan entre las dos). `api`: X10b. */
  filas: { entryId: string; numero: string; fila: Fila; pdf: string | null; usa: string[]; api: RecibidaParaApi }[]
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
  /** Los nombres de PDF ya usados en la misma salida (X05: las emitidas van en el mismo zip). */
  usados?: Set<string>
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
  const usados = o.usados ?? new Set<string>()
  for (const x of leidas) {
    const malas = usadasPor(x).filter((k) => noCaben.has(k))
    if (malas.length) { noSalen.push({ entryId: x.entryId, numero: x.numero, porque: noCaben.get(malas[0])! }); continue }
    const pdf = x.tienePdf ? nombrePdf({ fechaFactura: x.fechaFactura, proveedor: x.nombre, numero: x.numero }, usados) : null
    filas.push({ entryId: x.entryId, numero: x.numero, fila: filaRecibida(x, erp, pdf ? rutaPdf(o.carpetaPdf, pdf) : '', xml), pdf, usa: usadasPor(x), api: recibidaParaApi(x, erp) })
    for (const k of usadasPor(x)) cuentas.add(k)
  }
  return { filas, noSalen, cuentas }
}

// ── Las emitidas (X05) ───────────────────────────────────────────────────────────────
//
// La configuración de expedidas medida en ERP10 el 17/11 (XML_EXPEDIDAS) pone:
// las tres fechas en una columna (la de la factura), número, subcuenta del
// cliente, total, IVA 1 a 4 (base, % y cuota), ruta del PDF y contrapartidas de
// ingreso 1 a 4 (subcuenta e importe). Los campos 124 a 126 tienen columna, pero
// qué son está sin medir: no se escriben. No pone NIF (va en la ficha de la
// subcuenta), tipo de operación, exención, retención, recargo, resumen de
// facturas ni factura rectificada. Lo que necesitaría una de esas columnas no
// sale, y se dice qué hacer en ERP10.

/** Una línea del asiento de una emitida (conta_erp10_emitidas_por_salir). */
export type LineaEmitida = {
  cuenta: string
  debe: number
  haber: number
  /** % del IVA y su base (en las líneas de IVA). */
  tipoIva: number | null
  baseIva: number | null
}

/** La operación, decidida en la base con el tratamiento del IVA de sus tipos. */
export type OperacionEmitida = 'interior' | 'intra' | 'isp' | 'exenta' | 'no_sujeta'

export type EmitidaParaErp10 = {
  entryId: string
  /** AAAA-MM-DD: la del asiento de Sumied. */
  fecha: string
  factura: { numero: string | null; fecha: string }
  cliente: { nombre: string; nif: string | null }
  /** Una rectificativa (la factura de venta lo dice, o su tipo en el libro es R1 a R5). */
  rectificativa: boolean
  /** El tipo de factura del libro de expedidas: F1, F2, F3, F4 (resumen)… */
  tipoFactura: string | null
  operacion: OperacionEmitida
  /** Lo que lleva de recargo de equivalencia y de retención (0 si nada). */
  recargo: number
  retencion: number
  lineas: LineaEmitida[]
  tienePdf: boolean
}

/** Lo que se ha leído de una emitida, en céntimos, antes de ponerla en su fila. */
export type EmitidaLeida = {
  entryId: string
  numero: string
  fechaFactura: string
  nombre: string
  cliente: string
  ingresos: { cuenta: string; importe: number }[]
  iva: { pct: number; base: number; cuota: number }[]
  total: number
  tienePdf: boolean
}

/** Las contrapartidas de ingreso de la configuración: subcuenta e importe, de la 1 a la 4. */
const CONTRAPARTIDAS = [['041', '043'], ['092', '094'], ['095', '097'], ['098', '100']] as const
const RETENCION = ['034', '035', '036', '037', '038']

const NO_VA_EMITIDA: Record<Exclude<OperacionEmitida, 'interior'>, string> = {
  intra: 'Es una entrega a otro país de la UE, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.',
  isp: 'Es una venta con inversión del sujeto pasivo, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.',
  exenta: 'Es una venta exenta de IVA, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.',
  no_sujeta: 'Es una venta no sujeta a IVA, y ERP10 no la admite al importar con esta configuración. Métela a mano en ERP10.',
}

/** Cuántas contrapartidas de ingreso tiene puestas la configuración (las que tienen subcuenta e importe). */
export function contrapartidasDelXml(xml = XML_EXPEDIDAS): number {
  const col = columnas(xml)
  return CONTRAPARTIDAS.filter(([cta, imp]) => cta in col && imp in col).length
}

/** Cuántos tipos de IVA tiene puestos la configuración (base, % y cuota). */
export function tiposIvaDelXml(xml = XML_EXPEDIDAS): number {
  const col = columnas(xml)
  let n = 0
  while (n < 4 && [0, 1, 2].every((k) => String(10 + n * 3 + k).padStart(3, '0') in col)) n++
  return n
}

/** Lee el asiento de una emitida. Lo que no puede ir en el fichero de ERP10 devuelve su porqué. */
export function leerEmitida(r: EmitidaParaErp10, xml = XML_EXPEDIDAS): EmitidaLeida | NoSale {
  const numero = String(r.factura.numero ?? '').trim()
  const no = (porque: string): NoSale => ({ entryId: r.entryId, numero, porque })
  const col = columnas(xml)
  if (!numero) return no('No tiene número de factura.')
  if (r.rectificativa || /^R/.test(r.tipoFactura ?? '')) return no('Es una rectificativa, y ERP10 no la admite al importar. Métela a mano en ERP10.')
  if (r.tipoFactura === 'F4') return no('Es un resumen de varias facturas, y ERP10 no lo admite al importar con esta configuración. Métela a mano en ERP10.')
  if (r.operacion !== 'interior') return no(NO_VA_EMITIDA[r.operacion])
  if (Number(r.recargo) !== 0) return no('Lleva recargo de equivalencia, y ERP10 no lo admite al importar. Métela a mano en ERP10.')

  const ingresos = new Map<string, number>()
  const iva = new Map<number, { base: number; cuota: number }>()
  const cli = new Map<string, number>()
  let retenida = c(r.retencion ?? 0)
  for (const l of r.lineas) {
    const neto = c(l.haber) - c(l.debe)
    if (/^7/.test(l.cuenta)) {
      ingresos.set(l.cuenta, (ingresos.get(l.cuenta) ?? 0) + neto)
    } else if (/^477/.test(l.cuenta)) {
      if (l.tipoIva == null || l.baseIva == null) return no(`La línea de IVA de la cuenta ${l.cuenta} no tiene su tipo y su base.`)
      const pct = Number(l.tipoIva)
      const x = iva.get(pct) ?? { base: 0, cuota: 0 }
      x.base += c(Math.abs(Number(l.baseIva))) * (neto < 0 ? -1 : 1); x.cuota += neto
      iva.set(pct, x)
    } else if (/^4[34]/.test(l.cuenta)) {
      cli.set(l.cuenta, (cli.get(l.cuenta) ?? 0) - neto)
    } else if (/^473/.test(l.cuenta)) {
      retenida += -neto
    } else {
      return no(`Lleva la cuenta ${l.cuenta}, que no es de ingreso, IVA, cliente ni retención. Métela a mano en ERP10.`)
    }
  }
  if (retenida !== 0 && !RETENCION.every((k) => k in col)) {
    return no('Lleva retención, y ERP10 no la admite al importar en las emitidas con esta configuración. Métela a mano en ERP10.')
  }

  const vivos = [...ingresos].filter(([, v]) => v !== 0)
  const maxIngresos = contrapartidasDelXml(xml)
  const maxIva = tiposIvaDelXml(xml)
  if (vivos.length === 0) return no('No lleva ninguna cuenta de ingreso.')
  if (vivos.length > maxIngresos) return no(`Esta factura reparte el ingreso en ${vivos.length} cuentas y ERP10 admite ${maxIngresos} al importar. Métela a mano en ERP10.`)
  if (iva.size === 0) return no('No lleva IVA, y ERP10 necesita saber por qué al importar. Métela a mano en ERP10.')
  if (iva.size > maxIva) return no(`Esta factura lleva ${iva.size} tipos de IVA y ERP10 admite ${maxIva} al importar. Métela a mano en ERP10.`)
  if (cli.size !== 1) return no(cli.size === 0 ? 'No lleva la cuenta del cliente.' : `Va a ${cli.size} cuentas de cliente y tiene que ir a una.`)
  const [cliente, total] = [...cli][0]
  if (total <= 0) return no('El total de la factura no es positivo.')
  const ivas = [...iva].sort(([a], [b]) => a - b).map(([pct, x]) => ({ pct, base: x.base, cuota: x.cuota }))
  for (const x of ivas) if (!Number.isInteger(x.pct)) return no(`Lleva un IVA del ${x.pct} %, que no es un tipo entero.`)

  const leida: EmitidaLeida = {
    entryId: r.entryId, numero, fechaFactura: r.factura.fecha, nombre: r.cliente.nombre, cliente,
    ingresos: vivos.map(([cuenta, importe]) => ({ cuenta, importe })), iva: ivas, total, tienePdf: r.tienePdf,
  }
  const mal = cuadreEmitida(leida)
  return mal ? no(`${mal} No sale.`) : leida
}

/** La regla de cuadre de una emitida: los ingresos suman las bases, y el total es bases más cuotas. Nulo si cuadra. */
export function cuadreEmitida(x: Pick<EmitidaLeida, 'ingresos' | 'iva' | 'total'>): string | null {
  const bases = x.iva.reduce((t, i) => t + i.base, 0)
  const cuotas = x.iva.reduce((t, i) => t + i.cuota, 0)
  if (x.ingresos.reduce((t, g) => t + g.importe, 0) !== bases) return 'Las cuentas de ingreso no suman las bases del IVA.'
  if (bases + cuotas !== x.total) return 'El total no es bases más cuotas.'
  return null
}

/** La fila del fichero de expedidas: cada dato en la columna que dice la configuración de ERP10. */
export function filaExpedida(x: EmitidaLeida, cuentas: ReadonlyMap<string, string>, ruta: string, xml = XML_EXPEDIDAS): Fila {
  const cta = (k: string) => cuentas.get(k) ?? k
  // Las tres fechas (factura, contable y fiscal) van en la misma columna: la de la factura.
  const v: Record<string, Celda> = {
    '002': fechaCelda(x.fechaFactura), '001': fechaCelda(x.fechaFactura), '118': fechaCelda(x.fechaFactura),
    '004': cta(x.cliente), '006': x.numero, '045': e(x.total), '057': ruta,
  }
  x.ingresos.forEach((g, k) => { const [s, i] = CONTRAPARTIDAS[k]; v[s] = cta(g.cuenta); v[i] = e(g.importe) })
  // IVA 1 a 4: base, % y cuota (010-012, 013-015, 016-018, 019-021).
  x.iva.forEach((i, k) => {
    const b = 10 + k * 3
    v[String(b).padStart(3, '0')] = e(i.base); v[String(b + 1).padStart(3, '0')] = i.pct; v[String(b + 2).padStart(3, '0')] = e(i.cuota)
  })
  return colocar(v, columnas(xml)) as Fila
}

/**
 * X10c · La emitida para sacarla a ERP10 por la conexión: lo mismo que va a su fila de
 * expedidas (la leída, en céntimos), con las cuentas YA en ERP10, el NIF del cliente y la
 * fecha del asiento. La factura la arma el servidor (_shared/erp10Escribir.ts).
 */
export type EmitidaParaApi = {
  entryId: string; numero: string; fechaFactura: string; fechaAsiento: string; nif: string; nombre: string
  /** La cuenta del cliente, en ERP10. */
  cliente: string
  ingresos: { cuenta: string; importe: number }[]
  iva: { pct: number; base: number; cuota: number }[]
  total: number
}
export function emitidaParaApi(x: EmitidaLeida, r: Pick<EmitidaParaErp10, 'fecha' | 'cliente'>, erp: ReadonlyMap<string, string>): EmitidaParaApi {
  const a = (k: string) => erp.get(k) ?? k
  return {
    entryId: x.entryId, numero: x.numero, fechaFactura: x.fechaFactura, fechaAsiento: r.fecha, nif: r.cliente.nif ?? '', nombre: x.nombre,
    cliente: a(x.cliente), ingresos: x.ingresos.map((g) => ({ cuenta: a(g.cuenta), importe: g.importe })), iva: x.iva, total: x.total,
  }
}

export type SalidaExpedidas = {
  /** `api`: X10c, la emitida para la conexión con ERP10. */
  filas: { entryId: string; numero: string; fila: Fila; pdf: string | null; usa: string[]; api: EmitidaParaApi }[]
  noSalen: NoSale[]
  /** Las cuentas de Sumied que usan las filas que salen (para el fichero de subcuentas). */
  cuentas: Set<string>
}

/**
 * Las emitidas de una salida: las que van al fichero, con su fila y el nombre de
 * su PDF, y las que no, con su porqué. Como las recibidas.
 */
export function prepararExpedidas(lista: readonly EmitidaParaErp10[], o: {
  plan: Plan; largo: number; carpetaPdf: string; yaSalidas?: ReadonlyMap<string, string>; xml?: string; usados?: Set<string>
}): SalidaExpedidas {
  const xml = o.xml ?? XML_EXPEDIDAS
  const noSalen: NoSale[] = []
  const leidas: EmitidaLeida[] = []
  for (const r of lista) {
    const x = leerEmitida(r, xml)
    if ('porque' in x) noSalen.push(x); else leidas.push(x)
  }
  const usadasPor = (x: EmitidaLeida) => [x.cliente, ...x.ingresos.map((g) => g.cuenta)]
  const delAsiento = new Map(lista.map((r) => [r.entryId, r]))
  const { erp, noCaben } = convertirCuentas(leidas.flatMap(usadasPor), o.plan, o.largo, o.yaSalidas)
  const filas: SalidaExpedidas['filas'] = []
  const cuentas = new Set<string>()
  const usados = o.usados ?? new Set<string>()
  for (const x of leidas) {
    const malas = usadasPor(x).filter((k) => noCaben.has(k))
    if (malas.length) { noSalen.push({ entryId: x.entryId, numero: x.numero, porque: noCaben.get(malas[0])! }); continue }
    const pdf = x.tienePdf ? nombrePdf({ fechaFactura: x.fechaFactura, proveedor: x.nombre, numero: x.numero }, usados) : null
    filas.push({ entryId: x.entryId, numero: x.numero, fila: filaExpedida(x, erp, pdf ? rutaPdf(o.carpetaPdf, pdf) : '', xml), pdf, usa: usadasPor(x), api: emitidaParaApi(x, delAsiento.get(x.entryId)!, erp) })
    for (const k of usadasPor(x)) cuentas.add(k)
  }
  return { filas, noSalen, cuentas }
}

// ── Los asientos (X07) ──────────────────────────────────────────────────────────────
//
// La forma medida (erp10_formatos_de_salida.md, sección 15: los asientos que entraron en
// ERP10 en el traspaso de octubre): una fila por apunte, sin títulos; cada fila lleva un
// solo lado relleno, el debe (C subcuenta, D denominación, E concepto, F importe) o el
// haber (G, H, I, J); las filas de un mismo asiento llevan el mismo número en A (1, 1,
// 2, 2…, desde 1 en cada fichero); B, la fecha, repetida; L, la serie, como número;
// subcuentas como texto de 8 cifras e importes siempre en positivo. Las columnas salen de
// XML_ASIENTOS (su bloque es <Configuracion_Asientos>, que el lector de Diez no busca).
// Lo no visto: un asiento de tres apuntes o más (en octubre todos eran de dos). Por la
// forma, son tantas filas como apuntes con el mismo número en A.

/** Código de la configuración → columna (1 = A), de <Configuracion_Asientos>. */
export function columnasAsientos(xml = XML_ASIENTOS): Record<string, number> {
  const bloque = xml.match(/<Configuracion_Asientos>([\s\S]*?)<\/Configuracion_Asientos>/)?.[1]
  if (!bloque) throw new Error('La configuración de asientos no trae <Configuracion_Asientos>.')
  const m: Record<string, number> = {}
  for (const [, cod, col] of bloque.matchAll(/<Campo(\d{3})>(\d+)<\/Campo\1>/g)) m[cod] = Number(col)
  return m
}

/** Un apunte de un asiento (conta_erp10_asientos_por_salir). */
export type LineaAsiento = { cuenta: string; nombre: string; concepto: string | null; debe: number; haber: number }
export type AsientoParaErp10 = {
  entryId: string
  serie: number
  numero: number | null
  /** AAAA-MM-DD. */
  fecha: string
  concepto: string
  lineas: LineaAsiento[]
}

/** Lo que se ha leído de un asiento, en céntimos, con sus apuntes vivos. */
export type AsientoLeido = { entryId: string; fecha: string; serie: number; numero: number | null; apuntes: { cuenta: string; nombre: string; concepto: string; debe: number; haber: number }[] }

/** Lee un asiento. Lo que no puede ir en el fichero de ERP10 devuelve su porqué. */
export function leerAsiento(a: AsientoParaErp10): AsientoLeido | NoSale {
  const numero = `${a.serie}/${a.numero ?? ''}`
  const no = (porque: string): NoSale => ({ entryId: a.entryId, numero, porque })
  const apuntes = a.lineas
    .map((l) => ({ cuenta: l.cuenta, nombre: (l.nombre || l.cuenta).trim(), concepto: (l.concepto || a.concepto || '').trim(), debe: c(l.debe), haber: c(l.haber) }))
    .filter((l) => l.debe !== 0 || l.haber !== 0)
  if (apuntes.length < 2) return no('No tiene dos apuntes con importe. Míralo en Sumied.')
  if (apuntes.some((l) => l.debe < 0 || l.haber < 0)) return no('Lleva un importe en negativo, y ERP10 los quiere en positivo. Métela a mano en ERP10.')
  const d = apuntes.reduce((t, l) => t + l.debe, 0), h = apuntes.reduce((t, l) => t + l.haber, 0)
  if (d !== h) return no(`No cuadra: ${e(d)} al debe y ${e(h)} al haber.`)
  return { entryId: a.entryId, fecha: a.fecha, serie: a.serie, numero: a.numero, apuntes }
}

/**
 * Las filas de un asiento: una por apunte, con el número `n` en A. Un apunte con debe
 * y haber a la vez (no debería) va en dos filas, cada una con su lado.
 */
export function filasAsiento(x: AsientoLeido, n: number, cuentas: ReadonlyMap<string, string>, serieErp10 = 1, xml = XML_ASIENTOS): Fila[] {
  const col = columnasAsientos(xml)
  const ancho = Math.max(...Object.values(col))
  const fila = (v: Record<string, Celda>) => {
    const f: Fila = Array(ancho).fill('')
    for (const [cod, val] of Object.entries(v)) {
      if (val === '' || val === null || val === undefined) continue
      if (!(cod in col)) throw new Error(`La configuración de asientos no tiene columna para el campo ${cod}.`)
      f[col[cod] - 1] = val as string | number
    }
    return f
  }
  const cta = (k: string) => cuentas.get(k) ?? k
  const comun = { '001': n, '002': fechaCelda(x.fecha), '003': serieErp10 }
  const filas: Fila[] = []
  for (const l of x.apuntes) {
    if (l.debe) filas.push(fila({ ...comun, '005': cta(l.cuenta), '006': l.nombre, '007': l.concepto, '008': e(l.debe) }))
    if (l.haber) filas.push(fila({ ...comun, '010': cta(l.cuenta), '011': l.nombre, '012': l.concepto, '013': e(l.haber) }))
  }
  return filas
}

export type SalidaAsientos = {
  /** En el orden del fichero: por fecha y, dentro de la fecha, por serie y número de Sumied. */
  asientos: { entryId: string; numero: string; filas: Fila[]; usa: string[] }[]
  noSalen: NoSale[]
  cuentas: Set<string>
}

/**
 * Los asientos de una salida: los que van al fichero (numerados desde 1, en orden) y
 * los que no, con su porqué. `noCaben`: cuentas que ya se sabe que no pueden salir
 * (por ejemplo, porque chocan con una de las facturas), además de las que no caben.
 */
export function prepararAsientos(lista: readonly AsientoParaErp10[], o: {
  plan: Plan; largo: number; yaSalidas?: ReadonlyMap<string, string>; serie?: number; xml?: string; noCaben?: ReadonlyMap<string, string>
}): SalidaAsientos {
  const noSalen: NoSale[] = []
  const leidos: AsientoLeido[] = []
  const orden = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.serie - b.serie || (a.numero ?? 0) - (b.numero ?? 0) || a.entryId.localeCompare(b.entryId))
  for (const a of orden) {
    const x = leerAsiento(a)
    if ('porque' in x) noSalen.push(x); else leidos.push(x)
  }
  const usadasPor = (x: AsientoLeido) => [...new Set(x.apuntes.map((l) => l.cuenta))]
  const conv = convertirCuentas(leidos.flatMap(usadasPor), o.plan, o.largo, o.yaSalidas)
  const asientos: SalidaAsientos['asientos'] = []
  const cuentas = new Set<string>()
  for (const x of leidos) {
    const usa = usadasPor(x)
    const mala = usa.find((k) => conv.noCaben.has(k) || o.noCaben?.has(k))
    if (mala) { noSalen.push({ entryId: x.entryId, numero: `${x.serie}/${x.numero ?? ''}`, porque: (conv.noCaben.get(mala) ?? o.noCaben!.get(mala))! }); continue }
    asientos.push({ entryId: x.entryId, numero: `${x.serie}/${x.numero ?? ''}`, filas: filasAsiento(x, asientos.length + 1, conv.erp, o.serie ?? 1, o.xml ?? XML_ASIENTOS), usa })
    for (const k of usa) cuentas.add(k)
  }
  return { asientos, noSalen, cuentas }
}

// ── Los días del TPV (X08) ──────────────────────────────────────────────────────────
//
// La decisión de Julio (respuestas X08 · 3 y X08 · 4, 19/11): un día del TPV sale como
// UNA factura expedida por día y local, el asiento resumen del Reglamento del IVA (art.
// 63.4), y su cobro aparte, como un asiento más:
//   · la expedida: el cliente es la cuenta genérica «Clientes de contado» de la sociedad
//     (una 430 que lo dice en su nombre; no se inventa); las bases y cuotas, una línea de
//     I.V.A. por tipo; las ventas, en sus contrapartidas de ingreso; el rango seguido del
//     día en «Resumen de facturas» (N.º facturas, Campo069; Primer número, 070; Último
//     número, 071; medidos por Julio en su ERP10). La I (Nº factura) va vacía: ERP10 no la
//     pide (en «Configurar Excel» solo la fecha y el total llevan asterisco);
//   · el cobro: cada cuenta a la que va lo cobrado (la de cada forma de pago, como la
//     eligió «A qué cuenta va cada forma de pago») al debe, contra «Clientes de contado» al
//     haber por el total, el mismo día.
// Todo sale del asiento validado del día: lo que tiene Sumied en su diario.
//
// No sale (y se dice por qué): sin rango, con dos contadores del TPV (dos rangos), con
// varios asientos el mismo día y local (uno por plataforma), sin «Clientes de contado» o
// con más de una, y lo que no cabe en la configuración.

/** Un apunte del asiento de un día (conta_erp10_dias_tpv_por_salir). */
export type LineaDia = {
  cuenta: string; plantilla: string; nombre: string; debe: number; haber: number
  /** % y base del I.V.A., en las líneas del libro de expedidas. */
  tipoIva: number | null; baseIva: number | null; libro: string | null
}
export type DiaParaErp10 = {
  entryId: string
  serie: number
  numero: number | null
  /** AAAA-MM-DD. */
  fecha: string
  concepto: string
  /** revo: un TPV de fuera (conta_tpv_dia); folvy: el TPV de Folvy (sales_day_summary). */
  origen: 'revo' | 'folvy' | null
  local: string | null
  localId: string | null
  /** El rango seguido de facturas del día y cuántas (nulo si no lo guarda). */
  primero: string | null
  ultimo: string | null
  facturas: number | null
  /** Revo: cuántos contadores (series del TPV) lleva el día. */
  contadores: number | null
  lineas: LineaDia[]
}
export type CuentaContado = { codigo: string; plantilla: string; nombre: string }

/** Lo que se ha leído de un día, en céntimos. */
export type DiaLeido = {
  entryId: string; serie: number; numero: number | null; fecha: string; local: string | null
  primero: string; ultimo: string; facturas: number
  contado: CuentaContado
  ingresos: { cuenta: string; importe: number }[]
  iva: { pct: number; base: number; cuota: number }[]
  /** Lo cobrado a cada cuenta (con su signo: una devolución en caja resta). */
  cobros: { cuenta: string; nombre: string; importe: number }[]
  total: number
}

export const FRASE_SIN_RANGO = 'Falta el rango de facturas del día.'
export const FRASE_SIN_CONTADO = 'Falta la cuenta de Clientes de contado: ponla en A qué cuenta va cada forma de pago.'

/** El rango, como se enseña: «5001–5048». */
export const rangoDe = (d: Pick<DiaParaErp10, 'primero' | 'ultimo'>) => (d.primero && d.ultimo ? (d.primero === d.ultimo ? d.primero : `${d.primero}–${d.ultimo}`) : '')

/** Lee un día del TPV. Lo que no puede ir al fichero devuelve su porqué. */
export function leerDia(d: DiaParaErp10, contado: readonly CuentaContado[], xml = XML_EXPEDIDAS): DiaLeido | NoSale {
  const no = (porque: string): NoSale => ({ entryId: d.entryId, numero: rangoDe(d) || `${d.serie}/${d.numero ?? ''}`, porque })
  const primero = String(d.primero ?? '').trim(), ultimo = String(d.ultimo ?? '').trim()
  if (!primero || !ultimo) return no(FRASE_SIN_RANGO)
  if ((d.contadores ?? 1) > 1) return no(`Lleva facturas de ${d.contadores} contadores del TPV, con un rango cada uno, y la factura del día lleva uno: no se juntan. No sale.`)
  if (contado.length === 0) return no(FRASE_SIN_CONTADO)
  if (contado.length > 1) return no(`Hay ${contado.length} cuentas de Clientes de contado (${contado.map((x) => x.codigo).join(', ')}): deja una. No sale.`)
  const col = columnas(xml)
  if (!['069', '070', '071'].every((k) => k in col)) return no('La configuración de expedidas no tiene el resumen de facturas (N.º facturas, primer y último número). No sale.')

  const ingresos = new Map<string, number>()
  const iva = new Map<number, { base: number; cuota: number }>()
  const cobros = new Map<string, { nombre: string; importe: number }>()
  for (const l of d.lineas) {
    const neto = c(l.haber) - c(l.debe)
    if (neto === 0) continue
    if (/^7/.test(l.cuenta)) {
      ingresos.set(l.cuenta, (ingresos.get(l.cuenta) ?? 0) + neto)
    } else if (/^477/.test(l.cuenta)) {
      if (l.tipoIva == null || l.baseIva == null) return no(`La línea de I.V.A. de la cuenta ${l.cuenta} no tiene su tipo y su base. No sale.`)
      const pct = Number(l.tipoIva)
      const x = iva.get(pct) ?? { base: 0, cuota: 0 }
      x.base += c(Math.abs(Number(l.baseIva))) * (neto < 0 ? -1 : 1); x.cuota += neto
      iva.set(pct, x)
    } else {
      // Lo cobrado: la cuenta de cada forma de pago (caja, banco, la 430 de una plataforma…).
      const x = cobros.get(l.cuenta) ?? { nombre: (l.nombre || l.cuenta).trim(), importe: 0 }
      x.importe -= neto
      cobros.set(l.cuenta, x)
    }
  }
  const vivos = [...ingresos].filter(([, v]) => v !== 0)
  const maxIngresos = contrapartidasDelXml(xml)
  const maxIva = tiposIvaDelXml(xml)
  if (vivos.length === 0) return no('No lleva ninguna cuenta de ventas. No sale.')
  if (vivos.length > maxIngresos) return no(`Reparte las ventas en ${vivos.length} cuentas y ERP10 admite ${maxIngresos} al importar. No sale.`)
  if (iva.size === 0) return no('No lleva I.V.A. No sale.')
  if (iva.size > maxIva) return no(`Lleva ${iva.size} tipos de I.V.A. y ERP10 admite ${maxIva} al importar. No sale.`)
  const ivas = [...iva].sort(([a], [b]) => a - b).map(([pct, x]) => ({ pct, base: x.base, cuota: x.cuota }))
  for (const x of ivas) if (!Number.isInteger(x.pct)) return no(`Lleva un I.V.A. del ${x.pct} %, que no es un tipo entero. No sale.`)
  const cobrado = [...cobros].filter(([, x]) => x.importe !== 0).map(([cuenta, x]) => ({ cuenta, nombre: x.nombre, importe: x.importe }))
  if (cobrado.some((x) => x.cuenta === contado[0].codigo)) return no(`Cobra en la propia cuenta de Clientes de contado (${contado[0].codigo}). No sale.`)
  const total = cobrado.reduce((t, x) => t + x.importe, 0)
  if (total <= 0) return no('Lo cobrado el día no es positivo. No sale.')
  const leido: DiaLeido = {
    entryId: d.entryId, serie: d.serie, numero: d.numero, fecha: d.fecha, local: d.local, primero, ultimo,
    facturas: Number(d.facturas ?? 0), contado: contado[0], ingresos: vivos.map(([cuenta, importe]) => ({ cuenta, importe })), iva: ivas, cobros: cobrado, total,
  }
  if (!Number.isInteger(leido.facturas) || leido.facturas <= 0) return no('No dice cuántas facturas lleva el día. No sale.')
  const mal = cuadreEmitida(leido)
  return mal ? no(`${mal} No sale.`) : leido
}

/** La fila del día en el fichero de expedidas: como una emitida, con el resumen de facturas y sin número ni PDF. */
export function filaDia(x: DiaLeido, cuentas: ReadonlyMap<string, string>, xml = XML_EXPEDIDAS): Fila {
  const cta = (k: string) => cuentas.get(k) ?? k
  const v: Record<string, Celda> = {
    '002': fechaCelda(x.fecha), '001': fechaCelda(x.fecha), '118': fechaCelda(x.fecha),
    '004': cta(x.contado.codigo), '045': e(x.total),
    '069': x.facturas, '070': x.primero, '071': x.ultimo,
  }
  x.ingresos.forEach((g, k) => { const [s, i] = CONTRAPARTIDAS[k]; v[s] = cta(g.cuenta); v[i] = e(g.importe) })
  x.iva.forEach((i, k) => {
    const b = 10 + k * 3
    v[String(b).padStart(3, '0')] = e(i.base); v[String(b + 1).padStart(3, '0')] = i.pct; v[String(b + 2).padStart(3, '0')] = e(i.cuota)
  })
  return colocar(v, columnas(xml)) as Fila
}

/** El asiento del cobro del día: lo cobrado a cada cuenta, contra «Clientes de contado». Va con los asientos. */
export function cobroDia(x: DiaLeido): AsientoParaErp10 {
  const dma = `${x.fecha.slice(8, 10)}/${x.fecha.slice(5, 7)}/${x.fecha.slice(0, 4)}`
  const concepto = `Cobro de las ventas del ${dma}${x.local ? ` · ${x.local}` : ''}`
  return {
    entryId: x.entryId, serie: x.serie, numero: x.numero, fecha: x.fecha, concepto,
    lineas: [
      ...x.cobros.map((k) => ({ cuenta: k.cuenta, nombre: k.nombre, concepto, debe: k.importe > 0 ? e(k.importe) : 0, haber: k.importe < 0 ? e(-k.importe) : 0 })),
      { cuenta: x.contado.codigo, nombre: x.contado.nombre, concepto, debe: 0, haber: e(x.total) },
    ],
  }
}

export type SalidaDias = {
  /** En orden de fecha. Cada día, su fila de expedidas y su asiento de cobro. */
  dias: { entryId: string; numero: string; fecha: string; local: string | null; facturas: number; total: number; fila: Fila; cobro: AsientoParaErp10; usa: string[] }[]
  noSalen: NoSale[]
}

/**
 * Los días del TPV de una salida: los que van al fichero de expedidas (con su cobro, que
 * va al de asientos) y los que no, con su porqué. Un mismo día y local en varios asientos
 * (uno por plataforma) no sale: la factura del día es una por día y local.
 */
export function prepararDiasTpv(lista: readonly DiaParaErp10[], contado: readonly CuentaContado[], o: {
  plan: Plan; largo: number; yaSalidas?: ReadonlyMap<string, string>; xml?: string; noCaben?: ReadonlyMap<string, string>
}): SalidaDias {
  const xml = o.xml ?? XML_EXPEDIDAS
  const noSalen: NoSale[] = []
  const leidos: DiaLeido[] = []
  const clave = (d: DiaParaErp10) => `${d.fecha}|${d.origen ?? ''}|${d.localId ?? d.local ?? ''}`
  const veces = new Map<string, number>()
  for (const d of lista) veces.set(clave(d), (veces.get(clave(d)) ?? 0) + 1)
  const orden = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.serie - b.serie || (a.numero ?? 0) - (b.numero ?? 0) || a.entryId.localeCompare(b.entryId))
  for (const d of orden) {
    const n = veces.get(clave(d))!
    if (n > 1) { noSalen.push({ entryId: d.entryId, numero: rangoDe(d) || `${d.serie}/${d.numero ?? ''}`, porque: `Ese día y ese local van en ${n} asientos (uno por plataforma), y la factura del día es una por día y local. No sale.` }); continue }
    const x = leerDia(d, contado, xml)
    if ('porque' in x) noSalen.push(x); else leidos.push(x)
  }
  const usadasPor = (x: DiaLeido) => [...new Set([x.contado.codigo, ...x.ingresos.map((g) => g.cuenta), ...x.cobros.map((k) => k.cuenta)])]
  const conv = convertirCuentas(leidos.flatMap(usadasPor), o.plan, o.largo, o.yaSalidas)
  const dias: SalidaDias['dias'] = []
  for (const x of leidos) {
    const usa = usadasPor(x)
    const mala = usa.find((k) => conv.noCaben.has(k) || o.noCaben?.has(k))
    const numero = rangoDe(x)
    if (mala) { noSalen.push({ entryId: x.entryId, numero, porque: (conv.noCaben.get(mala) ?? o.noCaben!.get(mala))! }); continue }
    dias.push({ entryId: x.entryId, numero, fecha: x.fecha, local: x.local, facturas: x.facturas, total: e(x.total), fila: filaDia(x, conv.erp, xml), cobro: cobroDia(x), usa })
  }
  return { dias, noSalen }
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

export const FICHERO_SUBCUENTAS = 'subcuentas.xlsx'
export const FICHERO_RECIBIDAS = 'recibidas.xlsx'
export const FICHERO_EXPEDIDAS = 'expedidas.xlsx'
export const FICHERO_ASIENTOS = 'asientos.xlsx'
/** X08 · Los días del TPV: facturas expedidas (el resumen del día), en su fichero para importarlas aparte. */
export const FICHERO_DIAS = 'dias-tpv.xlsx'
