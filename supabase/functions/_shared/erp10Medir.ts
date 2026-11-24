// supabase/functions/_shared/erp10Medir.ts
//
// X11 (20/11) · TRAER DE ERP10 POR LA CONEXIÓN, FASE 1: MEDIR Y PARAR. Lo que da la
// API de ERP10 (apiCON) de cada cosa que hoy trae «Traer de ERP10» por fichero (N07):
// el plan y las subcuentas, los terceros, los asientos de un ejercicio, las facturas,
// el inmovilizado y los saldos de apertura. Para cada una, la ruta, lo que contesta,
// cuántos hay, cómo pagina, qué campos trae (y cuántos con valor) y cuánto tarda.
//
// SOLO LEE: cada llamada es un GET por el cliente de erp10Cliente.ts, que ya para
// cualquier otra cosa (sin `escribir`, ni las rutas de alta), y entra con la lista
// cerrada y el NIF comprobado. No escribe nada en Sumied.
//
// Y SOLO CUENTA (T11, el resumen se pega en un PR público): nombres de campo,
// recuentos, códigos de serie y de tipo, prefijos de cuenta de dos cifras y tiempos.
// Ni un nombre, ni un NIF, ni una dirección, ni un importe, ni un concepto.
//
// Una empresa grande no cabe entera en una llamada de la función: de lo que pagina
// se leen como mucho `maxPaginas` páginas y el resto se calcula con el total que da
// ERP10 (ResultadosTotales) y el tiempo medio medido por página. Se dice cuál es cuál.
//
// Lo prueba tests/conta/erp10/medir.test.ts, contra un ERP10 simulado.

export const POR_PAGINA = 200

/** Lo que necesita la medida: un GET que contesta (el de ClienteErp10) y un reloj. */
export interface PuertoMedir {
  get(ruta: string): Promise<{ status: number; json: unknown; txt?: string }>
  ahora(): number
}

export type Campo = { campo: string; conValor: number }
export type Recuento = Record<string, number>

export interface Medido {
  /** Qué es, con el nombre de «Traer» («Plan de cuentas», «Diario»…). */
  que: string
  ruta: string
  status: number
  /** Lo que dice ERP10 si no contesta 200 (recortado, sin datos). */
  motivo: string | null
  /** ResultadosTotales de ERP10, o lo leído si no lo dice. */
  total: number | null
  /** Lo que ERP10 dice que mete por página (ElementosPorPagina). */
  porPagina: number | null
  /** Las páginas que hacen falta para todo (total / página), y las leídas. */
  paginas: number | null
  leidas: number
  leidos: number
  /** El tiempo medio de una página (o de la única llamada), en ms. */
  msPorPagina: number | null
  /** Lo que tardaría todo: medido si se ha leído entero; si no, calculado. */
  msTodo: number | null
  calculado: boolean
  campos: Campo[]
  recuentos: Record<string, Recuento>
}

export interface Medida {
  ejercicio: string
  empresa: { tipoContabilidad: number | null; digitosPlan: number | null; campos: string[] }
  medidos: Medido[]
  peticiones: number
  ms: number
  /** Si se paró antes por tiempo (la función tiene un límite). */
  cortada: boolean
  /** Lo que tardaría una empresa con 2.000 clientes y 2.000 proveedores. */
  grande: Grande
}

export interface Grande {
  terceros: number
  /** Terceros como subcuentas (las páginas del listado). */
  listado: { peticiones: number; ms: number | null }
  /** Si la ficha (IVA, forma de pago) solo está en la subcuenta suelta: una por tercero. */
  unaAUna: { peticiones: number; ms: number | null }
}

const recorte = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 160)
const tieneValor = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== false && !(Array.isArray(v) && v.length === 0)
const sumar = (r: Recuento, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n }
const datosDe = (j: unknown): unknown[] | null => Array.isArray(j) ? j : Array.isArray((j as { Datos?: unknown })?.Datos) ? (j as { Datos: unknown[] }).Datos : null
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')

