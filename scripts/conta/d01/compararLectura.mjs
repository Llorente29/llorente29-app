// scripts/conta/d01/compararLectura.mjs
//
// D01 · R2 punto 2 · Lo leído contra lo esperado, CAMPO A CAMPO, con la misma
// vara a los dos lados: las dos lecturas pasan por leerFactura (el núcleo de
// la app), y se comparan sus FacturaLeida y su confianza. Devuelve 1/0 por
// campo: es lo único que sale del workflow (regla de salida, R2 punto 1).

const c = (x) => (x == null ? null : Math.round(Number(x) * 100))
const igual = (a, b) => (a ?? null) === (b ?? null)

/** Los campos que se miden, en este orden. */
export const CAMPOS = ['nif', 'numero', 'fecha', 'vencimiento', 'clase', 'rectifica', 'tipos', 'base', 'cuota', 'recargo', 'retencion', 'total', 'confianza']

/**
 * @param {{factura: object, confianza: string}} leida   leerFactura(lo del modelo)
 * @param {{factura: object, confianza: string}} esperada leerFactura(ideal(f))
 * @returns {Record<string, 0|1>}
 */
export function compararLectura(leida, esperada) {
  const a = leida?.factura ?? {}, b = esperada.factura
  const tiposDe = (x) => (x.tipos ?? []).map((t) => `${t.tipo}|${c(t.base)}|${c(t.cuota)}`).sort().join(',')
  return {
    nif: Number(igual(a.proveedor?.nif, b.proveedor?.nif)),
    numero: Number(igual(a.numeroClave, b.numeroClave)),
    fecha: Number(igual(a.fecha, b.fecha)),
    vencimiento: Number(igual(a.vencimiento, b.vencimiento)),
    clase: Number(igual(a.clase, b.clase)),
    rectifica: Number(igual((a.rectificaA ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null, (b.rectificaA ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null)),
    tipos: Number(tiposDe(a) === tiposDe(b)),
    base: Number(c(a.base) === c(b.base)),
    cuota: Number(c(a.cuota) === c(b.cuota)),
    recargo: Number((c(a.recargo) ?? 0) === (c(b.recargo) ?? 0)),
    retencion: Number((c(a.retencion?.importe) ?? 0) === (c(b.retencion?.importe) ?? 0)),
    total: Number(c(a.total) === c(b.total)),
    confianza: Number(leida?.confianza === esperada.confianza),
  }
}
