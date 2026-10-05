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
//      (mismos códigos, títulos, título del BOE, corrección, definición de la
//      quinta parte, jerarquía y hojas).
//
// Rojo con el caso concreto. Pura: recibe el volcado y los textos.

import { PLANES, construirSerie } from './planContable.mjs'

const CAMPOS = ['name', 'boe_name', 'correction_kind', 'plain_name', 'boe_definition', 'group_code', 'parent_code', 'is_leaf', 'valid_from', 'source_key']

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

// ── Empresa por empresa (tarea 3) ───────────────────────────────────────────

/**
 * Para cada empresa con el plan activado (encargo §4):
 *   · tiene TODAS las hojas de su plan;
 *   · todas sus cuentas tienen la longitud de la empresa;
 *   · todo enlace apunta a una cuenta suya que existe y está activa;
 *   · los papeles propios de un proveedor van a su grupo (gasto y suplidos al 6, pago al 57 o 43);
 *   · hay 472 y 477 para cada tipo de IVA (o IGIC) vigente de su territorio.
 * Cada caso lleva la cuenta (account_id) de la que es (regla 9).
 */
export function revisarEmpresas(bd, serie) {
  const out = []
  const hojas = { pymes: new Set(), general: new Set() }
  for (const c of serie.cuentas) if (c.is_leaf) hojas[c.plan].add(c.code)
  const cuentas = bd.company_account ?? []
  const enlaces = bd.company_account_link ?? []
  for (const e of bd.empresas_plan ?? []) {
    const yo = `${e.legal_name} (cuenta ${String(e.account_id).slice(0, 8)})`
    const suyas = cuentas.filter((c) => c.company_id === e.id)
    if (!suyas.length) continue
    const plan = e.chart_kind === 'normal' ? 'general' : 'pymes'
    const porId = new Map(suyas.map((c) => [c.id, c]))
    const tiene = new Set(suyas.filter((c) => c.kind === 'template').map((c) => c.template_code))
    const faltan = [...hojas[plan]].filter((h) => !tiene.has(h))
    if (faltan.length) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: le faltan ${faltan.length} cuentas de serie de su plan (${faltan.slice(0, 8).join(', ')}${faltan.length > 8 ? '…' : ''}).` })
    const otroPlan = suyas.filter((c) => c.plan !== plan)
    if (otroPlan.length) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: ${otroPlan.length} cuentas son del plan ${otroPlan[0].plan} y la empresa usa el de ${plan}.` })
    const largas = suyas.filter((c) => c.code.length !== Number(e.account_digits))
    if (largas.length) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: ${largas.length} cuentas no tienen ${e.account_digits} dígitos (${largas.slice(0, 5).map((c) => c.code).join(', ')}).` })
    for (const l of enlaces.filter((x) => x.company_id === e.id)) {
      const c = porId.get(l.company_account_id)
      if (!c) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: un ${l.entity} apunta a una cuenta que no es de la empresa.` })
      else if (c.status !== 'activa') out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: un ${l.entity} apunta a ${c.code}, que está ${c.status}.` })
      // Los papeles propios de un proveedor (0160), a su grupo: misma regla que el disparador.
      else if ((l.role === 'gasto' || l.role === 'suplidos') && !c.template_code.startsWith('6')) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: ${l.role === 'gasto' ? 'las facturas' : 'los suplidos'} de un proveedor van a ${c.code}, que no es de gastos (grupo 6).` })
      else if (l.role === 'pago' && !/^(57|43)/.test(c.template_code)) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: a un proveedor se le paga desde ${c.code}, que no es un banco o caja (57) ni lo que te debe (43).` })
    }
    const sistema = e.tax_territory === 'canarias' ? 'igic' : 'iva'
    for (const t of (bd.tipos_vigentes ?? []).filter((x) => x.tax_system === sistema && (x.is_system || x.account_id === e.account_id))) {
      for (const papel of ['soportado', 'repercutido']) {
        if (!enlaces.some((l) => l.company_id === e.id && l.entity === 'tax_rate' && l.entity_id === t.id && l.role === papel)) {
          out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: el tipo ${t.code} (${t.rate} %) no tiene cuenta de IVA ${papel}.` })
        }
      }
    }
  }
  return out
}
