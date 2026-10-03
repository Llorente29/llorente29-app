// tests/e2e/conta/c00/rls.spec.ts
//
// Tarea 8 del C00 (encargo §9.4): la RLS de las tablas del C00, por la API y
// con la sesión de cada usuario, como lo haría la pantalla.
//
//   · Dos cuentas: B no ve ni toca nada de A.
//   · Dos empresas dentro de una cuenta: A ve las dos y cada dato cuelga de la
//     suya; B no ve ninguna.
//   · Los socios y cargos solo los ve un administrador: el encargado de A
//     (rol manager, semilla seed_c00_encargado_prueba.sql) ve la empresa pero
//     no sus socios.
//
// Lo que se crea se borra al acabar, con la sesión del administrador de A.
// Solo habla con la API: no depende del tamaño de pantalla.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, ENCARGADO_A, pedirSesion, type Sesion } from '../sesion'
import { rest, cifInventado } from '../api'

const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'

/** Las tablas del C00 que llevan account_id: B no puede ver ni una fila de A en ninguna. */
const TABLAS_DE_CUENTA = [
  'company', 'company_tax_profile', 'company_activity', 'company_person', 'company_relation', 'company_doubt',
  'fiscal_year', 'fiscal_period_lock', 'treasury_account', 'invoice_series', 'general_row_setting',
  'ai_data_origin', 'ai_action_log', 'ai_suggestion',
]
/** Las tablas generales: las filas de serie las ve todo el mundo; las propias de A, solo A. */
const TABLAS_CON_SERIE = ['tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category']

const filas = (r: { datos: unknown }) => (Array.isArray(r.datos) ? r.datos.length : -1)

test.beforeEach(({ browserName }, info) => {
  void browserName
  test.skip(info.project.name === 'movil', 'Solo API: basta un tamaño')
})

