// src/modules/conta/lib/proponer.ts
//
// Las fechas de un día a otro, en puro (las usa el corte, en Tu empresa).
//
// S01 · PR 3 (entrega 5): lo que decidía qué repasaba «Proponer lo pendiente»
// (rangoAProponer, la pregunta «¿Desde qué día asienta…?» y la tanda de un mes
// de ventas) se fue con el botón: los asientos se proponen solos en la base, y
// el corte se fija en Tu empresa (ApartadoCorte).

const unDia = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const diaSiguiente = (iso: string) => unDia(iso, 1)
export const diaAnterior = (iso: string) => unDia(iso, -1)
