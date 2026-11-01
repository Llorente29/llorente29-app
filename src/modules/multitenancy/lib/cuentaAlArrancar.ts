// src/modules/multitenancy/lib/cuentaAlArrancar.ts
//
// DM1 · PR 1c (31/10/2026). Qué empresa abre la aplicación al arrancar, para
// quien NO es superadministrador. Sin Supabase, para probarlo solo
// (tests/unit/multitenancy/cuentaAlArrancar.test.ts).
//
// Manda la base (_cuenta_activa, la de las políticas): la barra nunca puede
// enseñar una empresa mientras la base tiene abierta otra. Antes, AppContext
// elegía por la URL, el navegador o la primera por nombre, sin preguntar.
//   · Si la URL (o, sin URL, el navegador) pide otra empresa que también es
//     suya, se abre esa en la base (cambiar_empresa) antes de pintar nada.
//   · Si no, la que dice la base.
// El superadministrador no pasa por aquí: gestiona cuentas de las que no es
// miembro, y la base no se las puede abrir.

export interface PistasAlArrancar {
  /** Las cuentas de la persona (sus perfiles activos). */
  mias: string[]
  /** La abierta según la base (_cuenta_activa). */
  deLaBase: string | null
  /** La de la URL, si trae una suya. */
  deLaUrl: string | null
  /** La que recuerda el navegador. */
  delNavegador: string | null
}

export interface DecisionAlArrancar {
  /** La que hay que abrir en la base con cambiar_empresa antes de pintar, o null. */
  abrir: string | null
  /** La que enseña la aplicación si todo va bien. */
  activa: string | null
  /** La que enseña si cambiar_empresa falla: la que ya tiene abierta la base. */
  siFalla: string | null
}

export function cuentaAlArrancar(p: PistasAlArrancar): DecisionAlArrancar {
  const esMia = (id: string | null): id is string => !!id && p.mias.includes(id)
  const base = esMia(p.deLaBase) ? p.deLaBase : null
  const pedida = esMia(p.deLaUrl) ? p.deLaUrl : esMia(p.delNavegador) ? p.delNavegador : null
  if (pedida && pedida !== base) return { abrir: pedida, activa: pedida, siFalla: base }
  if (base) return { abrir: null, activa: base, siFalla: base }
  // La base no dice ninguna de las suyas (no debería pasar: _cuenta_activa
  // cae a la más antigua). Se abre la primera, para que base y barra digan lo
  // mismo.
  const primera = p.mias[0] ?? null
  return { abrir: primera, activa: primera, siFalla: null }
}
