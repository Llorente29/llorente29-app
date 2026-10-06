// scripts/conta/lib/terceros.mjs
//
// Agente «Datos maestros e impuestos», parte del C03 (clientes, plataformas y
// socios de marca). Pura: recibe el apartado `terceros` del volcado de la base
// (agente-datos-maestros.sql) y devuelve hallazgos con el mismo formato que
// coherencia.mjs. SOLO LEE: si algo no cuadra, lo dice; no lo arregla.
//
//   1. NIF válido y único por cuenta (un NIF, un tercero).
//   2. Liquidaciones de plataforma: ventas − comisiones − otros cargos = neto.
//      Una que no cuadra no se cuadra sola (regla 3 del encargo): se dice con
//      su cifra. Ámbar: el fichero es así y lo revisa una persona.
//   3. Ningún tercero con dos subcuentas para el mismo papel en una empresa.
//   4. 347 de ventas: una plataforma que pasa de 3.005,06 € en el año entra en
//      el 347 y necesita su NIF; excluida, con su motivo.
//
// Las reglas son las de la app: el NIF, src/modules/conta/lib/nif.ts; el
// cuadre, src/modules/conta/lib/liquidaciones.ts; el límite,
// src/modules/conta/lib/cuentasProveedor.ts. tests/conta/cumplimiento/terceros.test.ts
// comprueba que dicen lo mismo.

const NORMA_NIF = 'RD 1065/2007, arts. 18–22 (NIF) y Orden EHA/451/2008 (carácter de control)'
const NORMA_347 = 'RD 1065/2007, arts. 31–35: operaciones con terceros por encima de 3.005,06 € al año'
const NORMA_CUENTAS = 'RD 1514/2007: una subcuenta por tercero y papel'
const NORMA_NETO = 'Encargo C03, regla 3: una liquidación que no cuadra se enseña con su diferencia, no se cuadra sola'

/** 3.005,06 € en céntimos: el mismo número que LIMITE_347 de la app. */
export const LIMITE_347 = 300506

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'
const LETRAS_CIF = 'JABCDEFGHI'

/** La misma regla que validarNifEs (src/modules/conta/lib/nif.ts), sin el motivo. */
export function nifValido(entrada) {
  let s = String(entrada ?? '').toUpperCase().replace(/[\s.\-_/]/g, '')
  if (s.startsWith('ES') && s.length === 11) s = s.slice(2)
  if (s.length !== 9) return false
  const dni = (n) => LETRAS_DNI[n % 23]
  if (/^\d{8}[A-Z]$/.test(s)) return dni(Number(s.slice(0, 8))) === s[8]
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return dni(Number('XYZ'.indexOf(s[0]) + s.slice(1, 8))) === s[8]
  if (/^[KLM]\d{7}[A-Z]$/.test(s)) return dni(Number(s.slice(1, 8))) === s[8]
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    let a = 0, b = 0
    for (let i = 0; i < 7; i++) {
      const d = Number(s[i + 1])
      if (i % 2 === 1) a += d
      else { const x = d * 2; b += Math.floor(x / 10) + (x % 10) }
    }
    const c = (10 - ((a + b) % 10)) % 10
    const u = s[8]
    if ('PQRSNW'.includes(s[0])) return u === LETRAS_CIF[c]
    if ('ABEH'.includes(s[0])) return u === String(c)
    return u === LETRAS_CIF[c] || u === String(c)
  }
  return false
}

const centimos = (v) => Math.round(Number(v) * 100)
const abs = (v) => Math.abs(Number(v ?? 0))
/** 300506 → «3.005,06 €» (es-ES no agrupa los miles con cuatro cifras: se hace a mano). */
const euros = (c) => {
  const [e, d] = (Math.abs(c) / 100).toFixed(2).split('.')
  return `${c < 0 ? '−' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d} €`
}

/**
 * El mismo cuadre que cuadre() de la app: costes en valor absoluto (los
 * ficheros traen signos distintos), en céntimos. null si falta ventas o neto.
 */
export function descuadre(l) {
  if (l.gross_sales == null || l.net_payout == null) return null
  const otros = (l.otros ?? []).reduce((s, x) => s + centimos(abs(x)), 0)
  const calculado = centimos(l.gross_sales) - centimos(abs(l.commission)) - otros
  return centimos(l.net_payout) - calculado
}

/**
 * bd.terceros: { terceros: [{ account_id, id, name, tax_id, tax_id_type, archived }],
 *                cuentas: [{ account_id, company_id, entity, entity_id, role, codes: [] }],
 *                liquidaciones: [{ account_id, id, party_id, ref, gross_sales, commission, otros, net_payout, needs_review }],
 *                ventas_anio: [{ account_id, party_id, anio, ventas }],
 *                excluidos_347: [{ account_id, party_id, motivo }] }
 */
