// G01b · El 403 del primer recuento (run 42357133154, 07/11): la función solo
// comparaba con SUPABASE_SERVICE_ROLE_KEY (la clave antigua) y al workflow le
// puede llegar la nueva (sb_secret_…), que las funciones reciben en
// SUPABASE_SECRET_KEYS. Claves inventadas.
import { describe, expect, it } from 'vitest'
import { clavesValidas, formatoDe, revisarClave } from '../../../../../supabase/functions/conta-bitrix-leer/clave'

const ANTIGUA = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firmaInventada000'
const NUEVA = 'sb_secret_000000000000000000000000_00000000'
const PROYECTO = { antigua: ANTIGUA, nuevas: JSON.stringify({ default: NUEVA }) }

/** La comprobación de antes (#494), tal cual. */
const deAntes = (recibida: string | null, servicio: string) => !!servicio && recibida === servicio

describe('G01b · la clave de servicio del recuento', () => {
  it('reproduce el 403: con la clave nueva, la comprobación de antes no la reconocía; la de ahora sí', () => {
    expect(deAntes(NUEVA, ANTIGUA)).toBe(false)
    expect(revisarClave(NUEVA, PROYECTO)).toEqual({ vale: true })
  })

  it('la antigua sigue valiendo, y también una nueva con otro nombre', () => {
    expect(revisarClave(ANTIGUA, PROYECTO)).toEqual({ vale: true })
    expect(revisarClave('sb_secret_otra', { antigua: ANTIGUA, nuevas: JSON.stringify({ default: NUEVA, recuento: 'sb_secret_otra' }) })).toEqual({ vale: true })
    expect(revisarClave(` ${NUEVA} `, PROYECTO)).toEqual({ vale: true })
  })

  it('lo que no es una clave del proyecto no pasa, y el porqué dice el formato, nunca la clave', () => {
    for (const mala of ['sb_secret_de_otro_proyecto', 'eyJotra.firma.cualquiera', 'sb_publishable_000', '', null]) {
      const r = revisarClave(mala, PROYECTO)
      expect(r.vale).toBe(false)
      if (!r.vale) {
        expect(r.porque).not.toContain(ANTIGUA)
        expect(r.porque).not.toContain(NUEVA)
        if (mala) expect(r.porque).not.toContain(mala)
      }
    }
    expect(revisarClave('sb_secret_de_otro_proyecto', PROYECTO)).toEqual({ vale: false,
      porque: 'ha llegado una clave nueva (sb_secret_…) y no es la antigua (JWT) ni la nueva (sb_secret_…) del proyecto' })
    expect(revisarClave(NUEVA, { antigua: '', nuevas: '' })).toEqual({ vale: false,
      porque: 'ha llegado una clave nueva (sb_secret_…) y no es ninguna: la función no tiene claves de servicio del proyecto' })
  })

  it('las claves del proyecto: la antigua y las nuevas del JSON; un JSON roto no rompe nada', () => {
    expect(clavesValidas(PROYECTO)).toEqual([ANTIGUA, NUEVA])
    expect(clavesValidas({ antigua: ANTIGUA, nuevas: 'no es json' })).toEqual([ANTIGUA])
    expect([formatoDe(NUEVA), formatoDe(ANTIGUA), formatoDe('sb_publishable_1'), formatoDe('x'), formatoDe('')])
      .toEqual(['nueva (sb_secret_…)', 'antigua (JWT)', 'pública (sb_publishable_…), no vale', 'otro formato', 'vacía'])
  })
})
