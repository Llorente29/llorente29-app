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
        // G05: tres «Piri Piri» en la misma cuenta salen con su razón social.
        nombre: nombreQueNoSeConfunde(s, c.sociedades), detalle, logo: null, color: s.color, abierta: s.id === abiertaEnCuenta,
      })),
    }
  })
}

/** Si el selector de empresas de varias cuentas tiene que salir: con más de una cuenta. */
export const salePorVariasCuentas = (cuentas: CuentaMia[]) => cuentas.length > 1

// ── G05 · Nombres que no se confunden (08/11/2026) ──────────────────────────
// En la cuenta de Piri Piri las tres sociedades se llaman «Piri Piri» (mismo
// nombre comercial). Si dos sociedades de la misma cuenta comparten nombre
// comercial, se enseña la razón social: nunca tres «Piri Piri».

/** Lo mínimo de una sociedad para nombrarla. */
export interface SociedadConNombre { id: string; nombre: string; razon_social?: string | null; razonSocial?: string | null }

const clave = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('es')

/**
 * El nombre con el que se enseña `sociedad` entre las de su cuenta (`todas`,
 * ella incluida): su nombre comercial, o su razón social si otra de la misma
 * cuenta se llama igual. Sin razón social, el nombre comercial (no se inventa
 * ninguno). Pura.
 */
export function nombreQueNoSeConfunde(sociedad: SociedadConNombre, todas: readonly SociedadConNombre[]): string {
  const razon = (sociedad.razon_social ?? sociedad.razonSocial ?? '').trim()
  const repetido = todas.some((o) => o.id !== sociedad.id && clave(o.nombre) === clave(sociedad.nombre))
  return repetido && razon ? razon : sociedad.nombre
}

/** Lo mismo para la lista entera: id → nombre que se enseña. Pura. */
export function nombresQueNoSeConfunden(todas: readonly SociedadConNombre[]): Map<string, string> {
  return new Map(todas.map((s) => [s.id, nombreQueNoSeConfunde(s, todas)]))
}

// ── G05 · El selector con los clientes del despacho ─────────────────────────

/** Lo que devuelve conta_despacho_mis_clientes() (1225), uno por sociedad cliente. */
export interface ClienteDeDespacho {
  company_id: string
  account_id: string
  razon_social: string
  nombre: string
  despacho_id: string
  despacho_nombre: string
}

/** Lo que devuelve conta_despacho_donde() (1225). */
export interface DondeEstoy {
  /** Si la cuenta abierta es un acceso del despacho: cuál. */
  abierto: { account_id: string; despacho_id: string; despacho_nombre: string } | null
  /** Las cuentas en las que se tiene un acceso de despacho. */
  accesos: string[]
}

export interface SeccionSelector {
  /** «Tus empresas» o «Clientes de Asesoría QBO». */
  titulo: string
  /** Solo en las de despacho: cuál. */
  despachoId: string | null
  grupos: GrupoEmpresas[]
}

/**
 * El selector de la cabecera de quien es de un despacho: «Tus empresas» (sus
 * cuentas propias, sin los accesos del despacho) y, por cada despacho,
 * «Clientes de …» con una fila por sociedad cliente, por razón social. Pura.
 */
export function seccionesDelSelector(cuentas: CuentaMia[], clientes: ClienteDeDespacho[], donde: DondeEstoy, sociedadAbierta: string | null): SeccionSelector[] {
  const accesos = new Set(donde.accesos)
  const propias = cuentas.filter((c) => !accesos.has(c.account_id))
  const secciones: SeccionSelector[] = []
  if (propias.length) secciones.push({ titulo: 'Tus empresas', despachoId: null, grupos: gruposDeEmpresas(propias, sociedadAbierta) })
  const cuentaAbierta = cuentas.find((c) => c.activa)?.account_id ?? null
  const porDespacho = new Map<string, ClienteDeDespacho[]>()
  for (const c of clientes) porDespacho.set(c.despacho_id, [...(porDespacho.get(c.despacho_id) ?? []), c])
  for (const [despachoId, lista] of porDespacho) {
    const filas: FilaEmpresa[] = [...lista]
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'))
      .map((c) => ({
        clave: `despacho:${c.company_id}`, accountId: c.account_id, sociedadId: c.company_id,
        nombre: c.razon_social || c.nombre, detalle: c.nombre && c.nombre !== c.razon_social ? `Cliente · ${c.nombre}` : 'Cliente',
        logo: null, color: null,
        abierta: c.account_id === cuentaAbierta && c.company_id === sociedadAbierta,
      }))
    secciones.push({ titulo: `Clientes de ${lista[0].despacho_nombre}`, despachoId, grupos: [{ titulo: null, filas }] })
  }
  return secciones
}
