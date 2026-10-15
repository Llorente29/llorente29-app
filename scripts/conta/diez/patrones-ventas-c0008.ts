// scripts/conta/diez/patrones-ventas-c0008.ts
//
// C06b · 15/10 · CÓMO NUMERA LA GESTORÍA LAS FACTURAS DIARIAS DE GLOVO Y DE
// JUST EAT EN C0008, SOLO LEYENDO.
//
// El asiento 1803 (Ventas Glovo · Alcalá, 01/10) se validó y no llegó a Diez:
// «la plataforma «glovo» no tiene su patrón de factura medido en Diez». Solo
// estaba medido el de Uber (UBR-<grupo>-<AAAAMMDD>, «UBER EATS <grupo> dd/mm»,
// la 43000002). Aquí se mide el de Glovo (43000001) y el de Just Eat
// (43000003) en las facturas que la gestoría ya ha metido en C0008, con Uber
// como testigo de que la medida está bien hecha.
//
// Primera pasada (run 38700752691): Uber, 55 de 72 UBR-GRUPO-FECHA; Just Eat,
// 18 JUS-GRUPO-FECHA y 21 de 7 cifras; Glovo, ninguna con prefijo y guion:
// 137 con la forma «AAA999999-99999999» y 33 «A999999999999999». Esta segunda
// mira, por forma, de qué meses es cada una (cuál es la de ahora) y, en la de
// Glovo, qué son las tres letras, las seis cifras y las ocho.
//
// Frenos:
//   · el cliente se crea con escribir: false: no puede escribir nada;
//   · TODA la salida es «@@ clave número|huella» y pasa por
//     scripts/conta/salida-segura.mjs: ni números de factura, ni descripciones,
//     ni nombres, ni importes. Lo que hace falta saber sale como HUELLA (md5,
//     16 cifras) y se descifra fuera comparándola con las candidatas.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/patrones-ventas-c0008.ts
import { createHash } from 'node:crypto'
import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0008'
const PLATAFORMAS = { glovo: '43000001', uber: '43000002', justeat: '43000003' } as const
const GRUPOS = ['FLO', 'CAM', 'CAN']

/** La forma de un texto: cada cifra un 9 y cada letra una A. */
export const forma = (x: unknown) => String(x ?? '').toUpperCase().replace(/\d/g, '9').replace(/[A-ZÑÁÉÍÓÚÜ]/g, 'A')
/** Una huella publicable (16 cifras hexadecimales). */
export const huella = (f: string) => createHash('md5').update(f).digest('hex').slice(0, 16)

const sale = (clave: string, valor: number | string) => process.stdout.write(`@@ ${clave} ${valor}\n`)
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

const v = (f: Factura, k: string) => String((f as Record<string, unknown>)[k] ?? '')
const mes = (f: Factura) => Number(v(f, 'FechaFactura').slice(0, 6)) || Number(v(f, 'Fecha').slice(0, 6)) || 0
try { await c.asegurarToken() } catch (e) {
  // Solo el tipo y el código: el mensaje puede llevar texto de Diez.
  const x = e as { name?: string; status?: number }
  sale('entra_c0008', 0)
  sale(`error_${String(x.name ?? 'error').toLowerCase().replace(/[^a-z]/g, '')}`, Number(x.status ?? 0))
  process.exit(1)
}
sale('entra_c0008', 1)

// Los tres últimos meses (la primera pasada: de más atrás no contestaba a tiempo).
const meses = ['202610', '202609', '202608']
const todas: Factura[] = []
let leidos = 0, sinContestar = 0
for (const m of meses) {
  try { todas.push(...(await c.facturasDelMes(m))); leidos++ } catch { sinContestar++ }
}
const unicas = [...new Map(todas.map((f) => [`${f.Ejercicio}/${f.Serie}/${f.Documento}`, f])).values()]
seccion('lectura')
sale('meses_leidos', leidos); sale('meses_sin_contestar', sinContestar); sale('facturas_distintas', unicas.length)

