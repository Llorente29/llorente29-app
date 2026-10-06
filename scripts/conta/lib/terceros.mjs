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
//   4. 347 de una plataforma, según CÓMO vende (party_role.platform_model, lo
//      dice su contrato; C03 respuesta 2). RD 1065/2007, art. 34.3:
//      · revendedor (en nombre propio): entra como CLIENTE por las ventas; por
//        encima de 3.005,06 € necesita su NIF.
//      · comisionista (en nombre ajeno): entra como PROVEEDOR solo por su
//        comisión; las ventas a consumidores no van (art. 33.2.a).
//      · sin decir: no se asume ninguno. Si las ventas pasan del límite, se
//        avisa en ámbar para que se diga en la ficha.
//      Excluida, con su motivo.
//
// Las reglas son las de la app: el NIF, src/modules/conta/lib/nif.ts; el
// cuadre, src/modules/conta/lib/liquidaciones.ts; el límite,
// src/modules/conta/lib/cuentasProveedor.ts. tests/conta/cumplimiento/terceros.test.ts
// comprueba que dicen lo mismo.

const NORMA_NIF = 'RD 1065/2007, arts. 18–22 (NIF) y Orden EHA/451/2008 (carácter de control)'
const NORMA_347 = 'RD 1065/2007, arts. 31–35: operaciones con terceros por encima de 3.005,06 € al año'
const NORMA_347_REVENDEDOR = 'RD 1065/2007, art. 34.3, párrafo 2.º (en nombre propio: recibe y entrega por sí misma)'
const NORMA_347_COMISIONISTA = 'RD 1065/2007, art. 34.3 (en nombre ajeno: solo su comisión) y art. 33.2.a (ventas con ticket, fuera)'
const NORMA_347_MODELO = 'RD 1065/2007, art. 34.3: depende de si la plataforma actúa en nombre del restaurante o en el suyo'
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

/**
 * La misma regla que alcance347Plataforma (src/modules/conta/lib/plataforma347.ts),
 * en euros como ella. Comisionista: la comisión sin IVA ya pasa → entra; con el
 * IVA general podría pasar → null («lo dirán sus facturas»); si no, no entra.
 */
export function alcance347Plataforma(modelo, ventas, comisiones) {
  if (!modelo) return { como: 'sin_decir' }
  if (modelo === 'revendedor') return { como: 'cliente', entra: centimos(ventas) > LIMITE_347, importe: Number(ventas) }
  const base = centimos(abs(comisiones))
  const entra = base > LIMITE_347 ? true : Math.round(base * 1.21) > LIMITE_347 ? null : false
  return { como: 'proveedor', entra, importe: abs(comisiones) }
}
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
 *                ventas_anio: [{ account_id, party_id, anio, ventas, comisiones, modelo }],
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

  // 4 · 347 de una plataforma, según su modelo.
  const excluido = new Map((t.excluidos_347 ?? []).map((x) => [`${x.account_id}|${x.party_id}`, x.motivo]))
  for (const v of t.ventas_anio ?? []) {
    const a = alcance347Plataforma(v.modelo ?? null, v.ventas ?? 0, v.comisiones ?? 0)
    const ventas = centimos(v.ventas ?? 0)
    // Lo que la acerca al 347: sin modelo, las ventas (el caso que obliga a preguntar).
    const pasa = a.como === 'sin_decir' ? ventas > LIMITE_347 : a.entra !== false
    if (!pasa) continue
    const k = `${v.account_id}|${v.party_id}`
    const lugar = donde(v.party_id, v.account_id)
    if (excluido.has(k)) {
      if (!excluido.get(k)) out.push({ nivel: 'rojo', tipo: 'excluido_sin_motivo', donde: lugar, detalle: `Le ha vendido ${euros(ventas)} en ${v.anio} y está fuera del 347 sin motivo.`, norma: NORMA_347 })
      continue
    }
    const sinNif = !nombre.get(v.party_id)?.tax_id
    if (a.como === 'sin_decir') {
      out.push({ nivel: 'ambar', tipo: '347_modelo_sin_decir', donde: lugar,
        detalle: `Le ha vendido ${euros(ventas)} en ${v.anio} y su ficha no dice si es comisionista o revendedor: según su contrato, entra en el 347 como cliente (por las ventas) o como proveedor (solo por su comisión). No se asume ninguno.${sinNif ? ' Y no tiene NIF.' : ''}`,
        norma: NORMA_347_MODELO })
      continue
    }
    if (!sinNif) continue
    if (a.como === 'cliente') {
      out.push({ nivel: 'rojo', tipo: '347_sin_nif', donde: lugar, detalle: `Le ha vendido ${euros(ventas)} en ${v.anio}: como revendedora, entra en el 347 de ventas y no tiene NIF.`, norma: NORMA_347_REVENDEDOR })
    } else {
      const c = centimos(a.importe)
      out.push(a.entra
        ? { nivel: 'rojo', tipo: '347_proveedor_sin_nif', donde: lugar, detalle: `Le ha cobrado ${euros(c)} de comisiones (sin IVA) en ${v.anio}: como comisionista, entra en el 347 como proveedor y no tiene NIF.`, norma: NORMA_347_COMISIONISTA }
        : { nivel: 'ambar', tipo: '347_proveedor_sin_nif', donde: lugar, detalle: `Le ha cobrado ${euros(c)} de comisiones sin IVA en ${v.anio}: con su IVA puede pasar de 3.005,06 € (lo dirán sus facturas) y no tiene NIF.`, norma: NORMA_347_COMISIONISTA })
    }
  }
  return out
}

export const TITULO_TERCEROS = {
  nif_invalido: 'NIF que no es válido',
  nif_repetido: 'Un NIF en dos terceros',
  dos_subcuentas: 'Dos subcuentas para el mismo papel',
  excluido_sin_motivo: 'Fuera del 347 sin motivo',
  '347_sin_nif': 'En el 347 de ventas sin NIF',
  '347_proveedor_sin_nif': 'En el 347 como proveedor sin NIF',
}

export function informeTerceros(hallazgos, { tercerosMirados, liquidacionesMiradas }) {
  const l = ['## Clientes, plataformas y socios de marca', '']
  l.push(`Revisados ${tercerosMirados} terceros y ${liquidacionesMiradas} liquidaciones de plataforma.`, '')
  if (hallazgos.length === 0) {
    l.push('**Todo cuadra.** Cada NIF es válido y está en un solo tercero, cada liquidación cuadra (ventas − comisiones − otros = neto), nadie tiene dos subcuentas para el mismo papel y quien entra en el 347 —como cliente si revende, como proveedor si cobra comisión— tiene su NIF.', '')
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
