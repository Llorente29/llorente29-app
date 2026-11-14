// scripts/conta/diez/octubre-contra-c0008.ts
//
// B01r26 (14/11) · EL TRASPASO DE OCTUBRE A LA C0008 NO CUADRA: ¿QUÉ FALTA O ESTÁ
// DISTINTO? SOLO LEE (escribir: false) la C0008 y la compara con Sumied
// (/tmp/sumied.json, el mismo de sumied-contra-diez.sql, leído antes con
// conta_lectura). Para cada envío de Sumied en «enviado» o «enlazado» (los del
// traspaso de octubre), su asiento en Diez —buscado en TODOS los meses de 2026,
// por si Diez lo puso con otra fecha—:
//   1 no está en Diez · 2 está con la fecha en otro mes · 3 sus cuentas no suman
//   lo mismo · 4 suman lo mismo, pero con el debe y el haber de otra forma
//   (un negativo al debe en vez de al haber) · 0 igual.
// Y lo que Diez tiene de octubre sin ningún envío de Sumied, y lo validado de
// octubre en Sumied que no ha viajado. Por la puerta: claves, cuentas, números
// de asiento y de documento; ningún importe ni ningún texto.
//
//   DIEZ_LECTURA='{…}' SUMIED=/tmp/sumied.json npx tsx scripts/conta/diez/octubre-contra-c0008.ts

import { readFileSync } from 'node:fs'
import { ClienteDiez, ErrorDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { unoPorAsiento } from '../../../supabase/functions/_shared/diezApunte.ts'

const sale = (k: string, v: number | string) => console.log(`@@ ${k} ${typeof v === 'number' ? Math.trunc(v) : v}`)
const seccion = (t: string) => console.log(`@@ # ${t}`)
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('sin_secreto', 1); process.exit(1) }

type AsientoS = { id: string; fecha: string; serie: number; numero: number | null; estado: string; anulado: boolean; contra: boolean; lineas: [string, number, number][] | null }
type EnvioS = { entry_id: string; kind: string; status: string; ext: string | null; documento: string | null }
const s = JSON.parse(readFileSync(process.env.SUMIED || '/tmp/sumied.json', 'utf8')) as { asientos: AsientoS[]; envios: EnvioS[] }
const porId = new Map(s.asientos.map((a) => [a.id, a]))

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const mes = (x: string | number) => String(x).replace(/-/g, '').slice(0, 6)
/** Lo que suma cada cuenta (debe − haber, en céntimos), sin las que dan cero. */
function netos(ls: readonly { c: string; d: number; h: number }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of ls) if (l.c) m.set(l.c, (m.get(l.c) ?? 0) + l.d - l.h)
  for (const [k, v] of m) if (v === 0) m.delete(k)
  return m
}
const firmaCruda = (ls: readonly { c: string; d: number; h: number }[]) => ls.filter((l) => l.d || l.h).map((l) => `${l.c}:${l.d}:${l.h}`).sort().join('|')