test('dos cuentas: B no ve ni toca nada de A', async () => {
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)

  // A sí ve lo suyo: si no, el «0» de B no probaría nada.
  expect(filas(await rest(a, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}`))).toBeGreaterThan(0)
  for (const t of TABLAS_DE_CUENTA) {
    const r = await rest(b, 'GET', `${t}?select=account_id&account_id=eq.${CUENTA_A.id}`)
    expect(r.status, `B leyendo ${t}`).toBe(200)
    expect(filas(r), `B no ve ninguna fila de A en ${t}`).toBe(0)
  }
  for (const t of TABLAS_CON_SERIE) {
    expect(filas(await rest(b, 'GET', `${t}?select=id&account_id=eq.${CUENTA_A.id}&is_system=eq.false`)), `B no ve las filas propias de A en ${t}`).toBe(0)
    expect(filas(await rest(b, 'GET', `${t}?select=id&is_system=eq.true&limit=1`)), `B sí ve las de serie de ${t}`).toBe(1)
  }

  // Ni escribir: cambiar la empresa de A no toca ninguna fila…
  const cambio = await rest(b, 'PATCH', `company?id=eq.${EMPRESA_A}`, { legal_name: 'Cambiada por B' })
  expect(filas(cambio), 'B no cambia la empresa de A').toBe(0)
  // …crear algo a nombre de A, lo rechaza la base…
  const alta = await rest(b, 'POST', 'company', { account_id: CUENTA_A.id, legal_name: 'Colada por B' })
  expect(alta.status, 'B no crea empresas en A').toBeGreaterThanOrEqual(400)
  // …y colgar algo suyo de la empresa de A, también.
  const duda = await rest(b, 'POST', 'company_doubt', { account_id: CUENTA_B.id, company_id: EMPRESA_A, question_key: 'rls', question: '¿?', default_answer: 'no' })
  expect(duda.status, 'B no cuelga una duda de la empresa de A').toBeGreaterThanOrEqual(400)
  // …ni que la IA ponga un dato en la empresa de A.
  const ia = await rest(b, 'POST', 'rpc/conta_ia_poner', { p_company: EMPRESA_A, p_tabla: 'company', p_campo: 'trade_name', p_valor: 'B', p_motivo: 'rls' })
  expect(ia.status, 'B no pone datos con la IA en la empresa de A').toBeGreaterThanOrEqual(400)

  // Y la empresa de A sigue como estaba.
  const sigue = await rest<{ legal_name: string }[]>(a, 'GET', `company?select=legal_name&id=eq.${EMPRESA_A}`)
  expect(sigue.datos[0]?.legal_name).toBe('Taberna de Prueba Norte, S.L.')
})

test('dos empresas en una cuenta: cada dato cuelga de la suya, y B no ve ninguna', async () => {
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)
  const nif = cifInventado()
  let segunda: string | null = null
  try {
    const r = await rest<{ id: string }[]>(a, 'POST', 'company', { account_id: CUENTA_A.id, legal_name: 'RLS e2e segunda empresa', tax_id: nif })
    expect(r.status, 'A crea su segunda empresa').toBe(201)
    segunda = r.datos[0].id
    const d = await rest(a, 'POST', 'company_doubt', { account_id: CUENTA_A.id, company_id: segunda, question_key: 'rls', question: '¿De cuál es esto?', default_answer: 'de la segunda' })
    expect(d.status).toBe(201)

    expect(filas(await rest(a, 'GET', `company?select=id&account_id=eq.${CUENTA_A.id}&id=in.(${EMPRESA_A},${segunda})`)), 'A ve sus dos empresas').toBe(2)
    expect(filas(await rest(a, 'GET', `company_doubt?select=id&company_id=eq.${segunda}&question_key=eq.rls`)), 'la duda está en la segunda').toBe(1)
    expect(filas(await rest(a, 'GET', `company_doubt?select=id&company_id=eq.${EMPRESA_A}&question_key=eq.rls`)), 'y no en la primera').toBe(0)
    expect(filas(await rest(b, 'GET', `company?select=id&id=eq.${segunda}`)), 'B no ve la segunda empresa de A').toBe(0)
    expect(filas(await rest(b, 'GET', `company_doubt?select=id&company_id=eq.${segunda}`)), 'ni su duda').toBe(0)
  } finally {
    if (segunda) await rest(a, 'DELETE', `company?id=eq.${segunda}&account_id=eq.${CUENTA_A.id}`)
  }
})

test('los socios y cargos solo los ve un administrador', async () => {
  const admin = await pedirSesion(CUENTA_A.email)
  let encargado: Sesion
  try { encargado = await pedirSesion(ENCARGADO_A.email) } catch (e) {
    throw new Error('No entra el encargado de A: ¿está aplicada la semilla seed_c00_encargado_prueba.sql?', { cause: e })
  }
  let socio: string | null = null
  try {
    const r = await rest<{ id: string }[]>(admin, 'POST', 'company_person', { account_id: CUENTA_A.id, company_id: EMPRESA_A, full_name: 'Socia de prueba RLS', ownership_pct: 10 })
    // Con un 10 %: A ya tiene una socia con el 60 % y la base no deja pasar del 100 (company_person_hasta_cien).
    expect(r.status, `el administrador apunta una socia: ${JSON.stringify(r.datos)}`).toBe(201)
    socio = r.datos[0].id

    expect(filas(await rest(admin, 'GET', `company_person?select=id&id=eq.${socio}`)), 'el administrador la ve').toBe(1)
    // El encargado ve la empresa (trabaja en ella)…
    expect(filas(await rest(encargado, 'GET', `company?select=id&id=eq.${EMPRESA_A}`)), 'el encargado ve la empresa').toBe(1)
    // …pero no quién es socio ni con cuánto.
    expect(filas(await rest(encargado, 'GET', `company_person?select=id&company_id=eq.${EMPRESA_A}`)), 'el encargado no ve los socios').toBe(0)
    const alta = await rest(encargado, 'POST', 'company_person', { account_id: CUENTA_A.id, company_id: EMPRESA_A, full_name: 'Colado por el encargado' })
    expect(alta.status, 'ni los apunta').toBeGreaterThanOrEqual(400)
    const cambio = await rest(encargado, 'PATCH', `company_person?id=eq.${socio}`, { ownership_pct: 99 })
    expect(filas(cambio), 'ni los cambia').toBe(0)
  } finally {
    if (socio) await rest(admin, 'DELETE', `company_person?id=eq.${socio}`)
  }
})
