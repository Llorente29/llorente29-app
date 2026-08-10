// src/modules/supply/lib/stockDisplay.ts
//
// Formato legible del stock en UNIDAD BASE del artículo (kg/L/ud) — nunca en
// recuento de un formato de compra. Decisión de Julio (10/08): al hacer un
// pedido se piensa en "cuántos kg de mozzarella hay", no en "cuántas bolsas de
// 2 kg". El recuento de pack es AMBIGUO en cuanto el artículo tiene más de un
// tamaño de compra (mozzarella en bolsas de 1/1,5/2 kg; aceite en bidón de
// 25 L): cada pantalla podía elegir un formato de referencia distinto y
// mostrar cifras distintas del MISMO qty_on_hand (el bug que destapó esto).
// Fuente única: Existencias, Nuevo pedido y la ficha del artículo pintan el
// mismo qty_on_hand con esta función.

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

/** qty SIEMPRE en la unidad base del artículo. Escala g→kg y ml→L a partir de
 *  1000; 'ud' y el resto de unidades se muestran tal cual. */
export function formatBaseQty(qty: number, unitAbbr: string | null): string {
  if (unitAbbr === 'g' && Math.abs(qty) >= 1000) return `${nf.format(qty / 1000)} kg`
  if (unitAbbr === 'ml' && Math.abs(qty) >= 1000) return `${nf.format(qty / 1000)} L`
  return `${nf.format(qty)}${unitAbbr ? ` ${unitAbbr}` : ''}`
}
