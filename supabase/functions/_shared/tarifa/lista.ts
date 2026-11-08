// supabase/functions/_shared/tarifa/lista.ts
//
// G04 · Tarea 2 (08/11/2026). Lo que decide la lista de «Clientes» sin pintar:
// qué filas salen con la empresa elegida, en qué grupo, con qué filtro, en qué
// orden y con qué cifras de cabecera. Puro.
//
// Reglas (Julio, 08/11):
//   · Cada empresa es una contabilidad: con una empresa elegida salen solo las
//     filas de esa empresa. «Las dos» junta las dos, con la etiqueta de quién
//     factura. Una fila es un cliente con una empresa con la que tiene algo; un
//     cliente con las dos sale dos veces en «Las dos», cada una con lo suyo.
//   · Un cliente sin ninguna empresa sale solo en «Las dos › Otros», con la
//     etiqueta «Sin empresa que le facture» (no en cada empresa por separado).
//   · «Se les cobra»: activos, morosos y sin clasificar. «Otros»: bajas, solo
//     renta y sin situación (y los que no tienen empresa).
//   · Filtros: Todos · Necesitan algo · Devueltos · Te deben · Sin mandato; y el
//     buscador por cliente, NIF o trabajador (sin tildes ni mayúsculas).
//   · Orden por defecto: primero los que necesitan algo; después, por nombre.
//   · Nada se esconde (regla 7): los recuentos son de todas las filas.
//
// Lo prueban tests/unit/modules/conta/gestoria/g04/lista.test.ts.

export type Situacion = 'activo' | 'moroso' | 'sin_clasificar' | 'baja' | 'solo_renta' | null

export interface FilaDeCliente {
  clienteId: string
  /** Null: el cliente no tiene nada con ninguna empresa. */
  empresaId: string | null
  nombre: string
  nif: string | null
  situacion: Situacion
  /** Lo que hay que hacer con él (tareas pendientes de «Lo que tienes que hacer»). */
  pendientes: number
  devuelto: boolean
  debeCent: number
  mandato: 'firmado' | 'por_firmar' | 'sin_mandato' | null
  trabajadores: string[]
}

export type Elegida = { tipo: 'empresa'; empresaId: string } | { tipo: 'las_dos' }
export type Grupo = 'se_cobra' | 'otros'
export type Filtro = 'todos' | 'necesitan_algo' | 'devueltos' | 'te_deben' | 'sin_mandato'

export const SE_COBRA: readonly Situacion[] = ['activo', 'moroso', 'sin_clasificar']
export const SIN_EMPRESA = 'Sin empresa que le facture'

export const grupoDe = (f: FilaDeCliente): Grupo => (f.empresaId !== null && SE_COBRA.includes(f.situacion) ? 'se_cobra' : 'otros')

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const nifLimpio = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase()

/** Las filas que salen con la empresa elegida: una por cliente y empresa, sin repetir. */
export function filasDe(filas: readonly FilaDeCliente[], elegida: Elegida): FilaDeCliente[] {
  const vistas = new Set<string>()
  const conEmpresa = new Set(filas.filter((f) => f.empresaId !== null).map((f) => f.clienteId))
  const out: FilaDeCliente[] = []
  for (const f of filas) {
    if (elegida.tipo === 'empresa' && f.empresaId !== elegida.empresaId) continue
    // Un cliente con alguna empresa nunca sale además «sin empresa».
    if (f.empresaId === null && conEmpresa.has(f.clienteId)) continue
    const k = `${f.clienteId}|${f.empresaId ?? ''}`
    if (vistas.has(k)) continue
    vistas.add(k)
    out.push(f)
  }
  return out
}

export function pasaElFiltro(f: FilaDeCliente, filtro: Filtro): boolean {
  switch (filtro) {
    case 'todos': return true
    case 'necesitan_algo': return f.pendientes > 0
    case 'devueltos': return f.devuelto
    case 'te_deben': return f.debeCent > 0
    case 'sin_mandato': return f.mandato === 'por_firmar' || f.mandato === 'sin_mandato'
  }
}

export function pasaLaBusqueda(f: FilaDeCliente, texto: string): boolean {
  const q = sinTildes(texto.trim())
  if (!q) return true
  const qNif = nifLimpio(q)
  return sinTildes(f.nombre).includes(q)
    || (qNif.length > 0 && f.nif !== null && nifLimpio(f.nif).includes(qNif))
    || f.trabajadores.some((t) => sinTildes(t).includes(q))
}

/** Primero los que necesitan algo; después, por nombre (y, con el mismo nombre, por empresa). */
export function ordenar(filas: readonly FilaDeCliente[]): FilaDeCliente[] {
  return [...filas].sort((a, b) =>
    (Number(b.pendientes > 0) - Number(a.pendientes > 0))
    || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
    || (a.empresaId ?? '').localeCompare(b.empresaId ?? ''))
}

export interface VistaDeLaLista {
  filas: FilaDeCliente[]
  /** Cuántas hay en cada grupo y con cada filtro, con la empresa elegida (antes de buscar). */
  enGrupo: Record<Grupo, number>
  conFiltro: Record<Filtro, number>
  /** Clientes distintos con la empresa elegida (en «Las dos», un cliente con las dos cuenta una vez). */
  clientes: number
}

