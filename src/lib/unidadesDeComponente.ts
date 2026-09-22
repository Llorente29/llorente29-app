// src/lib/unidadesDeComponente.ts
//
// UNIDADES REALES DE UN COMPONENTE DE COMBO. **Una regla, un fichero.**
//
//     unidades = cantidad del componente x cantidad del pack
//
// `sale_line.quantity` de un `combo_item` es la cantidad POR PACK, no el total:
// un «PACK PA 2 DC» pedido 2x con una quesadilla dentro son DOS quesadillas.
//
// Lo paga el G587 del 21/09 (Alcala, Dos Coyotes, Glovo 101780066538): dos packs
// pedidos, pegatinas para uno. Cocina hizo uno, el pase lo dio por completo y
// salio. Reclamacion de Glovo y -31,43 EUR al partner.
//
// VIVE EN `src/lib/` Y NO EN UN MODULO, y eso es lo que costo el segundo susto
// (22/09, 18:20): la primera version de este arreglo la puse en
// `modules/orders/services/ordersFeedService`, y el renderizador que IMPRIME de
// verdad —`src/native/print/ticketRenderer.ts`, el del worker nativo— no puede
// importar de ahi sin arrastrarse Supabase entero a un worker. Resultado: el
// arreglo estaba en el renderizador de la pantalla y NO en el del papel. Habria
// salido un paquete con las pegatinas igual de mal y el parte diciendo que
// estaban bien.
//
// Aqui la importan los CINCO que la necesitan: los dos renderizadores (pantalla
// y nativo), las dos tarjetas (pedidos y KDS) y la pegatina por imagen. Y la
// MISMA aritmetica la hace `ensure_label_tokens` en la base, que es quien acuña
// los tokens: si las dos no dan el mismo numero, la pareja (lineId, unitNo) de
// una etiqueta impresa no casa con ningun token y la etiqueta no se puede
// identificar. Por eso el suelo y el redondeo son IGUALES a los de la base
// (`greatest(1, round(...))`).
export function unidadesDeComponente(
  cantidadDelComponente: number | null | undefined,
  cantidadDelPadre: number | null | undefined,
): number {
  const hijo = Number(cantidadDelComponente)
  const padre = Number(cantidadDelPadre)
  // Un dato ausente o roto NUNCA puede acabar en cero piezas: un cero se lee
  // como "no lleva nada" y sale otra bolsa incompleta. Suelo en 1, como la base.
  const h = Number.isFinite(hijo) && hijo > 0 ? hijo : 1
  const p = Number.isFinite(padre) && padre > 0 ? padre : 1
  return Math.max(1, Math.round(h * p))
}
