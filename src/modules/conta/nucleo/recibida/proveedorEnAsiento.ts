// src/modules/conta/nucleo/recibida/proveedorEnAsiento.ts
//
// K08 · «El asiento que sale» se pinta siempre, también con un proveedor recién
// dado de alta que aún no tiene su subcuenta (se la crea la base al validar:
// company_account_add, la siguiente libre de su hoja). Entonces su línea dice
// cuál será: «Será la 40000002 · Proveedores · HEINEKEN ESPAÑA, S.A.». Si ya la
// tiene (R14: el alta del proveedor con su subcuenta), la suya.
//
// La hoja y el nombre, los mismos que pone la base al validar
// (propuestasLibroService: hojaDelProveedor y «Proveedores · …» / «Acreedores · …»).

import { hojaDelProveedor, siguienteLibre } from '@/modules/conta/lib/planEmpresa'

export interface CuentaDelProveedor { codigo: string; nombre: string; nueva: boolean }

export function cuentaDelProveedorEnElAsiento(o: {
  /** La suya, si la tiene. */
  subcuenta: { codigo: string; nombre: string } | null
  /** El nombre del proveedor elegido (null: aún no hay proveedor). */
  proveedor: string | null
  /** La cuenta de gasto de la factura (decide 4000 o 4100). */
  gasto: string | null
  /** Las subcuentas que ya existen en la empresa, y cuántas cifras tienen. */
  ocupados: ReadonlySet<string>
  digitos: number
}): CuentaDelProveedor | null {
  if (o.subcuenta) return { codigo: o.subcuenta.codigo, nombre: o.subcuenta.nombre, nueva: false }
  if (!o.proveedor) return null
  const hoja = hojaDelProveedor(o.gasto)
  const libre = siguienteLibre(hoja, o.digitos, o.ocupados)
  if (!libre) return null
  return { codigo: libre, nombre: `Será la ${libre} · ${hoja === '4000' ? 'Proveedores' : 'Acreedores'} · ${o.proveedor}`, nueva: true }
}
