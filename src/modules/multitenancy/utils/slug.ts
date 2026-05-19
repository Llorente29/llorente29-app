// src/modules/multitenancy/utils/slug.ts
//
// Utilidad genérica de slugificación URL-safe.
//
// Se extrajo aquí cuando el segundo service (salesChannelsService) necesitó
// la misma lógica que brandsService. En lugar de duplicarla o crear un
// import cross-service feo, se centraliza.
//
// Comportamiento (idéntico al antiguo slugifyBrandName):
//   - Minúsculas
//   - Quita acentos y diacríticos (NFD + filtro de marcas combinantes)
//   - Cualquier secuencia de caracteres no alfanuméricos → un solo guión
//   - Elimina guiones iniciales/finales

/**
 * Convierte un nombre en slug URL-safe.
 *
 * Ejemplos:
 *   "Big Mike's Burgers" → "big-mike-s-burgers"
 *   "Café Olé"           → "cafe-ole"
 *   "Just Eat"           → "just-eat"
 *
 * Nota sobre apóstrofes: se convierten en guión (no se eliminan),
 * porque el regex trata cualquier carácter no alfanumérico igual.
 * Esto es intencional — cambiarlo es decisión de producto, no técnica.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
