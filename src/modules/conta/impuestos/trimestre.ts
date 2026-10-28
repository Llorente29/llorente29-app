// src/modules/conta/impuestos/trimestre.ts
//
// I01c · Pieza 3, la parte que ordena (Julio, 19/10) · Impuestos › Trimestre,
// fiel a maqueta_303_v2. Núcleo puro: lo que dice cada tarjeta de la tira y
// cada línea de la cartera de cuotas a compensar, a partir de lo que devuelve
// conta_impuesto_trimestre (0280). Se prueba sin React
// (tests/unit/modules/conta/i01c/trimestre.test.ts).
//
// La cartera, como el Pre303 de la AEAT: lo pendiente al empezar el año, lo que
// cada trimestre anterior dejó a compensar o aplicó, y en el trimestre, la
// [110] (pendiente al empezar), la [78] (se aplica ahora), la [87] (queda de
// antes) y el total a compensar después. Sale de los 303 presentados, también
// de los subidos. Si un trimestre de antes no está, se dice: la cadena no se
// inventa (regla 7).

import type { TonoChip } from '@/modules/conta/diseno'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import type { Cadencia, Estado, Resultado } from './calendario'

export interface CasillaTrimestre { casilla: string; valor: number | null; texto: string | null; origen: 'calculated' | 'manual' | 'justificante' | string; motivo: string | null }

export interface DeclaracionTrimestre {
  id: string
  cuenta: string
  estado: Estado
  estado_texto: string
  resultado: Resultado | null
  importe: number | null
  presentada: string | null
  presentada_por: string | null
  por: 'sumied' | 'outside' | null
  csv: string | null
  justificante: string | null
  justificante_pdf: string | null
  traido: boolean | null
  expediente: string | null
  presentador: { nif: string | null; nombre: string | null } | null
  casillas: CasillaTrimestre[]
}

export interface ModeloTrimestre {
  modelo: string
  nombre: string
  cadencia: Cadencia
  periodo: string | null
  no_toca: boolean
  presentacion: string | null
  domiciliacion: string | null
  declaracion: DeclaracionTrimestre | null
}

export interface FilaCartera {
  periodo: string
  declaracion: string | null
  estado: Estado | null
  presentada: boolean | null
  resultado: Resultado | null
  importe: number | null
  c110: number | null
  c78: number | null
  c87: number | null
  origen110: string | null
}

export interface Cartera {
  filas: FilaCartera[]
  /** Lo que quedaba al empezar el año: del 4T del año anterior («4T/2025») o, si falta, de la [110] del 1T («1T/2026»). Con los dos, la [110] del 1T en c110_1t (0420). */
  pendiente_al_empezar: { importe: number; de: string; c110_1t?: number | null } | null
  esperada_110: { importe: number; de: string } | null
  borrador: { id: string; estado: Estado; c110: number | null; origen110: string | null } | null
  desfasada: boolean
}

export interface Trimestre {
  empresa: { id: string; nombre: string; razon_social: string; nif: string | null }
  ejercicio: number
  trimestre: string
  puede_gestionar: boolean
  /** I01d (0420) · Desde cuándo lleva aquí sus impuestos (la primera obligación vigente). Sin la 0420, no viene. */
  desde?: string | null
  modelos: ModeloTrimestre[]
  cartera: Cartera
}

const PRESENTADAS: ReadonlySet<Estado> = new Set(['filed', 'booked', 'paid', 'offset', 'refunded'])
export const estaPresentada = (e: Estado | null | undefined): boolean => !!e && PRESENTADAS.has(e)

/** «3T» → 3. Lo que no sea un trimestre, null. */
export function numeroTrimestre(t: string | undefined): number | null {
  const m = /^([1-4])T$/i.exec(t ?? '')
  return m ? Number(m[1]) : null
}

/**
 * El trimestre que se abre sin decir cuál: el último acabado, que es el que se
 * presenta (el 19/10/2026, el 3T de 2026; en enero, el 4T del año anterior).
 */
export function trimestrePorDefecto(hoy: string): { ejercicio: number; trimestre: string } {
  const y = Number(hoy.slice(0, 4))
  const mes = Number(hoy.slice(5, 7))
  const q = Math.floor((mes - 1) / 3) // el que va en curso, 0..3
  return q === 0 ? { ejercicio: y - 1, trimestre: '4T' } : { ejercicio: y, trimestre: `${q}T` }
}

/** «3.er trimestre 2026», «2.º trimestre 2026», como la miga de la maqueta. */
export function tituloTrimestre(ejercicio: number, trimestre: string): string {
  const n = numeroTrimestre(trimestre) ?? 0
  return `${n}.${n === 1 || n === 3 ? 'er' : 'º'} trimestre ${ejercicio}`
}