for (const [plat, cuenta] of Object.entries(PLATAFORMAS)) {
  const xs = unicas.filter((f) => v(f, 'CuentaCliente') === cuenta)
  seccion(plat)
  sale(`${plat}.facturas`, xs.length)
  // Por forma: cuántas, y de qué meses (la de ahora es la del último).
  const porForma = new Map<string, Factura[]>()
  for (const f of xs) { const h = huella(forma(v(f, 'NumeroFactura'))); porForma.set(h, [...(porForma.get(h) ?? []), f]) }
  for (const [h, fs] of porForma) {
    const ms = fs.map(mes).filter((n) => n > 0).sort()
    sale(`${plat}.f_${h}.n`, fs.length)
    if (ms.length) { sale(`${plat}.f_${h}.primer_mes`, ms[0]); sale(`${plat}.f_${h}.ultimo_mes`, ms.at(-1)!) }
    // Del día y del local: ¿la fecha de la factura y el grupo salen en la descripción?
    sale(`${plat}.f_${h}.desc_con_grupo`, fs.filter((f) => GRUPOS.some((g) => new RegExp(`\\b${g}\\b`).test(v(f, 'Descripcion').toUpperCase()))).length)
    sale(`${plat}.f_${h}.desc_huella_forma`, huella(forma(v(fs[0], 'Descripcion'))))
  }
}

// Glovo, la forma AAA999999-99999999: las letras, las seis cifras y las ocho.
seccion('glovo_detalle')
const g1 = /^([A-Z]{3})(\d{6})-(\d{8})$/
const gs = unicas.filter((f) => v(f, 'CuentaCliente') === PLATAFORMAS.glovo).map((f) => ({ f, m: g1.exec(v(f, 'NumeroFactura').toUpperCase()) })).filter((x) => x.m)
sale('glovo.g1.n', gs.length)
const letras = new Map<string, number>()
for (const { m } of gs) letras.set(m![1], (letras.get(m![1]) ?? 0) + 1)
for (const [l, n] of letras) { sale(`glovo.g1.letras_${huella(l)}`, n) }
sale('glovo.g1.ocho_es_fecha_factura', gs.filter(({ f, m }) => m![3] === v(f, 'FechaFactura')).length)
sale('glovo.g1.ocho_es_fecha_asiento', gs.filter(({ f, m }) => m![3] === v(f, 'Fecha')).length)
sale('glovo.g1.ocho_es_una_fecha', gs.filter(({ m }) => /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(m![3])).length)
// Las seis cifras: ¿un código por local? (cuántos distintos y, de cada uno, con qué grupo va en la descripción)
const seis = new Map<string, { n: number; grupos: Map<string, number>; meses: Set<number> }>()
for (const { f, m } of gs) {
  const x = seis.get(m![2]) ?? { n: 0, grupos: new Map(), meses: new Set() }
  x.n++
  x.meses.add(mes(f))
  const g = GRUPOS.find((gr) => new RegExp(`\\b${gr}\\b`).test(v(f, 'Descripcion').toUpperCase())) ?? 'ninguno'
  x.grupos.set(g, (x.grupos.get(g) ?? 0) + 1)
  seis.set(m![2], x)
}
sale('glovo.g1.seis_distintos', seis.size)
for (const [s, x] of [...seis.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) {
  const h = huella(s)
  sale(`glovo.g1.s_${h}.n`, x.n)
  sale(`glovo.g1.s_${h}.meses`, x.meses.size)
  for (const [g, n] of x.grupos) sale(`glovo.g1.s_${h}.grupo_${g.toLowerCase()}`, n)
}
// ¿Se repite el número? (una factura por local y día, o por liquidación)
const repetidos = new Map<string, number>()
for (const { m } of gs) repetidos.set(m![0], (repetidos.get(m![0]) ?? 0) + 1)
sale('glovo.g1.numero_repetido', [...repetidos.values()].filter((n) => n > 1).length)
// ¿Las seis cifras son consecutivas dentro de un mismo código de letras? (un contador)
const nums = gs.map(({ m }) => Number(m![2])).sort((a, b) => a - b)
sale('glovo.g1.seis_min_max_distancia', nums.length ? nums.at(-1)! - nums[0] : 0)
sale('peticiones', c.metrica.peticiones)
