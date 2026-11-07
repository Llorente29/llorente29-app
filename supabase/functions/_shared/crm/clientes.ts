// supabase/functions/_shared/crm/clientes.ts
//
// G01c · Del núcleo neutro: no sabe de qué CRM vienen las fichas (las lee su
// adaptador; hoy, Bitrix24 en conta-bitrix-leer). Antes en
// conta-bitrix-leer/clientes.ts.
//
// G01b · La unión de las fichas del CRM en clientes de Sumied (Julio,
// 07/11, tras el recuento de repetidos: 21 NIF en 52 fichas, uno en 12, dos
// de otro formato). Puro: lo usan la lectura, el ensayo en PDF y el recuento,
// así los tres dicen lo mismo.
//   1. Mismo NIF = un solo cliente, con todas sus fichas enlazadas. Sale en
//      «Pendiente de revisar» como «Fichas repetidas en tu CRM».
//   2. Su situación, la más viva de sus fichas: activo > moroso > solo renta >
//      sin clasificar > baja (y, detrás, la ficha sin situación).
//   3. Un NIF sin formato de DNI, NIE o CIF, o que salga en 10 fichas o más,
//      no se usa como NIF: esas fichas entran como clientes sin NIF, cada una
//      por separado, y salen en «Pendiente de revisar».
// Mientras la unión no se aplica (lo hace una persona en Ajustes › Cobros ›
// Tu CRM, después de ver el ensayo), cada ficha va sola, como antes.

import { claveDeFicha, normalizarNif, type Situacion, type TipoFicha } from './ficha.ts'

export { claveDeFicha }

export const MAX_FICHAS_POR_NIF = 10

/** De la más viva a la menos; null (sin situación en el CRM) va la última. */
export const VIVEZA: readonly (Situacion | null)[] = ['activo', 'moroso', 'solo_renta', 'sin_clasificar', 'baja', null]
const rango = (s: Situacion | null) => { const i = VIVEZA.indexOf(s); return i < 0 ? VIVEZA.length : i }

/** La situación más viva de unas cuantas. */
export const masViva = (sits: readonly (Situacion | null)[]): Situacion | null =>
  sits.length ? [...sits].sort((a, b) => rango(a) - rango(b))[0] : null

/** El NIF como lo compara la base: el de la lectura (normalizarNif) y después solo letras y números en mayúsculas (party_nif). */
export function nifComoLaBase(v: unknown): string | null {
  const t0 = Array.isArray(v) ? v.find((x) => x !== null && x !== undefined && String(x).trim()) : v
  if (t0 === null || t0 === undefined || typeof t0 === 'object') return null
  const n = normalizarNif(String(t0).split('|')[0].trim() || null)
  const t = (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return t || null
}

/**
 * DNI (8 cifras y letra), NIE (X, Y o Z, 7 cifras y letra), CIF (letra de
 * sociedad, 7 cifras y control), RIF de Venezuela (J, V, E, G o P y 9 cifras;
 * G01c, Julio 07/11: identificador fiscal extranjero) u otro.
 */
export function tipoDeNif(n: string): 'DNI' | 'NIE' | 'CIF' | 'RIF' | 'otro' {
  if (/^[0-9]{8}[A-Z]$/.test(n)) return 'DNI'
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(n)) return 'NIE'
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(n)) return 'CIF'
  if (/^[JVEGP][0-9]{9}$/.test(n)) return 'RIF'
  return 'otro'
}

/**
 * G01c · El identificador fiscal extranjero de un NIF, si lo es: el RIF de
 * Venezuela se guarda en el número del cliente (party.tax_id) con tipo
 * «foreign» y país VE (customer_fiscal), no como NIF español.
 */
export const idExtranjeroDe = (n: string | null): { tipo: 'foreign'; pais: string } | null =>
  n && tipoDeNif(n) === 'RIF' ? { tipo: 'foreign', pais: 'VE' } : null

/**
 * G01c (Julio, 07/11) · Los NIF de las empresas por los que la unión de verdad
 * une: con formato (DNI, NIE, CIF o RIF) y en menos de 10 fichas, contando
 * también las de los contactos con ese NIF (que se unen a ellas). Lo usan qué
 * es cada contacto (contactos.ts) y el recuento, para decir lo mismo que la
 * unión: un contacto con un NIF sin formato igual al de una empresa no «se une
 * a su empresa» (la unión no une por él), es cliente aparte.
 */
export function nifsQueUnen(nifsDeEmpresas: readonly (string | null)[], nifsDeContactos: readonly (string | null)[] = []): Set<string> {
  const cuantas = new Map<string, number>()
  for (const v of [...nifsDeEmpresas, ...nifsDeContactos]) { const n = nifComoLaBase(v); if (n) cuantas.set(n, (cuantas.get(n) ?? 0) + 1) }
  const out = new Set<string>()
  for (const v of nifsDeEmpresas) {
    const n = nifComoLaBase(v)
    if (n && tipoDeNif(n) !== 'otro' && (cuantas.get(n) ?? 0) < MAX_FICHAS_POR_NIF) out.add(n)
  }
  return out
}