/** Los campos de unas filas, con cuántas traen valor (solo el nombre del campo sale de aquí). */
export function camposDe(filas: readonly unknown[]): Campo[] {
  const m = new Map<string, number>()
  for (const f of filas) {
    if (!f || typeof f !== 'object') continue
    for (const [k, v] of Object.entries(f)) m.set(k, (m.get(k) ?? 0) + (tieneValor(v) ? 1 : 0))
  }
  return [...m].map(([campo, conValor]) => ({ campo, conValor }))
}

/** El prefijo de dos cifras de una cuenta (sin nada más). */
export const prefijo = (c: unknown) => String(c ?? '').replace(/\D/g, '').slice(0, 2)

type Barrido = Omit<Medido, 'que' | 'recuentos'> & { filas: unknown[] }

/** Un listado paginado ($top, $skip por página, como en Diez): como mucho `max` páginas. */
async function barrer(p: PuertoMedir, ruta: string, max: number, limite: () => boolean): Promise<Barrido> {
  const sep = ruta.includes('?') ? '&' : '?'
  const filas: unknown[] = []
  const vistas = new Set<string>()
  let total: number | null = null, porPagina: number | null = null, status = 0, motivo: string | null = null
  let leidas = 0, ms = 0, entero = false
  for (let pag = 0; pag < max; pag++) {
    if (pag > 0 && limite()) break
    const t0 = p.ahora()
    const r = await p.get(`${ruta}${sep}${q({ $top: POR_PAGINA, $skip: pag })}`)
    ms += p.ahora() - t0
    status = r.status
    if (r.status !== 200) { motivo = recorte(typeof r.json === 'string' ? r.json : (r.json as { Message?: unknown; error?: unknown })?.Message ?? (r.json as { error?: unknown })?.error ?? r.txt); break }
    const d = datosDe(r.json)
    if (!d) { motivo = 'forma inesperada (ni lista ni Datos)'; break }
    leidas++
    const j = r.json as { ResultadosTotales?: unknown; ElementosPorPagina?: unknown }
    total = num(j.ResultadosTotales) ?? total
    porPagina = num(j.ElementosPorPagina) ?? porPagina
    if (d.length === 0) { entero = true; break }
    const primero = JSON.stringify(d[0])
    if (vistas.has(primero)) { entero = true; break } // ERP10 repite la primera al pasarse del final
    vistas.add(primero)
    filas.push(...d)
    if (total != null ? filas.length >= total : d.length < POR_PAGINA) { entero = true; break }
  }
  const tam = porPagina && porPagina > 0 ? porPagina : POR_PAGINA
  const totalFinal = total ?? (entero ? filas.length : null)
  const paginas = totalFinal == null ? null : Math.max(1, Math.ceil(totalFinal / tam))
  const msPorPagina = leidas ? Math.round(ms / leidas) : null
  const msTodo = entero ? ms : paginas != null && msPorPagina != null ? paginas * msPorPagina : null
  return {
    ruta, status, motivo, total: totalFinal, porPagina, paginas, leidas, leidos: filas.length,
    msPorPagina, msTodo, calculado: !entero && msTodo != null, campos: camposDe(filas), filas,
  }
}

/** Una sola llamada (lo que no pagina, o la primera página para ver si existe). */
async function una(p: PuertoMedir, ruta: string): Promise<Barrido & { json: unknown }> {
  const t0 = p.ahora()
  const r = await p.get(ruta)
  const ms = p.ahora() - t0
  const d = r.status === 200 ? datosDe(r.json) : null
  const filas = d ?? (r.status === 200 && r.json && typeof r.json === 'object' ? [r.json] : [])
  const j = (r.json ?? {}) as { ResultadosTotales?: unknown; ElementosPorPagina?: unknown; Message?: unknown }
  return {
    ruta: ruta.split('?')[0], status: r.status,
    motivo: r.status === 200 ? null : recorte(typeof r.json === 'string' ? r.json : j.Message ?? r.txt),
    total: r.status === 200 ? num(j.ResultadosTotales) ?? (d ? d.length : null) : null,
    porPagina: num(j.ElementosPorPagina), paginas: null, leidas: r.status === 200 ? 1 : 0, leidos: filas.length,
    msPorPagina: ms, msTodo: ms, calculado: false, campos: camposDe(filas), filas, json: r.json,
  }
}

