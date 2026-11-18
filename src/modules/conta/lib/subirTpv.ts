// src/modules/conta/lib/subirTpv.ts
//
// R06 · Lo que decide la ventana «Subir las ventas del TPV» y la de «A qué cuenta
// va cada forma de pago», sin pantalla (encargo R06, respuesta R05 · 2).
//
//   - Los cuatro ficheros de Revo, cada uno en su hueco (reconocer, del R04).
//   - Cada día leído: si cuadra (facturas, IVA y pagos dan lo mismo, sin saltos
//     de numeración), si no cuadra y por qué, con sus cifras y la orden que hay
//     que mirar, o si ya estaba guardado (igual o distinto). Un día validado no
//     se pisa.
//   - El día por dentro: el IVA por tipo, cómo se cobró (Deliverect, por
//     plataforma) y qué forma de pago no tiene cuenta todavía.
//   - Lo que dice la lista: «Última subida: …» y «Falta por subir: …».
//
// Lo mismo comprueba conta_tpv_dia_guardar en la base (R03) al guardar: esto es
// para decirlo ANTES, en el paso 2, sin subir nada.

import { eurosExactos } from '@/modules/conta/lib/formato'
import { NOMBRE_CLASE, type ClaseRevo, type DiaLeido, type LecturaDia } from '@/modules/conta/lib/lectorRevo'

// ── Los ficheros ─────────────────────────────────────────────────────────────

export const CLASES_REVO: ClaseRevo[] = ['ordenes', 'documentos', 'impuestos', 'pagos']
export const ETIQUETA_CLASE: Record<ClaseRevo, string> = { ordenes: 'Órdenes', documentos: 'Documentos', impuestos: 'Impuestos', pagos: 'Pagos' }

/** Los cuatro huecos, con el nombre del fichero que ha caído en cada uno (o ninguno). */
export function huecos(clases: { clase: ClaseRevo; nombre: string }[]): { clase: ClaseRevo; etiqueta: string; nombre: string | null; repetido: boolean }[] {
  return CLASES_REVO.map((clase) => {
    const suyos = clases.filter((c) => c.clase === clase)
    return { clase, etiqueta: ETIQUETA_CLASE[clase], nombre: suyos.length ? suyos.map((c) => c.nombre).join(', ') : null, repetido: suyos.length > 1 }
  })
}

/** Al soltar más ficheros: el mismo nombre sustituye al de antes; los demás se suman. */
export function juntarFicheros<T extends { nombre: string }>(antes: T[], nuevos: T[]): T[] {
  const nombres = new Set(nuevos.map((f) => f.nombre))
  return [...antes.filter((f) => !nombres.has(f.nombre)), ...nuevos]
}

export { NOMBRE_CLASE }

// ── Cifras ───────────────────────────────────────────────────────────────────

const c = (x: number) => Math.round(x * 100)
const e = (cent: number) => cent / 100
const sumar = (xs: number[]) => xs.reduce((a, b) => a + c(b), 0)
const lista = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

/** «1.100,00»: el importe con sus miles y sus céntimos, sin el «€» (las columnas de cifras de las maquetas). */
export const cifra = (x: number) => eurosExactos(x).replace(/\s*€$/, '')

/** «2026-11-12» → «12/11». */
export const diaCorto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** «UberEats» → «Uber Eats»; «--» o vacío → «el local». Como lo escribe Revo, solo más legible. */
export function nombreCanal(canal: string | null): string {
  if (!canal || canal === '--' || canal === 'local') return 'el local'
  return canal.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
}

// ── Las cuentas de las formas de pago (conta_tpv_formas) ─────────────────────

export interface FormaCuenta {
  forma: string
  /** Solo en Deliverect: la plataforma de la orden. */
  canal: string | null
  cuenta_id: string | null
  cuenta: string | null
  nombre: string | null
  en_mes: number
  dias_sin_validar: number
  nueva: boolean
}

export const esDeliverect = (forma: string) => forma.trim().toLowerCase() === 'deliverect'
const mismaForma = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** La cuenta de una forma (con su plataforma si es Deliverect), como la busca la propuesta. */
export function cuentaDe(cuentas: FormaCuenta[], forma: string, canal: string | null): FormaCuenta | null {
  return cuentas.find((k) => k.cuenta_id && mismaForma(k.forma, forma) && (k.canal ?? null) === (esDeliverect(forma) ? canal : null)) ?? null
}

// ── Un día leído, por dentro ─────────────────────────────────────────────────

