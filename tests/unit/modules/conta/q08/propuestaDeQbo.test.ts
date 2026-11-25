// tests/unit/modules/conta/q08/propuestaDeQbo.test.ts
//
// Q08 · Los 19 que QBO dejó pendientes en su Excel: escribió un nombre de
// empresa o de persona en vez del nº de ficha. «Cobros de GoCardless sin
// cliente» propone la ficha con ese nombre (exacto; si no hay, la que lleva
// todas sus palabras, diciendo que no es igual), para confirmarla con un clic.
// Nada se ata solo; con varias o ninguna, lo dice. Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { fichasDeQbo, porAsignar, textoDelPendiente, textoDeQbo } from '@/modules/conta/gestoria/g04/asignar'
import type { DatosClientes } from '@/modules/conta/gestoria/g04/datos'

const ficha = (id: string, nombre: string) => ({ id, nombre, nif: null, correos: [] })
const FICHAS = [
  ficha('f1', 'EMPRESA EJEMPLO UNO, S.L.'), ficha('f2', 'Persona Prueba Gómez'), ficha('f3', 'Persona Prueba Gómez'),
  ficha('f4', 'TALLERES DE EJEMPLO DEL NORTE SL'), ficha('f5', 'Otra Ficha Inventada'),
]
const nombreDe = (id: string) => FICHAS.find((f) => f.id === id)!.nombre

describe('Q08 · la ficha que dice el texto de QBO', () => {
  it('se llama igual (sin tildes, mayúsculas ni signos): esa, para confirmarla', () => {
    const q = fichasDeQbo('Empresa Ejemplo Uno SL', FICHAS)
    expect(q).toEqual({ texto: 'Empresa Ejemplo Uno SL', como: 'igual', clienteIds: ['f1'] })
    expect(textoDeQbo(q, nombreDe)).toBe('QBO escribió «Empresa Ejemplo Uno SL»: la ficha «EMPRESA EJEMPLO UNO, S.L.» se llama así. Confírmala con un clic.')
  })
  it('varias se llaman igual: lo dice y no elige', () => {
    const q = fichasDeQbo('persona prueba gomez', FICHAS)
    expect(q.clienteIds).toEqual(['f2', 'f3'])
    expect(textoDeQbo(q, nombreDe)).toBe('QBO escribió «persona prueba gomez»: 2 fichas se llaman así. Elige cuál.')
  })
  it('ninguna se llama igual pero una lleva todas sus palabras: la propone, diciendo que no es igual', () => {
    const q = fichasDeQbo('Talleres Ejemplo Norte', FICHAS)
    expect(q).toEqual({ texto: 'Talleres Ejemplo Norte', como: 'contiene', clienteIds: ['f4'] })
    expect(textoDeQbo(q, nombreDe)).toContain('ninguna ficha se llama exactamente así; «TALLERES DE EJEMPLO DEL NORTE SL» lleva ese nombre')
  })
  it('ninguna: lo dice', () => {
    const q = fichasDeQbo('Nombre Que No Existe', FICHAS)
    expect(q).toEqual({ texto: 'Nombre Que No Existe', como: 'ninguna', clienteIds: [] })
    expect(textoDeQbo(q, nombreDe)).toBe('QBO escribió «Nombre Que No Existe»: ninguna ficha de Bitrix24 se llama así. Búscala abajo o créala allí.')
  })
  it('una frase larga no es un nombre: no se busca por palabras', () => {
    expect(fichasDeQbo('ella paga la empresa ejemplo uno, mirar la ficha de la madre y el padre', FICHAS).como).toBe('ninguna')
  })
  it('el texto sale del porqué del pendiente, sin la coletilla del nº que no estaba', () => {
    expect(textoDelPendiente('Pendiente de revisar. QBO, Excel del 12/11 escribió: «Persona Prueba Gómez».')).toBe('Persona Prueba Gómez')
    expect(textoDelPendiente('Pendiente de revisar. QBO, Excel del 12/11 escribió: «Es la candidata 1 (la ficha nº 909 no está en lo leído de Bitrix24)».')).toBe('Es la candidata 1')
    expect(textoDelPendiente('Su correo está en 2 fichas.')).toBeNull()
  })
})

describe('Q08 · en «Cobros de GoCardless sin cliente»', () => {
  const E = 'emp-prueba'
  const datos = { clientes: FICHAS.map((f) => ({ cliente_id: f.id, cliente: f.nombre, empresa_id: E, cliente_en_gocardless: null })) } as unknown as DatosClientes
  const susc = (gc: string, al: number) => ({ company_id: E, gc_cliente_id: gc, estado: 'active', nombre: 'GESTORIA MENSUAL', al_mes: al })
  const gcs = [{ company_id: E, gc_id: 'CU-A', nombre: 'GC UNO' }, { company_id: E, gc_id: 'CU-B', nombre: 'GC DOS' }]
  const pend = [{ company_id: E, gc_cliente_id: 'CU-A', porque: 'Pendiente de revisar. QBO, Excel del 12/11 escribió: «Empresa Ejemplo Uno SL».' }]
  const lista = porAsignar(datos, [susc('CU-B', 500), susc('CU-A', 100)], gcs, [{ id: E, nombre: 'Gestoría de Prueba' }], [E], pend)
  it('los que contestó QBO, primero; con su propuesta, sin unir nada', () => {
    expect(lista.map((x) => x.gcClienteId)).toEqual(['CU-A', 'CU-B'])
    expect(lista[0].deQbo).toEqual({ texto: 'Empresa Ejemplo Uno SL', como: 'igual', clienteIds: ['f1'] })
    expect(lista[1].deQbo).toBeNull()
  })
})
