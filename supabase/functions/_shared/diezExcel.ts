// supabase/functions/_shared/diezExcel.ts
//
// B01r·26 (13/11) · LOS DOS EXCEL DEL TRASPASO DEL MES A DIEZ: de cada factura
// de Sumied, su fila del Excel de emitidas o de recibidas, con «Url documento»
// (el enlace de conta-pdf). Lo decidido por Julio el 24/10 y el 13/11
// (docs/conta/diez/traspaso_con_pdf.md). Puro: sin red ni base; lo usan
// conta-diez-traspaso y la pantalla, y lo prueba tests/unit/conta/diezExcel.test.ts.
//
//   · Cada dato va a la columna que dice el XML de la configuración de Julio
//     (columnas(xml)), no puesta a mano: el XML es la única fuente. Si un dato
//     no tiene columna en el XML, la fila no se hace y se dice cuál.
//   · Sin fila de títulos: Diez la lee como una factura más (C0009, 24/10).
//   · Emitidas: las ventas por marca (70000001…70000099) van SUMADAS en una
//     línea a la 70000000; envíos (705) y promociones (70009) en la suya. Como
//     mucho 3 líneas (Julio, 13/11). Una analítica por factura: local (Grupo) y
//     plataforma (Nivel3); la marca no va.
//   · Recibidas: hasta 2 gastos y 2 tipos de IVA (la configuración del 24/10);
//     las de 3 tipos de IVA van por la API (Julio, 13/11). La retención, con su
//     tipo de Diez y la subcuenta que Sumied tiene enlazada a ese tipo.
//   · Lo que no cabe NO se fuerza: devuelve { porLaApi: motivo } y la pantalla
//     lo dice. Nada a medias.

export type Celda = string | number | Date
export type Fila = Celda[]
export type NoCabe = { porLaApi: string }

/** Código de la configuración de Diez → columna (1 = A), leído del bloque <Configuracion> del XML. */
export function columnas(xml: string): Record<string, number> {
  const bloque = xml.match(/<Configuracion>([\s\S]*?)<\/Configuracion>/)?.[1]
  if (!bloque) throw new Error('El XML de la configuración no trae <Configuracion>.')
  const m: Record<string, number> = {}
  for (const [, cod, col] of bloque.matchAll(/<Campo(\d{3})>(\d+)<\/Campo\1>/g)) m[cod] = Number(col)
  return m
}

/** Los valores de tipo de retención que conoce la configuración (Configuracion2 › Campo034 › ValorNN). */
export function tiposRetencionDelXml(xml: string): string[] {
  const b = xml.match(/<Configuracion2>[\s\S]*?<Campo034>([\s\S]*?)<\/Campo034>/)?.[1] ?? ''
  return [...b.matchAll(/<Valor\d+>([^<]+)<\/Valor\d+>/g)].map((m) => m[1])
}

/** Qué es cada código, con lo que pone Julio en su pantalla (para decir qué falta). */
export const CAMPOS: Record<string, string> = {
  '001': 'Fecha (contable)', '002': 'Fecha factura', '003': 'N.I.F.', '004': 'Subcuenta cliente o proveedor',
  '005': 'Nombre', '006': 'Nº factura', '007': 'Concepto asiento', '010': 'Base IVA 1', '011': '% IVA 1',
  '012': 'Cuota IVA 1', '013': 'Base IVA 2', '014': '% IVA 2', '015': 'Cuota IVA 2', '034': 'Tipo retención',
  '035': 'Base retención', '036': '% retención', '037': 'Cuota retención', '038': 'Subcuenta retención',
  '041': 'Subcuenta ingresos o gasto 1', '043': 'Importe ingresos o gasto 1', '045': 'Total factura',
  '056': 'Url documento', '057': 'Ruta documento', '092': 'Subcuenta ingresos o gasto 2',
  '094': 'Importe ingresos o gasto 2', '118': 'Fecha fiscal',
  '095': 'Subcuenta ingresos 3', '097': 'Importe ingresos 3', '059': 'Analítica · local', '061': 'Analítica · plataforma',
}

const mismo = (a: Celda, b: Celda) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)