export interface CobroDelDia {
  forma: string
  canal: string | null
  /** «Glovo» en vez de «Deliverect · Glovo»: Deliverect solo junta los pedidos. */
  etiqueta: string
  porDeliverect: boolean
  importe: number
  sinCuenta: boolean
}

export interface PorDentro {
  facturas: number
  primero: number | null
  ultimo: number | null
  base: number
  ivaPorTipo: { tipo: number; base: number; cuota: number }[]
  total: number
  cobros: CobroDelDia[]
  cobrado: number
  conNif: number
  devoluciones: { n: number; total: number }
}

const canalDeOrden = (l: LecturaDia) => {
  const m = new Map<string, string>()
  for (const d of l.documentos) if (!m.has(d.orden)) m.set(d.orden, d.canal === '' ? 'local' : d.canal)
  return m
}

export function porDentro(l: LecturaDia, cuentas: FormaCuenta[]): PorDentro {
  const nums = l.documentos.map((d) => d.numero)
  const tipos = new Map<number, { b: number; q: number }>()
  for (const i of l.impuestos) { const t = tipos.get(i.tipo) ?? { b: 0, q: 0 }; t.b += c(i.base); t.q += c(i.cuota); tipos.set(i.tipo, t) }
  const canal = canalDeOrden(l)
  const cobros = new Map<string, CobroDelDia & { cent: number }>()
  for (const x of l.cobros) {
    const dlv = esDeliverect(x.forma)
    const ca = dlv ? (canal.get(x.orden) ?? 'local') : null
    const k = `${x.forma.toLowerCase()}|${ca ?? ''}`
    const v = cobros.get(k) ?? { forma: x.forma, canal: ca, etiqueta: dlv ? nombreCanal(ca) : x.forma, porDeliverect: dlv, importe: 0, sinCuenta: !cuentaDe(cuentas, x.forma, ca), cent: 0 }
    v.cent += c(x.importe)
    cobros.set(k, v)
  }
  // Como en la maqueta: lo del local primero (efectivo, tarjeta…), después las plataformas, y lo nuevo al final.
  const orden = (x: CobroDelDia) => (x.sinCuenta ? 2 : x.porDeliverect ? 1 : 0)
  const lista = [...cobros.values()].map(({ cent, ...v }) => ({ ...v, importe: e(cent) }))
    .sort((a, b) => orden(a) - orden(b) || a.etiqueta.localeCompare(b.etiqueta, 'es'))
  const dev = l.documentos.filter((d) => d.total < 0)
  return {
    facturas: l.documentos.length,
    primero: nums.length ? Math.min(...nums) : null, ultimo: nums.length ? Math.max(...nums) : null,
    base: e(sumar(l.documentos.map((d) => d.base))),
    ivaPorTipo: [...tipos].sort(([a], [b]) => a - b).map(([tipo, t]) => ({ tipo, base: e(t.b), cuota: e(t.q) })),
    total: e(sumar(l.documentos.map((d) => d.total))),
    cobros: lista, cobrado: e(sumar(l.cobros.map((x) => x.importe))),
    conNif: l.documentos.filter((d) => d.nif).length,
    devoluciones: { n: dev.length, total: e(sumar(dev.map((d) => d.total))) },
  }
}

// ── ¿Cuadra? ─────────────────────────────────────────────────────────────────

const ordenesQue = (ordenes: string[]) => {
  const xs = ordenes.slice(0, 3)
  const mas = ordenes.length > 3 ? ` (y ${ordenes.length - 3} más)` : ''
  return xs.length === 1 ? `Mira la orden ${xs[0]}.` : `Mira las órdenes ${lista(xs)}${mas}.`
}