const medido = (que: string, b: Barrido, recuentos: Record<string, Recuento> = {}): Medido => {
  const { filas: _f, ...resto } = b
  void _f
  return { que, ...resto, ruta: b.ruta.split('?')[0], recuentos }
}

export interface OpcionesMedir {
  /** El ejercicio (AAAA) de los asientos y las facturas. */
  ejercicio: string
  /** El código de la empresa en ERP10 (el de la lista cerrada): lo pide la ruta del inmovilizado. */
  codEmpresa: string
  /** Páginas como mucho de cada listado grande (asientos, facturas). */
  maxPaginas?: number
  /** Páginas como mucho de las subcuentas (son rápidas). */
  maxPaginasSubcuentas?: number
  /** Ms de reloj a partir de los cuales no se piden más páginas. */
  presupuestoMs?: number
  /** Los terceros de «una empresa grande» (2.000 clientes y 2.000 proveedores). */
  terceros?: number
}

/** Lo que dice el campo `TipoAsiento` (0…5) y la serie de cada asiento. */
function recuentosDeAsientos(filas: readonly unknown[]): Record<string, Recuento> {
  const tipo: Recuento = {}, serie: Recuento = {}, lineas: Recuento = {}, otros: Recuento = {}
  for (const a of filas as { TipoAsiento?: unknown; Serie?: unknown; Detalles?: unknown; DetallesAnalitica?: unknown }[]) {
    const t = String(a.TipoAsiento ?? '—')
    sumar(tipo, t)
    sumar(serie, String(a.Serie ?? '—'))
    const n = Array.isArray(a.Detalles) ? a.Detalles.length : 0
    sumar(lineas, `tipo ${t}`, n)
    if (Array.isArray(a.DetallesAnalitica) && a.DetallesAnalitica.length) sumar(otros, 'con analítica')
    if (Array.isArray(a.Detalles) && a.Detalles.some((l) => tieneValor((l as { Contrapartida?: unknown }).Contrapartida))) sumar(otros, 'con contrapartida')
    if (Array.isArray(a.Detalles) && a.Detalles.some((l) => tieneValor((l as { PunteoBancario?: unknown }).PunteoBancario))) sumar(otros, 'con punteo')
  }
  return { 'asientos por TipoAsiento': tipo, 'asientos por serie': serie, 'líneas por TipoAsiento': lineas, otros }
}

/** Facturas: por serie, por TipoFactura, por prefijo de la cuenta del tercero, y los casos que hoy van por el Excel. */
function recuentosDeFacturas(filas: readonly unknown[]): Record<string, Recuento> {
  const serie: Recuento = {}, tipo: Recuento = {}, cuenta: Recuento = {}, casos: Recuento = {}, sii: Recuento = {}
  for (const f of filas as Record<string, unknown>[]) {
    sumar(serie, String(f.Serie ?? '—'))
    sumar(tipo, String(f.TipoFactura ?? '—'))
    sumar(cuenta, prefijo(f.CuentaCliente) || '—')
    sumar(sii, String(f.ClaveRegimenIva1 || '—'))
    const tipos = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => tieneValor(f[`BaseImponible${i}`]) || tieneValor(f[`CuotaIVA${i}`])).length
    sumar(casos, `${tipos} ${tipos === 1 ? 'tipo' : 'tipos'} de IVA`)
    if (tieneValor(f.CuotaRetencion)) sumar(casos, 'con retención')
    if (tieneValor(f.TipoOperacionIntracomunitaria)) sumar(casos, 'intracomunitaria')
    if (tieneValor(f.CuotaRecargo1)) sumar(casos, 'con recargo de equivalencia')
    if (tieneValor(f.TipoRectificativa)) sumar(casos, 'rectificativa')
    if (f.EsFacturaSimplificada === true) sumar(casos, 'simplificada')
    if (Array.isArray(f.Apuntes) && f.Apuntes.length) sumar(casos, 'con sus apuntes')
    if (Array.isArray(f.Detalles) && f.Detalles.length) sumar(casos, 'con sus líneas (Detalles)')
    if (Array.isArray(f.Vencimientos) && f.Vencimientos.length) sumar(casos, 'con vencimientos')
  }
  return { 'por serie': serie, 'por TipoFactura': tipo, 'por cuenta del tercero (2 cifras)': cuenta, 'ClaveRegimenIva1': sii, casos }
}

