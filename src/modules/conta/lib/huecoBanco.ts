// src/modules/conta/lib/huecoBanco.ts
//
// B01 · Cola 1b (Julio, 02/11) · LO QUE DICE BANCOS DE UN HUECO. Un extracto
// que no empieza donde acabó el anterior tiene un hueco: falta algo entre los
// dos. Con la conexión directa, cada lectura vuelve a leer los últimos 7 días y
// lo que el banco da tarde entra en su propio extracto («llegó tarde»). Así un
// hueco puede:
//   · rellenarse: lo que llegó tarde con fechas del extracto suma el hueco;
//   · seguir abierto mientras se relee (los 7 días siguientes a su final);
//   · seguir abierto pasados esos días: el banco no lo da por la conexión. Es el
//     proveedor, no Sumied, y se dice: hace falta el extracto de esos días.
// Un hueco de un fichero, como siempre: falta un trozo entre los dos ficheros.

/** Los días que se releen después de cada lectura (el mismo número que la función de cada noche). */
export const DIAS_RELECTURA = 7

export interface ExtractoConHueco { desde: string; hasta: string; formato: string; huecoCent: number; subido: string }
export interface LlegoTarde { fecha: string; importeCent: number; subido: string }
export type EstadoHueco =
  | { tipo: 'rellenado'; rellenoCent: number }
  | { tipo: 'releyendo'; rellenoCent: number; hasta: string }
  | { tipo: 'proveedor'; rellenoCent: number }
  | { tipo: 'fichero' }

const masDias = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Cómo está el hueco de un extracto, con lo que llegó tarde a su cuenta después de él. `hoy`: AAAA-MM-DD de Madrid. */
export function estadoHueco(e: ExtractoConHueco, tarde: readonly LlegoTarde[], hoy: string): EstadoHueco {
  if (!e.formato.startsWith('agregador:')) return { tipo: 'fichero' }
  const rellenoCent = tarde.filter((t) => t.fecha >= e.desde && t.fecha <= e.hasta && t.subido > e.subido).reduce((s, t) => s + t.importeCent, 0)
  if (rellenoCent === e.huecoCent) return { tipo: 'rellenado', rellenoCent }
  const hasta = masDias(e.hasta, DIAS_RELECTURA)
  if (hoy <= hasta) return { tipo: 'releyendo', rellenoCent, hasta }
  return { tipo: 'proveedor', rellenoCent }
}

const euros = (c: number) => `${(Math.abs(c) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** El texto de la celda «Con el anterior» de un extracto con hueco. */
export function textoHueco(huecoCent: number, h: EstadoHueco): { texto: string; aviso: boolean } {
  const falta = `Falta un trozo: ${euros(huecoCent)}`
  const ya = 'rellenoCent' in h && h.rellenoCent !== 0 ? ` Ya ha llegado tarde ${euros(h.rellenoCent)}.` : ''
  switch (h.tipo) {
    case 'rellenado': return { texto: `Rellenado: el banco dio tarde ${euros(h.rellenoCent)} de estos días y ya está en Sumied.`, aviso: false }
    case 'releyendo': return { texto: `${falta}.${ya} Cada noche se vuelven a leer estos días, hasta el ${dia(h.hasta)}.`, aviso: true }
    case 'proveedor': return { texto: `${falta}.${ya} La conexión con el banco no lo ha dado al releer estos días: falta en lo que da el proveedor (open-banking.io), no en Sumied. Sube el extracto de esos días.`, aviso: true }
    default: return { texto: falta, aviso: true }
  }
}
