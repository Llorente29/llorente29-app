// scripts/conta/diez/huecos-libro-c0008.ts
//
// C06b · 15/10 · LOS HUECOS DEL AGENTE «LIBRO» EN C0008, SOLO LEYENDO.
//
// El agente avisa de que faltan los asientos 432 a 997 de la serie 1 de 2026.
// En Folvy, la serie 1 de 2026 tiene importados de Diez el 1–431 (hasta el
// 30/06) y el 998–1800 (desde el 01/07), y los de Folvy desde el 1801. Lo que
// hay que saber: ¿en Diez existen el 432–997 y no se importaron, o la
// numeración de Diez salta ahí? Y, aparte, lo que hay en Diez después del
// último importado (1800).
//
// Frenos:
//   · el cliente se crea con escribir: false;
//   · TODA la salida es «@@ clave número» y pasa por scripts/conta/salida-segura.mjs:
//     solo recuentos y números de asiento, ni descripciones, ni cuentas, ni importes.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/huecos-libro-c0008.ts
import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0008'
const EJERCICIO = '2026'
const ULTIMO_IMPORTADO = 1800
const MESES = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609', '202610']

const sale = (clave: string, valor: number) => process.stdout.write(`@@ ${clave} ${valor}\n`)
const seccion = (clave: string) => process.stdout.write(`@@ # ${clave}\n`)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('falta_secreto', 1); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try { await c.asegurarToken() } catch (e) {
  const x = e as { name?: string; status?: number }
  sale('entra_c0008', 0)
  sale(`error_${String(x.name ?? 'error').toLowerCase().replace(/[^a-z]/g, '')}`, Number(x.status ?? 0))
  process.exit(1)
}
sale('entra_c0008', 1)

/** Los tramos seguidos de una lista ordenada de números. */
function tramos(ns: number[]) {
  const t: [number, number][] = []
  for (const n of ns) { const u = t[t.length - 1]; if (u && n === u[1] + 1) u[1] = n; else t.push([n, n]) }
  return t
}

// Por mes: los asientos (ejercicio, serie, número) que Diez lista con fecha de ese mes.
const porMes = new Map<string, Apunte[]>()
let sinContestar = 0
for (const m of MESES) {
  try { porMes.set(m, await c.apuntesDelMes(m)) } catch { sinContestar++ }
}
seccion('lectura')
sale('meses_leidos', porMes.size); sale('meses_sin_contestar', sinContestar)

const todos = [...porMes.values()].flat()
const deOtroEjercicio = todos.filter((a) => String(a.Ejercicio) !== EJERCICIO).length
sale('apuntes_leidos', todos.length)
sale('apuntes_con_fecha_2026_de_otro_ejercicio', deOtroEjercicio)

const series = [...new Set(todos.filter((a) => String(a.Ejercicio) === EJERCICIO).map((a) => String(a.Serie)))].sort()
seccion('por_serie_2026')
for (const s of series) {
  const ns = [...new Set(todos.filter((a) => String(a.Ejercicio) === EJERCICIO && String(a.Serie) === s && typeof a.Documento === 'number').map((a) => a.Documento as number))].sort((x, y) => x - y)
  const k = `serie${s.replace(/[^0-9a-z]/gi, '').toLowerCase()}`
  sale(`${k}.asientos`, ns.length)
  if (!ns.length) continue
  sale(`${k}.primero`, ns[0]); sale(`${k}.ultimo`, ns[ns.length - 1])
  const t = tramos(ns)
  sale(`${k}.tramos`, t.length)
  sale(`${k}.faltan_entre_primero_y_ultimo`, ns[ns.length - 1] - ns[0] + 1 - ns.length)
  if (s !== '1') continue
  seccion('serie1_2026_el_hueco_del_agente')
  sale('serie1.entre_1_y_431', ns.filter((n) => n <= 431).length)
  sale('serie1.entre_432_y_997', ns.filter((n) => n >= 432 && n <= 997).length)
  sale('serie1.entre_998_y_1800', ns.filter((n) => n >= 998 && n <= ULTIMO_IMPORTADO).length)
  sale('serie1.despues_de_1800', ns.filter((n) => n > ULTIMO_IMPORTADO).length)
  // Cada tramo seguido: dónde empieza y dónde acaba (son números de asiento, no datos).
  t.slice(0, 40).forEach(([a, b], i) => { sale(`serie1.tramo${i + 1}.desde`, a); sale(`serie1.tramo${i + 1}.hasta`, b) })
  if (t.length > 40) sale('serie1.tramos_no_listados', t.length - 40)
  seccion('serie1_2026_despues_del_ultimo_importado')
  const despues = ns.filter((n) => n > ULTIMO_IMPORTADO)
  if (despues.length) {
    sale('serie1.despues.primero', despues[0]); sale('serie1.despues.ultimo', despues[despues.length - 1])
    sale('serie1.despues.faltan_entre_1801_y_el_ultimo', despues[despues.length - 1] - ULTIMO_IMPORTADO - despues.length)
  }
}

// La serie 1 mes a mes: primer y último número de cada mes, para ver dónde salta.
seccion('serie1_2026_mes_a_mes')
for (const [m, as] of porMes) {
  const ns = [...new Set(as.filter((a) => String(a.Ejercicio) === EJERCICIO && String(a.Serie) === '1' && typeof a.Documento === 'number').map((a) => a.Documento as number))].sort((x, y) => x - y)
  sale(`mes${m}.serie1.asientos`, ns.length)
  if (ns.length) { sale(`mes${m}.serie1.primero`, ns[0]); sale(`mes${m}.serie1.ultimo`, ns[ns.length - 1]) }
}
sale('peticiones', c.metrica.peticiones)
