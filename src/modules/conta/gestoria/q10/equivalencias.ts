// src/modules/conta/gestoria/q10/equivalencias.ts
//
// Q10 · respuesta 1 · LA TABLA DE EQUIVALENCIAS (lo que confirma Julio antes de mandar nada a Cegid) y el código de
// cliente de Cegid de cada ficha. Puro: no lee nada.
//
// 1. El código de cliente de Cegid de cada ficha (nunca por nombre):
//      · por su 430 en Sumied: 43000167 → el cliente 167 de Cegid, si existe allí; y se mira que el NIF sea el mismo;
//      · si no tiene 430 (la autónoma no tiene ninguna), por su NIF entre los clientes de Cegid: si hay uno solo;
//      · si no, sin código (va a «Pendiente de revisar» en el cuadre).
// 2. La familia de cada concepto de GoCardless (el nombre de la suscripción): «GESTORIA MENSUAL», «GESTION
//    LABORAL» (uno por trabajador), «CONTASIMPLE SOFTWARE»…; lo que no es de ninguna, su propio nombre.
// 3. La propuesta de concepto de Cegid de cada familia, por lo que YA PASÓ: en las facturas de Cegid del año de cada
//    cliente, la línea cuyo importe con su IVA es el del cobro de GoCardless de esa familia vota por su concepto; y
//    también los conceptos fijos de su ficha. Gana el que más votos tiene; los demás se enseñan, con sus votos.
//    De ese concepto: en qué serie sale (la de sus facturas) y si lleva retención (sus líneas), medido, no supuesto.
// Nada de esto se manda: es lo que Julio mira y confirma.

type Fila = Record<string, unknown>

export interface FichaCodigo { partyId: string; nif: string | null; cuenta430: string | null; /** Respuesta 4 · el código de cliente de «Clientes y cuotas» (conta_cobro_cliente.codigo_cliente): manda. */ codigo?: number | null }
export interface ClienteCegidQ { codigo: number; nombre: string | null; nif: string | null; conceptos: { codigoConcepto: string | null; descripcion: string | null; totalLinea: number | null; importe: number | null; cantidad: number | null }[] | null }
export interface ConceptoCegidQ { codigo: string; descripcion: string | null; porIva: number | null; conRetencion: boolean | null }
export interface FacturaCegidQ { serie: string; codigo: number; cliente: number | null; total: number | null; retencion: number; porcentajeRetencion?: number | null; lineas: Fila[] }

export const nifQ = (n: string | null | undefined) => (n ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ES(?=[0-9A-Z]{9}$)/, '')

export type ComoAtado = 'codigo' | '430' | '430_nif_distinto' | 'nif' | 'sin'
export interface CodigoCegid { codigo: number | null; como: ComoAtado; porque: string }

/** El código de cliente de Cegid de cada ficha. */
export function codigosCegid(fichas: readonly FichaCodigo[], clientes: readonly ClienteCegidQ[]): Map<string, CodigoCegid> {
  const porCodigo = new Map(clientes.map((c) => [c.codigo, c]))
  const porNif = new Map<string, ClienteCegidQ[]>()
  for (const c of clientes) { const k = nifQ(c.nif); if (k) porNif.set(k, [...(porNif.get(k) ?? []), c]) }
  const r = new Map<string, CodigoCegid>()
  for (const f of fichas) {
    // Respuesta 4 · El código del cliente, en un solo sitio (X14): si la ficha lo tiene en «Clientes y cuotas», es ése.
    if (f.codigo != null) {
      r.set(f.partyId, { codigo: f.codigo, como: 'codigo', porque: porCodigo.has(f.codigo) ? `Su código de cliente es el ${f.codigo} de Cegid.` : `Su código de cliente es el ${f.codigo}: aún no está en lo leído de Cegid (vuelve a leer).` })
      continue
    }
    const m = f.cuenta430 ? /^430(\d+)$/.exec(f.cuenta430) : null
    const cod = m ? Number(m[1]) : null
    const c = cod !== null ? porCodigo.get(cod) : undefined
    if (c) {
      const igual = !f.nif || !c.nif || nifQ(f.nif) === nifQ(c.nif)
      r.set(f.partyId, igual ? { codigo: c.codigo, como: '430', porque: `Su 430 (${f.cuenta430}) es el cliente ${c.codigo} de Cegid.` }
        : { codigo: c.codigo, como: '430_nif_distinto', porque: `Su 430 (${f.cuenta430}) es el cliente ${c.codigo} de Cegid, pero en Cegid tiene otro NIF: mira cuál está bien.` })
      continue
    }
    const k = nifQ(f.nif)
    const xs = k ? porNif.get(k) ?? [] : []
    if (xs.length === 1) { r.set(f.partyId, { codigo: xs[0].codigo, como: 'nif', porque: `Por su NIF: es el cliente ${xs[0].codigo} de Cegid.` }); continue }
    r.set(f.partyId, { codigo: null, como: 'sin', porque: xs.length > 1 ? `Su NIF está en ${xs.length} clientes de Cegid (${xs.map((x) => x.codigo).join(', ')}): no se adivina.`
      : f.cuenta430 ? `Su 430 (${f.cuenta430}) no es ningún cliente de Cegid, y su NIF tampoco.` : 'No tiene 430 en Sumied y su NIF no es de ningún cliente de Cegid.' })
  }
  return r
}