/** Por qué no cuadra un día, con sus cifras y la orden que hay que mirar. Vacío si cuadra. */
export function porQueNoCuadra(l: LecturaDia): string[] {
  const out: string[] = []
  const docs = l.documentos
  // Pagos contra facturas.
  const cFacturas = sumar(docs.map((d) => d.total))
  const cPagos = sumar(l.cobros.map((x) => x.importe))
  if (cPagos !== cFacturas) {
    const porOrden = new Map<string, number>()
    for (const d of docs) porOrden.set(d.orden, (porOrden.get(d.orden) ?? 0) - c(d.total))
    for (const x of l.cobros) porOrden.set(x.orden, (porOrden.get(x.orden) ?? 0) + c(x.importe))
    const malas = [...porOrden].filter(([, v]) => v !== 0).map(([o]) => o).sort()
    const dif = Math.abs(cPagos - cFacturas)
    out.push(`Los pagos suman ${eurosExactos(e(cPagos))} y las facturas ${eurosExactos(e(cFacturas))}. ${cPagos < cFacturas ? 'Faltan' : 'Sobran'} ${eurosExactos(e(dif))}.${malas.length ? ` ${ordenesQue(malas)}` : ''}`)
  }
  // IVA desglosado contra el de las facturas.
  const cIvaFact = sumar(docs.map((d) => d.cuota))
  const cIva = sumar(l.impuestos.map((i) => i.cuota))
  if (cIva !== cIvaFact) {
    const porOrden = new Map<string, number>()
    for (const d of docs) porOrden.set(d.orden, (porOrden.get(d.orden) ?? 0) - c(d.cuota))
    for (const i of l.impuestos) porOrden.set(i.orden, (porOrden.get(i.orden) ?? 0) + c(i.cuota))
    const malas = [...porOrden].filter(([, v]) => v !== 0).map(([o]) => o).sort()
    out.push(`El IVA desglosado suma ${eurosExactos(e(cIva))} y el de las facturas ${eurosExactos(e(cIvaFact))}.${malas.length ? ` ${ordenesQue(malas)}` : ''}`)
  }
  // Base + IVA = total, factura a factura.
  const descuadradas = docs.filter((d) => c(d.base) + c(d.cuota) !== c(d.total)).map((d) => String(d.numero))
  if (descuadradas.length) out.push(`${descuadradas.length === 1 ? `En la factura ${descuadradas[0]}` : `En las facturas ${lista(descuadradas)}`} la base y el IVA no dan el total.`)
  // Numeración: repetidas y huecos, por contador.
  for (const [contador, ns] of agrupar(docs.map((d) => [d.contador, d.numero] as const))) {
    const vistos = new Set<number>(); const rep = new Set<number>()
    for (const n of ns) (vistos.has(n) ? rep : vistos).add(n)
    if (rep.size) out.push(`${rep.size === 1 ? `La factura ${[...rep][0]} está dos veces` : `Las facturas ${lista([...rep].sort((a, b) => a - b).map(String))} están dos veces`}${contador ? ` (contador ${contador})` : ''}.`)
    const xs = [...vistos].sort((a, b) => a - b)
    const huecos: [number, number][] = []
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1] + 1) huecos.push([xs[i - 1] + 1, xs[i] - 1])
    const sueltas = huecos.reduce((a, [x, y]) => a + y - x + 1, 0)
    if (sueltas === 1) out.push(`Falta la factura ${huecos[0][0]} en la numeración.`)
    else if (sueltas > 1) out.push(`Faltan las facturas ${lista(huecos.map(([x, y]) => (x === y ? String(x) : `${x} a ${y}`)))} en la numeración.`)
  }
  return out
}

function agrupar<K, V>(xs: readonly (readonly [K, V])[]): Map<K, V[]> {
  const m = new Map<K, V[]>()
  for (const [k, v] of xs) { const a = m.get(k) ?? []; a.push(v); m.set(k, a) }
  return m
}

// ── El estado de cada día ────────────────────────────────────────────────────

/** Lo guardado de un día, como lo da conta_tpv_dias. */
export interface DiaYaGuardado {
  dia: string
  facturas: number
  primero: number | null
  ultimo: number | null
  total: number
  estado: 'por_validar' | 'en_espera' | 'validado' | string
  subido_en?: string | null
}

export type ComoEsta = 'cuadra' | 'no_cuadra' | 'igual' | 'distinto' | 'validado_distinto'

export const ETIQUETA_COMO_ESTA: Record<ComoEsta, { texto: string; tono: 'bien' | 'mal' | 'neutro' | 'duda' }> = {
  cuadra: { texto: 'Cuadra', tono: 'bien' },
  no_cuadra: { texto: 'No cuadra', tono: 'mal' },
  igual: { texto: 'Ya estaba, igual', tono: 'neutro' },
  distinto: { texto: 'Ya estaba, distinto', tono: 'duda' },
  validado_distinto: { texto: 'Ya validado, distinto', tono: 'mal' },
}

