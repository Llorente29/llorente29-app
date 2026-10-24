// N2 (23/10) · Todo PR a main dice a qué producto va, y sus funciones por producto.
// Contra diffs fusionados de verdad en main: C08 (solo cocina), #306 (C11b,
// contabilidad con tanda) y D07a+D07c (contabilidad y _shared de Diez).
import { describe, expect, it } from 'vitest'
import {
  productoDelFichero, productosDelDiff, productoDelCuerpo, gruposDeFunciones, revisarProducto, productoDeLaFuncion, funcionesPorProducto,
} from '../../scripts/pr/productoDelPr.mjs'
import { funcionesDelCuerpo } from '../../scripts/pr/funcionesADesplegar.mjs'

const C08 = [   // 41e243c8
  'src/modules/kitchen/pages/KitchenMenuPage.tsx',
  'src/modules/kitchen/services/hubriseBrandConnectService.ts',
  'supabase/functions/hubrise-brand-connect/index.ts',
]
const C11B = [  // 90fdb711 (#306)
  'scripts/conta/produccion/cuentas/c11b-cerrar-sin-confirmar.sql',
  'src/modules/conta/lib/sinConfirmar.ts',
  'src/modules/conta/services/propuestasLibroService.ts',
  'supabase/migrations/20261023T2300_c11b_cierre_cierra_sin_confirmar.sql',
  'supabase/produccion/tandas/sumied/conta-c11b-cerrar-sin-confirmar/aplicar.txt',
  'supabase/staging/sql/20261023_c11b_cierre_sin_confirmar_prueba.sql',
  'supabase/vuelta-atras/20261023T2300_c11b_cierre_cierra_sin_confirmar.down.sql',
  'tests/unit/modules/conta/sinConfirmar.test.ts',
]
const D07AC = [ // D07a + D07c: contabilidad y el _shared de Diez
  'src/modules/conta/documentos/RevisarFacturaPage.tsx',
  'src/modules/conta/services/tercerosService.ts',
  'supabase/functions/_shared/diezCliente.ts',
  'supabase/functions/_shared/diezRecibida.ts',
]

describe('de qué producto es cada fichero', () => {
  it('Sumied, Folvy, Común o sin dueño por su nombre', () => {
    const casos: Record<string, string | null> = {
      'src/modules/conta/lib/sinConfirmar.ts': 'sumied',
      'supabase/functions/conta-diez-enviar/index.ts': 'sumied',
      'supabase/produccion/tandas/sumied/x/aplicar.txt': 'sumied',
      'src/modules/kitchen/pages/KitchenMenuPage.tsx': 'folvy',
      'supabase/functions/hubrise-brand-connect/index.ts': 'folvy',
      'supabase/functions/send-email/index.ts': 'folvy',
      'supabase/functions/_shared/diezCliente.ts': 'comun',
      'src/App.tsx': 'comun',
      'src/lib/supabase.ts': 'comun',
      'package.json': 'comun',
      'supabase/migrations/20261023T2300_c11b_cierre_cierra_sin_confirmar.sql': null,
      '.github/workflows/pr-a-main.yml': null,
      'docs/folvy_estado_ACTUALIZADO.md': null,
    }
    for (const [f, p] of Object.entries(casos)) expect(productoDelFichero(f), f).toBe(p)
  })

  it('las funciones: conta-* de Sumied, el resto de Folvy', () => {
    expect(productoDeLaFuncion('conta-diez-enviar')).toBe('sumied')
    expect(productoDeLaFuncion('hubrise-webhook')).toBe('folvy')
    expect(funcionesPorProducto(['conta-diez-enviar', 'send-email', 'conta-lote-releer']))
      .toEqual({ sumied: ['conta-diez-enviar', 'conta-lote-releer'], folvy: ['send-email'] })
  })
})

