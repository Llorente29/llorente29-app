// src/modules/conta/lib/pasosDiez.ts
//
// C06, respuesta 3 de Julio: antes de traer de Diez, la empresa necesita su
// plan y su cuenta de banco. Va en el alta y en este orden: 1) datos de la
// empresa, 2) plan, 3) banco, 4) traer de Diez. Si falta un paso, la pantalla
// dice cuál, con un botón para hacerlo. Pura: entra lo que dice la base
// (conta_diez_listo) y sale lo que se pinta.
//
// El cuarto lo hace quien vende el producto (la marca), no el cliente: su
// botón no existe; se dice en qué está.

export type ClavePaso = 'datos' | 'plan' | 'banco' | 'diez'

/** Lo que devuelve public.conta_diez_listo(empresa). */
export interface ListoDiez {
  pasos: { paso: ClavePaso; hecho: boolean; base?: string | null; fallo?: string | null }[]
  falta: ClavePaso | null
  sinNombre: number
}

export type Boton =
  | { tipo: 'ir'; texto: string; a: 'alta' | 'plan' | 'bancos' }
  | { tipo: 'subcuentaBanco'; texto: string }

export interface PasoVisto {
  clave: ClavePaso
  numero: number
  titulo: string
  estado: 'hecho' | 'falta' | 'espera'
  texto: string
  boton: Boton | null
}

const TITULOS: Record<ClavePaso, string> = {
  datos: 'Los datos de tu empresa',
  plan: 'Tu plan contable',
  banco: 'Tu cuenta del banco',
  diez: 'Traer tu contabilidad de Diez',
}

/**
 * Los cuatro pasos, en su orden. Solo el PRIMERO que falta lleva botón (los de
 * detrás esperan: no se puede activar el banco sin plan). `bancosSinSubcuenta`:
 * bancos dados de alta cuya subcuenta del 572 aún no está en el plan (se puso
 * el banco después de activar el plan); entonces el botón la crea.
 */
export function pasosDiez(l: ListoDiez, marca: string, bancosSinSubcuenta: number): PasoVisto[] {
  const orden: ClavePaso[] = ['datos', 'plan', 'banco', 'diez']
  const primero = l.falta
  return orden.map((clave, i) => {
    const p = l.pasos.find((x) => x.paso === clave) ?? { paso: clave, hecho: false }
    const base = { clave, numero: i + 1, titulo: TITULOS[clave] }
    if (p.hecho) {
      return { ...base, estado: 'hecho' as const, boton: null,
        texto: clave === 'diez' ? `Traída${p.base ? ` de la ${p.base}` : ''}.` : 'Hecho.' }
    }
    const esElQueFalta = clave === primero
    if (clave === 'diez') {
      const texto = p.fallo
        ? `La última vez no salió (${p.fallo}). Lo está mirando ${marca}.`
        : p.base
          ? `Tu base de Diez (${p.base}) está registrada: ${marca} trae tu contabilidad y te avisa.`
          : `Lo hace ${marca} por ti: en cuanto registre tu base de Diez, la trae.`
      return { ...base, estado: esElQueFalta ? 'falta' : 'espera', texto, boton: null }
    }
    if (!esElQueFalta) return { ...base, estado: 'espera' as const, texto: 'Después del paso anterior.', boton: null }
    if (clave === 'datos') {
      return { ...base, estado: 'falta' as const, texto: 'Falta terminar el alta: el nombre, el NIF y lo poco que te pregunto.', boton: { tipo: 'ir', texto: 'Terminar el alta', a: 'alta' } }
    }
    if (clave === 'plan') {
      return { ...base, estado: 'falta' as const, texto: 'Falta activar tu plan contable: es la lista de cuentas donde se apunta todo. Tus subcuentas de Diez llegan después, con el paso 4.', boton: { tipo: 'ir', texto: 'Activar el plan', a: 'plan' } }
    }
    return bancosSinSubcuenta > 0
      ? { ...base, estado: 'falta' as const, texto: `Tu banco está dado de alta, pero aún no tiene su cuenta en el plan (la 572).`, boton: { tipo: 'subcuentaBanco', texto: 'Crear su cuenta en el plan' } }
      : { ...base, estado: 'falta' as const, texto: 'Falta tu cuenta del banco: con ella, lo que traigo de Diez cuadra con tu banco.', boton: { tipo: 'ir', texto: 'Poner tu banco', a: 'bancos' } }
  })
}

/** «3 de 4 hechos». */
export const resumenPasos = (p: PasoVisto[]): string => `${p.filter((x) => x.estado === 'hecho').length} de ${p.length} hechos`

/**
 * ¿Se enseña la tarjeta «Traer tu contabilidad de Diez»? (C06, respuesta 4.)
 * El plan ya se activa en el alta: la tarjeta queda solo para lo que falte, y
 * solo para quien viene de Diez (lo contestó en el alta) o ya tiene su base
 * registrada (Foodint). Hecho todo, no se enseña.
 */
export function verTarjetaDiez(l: ListoDiez, programa: string | null): boolean {
  if (l.falta === null) return false
  const base = l.pasos.find((p) => p.paso === 'diez')?.base ?? null
  return programa === 'diez' || base !== null
}
