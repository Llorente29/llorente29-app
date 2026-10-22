// src/modules/conta/marco/colorEmpresa.ts
//
// S02 · El color de la empresa activa: la franja de arriba de la cabecera
// (--s-franja-empresa) y el cuadrado con su inicial, del mismo color (encargo
// S02, «Cabecera»). Lo elige la empresa en Ajustes › Tu empresa
// (company.color, '#RRGGBB', 0460). Sin elegir, uno de los ocho de serie
// (--s-empresa-1…8, diseno/tokens.css) por su inicial: la misma empresa sale
// siempre del mismo color, y dos empresas con distinta inicial casi nunca
// coinciden. Núcleo puro: se prueba sin React.

/** Lo que guarda company.color: '#RRGGBB'. La base lo comprueba igual (0460). */
export const FORMATO_COLOR = /^#[0-9A-Fa-f]{6}$/

/** Cuántos colores de serie hay (--s-empresa-1…N en diseno/tokens.css). */
export const COLORES_DE_SERIE = 8

/** El número (1…8) del color de serie de un nombre: por su primera letra o cifra. */
export function numeroDeSerie(nombre: string | null | undefined): number {
  const letra = (nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().match(/[A-Z0-9]/)?.[0]
  if (!letra) return COLORES_DE_SERIE
  return (letra.charCodeAt(0) % COLORES_DE_SERIE) + 1
}

/**
 * El color que se pinta: el elegido si es válido; si no, el de serie de su
 * inicial, como variable del sistema (`var(--s-empresa-3)`).
 */
export function colorDeEmpresa(color: string | null | undefined, nombre: string | null | undefined): string {
  if (color && FORMATO_COLOR.test(color)) return color
  return `var(--s-empresa-${numeroDeSerie(nombre)})`
}

/** La inicial del cuadrado: la primera letra o cifra del nombre comercial. */
export function inicialDeEmpresa(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '·'
}

/**
 * Los colores que se ofrecen al elegir (Ajustes › Tu empresa): los ocho de
 * serie, por su número. Se guarda el hex que ese número vale hoy en
 * diseno/tokens.css (lo lee la pantalla de la hoja de estilos, no de aquí).
 */
export const NUMEROS_DE_SERIE: readonly number[] = Array.from({ length: COLORES_DE_SERIE }, (_, i) => i + 1)

/** El color que pinta el navegador ('rgb(11, 107, 103)') → '#0B6B67'. Null si no se entiende. */
export function aHex(rgb: string): string | null {
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return FORMATO_COLOR.test(rgb.trim()) ? rgb.trim().toUpperCase() : null
  return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}
