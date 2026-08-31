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

/** Dinero con los decimales que hagan falta para que se VEA la diferencia.
 *
 *  ENCARGO CODE (31/08) «El albarán con IVA incluido» §2 — `fmtMoney` fija dos
 *  decimales, y eso escondió una corrección real: el coste por gramo del
 *  ALB-00134 pasó de 0,0092 (92/10000, el papel) a 0,0084 (83,64/10000, el
 *  neto que Pamela guardó), y la pantalla pintó «0,01 €» en los dos casos. La
 *  corrección existía en la base de datos y era invisible por redondeo.
 *
 *  Regla: si editar un dato no cambia ningún número visible en pantalla, la
 *  pantalla está mal. Esto da SIEMPRE al menos dos cifras significativas —
 *  suelo de `min` decimales, techo de `max`.
 *
 *  Es para costes por unidad base (€/g, €/ml), no para importes de línea: un
 *  total de 92 € se sigue pintando con fmtMoney, que es lo que espera quien
 *  cuadra un albarán contra un papel.
 */
export function fmtMoneyPrecise(x: unknown, min = 2, max = 6): string {
  if (!isNum(x)) return DASH
  const n = Number(x)
  const exp = n === 0 ? 0 : Math.floor(Math.log10(Math.abs(n)))
  const dp = n === 0 ? min : Math.min(max, Math.max(min, 1 - exp))
  return `${n.toFixed(dp).replace('.', ',')} €`
}

/** Cifra en formato español SIN unidad: `15,90`. Ausente → '' (cadena vacía,
 *  no '—'): esto se usa para SEMBRAR CAMPOS EDITABLES, y un guion dentro de un
 *  input no es un valor, es basura que el usuario tiene que borrar.
 *
 *  Existe porque faltaba el hueco evidente entre fmtNum (punto, para cálculo y
 *  depuración) y fmtMoney/fmtPct (coma, pero con unidad pegada). Un input de
 *  precio necesita justo lo de en medio: coma, dos decimales, sin símbolo.
 *  Sembrar con String(n) daba "15.9" al lado de un "15,90 €" — dos formatos en
 *  la misma pantalla, y el crudo era el del campo que se edita. */
export function fmtNumEs(x: unknown, dp = 2): string {
  return isNum(x) ? Number(x).toFixed(dp).replace('.', ',') : ''
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

/** Horas trabajadas/contratadas en formato español: `4,5h` (sin decimales
 *  sobrantes: `8h`, no `8,00h`). Ausente → '—'. `0` → '0h'. */
export function fmtHours(x: unknown, dp = 2): string {
  if (!isNum(x)) return DASH
  const n = Number(x)
  // Recorta ceros sobrantes (4.50 -> "4,5", 8.00 -> "8") pero conserva los
  // decimales que sí aportan info (8.75 -> "8,75") -- parseFloat sobre el
  // fijo a dp quita los ceros de cola sin reintroducir el punto.
  return `${parseFloat(n.toFixed(dp))}`.replace('.', ',') + 'h'
}

/** Entero con separador de miles local (`1.234`). Null-safe: reemplaza a
 *  `n.toLocaleString('es-ES')` sobre conteos del servidor (que petan con null).
 *  Ausente → '—'. `0` → '0'. */
export function fmtInt(x: unknown, locale = 'es-ES'): string {
  return isNum(x) ? Math.round(Number(x)).toLocaleString(locale) : DASH
}