/** Coloca código → valor en una fila, por las columnas. Para si un código no tiene columna o si dos chocan. */
export function colocar(v: Record<string, Celda>, col: Record<string, number>): Fila {
  const ancho = Math.max(...Object.values(col))
  const fila: Fila = Array(ancho).fill('')
  const quien: (string | null)[] = Array(ancho).fill(null)
  for (const [cod, x] of Object.entries(v)) {
    if (x === '' || x === undefined || x === null) continue
    if (!(cod in col)) throw new Error(`«${CAMPOS[cod] ?? cod}» no tiene columna en la configuración de Diez.`)
    const i = col[cod] - 1
    if (quien[i] !== null && !mismo(fila[i], x)) throw new Error(`La columna ${i + 1} es a la vez «${CAMPOS[quien[i]!] ?? quien[i]}» y «${CAMPOS[cod] ?? cod}».`)
    fila[i] = x
    quien[i] = cod
  }
  return fila
}

const c = (x: number) => Math.round(x * 100)
const e = (x: number) => x / 100
/** AAAA-MM-DD → la fecha (a mediodía UTC: Excel la enseña igual en cualquier huso). */
export const fecha = (aaaammdd: string) => new Date(`${aaaammdd}T12:00:00Z`)

// ── Emitidas ──────────────────────────────────────────────────────────────────

/** La cuenta a la que van sumadas las ventas por marca (la de Diez hasta septiembre). */
export const VENTAS = '70000000'
const ES_VENTA_MARCA = /^700000\d{2}$/
const ES_ENVIO = /^705\d{5}$/
const ES_PROMO = /^70009\d{3}$/

/**
 * Las líneas de ingresos de una factura de ventas, como van al Excel: ventas
 * por marca sumadas a la 70000000, luego envíos y luego promociones. Las de 0
 * no van. Más de 3, o una cuenta que no es de esas, no cabe.
 */
export function ingresosAgrupados(apuntes: readonly { cuenta: string; importe: number }[]): { cuenta: string; importe: number }[] | NoCabe {
  let ventas = 0; const envios = new Map<string, number>(); const promos = new Map<string, number>()
  for (const a of apuntes) {
    if (ES_VENTA_MARCA.test(a.cuenta)) ventas += c(a.importe)
    else if (ES_ENVIO.test(a.cuenta)) envios.set(a.cuenta, (envios.get(a.cuenta) ?? 0) + c(a.importe))
    else if (ES_PROMO.test(a.cuenta)) promos.set(a.cuenta, (promos.get(a.cuenta) ?? 0) + c(a.importe))
    else return { porLaApi: `lleva la cuenta ${a.cuenta}, que no es de ventas, envíos ni promociones` }
  }
  const out = [
    ...(ventas !== 0 ? [{ cuenta: VENTAS, importe: e(ventas) }] : []),
    ...[...envios].filter(([, v]) => v !== 0).map(([cuenta, v]) => ({ cuenta, importe: e(v) })),
    ...[...promos].filter(([, v]) => v !== 0).map(([cuenta, v]) => ({ cuenta, importe: e(v) })),
  ]
  if (out.length === 0) return { porLaApi: 'no lleva ingresos' }
  if (out.length > 3) return { porLaApi: `lleva ${out.length} líneas de ingresos y el Excel admite 3` }
  return out
}

/** Una factura de ventas de Sumied, como la cuenta su asiento (lo de facturaDeVentas / resumenDeAsiento). */
export type Emitida = {
  numero: string
  /** AAAA-MM-DD */
  fecha: string
  concepto: string
  cliente: { subcuenta: string; nombre: string }
  ingresos: { cuenta: string; importe: number }[]
  iva: { base: number; pct: number; cuota: number }[]
  total: number
  url: string
  /** Analítica: el código del local (Grupo) y el de la plataforma (Nivel3). Sin local: sin Grupo. */
  grupo: string | null
  nivel3: string | null
}

