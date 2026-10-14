// src/modules/conta/bancos/navegacion.ts
//
// B01 · Bancos en tres niveles (N17): las pestañas, las acciones de la barra y
// lo que encuentra el buscador (Ctrl K). Sin React: se prueba suelto.

import { LO_HECHO } from '@/modules/conta/bancos/marca'

export interface PestanaBancos { id: 'movimientos' | 'reglas' | 'cuentas' | 'cierre'; nombre: string }
export const PESTANAS_BANCOS: PestanaBancos[] = [
  { id: 'movimientos', nombre: 'Movimientos' },
  { id: 'reglas', nombre: 'Reglas' },
  { id: 'cuentas', nombre: 'Cuentas y extractos' },
  { id: 'cierre', nombre: 'Cierre del mes' },
]

/** Lo que tiene ruta propia en Bancos: las cuatro pestañas y dos acciones de la barra. */
export type VistaBancos = PestanaBancos['id'] | 'subir' | 'hecho'
const VISTAS: VistaBancos[] = ['movimientos', 'reglas', 'cuentas', 'cierre', 'subir', 'hecho']

export function resolverVista(p: string | undefined): VistaBancos {
  return (VISTAS as string[]).includes(p ?? '') ? (p as VistaBancos) : 'movimientos'
}

/** La pestaña que se marca para cada vista («Subir extracto» y «Hecho por Folvy» cuelgan de Movimientos). */
export function pestanaDe(v: VistaBancos): PestanaBancos['id'] {
  return v === 'subir' || v === 'hecho' ? 'movimientos' : v
}

export interface Buscable { vista: VistaBancos; nombre: string; donde: string; palabras: string }
export const BUSCABLES: Buscable[] = [
  { vista: 'movimientos', nombre: 'Movimientos', donde: 'Bancos', palabras: 'movimientos confirmar aclarar casar conciliar' },
  { vista: 'subir', nombre: 'Subir extracto', donde: 'Traer movimientos', palabras: 'subir extracto norma 43 n43 excel csv fichero importar' },
  { vista: 'hecho', nombre: LO_HECHO, donde: 'Automático', palabras: 'hecho folvy deshacer automatico casado solo' },
  { vista: 'reglas', nombre: 'Reglas', donde: 'Automático', palabras: 'reglas aprender siempre concepto' },
  { vista: 'cuentas', nombre: 'Cuentas y extractos', donde: 'Bancos', palabras: 'cuentas extractos tarjetas iban alta local' },
  { vista: 'cuentas', nombre: 'Tarjetas', donde: 'Cuentas y extractos', palabras: 'tarjeta tarjetas debito titular ticket' },
  { vista: 'cierre', nombre: 'Cierre del mes', donde: 'Bancos', palabras: 'cierre mes saldo cuadra diferencia' },
]

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function buscarEnBancos(q: string): Buscable[] {
  const t = normal(q).trim()
  if (!t) return BUSCABLES
  return BUSCABLES.filter((b) => normal(`${b.nombre} ${b.donde} ${b.palabras}`).includes(t))
}

/** Favoritos de Bancos, por persona (comodidad del navegador: si no hay almacén, no hay favoritos y nada falla). */
const clave = (usuario: string) => `folvy:conta:bancos:favoritos:${usuario}`
export function leerFavoritos(usuario: string, almacen: Storage | null): VistaBancos[] {
  try { const v = JSON.parse(almacen?.getItem(clave(usuario)) ?? '[]'); return Array.isArray(v) ? v.filter((x) => (VISTAS as string[]).includes(x)) : [] } catch { return [] }
}
export function alternarFavorito(usuario: string, vista: VistaBancos, almacen: Storage | null): VistaBancos[] {
  const ahora = leerFavoritos(usuario, almacen)
  const nuevo = ahora.includes(vista) ? ahora.filter((x) => x !== vista) : [...ahora, vista]
  try { almacen?.setItem(clave(usuario), JSON.stringify(nuevo)) } catch { /* sin almacén: solo en esta sesión */ }
  return nuevo
}

export const NOMBRE_VISTA: Record<VistaBancos, string> = {
  movimientos: 'Movimientos', reglas: 'Reglas', cuentas: 'Cuentas y extractos', cierre: 'Cierre del mes', subir: 'Subir extracto', hecho: LO_HECHO,
}
