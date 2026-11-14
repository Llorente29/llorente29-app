// scripts/conta/diez/prueba-c0009-revision.ts
//
// B01r26 (14/11) · LA C0009 DESPUÉS DEL ENSAYO DE OCTUBRE, antes de que Julio la
// borre desde el 01/10. SOLO LEE (escribir: false), con la API de Diez, y lo casa
// con Sumied (producción, leído antes con conta_lectura en /tmp/sumied.json):
//   1 · los asientos desde el 01/10 con alguna línea sin subcuenta: cuáles, de
//       dónde vienen y qué cuentas llevan las demás líneas;
//   2 · los duplicados: por sus líneas (mismo día y mismas cuentas e importes),
//       por número de factura y por concepto y fecha, con el origen de cada copia;
//   3 · las subcuentas de prueba: las que la C0009 tiene y la C0008 no, quién las
//       creó (por las pruebas que las nombran) y si las usa algún asiento.
// El origen de cada asiento (los envíos del ensayo los quitó la vuelta atrás):
//   1 Excel · emitida (factura con documento, casa con una venta del día)
//   2 Excel · recibida (factura con documento, casa con una recibida)
//   3 API · factura (casa con Sumied y no tiene documento)
//   4 API · asiento general (sin factura, casa con un asiento de Sumied por sus líneas)
//   5 casa con Sumied por la fecha y el total, no por el número ni las líneas
//   6 no casa con Sumied (anterior al ensayo, de otra prueba o metido a mano)
// Por la puerta de salida: solo «@@ clave número|huella». Ni NIF, ni nombres, ni
// textos, ni importes: los números de factura y los conceptos salen como huella.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-revision.ts

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ClienteDiez, ErrorDiez, limitesMes, type AlmacenToken, type Apunte, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { unoPorAsiento } from '../../../supabase/functions/_shared/diezApunte.ts'

const sale = (k: string, v: number | string) => console.log(`@@ ${k} ${typeof v === 'number' ? Math.trunc(v) : v}`)
const seccion = (t: string) => console.log(`@@ # ${t}`)
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('sin_secreto', 1); process.exit(1) }

type LineaS = { c: string; d: number | string; h: number | string }
type EntradaS = { id: string; fecha: string; origen: string; estado: string; lineas: LineaS[] | null; nums: string[] | null }
let sumied: EntradaS[] = []
try { sumied = JSON.parse(readFileSync(process.env.SUMIED_JSON || '/tmp/sumied.json', 'utf8')) ?? [] } catch { sale('sin_sumied', 1) }

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.\-/_]/g, '')
const huella = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const firma = (xs: readonly { Cuenta?: string; Debe?: number; Haber?: number }[]) =>
  xs.filter((l) => cent(l.Debe) !== 0 || cent(l.Haber) !== 0).map((l) => `${String(l.Cuenta ?? '').trim()}:${cent(l.Debe)}:${cent(l.Haber)}`).sort().join('|')
const total = (xs: readonly { Debe?: number }[]) => xs.reduce((t, l) => t + cent(l.Debe), 0)
const clave = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || 'x'

// Sumied: por líneas (fecha + firma), por número de factura y por fecha + total.
const sPorFirma = new Map<string, EntradaS>()
const sPorNumero = new Map<string, EntradaS>()
const sPorTotal = new Map<string, EntradaS[]>()
for (const e of sumied) {
  if (e.estado !== 'validado') continue
  const ls = (e.lineas ?? []).map((l) => ({ Cuenta: l.c, Debe: Number(l.d), Haber: Number(l.h) }))
  const f = Number(e.fecha.replace(/-/g, ''))
  sPorFirma.set(`${f}|${firma(ls)}`, e)
  for (const n of e.nums ?? []) if (n) sPorNumero.set(norm(n), e)
  const k = `${f}|${total(ls)}`
  sPorTotal.set(k, [...(sPorTotal.get(k) ?? []), e])
}

