// src/modules/conta/erp10/conexion.ts
//
// X10b · Lo que enseña la tarjeta «Conexión con ERP10» de lo que dice «Probar». Puro.

import type { Probado } from '@/modules/conta/services/erp10ApiService'

/** Las líneas de un mes por tipo, con el nombre que da ERP10 (DescripcionTipoIntroduccion; «Numero» cuenta líneas). */
export function tiposDelMes(m: Probado['enErp10'][number]): { nombre: string; lineas: number }[] {
  if (Array.isArray(m.resumen)) {
    const por = new Map<string, number>()
    for (const f of m.resumen) {
      const nombre = typeof f.DescripcionTipoIntroduccion === 'string' ? f.DescripcionTipoIntroduccion.trim() : ''
      const n = typeof f.Numero === 'number' ? f.Numero : 0
      if (nombre) por.set(nombre, (por.get(nombre) ?? 0) + n)
    }
    if (por.size) return [...por.entries()].map(([nombre, lineas]) => ({ nombre, lineas }))
  }
  // Sin el resumen de ERP10, sin nombre: se dice, no se inventa.
  return m.tipos.map((t) => ({ nombre: t.tipo == null ? 'sin tipo' : `tipo ${t.tipo} (ERP10 no ha dado su nombre)`, lineas: t.lineas }))
}


// ── X10b · Sacar a ERP10 por la conexión: lo que se dice antes y después ──────────────

export const NO_SE_BORRA = 'Si algo sale mal, se corrige a mano en ERP10: Sumied no puede borrarlo.'
const eur = (cent: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cent / 100)
const n = (k: number, uno: string, varios: string) => `${new Intl.NumberFormat('es-ES').format(k)} ${k === 1 ? uno : varios}`

const facturas = (r: number, e: number, a = 0, d = 0) => {
  const p: string[] = []
  if (r) p.push(n(r, 'factura recibida', 'facturas recibidas'))
  if (e) p.push(r ? n(e, 'emitida', 'emitidas') : n(e, 'factura emitida', 'facturas emitidas'))
  // X10d · y los asientos.
  if (a) p.push(n(a, 'asiento', 'asientos'))
  // X10e · y los días del TPV (su factura del día y su cobro).
  if (d) p.push(n(d, 'día del TPV', 'días del TPV'))
  return p.length > 1 ? `${p.slice(0, -1).join(', ')} y ${p[p.length - 1]}` : p.join('')
}

/** Antes de escribir (regla 8, y lo de la respuesta X10 · 2): qué va a entrar, y que no se puede borrar. X10c: recibidas y emitidas. */
export function queVaAEntrar(o: { recibidas: number; emitidas: number; asientos?: number; dias?: number; mes: string; prueba?: { clase: 'recibida' | 'emitida' | 'asiento' | 'dia'; numero: string; tercero: string; total: number } | null }): string {
  if (o.prueba?.clase === 'dia') return `Va a entrar en ERP10 un solo día del TPV de ${o.mes}, para probar: ${o.prueba.tercero}, las facturas ${o.prueba.numero} (${eur(o.prueba.total)} €), con su factura del día y su cobro. ${NO_SE_BORRA}`
  if (o.prueba?.clase === 'asiento') return `Va a entrar en ERP10 un solo asiento de ${o.mes}, para probar: el ${o.prueba.numero} de Sumied, ${o.prueba.tercero} (${eur(o.prueba.total)} €). ${NO_SE_BORRA}`
  if (o.prueba) return `Va a entrar en ERP10 una sola factura ${o.prueba.clase} de ${o.mes}, para probar: la ${o.prueba.numero} de ${o.prueba.tercero} (${eur(o.prueba.total)} €). ${NO_SE_BORRA}`
  return `Van a entrar en ERP10: ${facturas(o.recibidas, o.emitidas, o.asientos ?? 0, o.dias ?? 0)} de ${o.mes}. ${NO_SE_BORRA}`
}

type Salida = { numero: string; clase?: 'recibida' | 'emitida' | 'asiento' | 'dia'; cobroDe?: string; estado: 'en_erp10' | 'ya_estaba' | 'en_marcha' | 'no_pudo'; serie?: string; documento?: number; enlazada?: boolean; pdf?: 'subido' | 'fallo' | null; porque?: string
  cobro?: { serie: string; documento: number } }

/** Después: lo que ha entrado (con sus números de ERP10), lo que ya estaba y lo que no ha podido, con su porqué. */
export function loQueHaEntrado(xs: readonly Salida[], mes: string): { texto: string; bien: boolean } {
  const nuevas = xs.filter((x) => x.estado === 'en_erp10' && !x.enlazada)
  const enlazadas = xs.filter((x) => x.estado === 'en_erp10' && x.enlazada)
  const ya = xs.filter((x) => x.estado === 'ya_estaba')
  const mal = xs.filter((x) => x.estado === 'no_pudo' || x.estado === 'en_marcha')
  const sinPdf = xs.filter((x) => x.estado === 'en_erp10' && x.pdf === 'fallo')
  const nums = (ys: readonly Salida[]) => {
    const d = ys.map((y) => `${y.serie}/${y.documento}`)
    return d.length > 3 ? `${d[0]} a ${d[d.length - 1]}` : d.join(', ')
  }
  const partes: string[] = []
  if (nuevas.length) {
    const facturasNuevas = nuevas.filter((x) => x.clase !== 'asiento' && x.clase !== 'dia')
    const conPdf = facturasNuevas.length && facturasNuevas.every((x) => x.pdf === 'subido') ? (facturasNuevas.length === 1 ? ', con su PDF' : ', con sus PDF') : ''
    // X10e · El cobro aparte de un día cuenta con su día; sus números, con los demás.
    const cuentan = nuevas.filter((x) => !x.cobroDe)
    const r = cuentan.filter((x) => (x.clase ?? 'recibida') === 'recibida').length
    const a = cuentan.filter((x) => x.clase === 'asiento').length
    const d = cuentan.filter((x) => x.clase === 'dia').length
    const conPdfF = facturasNuevas.length ? conPdf : ''
    const numeros = nuevas.flatMap((x) => [x, ...(x.cobro ? [{ ...x, ...x.cobro }] : [])])
    partes.push(`Han entrado en ERP10 ${facturas(r, cuentan.length - r - a - d, a, d)} de ${mes} (${nums(numeros)})${conPdfF}.`)
  }
  if (enlazadas.length) partes.push(`${n(enlazadas.length, 'ya estaba', 'ya estaban')} en ERP10 (${nums(enlazadas)}): ${enlazadas.length === 1 ? 'se ha enlazado' : 'se han enlazado'}, sin meter otra.`)
  if (ya.length) partes.push(`${n(ya.length, 'había entrado', 'habían entrado')} antes (${nums(ya)}).`)
  for (const x of sinPdf) partes.push(`El PDF de la ${x.numero} no ha subido (${x.porque ?? 'sin motivo'}): súbelo a mano en ERP10.`)
  if (mal.length) partes.push(`${n(mal.length, 'no ha podido', 'no han podido')}: ${mal.map((x) => `${x.numero || 'una'}, ${(x.porque ?? 'sin motivo').replace(/\.$/, '')}`).join('; ')}.`)
  if (!partes.length) partes.push('No ha entrado nada.')
  return { texto: partes.join(' '), bien: mal.length === 0 && sinPdf.length === 0 }
}