/** Subcuentas: por grupo (1 cifra), los terceros (40, 41, 43, 44) y qué traen de su ficha. */
function recuentosDeSubcuentas(filas: readonly unknown[]): Record<string, Recuento> {
  const grupo: Recuento = {}, terceros: Recuento = {}, ficha: Recuento = {}, largo: Recuento = {}
  for (const s of filas as Record<string, unknown>[]) {
    const c = String(s.Codigo ?? '').replace(/\D/g, '')
    sumar(grupo, c.slice(0, 1) || '—')
    sumar(largo, `${c.length} cifras`)
    const p = c.slice(0, 2)
    if (!['40', '41', '43', '44'].includes(p)) continue
    sumar(terceros, p)
    if (tieneValor(s.NIF)) sumar(ficha, `${p} con NIF`)
    if (tieneValor(s.DireccionCompleta) || tieneValor(s.DireccionVia)) sumar(ficha, `${p} con dirección`)
    if (tieneValor(s.Pais)) sumar(ficha, `${p} con país`)
    if (tieneValor(s.TipoIva1)) sumar(ficha, `${p} con tipo de IVA`)
    if (tieneValor(s.TipoVencimiento)) sumar(ficha, `${p} con forma de pago`)
    if (tieneValor(s.SubCuentaGastoIngreso)) sumar(ficha, `${p} con cuenta de gasto o ingreso`)
  }
  return { 'por grupo': grupo, 'por largo': largo, 'terceros (40 proveedores, 41 acreedores, 43 clientes, 44 deudores)': terceros, 'de su ficha': ficha }
}

/** Los campos de la ficha completa (SubCuentaCompleta) que no están en el listado (Subcuenta). */
export const DE_LA_FICHA = ['TipoIva1', 'TipoIva2', 'TipoIva3', 'TipoFactura', 'TipoVencimiento', 'IBAN', 'SubCuentaGastoIngreso', 'CobroPagoDirecto', 'CuentaCobroPago'] as const

/**
 * Mide, leyendo, lo que da la API de cada cosa que hoy trae «Traer de ERP10». No
 * devuelve datos: solo lo que se puede pegar en un PR público.
 */
