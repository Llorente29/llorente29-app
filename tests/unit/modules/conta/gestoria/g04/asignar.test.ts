// G04 · Tarea 4 · «Asignar a un cliente» (src/modules/conta/gestoria/g04/asignar.ts):
// qué clientes de GoCardless faltan por unir y a quién se proponen. Nombres,
// NIF y correos inventados (T11).
import { describe, expect, it } from 'vitest'
import { porAsignar, textoDePropuesta } from '@/modules/conta/gestoria/g04/asignar'
import type { DatosClientes } from '@/modules/conta/gestoria/g04/datos'

const Q = 'emp-qbo'
const A = 'emp-anny'
const EMPRESAS = [{ id: Q, nombre: 'QBO Prueba' }, { id: A, nombre: 'Anny Prueba' }]
const sub = (empresa: string, gc: string, al: number, nombre = 'GESTORIA') => ({ company_id: empresa, gc_id: `S-${gc}-${al}`, gc_cliente_id: gc, nombre, al_mes: al, estado: 'active' })
const vacio = { cargos: [], queHacer: [], asignaciones: [], precios: [], servicios: [], niveles: [], paquetes: [], lineasDePaquete: [], ajustes: [], crm: [], cuotasGc: [], proximos: [] }

const datos = (): DatosClientes => ({
  ...vacio,
  clientes: [
    { cliente_id: '1', empresa_id: Q, cliente: 'Panadería Muestra, S.L.', nif: 'B00000011', cliente_en_gocardless: 'CU1' },
    { cliente_id: '2', empresa_id: Q, cliente: 'Frutas Modelo, S.L.', nif: 'B00000022', cliente_en_gocardless: null },
    { cliente_id: '3', empresa_id: Q, cliente: 'Estudio de Prueba, S.L.', nif: null, cliente_en_gocardless: null, correos: ['admin@estudio-de-prueba.es'] },
    { cliente_id: '4', empresa_id: Q, cliente: 'Clínica Ficticia, S.L.', nif: null, cliente_en_gocardless: null },
    { cliente_id: '5', empresa_id: Q, cliente: 'Clinica Ficticia SL', nif: null, cliente_en_gocardless: null },
  ],
})
/** Las suscripciones activas, en su propia llamada (conta_pantalla_asignar). */
const subs = [
  sub(Q, 'CU1', 100), // ya unido: no sale
  sub(Q, 'CU2', 60.5), sub(Q, 'CU2', 24.2, 'LABORAL'), // por NIF
  sub(Q, 'CU3', 300), // por email
  sub(Q, 'CU4', 45), // por nombre: dos posibles
  sub(Q, 'CU9', 10), // sin propuesta
  sub(A, 'CU2', 80), // otra empresa: solo con «Las dos»
]
const gc = [
  { company_id: Q, gc_id: 'CU2', nombre: 'FRUTAS MODELO', correo: null, nif: 'B-00000022' },
  { company_id: Q, gc_id: 'CU3', nombre: 'Otro nombre', correo: 'Admin@estudio-de-prueba.es', nif: null },
  { company_id: Q, gc_id: 'CU4', nombre: 'Clínica Ficticia, S.L.', correo: null, nif: null },
  { company_id: Q, gc_id: 'CU9', nombre: 'Nadie Conocido', correo: 'nadie@ejemplo.es', nif: null },
]

describe('G04 · Asignar a un cliente', () => {
  it('los que faltan por unir, por lo que cobran al mes, con la propuesta por NIF, email o nombre', () => {
    const xs = porAsignar(datos(), subs, gc, EMPRESAS, [Q])
    expect(xs.map((x) => [x.gcClienteId, x.alMesCent, x.propuesta])).toEqual([
      ['CU3', 30000, { tipo: 'una', clienteId: '3', por: 'email' }],
      ['CU2', 8470, { tipo: 'una', clienteId: '2', por: 'NIF' }],
      ['CU4', 4500, { tipo: 'varias', clienteIds: ['5', '4'], por: 'nombre' }],
      ['CU9', 1000, { tipo: 'ninguna' }],
    ])
    expect(xs[1].suscripciones).toEqual([{ nombre: 'GESTORIA', alMesCent: 6050 }, { nombre: 'LABORAL', alMesCent: 2420 }])
  })
  it('con «Las dos», también los de la otra empresa; sin leer su nombre en GoCardless, su id', () => {
    const xs = porAsignar(datos(), subs, gc, EMPRESAS, [Q, A])
    expect(xs.find((x) => x.empresaId === A)).toMatchObject({ nombre: 'CU2', empresa: 'Anny Prueba', alMesCent: 8000 })
  })
  it('el texto de la propuesta', () => {
    const n = (id: string) => `Cliente ${id}`
    expect([textoDePropuesta({ tipo: 'una', clienteId: '2', por: 'NIF' }, n), textoDePropuesta({ tipo: 'varias', clienteIds: ['4', '5'], por: 'nombre' }, n)])
      .toEqual(['Propuesto por NIF: Cliente 2', '2 posibles por nombre: elige cuál'])
  })
})