export function revisarTerceros(t) {
  if (!t) return []
  const out = []
  const nombre = new Map((t.terceros ?? []).map((x) => [x.id, x]))
  const donde = (id, cuenta) => `${nombre.get(id)?.name ?? id} (cuenta ${cuenta})`

  // 1 · NIF válido y único por cuenta.
  const porNif = new Map()
  for (const x of t.terceros ?? []) {
    if (!x.tax_id) continue
    const espanol = !x.tax_id_type || x.tax_id_type === 'nif_es'
    if (espanol && !nifValido(x.tax_id)) {
      out.push({ nivel: 'rojo', tipo: 'nif_invalido', donde: donde(x.id, x.account_id), detalle: `El NIF ${x.tax_id} no es válido.`, norma: NORMA_NIF })
    }
    const k = `${x.account_id}|${x.tax_id}`
    porNif.set(k, [...(porNif.get(k) ?? []), x])
  }
  for (const [k, xs] of porNif) {
    if (xs.length < 2) continue
    const [cuenta, nif] = k.split('|')
    out.push({ nivel: 'rojo', tipo: 'nif_repetido', donde: `cuenta ${cuenta}`, detalle: `El NIF ${nif} está en ${xs.length} terceros: ${xs.map((x) => x.name).join(', ')}. Un NIF, un tercero.`, norma: NORMA_NIF })
  }

  // 2 · Neto = ventas − comisiones − otros cargos.
  const porCuenta = new Map()
  for (const l of t.liquidaciones ?? []) {
    const d = descuadre(l)
    if (d == null || d === 0) continue
    porCuenta.set(l.account_id, [...(porCuenta.get(l.account_id) ?? []), { ...l, d }])
  }
  for (const [cuenta, ls] of porCuenta) {
    const ej = ls.slice(0, 3).map((l) => `${l.ref ?? l.id}: ${l.d > 0 ? 'llegan' : 'faltan'} ${euros(Math.abs(l.d))}`).join('; ')
    out.push({ nivel: 'ambar', tipo: 'neto_descuadrado', donde: `cuenta ${cuenta}`,
      detalle: `${ls.length === 1 ? '1 liquidación no cuadra' : `${ls.length} liquidaciones no cuadran`} (ventas − comisiones − otros ≠ neto). ${ej}${ls.length > 3 ? '…' : '.'} Se enseñan «con diferencia».`, norma: NORMA_NETO })
  }

  // 3 · Dos subcuentas para el mismo tercero y papel.
  for (const c of t.cuentas ?? []) {
    if ((c.codes ?? []).length < 2) continue
    out.push({ nivel: 'rojo', tipo: 'dos_subcuentas', donde: donde(c.entity_id, c.account_id),
      detalle: `Tiene ${c.codes.length} subcuentas como ${c.entity === 'customer' ? 'cliente' : 'proveedor'} en la misma empresa: ${c.codes.join(', ')}.`, norma: NORMA_CUENTAS })
  }

  // 4 · 347 de ventas.
  const excluido = new Map((t.excluidos_347 ?? []).map((x) => [`${x.account_id}|${x.party_id}`, x.motivo]))
  for (const v of t.ventas_anio ?? []) {
    const c = centimos(v.ventas)
    if (c <= LIMITE_347) continue
    const k = `${v.account_id}|${v.party_id}`
    if (excluido.has(k)) {
      if (!excluido.get(k)) out.push({ nivel: 'rojo', tipo: 'excluido_sin_motivo', donde: donde(v.party_id, v.account_id), detalle: `Le ha vendido ${euros(c)} en ${v.anio} y está fuera del 347 sin motivo.`, norma: NORMA_347 })
      continue
    }
    const x = nombre.get(v.party_id)
    if (!x?.tax_id) out.push({ nivel: 'rojo', tipo: '347_sin_nif', donde: donde(v.party_id, v.account_id), detalle: `Le ha vendido ${euros(c)} en ${v.anio}: entra en el 347 de ventas y no tiene NIF.`, norma: NORMA_347 })
  }
  return out
}

export const TITULO_TERCEROS = {
  nif_invalido: 'NIF que no es válido',
  nif_repetido: 'Un NIF en dos terceros',
  dos_subcuentas: 'Dos subcuentas para el mismo papel',
  excluido_sin_motivo: 'Fuera del 347 sin motivo',
  '347_sin_nif': 'En el 347 de ventas sin NIF',
}

export function informeTerceros(hallazgos, { tercerosMirados, liquidacionesMiradas }) {
  const l = ['## Clientes, plataformas y socios de marca', '']
  l.push(`Revisados ${tercerosMirados} terceros y ${liquidacionesMiradas} liquidaciones de plataforma.`, '')
  if (hallazgos.length === 0) {
    l.push('**Todo cuadra.** Cada NIF es válido y está en un solo tercero, cada liquidación cuadra (ventas − comisiones − otros = neto), nadie tiene dos subcuentas para el mismo papel y quien entra en el 347 de ventas tiene su NIF.', '')
    return l.join('\n')
  }
  const rojos = hallazgos.filter((x) => x.nivel === 'rojo')
  const ambar = hallazgos.filter((x) => x.nivel === 'ambar')
  if (rojos.length) {
    l.push(`🔴 **${rojos.length === 1 ? 'Un fallo' : `${rojos.length} fallos`}.** No se ha cambiado nada.`, '')
    for (const x of rojos) l.push(`- **${TITULO_TERCEROS[x.tipo] ?? x.tipo} · ${x.donde}**: ${x.detalle} _(${x.norma})_`)
    l.push('')
  }
  if (ambar.length) {
    l.push(`🟠 **${ambar.length === 1 ? 'Un aviso' : `${ambar.length} avisos`}** (no abre incidencia).`, '')
    for (const x of ambar) l.push(`- **${x.donde}**: ${x.detalle} _(${x.norma})_`)
    l.push('')
  }
  return l.join('\n')
}