/** Lo que la unión necesita de cada ficha. */
export interface FichaParaUnir {
  idExterno: string; nif: string | null; situacion: Situacion | null
  /** G01c · Una empresa (si no lo dice) o un contacto del CRM. Sus ids son numeraciones distintas: la clave lleva el tipo (ficha.ts · claveDeFicha). */
  tipoFicha?: TipoFicha
}

/** Cómo se nombra una ficha en un porqué: «ficha 7» o «contacto 7». */
export const fichaEnPalabras = (f: { tipoFicha?: TipoFicha; idExterno: string }) => `${f.tipoFicha === 'contacto' ? 'contacto' : 'ficha'} ${f.idExterno}`

export type Motivo = 'repetidas' | 'nif_no_valido' | 'nif_en_muchas'

export interface Cliente<F extends FichaParaUnir> {
  /** «nif:…» si se une por NIF; «ficha:…» si va sola. */
  clave: string
  /** El NIF que se guarda en el cliente (null si no se usa). */
  nif: string | null
  /** La ficha que da nombre y dirección: la de la situación más viva (si empatan, la de id más bajo). */
  principal: F
  fichas: F[]
  situacion: Situacion | null
  /** Por qué sale en «Pendiente de revisar» (null: no sale). */
  motivo: Motivo | null
  /** En qué cuántas fichas sale su NIF en el CRM (para los motivos). */
  fichasConSuNif: number
  /** G01c · Si su número es un identificador fiscal extranjero (el RIF de Venezuela): tipo y país. */
  idExtranjero: { tipo: 'foreign'; pais: string } | null
}

const porId = (a: FichaParaUnir, b: FichaParaUnir) => {
  // G01c · Primero las empresas y después los contactos; dentro, por id.
  const oa = a.tipoFicha === 'contacto' ? 1 : 0, ob = b.tipoFicha === 'contacto' ? 1 : 0
  if (oa !== ob) return oa - ob
  const na = Number(a.idExterno), nb = Number(b.idExterno)
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.idExterno.localeCompare(b.idExterno)
}

/**
 * Las fichas, en clientes. Con «unir» (la unión aplicada), por la regla de
 * arriba; sin él, cada ficha sola y con su NIF, como antes.
 */
export function agrupar<F extends FichaParaUnir>(fichas: readonly F[], unir: boolean): Cliente<F>[] {
  const nifDe = new Map(fichas.map((f) => [f, nifComoLaBase(f.nif)]))
  const cuantas = new Map<string, number>()
  for (const n of nifDe.values()) if (n) cuantas.set(n, (cuantas.get(n) ?? 0) + 1)
  const sola = (f: F, nif: string | null, motivo: Motivo | null): Cliente<F> =>
    ({ clave: `ficha:${claveDeFicha(f)}`, nif, principal: f, fichas: [f], situacion: f.situacion, motivo,
      fichasConSuNif: nifDe.get(f) ? cuantas.get(nifDe.get(f)!) ?? 1 : 0, idExtranjero: idExtranjeroDe(nif) })
  if (!unir) return fichas.map((f) => sola(f, nifDe.get(f) ?? null, null))

  const grupos = new Map<string, F[]>()
  const out: Cliente<F>[] = []
  for (const f of fichas) {
    const n = nifDe.get(f)
    if (!n) { out.push(sola(f, null, null)); continue }
    if (tipoDeNif(n) === 'otro') { out.push(sola(f, null, 'nif_no_valido')); continue }
    if ((cuantas.get(n) ?? 0) >= MAX_FICHAS_POR_NIF) { out.push(sola(f, null, 'nif_en_muchas')); continue }
    grupos.set(n, [...(grupos.get(n) ?? []), f])
  }
  for (const [nif, fs] of grupos) {
    const orden = [...fs].sort((a, b) => rango(a.situacion) - rango(b.situacion) || porId(a, b))
    out.push({ clave: `nif:${nif}`, nif, principal: orden[0], fichas: [...fs].sort(porId), situacion: masViva(fs.map((f) => f.situacion)),
      motivo: fs.length > 1 ? 'repetidas' : null, fichasConSuNif: fs.length, idExtranjero: idExtranjeroDe(nif) })
  }
  return out.sort((a, b) => porId(a.principal, b.principal))
}

