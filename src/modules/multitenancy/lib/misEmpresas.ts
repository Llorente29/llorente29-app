// src/modules/multitenancy/lib/misEmpresas.ts
//
// DM1 · PR 1 (30/10/2026). Las empresas de una persona con varias cuentas,
// para el selector de la cabecera (tableros 1 y 2 de «Sumied · DM1 · Demos y
// varias empresas», aprobados el 30/10). Funciones puras, sin red: se prueban
// solas (tests/unit/multitenancy/misEmpresas.test.ts).
//
// Decisión 7 de la respuesta 1 al DM1: una fila por sociedad, agrupadas por
// cuenta. Una cuenta con una sola sociedad (o ninguna: solo Folvy) sale en una
// fila; con varias, el nombre de la cuenta va de título y debajo una fila por
// sociedad.

/** Lo que devuelve mis_empresas() (1950), una entrada por cuenta. */
export interface CuentaMia {
  account_id: string
  nombre: string
  slug: string | null
  logo: string | null
  rol: 'admin' | 'manager' | 'worker' | string
  solo_sumied: boolean
  activa: boolean
  sociedades: { id: string; nombre: string; razon_social: string | null; color: string | null; logo: string | null }[]
}

export interface FilaEmpresa {
  /** Única en la lista: cuenta, o cuenta y sociedad. */
  clave: string
  accountId: string
  sociedadId: string | null
  nombre: string
  /** «Folvy y Sumied · Administrador». */
  detalle: string
  /** Un enlace a la imagen (el logo de la cuenta), o null: su inicial en su color. El de una sociedad es una ruta del almacén, no un enlace. */
  logo: string | null
  color: string | null
  /** La que está abierta ahora. */
  abierta: boolean
}

export interface GrupoEmpresas {
  /** Solo si la cuenta tiene varias sociedades: su nombre, de título. */
  titulo: string | null
  filas: FilaEmpresa[]
}

const ROLES: Record<string, string> = { admin: 'Administrador', manager: 'Encargado', worker: 'Trabajador' }

/** «Folvy y Sumied · Administrador» o «Sumied · Encargado». */
export function detalleDeCuenta(c: Pick<CuentaMia, 'solo_sumied' | 'rol'>): string {
  return `${c.solo_sumied ? 'Sumied' : 'Folvy y Sumied'} · ${ROLES[c.rol] ?? c.rol}`
}

/**
 * Los grupos del selector. `sociedadAbierta` es la sociedad elegida en la
 * cuenta abierta (la de Sumied); fuera de Sumied, null: entonces se marca la
 * primera fila de la cuenta abierta.
 */
export function gruposDeEmpresas(cuentas: CuentaMia[], sociedadAbierta: string | null): GrupoEmpresas[] {
  return cuentas.map((c) => {
    const detalle = detalleDeCuenta(c)
    if (c.sociedades.length <= 1) {
      const s = c.sociedades[0] ?? null
      return {
        titulo: null,
        filas: [{
          clave: c.account_id, accountId: c.account_id, sociedadId: s?.id ?? null,
          nombre: s?.nombre ?? c.nombre, detalle, logo: s ? null : c.logo, color: s?.color ?? null, abierta: c.activa,
        }],
      }
    }
    const abiertaEnCuenta = c.activa ? (c.sociedades.find((s) => s.id === sociedadAbierta)?.id ?? c.sociedades[0].id) : null
    return {
      titulo: c.nombre,
      filas: c.sociedades.map((s) => ({
        clave: `${c.account_id}:${s.id}`, accountId: c.account_id, sociedadId: s.id,
        nombre: s.nombre, detalle, logo: null, color: s.color, abierta: s.id === abiertaEnCuenta,
      })),
    }
  })
}

/** Si el selector de empresas de varias cuentas tiene que salir: con más de una cuenta. */
export const salePorVariasCuentas = (cuentas: CuentaMia[]) => cuentas.length > 1
