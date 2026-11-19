// src/modules/conta/erp10/conexion.ts
//
// X10b · Lo que enseña la tarjeta «Conexión con ERP10» de lo que dice «Probar». Puro.

import type { Probado } from '@/modules/conta/services/erp10ApiService'

/** Las líneas de un mes por tipo, con el nombre que da ERP10 (DescripcionTipoIntroduccion; «Numero» cuenta líneas). */
export function tiposDelMes(m: Probado['enErp10'][number]): { nombre: string; lineas: number }[] {
  if (Array.isArray(m.resumen)) {
    const por = new Map<string, number>()
    for (const f of m.resumen) {
      const nombre = typeof f.DescripcionTipoIntroduccion === 'string' ? f.DescripcionTipoIntroduccion.trim() : ''
      const n = typeof f.Numero === 'number' ? f.Numero : 0
      if (nombre) por.set(nombre, (por.get(nombre) ?? 0) + n)
    }
    if (por.size) return [...por.entries()].map(([nombre, lineas]) => ({ nombre, lineas }))
  }
  // Sin el resumen de ERP10, sin nombre: se dice, no se inventa.
  return m.tipos.map((t) => ({ nombre: t.tipo == null ? 'sin tipo' : `tipo ${t.tipo} (ERP10 no ha dado su nombre)`, lineas: t.lineas }))
}

