// src/modules/conta/marco/nuevo/teTocaHoy.ts
//
// M01 · El «Te toca hoy» del Inicio: lo que pide una decisión en cada módulo,
// junto (decisión de Julio, F01 respuesta 6: es también el «Por hacer»). Los
// números son los mismos que el globo de cada módulo, con la misma vara
// (useCuentasMenu, regla 31). El que no se ha podido contar sale con «—».

import { rutaBancos, rutaCompras, rutaLibroDiario, rutaTerceros } from '@/config/navegacion'
import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import type { ChipPendiente } from '@/modules/conta/ui/marco/TeTocaHoy'

export function chipsDelInicio(c: CuentasMenu): ChipPendiente[] {
  const n = (k: string) => (k in c ? c[k] ?? null : null)
  return [
    { id: 'compras', etiqueta: 'Compras · por mirar', numero: n('compras'), ruta: rutaCompras() },
    { id: 'libros', etiqueta: 'Libros · asientos para revisar', numero: n('libros'), ruta: rutaLibroDiario('revisar') },
    { id: 'bancos', etiqueta: 'Bancos · movimientos para confirmar o aclarar', numero: n('bancos'), ruta: rutaBancos() },
    { id: 'terceros', etiqueta: 'Clientes y proveedores · por revisar', numero: n('terceros'), ruta: rutaTerceros() },
  ]
}
