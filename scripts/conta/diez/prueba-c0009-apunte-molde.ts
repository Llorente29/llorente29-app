// scripts/conta/diez/prueba-c0009-apunte-molde.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10) · CÓMO GUARDA DIEZ LOS
// ASIENTOS QUE NO SON FACTURAS, SOLO LEYENDO (C0009).
//
// Hoy Sumied solo manda facturas (/api/facturas/add): las ventas del día, las
// recibidas y sus anulaciones. El banco, los manuales y las liquidaciones de
// impuestos no son facturas: irán por /api/apuntes/add, que nunca se ha usado
// para escribir. Antes de escribir nada, lo que ya hay en la C0009:
//   · cuántos asientos hay de cada TipoAsiento (0 generales, 1 expedidas,
//     2 recibidas, 3 apertura, 4 regularización, 5 cierre) y en qué series;
//   · de los generales (0), por serie: cuántos, el primer y el último número
//     (Documento) del ejercicio, si los números van seguidos y cuántas líneas
//     llevan;
//   · cuántos tocan la 572 (bancos) y cuántos las 47 (impuestos);
//   · cuántos tienen «gemelo» al revés (las mismas cuentas con el debe y el
//     haber cambiados y el mismo total): así se anula en Diez si se hace con
//     un contraasiento;
//   · el catálogo de series (cuántas y cuáles son numéricas).
//
// Frenos: la base es C0009; el cliente se crea con escribir: false; la salida
// es solo «@@ clave número» y el workflow la pasa por salida-segura.mjs. Ni
// importes, ni textos, ni cuentas de terceros, ni NIF.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-apunte-molde.ts

import { ClienteDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0009'
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

type Linea = { Cuenta?: string; Debe?: number; Haber?: number }
type Ap = { Ejercicio?: string; Serie?: string; Documento?: number; TipoAsiento?: number; Fecha?: number; Detalles?: Linea[] }
const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const numSerie = (s: unknown) => (/^\d{1,5}$/.test(String(s ?? '')) ? Number(s) : -1)

try {
  await c.asegurarToken()
  seccion('entrar')
  di('entrar.c0009', true)
  di('entrar.escribir', false)

  const meses = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609', '202610']
  const todos: Ap[] = []
  let sinContestar = 0
  for (const m of meses) {
    try { todos.push(...((await c.apuntesDelMes(m)) as unknown as Ap[])) } catch { sinContestar++ }
  }
  // El listado puede repetir filas (una por línea): uno por Ejercicio/Serie/Documento.
  const unicos = [...new Map(todos.map((a) => [`${a.Ejercicio}/${a.Serie}/${a.Documento}`, a])).values()]
  seccion('dónde')
  di('meses', meses.length)
  di('meses.sin_contestar', sinContestar)
  di('asientos', unicos.length)

  seccion('por_tipo')
  for (const t of [...new Set(unicos.map((a) => Number(a.TipoAsiento ?? -1)))].sort((a, b) => a - b)) {
    const xs = unicos.filter((a) => Number(a.TipoAsiento ?? -1) === t)
    di(`tipo_${t < 0 ? 'x' : t}`, xs.length)
    for (const s of [...new Set(xs.map((a) => numSerie(a.Serie)))].sort((a, b) => a - b)) di(`tipo_${t < 0 ? 'x' : t}.serie_${s < 0 ? 'texto' : s}`, xs.filter((a) => numSerie(a.Serie) === s).length)
  }

  const generales = unicos.filter((a) => Number(a.TipoAsiento) === 0)
  seccion('generales_por_serie')
  for (const s of [...new Set(generales.map((a) => numSerie(a.Serie)))].sort((a, b) => a - b)) {
    const xs = generales.filter((a) => numSerie(a.Serie) === s).sort((a, b) => Number(a.Documento ?? 0) - Number(b.Documento ?? 0))
    const docs = xs.map((a) => Number(a.Documento ?? 0))
    const k = `serie_${s < 0 ? 'texto' : s}`
    di(`${k}.asientos`, xs.length)
    di(`${k}.documento_primero`, docs[0] ?? 0)
    di(`${k}.documento_ultimo`, docs.at(-1) ?? 0)
    di(`${k}.huecos`, docs.length ? (docs.at(-1)! - docs[0] + 1) - new Set(docs).size : 0)
    di(`${k}.lineas_max`, Math.max(0, ...xs.map((a) => (a.Detalles ?? []).length)))
    di(`${k}.con_572`, xs.filter((a) => (a.Detalles ?? []).some((l) => String(l.Cuenta ?? '').startsWith('572'))).length)
    di(`${k}.con_47`, xs.filter((a) => (a.Detalles ?? []).some((l) => String(l.Cuenta ?? '').startsWith('47'))).length)
  }

  // Un contraasiento en Diez: las mismas cuentas, el debe y el haber cambiados, el mismo total.
  seccion('contraasientos')
  const firma = (a: Ap, alReves: boolean) => (a.Detalles ?? [])
    .map((l) => `${l.Cuenta}:${alReves ? cent(l.Haber) : cent(l.Debe)}:${alReves ? cent(l.Debe) : cent(l.Haber)}`).sort().join('|')
  const directos = new Map<string, Ap[]>()
  for (const a of generales) directos.set(firma(a, false), [...(directos.get(firma(a, false)) ?? []), a])
  const gemelos = generales.filter((a) => (directos.get(firma(a, true)) ?? []).some((b) => b !== a))
  di('generales_con_gemelo_al_reves', gemelos.length)
  // Y anulados con importes en negativo (la otra forma de anular).
  di('generales_con_negativos', generales.filter((a) => (a.Detalles ?? []).some((l) => cent(l.Debe) < 0 || cent(l.Haber) < 0)).length)

  seccion('series')
  try {
    const ss = await c.series()
    di('catalogo', ss.length)
    di('catalogo.numericas', ss.filter((x) => numSerie(x.Codigo) >= 0).length)
    for (const x of ss.filter((x) => numSerie(x.Codigo) >= 0).sort((a, b) => numSerie(a.Codigo) - numSerie(b.Codigo))) di(`catalogo.serie_${numSerie(x.Codigo)}`, 1)
  } catch { di('catalogo.sin_contestar', 1) }
} catch (e) {
  console.log(`Parado: ${(e as Error).message}`)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