export async function medirParaTraer(p: PuertoMedir, o: OpcionesMedir): Promise<Medida> {
  const inicio = p.ahora()
  const max = o.maxPaginas ?? 3
  const maxSub = o.maxPaginasSubcuentas ?? 40
  const presupuesto = o.presupuestoMs ?? 110_000
  let cortada = false
  const limite = () => { if (p.ahora() - inicio > presupuesto) cortada = true; return cortada }
  const ej = o.ejercicio
  const medidos: Medido[] = []
  let peticiones = 0
  // Una ruta que falla (un 500 de «no es para sociedades», un corte) se apunta con su motivo y se sigue con la siguiente.
  const P: PuertoMedir = {
    get: async (r) => {
      peticiones++
      try { return await p.get(r) } catch (e) { return { status: 0, json: recorte(e instanceof Error ? e.message : e) } }
    },
    ahora: () => p.ahora(),
  }

  // La empresa abierta: solo su forma (el NIF ya lo ha comprobado el cliente; aquí no sale).
  const par = await una(P, '/api/parametros')
  const pj = (par.json ?? {}) as Record<string, unknown>
  const empresa = { tipoContabilidad: num(pj.TipoContabilidad), digitosPlan: num(pj.DigitosPlanContable), campos: Object.keys(pj) }

  // 1. El plan y las subcuentas (y en una sociedad, los terceros: son subcuentas 40, 41, 43 y 44).
  const sub = await barrer(P, '/api/subcuentas', maxSub, limite)
  medidos.push(medido('Plan de cuentas y subcuentas', sub, recuentosDeSubcuentas(sub.filas)))

  // La ficha de un tercero suelta: ¿trae el IVA y la forma de pago (SubCuentaCompleta) o solo lo del listado?
  const tercero = (sub.filas as Record<string, unknown>[]).find((s) => ['40', '41', '43'].includes(prefijo(s.Codigo)) && tieneValor(s.NIF))
    ?? (sub.filas as Record<string, unknown>[]).find((s) => ['40', '41', '43'].includes(prefijo(s.Codigo)))
  let suelta: Medido | null = null
  if (tercero && !limite()) {
    const u = await una(P, `/api/subcuentas/subcuenta/${encodeURIComponent(String(tercero.Codigo))}`)
    const claves = new Set(u.campos.map((c) => c.campo))
    suelta = medido('Un tercero suelto (su ficha)', u, { 'campos de la ficha completa que trae': Object.fromEntries(DE_LA_FICHA.map((k) => [k, claves.has(k) ? 1 : 0])) })
    medidos.push(suelta)
  }

  // 2. Clientes y proveedores: en una sociedad no existen (Diez, C04b); se mira la primera página.
  for (const [que, ruta] of [['Clientes', '/api/clientes'], ['Proveedores y acreedores', '/api/proveedores']] as const) {
    if (limite()) break
    const u = await una(P, `${ruta}?${q({ $top: POR_PAGINA, $skip: 0 })}`)
    medidos.push(medido(que, u))
  }

  // 3. Los asientos del ejercicio, con su tipo (y lo que ERP10 resume por tipo).
  if (!limite()) {
    const a = await barrer(P, `/api/apuntes?${q({ $filter: `Ejercicio eq '${ej}'` })}`, max, limite)
    medidos.push(medido(`Diario (asientos de ${ej})`, a, recuentosDeAsientos(a.filas)))
  }
  if (!limite()) {
    const r = await una(P, `/api/apuntes/resumen?${q({ fechaInicio: `${ej}0101`, fechaFinal: `${ej}1231` })}`)
    const tipos: Recuento = {}
    for (const x of r.filas as { TipoIntroduccion?: unknown; DescripcionTipoIntroduccion?: unknown; Numero?: unknown }[]) {
      sumar(tipos, `${String(x.TipoIntroduccion ?? '—')} ${String(x.DescripcionTipoIntroduccion ?? '').slice(0, 40)}`.trim(), Number(x.Numero) || 0)
    }
    medidos.push(medido(`Resumen de ERP10 (${ej})`, r, { 'líneas por tipo de introducción': tipos }))
  }

  // 4. Las facturas del ejercicio, con sus libros de IVA.
  if (!limite()) {
    const f = await barrer(P, `/api/facturas?${q({ $filter: `Ejercicio eq '${ej}'` })}`, max, limite)
    medidos.push(medido(`Facturas (${ej})`, f, recuentosDeFacturas(f.filas)))
  }

  // 5. El inmovilizado: la única ruta es la de Estimaciones (autónomos); se mira si contesta.
  if (!limite()) {
    const u = await una(P, `/api/facturasestimaciones/inmovilizados/${encodeURIComponent(o.codEmpresa.replace(/\D/g, '') || '0')}`)
    medidos.push(medido('Inmovilizado', u))
  }

  // 6. Los saldos de apertura: getSumasYsaldos (en Diez da líneas, no saldos) y el asiento de apertura del diario.
  if (!limite()) {
    const u = await una(P, `/api/subcuentas/getSumasYsaldos/${ej}/${ej}0101/${ej}0131?${q({ $top: POR_PAGINA, $skip: 0 })}`)
    medidos.push(medido(`Sumas y saldos (enero de ${ej})`, u))
  }

  // Lo de alrededor: las series y los vencimientos (la forma de pago de cada factura).
  for (const [que, ruta] of [['Series', '/api/series'], ['Vencimientos', '/api/vencimientos']] as const) {
    if (limite()) break
    const u = await una(P, `${ruta}?${q({ $top: POR_PAGINA, $skip: 0 })}`)
    const rec: Record<string, Recuento> = {}
    if (que === 'Series') rec['códigos'] = Object.fromEntries((u.filas as { Codigo?: unknown }[]).map((s) => [String(s.Codigo ?? '—').slice(0, 5), 1]))
    medidos.push(medido(que, u, rec))
  }

  return { ejercicio: ej, empresa, medidos, peticiones, ms: p.ahora() - inicio, cortada, grande: empresaGrande(sub, suelta, o.terceros ?? 4000) }
}

