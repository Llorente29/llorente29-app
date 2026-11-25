// src/modules/conta/gestoria/q10/emitir.ts
//
// Q10 · Emitir por trozos (puro, la llamada se pasa): de diez en diez, cada trozo entero o nada en la base
// (conta_cuotas_emitir), y el siguiente empieza donde acabó el anterior. Si uno para, los de antes ya están emitidos
// (seguidos, sin hueco) y lo de después no: se dice hasta dónde llegó y por qué paró (regla 8).

import type { AEmitir, Emitido } from './datos'

export const POR_TROZO = 10

export async function emitirPorTrozos(
  todas: readonly AEmitir[], desde: number, mes: string,
  llamar: (desde: number, trozo: AEmitir[]) => Promise<Emitido>, avance: (frase: string) => void = () => undefined,
): Promise<string> {
  let n = 0, siguiente = desde
  let primera: string | null = null, ultima: string | null = null
  try {
    for (let i = 0; i < todas.length; i += POR_TROZO) {
      avance(`Emitiendo… ${n} de ${todas.length}`)
      const r = await llamar(siguiente, todas.slice(i, i + POR_TROZO))
      n += r.emitidas.length
      siguiente = r.siguiente
      primera ??= r.emitidas[0]?.numero ?? null
      ultima = r.emitidas[r.emitidas.length - 1]?.numero ?? ultima
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    throw new Error(n ? `Emitidas ${n} de ${todas.length} (de la ${primera} a la ${ultima}). Paró en la siguiente, sin emitirla: ${m}` : `No se ha emitido ninguna: ${m}`, { cause: e })
  }
  return `Emitidas ${n} ${n === 1 ? 'factura' : 'facturas'} de ${mes}, con fecha de hoy: de la ${primera} a la ${ultima}. Todas atadas a su cobro.`
}
