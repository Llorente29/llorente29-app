// src/modules/kitchen/components/productTags.ts
//
// Catálogo de etiquetas comerciales, aparte del componente que las pinta: un
// fichero de componente solo debe exportar componentes, o el fast-refresh de
// Vite deja de funcionar y cada cambio recarga la pantalla entera.
//
// La columna `menu_item.tags` (text[]) YA EXISTÍA en la BBDD y menuItemService
// ya la leía y escribía. El encargo pedía una migración para esto: no hace
// falta. Verificado en information_schema antes de escribir nada.

export const PRODUCT_TAGS = [
  { key: 'vegano', label: 'Vegano', emoji: '🌱' },
  { key: 'vegetariano', label: 'Vegetariano', emoji: '🥬' },
  { key: 'picante', label: 'Picante', emoji: '🌶' },
  { key: 'sin_gluten', label: 'Sin gluten', emoji: '🌾' },
  { key: 'nuevo', label: 'Nuevo', emoji: '✨' },
  { key: 'popular', label: 'Popular', emoji: '🔥' },
] as const

export type ProductTagKey = (typeof PRODUCT_TAGS)[number]['key']

export function tagLabel(key: string): { label: string; emoji: string } {
  const t = PRODUCT_TAGS.find((x) => x.key === key)
  return t ? { label: t.label, emoji: t.emoji } : { label: key, emoji: '' }
}
