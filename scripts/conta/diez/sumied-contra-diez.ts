// scripts/conta/diez/sumied-contra-diez.ts
//
// B01r·25 (13/11) · SUMIED CONTRA DIEZ, SOLO LEYENDO. Lee la C0008 (solo GET,
// escribir: false) y la compara, aquí en el runner, con lo que el paso anterior
// del workflow leyó de Sumied con conta_lectura (/tmp/sumied.json, que no se
// publica). Tres cosas:
//
//   1b · Lo que hay en Diez desde el 01/10, antes de que Julio lo borre: cada
//        asiento, de qué serie, si viene de Sumied (su referencia en
//        external_send) y, si no, si Sumied tiene el mismo hecho (mismo día y
//        mismas cuentas con los mismos importes; mismo día y total; mismas
//        cuentas y total a ±31 días; nada). Y los PDF de sus facturas.
//   1  · De enero a septiembre: el saldo de cada subcuenta por mes en Diez HOY,
//        contra Sumied y contra la foto del 12/10 (external_entry_snapshot).
//   3  · Las subcuentas que usa Sumied en 2026 y Diez no tiene.
//
// Por la puerta de salida (salidaSegura) solo pasan claves y enteros: series,
// números de documento, fechas AAAAMMDD, códigos de subcuenta y recuentos.
// NINGÚN importe en claro: los de lo que no viene de Sumied salen CIFRADOS con
// la clave del testigo (cifrar.ts), para Julio.
//
//   DIEZ_LECTURA='{…}' SUMIED=/tmp/sumied.json CIFRAR=/tmp/fuera.txt npx tsx scripts/conta/diez/sumied-contra-diez.ts

