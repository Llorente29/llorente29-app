// supabase/functions/conta-gocardless-leer/turno.ts
//
// G05 · nº 72 (10/11/2026) · UNA LECTURA DE GOCARDLESS A LA VEZ POR CONEXIÓN.
// Dos lecturas de la misma empresa a la vez (un aviso al instante y otra lanzada
// a mano) chocaban al guardar la misma línea importada (conta_linea_suscripcion_idx)
// y una salía en error. Cada lectura apunta la suya en conta_gestoria_lectura
// («en_marcha») ANTES de mirar si hay otra: así, aunque empiecen en el mismo
// instante, las dos se ven, y la regla de aquí decide siempre igual cuál espera
// (la que empezó después; a la misma hora, la de id mayor).
// La que espera vuelve a mirar cada poco; cuando la otra acaba, lee ella (con lo
// último de GoCardless, que puede traer lo del aviso). Si la otra no acaba a
// tiempo, no lee y lo dice. Una lectura «en_marcha» de hace más de 15 minutos se
// da por caída: no frena a nadie.
// Puro. Lo prueba tests/unit/modules/conta/gestoria/g05/turnoLectura.test.ts.

export interface LecturaEnMarcha { id: string; empezada_at: string }

export const CAIDA_MS = 15 * 60_000
export const ESPERA_MS = 60_000
export const CADA_MS = 3_000

/** La lectura que va antes que la mía, si la hay (y no está caída). */
export function laDeAntes(mia: LecturaEnMarcha, otras: readonly LecturaEnMarcha[], ahora: Date): LecturaEnMarcha | null {
  const t = (x: LecturaEnMarcha) => Date.parse(x.empezada_at)
  const vivas = otras.filter((o) => o.id !== mia.id && ahora.getTime() - t(o) < CAIDA_MS)
  const antes = vivas.filter((o) => t(o) < t(mia) || (t(o) === t(mia) && o.id < mia.id))
  return antes.sort((a, b) => t(a) - t(b) || (a.id < b.id ? -1 : 1))[0] ?? null
}

export const fraseEnMarcha = (empresa: string) =>
  `Ya hay otra lectura de GoCardless de ${empresa} en marcha y no ha acabado en un minuto: esta no empieza, para no pisarla. Lo leído saldrá cuando acabe; si hace falta, vuelve a leer después.`
