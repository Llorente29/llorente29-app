/// <reference lib="dom" />
// tests/e2e/conta/c05/rls.spec.ts
//
// C05 · RLS de libros y balances entre las dos cuentas de prueba: B no ve ni
// toca nada de A (libro registro, bienes de inversión, cierre, modelo elegido,
// mapeo propio y su historial) ni puede llamar a las funciones que lo cambian.
// Por la API con la sesión de B, lo mismo que haría su navegador. Primero, el
// control: A sí ve lo suyo; si no, la prueba no prueba nada. Al final, lo de A
// sigue igual.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, pedirSesion } from '../sesion'
import { rest } from '../api'

const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'

test('la cuenta B no ve ni toca los libros de A', async ({ browserName }, info) => {
  void browserName
  test.skip(info.project.name === 'movil', 'La RLS no depende del tamaño de pantalla')
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)

  // Control: A ve lo suyo (semillas del C04 y del C05).
  const libroA = await rest<{ id: string; tax_amount: number }[]>(a, 'GET', `vat_book_entry?select=id,tax_amount&company_id=eq.${EMPRESA_A}`)
  expect(libroA.datos.length).toBeGreaterThan(1)
  const bienesA = await rest<unknown[]>(a, 'GET', `investment_good?select=id&company_id=eq.${EMPRESA_A}`)
  expect(bienesA.datos.length).toBeGreaterThan(0)
  const mapeoA = await rest<unknown[]>(a, 'GET', `annual_accounts_mapping?select=id&company_id=eq.${EMPRESA_A}`)
  expect(mapeoA.datos.length).toBeGreaterThan(0)
  const ejA = await rest<{ id: string }[]>(a, 'GET', `fiscal_year?select=id&company_id=eq.${EMPRESA_A}&status=eq.open`)
  expect(ejA.datos.length).toBe(1)

  // B no VE nada de A.
  for (const ruta of [
    `vat_book_entry?select=id&company_id=eq.${EMPRESA_A}`,
    `investment_good?select=id&company_id=eq.${EMPRESA_A}`,
    `investment_good_regularization?select=id&company_id=eq.${EMPRESA_A}`,
    `fiscal_year_closing?select=fiscal_year_id&company_id=eq.${EMPRESA_A}`,
    `annual_accounts_choice?select=fiscal_year_id&company_id=eq.${EMPRESA_A}`,
    `annual_accounts_mapping?select=id&company_id=eq.${EMPRESA_A}`,
    `annual_accounts_mapping_change?select=id&company_id=eq.${EMPRESA_A}`,
  ]) {
    const r = await rest<unknown[]>(b, 'GET', ruta)
    expect(r.datos, `B ve ${ruta}`).toEqual([])
  }
  // La serie de los modelos sí es de todos (sin empresa).
  const serie = await rest<unknown[]>(b, 'GET', 'annual_accounts_line?select=code&model=eq.pymes&statement=eq.balance&limit=3')
  expect(serie.datos).toHaveLength(3)

  // B no ESCRIBE en lo de A.
  const cambio = await rest<unknown[]>(b, 'PATCH', `vat_book_entry?id=eq.${libroA.datos[0].id}`, { number: 'B-ESTUVO-AQUI' })
  expect(Array.isArray(cambio.datos) ? cambio.datos : []).toEqual([])
  const alta = await rest(b, 'POST', 'investment_good', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, description: 'Bien de B en A', kind: 'mueble', acquired_on: '2026-10-01',
    acquisition_value: 10, tax_base: 10, vat_rate: 21, vat_amount: 2.1, deductible_pct: 100,
  })
  expect(alta.status, 'B da de alta un bien en A').toBeGreaterThanOrEqual(400)
  const eleccion = await rest(b, 'POST', 'annual_accounts_choice', {
    fiscal_year_id: ejA.datos[0].id, account_id: CUENTA_A.id, company_id: EMPRESA_A, model: 'normal', proposed_model: 'pymes',
  })
  expect(eleccion.status, 'B elige el modelo de A').toBeGreaterThanOrEqual(400)

  // Ni las funciones.
  for (const [fn, args] of [
    ['conta_mapeo_cambiar', { p_company: EMPRESA_A, p_model: 'pymes', p_statement: 'pyg', p_prefix: '629', p_line: '7', p_by_balance: null, p_motivo: 'B' }],
    ['conta_mapeo_volver_al_estandar', { p_company: EMPRESA_A, p_model: 'pymes', p_statement: 'pyg', p_prefix: null }],
    ['conta_cierre_enlazar', { p_fiscal_year: ejA.datos[0].id, p_regularizacion: null, p_cierre: null, p_apertura: null }],
    ['conta_cierre_cerrar', { p_fiscal_year: ejA.datos[0].id }],
    ['conta_cierre_reabrir', { p_fiscal_year: ejA.datos[0].id, p_motivo: 'B' }],
  ] as const) {
    const r = await rest(b, 'POST', `rpc/${fn}`, args)
    expect(r.status, `B llama a ${fn} sobre A`).toBeGreaterThanOrEqual(400)
  }
  // Los saldos de A, por su función, a B no le devuelven nada.
  const saldos = await rest<unknown[]>(b, 'POST', 'rpc/conta_saldos_cuentas', { p_company: EMPRESA_A, p_desde: '2026-01-01', p_hasta: '2026-12-31', p_por_local: false })
  expect(Array.isArray(saldos.datos) ? saldos.datos : []).toEqual([])

  // Lo de A sigue igual.
  const despues = await rest<{ id: string; tax_amount: number }[]>(a, 'GET', `vat_book_entry?select=id,tax_amount&company_id=eq.${EMPRESA_A}`)
  expect(despues.datos).toEqual(libroA.datos)
  const mapeoDespues = await rest<unknown[]>(a, 'GET', `annual_accounts_mapping?select=id&company_id=eq.${EMPRESA_A}`)
  expect(mapeoDespues.datos.length).toBe(mapeoA.datos.length)
})