const FAMILIAS: [RegExp, string][] = [
  [/GESTI[OÓ]N LABORAL|N[OÓ]MINA/, 'GESTION LABORAL'],
  [/CONTA ?SIMPLE/, 'CONTASIMPLE SOFTWARE'],
  [/VIGILANCIA/, 'VIGILANCIA DE NOTIFICACIONES'],
  [/\bRENTA\b/, 'RENTA'],
  [/SERVICIOS? MENSUALES/, 'SERVICIOS MENSUALES'],
  [/SERVICIOS? (DE )?GESTOR[IÍ]A/, 'SERVICIOS GESTORIA'],
  [/GESTOR[IÍ]AL? MENSUAL/, 'GESTORIA MENSUAL'],
]
/** La familia de un concepto de GoCardless; uno que no es de ninguna, su nombre tal cual. */
export function familia(nombre: string | null | undefined): string {
  const u = (nombre ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!u) return '(sin suscripción)'
  for (const [re, f] of FAMILIAS) if (re.test(u)) return f
  return u
}

export interface CobroQ { partyId: string | null; importe: number; concepto: string | null }
export interface Candidato { codigo: string; descripcion: string | null; votos: number }
export interface FilaEquivalencia {
  familia: string
  cobros: number
  importeCent: number
  /** Ejemplos de cómo se llama en GoCardless (hasta 3). */
  ejemplos: string[]
  propuesta: Candidato | null
  otros: Candidato[]
  /** De cuántos clientes de esta familia hay pruebas en Cegid. */
  clientesConPrueba: number
  clientes: number
  /** La serie en la que sale ese concepto en las facturas (la más frecuente) y cuántas veces. */
  serie: { serie: string; veces: number; de: number } | null
  /** Si lleva retención: de sus líneas en las facturas; si no hay líneas, lo que dice el concepto. */
  retencion: { si: number; de: number } | { delConcepto: boolean | null } | null
}

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)