/** El nombre corto de la tarjeta: «IVA · 303», «Retenciones · 111», «Alquiler · 115», «Sociedades · 202». */
export function nombreTarjeta(m: Pick<ModeloTrimestre, 'modelo' | 'nombre' | 'periodo' | 'cadencia'>): string {
  const corto: Record<string, string> = {
    '303': 'IVA', '111': 'Retenciones', '115': 'Alquiler', '202': 'Sociedades',
    // S02 · Los del año.
    '390': 'IVA del año', '190': 'Retenciones del año', '180': 'Alquileres del año', '347': 'Clientes y proveedores', '349': 'Operaciones con la UE',
  }
  const mes = m.cadencia === 'monthly' && m.periodo ? ` · mes ${Number(m.periodo)}` : ''
  return `${corto[m.modelo] ?? m.nombre} · ${m.modelo}${mes}`
}

/** El importe con su sentido: a pagar en positivo; a compensar o a devolver, en negativo (como la maqueta). */
export function importeConSigno(d: Pick<DeclaracionTrimestre, 'resultado' | 'importe'>): number | null {
  if (d.importe === null || d.importe === undefined || d.resultado === null) return null
  return d.resultado === 'to_offset' || d.resultado === 'to_refund' ? -Math.abs(d.importe) : Math.abs(d.importe)
}

/** Días de un día a otro (los dos 'AAAA-MM-DD'). */
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/**
 * I01d · ¿El periodo es de antes de llevar aquí los impuestos? Lo es si su plazo
 * de presentación acabó antes de «desde»; sin plazo (Sumied no tiene festivos de
 * ese año), si su año es anterior al de «desde». Sin «desde», no se sabe: no.
 */
export function anteriorASumied(ejercicio: number, presentacion: string | null, desde: string | null | undefined): boolean {
  if (!desde) return false
  if (presentacion) return presentacion < desde
  return ejercicio < Number(desde.slice(0, 4))
}

/**
 * I01d · Un modelo «sin cargar»: toca en el periodo, no tiene declaración (o
 * solo pendiente) y es de antes de llevar aquí los impuestos. Se presentó fuera
 * y lo que falta es pegar su CSV, no presentarlo: no está fuera de plazo.
 */
export function sinCargar(m: ModeloTrimestre, ejercicio: number, desde: string | null | undefined): boolean {
  if (m.no_toca || !m.periodo) return false
  if (m.declaracion && m.declaracion.estado !== 'pending') return false
  return anteriorASumied(ejercicio, m.presentacion, desde)
}

export const TEXTO_SIN_CARGAR = 'Sin cargar · Pegar CSV'

/**
 * Lo que dice cada tarjeta de la tira: el importe y su chip (estado y fecha).
 * Sin presentar, lo que vence hoy o ya se pasó va en rojo y lo dice (Julio,
 * 20/10, punto 5: «Sin calcular · vence hoy»). Lo de antes de Sumied sin
 * declaración, «Sin cargar · Pegar CSV» (I01d).
 */
export function tarjeta(m: ModeloTrimestre, hoy?: string, ejercicio?: number, desde?: string | null): { titulo: string; importe: string; chip: { tono: TonoChip; texto: string } } {
  const titulo = nombreTarjeta(m)
  if (m.no_toca) return { titulo, importe: '—', chip: { tono: 'neutro', texto: 'No toca este trimestre' } }
  if (ejercicio && sinCargar(m, ejercicio, desde)) return { titulo, importe: '—', chip: { tono: 'accion', texto: TEXTO_SIN_CARGAR } }
  const d = m.declaracion
  const falta = hoy && m.presentacion ? dias(hoy, m.presentacion) : null
  const vence = falta === null ? '' : falta < 0 ? 'fuera de plazo' : falta === 0 ? 'vence hoy' : ''
  const conVence = (chip: { tono: TonoChip; texto: string }) => (vence ? { tono: 'falta' as TonoChip, texto: `${chip.texto} · ${vence}` } : chip)
  if (!d || d.estado === 'pending') {
    if (vence) return { titulo, importe: '—', chip: { tono: 'falta', texto: falta! < 0 ? 'Fuera de plazo' : 'Vence hoy' } }
    return { titulo, importe: '—', chip: { tono: 'neutro', texto: m.presentacion ? `Hasta el ${diaMesCorto(m.presentacion)}` : 'Sin plazo' } }
  }
  const v = importeConSigno(d)
  const importe = v === null ? '—' : eurosExactos(v)
  if (estaPresentada(d.estado)) {
    return { titulo, importe, chip: { tono: 'seguro', texto: d.presentada ? `Presentado ${diaMesCorto(d.presentada)}` : 'Presentado' } }
  }
  if (d.estado === 'not_required') return { titulo, importe: '—', chip: { tono: 'neutro', texto: 'No hace falta' } }
  if (d.estado === 'reviewed') return { titulo, importe, chip: conVence({ tono: 'accion', texto: 'Revisado · para presentar' }) }
  if (d.resultado === null) return { titulo, importe: '—', chip: conVence({ tono: 'falta', texto: 'Sin calcular' }) }
  // I01h · El 303 del periodo que aún no ha acabado: calculado con lo que va, no se revisa todavía.
  const f = hoy && ejercicio && m.periodo ? fechasPeriodo(ejercicio, m.periodo) : null
  if (m.modelo === '303' && f && hoy && enCurso(f, hoy)) return { titulo, importe, chip: { tono: 'neutro', texto: `En curso · se cierra el ${diaMesCorto(f.hasta)}` } }
  return { titulo, importe, chip: conVence({ tono: 'accion', texto: 'Para revisar' }) }
}

