// src/config/constants.ts
//
// Constantes globales de la aplicación.
//
// Bloque F-básico (17/05/2026): retirado `CURRENT_ACCOUNT_ID`. Era un alias
// hardcoded a Foodint Interno usado antes del Shell multi-tenant. Migrado
// en B-5 a `useActiveAccount()` (hook que devuelve la cuenta activa real).

/**
 * UUID de la cuenta interna "Foodint Interno" en Supabase.
 *
 * Esta cuenta (slug `foodint`, is_internal=true) es la cuenta operativa
 * del producto. Solo se usa para identificarla en código que necesite
 * referirla explícitamente (e.g., gates "esto solo lo ven internos").
 *
 * NO usar como sustituto de la cuenta activa del usuario:
 *   - Para obtener la cuenta activa, usar `useActiveAccount().activeAccountId`.
 *   - Para saber si el user está en una cuenta interna, usar
 *     `useActiveAccount().activeAccount?.isInternal`.
 *
 * Pendiente B-5b: 3 archivos APPCC (OnboardingPage, TemplateEditorPage,
 * TodayPage) tienen su propia constante local con este valor hardcoded y
 * lo usan como `accountId`. Eso es bug funcional (cross-tenancy) que se
 * migra en sesión dedicada.
 */
export const ACCOUNT_ID_FOODINT = '00000000-0000-0000-0000-000000000001'
