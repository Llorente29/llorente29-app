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

  // B01r26 (14/11) · ¿Qué números tienen hoy los asientos y las facturas de octubre? ¿Caen en los que
  // eran de lo escrito por la API (4/3155 … 4/3734 y 1/1935 … 1/1965)? Por serie: cuántos, el primero
  // y el último, y cuántos dentro de esos huecos; de las facturas, también si su documento es el de
  // un asiento de octubre (si no, el documento de la factura no es el de su asiento).
  seccion('octubre_numeros')
  const HUECOS: Record<string, [number, number]> = { '4': [3155, 3734], '1': [1935, 1965] }
  const deOctubre = [...diez.values()].filter((a) => mes(a.Fecha ?? 0) === '202610')
  const porSerieOct = new Map<string, number[]>()
  for (const a of deOctubre) porSerieOct.set(String(a.Serie), [...(porSerieOct.get(String(a.Serie)) ?? []), Number(a.Documento ?? 0)])
  for (const [se, ds] of [...porSerieOct].sort()) {
    ds.sort((x, y) => x - y)
    sale(`asientos.s${se}.n`, ds.length); sale(`asientos.s${se}.primero`, ds[0]); sale(`asientos.s${se}.ultimo`, ds[ds.length - 1])
    const h = HUECOS[se]
    if (h) sale(`asientos.s${se}.en_el_hueco_api`, ds.filter((d) => d >= h[0] && d <= h[1]).length)
    const tipos = new Map<number, number>()
    for (const a of deOctubre.filter((x) => String(x.Serie) === se)) tipos.set(Number(a.TipoAsiento ?? -1), (tipos.get(Number(a.TipoAsiento ?? -1)) ?? 0) + 1)
    for (const [t, n] of tipos) sale(`asientos.s${se}.tipo${t < 0 ? 'x' : t}`, n)
  }
  for (const se of Object.keys(HUECOS)) if (!porSerieOct.has(se)) sale(`asientos.s${se}.n`, 0)
  // El último número de cada serie en todo 2026 (para ver si Diez reutiliza números).
  const ultimo = new Map<string, number>()
  for (const a of diez.values()) ultimo.set(String(a.Serie), Math.max(ultimo.get(String(a.Serie)) ?? 0, Number(a.Documento ?? 0)))
  for (const [se, d] of [...ultimo].sort()) sale(`ultimo_2026.s${se}`, d)
  // Las facturas de octubre.
  let fact: Record<string, unknown>[] = []
  try { fact = await c.facturasDelMes('202610') } catch (x) { if (!(x instanceof ErrorDiez && x.status >= 500)) throw x; sale('facturas_500', 1) }
  const keysOct = new Set(deOctubre.map((a) => `${a.Serie}/${a.Documento}`))
  const porSerieF = new Map<string, number[]>()
  for (const f of fact) porSerieF.set(String(f.Serie), [...(porSerieF.get(String(f.Serie)) ?? []), Number(f.Documento ?? 0)])
  for (const [se, ds] of [...porSerieF].sort()) {
    ds.sort((x, y) => x - y)
    sale(`facturas.s${se}.n`, ds.length); sale(`facturas.s${se}.primero`, ds[0]); sale(`facturas.s${se}.ultimo`, ds[ds.length - 1])
    sale(`facturas.s${se}.doc_es_de_un_asiento`, ds.filter((d) => keysOct.has(`${se}/${d}`)).length)
    const h = HUECOS[se]
    if (h) sale(`facturas.s${se}.en_el_hueco_api`, ds.filter((d) => d >= h[0] && d <= h[1]).length)
  }
  // Las emitidas del Excel (serie 1) por tramos de 20, para ver si hay huecos.
  const s1 = (porSerieF.get('1') ?? []).slice().sort((x, y) => x - y)
  let huecos = 0; for (let i = 1; i < s1.length; i++) if (s1[i] !== s1[i - 1] + 1) huecos++
  sale('facturas.s1.saltos', huecos)
  const s2 = (porSerieF.get('2') ?? []).slice().sort((x, y) => x - y)
  let huecos2 = 0; for (let i = 1; i < s2.length; i++) if (s2[i] !== s2[i - 1] + 1) huecos2++
  sale('facturas.s2.saltos', huecos2)

  const envios = s.envios.filter((e) => (e.status === 'enviado' || e.status === 'enlazado') && e.ext)
  sale('sumied.envios_en_diez', envios.length)
  const usados = new Set<string>()
  const tipos = new Map<number, number>()
  const terceroIgual = new Map<number, number>()
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
    // B01r26 (14/11): ¿es la misma factura o asiento aunque Diez reparta el IVA y los gastos en sus
    // subcuentas? La línea del tercero (43/40/41, sin las 47) suma lo mismo y la fecha es la misma.
    let tercero = 0
    if (d) {
      const esTercero = (cc: string) => /^4[0134]/.test(cc) && !/^47/.test(cc)
      const ts = [...netos(ls)].filter(([cc]) => esTercero(cc)).sort().join('|')
      const td = [...netos((d.Detalles ?? []).map((l) => ({ c: String(l.Cuenta ?? '').trim(), d: cent(l.Debe), h: cent(l.Haber) })))].filter(([cc]) => esTercero(cc)).sort().join('|')
      tercero = ts !== '' && ts === td && Number(d.Fecha ?? 0) === Number(a.fecha.replace(/-/g, '')) ? 1 : 0
    }
    if (tipo === 3) terceroIgual.set(tercero, (terceroIgual.get(tercero) ?? 0) + 1)
    if (tipo === 0) continue
    for (const cc of difs) porCuenta.set(cc, (porCuenta.get(cc) ?? 0) + 1)
    if (tipo === 4) continue // solo forma: se cuenta, no se lista
    k++
    const p = `e${k}`
    const [, serie, doc] = e.ext!.split('/')
    sale(`${p}.tipo`, tipo)
    sale(`${p}.tercero_igual`, tercero)
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
  for (const [t, n] of [...terceroIgual].sort()) sale(`tipo3.tercero_igual${t}`, n)
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