export interface DiaParaSubir {
  dia: string
  como: ComoEsta
  /** Se guarda al pulsar «Guardar»: los que cuadran y los distintos sin validar. */
  seGuarda: boolean
  facturas: number
  primero: number | null
  ultimo: number | null
  total: number
  dentro: PorDentro
  /** El aviso de la caja de abajo: por qué no cuadra, o qué pasa con lo que ya estaba. */
  aviso: { titulo: string; frases: string[]; queHacer: string | null } | null
  /** Las comprobaciones en verde (o en ámbar la del día anterior, que avisa y no para). */
  comprobaciones: { texto: string; ok: boolean }[]
  lectura: LecturaDia
}

const facturasTexto = (n: number) => `${n} factura${n === 1 ? '' : 's'}`

export function prepararDias(dias: DiaLeido[], guardados: DiaYaGuardado[], cuentas: FormaCuenta[]): DiaParaSubir[] {
  const leidos = [...dias].sort((a, b) => a.dia.localeCompare(b.dia))
  return leidos.map((d) => {
    const dentro = porDentro(d.lectura, cuentas)
    const fallos = [...(d.leido ? [] : d.problemas), ...porQueNoCuadra(d.lectura)]
    const g = guardados.find((x) => x.dia === d.dia)
    const dm = diaCorto(d.dia)
    const igual = !!g && g.facturas === dentro.facturas && g.primero === dentro.primero && g.ultimo === dentro.ultimo && c(g.total) === c(dentro.total)
    let como: ComoEsta
    let aviso: DiaParaSubir['aviso'] = null
    if (fallos.length) {
      como = 'no_cuadra'
      aviso = { titulo: `El ${dm} no se guarda.`, frases: fallos, queHacer: 'Vuelve a sacar de Revo los cuatro ficheros de ese día y súbelos otra vez. Los demás días se guardan igual.' }
    } else if (g && igual) {
      como = 'igual'
    } else if (g && g.estado === 'validado') {
      como = 'validado_distinto'
      aviso = {
        titulo: `El ${dm} ya está validado: no se cambia.`,
        frases: [`Tiene ${facturasTexto(g.facturas)} y ${eurosExactos(g.total)}, y lo leído trae ${facturasTexto(dentro.facturas)} y ${eurosExactos(dentro.total)}.`],
        queHacer: 'Si hay que corregir algo, se hace desde su asiento.',
      }
    } else if (g) {
      como = 'distinto'
      aviso = {
        titulo: `El ${dm} ya estaba guardado, con otras cifras.`,
        frases: [`Tenía ${facturasTexto(g.facturas)} y ${eurosExactos(g.total)}; lo leído trae ${facturasTexto(dentro.facturas)} y ${eurosExactos(dentro.total)}.`],
        queHacer: 'Al guardar, se sustituye por lo leído. Todavía no está validado, así que no se toca ningún asiento.',
      }
    } else como = 'cuadra'

    // ¿Sigue a la última factura del día anterior? (el leído o el guardado más cercano por detrás)
    const antes = [...leidos.filter((x) => x.dia < d.dia).map((x) => ({ dia: x.dia, ultimo: porDentro(x.lectura, []).ultimo })),
      ...guardados.filter((x) => x.dia < d.dia).map((x) => ({ dia: x.dia, ultimo: x.ultimo }))]
      .sort((a, b) => b.dia.localeCompare(a.dia))[0]
    const comprobaciones: DiaParaSubir['comprobaciones'] = []
    if (como !== 'no_cuadra') {
      comprobaciones.push({ texto: 'Facturas, IVA y pagos dan lo mismo', ok: true }, { texto: 'No hay saltos de numeración', ok: true })
      if (antes?.ultimo != null && dentro.primero != null) {
        const p = dentro.primero, u = antes.ultimo
        comprobaciones.push(p === u + 1
          ? { texto: `Sigue a la última factura del día anterior (${u})`, ok: true }
          : { texto: p === u + 2 ? `Entre el ${diaCorto(antes.dia)} y el ${dm} falta la factura ${u + 1}, o falta por subir un día.`
              : p > u + 2 ? `Entre el ${diaCorto(antes.dia)} y el ${dm} faltan las facturas ${u + 1} a ${p - 1}, o falta por subir un día.`
              : `La primera factura del ${dm} (${p}) no va detrás de la última del ${diaCorto(antes.dia)} (${u}).`, ok: false })
      }
    }
    return {
      dia: d.dia, como, seGuarda: como === 'cuadra' || como === 'distinto',
      facturas: dentro.facturas, primero: dentro.primero, ultimo: dentro.ultimo, total: dentro.total,
      dentro, aviso, comprobaciones, lectura: d.lectura,
    }
  })
}