/** La fila del Excel de emitidas de una factura, o por qué va por la API. */
export function filaEmitida(f: Emitida, xml: string): Fila | NoCabe {
  if (!/^https:\/\//.test(f.url)) return { porLaApi: 'sin el enlace de su PDF' }
  if (f.iva.length === 0 || f.iva.length > 2) return { porLaApi: `lleva ${f.iva.length} tipos de IVA y el Excel admite 1 o 2` }
  const ing = ingresosAgrupados(f.ingresos)
  if ('porLaApi' in ing) return ing
  const sumaIng = ing.reduce((t, l) => t + c(l.importe), 0)
  const bases = f.iva.reduce((t, i) => t + c(i.base), 0)
  if (sumaIng !== bases) return { porLaApi: `los ingresos (${e(sumaIng)}) no suman las bases (${e(bases)})` }
  if (bases + f.iva.reduce((t, i) => t + c(i.cuota), 0) !== c(f.total)) return { porLaApi: 'bases más cuotas no dan el total' }
  const d = fecha(f.fecha)
  // Julio, 13/11: la línea 3 de ingresos en Campo095/097 (Y, Z) y la analítica en Campo059 (local, AA) y Campo061 (plataforma, AB).
  return colocar({
    '004': f.cliente.subcuenta, '007': f.concepto, '005': f.cliente.nombre, '006': f.numero,
    '041': ing[0].cuenta, '043': ing[0].importe, '092': ing[1]?.cuenta ?? '', '094': ing[1]?.importe ?? '',
    '056': f.url, '010': f.iva[0].base, '011': f.iva[0].pct, '012': f.iva[0].cuota, '045': f.total,
    '001': d, '002': d, '118': d,
    '013': f.iva[1]?.base ?? '', '014': f.iva[1]?.pct ?? '', '015': f.iva[1]?.cuota ?? '',
    '095': ing[2]?.cuenta ?? '', '097': ing[2]?.importe ?? '',
    '059': f.grupo ?? '', '061': f.nivel3 ?? '',
  }, columnas(xml))
}

// ── Recibidas ─────────────────────────────────────────────────────────────────

/**
 * Las fechas de una recibida (Julio, 13/11, configuración de la C0009): la de la
 * factura en la B (Campo002); la contable y la fiscal en la Y (Campo001 y
 * Campo118), y son la del ASIENTO de Sumied, para que Diez la apunte en el mismo
 * mes (en noviembre, 38 de 62 recibidas son de una factura de otro mes).
 */
/** Una factura recibida de Sumied, como la cuenta su asiento. */
export type Recibida = {
  numero: string
  /** AAAA-MM-DD: la de la factura y la del asiento de Sumied. */
  fechaFactura: string
  fechaOperacion: string
  concepto: string
  proveedor: { subcuenta: string; nombre: string; nif: string | null }
  gastos: { cuenta: string; importe: number }[]
  /** Por tipo de IVA. Exenta: ninguno (va con base al 0 %). */
  iva: { base: number; pct: number; cuota: number }[]
  retencion: { tipoDiez: string; subcuenta: string; base: number; pct: number; cuota: number } | null
  total: number
  url: string
}

/** La fila del Excel de recibidas de una factura, o por qué va por la API. */
export function filaRecibida(f: Recibida, xml: string): Fila | NoCabe {
  if (!/^https:\/\//.test(f.url)) return { porLaApi: 'sin el enlace de su PDF' }
  if (f.iva.length > 2) return { porLaApi: `lleva ${f.iva.length} tipos de IVA y el Excel admite 2 (Julio, 13/11: estas, por la API)` }
  const gastos = f.gastos.filter((g) => c(g.importe) !== 0)
  if (gastos.length === 0) return { porLaApi: 'no lleva gasto' }
  if (gastos.length > 2) return { porLaApi: `lleva ${gastos.length} cuentas de gasto y el Excel admite 2` }
  if (!f.proveedor.nif) return { porLaApi: 'el proveedor no tiene NIF' }
  // Exenta: una línea de IVA al 0 %, con la base de los gastos (lo que hay que probar en la C0009).
  const iva = f.iva.length ? f.iva : [{ base: e(gastos.reduce((t, g) => t + c(g.importe), 0)), pct: 0, cuota: 0 }]
  const ret = f.retencion
  if (ret) {
    if (!ret.subcuenta) return { porLaApi: 'la retención no tiene subcuenta en Sumied: Diez dejaría la línea sin cuenta' }
    if (!tiposRetencionDelXml(xml).includes(ret.tipoDiez)) return { porLaApi: `la configuración de recibidas no conoce el tipo de retención «${ret.tipoDiez}»` }
  }
  const sumaGastos = gastos.reduce((t, g) => t + c(g.importe), 0)
  const bases = iva.reduce((t, i) => t + c(i.base), 0)
  if (sumaGastos !== bases) return { porLaApi: `los gastos (${e(sumaGastos)}) no suman las bases (${e(bases)})` }
  // Diez: al debe gastos y cuotas; al haber el proveedor por el total y la retención por su cuota.
  if (bases + iva.reduce((t, i) => t + c(i.cuota), 0) !== c(f.total) + (ret ? c(ret.cuota) : 0)) return { porLaApi: 'el asiento no cuadraría en Diez (gastos + IVA ≠ total + retención)' }
  return colocar({
    '006': f.numero, '002': fecha(f.fechaFactura), '001': fecha(f.fechaOperacion), '118': fecha(f.fechaOperacion), '003': f.proveedor.nif, '005': f.proveedor.nombre,
    '004': f.proveedor.subcuenta, '007': f.concepto, '045': f.total, '056': f.url,
    '041': gastos[0].cuenta, '043': gastos[0].importe, '092': gastos[1]?.cuenta ?? '', '094': gastos[1]?.importe ?? '',
    '010': iva[0].base, '011': iva[0].pct, '012': iva[0].cuota,
    '013': iva[1]?.base ?? '', '014': iva[1]?.pct ?? '', '015': iva[1]?.cuota ?? '',
    '035': ret?.base ?? '', '036': ret?.pct ?? '', '037': ret?.cuota ?? '', '034': ret?.tipoDiez ?? '', '038': ret?.subcuenta ?? '',
  }, columnas(xml))
}

// ── El cuadre ─────────────────────────────────────────────────────────────────

/**
 * Julio, 13/11: las ventas (todas las 700xxxxx) se comparan sumadas, como «700»;
 * el IVA, igual: el soportado (472xxxxx) sumado como «472» y el repercutido
 * (477xxxxx) como «477», porque Diez lleva el IVA a sus subcuentas por su tabla
 * de tipos (la 47200000, la 47700010…) y Sumied a las suyas por tipo. El resto,
 * cuenta a cuenta.
 */
export const claveDelCuadre = (cuenta: string) => (/^700\d{5}$/.test(cuenta) ? '700' : /^472\d{5}$/.test(cuenta) ? '472' : /^477\d{5}$/.test(cuenta) ? '477' : cuenta)

// ── De lo que lee el traspaso a una factura del Excel ─────────────────────────

/** La factura de ventas que ya hace Sumied (resumenDeAsiento → facturaDeVentas): la misma del PDF. */
export type FacturaVentasDiez = {
  NumeroFactura: string | number; CuentaCliente: string; Descripcion?: string
  BaseImponible1: number; PorcentajeIVA1: number; CuotaIVA1: number; TotalFactura: number
  Apuntes: { Cuenta: string; Importe: number }[]
}

/** Una emitida del Excel, de la factura de ventas de Sumied (sin cambiar nada de ella). */
export function emitidaDeVentas(o: {
  factura: FacturaVentasDiez; fecha: string; nombreCliente: string; url: string
  local: string | null; canal: string | null
  correspondencia: { localAlEnviar: Record<string, string>; canalAlEnviar: Record<string, string> }
}): Emitida {
  const f = o.factura
  return {
    numero: String(f.NumeroFactura), fecha: o.fecha, concepto: f.Descripcion ?? `Ventas ${o.fecha}`,
    cliente: { subcuenta: f.CuentaCliente, nombre: o.nombreCliente },
    ingresos: f.Apuntes.map((a) => ({ cuenta: String(a.Cuenta), importe: Number(a.Importe) })),
    iva: [{ base: Number(f.BaseImponible1), pct: Number(f.PorcentajeIVA1), cuota: Number(f.CuotaIVA1) }],
    total: Number(f.TotalFactura), url: o.url,
    grupo: o.local ? o.correspondencia.localAlEnviar[o.local] ?? null : null,
    nivel3: o.canal ? o.correspondencia.canalAlEnviar[o.canal] ?? null : null,
  }
}

/**
 * El tipo de retención de Diez de cada subcuenta de retención de Foodint (Julio,
 * 24/10: profesionales a la 47510015 con PRO; alquileres a la 47510019 con ALQ).
 */
export const RETENCION_POR_SUBCUENTA: Record<string, string> = { '47510015': 'PRO', '47510019': 'ALQ' }

/** Lo que conta_recibida_envio devuelve de un asiento de factura recibida (lo que usa el envío por la API). */
export type RecibidaAsiento = {
  fecha: string
  factura: { numero: string | null; fecha: string }
  proveedor: { nombre: string; nif: string | null }
  lineas: { cuenta: string; debe: number; haber: number; tipoIva: number | null; baseIva: number | null }[]
}

/** Una recibida del Excel, de su asiento de Sumied; lo que no se sabe poner en el Excel va por la API. */
export function recibidaDeAsiento(r: RecibidaAsiento, url: string): Recibida | NoCabe {
  const numero = String(r.factura.numero ?? '').trim()
  if (!numero) return { porLaApi: 'sin número de factura' }
  const n = (x: number) => c(Number(x))
  const gastos = new Map<string, number>(); const iva = new Map<number, { base: number; cuota: number }>()
  const prov = new Map<string, number>(); const ret = new Map<string, number>()
  for (const l of r.lineas) {
    const neto = n(l.debe) - n(l.haber)
    if (/^[26]/.test(l.cuenta)) gastos.set(l.cuenta, (gastos.get(l.cuenta) ?? 0) + neto)
    else if (/^472/.test(l.cuenta)) {
      if (l.tipoIva == null || l.baseIva == null) return { porLaApi: `la ${l.cuenta} no lleva su tipo y su base` }
      const x = iva.get(Number(l.tipoIva)) ?? { base: 0, cuota: 0 }
      x.base += n(l.baseIva) * Math.sign(neto || 1); x.cuota += neto
      iva.set(Number(l.tipoIva), x)
    } else if (/^4[01]/.test(l.cuenta)) prov.set(l.cuenta, (prov.get(l.cuenta) ?? 0) - neto)
    else if (/^4751/.test(l.cuenta)) ret.set(l.cuenta, (ret.get(l.cuenta) ?? 0) - neto)
    else return { porLaApi: `lleva la cuenta ${l.cuenta} (autoliquidada u otra), que el Excel de recibidas no lleva` }
  }
  if (prov.size !== 1) return { porLaApi: `tiene que ir a una cuenta de proveedor (lleva ${prov.size})` }
  if (ret.size > 1) return { porLaApi: 'lleva más de una retención' }
  const [proveedor, total] = [...prov][0]
  // Un abono (total negativo) va en el Excel en negativo, como la rectificativa de emitidas que entró en la
  // C0009 el 24/10: 12 en octubre y noviembre. Se prueba en el ensayo de la C0009. Cero, no va.
  if (total === 0) return { porLaApi: 'el total es cero' }
  let retencion: Recibida['retencion'] = null
  if (ret.size === 1) {
    const [sub, cuota] = [...ret][0]
    const tipoDiez = RETENCION_POR_SUBCUENTA[sub]
    if (!tipoDiez) return { porLaApi: `la retención va a la ${sub}, que no tiene su tipo de Diez` }
    const base = [...gastos.values()].reduce((t, v) => t + v, 0)
    const pct = base ? Math.round((cuota * 100) / base) : 0
    if (Math.round((base * pct) / 100) !== cuota) return { porLaApi: 'la retención no es un porcentaje entero de la base' }
    retencion = { tipoDiez, subcuenta: sub, base: e(base), pct, cuota: e(cuota) }
  }
  return {
    numero, fechaFactura: r.factura.fecha, fechaOperacion: r.fecha, concepto: `${numero} · ${r.proveedor.nombre}`.slice(0, 40),
    proveedor: { subcuenta: proveedor, nombre: r.proveedor.nombre, nif: r.proveedor.nif },
    gastos: [...gastos].map(([cuenta, v]) => ({ cuenta, importe: e(v) })),
    iva: [...iva].sort(([a], [b]) => a - b).map(([pct, x]) => ({ base: e(x.base), pct, cuota: e(x.cuota) })),
    retencion, total: e(total), url,
  }
}
