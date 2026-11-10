// G05 · nº 72 · Una lectura de GoCardless a la vez por conexión
// (supabase/functions/conta-gocardless-leer/turno.ts).
import { describe, expect, it } from 'vitest'
import { CAIDA_MS, fraseEnMarcha, laDeAntes } from '../../../../../../supabase/functions/conta-gocardless-leer/turno'

const ahora = new Date('2026-11-10T07:00:30Z')
const l = (id: string, empezada_at: string) => ({ id, empezada_at })

describe('G05 · nº 72 · el turno de las lecturas', () => {
  it('sola, lee', () => {
    const mia = l('b', '2026-11-10T07:00:10Z')
    expect(laDeAntes(mia, [mia], ahora)).toBeNull()
  })
  it('la que empezó después espera a la de antes; la de antes no espera a nadie', () => {
    const aviso = l('a', '2026-11-10T07:00:10Z'), aMano = l('b', '2026-11-10T07:00:12Z')
    expect(laDeAntes(aMano, [aviso, aMano], ahora)).toEqual(aviso)
    expect(laDeAntes(aviso, [aviso, aMano], ahora)).toBeNull()
  })
  it('empezadas en el mismo instante: siempre espera la misma (la de id mayor), nunca las dos ni ninguna', () => {
    const x = l('0b1', '2026-11-10T07:00:10Z'), y = l('0b2', '2026-11-10T07:00:10Z')
    expect([laDeAntes(x, [x, y], ahora), laDeAntes(y, [x, y], ahora)]).toEqual([null, x])
  })
  it('una «en marcha» de hace más de 15 minutos está caída: no frena a nadie', () => {
    const caida = l('a', new Date(ahora.getTime() - CAIDA_MS - 1000).toISOString()), mia = l('b', '2026-11-10T07:00:10Z')
    expect(laDeAntes(mia, [caida, mia], ahora)).toBeNull()
  })
  it('lo que dice si no puede leer', () => {
    expect(fraseEnMarcha('Gestoría Prueba')).toBe('Ya hay otra lectura de GoCardless de Gestoría Prueba en marcha y no ha acabado en un minuto: esta no empieza, para no pisarla. Lo leído saldrá cuando acabe; si hace falta, vuelve a leer después.')
  })
})
