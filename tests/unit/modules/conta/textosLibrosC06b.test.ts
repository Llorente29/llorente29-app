// tests/unit/modules/conta/textosLibrosC06b.test.ts
//
// C06b (16/10, Julio) · Textos de Libros: el nombre de cuenta con mayúscula
// inicial y el motivo de «Por aclarar» igual que el freno de la base.
//
// Los nombres tienen la FORMA de los 100 que vienen enteros en mayúsculas en
// la C0008 (medidos en producción el 16/10, solo lectura): textos del PGC,
// plataformas, abreviaturas de Diez, siglas, cuentas de banco y razones
// sociales. Las razones sociales y los números de cuenta son inventados.

import { describe, expect, it } from 'vitest'
import { nombreEnPantalla } from '../../../../src/modules/conta/lib/nombreCuenta'
import { motivoPorAclarar } from '../../../../src/modules/conta/lib/diario'

describe('el nombre de una cuenta en pantalla', () => {
  const CASOS: [string, string][] = [
    ['PROMOCIONES GLOVO', 'Promociones Glovo'],
    ['ENVÍOS COBRADOS', 'Envíos Cobrados'],
    ['H.P. IVA REPERCUTIDO 10%', 'H.P. IVA Repercutido 10%'],
    ['UBER EATS', 'Uber Eats'],
    ['DEUDAS A CORTO PLAZO CON PARTES VINCULADAS', 'Deudas a Corto Plazo con Partes Vinculadas'],
    ['CUENTA CORRIENTE CON SOCIOS Y ADMINISTRADORES JKL', 'Cuenta Corriente con Socios y Administradores JKL'],
    ['ACREEDORES POR ARRENDAMIENTO FINANCIERO A L/P PARTES VINCULA', 'Acreedores por Arrendamiento Financiero a L/P Partes Vincula'],
    ['DEUDAS C/P CON ENTIDADES DE CRÉDITO BBVA 0000 1111 22 333333', 'Deudas C/P con Entidades de Crédito BBVA 0000 1111 22 333333'],
    ['BBVA ES00 0000 0000 0000 0000 0000', 'BBVA ES00 0000 0000 0000 0000 0000'],
    ['HACIENDA PÚBLICA, ACREEDORA POR CONCEPTOS FISCALES', 'Hacienda Pública, Acreedora por Conceptos Fiscales'],
    ['DEVOL. VENTAS CASA LOLA', 'Devol. Ventas Casa Lola'],
    ["VENTAS LOLA'S BURGER", "Ventas Lola's Burger"],
    ['EJEMPLO SERVICIOS, S.L.', 'Ejemplo Servicios, S.L.'],
    ['EJEMPLO IBERIA SL', 'Ejemplo Iberia SL'],
    ['EJEMPLO PTE. LTD.', 'Ejemplo Pte. Ltd.'],
    ['EJEMPLO INC.', 'Ejemplo Inc.'],
    ['ANA PÉREZ (SERVICIOS DE PRUEBA)', 'Ana Pérez (Servicios de Prueba)'],
    ['OTROS SERVICIOS - GESTORIA', 'Otros Servicios - Gestoria'],
    ['A CUENTA', 'A Cuenta'],
  ]
  for (const [de, a] of CASOS) it(`«${de}» → «${a}»`, () => expect(nombreEnPantalla(de)).toBe(a))
  it('lo que ya trae minúsculas se queda como está (lo escribió alguien así)', () => {
    for (const n of ['IVA repercutido 10 %', 'Hacienda Pública, IVA repercutido', 'Comisiones de plataformas', 'Clientes · Casa Lola']) expect(nombreEnPantalla(n)).toBe(n)
  })
  it('sin letras, tal cual', () => {
    expect(nombreEnPantalla('')).toBe('')
    expect(nombreEnPantalla('4300 0001')).toBe('4300 0001')
  })
})

describe('el motivo de «Por aclarar», igual que el freno de la base', () => {
  it('el mismo texto que tg_journal_entry_envio_por_aclarar (20261116T0100)', () => {
    expect(motivoPorAclarar([{ codigo: 'PR-3', envio: 2, porQue: 'repartió la plataforma' }]))
      .toBe('No se valida: 1 pedido con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma). Se resuelve con la liquidación de esa semana.')
    expect(motivoPorAclarar([{ codigo: 'PR-3', envio: 2, porQue: 'repartió la plataforma' }, { codigo: 'PR-7', envio: 1.5, porQue: 'el pedido es de recogida' }]))
      .toBe('No se valida: 2 pedidos con envío por aclarar: PR-3 (envío 2,00 €, repartió la plataforma); PR-7 (envío 1,50 €, el pedido es de recogida). Se resuelve con la liquidación de esa semana.')
  })
  it('sin ninguno, nada', () => expect(motivoPorAclarar([])).toBeNull())
})
