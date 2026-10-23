// src/modules/conta/marco/nuevo/teTocaHoy.ts
//
// M01 · El «Te toca hoy» del Inicio: lo que pide una decisión en cada módulo,
// junto (decisión de Julio, F01 respuesta 6: es también el «Por hacer»). Los
// números son los mismos que el globo de cada módulo, con la misma vara
// (useCuentasMenu, regla 31). Mientras se cuenta, «…»; el que no se ha
// podido contar, «—»: ninguno de los dos dice 0.
//
// S02 · PR 3: los números salen de conta_pendientes (useCuentasMenu), y el
// «Pendiente de ti» del Inicio enseña la MISMA lista (lib/inicio dudas): uno y
// otro son estas claves, con su suma igual a la de la barra de Inicio. Las
// facturas por aclarar tienen su chip (antes no las contaba nadie) y llevan a
// su pestaña, «Por aclarar».

import { rutaBancos, rutaCompras, rutaDocumentos, rutaLibroDiario, rutaTerceros } from '@/config/navegacion'
import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import type { ChipPendiente } from '@/modules/conta/ui/marco/TeTocaHoy'

export function chipsDelInicio(c: CuentasMenu): ChipPendiente[] {
  // Sin la clave: aún se está contando (undefined). Con null: no se pudo.
  const n = (k: string) => (k in c ? c[k] ?? null : undefined)
  return [
    { id: 'compras', etiqueta: 'Compras · por mirar', numero: n('compras'), ruta: rutaCompras() },
    // S01c: las mismas que «N facturas recibidas para revisar» de abajo; la barra las suma igual.
    // S02 · PR 2: llevan a donde se deciden, Compras y gastos › Facturas recibidas › Por revisar.
    { id: 'recibidas', etiqueta: 'Compras · facturas recibidas para revisar', numero: n('recibidas'), ruta: rutaDocumentos('por-revisar') },
    { id: 'aclarar', etiqueta: 'Compras · facturas por aclarar', numero: n('aclarar'), ruta: rutaDocumentos('por-aclarar') },
    { id: 'libros', etiqueta: 'Libros · asientos para revisar', numero: n('libros'), ruta: rutaLibroDiario('revisar') },
    { id: 'bancos', etiqueta: 'Bancos · movimientos para confirmar o aclarar', numero: n('bancos'), ruta: rutaBancos() },
    { id: 'terceros', etiqueta: 'Clientes y proveedores · por revisar', numero: n('terceros'), ruta: rutaTerceros() },
  ]
}

/**
 * Qué chips salen en la franja (Julio, 16/10): los que tienen algo, los que
 * aún cuentan («…»), los que no se han podido contar («—») y el que está
 * pulsado (para poder soltarlo). Los que están a 0, no. Y solo si TODOS han
 * contado y están a 0, `nada`: la franja dice «Nada pendiente hoy». Un «—»
 * nunca se convierte en «nada pendiente».
 */
export function chipsQueSalen(chips: readonly ChipPendiente[]): { visibles: ChipPendiente[]; nada: boolean } {
  const visibles = chips.filter((c) => c.numero !== 0 || c.activo)
  return { visibles, nada: chips.length > 0 && chips.every((c) => c.numero === 0) && !chips.some((c) => c.activo) }
}
