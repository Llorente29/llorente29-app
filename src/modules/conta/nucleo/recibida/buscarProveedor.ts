// src/modules/conta/nucleo/recibida/buscarProveedor.ts
//
// K10 · El proveedor, también por su código, como en ERP10: escribir «40000002»
// (o «400.2», con el punto que rellena ceros, o «4002») lo encuentra. Por el nombre
// y el NIF, como antes.

import { codigoEscrito } from '@/modules/conta/nucleo/ficha/teclas'

export interface ProveedorBuscable { id: string; nombre: string; nif: string | null }

const sinAcentos = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Los proveedores que encajan con lo escrito: por su código (su subcuenta en la empresa), su nombre o su NIF. Primero los del código. */
export function proveedoresQueEncajan<T extends ProveedorBuscable>(texto: string, proveedores: readonly T[], codigos: ReadonlyMap<string, string>, digitos = 8): T[] {
  const q = texto.trim()
  if (!q) return [...proveedores]
  // Por su código: el completo de «400.2» o «4002» (los ceros, en medio), o los que empiezan por esas cifras.
  const entero = codigoEscrito(q, digitos)
  const cifras = /^\d+$/.test(q) ? q : null
  const porCodigo = entero || cifras
    ? proveedores.filter((p) => { const c = codigos.get(p.id) ?? ''; return !!c && ((!!entero && c === entero) || (!!cifras && c.startsWith(cifras))) })
    : []
  const n = sinAcentos(q)
  const nifq = q.replace(/[\s.-]/g, '').toUpperCase()
  const resto = proveedores.filter((p) => !porCodigo.includes(p) && (sinAcentos(p.nombre).includes(n) || (!!nifq && (p.nif ?? '').replace(/[\s.-]/g, '').toUpperCase().includes(nifq))))
  return [...porCodigo, ...resto]
}
