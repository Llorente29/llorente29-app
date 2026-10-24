// src/modules/conta/libro/paraRevisar.ts
//
// S01e · «Para revisar» se cuenta con la MISMA regla con la que se lista
// (regla 31: la misma vara a los dos lados). Antes la lista enseñaba
// propuestos y borradores y los contadores («Para revisar · N», «Te toca hoy»)
// solo los propuestos: con un borrador, la lista tenía 1 y los números 0.
//
// La regla: sin validar (propuesto o borrador), que no espere por algo que no
// se arregla desde aquí (eso va en «Esperan») y que se decida en Asientos: lo
// propuesto que tiene su sitio en otro apartado (S02 · PR 2, delLibroDiario en
// lib/diario) no sale ni cuenta aquí. El número del menú usa la misma regla.

import { delLibroDiario, filtrar, mesDe, type AsientoDiario } from '@/modules/conta/lib/diario'

/** Lo que sale en «Para revisar», en su orden. `espera` da el motivo si espera (o null). */
export function paraRevisar(asientos: readonly AsientoDiario[], espera: (a: AsientoDiario) => string | null): AsientoDiario[] {
  return filtrar(delLibroDiario(asientos), 'revisar').filter((a) => !espera(a))
}

/** Los asientos sin validar con fecha de ese mes (propuestos y borradores, esperen o no). */
export function sinValidarDelMes(asientos: readonly AsientoDiario[], mes: string): number {
  return asientos.filter((a) => (a.estado === 'propuesto' || a.estado === 'borrador') && mesDe(a.fecha) === mes).length
}
