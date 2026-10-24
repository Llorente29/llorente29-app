// tests/unit/modules/conta/p01/altaAsesoria.test.ts
//
// P01 (Julio, 19/10): en el alta, «¿Llevas los impuestos de otras empresas?»
// solo con la marca Sumied, al final de «Tus impuestos», y con «No» de normal.
import { describe, expect, it } from 'vitest'
import { todasLasPreguntas, type ContextoAlta } from '@/modules/conta/alta/guion'
import { PUNTOS } from '@/modules/conta/alta/llevamos'
import { enTexto, fraseAsesoria } from '@/modules/conta/alta/frases'

const CUENTA = { nombre: 'Taberna', razonSocial: 'Taberna de Prueba Norte, S.L.', nif: 'B28000016',
  direccion: { calle: 'Calle de la Prueba 12', codigoPostal: '28001', poblacion: 'Madrid', provincia: 'Madrid' } }
const ctx = (c: Partial<ContextoAlta> = {}): ContextoAlta => ({
  cuenta: CUENTA, tipo: 'company', cp: '28001', clases: ['business'], respuestas: {}, hoy: '2026-10-19', ...c,
})
const claves = (c: ContextoAlta) => todasLasPreguntas('impuestos', c).map((p) => p.clave)

describe('P01 · la pregunta de la asesoría en el alta', () => {
  it('solo con Sumied, y la última de «Tus impuestos»', () => {
    expect(claves(ctx())).not.toContain('asesoria')
    expect(claves(ctx({ marca: 'folvy' }))).not.toContain('asesoria')
    const conSumied = claves(ctx({ marca: 'sumied' }))
    expect(conSumied.at(-1)).toBe('asesoria')
    expect(conSumied.slice(0, -1)).toEqual(claves(ctx()))
  })
  it('el texto, las opciones y lo normal', () => {
    const p = todasLasPreguntas('impuestos', ctx({ marca: 'sumied' })).find((q) => q.clave === 'asesoria')!
    expect(p.texto).toBe('¿Llevas los impuestos de otras empresas?')
    expect(p.opciones.map((o) => o.texto)).toEqual(['No, solo los de mi empresa', 'Sí, soy una asesoría'])
    expect(p.normal).toBe('no')
  })
  it('cuenta en «Tus impuestos» de «Lo que llevamos», y dice qué ha entendido', () => {
    expect(PUNTOS.find((x) => x.clave === 'impuestos')!.preguntas).toContain('asesoria')
    expect(enTexto(fraseAsesoria(true))).toBe('Entendido: llevas los impuestos de otras empresas. Al terminar te llevo a «Impuestos de tus clientes».')
    expect(enTexto(fraseAsesoria(false))).toBe('Entendido: solo los de tu empresa.')
  })
})
