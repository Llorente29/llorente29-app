// src/modules/conta/lib/ivaVentas.ts
//
// El IVA de las ventas de la empresa, deducido de sus actividades (respuesta 3
// del C00: «Lo he apuntado como comida a domicilio y el IVA de tus ventas al
// 10 %»). Puro.
//
// Criterio de Foodint (respuesta 2, pendiente de confirmación del asesor
// fiscal): la restauración, también la que solo reparte a domicilio, es
// servicio de restauración y va al 10 % unificado (Ley 37/1992, art.
// 91.Uno.2.2.º). La lectura contraria está escrita en «Norma» del PR #138.
//
// Solo decide lo que puede fundamentar: hostelería y restauración. Para
// cualquier otra actividad no propone nada (lo pone la persona o su asesor).
// Fuera de la península y Baleares no hay IVA: tampoco propone.

import { NORMAS } from '@/modules/conta/lib/normas'
import type { Territorio } from '@/modules/conta/lib/modelos'

export interface ActividadParaIva {
  iaeCode: string | null
  cnaeCode: string | null
}

export interface IvaDeVentas {
  /** Código de la fila de serie de Impuestos (tax_rate.code). */
  codigo: 'iva_reducido'
  porque: string
}

/**
 * Hostelería y restauración: IAE agrupaciones 67 (restaurantes, cafeterías,
 * bares, heladerías, servicios de alimentación) y 68 (hospedaje), o CNAE
 * divisiones 55 (alojamiento) y 56 (comidas y bebidas).
 */
export function esHosteleria(a: ActividadParaIva): boolean {
  // El código del IAE es «sección_número» (1_6779 es el epígrafe 677.9 de la
  // sección 1, empresariales). Las otras secciones numeran aparte.
  const [seccion, numero] = (a.iaeCode ?? '').includes('_') ? (a.iaeCode ?? '').split('_') : ['1', a.iaeCode ?? '']
  const iae = seccion === '1' && /^6[78]/.test(numero)
  const cnae = /^5[56]/.test((a.cnaeCode ?? '').replace(/[^0-9]/g, ''))
  return iae || cnae
}

export function ivaDeVentas(actividades: ActividadParaIva[], territorio: Territorio): IvaDeVentas | null {
  if (territorio !== 'peninsula_baleares') return null
  if (!actividades.some(esHosteleria)) return null
  return {
    codigo: 'iva_reducido',
    porque: `La hostelería y la restauración, también la que solo reparte a domicilio, van al 10 % (${NORMAS.ivaHosteleria.cita}). Es el criterio de Foodint; lo confirma tu asesor fiscal.`,
  }
}

/** Cómo se dice el IVA de las ventas en pantalla. */
export const TEXTO_IVA_VENTAS: Record<string, string> = {
  iva_reducido: '10 %', iva_general: '21 %', iva_superreducido: '4 %', exento: 'exento',
}
