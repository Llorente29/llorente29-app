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
/**
 * Respuesta 2 del C02c · ¿Por qué una cuenta cuelga de una cuenta CON hijas?
 * Solo puede ser la genérica traída de otro programa (16000000 bajo la 160;
 * 44500000 bajo la 44): devuelve null si cumple la regla y, si no, el motivo.
 * Misma regla que genericaDe (src/modules/conta/lib/importarPlan.ts) y que el
 * disparador de la 20261008T0130.
 */
export function motivoGenericaMala(c, hojas, ramas) {
  if (c.source !== 'migrated') return `cuelga de la ${c.template_code}, que tiene hijas: solo una cuenta traída de otro programa puede (la genérica)`
  if (!ramas.has(c.template_code)) return `dice colgar de la ${c.template_code}, que no es una cuenta del cuadro`
  if (!c.code.startsWith(c.template_code)) return `no empieza por su cuenta madre ${c.template_code}`
  // Mismo orden que el disparador: el choque antes, para que diga «no se sabe cuál es cuál».
  const choque = [...hojas].find((h) => h.startsWith(c.template_code) && h.padEnd(c.code.length, '0') === c.code)
  if (choque) return `la hoja ${choque} rellenada da el mismo número`
  for (let n = Math.min(5, c.code.length - 1); n >= 1; n--) if (hojas.has(c.code.slice(0, n))) return `empieza por la hoja ${c.code.slice(0, n)}: es de ella, no de la ${c.template_code}`
  for (let n = Math.min(5, c.code.length - 1); n > c.template_code.length; n--) if (ramas.has(c.code.slice(0, n))) return `su madre sería la ${c.code.slice(0, n)}, no la ${c.template_code}`
  const sinCeros = c.code.replace(/0+$/, '')
  const relleno = sinCeros.length <= c.template_code.length ? c.template_code : sinCeros
  if (relleno !== c.template_code && relleno.length > 3) return `no es el relleno de la ${c.template_code} ni de una cuenta de 3 dígitos`
  return null
}

export function revisarEmpresas(bd, serie) {
  const out = []
  const hojas = { pymes: new Set(), general: new Set() }
  const ramas = { pymes: new Set(), general: new Set() }
  for (const c of serie.cuentas) if (!c.valid_to) (c.is_leaf ? hojas : ramas)[c.plan].add(c.code)
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
    // Colgadas de una cuenta con hijas: solo las genéricas traídas, y con su regla (respuesta 2).
    for (const c of suyas.filter((x) => x.kind === 'own' && !hojas[plan].has(x.template_code))) {
      const m = motivoGenericaMala(c, hojas[plan], ramas[plan])
      if (m) out.push({ nivel: 'rojo', texto: `Empresa · ${yo}: ${c.code} ${m}.` })
    }
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

// ── Planes traídos de otro programa (C02c §6) ───────────────────────────────

/**
 * Lo que trae otro programa no se toca ni deja rastro al deshacerse:
 *   · toda cuenta traída (source 'migrated') conserva su código original: está
 *     entre los códigos leídos del fichero de SU importación, y guarda el nombre
 *     de allí (name_source);
 *   · ningún tercero tiene dos enlaces con el mismo papel en una empresa;
 *   · ningún enlace apunta a una cuenta que ya no existe;
 *   · una importación deshecha no deja nada: ni cuentas ni fichas creadas.
 * Rojo con el caso, y la cuenta (account_id) de la que es (regla 9).
 */
export function revisarImportaciones(bd) {
  const out = []
  const cuentas = bd.company_account ?? []
  const enlaces = bd.company_account_link ?? []
  const importaciones = new Map((bd.importaciones ?? []).map((i) => [i.id, i]))
  const de = (accountId) => `cuenta ${String(accountId).slice(0, 8)}`
  for (const c of cuentas.filter((x) => x.source === 'migrated')) {
    const imp = importaciones.get(c.import_id)
    if (!imp) { out.push({ nivel: 'rojo', texto: `Plan traído · ${de(c.account_id)}: ${c.code} dice venir de otro programa y no tiene importación.` }); continue }
    if (imp.status !== 'traida') out.push({ nivel: 'rojo', texto: `Plan traído · ${de(c.account_id)}: ${c.code} sigue en el plan y su importación está ${imp.status}.` })
    if (!(imp.codigos ?? []).includes(c.code)) out.push({ nivel: 'rojo', texto: `Plan traído · ${de(c.account_id)}: ${c.code} no es ninguno de los códigos que traía el fichero: el código original no se ha conservado.` })
    if (!c.name_source) out.push({ nivel: 'rojo', texto: `Plan traído · ${de(c.account_id)}: ${c.code} no guarda el nombre que tenía en el otro programa.` })
  }
  const vistos = new Map()
  const ids = new Set(cuentas.map((c) => c.id))
  for (const l of enlaces) {
    if (!ids.has(l.company_account_id)) out.push({ nivel: 'rojo', texto: `Enlace · empresa ${String(l.company_id).slice(0, 8)}: un ${l.entity} (${l.role}) apunta a una cuenta que ya no existe.` })
    const k = `${l.company_id}:${l.entity}:${l.entity_id}:${l.role}`
    if (vistos.has(k)) out.push({ nivel: 'rojo', texto: `Enlace · empresa ${String(l.company_id).slice(0, 8)}: el mismo ${l.entity} tiene dos enlaces con el papel ${l.role}.` })
    vistos.set(k, true)
  }
  for (const imp of importaciones.values()) {
    if (imp.status !== 'deshecha') continue
    const quedanCuentas = cuentas.filter((c) => c.import_id === imp.id).length
    const quedanFichas = (bd.proveedores_traidos ?? []).filter((s) => s.import_id === imp.id).length
    if (quedanCuentas || quedanFichas) out.push({ nivel: 'rojo', texto: `Plan traído · ${de(imp.account_id)}: la importación ${String(imp.id).slice(0, 8)} está deshecha y deja ${quedanCuentas} cuentas y ${quedanFichas} fichas.` })
  }
  return out
}