export function vistaDeLaLista(todas: readonly FilaDeCliente[], elegida: Elegida, grupo: Grupo, filtro: Filtro, busqueda: string): VistaDeLaLista {
  const deLaEmpresa = filasDe(todas, elegida)
  const delGrupo = deLaEmpresa.filter((f) => grupoDe(f) === grupo)
  const filtros: Filtro[] = ['todos', 'necesitan_algo', 'devueltos', 'te_deben', 'sin_mandato']
  return {
    filas: ordenar(delGrupo.filter((f) => pasaElFiltro(f, filtro) && pasaLaBusqueda(f, busqueda))),
    enGrupo: { se_cobra: deLaEmpresa.filter((f) => grupoDe(f) === 'se_cobra').length, otros: deLaEmpresa.filter((f) => grupoDe(f) === 'otros').length },
    conFiltro: Object.fromEntries(filtros.map((x) => [x, delGrupo.filter((f) => pasaElFiltro(f, x)).length])) as Record<Filtro, number>,
    clientes: new Set(deLaEmpresa.map((f) => f.clienteId)).size,
  }
}

// ── Te deben ────────────────────────────────────────────────────────────────

export interface CargoDeGoCardless {
  id: string
  empresaId: string
  clienteId: string | null
  suscripcionId: string | null
  estado: string
  fecha: string // «AAAA-MM-DD»
  importeCent: number
  mandatoActivo: boolean
}

/**
 * Lo que te deben (Julio, 08/11): lo devuelto en GoCardless (fallido o
 * retrocedido) y sin cobrar después, solo de quien tiene el mandato activo.
 * «Sin cobrar después»: ningún cobro pagado de la misma suscripción con fecha
 * posterior. Lo que una persona marcó «Cobrado por otra vía» sale. Lo cobrado
 * fuera de GoCardless sin marcar aún no se ve: lo dice la pantalla.
 */
export function teDeben(cargos: readonly CargoDeGoCardless[], cobradoPorOtraVia: ReadonlySet<string>, hoy: string) {
  const pagado = (c: CargoDeGoCardless) => c.estado === 'paid_out' || c.estado === 'confirmed'
  const deben = cargos.filter((c) => (c.estado === 'failed' || c.estado === 'charged_back') && c.mandatoActivo && !cobradoPorOtraVia.has(c.id)
    && !cargos.some((p) => pagado(p) && p.empresaId === c.empresaId && c.suscripcionId !== null && p.suscripcionId === c.suscripcionId && p.fecha > c.fecha))
  const dias = (f: string) => Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000)
  const masDe60 = deben.filter((c) => dias(c.fecha) > 60)
  return {
    cargos: deben,
    totalCent: deben.reduce((s, c) => s + c.importeCent, 0),
    clientes: new Set(deben.map((c) => c.clienteId ?? `sin:${c.id}`)).size,
    masDe60Cent: masDe60.reduce((s, c) => s + c.importeCent, 0),
    masDe60: masDe60.length,
  }
}

// ── Cobros de GoCardless sin cliente: el cliente más probable ────────────────

export interface ClienteParaCasar { id: string; nombre: string; nif: string | null; correos: string[] }
export interface DeGoCardless { nombre: string | null; correo: string | null; nif: string | null }

export type Propuesta =
  | { tipo: 'una'; clienteId: string; por: 'NIF' | 'email' | 'nombre' }
  | { tipo: 'varias'; clienteIds: string[]; por: 'NIF' | 'email' | 'nombre' }
  | { tipo: 'ninguna' }

const nombreLimpio = (s: string) => sinTildes(s).replace(/\b(s\.?l\.?u?|s\.?a\.?|s\.?c\.?|c\.?b\.?)\b/g, ' ').replace(/[^a-z0-9ñ]+/g, ' ').trim()

/**
 * El cliente más probable para un cliente de GoCardless sin cliente en Sumied:
 * primero el NIF, después el email y después el nombre (sin tildes, sin «S.L.»).
 * Solo propone: lo confirma una persona. Si hay más de uno igual de probable,
 * los da todos y no elige.
 */
export function proponerCliente(gc: DeGoCardless, clientes: readonly ClienteParaCasar[]): Propuesta {
  const pasos: { por: 'NIF' | 'email' | 'nombre'; igual: (c: ClienteParaCasar) => boolean }[] = []
  if (gc.nif && nifLimpio(gc.nif).length >= 8) pasos.push({ por: 'NIF', igual: (c) => c.nif !== null && nifLimpio(c.nif) === nifLimpio(gc.nif!) })
  if (gc.correo?.includes('@')) pasos.push({ por: 'email', igual: (c) => c.correos.some((x) => x.trim().toLowerCase() === gc.correo!.trim().toLowerCase()) })
  if (gc.nombre && nombreLimpio(gc.nombre).length >= 3) pasos.push({ por: 'nombre', igual: (c) => nombreLimpio(c.nombre) === nombreLimpio(gc.nombre!) })
  for (const p of pasos) {
    const ids = clientes.filter(p.igual).map((c) => c.id)
    if (ids.length === 1) return { tipo: 'una', clienteId: ids[0], por: p.por }
    if (ids.length > 1) return { tipo: 'varias', clienteIds: ids, por: p.por }
  }
  return { tipo: 'ninguna' }
}
