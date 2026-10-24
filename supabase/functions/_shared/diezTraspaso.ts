// supabase/functions/_shared/diezTraspaso.ts
//
// C12 (Julio, 24/10) · EL TRASPASO DEL MES A DIEZ: lo que decide, sin Diez ni
// Supabase (lo usa conta-diez-traspaso; lo prueba tests/conta/diez/traspaso.test.ts).
//
//   · siguientes: de la lista del mes (conta_traspaso_lista, en orden), los que
//     tocan en esta tanda, saltando los que ya han fallado en este traspaso
//     (siguen sin llegar y no se reintentan en bucle).
//   · cuadrar: los saldos que Sumied dice que tienen que estar en Diez ese mes
//     (conta_traspaso_saldos) contra lo que Diez tiene (getSumasYsaldos, una
//     fila por apunte). «Cuadra» si cada cuenta de Sumied tiene en Diez el
//     mismo debe y el mismo haber, al céntimo. Las cuentas que solo están en
//     Diez se dicen aparte: no las movió Sumied (algo apuntado a mano en Diez)
//     y no rompen el cuadre, pero se enseñan (regla 7: no se esconden).

export type Saldo = { cuenta: string; nombre?: string | null; debe: number; haber: number }
export type Diferencia = { cuenta: string; nombre: string | null; sumied: { debe: number; haber: number }; diez: { debe: number; haber: number }; falta_debe: number; falta_haber: number }
export type Cuadre = { cuadra: boolean; cuentas: number; diferencias: Diferencia[]; solo_en_diez: Saldo[] }

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const euros = (c: number) => c / 100
/** Diez da la subcuenta como número o texto, a veces con puntos o espacios: solo los dígitos. */
export const subcuenta = (x: unknown) => String(x ?? '').replace(/\D/g, '')

/** Lo que tiene Diez, por subcuenta (getSumasYsaldos devuelve una fila por apunte). */
export function sumarDiez(filas: readonly Record<string, unknown>[]): Map<string, { debe: number; haber: number }> {
  const m = new Map<string, { debe: number; haber: number }>()
  for (const f of filas) {
    const c = subcuenta(f.Subcuenta ?? f.subcuenta)
    if (!c) continue
    const a = m.get(c) ?? { debe: 0, haber: 0 }
    a.debe += cent(f.Debe ?? f.debe)
    a.haber += cent(f.Haber ?? f.haber)
    m.set(c, a)
  }
  return m
}

/** El cuadre del mes: Sumied contra Diez, cuenta a cuenta, al céntimo. */
export function cuadrar(sumied: readonly Saldo[], filasDiez: readonly Record<string, unknown>[]): Cuadre {
  const diez = sumarDiez(filasDiez)
  const nuestras = new Set<string>()
  const diferencias: Diferencia[] = []
  for (const s of sumied) {
    const c = subcuenta(s.cuenta)
    nuestras.add(c)
    const d = diez.get(c) ?? { debe: 0, haber: 0 }
    const sd = cent(s.debe), sh = cent(s.haber)
    if (sd !== d.debe || sh !== d.haber) {
      diferencias.push({
        cuenta: c, nombre: s.nombre ?? null,
        sumied: { debe: euros(sd), haber: euros(sh) }, diez: { debe: euros(d.debe), haber: euros(d.haber) },
        falta_debe: euros(sd - d.debe), falta_haber: euros(sh - d.haber),
      })
    }
  }
  const solo_en_diez = [...diez.entries()].filter(([c, v]) => !nuestras.has(c) && (v.debe !== 0 || v.haber !== 0))
    .map(([c, v]) => ({ cuenta: c, debe: euros(v.debe), haber: euros(v.haber) }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta))
  diferencias.sort((a, b) => a.cuenta.localeCompare(b.cuenta))
  return { cuadra: diferencias.length === 0, cuentas: nuestras.size, diferencias, solo_en_diez }
}

/** Los que tocan en esta tanda: en el orden de la lista, sin los que ya han fallado. */
export function siguientes<T extends { entry_id: string; orden: number }>(lista: readonly T[], fallados: ReadonlySet<string>, n: number): { tanda: T[]; quedan: number } {
  const pendientes = [...lista].sort((a, b) => a.orden - b.orden).filter((x) => !fallados.has(x.entry_id))
  const tanda = pendientes.slice(0, Math.max(1, n))
  return { tanda, quedan: pendientes.length - tanda.length }
}

/** El mes del traspaso en Diez: ejercicio y las dos fechas AAAAMMDD (primer y último día). */
export function rangoDelMes(mes: string): { ejercicio: string; desde: number; hasta: number } {
  const m = /^(\d{4})-(\d{2})/.exec(mes)
  if (!m) throw new Error(`mes no válido: ${mes}`)
  const y = Number(m[1]), mm = Number(m[2])
  if (mm < 1 || mm > 12) throw new Error(`mes no válido: ${mes}`)
  const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate()
  return { ejercicio: String(y), desde: y * 10000 + mm * 100 + 1, hasta: y * 10000 + mm * 100 + ultimo }
}