/** La tabla de equivalencias, por familia de GoCardless (de más a menos euros). */
export function tablaEquivalencias(cobros: readonly CobroQ[], codigos: ReadonlyMap<string, CodigoCegid>, clientes: readonly ClienteCegidQ[],
  conceptos: readonly ConceptoCegidQ[], facturas: readonly FacturaCegidQ[]): FilaEquivalencia[] {
  const conc = new Map(conceptos.map((c) => [c.codigo, c]))
  const cli = new Map(clientes.map((c) => [c.codigo, c]))
  const factDe = new Map<number, FacturaCegidQ[]>()
  for (const f of facturas) if (f.cliente !== null) factDe.set(f.cliente, [...(factDe.get(f.cliente) ?? []), f])
  const grupos = new Map<string, CobroQ[]>()
  for (const c of cobros) { const k = familia(c.concepto); grupos.set(k, [...(grupos.get(k) ?? []), c]) }
  const filas: FilaEquivalencia[] = []
  for (const [fam, xs] of grupos) {
    // Un voto por CLIENTE y concepto: un cliente con varios trabajadores (varios cobros) no vota varias veces.
    const votantes = new Map<string, Set<number>>()
    const clientesFam = new Set<number>(), conPrueba = new Set<number>()
    for (const c of xs) {
      const cod = c.partyId ? codigos.get(c.partyId)?.codigo ?? null : null
      if (cod === null) continue
      clientesFam.add(cod)
      const objetivo = cent(c.importe)
      const vistos = new Set<string>()
      // Las líneas de sus facturas cuyo importe con IVA (por unidad o la línea entera) es el del cobro.
      for (const f of factDe.get(cod) ?? []) {
        for (const l of f.lineas) {
          const k = String(l.codigoConcepto ?? '').trim()
          if (!k) continue
          const pct = Number(l.porcentajeIva ?? 21)
          // Con retención (la línea la lleva y la factura dice su porcentaje), lo cobrado es base + IVA − retención.
          const ret = l.llevaRetencion === true ? Number(f.porcentajeRetencion ?? 0) : 0
          const cobrado = (x: unknown) => Math.round(cent(x) * (1 + pct / 100 - ret / 100))
          const unidades = Number(l.cantidad ?? 1) || 1
          if ([cobrado(l.importe), cobrado(Number(l.total ?? l.importe) / unidades), cobrado(l.total)].some((v) => Math.abs(v - objetivo) <= 1)) vistos.add(k)
        }
      }
      // Y los conceptos fijos de su ficha.
      for (const k of cli.get(cod)?.conceptos ?? []) {
        const codigo = String(k.codigoConcepto ?? '').trim()
        if (!codigo) continue
        const total = k.totalLinea ?? (k.importe ?? 0) * (k.cantidad ?? 1)
        const porUnidad = k.importe ?? total
        if ([total, porUnidad].some((v) => Math.abs(Math.round(cent(v) * 1.21) - objetivo) <= 1)) vistos.add(codigo)
      }
      if (vistos.size) conPrueba.add(cod)
      for (const k of vistos) votantes.set(k, (votantes.get(k) ?? new Set<number>()).add(cod))
    }
    const cands = [...votantes.entries()].map(([codigo, quienes]) => ({ codigo, descripcion: conc.get(codigo)?.descripcion ?? null, votos: quienes.size }))
      .sort((a, b) => b.votos - a.votos || a.codigo.localeCompare(b.codigo))
    const propuesta = cands[0] ?? null
    let serie: FilaEquivalencia['serie'] = null, retencion: FilaEquivalencia['retencion'] = null
    if (propuesta) {
      const series = new Map<string, number>()
      let lineas = 0, conRet = 0
      for (const f of facturas) {
        const ls = f.lineas.filter((l) => String(l.codigoConcepto ?? '').trim() === propuesta.codigo)
        if (!ls.length) continue
        series.set(f.serie, (series.get(f.serie) ?? 0) + 1)
        lineas += ls.length
        conRet += ls.filter((l) => l.llevaRetencion === true).length
      }
      const de = [...series.values()].reduce((t, n) => t + n, 0)
      const top = [...series.entries()].sort((a, b) => b[1] - a[1])[0]
      serie = top ? { serie: top[0], veces: top[1], de } : null
      retencion = lineas ? { si: conRet, de: lineas } : { delConcepto: conc.get(propuesta.codigo)?.conRetencion ?? null }
    }
    filas.push({
      familia: fam, cobros: xs.length, importeCent: xs.reduce((t, c) => t + cent(c.importe), 0),
      ejemplos: [...new Set(xs.map((c) => (c.concepto ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 3),
      propuesta, otros: cands.slice(1, 4), clientesConPrueba: conPrueba.size, clientes: clientesFam.size, serie, retencion,
    })
  }
  return filas.sort((a, b) => b.importeCent - a.importeCent || a.familia.localeCompare(b.familia))
}

/** El resumen de los códigos de cliente, en una frase (para comprobar «el 430 es el código de Cegid»). */
export function resumenCodigos(codigos: ReadonlyMap<string, CodigoCegid>): { frase: string; por: Record<ComoAtado, number> } {
  const por: Record<ComoAtado, number> = { codigo: 0, '430': 0, '430_nif_distinto': 0, nif: 0, sin: 0 }
  for (const c of codigos.values()) por[c.como]++
  const total = codigos.size
  const frase = `De ${total} fichas atadas: ${por.codigo ? `${por.codigo} con su código de cliente atado a mano, ` : ''}${por['430']} con su 430 igual al código de Cegid (y el mismo NIF), ${por['430_nif_distinto']} con el código pero otro NIF en Cegid, `
    + `${por.nif} por su NIF y ${por.sin} sin código de Cegid.`
  return { frase, por }
}

/**
 * La retención de cada ficha, de su ÚLTIMA factura en Cegid (la de número más alto del año): su porcentaje, o 0 si
 * no llevaba. Una ficha sin código de Cegid o sin facturas no está: no se sabe (va a «Pendiente de revisar»).
 */
export function retencionesDeCegid(codigos: ReadonlyMap<string, CodigoCegid>, facturas: readonly (FacturaCegidQ & { porcentajeRetencion?: number | null; fecha?: number | null })[]): Map<string, number> {
  const ultima = new Map<number, (typeof facturas)[number]>()
  for (const f of facturas) {
    if (f.cliente === null) continue
    const ya = ultima.get(f.cliente)
    if (!ya || (f.fecha ?? 0) > (ya.fecha ?? 0) || ((f.fecha ?? 0) === (ya.fecha ?? 0) && f.codigo > ya.codigo)) ultima.set(f.cliente, f)
  }
  const r = new Map<string, number>()
  for (const [party, c] of codigos) {
    const f = c.codigo === null ? undefined : ultima.get(c.codigo)
    if (!f) continue
    if (!f.retencion) r.set(party, 0)
    else if (f.porcentajeRetencion) r.set(party, Number(f.porcentajeRetencion))
  }
  return r
}