/** Lo que tardaría una empresa con `terceros` terceros (2.000 + 2.000), con lo medido. */
export function empresaGrande(sub: Pick<Medido, 'porPagina' | 'msPorPagina'>, suelta: Pick<Medido, 'msPorPagina'> | null, terceros: number): Grande {
  const tam = sub.porPagina && sub.porPagina > 0 ? sub.porPagina : POR_PAGINA
  const pags = Math.ceil(terceros / tam)
  return {
    terceros,
    listado: { peticiones: pags, ms: sub.msPorPagina != null ? pags * sub.msPorPagina : null },
    unaAUna: { peticiones: terceros, ms: suelta?.msPorPagina != null ? terceros * suelta.msPorPagina : null },
  }
}

// ── Lo que se pega en el PR (sin datos: recuentos, formas y tiempos) ──────────────
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
// eslint-disable-next-line no-restricted-syntax -- `ms` ya no es null aquí (la primera rama lo atrapa): es un cálculo local.
const seg = (ms: number | null) => ms == null ? '—' : ms < 1000 ? `${ms} ms` : ms < 120_000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : `${(ms / 60_000).toFixed(1).replace('.', ',')} min`
const lista = (r: Recuento) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${miles(v)}`).join(' · ') || '—'

/** La medida en Markdown, para copiar y pegar. */
export function medidaEnTexto(m: Medida): string {
  const l: string[] = [
    `## ERP10 por la conexión · lo que se puede traer (ejercicio ${m.ejercicio})`,
    '',
    `Empresa: TipoContabilidad ${m.empresa.tipoContabilidad ?? '—'} · DigitosPlanContable ${m.empresa.digitosPlan ?? '—'} · ${miles(m.peticiones)} peticiones · ${seg(m.ms)}${m.cortada ? ' · **cortada por tiempo**' : ''}`,
    '',
    '| Qué | Ruta | Contesta | Total | Por página | Páginas (leídas) | Por página, ms | Todo |',
    '|---|---|---|---:|---:|---|---:|---|',
    ...m.medidos.map((x) => `| ${x.que} | \`${x.ruta}\` | ${x.status}${x.motivo ? ` «${x.motivo.replace(/\|/g, '/')}»` : ''} | ${x.total == null ? '—' : miles(x.total)} | ${x.porPagina ?? '—'} | ${x.paginas ?? '—'} (${x.leidas}) | ${x.msPorPagina ?? '—'} | ${seg(x.msTodo)}${x.calculado ? ' (calculado)' : ''} |`),
    '',
  ]
  for (const x of m.medidos) {
    if (!x.campos.length && !Object.keys(x.recuentos).length) continue
    l.push(`### ${x.que}`, '')
    if (x.campos.length) l.push(`Campos (con valor en ${miles(x.leidos)}): ${x.campos.map((c) => `${c.campo} ${miles(c.conValor)}`).join(' · ')}`, '')
    for (const [k, r] of Object.entries(x.recuentos)) l.push(`- ${k}: ${lista(r)}`)
    l.push('')
  }
  const g = m.grande
  l.push(`### Una empresa con ${miles(g.terceros)} terceros`, '',
    `- Como subcuentas, del listado: ${miles(g.listado.peticiones)} peticiones · ${seg(g.listado.ms)}`,
    `- Una a una (si la ficha solo viene en la subcuenta suelta): ${miles(g.unaAUna.peticiones)} peticiones · ${seg(g.unaAUna.ms)}`, '')
  return l.join('\n')
}
