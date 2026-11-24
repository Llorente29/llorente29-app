// tests/unit/modules/conta/q08/decisionesQbo.test.ts
//
// Q08 · Paso 2 · Atar desde el Excel de QBO: qué dice cada fila. Las formas de
// cada columna son las del Excel «Atar clientes GoCardless» del 12/11
// contestado por QBO (sus cabeceras y la forma de «Ficha candidata»: «nombre ·
// nº 909 · activa · antes enlazada»), con datos INVENTADOS (T11): el Excel de
// verdad no entra nunca en el repositorio.

import { describe, expect, it } from 'vitest'
import { ORIGEN_QBO, clienteGcDe, emisorDe, fichaPorNombre, filasDeLaHoja, intencionDe, numeroDeCandidata, resumen } from '@/modules/conta/gestoria/decisionesQbo'

const CAB = ['Grupo', 'Cobra', 'Cliente en GoCardless', 'Correo en GoCardless', '€/mes en GoCardless', 'Qué paga (suscripciones)', 'Ficha candidata 1', 'Ficha candidata 2', 'Ficha candidata 3', 'Decisión', 'Nº de ficha en Bitrix24', 'Notas', 'Qué hacer']
const fila = (cobra: string, cliente: string, correo: string, c1: string, c2: string, decision: string, numero = '') =>
  ['Dos fichas posibles', cobra, cliente, correo, '121', 'GESTORIA MENSUAL', c1, c2, '', decision, numero, '', '']

describe('Q08 · qué dice cada fila del Excel de QBO', () => {
  it('«Es la candidata N»: la ficha de esa candidata, por su nº de Bitrix24', () => {
    expect(intencionDe('Es la candidata 2', '', ['EMPRESA EJEMPLO UNO SL · nº 909 · activa', 'EMPRESA EJEMPLO DOS SL · nº 1365 · activa'])).toEqual({ que: 'por_numero', bitrixId: '1365', de: 'la candidata 2' })
    expect(numeroDeCandidata('EMPRESA EJEMPLO UNO SL · nº 909 · activa · antes enlazada')).toBe('909')
  })
  it('un nº en «Nº de ficha en Bitrix24» manda', () => {
    expect(intencionDe('Es la candidata 1', '4321', ['EMPRESA EJEMPLO UNO SL · nº 909'])).toEqual({ que: 'por_numero', bitrixId: '4321', de: 'su nº de ficha' })
  })
  it('en blanco: se ata solo, no se toca', () => {
    expect(intencionDe('', '', [])).toEqual({ que: 'solo' })
  })
  it('un nombre de ficha: se busca por ese nombre', () => {
    expect(intencionDe('EMPRESA DE EJEMPLO S.L.', '', [])).toEqual({ que: 'por_nombre', nombre: 'EMPRESA DE EJEMPLO S.L.' })
  })
  it('lo que no se entiende no se adivina: pendiente, con el texto de QBO', () => {
    const texto = 'ella paga empresa bitrix EMPRESA DE EJEMPLO SL, mirar la ficha de la madre'
    expect(intencionDe(texto, '', [])).toEqual({ que: 'pendiente', texto })
    // «Es la candidata 3» sin tercera candidata: tampoco se adivina.
    expect(intencionDe('Es la candidata 3', '', ['UNA · nº 1', 'OTRA · nº 2'])).toEqual({ que: 'pendiente', texto: 'Es la candidata 3' })
  })
})

describe('Q08 · leer la hoja «Para atar»', () => {
  it('por sus cabeceras, saltando las filas sin cliente', () => {
    const f = filasDeLaHoja([CAB, fila('QBO Integrity', 'EMPRESA EJEMPLO UNO SL', 'uno@ejemplo.test', 'EMPRESA EJEMPLO UNO SL · nº 909', '', 'Es la candidata 1'), ['', '', '', '']])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ fila: 2, emisor: 'QBO Integrity', cliente: 'EMPRESA EJEMPLO UNO SL', correo: 'uno@ejemplo.test', intencion: { que: 'por_numero', bitrixId: '909' } })
  })
  it('si no es el Excel de QBO, lo dice', () => {
    expect(() => filasDeLaHoja([['Otra', 'cosa']])).toThrow(/«Cobra»/)
  })
})

describe('Q08 · encontrar la empresa, el cliente de GoCardless y la ficha', () => {
  const empresas = [{ id: 'e1', nombre: 'QBO INTEGRITY S.L.' }, { id: 'e2', nombre: 'EJEMPLO DIAZ, ANA MARIA' }]
  it('el emisor de «Cobra»: todas sus palabras en el nombre de una sola empresa', () => {
    expect(emisorDe('QBO Integrity', empresas)?.id).toBe('e1')
    expect(emisorDe('Ana Ejemplo', empresas)?.id).toBe('e2')
    expect(emisorDe('Otra Gestoría', empresas)).toBeNull()
  })
  const clientes = [
    { gcId: 'CU1', nombre: 'Empresa Ejemplo Uno SL', correo: 'uno@ejemplo.test' },
    { gcId: 'CU2', nombre: 'Persona Ejemplo', correo: 'dos@ejemplo.test' },
    { gcId: 'CU3', nombre: 'Persona Ejemplo', correo: 'tres@ejemplo.test' },
  ]
  it('el cliente de GoCardless: por el nombre (sin tildes ni mayúsculas); con dos iguales, el del correo', () => {
    expect(clienteGcDe({ cliente: 'EMPRESA EJEMPLO UNO, S.L.', correo: '' }, clientes)?.gcId).toBe('CU1')
    expect(clienteGcDe({ cliente: 'Persona Ejemplo', correo: 'TRES@ejemplo.test' }, clientes)?.gcId).toBe('CU3')
    expect(clienteGcDe({ cliente: 'Persona Ejemplo', correo: '' }, clientes)).toBeNull()
  })
  it('la ficha por el nombre que escribió QBO: solo si hay una', () => {
    const fichas = [{ partyId: 'p1', nombre: 'Ejemplo Árbol S.L.' }, { partyId: 'p2', nombre: 'Repetida SL' }, { partyId: 'p3', nombre: 'REPETIDA S.L' }]
    expect(fichaPorNombre('EJEMPLO ARBOL SL', fichas)?.partyId).toBe('p1')
    expect(fichaPorNombre('Repetida SL', fichas)).toBeNull()
  })
})

describe('Q08 · lo que dice al acabar (regla 8)', () => {
  it('con sus números', () => {
    const l = (resultado: 'atado' | 'pendiente' | 'solo' | 'sin_cliente', fila: number) => ({ fila, emisor: 'QBO Integrity', cliente: 'X', resultado, frase: '' })
    expect(resumen([l('atado', 2), l('atado', 3), l('pendiente', 4), l('solo', 5), l('sin_cliente', 6)]))
      .toBe('Cargadas las decisiones de QBO (5 filas): 2 atados a su ficha, 1 pendientes de revisar con el texto de QBO, 1 que se atan solos, 1 que no están en lo leído de GoCardless.')
    expect(ORIGEN_QBO).toBe('QBO, Excel del 12/11')
  })
})
