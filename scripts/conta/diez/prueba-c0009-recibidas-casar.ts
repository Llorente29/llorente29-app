// scripts/conta/diez/prueba-c0009-recibidas-casar.ts
//
// B01r26 (14/11, segundo ensayo) · ¿POR QUÉ NO CASAN LAS RECIBIDAS? «Ya lo he
// importado» enlazó 149 de las 188 recibidas que Diez importó del Excel. Casa por
// serie 2, número de factura (sin espacios, puntos, guiones ni «/», en mayúsculas)
// y subcuenta del proveedor (esLaMisma, diezTraspasoExcel.ts). SOLO LEE
// (escribir: false) la C0009 y la compara con las recibidas de octubre de Sumied
// (/tmp/recibidas.json, leído antes con conta_lectura): para cada una que no casa,
// cuál de los campos no es igual (número, subcuenta, NIF, fecha contable, fecha
// de la factura, total) y cómo es el número de Diez (más corto, cortado…).
// Por la puerta de salida: solo «@@ clave número|huella» (los números y NIF, en huella).
//
//   DIEZ_LECTURA='{…}' RECIBIDAS_JSON=… npx tsx scripts/conta/diez/prueba-c0009-recibidas-casar.ts

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ClienteDiez, ErrorDiez, limitesMes, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const sale = (k: string, v: number | string) => console.log(`@@ ${k} ${typeof v === 'number' ? Math.trunc(v) : v}`)
const seccion = (t: string) => console.log(`@@ # ${t}`)
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('sin_secreto', 1); process.exit(1) }

type Rec = { n: string | null; cta: string | null; fc: string; ff: string | null; t: number | string | null; b?: number | string | null; iva?: number | string | null; nif: string | null; es: string | null; doc: number | null }
let sumied: Rec[] = []
try { sumied = JSON.parse(readFileSync(process.env.RECIBIDAS_JSON || '/tmp/recibidas.json', 'utf8')) ?? [] } catch { sale('sin_sumied', 1); process.exit(1) }

// La misma normalización que esLaMisma (diezTraspasoExcel.ts) y la del NIF.
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.\-/]/g, '')
const normNif = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.\-/]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '')
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const dia = (iso: string | null) => (iso ? Number(iso.slice(0, 10).replace(/-/g, '')) : 0)
const huella = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const prefijo = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }

let g: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0009',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

async function delMes(aaaamm: string): Promise<Factura[]> {
  try { return await c.facturasDelMes(aaaamm) } catch (x) { if (!(x instanceof ErrorDiez && x.status >= 500)) throw x }
  const [a, b] = limitesMes(aaaamm); const out: Factura[] = []
  for (let d = a; d <= b; d++) out.push(...await c.todas<Factura>(`/api/facturas?$filter=${encodeURIComponent(`Fecha ge ${d} and Fecha le ${d}`)}`))
  return out
}