// Quién creó cada subcuenta de prueba, por las pruebas que las nombran (scripts/conta/diez).
const AUTOR: Record<string, number> = {}
const de = (n: number, xs: string[]) => { for (const x of xs) AUTOR[x] ??= n }
// 1 C04b (prueba-c0009-subcuentas.ts, R5) · 2 C06b (prueba-c0009-promociones.ts) · 3 C12 (c12-excel-*.mjs) · 4 el ensayo («Crearlas», 14/11)
de(1, ['47700010', '70800003', '70800007', '70800008'])
de(2, ['70009002', '70500001'])
de(3, ['43000990', '40000990'])
de(4, ['40000019', '40700001', '41000042', '41000043', '41000044', '41000046', '47200004', '47200010', '47200021', '62300004', '70009001', '70009003'])

const almacen = (): AlmacenToken => {
  let g: { token: string; expiresAt: string } | null = null
  return { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
}
const cliente = (bd: string) => new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: bd,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen: almacen(), escribir: false, pausaMs: 150,
})
const c9 = cliente('C0009')

// Las facturas del mes: el mes entero (1) y, si Diez da 500, día a día (2), contando los días que no deja leer.
// (Sola, sin facturasDelMesComoSePueda del #673, para correr desde main antes de que se fusione.)
async function facturasComoSePueda(aaaamm: string): Promise<{ facturas: Factura[]; como: number; diasSinLeer: number }> {
  const es500 = (x: unknown) => x instanceof ErrorDiez && x.status >= 500
  try { return { facturas: await c9.facturasDelMes(aaaamm), como: 1, diasSinLeer: 0 } } catch (x) { if (!es500(x)) throw x }
  const [a, b] = limitesMes(aaaamm)
  const facturas: Factura[] = []; let sin = 0
  for (let d = a; d <= b; d++) {
    try { facturas.push(...await c9.todas<Factura>(`/api/facturas?$filter=${encodeURIComponent(`Fecha ge ${d} and Fecha le ${d}`)}`)) } catch (x) { if (!es500(x)) throw x; sin++; sale(`d${d}.facturas_500`, 1) }
  }
  return { facturas, como: 2, diasSinLeer: sin }
}
const c8 = cliente('C0008')

