// scripts/conta/lib/agentePlan.mjs
//
// C02 · Agente «Plan contable» (encargo §4), la parte de la SERIE (tarea 2).
// Las comprobaciones por empresa (plan activo con todas sus hojas, enlaces a
// subcuentas que existen y no están ocultas, longitud coherente, 472/477 por
// cada IVA vigente) llegan con la tarea 3.
//
//   1. El texto del BOE: la serie que sale de él (cuadro + correcciones) no da
//      ningún hallazgo. Si el BOE corrige una errata, la corrección sobra y se
//      dice; si cambia una cita o aparece una diferencia nueva, también.
//   2. La base: pgc_account es EXACTAMENTE supabase/conta/pgc/serie.json
//      (mismos códigos, títulos, título del BOE, corrección, jerarquía y hojas).
//
// Rojo con el caso concreto. Pura: recibe el volcado y los textos.

import { PLANES, construirSerie } from './planContable.mjs'

const CAMPOS = ['name', 'boe_name', 'correction_kind', 'plain_name', 'group_code', 'parent_code', 'is_leaf', 'valid_from', 'source_key']

export function revisarSerieEnTexto(textos, correcciones) {
  const out = []
  for (const plan of Object.keys(PLANES)) {
    const t = textos[plan]
    if (!t) { out.push({ nivel: 'rojo', texto: `No tengo el texto del BOE del plan de ${plan}: no puedo comprobar la serie.` }); continue }
    for (const h of construirSerie(t, plan, correcciones).hallazgos) out.push({ nivel: 'rojo', texto: `BOE · ${h}` })
  }
  return out
}

export function revisarSerieEnBase(filas, serie) {
  const out = []
  const clave = (r) => `${r.plan} ${r.code}`
  const esperadas = new Map(serie.cuentas.map((c) => [clave(c), c]))
  const vigentes = filas.filter((r) => r.valid_to === null || r.valid_to === undefined)
  const enBase = new Map()
  for (const r of vigentes) {
    if (enBase.has(clave(r))) out.push({ nivel: 'rojo', texto: `Base · ${clave(r)}: hay dos filas vigentes a la vez.` })
    enBase.set(clave(r), r)
  }
  for (const [k, c] of esperadas) {
    const r = enBase.get(k)
    if (!r) { out.push({ nivel: 'rojo', texto: `Base · ${k} (${c.name}): falta en pgc_account.` }); continue }
    for (const campo of CAMPOS) {
      const a = r[campo] ?? null, b = c[campo] ?? null
      if (String(a) !== String(b)) out.push({ nivel: 'rojo', texto: `Base · ${k}: ${campo} es «${a}» y la serie dice «${b}».` })
    }
  }
  for (const k of enBase.keys()) if (!esperadas.has(k)) out.push({ nivel: 'rojo', texto: `Base · ${k}: está en pgc_account y no en la serie.` })
  return out
}

export function informePlan(hallazgos, { donde, hoy, filas, resumen }) {
  const rojos = hallazgos.filter((h) => h.nivel === 'rojo')
  const l = [`## Agente «Plan contable» · ${donde} · ${hoy}`, '']
  l.push(`Serie esperada: pymes ${resumen.pymes.codigosSinGrupos} cuentas (${resumen.pymes.hojas} hojas), general ${resumen.general.codigosSinGrupos} (${resumen.general.hojas} hojas). Filas leídas de pgc_account: ${filas}.`, '')
  if (!rojos.length) l.push('En verde: la serie de la base es la del BOE con sus correcciones citadas, y cada cita sigue en el texto.')
  else l.push(`**${rojos.length} en rojo:**`, '', ...rojos.map((h) => `- ${h.texto}`))
  return l.join('\n') + '\n'
}
