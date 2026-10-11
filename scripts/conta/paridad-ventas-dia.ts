// scripts/conta/paridad-ventas-dia.ts
//
// Cierre del día 2 (11/10): ¿la propuesta de la base (conta_propuesta_ventas_dia,
// 20261018T0100) es la misma que la del botón (ventasDelDia del núcleo)?
// Recibe un volcado de producción leído en SOLO LECTURA —{ctx, dias:[{dia, loc,
// sql, pedidos, devs}]}, la consulta en docs/conta/cierre-del-dia/CIERRE_PROPONE.md—
// que se guarda FUERA del repositorio (son datos reales), y compara día a día:
// líneas (en su orden), razones, porqué, confianza, concepto, huella y resumen.
//
//   npx tsx scripts/conta/paridad-ventas-dia.ts /ruta/fuera/del/repo/datos.json
//
// Medido el 11/10: 20 de 20 días×local de Foodint (01–10/10) iguales.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { ventasDelDia, type PedidoDia } from '../../src/modules/conta/lib/asientosPropuestos'
const raw = readFileSync(process.argv[2], 'utf8')
const i = raw.indexOf('[{'); const j = raw.lastIndexOf('}]')
const datos = JSON.parse(raw.slice(i, j + 2))[0].datos
const ctx = datos.ctx
const tipo = { id: ctx.tipo.id, porcentaje: Number(ctx.tipo.rate) }
const cobro: Record<string, string> = {}; const nombres = new Map<string, string>()
for (const c of ctx.canales) { nombres.set(c.id, c.nombre); if (c.cuenta) cobro[c.id] = c.cuenta }
type J = unknown
const canon = (x: J): J => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as Record<string, J>).sort().map((k) => [k, canon((x as Record<string, J>)[k])])) : x
interface PedidoVolcado { i: string; c: string | null; ca: string | null; m: string | null; p: boolean; e: PedidoDia['estado']; t: number | string; b: number | string | null; q: number | string | null; ti: (number | string)[] | null }
interface LineaSql { cuenta: string; debe: number | string; haber: number | string; concepto: string; marca_id: string | null; iva: { base: number | string; facturas: number } | null }
interface ImporteSql { channel_id?: string | null; brand_id?: string | null; total?: number | string; base?: number | string }
const norm = (x: unknown) => JSON.stringify(canon(x))
let iguales = 0, distintos = 0
for (const d of datos.dias) {
  const pedidos: PedidoDia[] = ((d.pedidos ?? []) as PedidoVolcado[]).map((p) => ({ id: p.i, codigo: p.c, canalId: p.ca, marcaId: p.m, marcaPropia: p.p !== false, estado: p.e,
    total: Number(p.t), base: p.b === null ? null : Number(p.b), cuota: p.q === null ? null : Number(p.q), tiposEnLineas: (p.ti ?? []).map(Number) }))
  const r = ventasDelDia({ fecha: d.dia, localId: d.loc, tipo, porMarca: true, nombreLocal: ctx.locales[d.loc] ?? 'local',
    nombreCanal: (id) => (id ? nombres.get(id) ?? 'un canal' : 'sin canal'),
    cuentas: { cobroPorCanal: cobro, ventas: ctx.ventas, devoluciones: ctx.ventas, ivaRepercutido: ctx.iva477 },
    pedidos, devoluciones: [] })
  const s = d.sql
  const difs: string[] = []
  if (!r.propuesta) {
    const sq = s.sin_propuesta
    if (!sq) difs.push(`TS no propone (${r.sinPropuesta}) y SQL sí`)
    else if (!(sq === r.sinPropuesta || (sq === 'abiertos' && r.sinPropuesta!.startsWith('El cierre')) || (sq === 'cuota' && r.sinPropuesta!.startsWith('La cuota')))) difs.push(`porqué distinto: ${sq} / ${r.sinPropuesta}`)
  } else if (s.sin_propuesta) difs.push(`SQL no propone (${s.sin_propuesta}) y TS sí`)
  else {
    const p = r.propuesta
    const razTs = [...p.razones, ...p.avisos.map((a) => ({ decision: 'Mira esto', porque: a }))]
    if (norm(razTs) !== norm(s.entrada.razones)) difs.push('razones')
    if (p.porque !== s.entrada.porque) difs.push('porque')
    if (p.confianza !== s.entrada.confianza) difs.push('confianza')
    if (p.concepto !== s.entrada.concepto) difs.push('concepto')
    const lts = p.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.concepto, l.marcaId ?? null, l.iva ? l.iva.base : null, l.iva ? l.iva.facturas : null].join('|'))
    const lsq = (s.lineas as LineaSql[]).map((l) => [l.cuenta, Number(l.debe), Number(l.haber), l.concepto, l.marca_id ?? null, l.iva ? Number(l.iva.base) : null, l.iva ? l.iva.facturas : null].join('|'))
    if (norm(lts) !== norm(lsq)) difs.push('lineas (incluido el orden)\n  TS ' + lts.join('\n     ') + '\n  SQL ' + lsq.join('\n      '))
    const hash = createHash('sha256').update(r.resumen.pedidoIds.join('|') + '#' + String(Math.round(r.resumen.total * 100))).digest('hex')
    if (hash !== s.resumen.detail_hash) difs.push('huella')
    if (r.resumen.tickets !== s.resumen.tickets_count || r.resumen.total !== Number(s.resumen.total)) difs.push('tickets/total')
    if (norm(r.resumen.porCanal.map((c) => [c.canalId, c.total])) !== norm((s.resumen.by_channel as ImporteSql[]).map((c) => [c.channel_id, Number(c.total)]))) difs.push('by_channel')
    if (norm(r.resumen.porMarca.map((c) => [c.marcaId, c.base])) !== norm((s.resumen.by_brand as ImporteSql[]).map((c) => [c.brand_id, Number(c.base)]))) difs.push('by_brand')
    if (r.resumen.baseCalculada !== s.resumen.base_calculated) difs.push('calculada')
  }
  const etiqueta = `${d.dia} ${ctx.locales[d.loc]} · ${r.propuesta ? `${r.resumen.tickets} tickets ${r.resumen.total} €, ${r.propuesta.confianza}` : 'sin propuesta: ' + r.sinPropuesta}`
  if (difs.length) { distintos++; console.log('DISTINTO', etiqueta, '\n ', difs.join('\n  ')) } else { iguales++; console.log('igual   ', etiqueta) }
}
console.log(`\n${iguales} iguales, ${distintos} distintos, de ${datos.dias.length} días×local`)
