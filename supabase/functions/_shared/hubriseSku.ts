// supabase/functions/_shared/hubriseSku.ts
//
// REF DE HUBRISE — única fuente de verdad (Fase B, namespacing de SKU).
// ===
// menu_item.external_id es INTOCABLE: lo usa adapt_lastapp_order para casar
// ventas entrantes de Last (external_source='lastapp' AND external_id =
// organizationProductId). El ref que se publica/empuja a HubRise es OTRA
// COSA, calculada aquí — porque Last reutiliza el mismo external_id para
// productos DISTINTOS de marcas distintas (152 colisiones confirmadas), y
// published-as-is eso hacía que un 86 en la marca A cruzara a la marca B.
//
//   · item con stock_group (stockGroupHubriseRef no null) -> ref COMPARTIDO.
//     El MISMO ref en el catálogo de cada marca del grupo = una sola "nevera"
//     (ej. Coca-Cola: agotar en cualquier marca agota en todas las del grupo).
//   · si no -> ref POR-MARCA: `${brandSlug}:${externalId}`. Único por marca
//     aunque el external_id colisione por accidente con otra marca.
//
// Usado IDÉNTICAMENTE en hubrise-catalog-publish (qué ref lleva cada sku en
// el catálogo publicado) y en availability-dispatch (a qué ref se empuja
// stock 0/null). Si cualquiera de los dos calcula el ref de otra forma, el
// namespacing deja de servir — por eso vive en un solo fichero compartido.

// Rango U+0300..U+036F = marcas diacriticas combinantes: lo que deja NFD tras
// separar el acento de su letra.
//
// Se expresa con CODIGOS NUMERICOS, no con los caracteres en crudo ni con un
// escape dentro de una expresion regular literal. Los caracteres en crudo son
// INVISIBLES en el editor y en cualquier copia; y el escape no sobrevive al
// desplegador, que viaja por JSON y decodifica los escapes antes de escribir
// el fichero — paso en la v45, y volvio a pasar en la v46 y la v47 aun
// mandandolo doblado. Con codigos el fichero es ASCII puro en esta parte: no
// hay nada que un transporte pueda reinterpretar, y desplegado y repo salen
// identicos byte a byte siempre. Mismo rango, misma semantica.
const CM_MIN = 0x300;
const CM_MAX = 0x36f;

// Quita los acentos: descompone (NFD) y descarta las marcas combinantes.
// Equivalente exacto a .normalize("NFD").replace(/[U+0300-U+036F]/g, "").
function sinAcentos(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= CM_MIN && cp <= CM_MAX) continue;
    out += ch;
  }
  return out;
}

// Sanea un fragmento para ref de SKU de HubRise: alfanumérico + _ - : (evita
// espacios/acentos/símbolos que puedan romper el ref o el parseo de HubRise).
function sanitizeRefPart(s: string): string {
  return sinAcentos(s)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface HubriseSkuInput {
  /** menu_item.external_id (matrícula Last, o el 'fv_<uuid>' generado por el publicador para folvy-nativos). */
  externalId: string | null;
  /** brand.slug del menu_item — namespace del ref por-marca. */
  brandSlug: string;
  /** stock_group.hubrise_ref si el item tiene stock_group_id; null si no. */
  stockGroupHubriseRef: string | null;
}

/**
 * Ref de HubRise para un menu_item. null si no hay ni external_id ni grupo
 * (nada que publicar/empujar — el item no tiene matrícula ni fue generada).
 */
export function hubriseSkuRef(item: HubriseSkuInput): string | null {
  if (item.stockGroupHubriseRef) return item.stockGroupHubriseRef;
  if (!item.externalId) return null;
  return `${sanitizeRefPart(item.brandSlug)}:${item.externalId}`;
}