let g: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  await c.asegurarToken()
  // Todo 2026 de Diez, por ejercicio, serie y documento (un asiento puede estar en otro mes).
  const diez = new Map<string, Apunte>()
  const porMes = new Map<string, number>()
  for (let m = 1; m <= 12; m++) {
    const aaaamm = `2026${String(m).padStart(2, '0')}`
    const xs = unoPorAsiento(await c.apuntesDelMes(aaaamm, { fresco: true }))
    porMes.set(aaaamm, xs.length)
    for (const a of xs) diez.set(`${a.Ejercicio ?? '2026'}/${a.Serie}/${a.Documento}`, a)
  }
  seccion('resumen')
  for (const [k, v] of porMes) sale(`diez.m${k}`, v)
  sale('diez.asientos_2026', diez.size)

  const envios = s.envios.filter((e) => (e.status === 'enviado' || e.status === 'enlazado') && e.ext)
  sale('sumied.envios_en_diez', envios.length)
  const usados = new Set<string>()
  const tipos = new Map<number, number>()
  const porCuenta = new Map<string, number>()
  seccion('distintos')
  let k = 0
  for (const e of envios) {
    const a = porId.get(e.entry_id)
    if (!a) continue
    const d = diez.get(e.ext!)
    const ls = (a.lineas ?? []).map(([cc, de, ha]) => ({ c: cc, d: de, h: ha }))
    let tipo = 0; let difs: string[] = []
    if (!d) tipo = 1
    else {
      usados.add(e.ext!)
      const ld = (d.Detalles ?? []).map((l) => ({ c: String(l.Cuenta ?? '').trim(), d: cent(l.Debe), h: cent(l.Haber) }))
      const ns = netos(ls); const nd = netos(ld)
      difs = [...new Set([...ns.keys(), ...nd.keys()])].filter((cc) => (ns.get(cc) ?? 0) !== (nd.get(cc) ?? 0)).sort()
      if (mes(d.Fecha ?? 0) !== mes(a.fecha)) tipo = 2
      else if (difs.length) tipo = 3
      else if (firmaCruda(ls) !== firmaCruda(ld)) tipo = 4
    }
    tipos.set(tipo, (tipos.get(tipo) ?? 0) + 1)
    if (tipo === 0) continue
    for (const cc of difs) porCuenta.set(cc, (porCuenta.get(cc) ?? 0) + 1)
    if (tipo === 4) continue // solo forma: se cuenta, no se lista
    k++
    const p = `e${k}`
    const [, serie, doc] = e.ext!.split('/')
    sale(`${p}.tipo`, tipo)
    sale(`${p}.sumied_serie`, a.serie)
    sale(`${p}.sumied_numero`, a.numero ?? 0)
    sale(`${p}.sumied_fecha`, Number(a.fecha.replace(/-/g, '')))
    sale(`${p}.diez_serie`, Number(serie))
    sale(`${p}.diez_doc`, Number(doc))
    if (d) sale(`${p}.diez_fecha`, Number(d.Fecha ?? 0))
    difs.slice(0, 6).forEach((cc, i) => { if (/^\d{1,15}$/.test(cc)) sale(`${p}.cuenta${i + 1}`, Number(cc)) })
  }
  seccion('por_tipo')
  for (const [t, n] of [...tipos].sort()) sale(`tipo${t}`, n)
  seccion('cuentas_con_diferencia')
  for (const [cc, n] of [...porCuenta].sort()) if (/^\d{1,15}$/.test(cc)) sale(`c${cc}`, n)

  // Lo que Diez tiene de octubre sin ningún envío de Sumied (los asientos «iguales» de banco, por ejemplo).
  seccion('octubre_solo_en_diez')
  const soloDiez = [...diez.entries()].filter(([ref, a]) => mes(a.Fecha ?? 0) === '202610' && !usados.has(ref))
  sale('n', soloDiez.length)
  const porSerie = new Map<string, number>()
  for (const [, a] of soloDiez) porSerie.set(String(a.Serie), (porSerie.get(String(a.Serie)) ?? 0) + 1)
  for (const [se, n] of [...porSerie].sort()) sale(`serie${se}`, n)
  soloDiez.slice(0, 80).forEach(([, a], i) => { sale(`o${i + 1}.serie`, Number(a.Serie ?? 0)); sale(`o${i + 1}.doc`, Number(a.Documento ?? 0)); sale(`o${i + 1}.fecha`, Number(a.Fecha ?? 0)) })

  // Lo validado de octubre en Sumied que no ha viajado.
  seccion('octubre_sin_viajar')
  const conEnvio = new Set(envios.map((e) => e.entry_id))
  const sinViajar = s.asientos.filter((a) => mes(a.fecha) === '202610' && a.estado === 'validado' && !a.anulado && !conEnvio.has(a.id))
  sale('n', sinViajar.length)
  // Cada una, buscada en TODO 2026 de Diez entre lo que no es de ningún envío: por sus cuentas e
  // importes (igual) o, si no, por la línea del proveedor o cliente (4xx) con el mismo importe.
  // Dónde está (fecha y documento), o que no está.
  const libres = [...diez.entries()].filter(([ref]) => !usados.has(ref))
  const tomados = new Set<string>()
  const como = new Map<string, number>()
  const mesesDeDiez = new Map<string, number>()
  sinViajar.slice(0, 120).forEach((a, i) => {
    const p = `v${i + 1}`
    sale(`${p}.serie`, a.serie); sale(`${p}.numero`, a.numero ?? 0); sale(`${p}.fecha`, Number(a.fecha.replace(/-/g, '')))
    const ls = (a.lineas ?? []).map(([cc, de, ha]) => ({ c: cc, d: de, h: ha }))
    const ns = netos(ls)
    const clave = [...ns].sort(([x], [y]) => x.localeCompare(y)).map(([cc, v]) => `${cc}:${v}`).join('|')
    const ter = [...ns].find(([cc]) => /^4[0134]/.test(cc) && !/^47/.test(cc))
    let hallado = libres.find(([ref, d]) => !tomados.has(ref) && [...netos((d.Detalles ?? []).map((l) => ({ c: String(l.Cuenta ?? '').trim(), d: cent(l.Debe), h: cent(l.Haber) })))].sort(([x], [y]) => x.localeCompare(y)).map(([cc, v]) => `${cc}:${v}`).join('|') === clave)
    let forma = 1
    if (!hallado && ter) {
      forma = 2
      hallado = libres.find(([ref, d]) => !tomados.has(ref) && netos((d.Detalles ?? []).map((l) => ({ c: String(l.Cuenta ?? '').trim(), d: cent(l.Debe), h: cent(l.Haber) }))).get(ter[0]) === ter[1])
    }
    if (!hallado) { sale(`${p}.en_diez`, 0); como.set('no_esta', (como.get('no_esta') ?? 0) + 1); return }
    const [ref, d] = hallado
    tomados.add(ref)
    const [, serie, doc] = ref.split('/')
    sale(`${p}.en_diez`, forma)
    sale(`${p}.diez_serie`, Number(serie)); sale(`${p}.diez_doc`, Number(doc)); sale(`${p}.diez_fecha`, Number(d.Fecha ?? 0))
    const m = mes(d.Fecha ?? 0)
    mesesDeDiez.set(m, (mesesDeDiez.get(m) ?? 0) + 1)
    como.set(forma === 1 ? 'igual' : 'por_el_tercero', (como.get(forma === 1 ? 'igual' : 'por_el_tercero') ?? 0) + 1)
  })
  for (const [k2, v] of [...como].sort()) sale(`sin_viajar.${k2}`, v)
  for (const [k2, v] of [...mesesDeDiez].sort()) sale(`sin_viajar.en_diez_m${k2}`, v)
} catch (e) {
  sale('parado', e instanceof ErrorDiez ? e.status : 1)
  process.exit(1)
}
sale('peticiones', c.metrica.peticiones)
