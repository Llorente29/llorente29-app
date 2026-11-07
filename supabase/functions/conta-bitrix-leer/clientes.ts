// supabase/functions/conta-bitrix-leer/clientes.ts
//
// G01b · La unión de las fichas de Bitrix24 en clientes de Sumied (Julio,
// 07/11, tras el recuento de repetidos: 21 NIF en 52 fichas, uno en 12, dos
// de otro formato). Puro: lo usan la lectura, el ensayo en PDF y el recuento,
// así los tres dicen lo mismo.
//   1. Mismo NIF = un solo cliente, con todas sus fichas enlazadas. Sale en
//      «Pendiente de revisar» como «Fichas repetidas en Bitrix24».
//   2. Su situación, la más viva de sus fichas: activo > moroso > solo renta >
//      sin clasificar > baja (y, detrás, la ficha sin situación).
//   3. Un NIF sin formato de DNI, NIE o CIF, o que salga en 10 fichas o más,
//      no se usa como NIF: esas fichas entran como clientes sin NIF, cada una
//      por separado, y salen en «Pendiente de revisar».
// Mientras la unión no se aplica (lo hace una persona en Ajustes › Cobros ›
// Bitrix24, después de ver el ensayo), cada ficha va sola, como antes.

import { normalizarNif, type Situacion } from './mapa.ts'

export const MAX_FICHAS_POR_NIF = 10

/** De la más viva a la menos; null (sin situación en Bitrix24) va la última. */
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

/** Lo que la unión necesita de cada ficha. */
export interface FichaParaUnir {
  bitrixId: string; nif: string | null; situacion: Situacion | null
  /** G01c · De qué viene: una empresa (lo de siempre) o un contacto de Bitrix24. Sus ids son numeraciones distintas. */
  origen?: 'empresa' | 'contacto'
}

/** La clave de una ficha: el id de Bitrix24, y «contacto-» delante si es un contacto (una empresa y un contacto pueden tener el mismo id). */
export const claveDeFicha = (f: FichaParaUnir) => (f.origen === 'contacto' ? `contacto-${f.bitrixId}` : f.bitrixId)

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
  /** En qué cuántas fichas sale su NIF en Bitrix24 (para los motivos). */
  fichasConSuNif: number
  /** G01c · Si su número es un identificador fiscal extranjero (el RIF de Venezuela): tipo y país. */
  idExtranjero: { tipo: 'foreign'; pais: string } | null
}

