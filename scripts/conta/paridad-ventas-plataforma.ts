// scripts/conta/paridad-ventas-plataforma.ts
//
// C04b R5 (13/10): ¿la propuesta por unidad de la base (conta_propuesta_ventas_unidad,
// 20261020T0100) es la misma que la del botón (unidadesDelDia + ventasDelDia con
// `unidad` del núcleo)? Regla 31: contra la población real.
// Recibe un volcado de producción leído en SOLO LECTURA —{sql, ped, marcas,
// canales, locales}: la consulta en línea de la unidad, el mismo texto que la
// función, con la regla de Foodint como lista fija— que se guarda FUERA del
// repositorio (son datos reales), y compara unidad a unidad: las unidades del
// día (en su orden), las líneas (cuenta, debe, haber, concepto, marca), las
// razones, el porqué, la confianza, el concepto y los pedidos. Con los reembolsos
// del día (conta_devoluciones_del_dia): en octubre de 2026 no hay ninguno en
// producción (las liquidaciones cargadas llegan a junio).
//
//   npx tsx scripts/conta/paridad-ventas-plataforma.ts /ruta/fuera/del/repo/datos.json
//
// Medido el 13/10: 105 de 105 unidades de Foodint (01–12/10) iguales.
import { readFileSync } from 'node:fs'
import { ventasDelDia, unidadesDelDia, type PedidoDia, type DevolucionDia } from '../../src/modules/conta/lib/asientosPropuestos'

const raw = readFileSync(process.argv[2], 'utf8')
const datos = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
const d = datos.d ?? datos
const GLOVO = 'f98fcf5b-7ee3-4995-9a29-e755d2bd29f3'
const CODIGOS: [string, string, string][] = [
  ['501ffd59-19e1-4d75-81dd-70c5a1a2b1de', '70000001', '70800001'], ['cc89c6eb-afb8-4308-884e-9aac83986b22', '70000002', '70800002'],
  ['2b160122-c763-4ca5-8fd5-b74d06c910c5', '70000003', '70800003'], ['43d305cd-6b48-4a8d-b292-7d3aa09e9657', '70000004', '70800004'],
  ['0229a52b-bfc6-4c6b-b29b-22b7288138e5', '70000005', '70800005'], ['95635ce3-055f-4333-b3ec-1b4e9b2a0170', '70000006', '70800006'],
  ['5a230c99-1de4-47ca-82fb-65d4af589176', '70000007', '70800007'], ['ca05894b-6d3c-466b-8064-04cc0c70a578', '70000008', '70800008'],
  ['99dff23e-98a8-46ab-af54-0cc19d036b72', '70000011', '70800011'],
]
const cobro: Record<string, string> = { [GLOVO]: '43000001', '16ed2c7e-294b-4652-9a80-e5d3a241d2be': '43000002', '60c822c8-e768-4290-8463-74e947564bcd': '43000003' }
interface PedidoVolcado { loc: string; dia: string; i: string; c: string | null; ca: string | null; m: string | null; p: boolean; e: PedidoDia['estado']; t: number | string; b: number | string | null; q: number | string | null; ti: (number | string)[] | null }
interface DevVolcado { loc: string; dia: string; pi: string | null; c: string | null; ca: string | null; m: string | null; p: boolean; imp: number | string }
interface UnidadSql { loc: string; dia: string; clave: string; concepto: string; conf: string; porque: string; sin: string | null; l: [string, number, number, string, string | null][]; raz: string[]; ids: string[] }

