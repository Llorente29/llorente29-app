// src/lib/format.ts
//
// Formateo numérico null-safe. FUENTE ÚNICA de la verdad para pintar números que
// vienen del servidor (RPC/tablas), donde null/undefined son legítimos.
//
// RAÍZ DEL BUG que motivó esto (pantalla en blanco del KDS): usar `isFinite(x)`
// como guarda de null antes de `x.toFixed()`. `isFinite(null) === true` porque
// `Number(null) === 0`; lo mismo con `''`. Así que el null se colaba y
// `null.toFixed()` reventaba. La guarda correcta es `x != null` ANTES de tocar
// el número — nunca `!isFinite(x)` ni `!x` (este último tragaría el 0 real).
//
// Regla de oro: la guarda es `x != null` (NO `!x`), para que un **0 real siga
// mostrándose 0**, no '—'. Solo null/undefined/NaN/no-finito dan '—'.
//
// Convención de decimales: la app usa coma española para dinero
// (`1,50 €`). fmtNum/fmtQty usan punto (números técnicos: gramajes, ratios).

/** Placeholder para dato ausente. Único punto de cambio si se quiere otro. */
export const DASH = '—'

/** true solo si `x` es un número (o string numérica) finito y NO null/undefined.
 *  El 0 pasa el filtro (es un número válido). '' y null NO pasan. */
export function isNum(x: unknown): x is number {
  return x != null && Number.isFinite(Number(x))
}

/** Número genérico con `dp` decimales (punto). Ausente → '—'. `0` → '0.00'. */
export function fmtNum(x: unknown, dp = 2): string {
  return isNum(x) ? Number(x).toFixed(dp) : DASH
}

/** Dinero en formato español: `1234,50 €`. Ausente → '—'. `0` → '0,00 €'. */
export function fmtMoney(x: unknown): string {
  return isNum(x) ? `${Number(x).toFixed(2).replace('.', ',')} €` : DASH
}

/** Cantidad/gramaje del escandallo con `dp` decimales (punto). Ausente → '—'. */
export function fmtQty(x: unknown, dp = 3): string {
  return isNum(x) ? Number(x).toFixed(dp) : DASH
}

/** Porcentaje: `12,5 %`. Recibe el número YA en escala de porcentaje (12.5, no
 *  0.125). Ausente → '—'. `0` → '0 %'. */
export function fmtPct(x: unknown, dp = 1): string {
  return isNum(x) ? `${Number(x).toFixed(dp).replace('.', ',')} %` : DASH
}

/** Entero con separador de miles local (`1.234`). Null-safe: reemplaza a
 *  `n.toLocaleString('es-ES')` sobre conteos del servidor (que petan con null).
 *  Ausente → '—'. `0` → '0'. */
export function fmtInt(x: unknown, locale = 'es-ES'): string {
  return isNum(x) ? Math.round(Number(x)).toLocaleString(locale) : DASH
}
