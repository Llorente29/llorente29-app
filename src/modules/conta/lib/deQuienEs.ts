// src/modules/conta/lib/deQuienEs.ts
//
// E03 · «¿De quién es esta factura?» (respuesta E02 · 1). Sumied nunca decide
// solo que un IVA no se deduce: si la factura no va a nombre de la empresa, lo
// pregunta. La regla vive en la base (_conta_de_quien, 20261118T1833) y es la
// que manda; aquí está la misma, pura, para la pantalla y sus pruebas
// (tests/conta/e03), y lo que se enseña de cada caso: su etiqueta y sus botones.
//
//   otra_sociedad  el NIF leído es el de otra sociedad de la misma cuenta
//   fuera          un NIF que no es de ninguna sociedad de la cuenta
//   sin_leer       no se ha podido leer a nombre de quién va
//   empresa        va a nombre de la empresa: nada que preguntar
//   sin_iva        va a otro, pero sin IVA no hay nada que deducir

export type CasoDeQuien = 'otra_sociedad' | 'fuera' | 'sin_leer' | 'empresa' | 'sin_iva'
export type RespuestaDeQuien = 'es_de_esta' | 'deduce' | 'no_deduce'

export interface DeQuien {
  caso: CasoDeQuien | null
  pregunta: boolean
  frase: string | null
  empresa: string | null
  sociedadId: string | null
  sociedad: string | null
  sociedadCorta: string | null
  respuesta: RespuestaDeQuien | null
  quien: string | null
  cuando: string | null
  validado: boolean
  soloSumied: boolean
}

/**
 * La clave de un NIF, la misma que _conta_nif_clave en la base: sin espacios,
 * guiones ni puntos, en mayúsculas, sin el prefijo de un NIF-IVA («ES», «VAT»…)
 * cuando lo que queda son nueve caracteres españoles.
 */
export function claveNif(nif: string | null | undefined): string | null {
  const t = (nif ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/^(EUVAT|NIFIVA|VATNO|VAT|NIF|CIF|TVA)/, '')
  const sinEs = /^ES[A-Z0-9]{9}$/.test(t) ? t.slice(2) : t
  return sinEs || null
}

/** El caso, con la misma regla que la base. */
export function casoDeQuien(o: { nifEmpresa: string | null; nifLeido: string | null; otrasSociedades: readonly { id: string; nif: string | null }[]; conIva: boolean }):
  { caso: CasoDeQuien | null; sociedadId: string | null } {
  const emp = claveNif(o.nifEmpresa)
  if (!emp) return { caso: null, sociedadId: null }
  const dest = claveNif(o.nifLeido)
  if (dest === emp) return { caso: 'empresa', sociedadId: null }
  const otra = dest ? o.otrasSociedades.find((s) => claveNif(s.nif) === dest) : undefined
  if (otra) return { caso: 'otra_sociedad', sociedadId: otra.id }
  if (!o.conIva) return { caso: 'sin_iva', sociedadId: null }
  return { caso: dest ? 'fuera' : 'sin_leer', sociedadId: null }
}

export interface BotonDeQuien { que: RespuestaDeQuien | 'pasar'; texto: string; principal: boolean }

/**
 * Los dos botones de cada pregunta, del mismo tamaño:
 *   · otra sociedad: lo normal es que se leyó bien y es de la otra → «Pasarla a …», relleno;
 *   · fuera y sin leer (E04, Julio): ninguno relleno. Quitar un IVA no puede ser lo
 *     que se pulsa sin pensar: «Su IVA no se deduce» y «Sí es nuestra, se deduce», iguales, en hueco.
 */
export function botonesDeQuien(q: Pick<DeQuien, 'caso' | 'sociedadCorta' | 'sociedad'>): BotonDeQuien[] {
  if (q.caso === 'otra_sociedad') {
    return [
      { que: 'pasar', texto: `Pasarla a ${q.sociedadCorta ?? q.sociedad ?? 'la otra sociedad'}`, principal: true },
      { que: 'es_de_esta', texto: 'Es de esta sociedad', principal: false },
    ]
  }
  if (q.caso === 'fuera' || q.caso === 'sin_leer') {
    return [
      { que: 'no_deduce', texto: 'Su IVA no se deduce', principal: false },
      { que: 'deduce', texto: 'Sí es nuestra, se deduce', principal: false },
    ]
  }
  return []
}

/**
 * E04 · Si se pasa sola a la otra sociedad: la misma regla que la base
 * (_conta_pasar_sola, 20261118T1950). Va a nombre de OTRA sociedad de la misma
 * cuenta, sin asiento validado, sin respuesta de una persona (y, en la base,
 * sin pagos ni banco: eso no lo ve la pantalla).
 */
export function sePasaSola(o: {
  nifEmpresa: string | null; nifLeido: string | null; otrasSociedades: readonly { id: string; nif: string | null }[]
  conIva: boolean; validado: boolean; respuesta: RespuestaDeQuien | null
}): { pasa: boolean; sociedadId: string | null } {
  const c = casoDeQuien(o)
  const pasa = c.caso === 'otra_sociedad' && !o.validado && o.respuesta === null
  return { pasa, sociedadId: pasa ? c.sociedadId : null }
}

/** E04 · «Es de: [sociedad ▾]»: en una cuenta con más de una sociedad, cuando no se sabe de quién es (fuera o sin leer). */
export const eligeSociedad = (caso: CasoDeQuien | null, sociedades: number): boolean => (caso === 'fuera' || caso === 'sin_leer') && sociedades > 1

/** La etiqueta de la fila en la lista: dice qué falta, no por qué técnicamente. */
export const ETIQUETA_DE_QUIEN = '¿De quién es?'

/** Lo que dice la ficha de una validada que marcó Sumied solo (antes del E03). */
export const SOLO_SUMIED = 'Su IVA no se deduce porque no va a nombre de la empresa: lo marcó Sumied solo. Si no es así, anula el asiento.'

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const CASOS: readonly CasoDeQuien[] = ['otra_sociedad', 'fuera', 'sin_leer', 'empresa', 'sin_iva']
const RESPUESTAS: readonly RespuestaDeQuien[] = ['es_de_esta', 'deduce', 'no_deduce']

/** Lo que devuelve conta_de_quien_es, con sus tipos. */
export function deLaBase(r: unknown): DeQuien {
  const x = (r ?? {}) as Record<string, unknown>
  const caso = CASOS.includes(x.caso as CasoDeQuien) ? (x.caso as CasoDeQuien) : null
  const respuesta = RESPUESTAS.includes(x.respuesta as RespuestaDeQuien) ? (x.respuesta as RespuestaDeQuien) : null
  return {
    caso, pregunta: x.pregunta === true, frase: texto(x.frase), empresa: texto(x.empresa),
    sociedadId: texto(x.sociedad_id), sociedad: texto(x.sociedad), sociedadCorta: texto(x.sociedad_corta),
    respuesta, quien: texto(x.quien), cuando: texto(x.cuando), validado: x.validado === true, soloSumied: x.solo_sumied === true,
  }
}
