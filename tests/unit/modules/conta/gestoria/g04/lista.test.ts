// G04 · Tarea 2 · La lista de clientes con una empresa y con «Las dos», sin
// duplicados; «Te deben»; el cliente más probable para un cobro de GoCardless
// sin cliente (supabase/functions/_shared/tarifa/lista.ts). Clientes, NIF de
// ceros, correos e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  SIN_EMPRESA, filasDe, grupoDe, ordenar, pasaLaBusqueda, proponerCliente, teDeben, vistaDeLaLista,
  type CargoDeGoCardless, type FilaDeCliente,
} from '../../../../../../supabase/functions/_shared/tarifa/lista'

const QBO = 'empresa-qbo'
const ANNY = 'empresa-anny'
const f = (clienteId: string, empresaId: string | null, x: Partial<FilaDeCliente> = {}): FilaDeCliente => ({
  clienteId, empresaId, nombre: `Cliente ${clienteId}`, nif: null, situacion: 'activo', pendientes: 0, devuelto: false, debeCent: 0, mandato: 'firmado', trabajadores: [], ...x,
})
const todas: FilaDeCliente[] = [
  f('1', QBO, { nombre: 'Talleres Ejemplo, S.L.' }),
  f('2', QBO, { nombre: 'Ábaco Prueba, S.L.', pendientes: 1, devuelto: true, debeCent: 32670 }),
  f('2', ANNY, { nombre: 'Ábaco Prueba, S.L.' }), // con las dos empresas
  f('3', ANNY, { nombre: 'María Ejemplo López', mandato: 'por_firmar', pendientes: 1 }),
  f('4', QBO, { nombre: 'Baja Ejemplo', situacion: 'baja' }),
  f('5', null, { nombre: 'Sin Nada Ejemplo', situacion: 'solo_renta' }),
  f('1', QBO, { nombre: 'Talleres Ejemplo, S.L.' }), // repetida (llega dos veces de la base)
  f('6', null, { nombre: 'Con Empresa Ejemplo' }),
  f('6', QBO, { nombre: 'Con Empresa Ejemplo', situacion: 'sin_clasificar' }),
]

describe('G04 · la lista con una empresa y con «Las dos»', () => {
  it('con una empresa, solo sus filas, sin repetir y sin los «sin empresa»', () => {
    expect(filasDe(todas, { tipo: 'empresa', empresaId: QBO }).map((x) => x.clienteId)).toEqual(['1', '2', '4', '6'])
    expect(filasDe(todas, { tipo: 'empresa', empresaId: ANNY }).map((x) => x.clienteId)).toEqual(['2', '3'])
  })
  it('en «Las dos», un cliente con las dos sale dos veces (cada una con lo suyo), y nada se repite', () => {
    const d = filasDe(todas, { tipo: 'las_dos' })
    expect(d.map((x) => `${x.clienteId}|${x.empresaId ?? '-'}`)).toEqual([`1|${QBO}`, `2|${QBO}`, `2|${ANNY}`, `3|${ANNY}`, `4|${QBO}`, '5|-', `6|${QBO}`])
    expect(new Set(d.map((x) => `${x.clienteId}|${x.empresaId}`)).size).toBe(d.length)
  })
  it('un cliente sin empresa: solo en «Las dos › Otros»; con alguna empresa, nunca además «sin empresa»', () => {
    const v = vistaDeLaLista(todas, { tipo: 'las_dos' }, 'otros', 'todos', '')
    expect(v.filas.map((x) => x.clienteId)).toEqual(['4', '5'])
    expect(grupoDe(f('7', null, { situacion: 'activo' }))).toBe('otros')
    expect(SIN_EMPRESA).toBe('Sin empresa que le facture')
  })
  it('«Se les cobra» y «Otros», con sus recuentos de todas las filas', () => {
    expect(vistaDeLaLista(todas, { tipo: 'empresa', empresaId: QBO }, 'se_cobra', 'todos', '').enGrupo).toEqual({ se_cobra: 3, otros: 1 })
    const d = vistaDeLaLista(todas, { tipo: 'las_dos' }, 'se_cobra', 'todos', '')
    expect([d.enGrupo, d.clientes]).toEqual([{ se_cobra: 5, otros: 2 }, 6])
  })
  it('los filtros y su número', () => {
    const v = vistaDeLaLista(todas, { tipo: 'las_dos' }, 'se_cobra', 'necesitan_algo', '')
    expect(v.filas.map((x) => x.clienteId)).toEqual(['2', '3'])
    expect(v.conFiltro).toEqual({ todos: 5, necesitan_algo: 2, devueltos: 1, te_deben: 1, sin_mandato: 1 })
  })
  it('primero los que necesitan algo; después, por nombre (con tildes como en español)', () => {
    expect(ordenar(filasDe(todas, { tipo: 'empresa', empresaId: QBO })).map((x) => x.nombre)).toEqual(['Ábaco Prueba, S.L.', 'Baja Ejemplo', 'Con Empresa Ejemplo', 'Talleres Ejemplo, S.L.'])
    expect(ordenar([f('a', QBO, { nombre: 'Zeta' }), f('b', QBO, { nombre: 'Alfa' }), f('c', QBO, { nombre: 'Zeta', pendientes: 2 })]).map((x) => x.clienteId)).toEqual(['c', 'b', 'a'])
  })
  it('el buscador: por cliente, NIF o trabajador, sin tildes ni mayúsculas', () => {
    const x = f('9', QBO, { nombre: 'Panadería Muestra, S.L.', nif: 'B-00000022', trabajadores: ['Lucía Prueba Soto'] })
    expect(['panaderia', 'B00000022', '00000022', 'lucia', '', 'otra cosa'].map((q) => pasaLaBusqueda(x, q))).toEqual([true, true, true, true, true, false])
  })
})

