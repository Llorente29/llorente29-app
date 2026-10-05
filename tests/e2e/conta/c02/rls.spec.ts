/// <reference lib="dom" />
// tests/e2e/conta/c02/rls.spec.ts
//
// C02, tarea 7 · RLS del plan contable entre las dos cuentas de prueba: B no
// ve ni toca el plan de A (cuentas, enlaces, registro, propuestas contestadas)
// ni puede llamar a ninguna de las funciones que lo cambian. Por la API con la
// sesión de B, lo mismo que haría su navegador. Primero, el control: A sí ve
// lo suyo; si no, la prueba no prueba nada. Al final, A sigue igual.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, HERMANOS_RUIZ, pedirSesion } from '../sesion'
import { rest } from '../api'

const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'

test('la cuenta B no ve ni toca el plan contable de A', async ({ browserName }, info) => {
  void browserName
  test.skip(info.project.name === 'movil', 'La RLS no depende del tamaño de pantalla')
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)

  // Control: A ve su plan, sus enlaces y su registro.
  const cuentasA = await rest<{ id: string; code: string; name: string }[]>(a, 'GET', `company_account?select=id,code,name&company_id=eq.${EMPRESA_A}&order=code`)
  expect(cuentasA.datos.length).toBeGreaterThan(600)
  const enlacesA = await rest<unknown[]>(a, 'GET', `company_account_link?select=id&company_id=eq.${EMPRESA_A}`)
  expect(enlacesA.datos.length).toBeGreaterThan(0)
  const registroA = await rest<unknown[]>(a, 'GET', `company_account_log?select=id&company_id=eq.${EMPRESA_A}&limit=1`)
  expect(registroA.datos).toHaveLength(1)
  const una = cuentasA.datos.find((c) => c.code === '68100000')!

  // B no VE nada.
  for (const ruta of [
    `company_account?select=id&company_id=eq.${EMPRESA_A}`,
    `company_account?select=id&account_id=eq.${CUENTA_A.id}`,
    `company_account_link?select=id&company_id=eq.${EMPRESA_A}`,
    `company_account_log?select=id&company_id=eq.${EMPRESA_A}`,
    `ai_suggestion?select=id&company_id=eq.${EMPRESA_A}`,
  ]) {
    const r = await rest<unknown[]>(b, 'GET', ruta)
    expect(r.datos, `B ve ${ruta}`).toEqual([])
  }

  // B no ESCRIBE en las tablas (nadie escribe directo: van por funciones).
  const alta = await rest(b, 'POST', 'company_account', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, plan: 'pymes', code: '40009999', template_code: '4000', name: 'Intruso B', kind: 'own', source: 'manual',
  })
  expect(alta.status, JSON.stringify(alta.datos)).not.toBe(201)
  const cambio = await rest<unknown[]>(b, 'PATCH', `company_account?id=eq.${una.id}`, { name: 'Cambiado por B' })
  expect(cambio.status === 200 ? cambio.datos : [], 'B ha cambiado una cuenta de A').toEqual([])

  // B no LLAMA a ninguna función que cambie el plan de A.
  for (const [rpc, args] of [
    ['company_account_add', { p_company: EMPRESA_A, p_hoja: '4000', p_nombre: 'Intruso B' }],
    ['company_account_set_hidden', { p_id: una.id, p_oculta: true }],
    ['company_account_link_set', { p_company: EMPRESA_A, p_entity: 'supplier', p_entity_id: HERMANOS_RUIZ, p_role: 'pago', p_account_id: una.id }],
    ['company_account_link_unset', { p_company: EMPRESA_A, p_entity: 'supplier', p_entity_id: HERMANOS_RUIZ, p_role: 'pago' }],
    ['company_chart_set_digits', { p_company: EMPRESA_A, p_digitos: 10 }],
    ['company_plan_propuesta_responder', { p_company: EMPRESA_A, p_clave: 'intruso', p_titulo: 't', p_porque: 'p', p_confianza: 'alta', p_acepta: true, p_ops: [{ op: 'ocultar', code: '68100000' }] }],
  ] as const) {
    const r = await rest<{ message?: string }>(b, 'POST', `rpc/${rpc}`, args)
    expect(r.status, `${rpc}: ${JSON.stringify(r.datos)}`).toBeGreaterThanOrEqual(400)
  }

  // A sigue igual: mismas cuentas, y la 68100000 con su nombre y activa.
  const despues = await rest<{ id: string; code: string; name: string; status: string }[]>(a, 'GET', `company_account?select=id,code,name,status&company_id=eq.${EMPRESA_A}&order=code`)
  expect(despues.datos.length).toBe(cuentasA.datos.length)
  expect(despues.datos.find((c) => c.code === '68100000')).toMatchObject({ name: una.name, status: 'activa' })
})
