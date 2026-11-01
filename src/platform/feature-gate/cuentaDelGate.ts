// src/platform/feature-gate/cuentaDelGate.ts
//
// DM1 · PR 1b (30/10/2026). De qué cuenta lee el gate sus interruptores, sus
// cuotas y su ficha. Sin Supabase, para probarlo solo
// (tests/unit/platform/cuentaDelGate.test.ts).
//
// Antes salía de `user_profiles … .eq('user_id') .maybeSingle()`: con dos
// empresas, maybeSingle falla y el gate se quedaba vacío (Folvy sin módulos); y
// el superadministrador leía la de su propio perfil («Folvy Interno»), no la que
// gestiona. Ahora:
//   · Quien NO es superadministrador: la abierta según la base
//     (`_cuenta_activa`, la misma que usan las políticas desde el DM1). Lo que
//     diga el navegador no cuenta: las políticas solo le dejan leer esa.
//   · El superadministrador: la que ha elegido en su selector (la cuenta activa
//     de AppContext, que también queda en el navegador). Si no ha elegido
//     ninguna, la de la base.

export interface PistasDeCuenta {
  /** ¿Es superadministrador según la base (current_user_is_admin)? */
  esPlataforma: boolean
  /** La que ha elegido en la pantalla (AppContext / navegador), si hay. */
  elegida: string | null
  /** La abierta según la base (_cuenta_activa). */
  deLaBase: string | null
}

export function cuentaDelGate(p: PistasDeCuenta): string | null {
  if (p.esPlataforma && p.elegida) return p.elegida
  return p.deLaBase
}
