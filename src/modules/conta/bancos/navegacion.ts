// src/modules/conta/bancos/navegacion.ts
//
// B01 · Bancos: sus vistas y lo que encuentra el buscador (Ctrl K). Las
// pestañas las pinta el esqueleto (esqueleto/productos.ts) y la barra de
// acciones es su cinta (esqueleto/ordenes.ts) desde el paso 3 del S01; los
// favoritos son los del esqueleto, para todo. Sin React: se prueba suelto.

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