try {
  await c.asegurarToken()
  const diez = [...await delMes('202610'), ...await delMes('202611')].filter((f) => String(f.Serie) === '2')
  seccion('resumen')
  sale('diez_recibidas', diez.length)
  sale('diez_doc_min', Math.min(...diez.map((f) => Number(f.Documento ?? 0))))
  sale('diez_doc_max', Math.max(...diez.map((f) => Number(f.Documento ?? 0))))
  sale('sumied_recibidas', sumied.length)

  const porNum = new Map<string, Factura[]>()
  for (const f of diez) porNum.set(norm(f.NumeroFactura), [...(porNum.get(norm(f.NumeroFactura)) ?? []), f])
  const usadas = new Set<Factura>()
  const motivos = new Map<string, number>()
  let casan = 0, k = 0
  const noEstan: Rec[] = []
  seccion('no_casan')
  for (const s of sumied) {
    const n = norm(s.n)
    const cta = digitos(s.cta)
    const exacta = (porNum.get(n) ?? []).find((f) => digitos(f.CuentaCliente) === cta)
    if (exacta) { casan++; usadas.add(exacta); continue }
    // ¿Cuál es en Diez? Por el número; si no, por el total y la fecha contable; si no, por el total y la de la factura.
    let f = (porNum.get(n) ?? [])[0]
    let como = 1
    if (!f) { como = 2; f = diez.find((d) => !usadas.has(d) && cent(d.TotalFactura) === cent(s.t) && Number(d.Fecha) === dia(s.fc)) as Factura }
    if (!f) { como = 3; f = diez.find((d) => !usadas.has(d) && cent(d.TotalFactura) === cent(s.t) && Number(d.FechaFactura) === dia(s.ff)) as Factura }
    if (!f) { como = 4; f = diez.find((d) => !usadas.has(d) && cent(d.TotalFactura) === cent(s.t) && digitos(d.CuentaCliente) === cta) as Factura }
    k++
    const p = `r${k}`
    sale(`${p}.sumied_cta`, Number(cta || 0))
    sale(`${p}.sumied_estado`, s.es === 'enlazado' ? 1 : s.es === 'enviado' ? 2 : s.es === 'pendiente' ? 3 : 0)
    sale(`${p}.sumied_fc`, dia(s.fc))
    sale(`${p}.sumied_ff`, dia(s.ff))
    sale(`${p}.sumied_len`, n.length)
    sale(`${p}.sumied_nf`, huella(n))
    if (!f) { sale(`${p}.en_diez`, 0); motivos.set('no_esta', (motivos.get('no_esta') ?? 0) + 1); noEstan.push(s); continue }
    usadas.add(f)
    const dn = norm(f.NumeroFactura)
    const r = {
      num: dn === n ? 1 : 0, cta: digitos(f.CuentaCliente) === cta ? 1 : 0, nif: normNif(f.CifCliente) === normNif(s.nif) ? 1 : 0,
      fc: Number(f.Fecha) === dia(s.fc) ? 1 : 0, ff: Number(f.FechaFactura) === dia(s.ff) ? 1 : 0, total: cent(f.TotalFactura) === cent(s.t) ? 1 : 0,
    }
    sale(`${p}.encontrada_por`, como)
    sale(`${p}.doc`, Number(f.Documento ?? 0))
    sale(`${p}.diez_cta`, Number(digitos(f.CuentaCliente) || 0))
    sale(`${p}.diez_fecha`, Number(f.Fecha ?? 0))
    sale(`${p}.diez_ff`, Number(f.FechaFactura ?? 0))
    sale(`${p}.diez_len`, dn.length)
    sale(`${p}.diez_nf`, huella(dn))
    sale(`${p}.prefijo_comun`, prefijo(dn, n))
    sale(`${p}.diez_es_el_principio`, n.startsWith(dn) && dn.length < n.length ? 1 : 0)
    sale(`${p}.diez_es_el_final`, n.endsWith(dn) && dn.length < n.length ? 1 : 0)
    for (const [kk, v] of Object.entries(r)) sale(`${p}.igual_${kk}`, v)
    const m = Object.entries(r).filter(([, v]) => v === 0).map(([kk]) => kk).join('_') || 'nada'
    motivos.set(m, (motivos.get(m) ?? 0) + 1)
  }
  // Segunda pasada (14/11): las de Sumied que no están y las de Diez que no tienen pareja, por subcuenta y fecha.
  // Del total, solo cómo se relaciona (igual, la base, la cuota, cambiado de signo, cuántas milésimas), nunca el importe.
  seccion('parejas')
  const sueltasDiez = diez.filter((f) => !usadas.has(f))
  let q = 0
  const relaciones = new Map<string, number>()
  for (const s of noEstan) {
    const cta = digitos(s.cta)
    const cand = sueltasDiez.filter((d) => digitos(d.CuentaCliente) === cta)
    const f = cand.find((d) => Number(d.Fecha) === dia(s.fc)) ?? cand.find((d) => Number(d.FechaFactura) === dia(s.ff)) ?? cand[0]
    q++
    const p = `p${q}`
    sale(`${p}.cta`, Number(cta || 0))
    sale(`${p}.sumied_estado`, s.es === 'pendiente' ? 3 : s.es ? 1 : 0)
    sale(`${p}.candidatas_misma_cta`, cand.length)
    if (!f) { relaciones.set('sin_candidata', (relaciones.get('sin_candidata') ?? 0) + 1); continue }
    sueltasDiez.splice(sueltasDiez.indexOf(f), 1)
    const n = norm(s.n); const dn = norm(f.NumeroFactura)
    const td = cent(f.TotalFactura), ts = cent(s.t), bs = cent(s.b), is_ = cent(s.iva)
    const rel = td === ts ? 'total' : td === bs ? 'base' : td === is_ ? 'cuota' : td === -ts ? 'menos_total' : td === -bs ? 'menos_base' : 'otro'
    relaciones.set(rel, (relaciones.get(rel) ?? 0) + 1)
    sale(`${p}.doc`, Number(f.Documento ?? 0))
    sale(`${p}.misma_fecha_contable`, Number(f.Fecha) === dia(s.fc) ? 1 : 0)
    sale(`${p}.misma_fecha_factura`, Number(f.FechaFactura) === dia(s.ff) ? 1 : 0)
    sale(`${p}.diez_fecha`, Number(f.Fecha ?? 0))
    sale(`${p}.sumied_fc`, dia(s.fc))
    sale(`${p}.sumied_len`, n.length)
    sale(`${p}.diez_len`, dn.length)
    sale(`${p}.prefijo_comun`, prefijo(dn, n))
    sale(`${p}.diez_es_el_principio`, n.startsWith(dn) && dn.length < n.length ? 1 : 0)
    sale(`${p}.diez_es_el_final`, n.endsWith(dn) && dn.length < n.length ? 1 : 0)
    sale(`${p}.sumied_dentro_de_diez`, dn.includes(n) && dn.length > n.length ? 1 : 0)
    sale(`${p}.mismo_nif`, normNif(f.CifCliente) === normNif(s.nif) ? 1 : 0)
    sale(`${p}.total_${rel}`, 1)
    if (ts) sale(`${p}.total_milesimas`, Math.round((td / ts) * 1000))
  }
  for (const [m, v] of [...relaciones].sort()) sale(`relacion.${m}`, v)
  sale('diez_sueltas_sin_pareja', sueltasDiez.length)

  seccion('cuantas')
  sale('casan', casan)
  sale('no_casan', k)
  for (const [m, v] of [...motivos].sort()) sale(`distinto.${m}`.slice(0, 48), v)
  sale('diez_sin_su_sumied', diez.filter((f) => !usadas.has(f)).length)
} catch (e) {
  sale('parado', e instanceof ErrorDiez ? e.status : 1)
  process.exit(1)
}
sale('peticiones', c.metrica.peticiones)