const porId = (a: FichaParaUnir, b: FichaParaUnir) => {
  // G01c · Primero las empresas y después los contactos; dentro, por id.
  const oa = a.origen === 'contacto' ? 1 : 0, ob = b.origen === 'contacto' ? 1 : 0
  if (oa !== ob) return oa - ob
  const na = Number(a.bitrixId), nb = Number(b.bitrixId)
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.bitrixId.localeCompare(b.bitrixId)
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

// ── Campos que no se leen nunca ─────────────────────────────────────────────
// En el Bitrix24 de QBO hay campos con contraseñas («Clave Certificado
// Digital…», «Usuario vinculado») y con los certificados (ficheros). Ni se
// piden a Bitrix24 ni salen para elegir en «Qué es cada campo», aunque alguien
// los elija por error (Julio, 07/11). Por su etiqueta y por su tipo.

/** Etiquetas de un campo con una contraseña o un acceso. */
// G01c (Julio, 07/11) · También el IBAN y «Detalles del pago» (BANKING_DETAILS, que puede llevarlo): no se leen nunca.
export const ETIQUETA_SENSIBLE = /\b(CLAVE|CLAVES|CONTRASENA|CONTRASENAS|PASSWORD|PASSWD|PASS|PIN|USUARIO|USER|LOGIN|CREDENCIAL|CREDENCIALES|TOKEN|SECRETO|CL@VE|IBAN|DETALLES DEL PAGO)\b/
/** Los campos estándar de Bitrix24 que no se leen nunca, por su código (sus etiquetas cambian con el idioma del portal). */
export const CODIGOS_SENSIBLES: readonly string[] = ['BANKING_DETAILS']
/** Tipos de campo que no se leen: los ficheros (los certificados) y las contraseñas. */
export const TIPOS_SENSIBLES: readonly string[] = ['file', 'password']

export interface CampoConEtiqueta { type?: string; title?: string; formLabel?: string; listLabel?: string }
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** ¿Este campo de Bitrix24 no se puede leer nunca? Por su tipo o por cualquiera de sus etiquetas. */
export function esCampoSensible(c: CampoConEtiqueta | null | undefined, codigo?: string): boolean {
  if (codigo && CODIGOS_SENSIBLES.includes(codigo)) return true
  if (!c) return false
  if (c.type && TIPOS_SENSIBLES.includes(c.type)) return true
  return [c.formLabel, c.listLabel, c.title].some((t) => !!t && ETIQUETA_SENSIBLE.test(sinTildes(t)))
}

// ── Lo que se guarda y lo que sale en «Pendiente de revisar» ────────────────

/** Lo que se manda a conta_bitrix_guardar_clientes por cada cliente. */
export const paraGuardar = <F extends FichaParaUnir>(c: Cliente<F>) =>
  ({ clave: c.clave, nif: c.nif, situacion: c.situacion, motivo: c.motivo, principal: c.principal, fichas: c.fichas })

/** Lo que devuelve la base de un cliente que no se ha podido guardar. */
export interface ErrorAlGuardar { bitrixIds: string[]; nombre: string | null; emisor: string | null; codigo: string; porque: string }

export interface DiferenciaDeBitrix {
  tipo: 'fichas_repetidas' | 'nif_no_valido' | 'ficha_no_guardada'
  porque_codigo: string
  porque: string
  bitrix_id: string
  datos: Record<string, unknown>
}

const PALABRA: Record<string, string> = { activo: 'activa', moroso: 'morosa', solo_renta: 'solo renta', sin_clasificar: 'sin clasificar', baja: 'de baja' }
const enPalabras = (s: Situacion | null) => (s ? PALABRA[s] ?? s : 'sin situación')
const QUEDA: Record<string, string> = { activo: 'Activo', moroso: 'Moroso', solo_renta: 'Solo la renta', sin_clasificar: 'Sin clasificar', baja: 'De baja' }

/**
 * Lo que sale en «Pendiente de revisar» de una lectura de Bitrix24: cada
 * cliente unido, cada ficha que entra sin NIF y cada una que no se ha podido
 * guardar, con su porqué (regla 7: se enseña, no se esconde). Sin NIF en el
 * texto: el porqué lo dice con palabras.
 */
export function diferenciasDeLectura<F extends FichaParaUnir & { nombre?: string }>(
  clientes: readonly Cliente<F>[], errores: readonly ErrorAlGuardar[], unir: boolean,
): DiferenciaDeBitrix[] {
  const fallidos = new Set(errores.flatMap((e) => e.bitrixIds))
  const out: DiferenciaDeBitrix[] = []
  for (const c of clientes) {
    if (fallidos.has(c.principal.bitrixId)) continue
    if (c.motivo === 'repetidas') {
      const sits = c.fichas.map((f) => enPalabras(f.situacion))
      out.push({ tipo: 'fichas_repetidas', porque_codigo: new Set(c.fichas.map((f) => f.situacion)).size > 1 ? 'mismo_nif_distinta_situacion' : 'mismo_nif',
        bitrix_id: c.principal.bitrixId, datos: { bitrixIds: c.fichas.map((f) => f.bitrixId), situacion: c.situacion },
        porque: `Sale en ${c.fichas.length} fichas de Bitrix24 con el mismo NIF (${c.fichas.map((f) => f.bitrixId).join(', ')}: ${sits.join(', ')}). En Sumied es un solo cliente, ${QUEDA[c.situacion ?? ''] ? `«${QUEDA[c.situacion!]}»` : 'sin situación'}.` })
    } else if (c.motivo === 'nif_no_valido' || c.motivo === 'nif_en_muchas') {
      out.push({ tipo: 'nif_no_valido', porque_codigo: c.motivo === 'nif_no_valido' ? 'formato' : 'en_muchas', bitrix_id: c.principal.bitrixId,
        datos: { bitrixIds: [c.principal.bitrixId], fichasConSuNif: c.fichasConSuNif },
        porque: c.motivo === 'nif_no_valido'
          ? `Su NIF en Bitrix24 (ficha ${c.principal.bitrixId}) no tiene formato de DNI, NIE ni CIF: entra sin NIF.`
          : `Su NIF sale en ${c.fichasConSuNif} fichas de Bitrix24: entra sin NIF y por separado (ficha ${c.principal.bitrixId}).` })
    }
  }
  for (const e of errores) {
    const choca = /NIF ya es de otro cliente/.test(e.porque)
    out.push({ tipo: 'ficha_no_guardada', porque_codigo: choca ? 'nif_de_otro' : e.codigo || 'error', bitrix_id: e.bitrixIds[0] ?? '',
      datos: { bitrixIds: e.bitrixIds, nombre: e.nombre, emisor: e.emisor },
      porque: `«${e.nombre ?? 'Sin nombre'}» (ficha ${e.bitrixIds.join(', ')} de Bitrix24) no se ha guardado: ${e.porque}.`
        + (choca && !unir ? ' Se unirá a su cliente cuando se aplique la unión en Ajustes › Cobros › Bitrix24.' : '') })
  }
  return out
}

/** Para el ensayo en PDF (lo descarga quien está dentro de la cuenta; no se guarda ni se registra). */
export interface EnsayoDeUnion {
  resumen: ResumenDeUnion
  /** G01b (07/11) · Clientes de Sumied ya creados por separado que se juntan con otro (se retiran, archivados). */
  seJuntan: number
  unidos: { nif: string; situacion: Situacion | null; fichas: { bitrixId: string; nombre: string; situacion: Situacion | null; situacionTexto: string | null }[]
    /** Cuántos clientes de Sumied son hoy esas fichas (0: ninguno aún; 2 o más: se juntan en uno). */
    clientesHoy: number }[]
  sinNif: { bitrixId: string; nombre: string; nifEnBitrix: string | null; motivo: 'nif_no_valido' | 'nif_en_muchas'; fichasConSuNif: number }[]
}

export function ensayoDeUnion<F extends FichaParaUnir & { nombre: string; situacionTexto: string | null; nifEnBitrix: string | null }>(
  fichas: readonly F[], clienteDeFicha: ReadonlyMap<string, string> = new Map(),
): EnsayoDeUnion {
  const clientes = agrupar(fichas, true)
  const unidos = clientes.filter((c) => c.motivo === 'repetidas').map((c) => ({ nif: c.nif!, situacion: c.situacion,
    fichas: c.fichas.map((f) => ({ bitrixId: f.bitrixId, nombre: f.nombre, situacion: f.situacion, situacionTexto: f.situacionTexto })),
    clientesHoy: new Set(c.fichas.map((f) => clienteDeFicha.get(f.bitrixId)).filter(Boolean)).size }))
  return {
    resumen: resumenDeUnion(clientes),
    seJuntan: unidos.reduce((t, u) => t + Math.max(0, u.clientesHoy - 1), 0),
    unidos,
    sinNif: clientes.filter((c) => c.motivo === 'nif_no_valido' || c.motivo === 'nif_en_muchas').map((c) => ({
      bitrixId: c.principal.bitrixId, nombre: c.principal.nombre, nifEnBitrix: c.principal.nifEnBitrix ?? c.principal.nif,
      motivo: c.motivo as 'nif_no_valido' | 'nif_en_muchas', fichasConSuNif: c.fichasConSuNif })),
  }
}
