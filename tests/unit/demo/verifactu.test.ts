// tests/unit/demo/verifactu.test.ts
//
// DM1 · PR 2a (31/10/2026) · Verifactu, con la puerta: un lote de una cuenta
// de demo no llega a Hacienda (no se llama ni se pide el certificado) y queda
// apuntado como correcto, sin CSV y con «En la demo no se envía de verdad».
// Uno de verdad, como siempre. Y «Comprobar con Hacienda» en una demo no
// consulta: lo dice.

import { describe, it, expect } from 'vitest'
import { unaVuelta, type Lote, type Piezas } from '../../../supabase/functions/_shared/verifactu/enviar'
import { vueltaDeCuadres, type CuadreTomado } from '../../../supabase/functions/_shared/verifactu/cuadre'
import { EN_LA_DEMO } from '../../../supabase/functions/_shared/puerta'

const lote = (id: string, company: string): Lote => ({
  envio_id: id, entorno: 'pruebas', nif_emisor: '00000000T', company_id: company,
  registros: [{ id: `${id}-r1`, tipo: 'alta', nombre_emisor: 'Empresa Inventada', num_serie: 'F-1', fecha_expedicion: '2026-10-30' } as unknown as Lote['registros'][number]],
})

function piezas(lotes: Lote[], demo: Set<string>) {
  const cola = [...lotes]
  const llamadas: string[] = []
  const respuestas: Record<string, Record<string, unknown>> = {}
  const p: Piezas = {
    tomar: async () => cola.shift() ?? null,
    responder: async (id, x) => { respuestas[id] = x },
    fallar: async () => undefined,
    material: async (l) => { llamadas.push(`material:${l.envio_id}`); throw new Error('sin certificado en la prueba') },
    llamar: async () => { llamadas.push('llamar'); throw new Error('no debería llamar') },
    sistema: { nombreRazon: 'X', nif: '00000000T', nombre: 'Sumied', id: 'SU', version: '1', numeroInstalacion: 'pruebas' } as Piezas['sistema'],
    url: 'https://hacienda.invalid',
    enLaDemo: async (l) => demo.has(l.company_id),
  }
  return { p, llamadas, respuestas }
}

describe('Verifactu con la puerta de las demos', () => {
  it('un lote de demo no pide el certificado ni llama a Hacienda, y queda hecho en la demo', async () => {
    const { p, llamadas, respuestas } = piezas([lote('e1', 'demo')], new Set(['demo']))
    const r = await unaVuelta(p, 'pruebas')
    expect(llamadas).toEqual([])
    expect(r.en_la_demo).toBe(1)
    expect(respuestas.e1).toMatchObject({ estado_envio: 'Correcto', csv: null, respuesta: EN_LA_DEMO })
    expect(respuestas.e1.registros).toEqual([{ id: 'e1-r1', estado: 'Correcto', codigo: null, descripcion: EN_LA_DEMO }])
  })

  it('uno de verdad sigue su camino de siempre: no se apunta como de demo (aquí falla al prepararlo, sin red)', async () => {
    const { p, respuestas } = piezas([lote('e2', 'verdad')], new Set(['demo']))
    const r = await unaVuelta(p, 'pruebas')
    expect(r.en_la_demo).toBe(0)
    expect(r.fallos.length).toBe(1)
    expect(respuestas.e2).toBeUndefined()
  })

  it('«Comprobar con Hacienda» en una demo no consulta: falla diciéndolo', async () => {
    const c: CuadreTomado = { cuadre_id: 'c1', entorno: 'pruebas', company_id: 'demo', nif_emisor: '00000000T', nombre_emisor: 'X', ejercicio: 2026, periodo: '10' }
    let tomado = false
    const fallos: string[] = []
    const r = await vueltaDeCuadres({
      tomar: async () => (tomado ? null : (tomado = true, c)),
      pagina: async () => { throw new Error('no debería consultar') },
      fallar: async (_id, e) => { fallos.push(e) },
      material: async () => { throw new Error('no debería pedir el certificado') },
      llamar: async () => { throw new Error('no debería llamar') },
      url: 'https://hacienda.invalid',
      enLaDemo: async (x) => x.company_id === 'demo',
    }, 'pruebas')
    expect(r.hechos).toBe(0)
    expect(fallos[0]).toContain(EN_LA_DEMO)
  })
})