export interface ResumenDeUnion {
  fichas: number
  clientes: number
  /** Clientes con más de una ficha, y cuántas fichas suman. */
  clientesUnidos: number
  fichasUnidas: number
  /** Fichas que entran sin NIF: por formato y por salir en 10 o más. */
  sinNifPorFormato: number
  sinNifPorMuchas: number
  /** Clientes en cada situación (la más viva de sus fichas) y fichas en cada situación. */
  clientesPorSituacion: Record<string, number>
  fichasPorSituacion: Record<string, number>
}

const CLAVES_SITUACION = ['activo', 'moroso', 'solo_renta', 'sin_clasificar', 'baja', 'sin_situacion'] as const
const clave = (s: Situacion | null) => s ?? 'sin_situacion'

export function resumenDeUnion<F extends FichaParaUnir>(clientes: readonly Cliente<F>[]): ResumenDeUnion {
  const r: ResumenDeUnion = {
    fichas: 0, clientes: clientes.length, clientesUnidos: 0, fichasUnidas: 0, sinNifPorFormato: 0, sinNifPorMuchas: 0,
    clientesPorSituacion: Object.fromEntries(CLAVES_SITUACION.map((k) => [k, 0])), fichasPorSituacion: Object.fromEntries(CLAVES_SITUACION.map((k) => [k, 0])),
  }
  for (const c of clientes) {
    r.fichas += c.fichas.length
    r.clientesPorSituacion[clave(c.situacion)]++
    for (const f of c.fichas) r.fichasPorSituacion[clave(f.situacion)]++
    if (c.fichas.length > 1) { r.clientesUnidos++; r.fichasUnidas += c.fichas.length }
    if (c.motivo === 'nif_no_valido') r.sinNifPorFormato++
    if (c.motivo === 'nif_en_muchas') r.sinNifPorMuchas++
  }
  return r
}

// ── Lo que se guarda y lo que sale en «Pendiente de revisar» ────────────────

/** Lo que se manda a conta_crm_guardar_clientes por cada cliente (el identificador extranjero, solo si lo es: no cambia la huella de los demás). */
export const paraGuardar = <F extends FichaParaUnir>(c: Cliente<F>) =>
  ({ clave: c.clave, nif: c.nif, situacion: c.situacion, motivo: c.motivo, principal: c.principal, fichas: c.fichas, ...(c.idExtranjero ? { idExtranjero: c.idExtranjero } : {}) })

/** Lo que devuelve la base de un cliente que no se ha podido guardar. */
export interface ErrorAlGuardar {
  idsExternos: string[]; tipoFicha?: TipoFicha; nombre: string | null; emisor: string | null; codigo: string; porque: string
  /** La clave de su ficha principal («empresa:7»). */
  principal?: string
}

/** Una diferencia de la lectura del CRM, para conta_gestoria_diferencia (crm, tipo_ficha e id_externo los pone quien guarda). */
export interface DiferenciaDeCrm {
  tipo: 'fichas_repetidas' | 'nif_no_valido' | 'ficha_no_guardada' | 'contacto_solo_negociacion' | 'contacto_empresa_con_datos'
  porque_codigo: string
  porque: string
  tipo_ficha: TipoFicha
  id_externo: string
  datos: Record<string, unknown>
}

const PALABRA: Record<string, string> = { activo: 'activa', moroso: 'morosa', solo_renta: 'solo renta', sin_clasificar: 'sin clasificar', baja: 'de baja' }
const enPalabras = (s: Situacion | null) => (s ? PALABRA[s] ?? s : 'sin situación')
const QUEDA: Record<string, string> = { activo: 'Activo', moroso: 'Moroso', solo_renta: 'Solo la renta', sin_clasificar: 'Sin clasificar', baja: 'De baja' }

/**
 * Lo que sale en «Pendiente de revisar» de una lectura del CRM: cada cliente
 * unido, cada ficha que entra sin NIF y cada una que no se ha podido guardar,
 * con su porqué (regla 7: se enseña, no se esconde). Sin NIF en el texto: el
 * porqué lo dice con palabras. «crm»: el nombre del CRM conectado, para las
 * frases («Bitrix24»).
 */
