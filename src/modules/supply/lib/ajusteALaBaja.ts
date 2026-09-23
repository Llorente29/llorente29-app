// src/modules/supply/lib/ajusteALaBaja.ts
//
// LA REGLA DEL AJUSTE A LA BAJA, en un solo sitio.
//
// Vive aquí, y no dentro del modal, por lo mismo que `unidadesDeComponente`:
// la misma regla la tiene que aplicar la pantalla (para no dejar pulsar) y la
// base (para que no entre por otra puerta). Si vive en el componente, la RPC
// y la pantalla se separan el día que alguien añada otro camino, y entonces
// la pantalla dice una cosa y el almacén hace otra.
//
// Por qué existe (23/09/2026, encargo de Julio). Medido en Alcalá, 30 días:
// de los 8 ajustes a la baja registrados desde esta pantalla, SEIS eran
// correcciones de unidad sin una línea de explicación —55.000 bolsas que
// pasan a 200, 1.440 latas de Coca-Cola que pasan a 60 (una caja contada como
// unidades)— por 29.622 EUR. No eran pérdidas: era stock fantasma. Pero desde
// la base no hay forma de saberlo, porque ninguna llevaba nota. Las dos que sí
// la llevaban se explican solas.
//
// O sea: la nota no es burocracia. Es lo único que distingue «he perdido
// 8.891 EUR de bolsas» de «nunca hubo 55.000 bolsas».

/** Motivos que la pantalla ofrece hoy (espejo de ADJUST_REASONS). */
export type MotivoDeAjuste =
  | 'count_correction' | 'direct_receipt' | 'waste' | 'expired'
  | 'recipe_error' | 'staff_use' | 'transfer' | 'other'

export interface VeredictoDeAjuste {
  /** ¿Se puede guardar tal cual? */
  ok: boolean
  /** Por qué no, en la lengua del operario. Vacío si ok. */
  motivo: string
  /** true cuando lo que toca es la pantalla de merma, no ésta. */
  vaAMerma: boolean
}

/**
 * Longitud mínima de la nota. No es un número mágico con pretensiones: es el
 * mínimo para que quepa algo más que «ok» o «ajuste». Las dos notas buenas que
 * hay en producción tienen 118 y 118 caracteres.
 */
export const NOTA_MINIMA = 10

/**
 * Decide si un ajuste se puede guardar.
 *
 * Los ajustes AL ALZA no se tocan: no son la fuga, y meterles fricción solo
 * conseguiría que se dejaran de hacer.
 */
export function veredictoDeAjuste(
  delta: number | null,
  motivo: string,
  nota: string | null | undefined,
): VeredictoDeAjuste {
  const libre: VeredictoDeAjuste = { ok: true, motivo: '', vaAMerma: false }

  // Sin cantidad todavía, o al alza, o sin cambio: nada que exigir.
  if (delta == null || !Number.isFinite(delta) || delta >= 0) return libre
  if (!motivo) return { ok: false, motivo: 'Elige un motivo.', vaAMerma: false }

  if (motivo === 'waste' || motivo === 'expired') {
    return {
      ok: false,
      vaAMerma: true,
      motivo: 'Esto es una merma: regístrala en Merma, no aquí. '
            + 'Si sale por merma tiene que contar como merma, o el almacén dice '
            + 'que la merma es cero mientras se tira comida.',
    }
  }

  if (motivo === 'other') {
    return {
      ok: false,
      vaAMerma: false,
      motivo: 'Para bajar stock hace falta un motivo de verdad. '
            + '«Otro» no dice nada y el mes que viene nadie sabrá qué pasó.',
    }
  }

  if (motivo === 'count_correction') {
    const n = (nota ?? '').trim()
    if (n.length < NOTA_MINIMA) {
      return {
        ok: false,
        vaAMerma: false,
        motivo: `Escribe qué ha pasado (mínimo ${NOTA_MINIMA} caracteres). `
              + 'Una corrección de conteo sin nota no se distingue de una pérdida.',
      }
    }
  }

  return libre
}
