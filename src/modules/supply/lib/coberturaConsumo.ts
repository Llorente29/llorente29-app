// src/modules/supply/lib/coberturaConsumo.ts
//
// Cobertura del consumo en la ventana de un conteo: qué parte de lo vendido el
// motor supo traducir a movimientos de stock.
//
// Por qué existe (ENCARGO 31/08, punto 5): el clasificador de causas afirmaba
// «sobre-porción en elaboración — el escandallo es fiable» sin comprobar si el
// consumo de ese artículo se había medido siquiera. Con la cadena rota eso no
// es un diagnóstico: es una acusación a quien está en la cocina, y va a alertas.
//
// Doctrina, en una línea: un motor que no sabe lo que no le han contado no
// acusa, declara su hueco.
//
// Hay DOS niveles de hueco, y no se pueden mezclar:
//
//   · HUECO DEMOSTRABLE, por artículo. El sistema sabe que una venta debía
//     tocar este artículo —su escandallo llega hasta él— y el motor no lo
//     devolvió. Se puede señalar con el dedo, y silencia la causa de ESA fila.
//
//   · HUECO NO ATRIBUIBLE, del periodo. Una línea sin mapear o un modificador
//     sin vincular consumieron algo que no sabemos qué era. No se puede repartir
//     por artículo sin inventar, así que vive en la cabecera y rebaja las causas
//     que se apoyan en la AUSENCIA de evidencia («no hay merma registrada, luego
//     se sirvió de más»), nunca las que se apoyan en evidencia positiva.
//
// Repartir el hueco no atribuible entre los artículos contados sería justo el
// error de la regla 7 al revés: en vez de esconder filas, inventarles culpa.

/** Cobertura de UN artículo contado dentro de la ventana. */
export interface CoberturaArticulo {
  /** Líneas vendidas cuyo escandallo alcanza este artículo. */
  tocan: number
  /** De ésas, aquellas en las que el motor devolvió el artículo de verdad. */
  descuentan: number
}

/** Cobertura del PERIODO: lo que no se puede repartir por artículo. */
export interface CoberturaPeriodo {
  lineasVendidas: number
  lineasConConsumo: number
  lineasSinMapear: number
  modificadores: number
  modificadoresSinVinculo: number
  /** Vinculados con impacto confirmado que aun así aportan cero al motor. */
  modificadoresMudos: number
}

export interface Cobertura {
  periodo: CoberturaPeriodo
  porArticulo: Map<string, CoberturaArticulo>
}

export const PERIODO_VACIO: CoberturaPeriodo = {
  lineasVendidas: 0, lineasConConsumo: 0, lineasSinMapear: 0,
  modificadores: 0, modificadoresSinVinculo: 0, modificadoresMudos: 0,
}

/** Unidades que el motor SÍ supo traducir, y el total sobre el que se mide. */
export function tramosCobertura(p: CoberturaPeriodo): { traducidas: number; total: number } {
  const modsQueAportan = Math.max(
    0, p.modificadores - p.modificadoresSinVinculo - p.modificadoresMudos,
  )
  return {
    traducidas: p.lineasConConsumo + modsQueAportan,
    total: p.lineasVendidas + p.modificadores,
  }
}

/**
 * Porcentaje de cobertura del periodo, 0–100. `null` cuando no se vendió nada:
 * sin ventas no hay cobertura que medir, y un 100 % ahí sería una mentira
 * tranquilizadora (regla 8: un cero calculado y un cero por falta de datos no
 * se pintan igual).
 */
export function pctCobertura(p: CoberturaPeriodo): number | null {
  const { traducidas, total } = tramosCobertura(p)
  if (total === 0) return null
  return Math.round((traducidas / total) * 1000) / 10
}

/** El periodo arrastra huecos que no se pueden atribuir a ningún artículo. */
export function hayHuecoNoAtribuible(p: CoberturaPeriodo): boolean {
  return p.lineasSinMapear > 0 || p.modificadoresSinVinculo > 0 || p.modificadoresMudos > 0
    || p.lineasConConsumo < p.lineasVendidas
}

/** Hueco DEMOSTRABLE en este artículo: el sistema sabía y aun así no descontó. */
export function articuloTieneHueco(c: CoberturaArticulo | undefined): boolean {
  if (!c) return false
  return c.descuentan < c.tocan
}

/** Cobertura del artículo, 0–100. `null` si ninguna venta del periodo lo tocaba. */
export function pctArticulo(c: CoberturaArticulo | undefined): number | null {
  if (!c || c.tocan === 0) return null
  return Math.round((c.descuentan / c.tocan) * 1000) / 10
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })

/**
 * La frase de la cabecera. Va SIEMPRE, cubra lo que cubra: un conteo al 67 % no
 * es un conteo malo, es un conteo que todavía no puede hablar de la cocina — y
 * tiene que decirlo antes de que alguien apruebe ocho alertas.
 */
export function textoCobertura(p: CoberturaPeriodo): string {
  const pct = pctCobertura(p)
  if (pct === null) return 'No hubo ventas en este periodo: no hay consumo que cubrir.'
  const { traducidas, total } = tramosCobertura(p)
  const cab = `Cobertura del consumo: ${nf.format(pct)} % (${traducidas} de ${total} líneas vendidas descontaron stock).`
  const faltan = detalleHuecos(p)
  return faltan ? `${cab} ${faltan}` : `${cab} Todo lo vendido en el periodo se tradujo a stock.`
}

/** El desglose del hueco, nombrando cada causa. Cadena vacía si no hay hueco. */
export function detalleHuecos(p: CoberturaPeriodo): string {
  const partes: string[] = []
  const platosMudos = Math.max(0, p.lineasVendidas - p.lineasConConsumo - p.lineasSinMapear)
  if (p.modificadoresSinVinculo > 0) partes.push(`${p.modificadoresSinVinculo} modificador${p.modificadoresSinVinculo === 1 ? '' : 'es'} sin vincular a artículo`)
  if (p.modificadoresMudos > 0) partes.push(`${p.modificadoresMudos} vinculado${p.modificadoresMudos === 1 ? '' : 's'} pero sin unidad utilizable`)
  if (p.lineasSinMapear > 0) partes.push(`${p.lineasSinMapear} línea${p.lineasSinMapear === 1 ? '' : 's'} sin mapear`)
  if (platosMudos > 0) partes.push(`${platosMudos} plato${platosMudos === 1 ? '' : 's'} sin escandallo`)
  if (partes.length === 0) return ''
  return `No descuentan: ${partes.join(', ')}.`
}

/**
 * Qué se dice en lugar de la causa cuando no se puede atribuir. Devuelve `null`
 * si la cobertura da derecho a proponer causa.
 */
export function motivoSinCausa(
  articulo: CoberturaArticulo | undefined,
  periodo: CoberturaPeriodo,
): string | null {
  if (articuloTieneHueco(articulo) && articulo) {
    const noDescontadas = articulo.tocan - articulo.descuentan
    return `No puedo atribuirlo: ${noDescontadas} de ${articulo.tocan} ventas que llevaban este artículo no lo descontaron. `
      + 'La desviación mide ese hueco, no la cocina.'
  }
  if (hayHuecoNoAtribuible(periodo)) {
    const pct = pctCobertura(periodo)
    const cab = pct === null
      ? 'No puedo atribuirlo: no hay ventas medidas en este periodo.'
      : `No puedo atribuirlo: el ${nf.format(Math.round((100 - pct) * 10) / 10)} % de lo vendido en este periodo no descuenta stock.`
    return `${cab} ${detalleHuecos(periodo)}`.trim()
  }
  return null
}