export function diferenciasDeLectura<F extends FichaParaUnir & { nombre?: string }>(
  clientes: readonly Cliente<F>[], errores: readonly ErrorAlGuardar[], unir: boolean, crm: string,
): DiferenciaDeCrm[] {
  const fallidos = new Set(errores.map((e) => e.principal ?? `${e.tipoFicha ?? 'empresa'}:${e.idsExternos[0] ?? ''}`))
  const out: DiferenciaDeCrm[] = []
  for (const c of clientes) {
    if (fallidos.has(claveDeFicha(c.principal))) continue
    const p = { tipo_ficha: c.principal.tipoFicha ?? 'empresa', id_externo: c.principal.idExterno } as const
    if (c.motivo === 'repetidas') {
      const sits = c.fichas.map((f) => enPalabras(f.situacion))
      out.push({ tipo: 'fichas_repetidas', porque_codigo: new Set(c.fichas.map((f) => f.situacion)).size > 1 ? 'mismo_nif_distinta_situacion' : 'mismo_nif', ...p,
        datos: { fichas: c.fichas.map((f) => claveDeFicha(f)), situacion: c.situacion },
        porque: `Sale en ${c.fichas.length} fichas de ${crm} con el mismo NIF (${c.fichas.map(fichaEnPalabras).join(', ')}: ${sits.join(', ')}). En Sumied es un solo cliente, ${QUEDA[c.situacion ?? ''] ? `«${QUEDA[c.situacion!]}»` : 'sin situación'}.` })
    } else if (c.motivo === 'nif_no_valido' || c.motivo === 'nif_en_muchas') {
      out.push({ tipo: 'nif_no_valido', porque_codigo: c.motivo === 'nif_no_valido' ? 'formato' : 'en_muchas', ...p,
        datos: { fichas: [claveDeFicha(c.principal)], fichasConSuNif: c.fichasConSuNif },
        porque: c.motivo === 'nif_no_valido'
          ? `Su NIF en ${crm} (${fichaEnPalabras(c.principal)}) no tiene formato de DNI, NIE, CIF ni RIF: entra sin NIF.`
          : `Su NIF sale en ${c.fichasConSuNif} fichas de ${crm}: entra sin NIF y por separado (${fichaEnPalabras(c.principal)}).` })
    }
  }
  for (const e of errores) {
    const choca = /NIF ya es de otro cliente/.test(e.porque)
    const tipo = e.tipoFicha ?? 'empresa'
    out.push({ tipo: 'ficha_no_guardada', porque_codigo: choca ? 'nif_de_otro' : e.codigo || 'error', tipo_ficha: tipo, id_externo: e.idsExternos[0] ?? '',
      datos: { idsExternos: e.idsExternos, nombre: e.nombre, emisor: e.emisor },
      porque: `«${e.nombre ?? 'Sin nombre'}» (${tipo === 'contacto' ? 'contacto' : 'ficha'} ${e.idsExternos.join(', ')} de ${crm}) no se ha guardado: ${e.porque}.`
        + (choca && !unir ? ' Se unirá a su cliente cuando se aplique la unión en Ajustes › Cobros › Tu CRM.' : '') })
  }
  return out
}

/** Para el ensayo en PDF (lo descarga quien está dentro de la cuenta; no se guarda ni se registra). */
export interface EnsayoDeUnion {
  resumen: ResumenDeUnion
  /** G01b (07/11) · Clientes de Sumied ya creados por separado que se juntan con otro (se retiran, archivados). */
  seJuntan: number
  unidos: { nif: string; situacion: Situacion | null; fichas: { idExterno: string; tipoFicha: TipoFicha; nombre: string; situacion: Situacion | null; situacionTexto: string | null }[]
    /** Cuántos clientes de Sumied son hoy esas fichas (0: ninguno aún; 2 o más: se juntan en uno). clienteDeFicha va por claveDeFicha. */
    clientesHoy: number }[]
  sinNif: { idExterno: string; tipoFicha: TipoFicha; nombre: string; nifEnCrm: string | null; motivo: 'nif_no_valido' | 'nif_en_muchas'; fichasConSuNif: number }[]
}

export function ensayoDeUnion<F extends FichaParaUnir & { nombre: string; situacionTexto: string | null; nifEnCrm: string | null }>(
  fichas: readonly F[], clienteDeFicha: ReadonlyMap<string, string> = new Map(),
): EnsayoDeUnion {
  const clientes = agrupar(fichas, true)
  const unidos = clientes.filter((c) => c.motivo === 'repetidas').map((c) => ({ nif: c.nif!, situacion: c.situacion,
    fichas: c.fichas.map((f) => ({ idExterno: f.idExterno, tipoFicha: f.tipoFicha ?? 'empresa', nombre: f.nombre, situacion: f.situacion, situacionTexto: f.situacionTexto })),
    clientesHoy: new Set(c.fichas.map((f) => clienteDeFicha.get(claveDeFicha(f))).filter(Boolean)).size }))
  return {
    resumen: resumenDeUnion(clientes),
    seJuntan: unidos.reduce((t, u) => t + Math.max(0, u.clientesHoy - 1), 0),
    unidos,
    sinNif: clientes.filter((c) => c.motivo === 'nif_no_valido' || c.motivo === 'nif_en_muchas').map((c) => ({
      idExterno: c.principal.idExterno, tipoFicha: c.principal.tipoFicha ?? 'empresa', nombre: c.principal.nombre, nifEnCrm: c.principal.nifEnCrm ?? c.principal.nif,
      motivo: c.motivo as 'nif_no_valido' | 'nif_en_muchas', fichasConSuNif: c.fichasConSuNif })),
  }
}
