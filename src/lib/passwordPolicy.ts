// src/lib/passwordPolicy.ts
//
// Política de password de Folvy V1.
//
// CONTEXTO:
//   Sprint 2 D-S2.14: Supabase Auth está configurado con:
//     - min_length: 8
//     - require lowercase, uppercase, digits
//     - password_strength_policy: 'medium' (leaked passwords check ON)
//
//   El servidor valida server-side en cada signup/update. El cliente
//   valida pre-submit para dar feedback rápido al user sin gastar una
//   llamada de red.
//
// CONTRATO:
//   Este módulo es la ÚNICA fuente de verdad para la política client-side.
//   Cualquier pantalla que valide passwords (WelcomePage, ResetPasswordConfirmPage,
//   y futuras de Sprint 3+) debe importar de aquí.
//
//   Si la política del servidor cambia, este módulo debe sincronizarse
//   manualmente. NO se autodescubre desde Supabase.
//
// IMPORTANTE:
//   - El regex NO comprueba leaked passwords (eso requiere HaveIBeenPwned
//     y solo lo hace el servidor).
//   - El cliente puede dar falsos positivos (passwords que pasan regex
//     pero el servidor rechaza por estar en filtraciones). Las pantallas
//     tratan ese caso mostrando el error traducido del servidor.

/**
 * Longitud mínima de la password.
 * Debe coincidir con `auth.password_min_length` en Supabase.
 */
export const PASSWORD_MIN_LENGTH = 8

/**
 * Regex que valida los requisitos client-side:
 *   - longitud >= 8
 *   - al menos una minúscula
 *   - al menos una mayúscula
 *   - al menos un dígito
 *
 * NO valida:
 *   - caracteres especiales (no es requisito de Supabase actual)
 *   - leaked passwords (server-side)
 *
 * Notas sobre el regex:
 *   - Los lookaheads `(?=...)` son no-consumitivos: verifican presencia
 *     sin avanzar el cursor.
 *   - `.{8,}` exige longitud mínima al final.
 *   - Acepta caracteres unicode dentro del rango de `.` (sin /u flag,
 *     `.` no matchea \n; aquí no hace falta porque passwords no llevan
 *     saltos de línea).
 */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

/**
 * Resultado de la validación. Discriminated union para que el caller
 * sepa qué error específico mostrar al user.
 */
export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_short' | 'missing_complexity' }

/**
 * Valida una password contra la política client-side.
 *
 * Devuelve un objeto con `ok` y, si falla, `reason` para que el caller
 * traduzca a un mensaje localizado.
 *
 * @example
 *   const result = validatePassword(input)
 *   if (!result.ok) {
 *     switch (result.reason) {
 *       case 'too_short': showError('Mínimo 8 caracteres'); break
 *       case 'missing_complexity': showError('Añade mayús/minús/números'); break
 *     }
 *   }
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: 'too_short' }
  }
  if (!PASSWORD_REGEX.test(password)) {
    return { ok: false, reason: 'missing_complexity' }
  }
  return { ok: true }
}
