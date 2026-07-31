// src/modules/kds/lib/endOfToday.ts
//
// DISPONIBILIDAD · C2 — util única para "agotar solo hoy". Antes web usaba
// 23:59:00 y tablet 23:59:59 (dos implementaciones casi iguales); se fija
// 23:59:59 como el único valor (cubre el último segundo del día, sin dejar
// una ventana de 59s en la que el producto ya aparecería disponible).

export function endOfTodayIso(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}