/** La casilla del resultado de cada modelo: la que va en negrita en la ficha. */
export const CASILLA_RESULTADO: Readonly<Record<string, string>> = { '303': '71', '111': '30', '115': '05', '202': '03' }

/**
 * Quién lo presentó, en palabras: la gestoría con su nombre (y su NIF), o «La
 * propia empresa» si el NIF del presentador es el de la empresa. Sin dato, null.
 */
export function presentadorEnPalabras(p: DeclaracionTrimestre['presentador'], nifEmpresa: string | null): string | null {
  if (!p || (!p.nif && !p.nombre)) return null
  const limpio = (x: string | null) => (x ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (p.nif && nifEmpresa && limpio(p.nif) === limpio(nifEmpresa)) return 'La propia empresa'
  return p.nombre ? `${p.nombre}${p.nif ? ` (${p.nif})` : ''}` : p.nif
}

// ── La cartera ──────────────────────────────────────────────────────────────

export interface LineaCartera { texto: string; casilla?: string; importe: number | null; nota?: string; fuerte?: boolean }

/** La [110] que se enseña del trimestre: la del 303 presentado; la del borrador si está al día; si no, la que le toca. */
function c110DelTrimestre(c: Cartera, fila: FilaCartera | undefined): number | null {
  if (fila && estaPresentada(fila.estado)) return fila.c110
  if (c.borrador && !c.desfasada && c.borrador.c110 !== null) return c.borrador.c110
  return c.esperada_110?.importe ?? null
}

/**
 * Las líneas de «Cuotas a compensar de trimestres anteriores», trimestre a
 * trimestre, con la [110], la [78] y la [87] del trimestre y el total después.
 */
export function lineasCartera(t: Pick<Trimestre, 'ejercicio' | 'trimestre' | 'cartera' | 'desde'>): { lineas: LineaCartera[]; total: LineaCartera; cuadra: boolean | null } {
  const c = t.cartera
  const q = numeroTrimestre(t.trimestre) ?? 1
  const lineas: LineaCartera[] = []
  const p = c.pendiente_al_empezar
  const del4T = !!p && p.de.startsWith('4T/')
  let cadena: number | null = p?.importe ?? null
  // I01d · De qué 303 sale: del 4T del año anterior; si ese 4T falta, de la [110] del 1T, y se dice.
  lineas.push(p
    ? { texto: `Pendiente de ${t.ejercicio - 1}`, importe: p.importe,
        nota: del4T ? `Lo que dejó el 303 del 4T de ${t.ejercicio - 1}.` : `Sale de la [110] del 1T de ${t.ejercicio}: falta cargar el 303 del 4T de ${t.ejercicio - 1}.` }
    : { texto: `Pendiente de ${t.ejercicio - 1}`, importe: null, nota: `No se sabe: falta el 303 del 4T de ${t.ejercicio - 1} o el del 1T de ${t.ejercicio}.` })
  for (const f of c.filas) {
    const n = numeroTrimestre(f.periodo) ?? 0
    if (n >= q) continue
    if (!estaPresentada(f.estado)) {
      const antes = anteriorASumied(t.ejercicio, fechasTrimestre(t.ejercicio, f.periodo).hasta, t.desde)
      lineas.push(antes
        ? { texto: `${f.periodo} ${t.ejercicio} · sin cargar`, importe: null, nota: 'Pega su CSV para que la cartera siga.' }
        : { texto: `${f.periodo} ${t.ejercicio} · no está presentado en Sumied`, importe: null, nota: 'Súbelo en Presentados para que la cartera siga.' })
      cadena = null
      continue
    }
    if (f.resultado === 'to_offset' && f.importe !== null) {
      lineas.push({ texto: `${f.periodo} ${t.ejercicio} · salió a compensar`, importe: Math.abs(f.importe) })
      if (cadena !== null) cadena += Math.abs(f.importe)
    }
    if ((f.c78 ?? 0) > 0) {
      lineas.push({ texto: `${f.periodo} ${t.ejercicio} · aplicado`, importe: -(f.c78 ?? 0) })
      if (cadena !== null) cadena -= f.c78 ?? 0
    }
  }
  const fila = c.filas.find((f) => f.periodo === t.trimestre)
  const c110 = c110DelTrimestre(c, fila)
  const tieneCalculo = !!fila && fila.estado !== null && fila.estado !== 'pending' && (estaPresentada(fila.estado) || !c.desfasada)
  const c78 = tieneCalculo ? fila!.c78 : null
  const c87 = tieneCalculo ? fila!.c87 : null
  lineas.push({ texto: `Pendiente al empezar el ${t.trimestre}`, casilla: '110', importe: c110, fuerte: false })
  lineas.push({ texto: 'Se aplica ahora', casilla: '78', importe: c78 })
  lineas.push({ texto: 'Queda de antes', casilla: '87', importe: c87 })
  const aCompensar = tieneCalculo && fila!.resultado === 'to_offset' && fila!.importe !== null ? Math.abs(fila!.importe) : 0
  const total: LineaCartera = {
    texto: `Total a compensar después del ${t.trimestre}`,
    importe: tieneCalculo && c87 !== null && fila!.resultado !== null ? c87 + aCompensar : null,
    fuerte: true,
  }
  // La cadena de los presentados tiene que dar la [110] del trimestre (lo pendiente + lo que salió a compensar − lo aplicado).
  // En el 1T, solo con lo pendiente sacado del 4T y el 1T presentado: si no, se compararía consigo misma (I01d).
  const comparable = q !== 1 || (del4T && !!fila && estaPresentada(fila.estado))
  const cuadra = cadena === null || c110 === null || !comparable ? null : Math.abs(cadena - c110) < 0.005
  return { lineas, total, cuadra }
}

/** El borrador desfasado, en una frase: qué [110] tiene y cuál le toca. */
export function fraseDesfasada(t: Pick<Trimestre, 'trimestre' | 'cartera'>): string | null {
  const c = t.cartera
  if (!c.desfasada || !c.esperada_110 || !c.borrador) return null
  const tiene = c.borrador.c110 === null ? 'no tiene [110]' : `tiene la [110] en ${eurosExactos(c.borrador.c110)}`
  return `El borrador del ${t.trimestre} se calculó antes de tener el ${c.esperada_110.de} presentado: ${tiene} y le tocan ${eurosExactos(c.esperada_110.importe)}.`
}

/**
 * Lo que dice la pantalla después de volver a calcular un borrador desfasado
 * (regla 8: con contenido), como la maqueta: «Vuelto a calcular el 3T: trae
 * 3.796,17 € a compensar del 2T. El resultado del IVA aún no se sabe: falta el
 * libro de IVA del trimestre.»
 */
export function fraseRecalculado(trimestre: string, de: string, c110: number | null, conResultado = true): string {
  if (c110 === null) return `Vuelto a calcular el ${trimestre}, pero sigue sin la [110]: mira el IVA del trimestre.`
  const delAnterior = de.split('/')[0]
  const base = `Vuelto a calcular el ${trimestre}: trae ${eurosExactos(c110)} a compensar del ${delAnterior}.`
  return conResultado ? base : `${base} El resultado del IVA aún no se sabe: falta el libro de IVA del trimestre.`
}

/**
 * I01c (maqueta v3) · La cuenta del impuesto en el mayor, para «Ver el asiento»
 * cuando la declaración no tiene asiento en Sumied: las retenciones (111 y
 * 115) en la 4751; el pago a cuenta del 202 en la 473; el 303, en la 4750 si
 * sale a pagar y en la 4700 si sale a compensar o a devolver.
 */
export function cuentaDelImpuesto(modelo: string, resultado: string | null): string | null {
  if (modelo === '111' || modelo === '115') return '4751'
  if (modelo === '202') return '473'
  if (modelo === '303') return resultado === 'to_pay' ? '4750' : resultado ? '4700' : null
  return null
}

/** El libro registro de las facturas del modelo (Libros › Libros registro): null si no tiene. */
export function librosDelModelo(modelo: string): 'recibidas' | 'retenciones' | null {
  if (modelo === '303') return 'recibidas'
  if (modelo === '111' || modelo === '115') return 'retenciones'
  return null
}

// ── I01c · maqueta v4 (20/10): la liquidación en palabras y lo comprobado ──

/** El primer y el último día de un trimestre ('3T' de 2026 → 2026-07-01 a 2026-09-30). */
export function fechasTrimestre(ejercicio: number, trimestre: string): { desde: string; hasta: string } {
  const q = Number(trimestre[0])
  const m1 = (q - 1) * 3 + 1, m3 = q * 3
  const ultimo = new Date(Date.UTC(ejercicio, m3, 0)).getUTCDate()
  return { desde: `${ejercicio}-${String(m1).padStart(2, '0')}-01`, hasta: `${ejercicio}-${String(m3).padStart(2, '0')}-${ultimo}` }
}

// ── I01h · El 303 en vivo (Julio, 21/10): el del periodo en curso, calculado con lo que va ──

/** El primer y el último día de un periodo del 303: un trimestre ('4T') o un mes ('10'). Lo demás, null. */
export function fechasPeriodo(ejercicio: number, periodo: string): { desde: string; hasta: string } | null {
  if (/^[1-4]T$/.test(periodo)) return fechasTrimestre(ejercicio, periodo)
  if (/^(0[1-9]|1[0-2])$/.test(periodo)) {
    const ultimo = new Date(Date.UTC(ejercicio, Number(periodo), 0)).getUTCDate()
    return { desde: `${ejercicio}-${periodo}-01`, hasta: `${ejercicio}-${periodo}-${ultimo}` }
  }
  return null
}

/** ¿El periodo aún no ha acabado? Del primer día al último, los dos dentro. */
export function enCurso(f: { desde: string; hasta: string }, hoy: string): boolean {
  return f.desde <= hoy && hoy <= f.hasta
}

/** «Calculado hasta hoy (21/10/2026) con el libro de IVA de lo que va de trimestre. Se cierra el 31/12: …». */
export function fraseEnCurso(periodo: string, hoy: string, hasta: string): string {
  const que = /^[1-4]T$/.test(periodo) ? 'trimestre' : 'mes'
  const [y, m, d] = hoy.split('-')
  return `Calculado hasta hoy (${d}/${m}/${y}) con el libro de IVA de lo que va de ${que}. Se cierra el ${diaMesCorto(hasta)}: hasta entonces cambia con cada factura.`
}

/** Una fila de la liquidación del 303 en palabras: base y cuota, con sus casillas en pequeño. */
export type FilaLiquidacion = { texto: string; base: number | null; cuota: number | null; casillas: string[] }
type Grupo = { texto: string; base?: string; tipo?: string; cuota: string }

const COBRAS: Grupo[] = [
  { texto: 'Ventas', base: '150', tipo: '151', cuota: '152' },
  { texto: 'Ventas', base: '01', tipo: '02', cuota: '03' },
  { texto: 'Ventas', base: '153', tipo: '154', cuota: '155' },
  { texto: 'Ventas', base: '04', tipo: '05', cuota: '06' },
  { texto: 'Ventas', base: '07', tipo: '08', cuota: '09' },
  { texto: 'Ventas', base: '165', tipo: '166', cuota: '167' },
  { texto: 'Adquisiciones intracomunitarias (autoliquidadas)', base: '10', cuota: '11' },
  { texto: 'Otras compras con inversión del sujeto pasivo', base: '12', cuota: '13' },
  { texto: 'Modificación de bases y cuotas', base: '14', cuota: '15' },
  { texto: 'Recargo de equivalencia', base: '156', tipo: '157', cuota: '158' },
  { texto: 'Recargo de equivalencia', base: '16', tipo: '17', cuota: '18' },
  { texto: 'Recargo de equivalencia', base: '19', tipo: '20', cuota: '21' },
  { texto: 'Recargo de equivalencia', base: '22', tipo: '23', cuota: '24' },
  { texto: 'Recargo de equivalencia', base: '168', tipo: '169', cuota: '170' },
  { texto: 'Modificación del recargo de equivalencia', base: '25', cuota: '26' },
]
const DEDUCES: Grupo[] = [
  { texto: 'Compras y gastos corrientes', base: '28', cuota: '29' },
  { texto: 'Bienes de inversión', base: '30', cuota: '31' },
  { texto: 'Importaciones corrientes', base: '32', cuota: '33' },
  { texto: 'Importaciones de bienes de inversión', base: '34', cuota: '35' },
  { texto: 'Adquisiciones intracomunitarias corrientes', base: '36', cuota: '37' },
  { texto: 'Adquisiciones intracomunitarias de bienes de inversión', base: '38', cuota: '39' },
  { texto: 'Rectificación de deducciones', base: '40', cuota: '41' },
  { texto: 'Compensaciones del régimen agrario', cuota: '42' },
  { texto: 'Regularización de bienes de inversión', cuota: '43' },
  { texto: 'Regularización por la prorrata definitiva', cuota: '44' },
]

/**
 * La liquidación del 303 agrupada en palabras (maqueta v4): «IVA que cobras»
 * y «IVA que deduces», con base y cuota por tipo y sus casillas al lado. Solo
 * las filas con algo: todas las casillas siguen en «Ver las casillas» (regla 7).
 */
export function liquidacion303(casillas: CasillaTrimestre[]) {
  const v = new Map(casillas.map((c) => [c.casilla.padStart(2, '0'), c.valor]))
  const n = (k?: string) => (k ? v.get(k) ?? null : null)
  const filas = (gs: Grupo[]): FilaLiquidacion[] => gs.flatMap((g) => {
    const base = n(g.base), cuota = n(g.cuota)
    if (!base && !cuota) return []
    const tipo = n(g.tipo)
    const texto = tipo !== null ? `${g.texto} al ${String(tipo).replace('.', ',')} %` : g.texto
    return [{ texto, base, cuota, casillas: [g.base, g.cuota].filter((x): x is string => !!x) }]
  })
  return {
    cobras: filas(COBRAS), totalCobras: n('27'),
    deduces: filas(DEDUCES), totalDeduces: n('45'),
    diferencia: n('46'), resultado: n('71'),
  }
}

/** Una fila del libro de IVA del trimestre, lo que hace falta para casarlo con el 303. */
export type FilaLibroTrimestre = {
  book: string; tax_rate: number | null; tax_amount: number; reverse_charge: boolean; operation_key: string | null; investment_good: boolean
}
export type LineaCuadre = { casilla: string; texto: string; libro: number; presentado: number; casa: boolean }

/**
 * Lo comprobado del 303: el libro de IVA del trimestre (ya con «deducida en»)
 * contra las cuotas del 303, casilla a casilla y al céntimo, con las mismas
 * reglas que el testigo del importador de Diez. Solo las casillas con algo a
 * un lado o al otro.
 */
export function cuadreLibro303(filas: FilaLibroTrimestre[], casillas: CasillaTrimestre[]): LineaCuadre[] {
  const cent = (x: number | null | undefined) => Math.round(Number(x ?? 0) * 100)
  const suma = (f: (x: FilaLibroTrimestre) => boolean) => filas.filter(f).reduce((a, x) => a + cent(x.tax_amount), 0)
  const recibida = (x: FilaLibroTrimestre) => x.book === 'received'
  const intra = (x: FilaLibroTrimestre) => recibida(x) && x.reverse_charge && x.operation_key === '09'
  const reglas: [string, string, (x: FilaLibroTrimestre) => boolean][] = [
    ['03', 'IVA de las ventas al 4 %', (x) => x.book === 'issued' && Number(x.tax_rate) === 4 && !x.reverse_charge],
    ['06', 'IVA de las ventas al 10 %', (x) => x.book === 'issued' && Number(x.tax_rate) === 10 && !x.reverse_charge],
    ['09', 'IVA de las ventas al 21 %', (x) => x.book === 'issued' && Number(x.tax_rate) === 21 && !x.reverse_charge],
    ['11', 'IVA de las adquisiciones intracomunitarias', intra],
    ['13', 'IVA de otras compras con inversión del sujeto pasivo', (x) => recibida(x) && x.reverse_charge && x.operation_key !== '09'],
    ['29', 'IVA deducible de compras y gastos corrientes', (x) => recibida(x) && !x.investment_good && (!x.reverse_charge || x.operation_key !== '09')],
    ['37', 'IVA deducible de las adquisiciones intracomunitarias', intra],
  ]
  const pres = new Map(casillas.map((c) => [c.casilla.padStart(2, '0'), cent(c.valor)]))
  return reglas.flatMap(([casilla, texto, f]) => {
    const libro = suma(f), presentado = pres.get(casilla) ?? 0
    return libro === 0 && presentado === 0 ? [] : [{ casilla, texto, libro: libro / 100, presentado: presentado / 100, casa: libro === presentado }]
  })
}

/** Lo que el diario mueve en una cuenta en el trimestre. */
export type SumaCuenta = { codigo: string; nombre: string; debe: number; haber: number }
export type LineaCuadreCuenta = { texto: string; importe: number | null; casillas?: string; casa?: boolean | null }

/**
 * Los cuadres del 111 y el 115 contra el diario (maqueta v4): lo retenido
 * ([28] del 111, [03] del 115) contra el haber del trimestre de cada subcuenta
 * de la 4751, y la base del 115 ([02]) contra lo cargado en la 621
 * (arrendamientos), que puede llevar también alquileres sin retención: ese
 * cuadre se dice, no se da por error.
 */
export function cuadreRetenciones(modelo: string, casillas: CasillaTrimestre[], cuentas: SumaCuenta[]): { lineas: LineaCuadreCuenta[]; conclusion: { casa: boolean; texto: string } | null } {
  const v = new Map(casillas.map((c) => [c.casilla.padStart(2, '0'), c.valor]))
  const cent = (x: number | null | undefined) => Math.round(Number(x ?? 0) * 100)
  const retenido = modelo === '111' ? v.get('28') ?? v.get('30') ?? null : modelo === '115' ? v.get('03') ?? null : null
  if (retenido === null || retenido === undefined) return { lineas: [], conclusion: null }
  const c4751 = cuentas.filter((c) => c.codigo.startsWith('4751'))
  const casa = c4751.find((c) => cent(c.haber) === cent(retenido)) ?? null
  const lineas: LineaCuadreCuenta[] = [
    { texto: modelo === '111' ? 'Retenciones del 111' : 'Retenciones del 115', importe: retenido, casillas: modelo === '111' ? '[28]' : '[03]' },
    ...c4751.map((c) => ({ texto: `${c.codigo} · ${c.nombre} (haber del trimestre)`, importe: c.haber, casa: casa ? c.codigo === casa.codigo : null })),
  ]
  if (modelo === '115') {
    const c621 = cuentas.filter((c) => c.codigo.startsWith('621'))
    const base = v.get('02') ?? null
    if (base !== null && base !== undefined) {
      lineas.push({ texto: 'Base de las retenciones del 115', importe: base, casillas: '[02]' })
      for (const c of c621) lineas.push({ texto: `${c.codigo} · ${c.nombre} (cargado en el trimestre)`, importe: c.debe - c.haber, casa: cent(c.debe - c.haber) === cent(base) })
    }
  }
  const conclusion = casa
    ? { casa: true, texto: `Lo retenido casa con el haber de la ${casa.codigo} en el trimestre.` }
    : { casa: false, texto: c4751.length ? 'Ninguna subcuenta de la 4751 tiene en el trimestre el mismo haber que lo retenido: mira sus apuntes en el mayor.' : 'El diario no tiene movimientos de la 4751 en el trimestre.' }
  return { lineas, conclusion }
}

// ── I01g · El 111 y el 115 calculados por Sumied (Julio, 20/10) ────────────

/** Lo que devuelve conta_impuesto_retenciones_diario (0330): el diario del periodo, asiento a asiento. */
export interface AsientoRetencion {
  asiento: string; fecha: string; serie: number | null; numero: number | null; concepto: string | null; estado: string
  tipo: '115' | '111_nomina' | '111_profesional' | 'sin_modelo' | 'pago' | 'apertura'
  retenido: number; base: number | null; perceptor: string | null; perceptor_nombre: string | null; cuentas_4751: string | null
}
type Suma = { asientos: number; base: number; retenido: number; perceptores?: number }
export interface RetencionesDiario {
  desde: string; hasta: string
  asientos: AsientoRetencion[]
  sumas: { '115': Suma; '111_nomina': Suma; '111_profesional': Suma; sin_modelo: { asientos: number; retenido: number }; pagos: number; aperturas: number }
  lineas_640: { asiento: string; fecha: string; importe: number; concepto: string | null }[]
  cuenta_621: number
  cuentas_4751: { cuenta: string; nombre: string; haber: number; debe: number }[]
}

/** Una fila de la liquidación del 111 o el 115 en palabras: quién, cuántos, la base y lo retenido. */
export type FilaRetencion = { texto: string; perceptores: number | null; base: number | null; retenido: number | null; casillas: string[] }

/**
 * La liquidación del 111 o del 115 en palabras (como la del 303, maqueta v4):
 * una fila por clase de perceptor con sus casillas al lado, el total y el
 * resultado. Solo las filas con algo; todas las casillas siguen en «Ver las
 * casillas» (regla 7).
 */
export function liquidacionRetenciones(modelo: string, casillas: CasillaTrimestre[]): { filas: FilaRetencion[]; total: number | null; casillaTotal: string; resultado: number | null; casillaResultado: string } {
  const v = new Map(casillas.map((c) => [c.casilla.padStart(2, '0'), c.valor]))
  const n = (k: string) => v.get(k) ?? null
  const grupos: [string, string, string, string][] = modelo === '115'
    ? [['Alquileres de locales', '01', '02', '03']]
    : [['Nóminas', '01', '02', '03'], ['Nóminas en especie', '04', '05', '06'], ['Profesionales', '07', '08', '09'], ['Profesionales en especie', '10', '11', '12'], ['Premios', '13', '14', '15']]
  const filas = grupos.flatMap(([texto, p, b, r]) => {
    if (!n(p) && !n(b) && !n(r)) return []
    return [{ texto, perceptores: n(p), base: n(b), retenido: n(r), casillas: [p, b, r] }]
  })
  return modelo === '115'
    ? { filas, total: n('03'), casillaTotal: '03', resultado: n('05'), casillaResultado: '05' }
    : { filas, total: n('28'), casillaTotal: '28', resultado: n('30'), casillaResultado: '30' }
}

export type LineaCuadreDiario = { texto: string; casillas: string; modelo: number | null; diario: number | null; casa: boolean | null; personas?: boolean }

/**
 * Lo comprobado del 111 o del 115 contra el diario (0330), casilla a casilla
 * y al céntimo, con la misma regla que el cálculo: la base y lo retenido de
 * cada clase, los perceptores que salen del diario (no los de las nóminas, que
 * van a mano) y la 4751 entera. Sirve igual para uno presentado (lo que dice
 * el justificante) que para un borrador.
 */
export function cuadreConDiario(modelo: string, casillas: CasillaTrimestre[], d: RetencionesDiario): { lineas: LineaCuadreDiario[]; casa: boolean; explicacion: string[] } {
  const v = new Map(casillas.map((c) => [c.casilla.padStart(2, '0'), c.valor]))
  const cent = (x: number | null | undefined) => Math.round(Number(x ?? 0) * 100)
  const lineas: LineaCuadreDiario[] = []
  const fila = (texto: string, casilla: string, diario: number | null, personas = false) => {
    const m = v.get(casilla) ?? null
    if (m === null && !diario) return
    lineas.push({ texto, casillas: `[${casilla}]`, modelo: m, diario, casa: diario === null ? null : cent(m) === cent(diario), personas })
  }
  const s = d.sumas
  if (modelo === '115') {
    fila('Arrendadores', '01', s['115'].perceptores ?? 0, true)
    fila('Base: alquileres con retención (621)', '02', s['115'].base)
    fila('Retenido en los alquileres (4751)', '03', s['115'].retenido)
  } else {
    fila('Nóminas: lo cobrado (640, sin la 641)', '02', s['111_nomina'].base)
    fila('Nóminas: lo retenido (4751)', '03', s['111_nomina'].retenido)
    fila('Profesionales: cuántos', '07', s['111_profesional'].perceptores ?? 0, true)
    fila('Profesionales: la base (su gasto)', '08', s['111_profesional'].base)
    fila('Profesionales: lo retenido (4751)', '09', s['111_profesional'].retenido)
    fila('Retenido en total', '28', Math.round((s['111_nomina'].retenido + s['111_profesional'].retenido) * 100) / 100)
  }
  const casa = lineas.every((l) => l.casa !== false)
  const explicacion: string[] = []
  // La base de las nóminas: si la diferencia es justo una línea de la 640, se dice cuál (Julio, 20/10: el 1T de Foodint).
  const b = lineas.find((l) => l.casillas === '[02]' && modelo === '111')
  if (b && b.casa === false) {
    const dif = cent(b.diario) - cent(b.modelo)
    const una = d.lineas_640.find((l) => cent(l.importe) === Math.abs(dif))
    const quien = una ? ` Es justo una línea de la 640 de la nómina del ${diaMesCorto(una.fecha)} (${eurosExactos(una.importe)}), que no está en la base del 111.` : ''
    explicacion.push(`La 640 de las nóminas suma ${eurosExactos(Math.abs(dif) / 100)} ${dif > 0 ? 'más' : 'menos'} que la base del 111 ([02]).${quien} Puede ser una paga que no lleva retención; pregúntalo a quien hace las nóminas. No bloquea nada.`)
  }
  if (modelo === '115' && cent(d.cuenta_621) !== cent(s['115'].base)) {
    explicacion.push(`La 621 del trimestre suma ${eurosExactos(d.cuenta_621)}: ${eurosExactos(Math.round((d.cuenta_621 - s['115'].base) * 100) / 100)} son alquileres sin retención (un renting, por ejemplo), que no van en el 115.`)
  }
  if (s.sin_modelo.asientos > 0) {
    explicacion.push(`${s.sin_modelo.asientos === 1 ? '1 asiento mueve' : `${s.sin_modelo.asientos} asientos mueven`} la 4751 sin gasto ni nómina (${eurosExactos(s.sin_modelo.retenido)} retenidos): Sumied no sabe si ${s.sin_modelo.asientos === 1 ? 'va' : 'van'} en el 111 o en el 115.`)
  }
  return { lineas, casa, explicacion }
}

/** Lo que dice la pantalla al calcular el 111 o el 115 (regla 8: con contenido). */
export function fraseCalculoRetenciones(modelo: string, periodo: string, c: { importe: number | null; resultado: string | null; falta_perceptores?: boolean }): string {
  const cuanto = c.importe === null ? 'sale negativo: mira lo comprobado' : c.resultado === 'no_activity' ? 'sin retenciones en el diario' : `${eurosExactos(c.importe)} a ingresar`
  const falta = c.falta_perceptores ? ' Falta escribir cuántas personas cobraron nómina ([01]).' : ''
  return `Calculado el ${modelo} del ${periodo} desde el diario: ${cuanto}.${falta}`
}
