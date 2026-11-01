// src/modules/conta/lib/apuntaSolo.ts
//
// S01o · Lo que Sumied sabe al 100 % se apunta solo (Julio, 01/11). Lo que la
// pantalla dice de ello, sin React ni red:
//   · la línea de arriba de Facturas recibidas: «Sumied ha apuntado solo N
//     facturas esta semana · Ver» (solo si hay alguna: con 0 no se dice nada);
//   · el motivo de una que se queda en «Por revisar», en una frase, y si lo que
//     falta es la cuenta de gasto de la ficha, el enlace para ponerla.
// Los datos los da la base (conta_apuntadas_solas, 20261101T1731).

export interface ApuntadaSola { id: string; porque: string; regla: string | null; asiento: string | null; at: string }

export interface ApuntadasSolas {
  /** Cuántas se apuntaron solas en los últimos 7 días. */
  semana: number
  filas: ApuntadaSola[]
  /** Factura → por qué no se apuntó sola (o que una persona la devolvió). */
  motivos: Record<string, string>
}

export const SIN_APUNTADAS: ApuntadasSolas = { semana: 0, filas: [], motivos: {} }

/** La línea de arriba, o null si esta semana no ha apuntado ninguna. */
export function lineaDeArriba(a: ApuntadasSolas): string | null {
  if (a.semana <= 0) return null
  return `Sumied ha apuntado solo ${a.semana.toLocaleString('es-ES')} ${a.semana === 1 ? 'factura' : 'facturas'} esta semana`
}

/** El motivo de «Por revisar», partido: la frase, y si pide ponerle algo a la ficha del proveedor. */
export function motivoDeRevisar(motivo: string | undefined | null): { frase: string; ponerEnFicha: boolean } | null {
  const m = (motivo ?? '').trim()
  if (!m) return null
  return { frase: m, ponerEnFicha: /^Falta la (cuenta de gasto|subcuenta) en la ficha de /.test(m) }
}

/** Normaliza lo que devuelve la base (jsonb) a lo que lee la pantalla. */
export function deLaBase(x: unknown): ApuntadasSolas {
  const o = (x ?? {}) as { semana?: unknown; filas?: unknown; motivos?: unknown }
  const filas = Array.isArray(o.filas) ? o.filas : []
  return {
    semana: Number(o.semana ?? 0) || 0,
    filas: filas.map((f) => {
      const r = f as Record<string, unknown>
      return { id: String(r.id), porque: String(r.porque ?? ''), regla: r.regla ? String(r.regla) : null, asiento: r.asiento ? String(r.asiento) : null, at: String(r.at ?? '') }
    }),
    motivos: Object.fromEntries(Object.entries((o.motivos ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])),
  }
}
