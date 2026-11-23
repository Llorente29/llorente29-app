// src/modules/conta/nucleo/conciliar/conciliar.ts
//
// X29 · «Gestión de extractos bancarios» de ERP10 (maqueta nucleo_23, aprobada; de la 23b, lo del punto 3 del encargo).
// En la cinta se llama «Conciliar» (Julio, 23/11). Lo que decide la pantalla, sin tocar la base; lo prueba
// tests/conta/x29-conciliar:
//   · los filtros (desde y hasta, subcuenta, validados, contabilizados, buscar) y lo de antes del día de inicio (no se
//     ve con el filtro por defecto; pedido, sale en gris, no cuenta y Intro se lo salta);
//   · los recuentos y el pie («87 desde el inicio (01/10) · 5 sin contabilizar · 3 propuestos · 2 sin factura · 319 de
//     antes del inicio» y «3 marcados · 1.076,16 €»);
//   · el saldo línea a línea, del saldo del extracto hacia atrás y hacia delante con los importes;
//   · el color de cada fila y el «Por qué» (lo que la propuesta sabe hoy: regla, factura o memoria, y su seguridad);
//   · los avisos (más de 10 días sin conciliar, un banco sin leer desde hace más de un día, pagos sin factura) y la
//     franja de lo que Sumied ha conciliado solo hoy.

import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { formatoImporte } from '../piezas/logica'
import { sinContabilizar } from '../tesoreria/tesoreria'

/** Una línea del extracto: el movimiento, si es de antes del día de inicio y si está validada (revisada). */
export interface Linea { m: MovimientoBanco; antes: boolean; validado: boolean; subcuenta: string | null }

export type Tri = 'no' | 'si' | 'todos'
export interface Filtros { desde: string; hasta: string; subcuenta: Tri; validados: Tri; contabilizados: Tri; buscar: string }

const llano = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tri = (t: Tri, v: boolean) => t === 'todos' || (t === 'si') === v

