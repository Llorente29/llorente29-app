// N03 · Una factura de antes del día de inicio: Sumied para y pregunta (17/11). El texto de
// la ventana es el aprobado por Julio y no se cambia ni una palabra: esta prueba lo fija.
// La lista enseña la marcada con su etiqueta gris, en «Apartadas», y no en «Por revisar».

import { describe, expect, it } from 'vitest'
import { deLaBase, etiquetaYaContabilizada, hechoEsNueva, hechoYaEstaba, laPregunta, marcaDeLaFicha, yaVinoTraida } from '@/modules/conta/documentos/antesDelInicio'
import { estadoDeFila, pestanaDeFila, queEsOtra } from '@/modules/conta/documentos/recibidas'
import { punto, type FilaDocumento } from '@/modules/conta/documentos/documentos'

const base = { preguntar: true, fecha: '2026-10-14', dia_inicio: '2026-11-01', programa: 'ERP10', respuesta: null, tiene_asiento: false, traida: null }

describe('N03 · la ventana, palabra por palabra', () => {
  it('con ERP10: la frase de Julio, la pregunta y los dos botones', () => {
    expect(laPregunta(deLaBase(base))).toEqual({
      negrita: 'Esta factura es del 14/10/2026, y esta empresa empezó en Sumied el 01/11/2026.',
      pregunta: '¿Ya estaba contabilizada en ERP10?',
      si: 'Sí, ya estaba',
      no: 'No, es nueva',
    })
  })
  it('con Diez, «en Diez»; con otro programa o ninguno, «en el programa de antes»', () => {
    expect(laPregunta(deLaBase({ ...base, programa: 'Diez' })).pregunta).toBe('¿Ya estaba contabilizada en Diez?')
    expect(laPregunta(deLaBase({ ...base, programa: null })).pregunta).toBe('¿Ya estaba contabilizada en el programa de antes?')
  })
  it('sin vocabulario de contable en lo que se ve', () => {
    const t = Object.values(laPregunta(deLaBase(base))).join(' ')
    for (const p of ['ejercicio', 'devengo', 'corte']) expect(t.toLowerCase()).not.toContain(p)
  })
})

describe('N03 · lo que dice al contestar (regla 8)', () => {
  it('«Sí, ya estaba» y «No, es nueva», con contenido', () => {
    expect(hechoYaEstaba('ERP10')).toBe('Hecho. No se contabiliza: ya estaba en ERP10.')
    expect(hechoEsNueva('2026-11-01', '2026-10-14')).toBe('Contabilizada el 01/11/2026. La fecha de la factura sigue siendo el 14/10/2026.')
  })
  it('la que ya vino con lo traído, y la marca de la ficha con quién y cuándo', () => {
    expect(yaVinoTraida('ERP10')).toBe('Esta factura ya está: vino con lo traído de ERP10')
    expect(marcaDeLaFicha({ programa: 'ERP10', respondidaPor: 'Marta', respondidaEl: '2026-11-17T10:00:00Z' }))
      .toBe('Ya contabilizada en ERP10: no se contabiliza en Sumied (Marta, 17/11/2026).')
  })
  it('de la base: la traída gemela y la respuesta; lo que no viene, nulo', () => {
    const a = deLaBase({ ...base, preguntar: false, respuesta: 'ya_estaba', traida: { id: 'f1', numero: 'F-1', fecha: '2026-10-14' } })
    expect(a.respuesta).toBe('ya_estaba')
    expect(a.traida).toEqual({ id: 'f1', numero: 'F-1', fecha: '2026-10-14' })
    expect(deLaBase({ respuesta: 'otra' }).respuesta).toBeNull()
  })
})

describe('N03 · en la lista (regla 7: sale, marcada)', () => {
  const fila = {
    id: 'f1', tipo: 'factura', estado: 'ya_contabilizada', proveedor: { id: 'p1', nombre: 'Proveedor Inventado' }, numero: 'F-1',
    fecha: '2026-10-14', total: 121, canal: 'a_mano', confianza: null, porque: 'Ya estaba contabilizada en ERP10: no se contabiliza en Sumied.',
    entendido: null, recepcion: null, asiento: null, llego: '2026-11-17T10:00:00Z', programa_antes: 'ERP10',
  } as FilaDocumento
  it('etiqueta gris «Ya contabilizada en ERP10», en «Apartadas», no en «Por revisar»', () => {
    expect(estadoDeFila(fila, undefined)).toEqual({ texto: 'Ya contabilizada en ERP10', tono: 'neutro' })
    expect(pestanaDeFila(fila, undefined)).toBe('otras')
    expect(queEsOtra(fila)).toBe('Ya contabilizada en ERP10')
    expect(punto(fila)).toBe('gris')
  })
  it('sin programa, «en el programa de antes»', () => {
    expect(etiquetaYaContabilizada(null)).toBe('Ya contabilizada en el programa de antes')
  })
})
