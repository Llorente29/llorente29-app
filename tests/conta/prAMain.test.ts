// C06b (respuesta 5, punto 5) · Las reglas de un PR a main, contra la #181 de
// verdad: su título y lo que tocaba (la C06 tocaba conta-crear-cuenta,
// conta-contrasena y send-email, y _shared/marcas.ts).
import { describe, expect, it } from 'vitest'
import { funcionesDelCuerpo, funcionesTocadas, marcaDeSaltar, revisarPr } from '../../scripts/pr/funcionesADesplegar.mjs'

const importa = {
  'conta-contrasena': ['supabase/functions/_shared/cors.ts', 'supabase/functions/_shared/marcas.ts'],
  'send-email': ['supabase/functions/_shared/cors.ts', 'supabase/functions/_shared/marcas.ts'],
  'hubrise-webhook': ['supabase/functions/_shared/cors.ts'],
}

describe('el título', () => {
  it('la #181 se fusionó con «[skip ci]»: hoy fallaría', () => {
    expect(marcaDeSaltar('C06 · Contabilidad sola con marca propia [skip ci]')).toBe('[skip ci]')
    expect(marcaDeSaltar('C06 · Contabilidad sola con marca propia (front y edge functions) (#181)')).toBeNull()
    for (const m of ['[CI SKIP]', '[no ci]', '[skip actions]', '[actions skip]']) expect(marcaDeSaltar(`x ${m}`)).not.toBeNull()
  })
})

describe('las funciones que toca', () => {
  it('las carpetas cambiadas, y por _shared, las que lo importan; nunca _shared como función', () => {
    expect(funcionesTocadas(['supabase/functions/conta-crear-cuenta/index.ts', 'supabase/functions/_shared/marcas.ts', 'src/x.ts'], importa))
      .toEqual(['conta-contrasena', 'conta-crear-cuenta', 'send-email'])
    expect(funcionesTocadas(['src/x.ts'], importa)).toEqual([])
  })
})

describe('la sección «Funciones a desplegar a mano»', () => {
  it('lista, «ninguna» o no está', () => {
    expect(funcionesDelCuerpo('## Resumen\nalgo\n\n## Funciones a desplegar a mano\n- `send-email`\n- conta-contrasena\n\n## Pruebas\n- npm run build')).toEqual(['conta-contrasena', 'send-email'])
    expect(funcionesDelCuerpo('## Funciones a desplegar a mano\nninguna')).toEqual([])
    expect(funcionesDelCuerpo('## Resumen\nnada')).toBeNull()
  })
  it('W12: «ninguna» bajo un grupo vale solo para su grupo (el #390: «### Folvy» con «ninguna» vaciaba también la de Sumied)', () => {
    const cuerpo = '## Funciones a desplegar a mano\n\n### Sumied\n- `conta-banco-agregador` (nueva)\n\n### Folvy\nninguna (las de _shared solo las importa la de Sumied)\n\n## Producto\nSumied'
    expect(funcionesDelCuerpo(cuerpo)).toEqual(['conta-banco-agregador'])
    expect(funcionesDelCuerpo('## Funciones a desplegar a mano\n### Sumied\nninguna\n### Folvy\n- send-email')).toEqual(['send-email'])
    expect(funcionesDelCuerpo('## Funciones a desplegar a mano\n### Sumied\n- ninguna\n### Folvy\nninguna')).toEqual([])
  })
  it('el PR cumple solo si dice exactamente las que toca, y su título no salta CI', () => {
    const cambiados = ['supabase/functions/_shared/marcas.ts']
    const bien = '## Funciones a desplegar a mano\n- conta-contrasena\n- send-email'
    expect(revisarPr({ titulo: 'C06b', cuerpo: bien, cambiados, importa })).toEqual([])
    expect(revisarPr({ titulo: 'C06b [skip ci]', cuerpo: bien, cambiados, importa })).toHaveLength(1)
    expect(revisarPr({ titulo: 'C06b', cuerpo: '## Funciones a desplegar a mano\n- send-email\n- hubrise-webhook', cambiados, importa })).toEqual([
      '«Funciones a desplegar a mano» no dice: conta-contrasena.',
      '«Funciones a desplegar a mano» dice hubrise-webhook, que este PR no toca.',
    ])
    expect(revisarPr({ titulo: 'C06b', cuerpo: '', cambiados: [], importa })).toEqual(['Falta la sección «## Funciones a desplegar a mano» en la descripción (ninguna).'])
  })
})