try {
  await c9.asegurarToken()
  seccion('resumen')
  sale('sumied_asientos', sumied.length)
  // Los apuntes desde el 01/10 (octubre y noviembre) y las facturas de esos meses.
  const brutos: Apunte[] = []
  const facturas: Factura[] = []
  for (const mes of ['202610', '202611']) {
    brutos.push(...await c9.apuntesDelMes(mes, { fresco: true }))
    const f = await facturasComoSePueda(mes)
    facturas.push(...f.facturas)
    sale(`m${mes}.facturas_como`, f.como)
    sale(`m${mes}.facturas_dias_sin_leer`, f.diasSinLeer)
  }
  const apuntes = unoPorAsiento(brutos)
  sale('apuntes_filas', brutos.length)
  sale('apuntes', apuntes.length)
  sale('facturas', facturas.length)

  // Los campos que trae Diez (para saber si dice cuándo o cómo se creó cada uno).
  seccion('campos')
  const campos = new Set<string>()
  for (const a of apuntes.slice(0, 50)) for (const k of Object.keys(a)) campos.add(`ap.${clave(k)}`)
  for (const a of apuntes.slice(0, 50)) for (const l of a.Detalles ?? []) for (const k of Object.keys(l)) campos.add(`apl.${clave(k)}`)
  for (const f of facturas.slice(0, 50)) for (const k of Object.keys(f)) campos.add(`fa.${clave(k)}`)
  for (const k of [...campos].sort()) sale(k, 1)

  // La factura de cada asiento (por ejercicio, serie y documento) y si lleva documento (el PDF).
  const kAs = (x: { Ejercicio?: unknown; Serie?: unknown; Documento?: unknown }) => `${x.Ejercicio ?? ''}|${x.Serie}|${x.Documento}`
  const facturaDe = new Map<string, Factura>()
  for (const f of facturas) facturaDe.set(kAs(f), f)
  const conDocumento = (f: Factura) => Object.entries(f).some(([k, v]) => /url|archivo|adjunt|fichero|pdf|nombredoc/i.test(k) && v != null && String(v).trim() !== '' && String(v) !== '0' && String(v) !== 'false')

  const origenDe = (a: Apunte): number => {
    const f = facturaDe.get(kAs(a))
    const det = a.Detalles ?? []
    const porNum = f ? sPorNumero.get(norm(f.NumeroFactura)) : undefined
    const porFirma = sPorFirma.get(`${a.Fecha}|${firma(det)}`)
    const porTotal = (sPorTotal.get(`${a.Fecha}|${total(det)}`) ?? []).length > 0
      || (f ? (sPorTotal.get(`${f.FechaFactura ?? f.Fecha}|${cent(f.TotalFactura)}`) ?? []).length > 0 : false)
    const e = porNum ?? porFirma
    if (f && e) return conDocumento(f) ? (e.origen === 'supplier_invoice' ? 2 : 1) : 3
    if (!f && porFirma) return 4
    if (porTotal) return 5
    return 6
  }

  // 1 · Los asientos con alguna línea sin subcuenta.
  seccion('sin_cuenta')
  let nSin = 0
  const porOrigenSin = new Map<number, number>()
  for (const a of apuntes) {
    const det = a.Detalles ?? []
    const sin = det.filter((l) => !String(l.Cuenta ?? '').trim())
    if (!sin.length) continue
    nSin++
    const o = origenDe(a)
    porOrigenSin.set(o, (porOrigenSin.get(o) ?? 0) + 1)
    if (nSin > 60) continue
    const p = `s${a.Serie}d${a.Documento}`
    sale(`${p}.fecha`, Number(a.Fecha ?? 0))
    sale(`${p}.tipo`, Number(a.TipoAsiento ?? 0))
    sale(`${p}.origen`, o)
    sale(`${p}.lineas`, det.length)
    sale(`${p}.lineas_sin`, sin.length)
    sale(`${p}.sin_al_debe`, sin.filter((l) => cent(l.Debe) !== 0).length)
    sale(`${p}.sin_a_cero`, sin.filter((l) => cent(l.Debe) === 0 && cent(l.Haber) === 0).length)
    const f = facturaDe.get(kAs(a))
    sale(`${p}.factura`, f ? 1 : 0)
    if (f) { sale(`${p}.nf`, huella(norm(f.NumeroFactura))); sale(`${p}.pdf`, conDocumento(f) ? 1 : 0) }
    const otras = [...new Set(det.map((l) => String(l.Cuenta ?? '').trim()).filter(Boolean))].slice(0, 8)
    otras.forEach((cta, i) => { if (/^\d{1,15}$/.test(cta)) sale(`${p}.cuenta${i + 1}`, Number(cta)) })
  }
  sale('asientos_sin_cuenta', nSin)
  for (const [o, n] of [...porOrigenSin].sort()) sale(`sin_cuenta.origen${o}`, n)

  // 2 · Los duplicados.
  seccion('duplicados')
  let g = 0
  const grupo = (como: string, xs: Apunte[]) => {
    g++
    const p = `g${g}`
    sale(`${p}.${como}`, 1)
    sale(`${p}.copias`, xs.length)
    xs.forEach((a, i) => {
      const q = `${p}.c${i + 1}`
      sale(`${q}.serie`, Number(a.Serie ?? 0))
      sale(`${q}.doc`, Number(a.Documento ?? 0))
      sale(`${q}.fecha`, Number(a.Fecha ?? 0))
      sale(`${q}.origen`, origenDe(a))
      const f = facturaDe.get(kAs(a))
      sale(`${q}.factura`, f ? 1 : 0)
      if (f) { sale(`${q}.pdf`, conDocumento(f) ? 1 : 0); sale(`${q}.nf`, huella(norm(f.NumeroFactura))) }
    })
  }
  const agrupar = (k: (a: Apunte) => string | null) => {
    const m = new Map<string, Apunte[]>()
    for (const a of apuntes) { const x = k(a); if (x) m.set(x, [...(m.get(x) ?? []), a]) }
    return [...m.values()].filter((xs) => xs.length > 1)
  }
  const porLineas = agrupar((a) => (a.Detalles?.length ? `${a.Fecha}|${firma(a.Detalles)}` : null))
  for (const xs of porLineas) grupo('por_lineas', xs)
  const vistos = new Set(porLineas.flat().map(kAs))
  const porNumero = agrupar((a) => { const f = facturaDe.get(kAs(a)); return f && norm(f.NumeroFactura) ? `${f.Serie}|${norm(f.NumeroFactura)}|${norm(f.CuentaCliente)}` : null })
  for (const xs of porNumero) if (!xs.every((a) => vistos.has(kAs(a)))) { grupo('por_numero', xs); xs.forEach((a) => vistos.add(kAs(a))) }
  const porConcepto = agrupar((a) => (norm(a.Descripcion) ? `${a.Fecha}|${norm(a.Descripcion)}|${total(a.Detalles ?? [])}` : null))
  for (const xs of porConcepto) if (!xs.every((a) => vistos.has(kAs(a)))) grupo('por_concepto', xs)
  sale('grupos_por_lineas', porLineas.length)
  sale('grupos_por_numero', porNumero.length)
  sale('grupos_por_concepto', porConcepto.length)
  sale('grupos_listados', g)

  // El origen de todos, para la tabla.
  seccion('origen')
  const porOrigen = new Map<number, number>()
  for (const a of apuntes) { const o = origenDe(a); porOrigen.set(o, (porOrigen.get(o) ?? 0) + 1) }
  for (const [o, n] of [...porOrigen].sort()) sale(`origen${o}`, n)
  const sinCasarSumied = sumied.filter((e) => e.estado === 'validado' && e.fecha >= '2026-10-01')
  sale('sumied_validados_desde_0110', sinCasarSumied.length)

  // 3 · Las subcuentas de prueba: en la C0009 y no en la C0008.
  seccion('subcuentas')
  await c8.asegurarToken()
  const s9 = await c9.subcuentas()
  const s8 = new Set((await c8.subcuentas()).map((x) => String(x.Codigo ?? '').trim()))
  sale('c0009', s9.length)
  sale('c0008', s8.size)
  const usadas = new Map<string, number>()
  for (const a of apuntes) for (const l of a.Detalles ?? []) { const k = String(l.Cuenta ?? '').trim(); if (k) usadas.set(k, (usadas.get(k) ?? 0) + 1) }
  let nuevas = 0
  for (const x of s9) {
    const k = String(x.Codigo ?? '').trim()
    if (!/^\d{8}$/.test(k)) continue
    const prueba = /prueba|test|folvy|sumied|inventad|ficticio|demo/i.test(String(x.Descripcion ?? ''))
    if (s8.has(k) && !prueba) continue
    nuevas++
    sale(`n${k}.solo_c0009`, s8.has(k) ? 0 : 1)
    sale(`n${k}.nombre_de_prueba`, prueba ? 1 : 0)
    sale(`n${k}.autor`, AUTOR[k] ?? 0)
    sale(`n${k}.lineas_desde_0110`, usadas.get(k) ?? 0)
  }
  sale('subcuentas_listadas', nuevas)
} catch (e) {
  sale('parado', e instanceof ErrorDiez ? e.status : 1)
  process.exit(1)
}
sale('peticiones', c9.metrica.peticiones + c8.metrica.peticiones)