import { readFileSync, writeFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken, type Apunte, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

type LineaS = [string, number, number] // cuenta, debe y haber en céntimos
type AsientoS = {
  id: string; fecha: string; serie: number; numero: number; estado: string
  anulado: boolean; contra: boolean; ext: string | null; docs: number; lineas: LineaS[]
}
type EnvioS = { entry_id: string; kind: string; status: string; ext: string | null; documento: string | null }
type Sumied = { asientos: AsientoS[]; envios: EnvioS[]; foto: [string, string, number][]; foto_n: [string, number][]; cuentas: string[] }

const di = (k: string, v: number | string) => console.log(`@@ ${k} ${typeof v === 'number' ? Math.trunc(v) : v}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const DESDE = '20261001'

/** Lo que mueve un asiento, por subcuenta y neto (debe − haber), sin ceros: el «hecho». */
function neto(ls: { c: string; d: number; h: number }[]) {
  const m = new Map<string, number>()
  for (const l of ls) m.set(l.c, (m.get(l.c) ?? 0) + l.d - l.h)
  return [...m].filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b))
}
const firma = (n: [string, number][]) => n.map(([c, v]) => `${c}:${v}`).join('|')
const cuentasDe = (n: [string, number][]) => n.map(([c]) => c).join('|')
const total = (n: [string, number][]) => n.reduce((t, [, v]) => t + (v > 0 ? v : 0), 0)
const dias = (a: string, b: string) => Math.abs((Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8)) - Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8))) / 864e5)
const clave = (s: string, d: number) => `s${/^\d{1,3}$/.test(s) ? s : 'x'}_${d}`

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
const S = JSON.parse(readFileSync(process.env.SUMIED || '/tmp/sumied.json', 'utf8')) as Sumied
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  await c.asegurarToken()
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const meses: string[] = []
  for (let m = 1; m <= Number(hoy.slice(4, 6)); m++) meses.push(`2026${String(m).padStart(2, '0')}`)

  // ── Diez: todos los apuntes de 2026, por asiento ─────────────────────────────
  const brutos: Apunte[] = []
  for (const m of meses) brutos.push(...(await c.apuntesDelMes(m)))
  const diez = [...new Map(brutos.map((a) => [`${a.Ejercicio}/${a.Serie}/${a.Documento}`, a])).values()]
    .filter((a) => String(a.Ejercicio) === '2026')
    .map((a) => {
      const n = neto((a.Detalles ?? []).map((l) => ({ c: String(l.Cuenta ?? ''), d: cent(l.Debe), h: cent(l.Haber) })))
      return { ref: `2026/${a.Serie}/${a.Documento}`, serie: String(a.Serie), doc: Number(a.Documento), tipo: Number(a.TipoAsiento ?? 0), fecha: String(a.Fecha ?? ''), n }
    })
  seccion('diez_2026')
  di('asientos', diez.length)
  for (const m of meses) di(`asientos.${m}`, diez.filter((a) => a.fecha.startsWith(m)).length)

  // ── Sumied ───────────────────────────────────────────────────────────────────
  const envioPorRef = new Map(S.envios.filter((e) => e.ext).map((e) => [e.ext as string, e]))
  const sumied = S.asientos.map((a) => ({ ...a, f: a.fecha.replace(/-/g, ''), n: neto(a.lineas.map(([cc, d, h]) => ({ c: cc, d, h }))) }))
  const sumiedPorId = new Map(sumied.map((a) => [a.id, a]))
  const desdeOct = sumied.filter((a) => a.f >= DESDE)

  // ── 1b · Diez desde el 01/10 ─────────────────────────────────────────────────
  const oct = diez.filter((a) => a.fecha >= DESDE)
  seccion('desde_octubre')
  di('asientos', oct.length)
  for (const s of [...new Set(oct.map((a) => a.serie))].sort()) {
    di(`serie_${/^\d{1,3}$/.test(s) ? s : 'x'}`, oct.filter((a) => a.serie === s).length)
    di(`serie_${/^\d{1,3}$/.test(s) ? s : 'x'}.facturas`, oct.filter((a) => a.serie === s && a.tipo !== 0).length)
  }
  const deSumied = oct.filter((a) => envioPorRef.has(a.ref))
  di('de_sumied', deSumied.length)
  let distinto = 0
  for (const a of deSumied) {
    const s = sumiedPorId.get(envioPorRef.get(a.ref)!.entry_id)
    if (!s || firma(s.n) !== firma(a.n)) { distinto++; di(`de_sumied.distinto.${clave(a.serie, a.doc)}`, 1) }
  }
  di('de_sumied.distinto', distinto)
  const enviadosSinDiez = S.envios.filter((e) => e.ext && (e.status === 'enviado' || e.status === 'enlazado') && !diez.some((d) => d.ref === e.ext))
  di('enviados_que_no_estan_en_diez', enviadosSinDiez.length)
  for (const e of enviadosSinDiez) { const [, s, d] = String(e.ext).split('/'); di(`no_en_diez.${clave(s, Number(d))}`, 1) }

  const fuera = oct.filter((a) => !envioPorRef.has(a.ref))
  seccion('no_vienen_de_sumied')
  di('asientos', fuera.length)
  const resumen = [0, 0, 0, 0]
  const cifrado: string[] = ['ref;fecha;tipo;clase;asiento_sumied;subcuenta:neto_en_centimos…']
  for (const a of fuera) {
    let clase = 0
    let s = desdeOct.find((x) => x.f === a.fecha && firma(x.n) === firma(a.n))
    if (s) clase = 1
    else if ((s = desdeOct.find((x) => x.f === a.fecha && total(x.n) === total(a.n)))) clase = 2
    else if ((s = desdeOct.find((x) => dias(x.f, a.fecha) <= 31 && total(x.n) === total(a.n) && cuentasDe(x.n) === cuentasDe(a.n)))) clase = 3
    resumen[clase]++
    const k = `f.${clave(a.serie, a.doc)}`
    di(k, clase)
    di(`${k}.fecha`, Number(a.fecha))
    di(`${k}.tipo`, a.tipo)
    // La subcuenta que más mueve (la de un tercero, si la hay): para buscarlo en Diez.
    const principal = [...a.n].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]) || x[0].localeCompare(y[0]))
    const tercero = principal.find(([cc]) => /^4[0136]/.test(cc)) ?? principal[0]
    if (tercero && /^\d{1,12}$/.test(tercero[0])) di(`${k}.cuenta`, Number(tercero[0]))
    if (s) { di(`${k}.sumied_serie`, s.serie); di(`${k}.sumied_numero`, s.numero) }
    cifrado.push([a.ref, a.fecha, a.tipo, clase, s ? `${s.serie}/${s.numero}` : '', ...a.n.map(([cc, v]) => `${cc}:${v}`)].join(';'))
  }
  di('mismo_asiento_en_sumied', resumen[1])
  di('mismo_dia_y_total', resumen[2])
  di('mismas_cuentas_y_total_31_dias', resumen[3])
  di('nada_en_sumied', resumen[0])
  writeFileSync(process.env.CIFRAR || '/tmp/fuera.txt', cifrado.join('\n') + '\n')

  // ── PDF de las facturas de Diez desde el 01/10 ───────────────────────────────
  const facturas: Factura[] = []
  for (const m of meses.filter((m) => m >= DESDE.slice(0, 6))) facturas.push(...(await c.facturasDelMes(m)))
  seccion('pdf_desde_octubre')
  di('facturas', facturas.length)
  let con = 0, sin = 0, sinContenedor = 0, otro = 0, soloDiez = 0, sumiedSinPdfEnDiez = 0
  for (const f of facturas) {
    const ref = `${f.Ejercicio}/${f.Serie}/${f.Documento}`
    const r = await c.documentoDeFactura(String(f.Ejercicio), String(f.Serie), Number(f.Documento))
    const tiene = r.status === 200 && typeof r.json === 'string' && r.json.length > 100
    const texto = typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? '')
    if (tiene) con++
    else if (/container does not exist/i.test(texto)) { sin++; sinContenedor++ }
    else if (r.status === 200 || r.status === 404 || r.status === 204) sin++
    else otro++
    const e = envioPorRef.get(ref)
    const s = e ? sumiedPorId.get(e.entry_id) : undefined
    if (tiene && !(s && s.docs > 0)) { soloDiez++; di(`solo_en_diez.${clave(String(f.Serie), Number(f.Documento))}`, 1) }
    if (!tiene && s && s.docs > 0) sumiedSinPdfEnDiez++
  }
  di('con_pdf', con)
  di('sin_pdf', sin)
  di('sin_pdf.container_does_not_exist', sinContenedor)
  di('respuesta_rara', otro)
  di('pdf_solo_en_diez', soloDiez)
  di('de_sumied_con_pdf_en_sumied_y_sin_pdf_en_diez', sumiedSinPdfEnDiez)

  // ── 1 · Enero a septiembre: Diez hoy contra Sumied y contra la foto del 12/10 ─
  const suma = (filas: { mes: string; n: [string, number][] }[]) => {
    const m = new Map<string, number>()
    for (const a of filas) for (const [cc, v] of a.n) m.set(`${a.mes}.${cc}`, (m.get(`${a.mes}.${cc}`) ?? 0) + v)
    return m
  }
  const eneSep = (f: string) => f >= '20260101' && f <= '20260930'
  const dHoy = suma(diez.filter((a) => eneSep(a.fecha)).map((a) => ({ mes: a.fecha.slice(0, 6), n: a.n })))
  const sHoy = suma(sumied.filter((a) => eneSep(a.f)).map((a) => ({ mes: a.f.slice(0, 6), n: a.n })))
  const foto = new Map(S.foto.map(([mes, cc, v]) => [`${mes}.${cc}`, v]))
  const claves = new Set([...dHoy.keys(), ...sHoy.keys(), ...foto.keys()])
  seccion('ene_sep')
  let difSumied = 0, cambioDiez = 0
  for (const k of [...claves].sort()) {
    const d = dHoy.get(k) ?? 0, s = sHoy.get(k) ?? 0, f = foto.get(k) ?? 0
    if (d !== f) { cambioDiez++; di(`diez_cambiado.${k}`, 1) }
    if (d !== s) difSumied++
  }
  di('subcuenta_mes.diez_hoy_distinto_de_la_foto', cambioDiez)
  di('subcuenta_mes.diez_hoy_distinto_de_sumied', difSumied)
  for (const [mes, n] of S.foto_n) {
    const hoyN = diez.filter((a) => a.fecha.startsWith(mes)).length
    di(`asientos.${mes}.diez_hoy`, hoyN)
    di(`asientos.${mes}.foto`, n)
  }

  // ── 3 · Subcuentas de Sumied en 2026 que Diez no tiene ───────────────────────
  const deDiez = new Set((await c.subcuentas()).map((x) => String(x.Codigo ?? '')))
  const usadas = new Set(sumied.flatMap((a) => a.lineas.map(([cc]) => cc)))
  const faltan = [...usadas].filter((cc) => !deDiez.has(cc)).sort()
  seccion('subcuentas')
  di('en_diez', deDiez.size)
  di('usadas_en_sumied_2026', usadas.size)
  di('faltan_en_diez', faltan.length)
  for (const cc of faltan) if (/^\d{1,12}$/.test(cc)) di(`falta.${cc}`, 1)
} catch (e) {
  console.log(`Parado: ${(e as Error).message}`)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