const porDia = new Map<string, PedidoDia[]>()
for (const p of d.ped as PedidoVolcado[]) {
  const k = `${p.loc}|${p.dia}`
  if (!porDia.has(k)) porDia.set(k, [])
  porDia.get(k)!.push({ id: p.i, codigo: p.c, canalId: p.ca, marcaId: p.m, marcaPropia: p.p !== false, estado: p.e,
    total: Number(p.t), base: p.b === null ? null : Number(p.b), cuota: p.q === null ? null : Number(p.q), tiposEnLineas: (p.ti ?? []).map(Number) })
}
const devPorDia = new Map<string, DevolucionDia[]>()
for (const x of (d.dev ?? []) as DevVolcado[]) {
  const k = `${x.loc}|${x.dia}`
  if (!devPorDia.has(k)) devPorDia.set(k, [])
  devPorDia.get(k)!.push({ pedidoId: x.pi, codigo: x.c, canalId: x.ca, marcaId: x.m, marcaPropia: x.p !== false, importe: Number(x.imp), conFactura: false })
}
const sqlPorDia = new Map<string, UnidadSql[]>()
for (const u of d.sql as UnidadSql[]) {
  const k = `${u.loc}|${u.dia}`
  if (!sqlPorDia.has(k)) sqlPorDia.set(k, [])
  sqlPorDia.get(k)!.push(u)
}
let iguales = 0, distintas = 0
const difs: string[] = []
for (const [k, pedidos] of porDia) {
  const [loc, dia] = k.split('|')
  const devs = devPorDia.get(k) ?? []
  const us = unidadesDelDia(pedidos, devs, (c) => c === GLOVO)
  const sqls = sqlPorDia.get(k) ?? []
  if (us.map((u) => u.clave).join(',') !== sqls.map((u) => u.clave).join(',')) { distintas += 1; difs.push(`${dia} ${loc}: unidades ${us.map((u) => u.clave)} ≠ ${sqls.map((u) => u.clave)}`); continue }
  for (const [i, u] of us.entries()) {
    const s = sqls[i]
    const r = ventasDelDia({
      fecha: dia, localId: loc, tipo: { id: 'tipo', porcentaje: 10 }, porMarca: true, unidad: u, nombreLocal: d.locales[loc] ?? 'local',
      nombreCanal: (id) => (id ? d.canales[id] ?? 'un canal' : 'sin canal'), nombreMarca: (id) => (id ? d.marcas[id] ?? 'una marca' : 'sin marca'),
      cuentas: { cobroPorCanal: cobro, ventas: '70000000', devoluciones: '70000000', ivaRepercutido: '47700010',
        ventasPorMarca: Object.fromEntries(CODIGOS.map(([b, v]) => [b, v])), devolucionesPorMarca: Object.fromEntries(CODIGOS.map(([b, , dv]) => [b, dv])) },
      pedidos, devoluciones: devs,
    })
    const mal: string[] = []
    if (!r.propuesta) { if (!s.sin || s.sin !== r.sinPropuesta) mal.push(`sin propuesta: ${r.sinPropuesta} ≠ ${s.sin}`) }
    else {
      const p = r.propuesta
      const lts = p.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.concepto ?? null, l.marcaId ?? null])
      const lsq = (s.l ?? []).map((l) => [l[0], Number(l[1]), Number(l[2]), l[3], l[4]])
      if (JSON.stringify(lts) !== JSON.stringify(lsq)) mal.push(`líneas ${JSON.stringify(lts)} ≠ ${JSON.stringify(lsq)}`)
      const raz = [...p.razones.map((x) => x.decision), ...p.avisos.map(() => 'Mira esto')]
      if (JSON.stringify(raz) !== JSON.stringify(s.raz)) mal.push(`razones ${JSON.stringify(raz)} ≠ ${JSON.stringify(s.raz)}`)
      if (p.concepto !== s.concepto) mal.push(`concepto ${p.concepto} ≠ ${s.concepto}`)
      if (p.porque !== s.porque) mal.push(`porqué ${p.porque} ≠ ${s.porque}`)
      if (p.confianza !== s.conf) mal.push(`confianza ${p.confianza} ≠ ${s.conf}`)
      if (JSON.stringify(r.resumen.pedidoIds) !== JSON.stringify([...(s.ids ?? [])].sort())) mal.push('pedidos distintos')
    }
    if (mal.length) { distintas += 1; difs.push(`${dia} ${loc} ${u.clave}: ${mal.join(' · ')}`) } else iguales += 1
  }
}
console.log(`Unidades iguales: ${iguales} · distintas: ${distintas}`)
for (const x of difs.slice(0, 20)) console.log('  ' + x)
process.exit(distintas ? 1 : 0)