describe('lo que pide el diff de PR reales', () => {
  it('C08 pide Folvy; #306 pide Sumied (las migraciones no piden nada); D07a+D07c pide Sumied y Común', () => {
    expect(productosDelDiff(C08)).toEqual({ pide: ['folvy'], sinDueno: 0 })
    expect(productosDelDiff(C11B)).toEqual({ pide: ['sumied'], sinDueno: 3 })
    expect(productosDelDiff(D07AC)).toEqual({ pide: ['sumied', 'comun'], sinDueno: 0 })
  })
})

describe('la sección «## Producto»', () => {
  it('lee uno o varios, con o sin tilde; [] si está vacía; null si no está', () => {
    expect(productoDelCuerpo('## Qué hace\nalgo\n\n## Producto\nSumied\n\n## Pruebas\nx')).toEqual(['sumied'])
    expect(productoDelCuerpo('## Producto\nSumied y común')).toEqual(['sumied', 'comun'])
    expect(productoDelCuerpo('## Producto\nFolvy, Común')).toEqual(['folvy', 'comun'])
    expect(productoDelCuerpo('## Producto\n\n## Pruebas')).toEqual([])
    expect(productoDelCuerpo('## Qué hace\nnada')).toBeNull()
  })

  it('cumple si dice lo que pide el diff', () => {
    expect(revisarProducto({ cuerpo: '## Producto\nFolvy', cambiados: C08 })).toEqual([])
    expect(revisarProducto({ cuerpo: '## Producto\nSumied', cambiados: C11B })).toEqual([])
    expect(revisarProducto({ cuerpo: '## Producto\nSumied y Común', cambiados: D07AC })).toEqual([])
  })

  it('falla si no está, si está vacía o si le falta un producto', () => {
    expect(revisarProducto({ cuerpo: '## Qué hace\nx', cambiados: C08 }))
      .toEqual(['Falta la sección «## Producto» en la descripción: Sumied, Folvy o Común (el diff pide Folvy).'])
    expect(revisarProducto({ cuerpo: '## Producto\n', cambiados: C08 })).toEqual(['«## Producto» está vacía: di Sumied, Folvy o Común.'])
    // _shared es común: D07a+D07c no vale con solo «Sumied».
    expect(revisarProducto({ cuerpo: '## Producto\nSumied', cambiados: D07AC })).toEqual(['«## Producto» no dice Común, y el diff lo toca.'])
  })

  it('decir uno que no toca falla solo si no hay ficheros sin dueño que lo justifiquen', () => {
    expect(revisarProducto({ cuerpo: '## Producto\nFolvy y Sumied', cambiados: C08 })).toEqual(['«## Producto» dice Sumied, que este PR no toca.'])
    // #306 lleva migraciones: «Folvy» podría ser suya.
    expect(revisarProducto({ cuerpo: '## Producto\nSumied y Folvy', cambiados: C11B })).toEqual([])
  })
})

describe('las funciones a desplegar, por producto', () => {
  const cuerpo = '## Funciones a desplegar a mano\n\n### Sumied\n- `conta-diez-enviar`\n\n### Folvy\n- send-email\n\n## Pruebas\n- x'
  it('los grupos no cortan la lista de funciones', () => {
    expect(funcionesDelCuerpo(cuerpo)).toEqual(['conta-diez-enviar', 'send-email'])
    expect(gruposDeFunciones(cuerpo)).toEqual([{ funcion: 'conta-diez-enviar', grupo: 'sumied' }, { funcion: 'send-email', grupo: 'folvy' }])
  })
  it('sin grupos vale como antes; con grupos, cada función en el suyo', () => {
    expect(gruposDeFunciones('## Funciones a desplegar a mano\n- send-email')).toBeNull()
    expect(gruposDeFunciones('## Funciones a desplegar a mano\nNinguna.')).toBeNull()
    const mal = '## Producto\nSumied y Folvy\n\n## Funciones a desplegar a mano\n### Folvy\n- conta-diez-enviar'
    expect(revisarProducto({ cuerpo: mal, cambiados: ['supabase/functions/conta-diez-enviar/index.ts', 'src/modules/kitchen/x.ts'] }))
      .toEqual(['«conta-diez-enviar» va en «### Sumied» de «Funciones a desplegar a mano», no en «### Folvy».'])
  })
})