describe('G04 · Te deben: devuelto en GoCardless y sin cobrar después, con mandato activo', () => {
  const cargo = (id: string, x: Partial<CargoDeGoCardless>): CargoDeGoCardless =>
    ({ id, empresaId: QBO, clienteId: 'c1', suscripcionId: 's1', estado: 'failed', fecha: '2026-10-04', importeCent: 10890, mandatoActivo: true, ...x })
  const cargos = [
    cargo('a', { fecha: '2026-08-04' }), // más de 60 días
    cargo('b', { fecha: '2026-10-04', estado: 'charged_back' }),
    cargo('c', { suscripcionId: 's2', fecha: '2026-09-04' }),
    cargo('c2', { suscripcionId: 's2', fecha: '2026-10-04', estado: 'paid_out' }), // cobrado después: «c» sale
    cargo('d', { clienteId: 'c2', mandatoActivo: false }), // mandato cancelado: no cuenta
    cargo('e', { clienteId: 'c3' }), // cobrado por otra vía
  ]
  it('cuenta los que deben, por antigüedad', () => {
    const r = teDeben(cargos, new Set(['e']), '2026-11-08')
    expect([r.cargos.map((x) => x.id), r.totalCent, r.clientes, r.masDe60, r.masDe60Cent]).toEqual([['a', 'b'], 21780, 1, 1, 10890])
  })
  it('«Cobrado por otra vía» lo saca', () => {
    expect(teDeben(cargos, new Set(['a', 'b', 'e']), '2026-11-08').totalCent).toBe(0)
  })
})

describe('G04 · el cliente más probable para un cobro de GoCardless sin cliente', () => {
  const clientes = [
    { id: 'n1', nombre: 'Talleres Ejemplo, S.L.', nif: 'B00000066', correos: ['taller@ejemplo.es'] },
    { id: 'n2', nombre: 'Estudio de Prueba S.L.', nif: null, correos: ['estudio@ejemplo.es'] },
    { id: 'n3', nombre: 'Jorge Prueba Martín', nif: '00000055K', correos: [] },
    { id: 'n4', nombre: 'Jorge Prueba Martin', nif: null, correos: [] },
  ]
  it('primero el NIF (sin guiones ni mayúsculas)', () => {
    expect(proponerCliente({ nombre: 'Otro nombre', correo: null, nif: 'b-00000066' }, clientes)).toEqual({ tipo: 'una', clienteId: 'n1', por: 'NIF' })
  })
  it('después el email', () => {
    expect(proponerCliente({ nombre: null, correo: 'ESTUDIO@ejemplo.es ', nif: null }, clientes)).toEqual({ tipo: 'una', clienteId: 'n2', por: 'email' })
  })
  it('después el nombre, sin tildes ni «S.L.»', () => {
    expect(proponerCliente({ nombre: 'ESTUDIO DE PRUEBA, SL', correo: 'otro@ejemplo.es', nif: null }, clientes)).toEqual({ tipo: 'una', clienteId: 'n2', por: 'nombre' })
  })
  it('si dos son igual de probables, no elige: los da a los dos', () => {
    expect(proponerCliente({ nombre: 'jorge prueba martín', correo: null, nif: null }, clientes)).toEqual({ tipo: 'varias', clienteIds: ['n3', 'n4'], por: 'nombre' })
  })
  it('sin nada que case: ninguna', () => {
    expect(proponerCliente({ nombre: 'Nadie', correo: 'nadie@ejemplo.es', nif: '12' }, clientes)).toEqual({ tipo: 'ninguna' })
  })
})