/** «12,50», «-12,5», «1.234,56», «1234» → céntimos sin signo; null si no es un importe. */
function importeBuscado(q: string): number | null {
  const t = q.trim().replace(/\s/g, '').replace(/^[-−]/, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+\.\d{1,2}$/.test(t)) return null
  const n = /,/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** Contabilizada: con su asiento en el diario. */
export const contabilizada = (l: Pick<Linea, 'm'>): boolean => l.m.estado === 'casado'
/** Pendiente: la que espera a una persona (no lo contabilizado, ni lo apartado, ni lo de antes del inicio). */
export const pendiente = (l: Pick<Linea, 'm' | 'antes'>): boolean => !l.antes && sinContabilizar(l.m)

/** Las líneas que pasan los filtros. Lo de antes del inicio solo sale si el «desde» lo pide. */
export function filtrar(ls: readonly Linea[], f: Filtros): Linea[] {
  const q = f.buscar.trim(), cent = importeBuscado(q), texto = llano(q)
  return ls.filter((l) => {
    if (l.m.fecha < f.desde || l.m.fecha > f.hasta) return false
    if (!tri(f.subcuenta, !!l.subcuenta)) return false
    if (!tri(f.validados, l.validado)) return false
    if (!tri(f.contabilizados, contabilizada(l))) return false
    if (!q) return true
    if (cent !== null && Math.abs(l.m.importeCent) === cent) return true
    return llano(`${l.m.conceptoBanco} ${l.m.conceptoLimpio} ${l.m.contraparte ?? ''} ${l.m.casado?.asientoConcepto ?? ''}`).includes(texto)
  })
}

/** Por qué no se ha contabilizado y qué dice la propuesta: la etiqueta corta de la columna y su porqué entero (title). */
export interface PorQue { texto: string; tono: 'regla' | 'factura' | 'memoria' | 'falta' | 'otro' | 'hecho'; title: string }

const SEGURIDAD: Record<string, string> = { seguro: 'segura', probable: 'probable', duda: 'en duda' }

export function porQueDe(l: Linea): PorQue | null {
  const m = l.m
  if (m.estado === 'casado' && m.casado) {
    const k = m.casado.tipo
    const texto = k === 'factura_recibida' || k === 'factura_emitida' ? 'Factura' : k === 'liquidacion' ? 'Liquidación' : k === 'traspaso' ? 'Traspaso'
      : k === 'contrato' ? 'Contrato' : k === 'asiento' ? 'Asiento' : m.casado.porQuien === 'folvy' ? 'Regla' : 'A mano'
    return { texto, tono: 'hecho', title: m.casado.porque }
  }
  if (l.antes || m.estado === 'ignorado') return null
  const p = m.propuesta
  const seg = m.confianza ? SEGURIDAD[m.confianza] ?? m.confianza : null
  const title = [m.porque, p?.que].filter(Boolean).join(' · ')
  if (p?.destino) {
    const d = p.destino as { facturas?: unknown[] }
    switch (p.origen) {
      case 'regla': return { texto: `Regla${seg ? ` · ${seg}` : ''}`, tono: 'regla', title }
      case 'factura': {
        const n = Array.isArray(d.facturas) ? d.facturas.length : 1
        return { texto: `${n === 1 ? '1 factura' : `${n} facturas`}${seg ? ` · ${seg}` : ''}`, tono: 'factura', title }
      }
      case 'historial': {
        const veces = /(\d+)\s+(?:veces|anteriores)/.exec(m.porque ?? '')?.[1]
        return { texto: `Como ${veces ? `${veces} ant.` : 'antes'}${seg ? ` · ${seg}` : ''}`, tono: 'memoria', title }
      }
      default: return { texto: `Propuesta${seg ? ` · ${seg}` : ''}`, tono: 'otro', title }
    }
  }
  if (m.importeCent < 0) return { texto: 'Falta', tono: 'falta', title: m.porque ?? 'Un pago sin factura: Sumied no sabe a qué va.' }
  return null
}

/** Un pago sin contabilizar sin factura que lo explique (la franja de avisos y el pie). */
export const pagoSinFactura = (l: Linea): boolean => pendiente(l) && l.m.importeCent < 0 && l.m.propuesta?.origen !== 'factura'

export interface Recuento { desdeInicio: number; sinContabilizar: number; propuestos: number; sinFactura: number; antes: number }

/** Los recuentos del pie, sobre las líneas del banco (no las filtradas): lo de antes del inicio, aparte. */
export function recuento(ls: readonly Linea[], antesFuera: number): Recuento {
  let desdeInicio = 0, sinC = 0, propuestos = 0, sinFactura = 0, antes = antesFuera
  for (const l of ls) {
    if (l.antes) { antes++; continue }
    desdeInicio++
    if (pendiente(l)) { sinC++; if (l.m.propuesta?.destino) propuestos++ }
    if (pagoSinFactura(l)) sinFactura++
  }
  return { desdeInicio, sinContabilizar: sinC, propuestos, sinFactura, antes }
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** «87 desde el inicio (01/10) · 5 sin contabilizar · 3 propuestos · 2 sin factura · 319 de antes del inicio». */
export function textoDelPie(r: Recuento, inicio: string | null): string[] {
  return [
    `${r.desdeInicio} desde el inicio${inicio ? ` (${dm(inicio)})` : ''}`,
    `${r.sinContabilizar} sin contabilizar`,
    `${r.propuestos} ${r.propuestos === 1 ? 'propuesto' : 'propuestos'}`,
    `${r.sinFactura} sin factura`,
    ...(r.antes > 0 ? [`${r.antes} de antes del inicio`] : []),
  ]
}

/** «3 marcados · 1.076,16 €» (lo que mueven en el banco, sin signo). */
export function textoMarcados(ls: readonly Linea[]): string | null {
  if (ls.length === 0) return null
  const cent = ls.reduce((t, l) => t + Math.abs(l.m.importeCent), 0)
  return `${ls.length === 1 ? '1 marcado' : `${ls.length} marcados`} · ${formatoImporte(cent / 100)} €`
}

/**
 * El saldo línea a línea, como ERP10: del saldo del banco a una fecha (el del último extracto que lo trae) hacia atrás y
 * hacia delante con los importes. `ls` en el orden de la lista (del más antiguo al más nuevo). Sin saldo del banco, null.
 */
export function saldos(ls: readonly Pick<MovimientoBanco, 'fecha' | 'importeCent'>[], base: { cent: number; fecha: string } | null): (number | null)[] {
  if (!base) return ls.map(() => null)
  const cum: number[] = []
  let t = 0, ultimo = -1
  // Lo apartado (el banco no lo cobró) también movió el saldo del extracto: cuenta igual.
  ls.forEach((m, i) => { t += m.importeCent; cum.push(t); if (m.fecha <= base.fecha) ultimo = i })
  const enBase = ultimo >= 0 ? cum[ultimo] : 0
  return cum.map((c) => base.cent + (c - enBase))
}

/** El color de la fila: verde lo contabilizado, ámbar lo que propone Sumied, amarillo lo pendiente, gris lo de antes y lo apartado. */
export function colorDe(l: Linea): 'verde' | 'ambar' | 'amarillo' | 'gris' {
  if (l.antes || l.m.estado === 'ignorado') return 'gris'
  if (contabilizada(l)) return 'verde'
  if (l.m.propuesta?.destino) return 'ambar'
  return 'amarillo'
}

/** La siguiente pendiente después de una (Intro se salta lo de antes del inicio); si no hay, la primera pendiente; si no, -1. */
export function siguientePendiente(ls: readonly Linea[], desde: number): number {
  for (let i = desde + 1; i < ls.length; i++) if (pendiente(ls[i])) return i
  for (let i = 0; i <= Math.min(desde, ls.length - 1); i++) if (pendiente(ls[i])) return i
  return -1
}

/** Los avisos de la franja ámbar. */
export interface Avisos { viejos: number; sinLeer: { banco: string; desde: string }[]; pagosSinFactura: number }
export const DIAS_AVISO = 10

export function avisos(ls: readonly Linea[], bancos: readonly { nombre: string; leido: string | null }[], hoy: string): Avisos {
  const corte = new Date(Date.parse(`${hoy}T12:00:00Z`) - DIAS_AVISO * 86400000).toISOString().slice(0, 10)
  const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
  return {
    viejos: ls.filter((l) => pendiente(l) && l.m.fecha < corte).length,
    sinLeer: bancos.filter((b) => b.leido && b.leido.slice(0, 10) < ayer).map((b) => ({ banco: b.nombre, desde: b.leido!.slice(0, 10) })),
    pagosSinFactura: ls.filter(pagoSinFactura).length,
  }
}

export function textosDeAvisos(a: Avisos): string[] {
  const out: string[] = []
  if (a.viejos > 0) out.push(`${a.viejos === 1 ? '1 movimiento lleva' : `${a.viejos} movimientos llevan`} más de ${DIAS_AVISO} días sin conciliar`)
  for (const b of a.sinLeer) out.push(`${b.banco}: el extracto no se lee desde el ${dm(b.desde)}`)
  if (a.pagosSinFactura > 0) out.push(`${a.pagosSinFactura === 1 ? '1 pago' : `${a.pagosSinFactura} pagos`} sin factura`)
  return out
}

/** Lo que Sumied ha conciliado solo hoy: cuántos, de cuántos bancos y por qué (regla, factura, memoria, otros). */
export interface HechoHoy { n: number; bancos: number; regla: number; factura: number; memoria: number; otros: number }

export function textoHechoHoy(h: HechoHoy): string | null {
  if (h.n === 0) return null
  const partes = [h.regla && `${h.regla} por regla`, h.factura && `${h.factura} con su factura`, h.memoria && `${h.memoria} como los anteriores`, h.otros && `${h.otros} por otras razones`].filter(Boolean)
  return `Hoy Sumied ha conciliado solo ${h.n === 1 ? '1 movimiento' : `${h.n} movimientos`} de ${h.bancos === 1 ? '1 banco' : `los ${h.bancos} bancos`}${partes.length ? ` (${partes.join(', ')})` : ''}.`
}
