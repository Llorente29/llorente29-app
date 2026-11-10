// GD · nº71 · Clientes y cuotas al día sin recargar: la regla de cuándo volver a pedir los datos y que la
// escuchan las dos pantallas (la lista, con el panel, y la ficha). Filas inventadas (T11).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TABLA_DE_LECTURAS, filtroDeLaCuenta, pideRecargar } from '@/modules/conta/gestoria/alDia'

const DEMO = 'de000000-0000-4000-8000-0000000000a0'
const OTRA = '00000000-0000-4000-8000-00000000abcd'

describe('GD · nº71 · al día con las lecturas', () => {
  it('escucha solo conta_gestoria_lectura y solo de su cuenta', () => {
    expect(TABLA_DE_LECTURAS).toBe('conta_gestoria_lectura')
    expect(filtroDeLaCuenta(DEMO)).toBe(`account_id=eq.${DEMO}`)
  })
  it('recarga cuando una lectura de su cuenta acaba bien; ni a medias, ni mal, ni de otra cuenta', () => {
    const acabada = { account_id: DEMO, estado: 'bien', acabada_at: '2026-11-09T21:36:06Z' }
    expect(pideRecargar(acabada, DEMO)).toBe(true)
    expect(pideRecargar({ ...acabada, acabada_at: null }, DEMO)).toBe(false)
    expect(pideRecargar({ ...acabada, estado: 'en_marcha', acabada_at: null }, DEMO)).toBe(false)
    expect(pideRecargar({ ...acabada, estado: 'mal' }, DEMO)).toBe(false)
    expect(pideRecargar({ ...acabada, account_id: OTRA }, DEMO)).toBe(false)
    expect(pideRecargar(null, DEMO)).toBe(false)
  })
  it('la escuchan la lista de Clientes y cuotas (con su panel) y la ficha, antes de su primer return', () => {
    const p = readFileSync('src/modules/conta/gestoria/g04/paginas.tsx', 'utf8')
    expect(p.match(/useAlDiaConLasLecturas\(accountId, d\.recargar\)/g)).toHaveLength(2)
    for (const pagina of ['ClientesG04Page', 'FichaClienteG04Page']) {
      const cuerpo = p.slice(p.indexOf(`export function ${pagina}`))
      expect(cuerpo.indexOf('useAlDiaConLasLecturas')).toBeLessThan(cuerpo.indexOf('if (d.error) return'))
    }
  })
})
