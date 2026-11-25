// src/modules/conta/gestoria/q10/serie.ts
//
// Q10 · La serie de cada empresa y si factura con retención. Puro.

import { nifLimpio } from './facturasDelMes'

/**
 * Por dónde sigue la serie de Cegid de cada empresa (Julio, 25/11): la primera
 * factura que pone Sumied. Antes de emitir, el último número en ERP10 tiene que
 * ser el de antes; si no, para y lo dice. Por el id de la empresa (no es un dato
 * personal); una empresa que no está aquí no tiene número propuesto.
 */
export const SERIE_Q10: Record<string, { anio: number; serie: string; desde: number }> = {
  '58e574ec-012a-4483-9f5b-3501cc023ba4': { anio: 2026, serie: '1', desde: 2745 },
  'dc43e21d-2992-4eb3-a378-c867f86d6644': { anio: 2026, serie: '1', desde: 574 },
}

/** Una persona física (DNI o NIE: empieza por cifra, X, Y, Z, K, L o M) factura con retención; una sociedad, no. */
export const retieneQ10 = (nif: unknown) => /^[0-9XYZKLM]/.test(nifLimpio(String(nif ?? '')))
