// scripts/conta/diez/c07-bancos-c0008.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10) · ¿YA ESTÁN EN C0008 LOS
// ASIENTOS DE BANCO DE SUMIED?, SOLO LEYENDO.
//
// La gestoría mete el banco en Diez como asientos generales de la serie 4 (en la
// C0009, copia de la C0008: 3.135, dos de cada tres con la 572). Sumied también
// los hace en su serie 4. Si Sumied los manda y la gestoría ya los tiene, Diez
// quedaría con dos. Antes de escribir nada, se cuenta:
//   · cuántos asientos de banco de Sumied (validados y propuestos) tienen en la
//     C0008 un asiento con la misma fecha y las mismas líneas (cuenta, debe y
//     haber) — «el mismo»;
//   · cuántos tienen el mismo día y el mismo total pero otras cuentas;
//   · cuántos no tienen nada parecido.
// Y cuántos asientos generales hay en la C0008 en esos meses, por serie.
//
// Frenos: el cliente con escribir: false sobre C0008 (solo GET). Los asientos de
// Sumied los lee el paso anterior del workflow con conta_lectura y se quedan en
// /tmp: no se publican. A la salida, solo «@@ clave número».
//
//   DIEZ_LECTURA='{…}' BANCOS=/tmp/bancos.json npx tsx scripts/conta/diez/c07-bancos-c0008.ts

import { readFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente.ts'

const di = (k: string, v: number) => console.log(`@@ ${k} ${Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)

type LineaF = { cuenta: string; debe: number; haber: number }
type AsientoF = { estado: string; fecha: string; lineas: LineaF[] }
type Ap = { Ejercicio?: string; Serie?: string; Documento?: number; TipoAsiento?: number; Fecha?: number; Detalles?: { Cuenta?: string; Debe?: number; Haber?: number }[] }

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const firma = (xs: { c: string; d: number; h: number }[]) => xs.map((l) => `${l.c}:${l.d}:${l.h}`).sort().join('|')
const total = (xs: { d: number }[]) => xs.reduce((t, l) => t + l.d, 0)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
const folvy = JSON.parse(readFileSync(process.env.BANCOS || '/tmp/bancos.json', 'utf8')) as AsientoF[] | null
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  const xs = folvy ?? []
  seccion('sumied')
  di('bancos', xs.length)
  di('bancos.validados', xs.filter((a) => a.estado === 'validado').length)
  di('bancos.propuestos', xs.filter((a) => a.estado === 'propuesto').length)
  const meses = [...new Set(xs.map((a) => a.fecha.slice(0, 7).replace('-', '')))].sort()
  di('meses', meses.length)

  await c.asegurarToken()
  const todos: Ap[] = []
  for (const m of meses) todos.push(...((await c.apuntesDelMes(m)) as unknown as Ap[]))
  const unicos = [...new Map(todos.map((a) => [`${a.Ejercicio}/${a.Serie}/${a.Documento}`, a])).values()]
  const generales = unicos.filter((a) => Number(a.TipoAsiento) === 0)
  seccion('c0008')
  di('generales', generales.length)
  for (const s of [...new Set(generales.map((a) => String(a.Serie)))].sort()) di(`generales.serie_${/^\d{1,3}$/.test(s) ? s : 'texto'}`, generales.filter((a) => String(a.Serie) === s).length)

  const deDiez = generales.map((a) => {
    const ls = (a.Detalles ?? []).map((l) => ({ c: String(l.Cuenta ?? ''), d: cent(l.Debe), h: cent(l.Haber) }))
    return { fecha: String(a.Fecha ?? ''), serie: String(a.Serie), firma: firma(ls), total: total(ls) }
  })
  seccion('comparar')
  let mismo = 0, mismoDiaTotal = 0, nada = 0, mismoEnSerie4 = 0, masDeUno = 0
  for (const a of xs) {
    const ls = a.lineas.map((l) => ({ c: String(l.cuenta), d: cent(l.debe), h: cent(l.haber) }))
    const f = a.fecha.replace(/-/g, '')
    const iguales = deDiez.filter((d) => d.fecha === f && d.firma === firma(ls))
    if (iguales.length) {
      mismo++
      if (iguales.some((d) => d.serie === '4')) mismoEnSerie4++
      if (iguales.length > 1) masDeUno++
    } else if (deDiez.some((d) => d.fecha === f && d.total === total(ls))) mismoDiaTotal++
    else nada++
  }
  di('el_mismo', mismo)
  di('el_mismo.en_serie_4', mismoEnSerie4)
  di('el_mismo.mas_de_uno', masDeUno)
  di('mismo_dia_y_total_otras_cuentas', mismoDiaTotal)
  di('nada_parecido', nada)
} catch (e) {
  console.log(`Parado: ${(e as Error).message}`)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