export const numeracion = (primero: number | null, ultimo: number | null) =>
  primero == null ? '—' : primero === ultimo ? String(primero) : `${primero} a ${ultimo}`

// ── Lo que dice el paso 3 ────────────────────────────────────────────────────

export interface ResultadoDia { dia: string; ok: boolean; facturas: number; total: number; error?: string }

/** «Guardados 2 días, del 12/11 al 13/11: 119 facturas, 2.750,00 €. El 14/11 no se ha guardado.» */
export function textoGuardado(r: ResultadoDia[], sinTocar: string[] = []): string {
  const bien = r.filter((x) => x.ok).sort((a, b) => a.dia.localeCompare(b.dia))
  const mal = r.filter((x) => !x.ok).sort((a, b) => a.dia.localeCompare(b.dia))
  const partes: string[] = []
  if (bien.length) {
    const fac = bien.reduce((a, x) => a + x.facturas, 0)
    const tot = e(sumar(bien.map((x) => x.total)))
    const cuando = bien.length === 1 ? `el ${diaCorto(bien[0].dia)}` : `del ${diaCorto(bien[0].dia)} al ${diaCorto(bien[bien.length - 1].dia)}`
    partes.push(`${bien.length === 1 ? 'Guardado 1 día' : `Guardados ${bien.length} días`}, ${cuando}: ${facturasTexto(fac)}, ${eurosExactos(tot)}.`)
  } else partes.push('No se ha guardado ningún día.')
  for (const x of mal) partes.push(`El ${diaCorto(x.dia)} no se ha guardado${x.error ? `: ${x.error.replace(/\.$/, '')}` : ''}.`)
  if (sinTocar.length) partes.push(`${sinTocar.length === 1 ? `El ${diaCorto(sinTocar[0])} ya estaba` : `Los días ${lista(sinTocar.map(diaCorto))} ya estaban`} igual: no se ha${sinTocar.length === 1 ? '' : 'n'} tocado.`)
  return partes.join(' ')
}

// ── Lo que dice la lista ─────────────────────────────────────────────────────

const masDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diaMadrid = (ts: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ts))
const cuando = (dia: string, hoy: string) => (dia === hoy ? 'hoy' : dia === masDias(hoy, -1) ? 'ayer' : `el ${diaCorto(dia)}`)

/** «Última subida: ayer, hasta el 11/11». Null si no se ha subido nada. */
export function ultimaSubida(g: Pick<DiaYaGuardado, 'dia' | 'subido_en'>[], hoy: string): string | null {
  if (!g.length) return null
  const subida = g.map((x) => x.subido_en).filter((x): x is string => !!x).sort().pop()
  const hasta = g.map((x) => x.dia).sort().pop()!
  return `Última subida: ${subida ? `${cuando(diaMadrid(subida), hoy)}, ` : ''}hasta el ${diaCorto(hasta)}`
}

/** «del 12/11 a ayer», «ayer», o null si está al día (o no hay nada subido). */
export function faltaPorSubir(g: Pick<DiaYaGuardado, 'dia'>[], hoy: string): string | null {
  if (!g.length) return null
  const hasta = g.map((x) => x.dia).sort().pop()!
  const ayer = masDias(hoy, -1)
  const desde = masDias(hasta, 1)
  if (desde > ayer) return null
  return desde === ayer ? 'ayer' : `del ${diaCorto(desde)} a ayer`
}

// ── «A qué cuenta va cada forma de pago» ─────────────────────────────────────

/** El aviso de arriba: la forma (o las formas) sin cuenta. Null si no falta ninguna. */
export function avisoFormasNuevas(formas: Pick<FormaCuenta, 'forma' | 'canal'>[]): string | null {
  if (!formas.length) return null
  const nombres = formas.map((f) => (f.canal ? `${f.forma} (pedidos de ${nombreCanal(f.canal)})` : f.forma))
  return formas.length === 1
    ? `Hay una forma de pago nueva: ${nombres[0]}.`
    : `Hay ${formas.length} formas de pago nuevas: ${lista(nombres)}.`
}

/** «Falta 1 cuenta por elegir.» / «Faltan 2 cuentas por elegir.» / null. */
export function faltanCuentas(n: number): string | null {
  return n <= 0 ? null : n === 1 ? 'Falta 1 cuenta por elegir.' : `Faltan ${n} cuentas por elegir.`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «2026-11-01» → «En noviembre». */
export const enElMes = (mes: string) => `En ${MESES[Number(mes.slice(5, 7)) - 1] ?? 'el mes'}`
