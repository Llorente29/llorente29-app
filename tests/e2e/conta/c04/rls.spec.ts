/// <reference lib="dom" />
// tests/e2e/conta/c04/rls.spec.ts
//
// C04 · RLS del libro diario entre las dos cuentas de prueba: B no ve ni toca
// el libro de A (asientos, apuntes, Mayor, resúmenes del día, nóminas, reglas
// de reparto, lo aprendido y lo descartado) ni puede llamar a ninguna de las
// funciones que lo cambian o lo leen. Por la API con la sesión de B, lo mismo
// que haría su navegador. Primero, el control: A sí ve lo suyo; si no, la
// prueba no prueba nada. Al final, el libro de A sigue igual.

import { test, expect } from '@playwright/test'
import { CUENTA_A, CUENTA_B, pedirSesion } from '../sesion'
import { rest } from '../api'

const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'

test('la cuenta B no ve ni toca el libro diario de A', async ({ browserName }, info) => {
  void browserName
  test.skip(info.project.name === 'movil', 'La RLS no depende del tamaño de pantalla')
  const a = await pedirSesion(CUENTA_A.email)
  const b = await pedirSesion(CUENTA_B.email)

  // Control: A ve su libro (la semilla seed_c04_staging.sql).
  const asientosA = await rest<{ id: string; status: string; number: number | null }[]>(a, 'GET', `journal_entry?select=id,status,number&company_id=eq.${EMPRESA_A}&order=created_at`)
  expect(asientosA.datos.length).toBeGreaterThan(5)
  const validado = asientosA.datos.find((x) => x.status === 'validado')!
  const propuesto = asientosA.datos.find((x) => x.status === 'propuesto')!
  expect(validado && propuesto, 'la semilla tiene un validado y un propuesto').toBeTruthy()
  const mayorA = await rest<unknown[]>(a, 'GET', `journal_ledger?select=line_id&company_id=eq.${EMPRESA_A}&limit=1`)
  expect(mayorA.datos).toHaveLength(1)

  // B no VE nada.
  for (const ruta of [
    `journal_entry?select=id&company_id=eq.${EMPRESA_A}`,
    `journal_entry?select=id&account_id=eq.${CUENTA_A.id}`,
    `journal_line?select=id&company_id=eq.${EMPRESA_A}`,
    `journal_ledger?select=line_id&company_id=eq.${EMPRESA_A}`,
    `sales_day_summary?select=id&company_id=eq.${EMPRESA_A}`,
    `payroll_summary?select=id&company_id=eq.${EMPRESA_A}`,
    `allocation_rule?select=id&company_id=eq.${EMPRESA_A}`,
    `journal_correction?select=id&company_id=eq.${EMPRESA_A}`,
    `journal_dismissal?select=id&company_id=eq.${EMPRESA_A}`,
  ]) {
    const r = await rest<unknown[]>(b, 'GET', ruta)
    expect(r.datos, `B ve ${ruta}`).toEqual([])
  }

  // B no ESCRIBE en el libro de A.
  const alta = await rest(b, 'POST', 'journal_entry', {
    account_id: CUENTA_A.id, company_id: EMPRESA_A, fiscal_year_id: '00000000-0000-0000-0000-000000000000', series: 4,
    entry_date: '2026-10-07', concept: 'Intruso B', source_type: 'manual', status: 'borrador',
  })
  expect(alta.status, JSON.stringify(alta.datos)).not.toBe(201)
  const cambio = await rest<unknown[]>(b, 'PATCH', `journal_entry?id=eq.${propuesto.id}`, { concept: 'Cambiado por B' })
  expect(cambio.status === 200 ? cambio.datos : [], 'B ha cambiado un asiento de A').toEqual([])
  const borra = await rest<unknown[]>(b, 'DELETE', `journal_entry?id=eq.${propuesto.id}`)
  expect(borra.status === 200 ? borra.datos : [], 'B ha borrado un asiento de A').toEqual([])

  // B no LLAMA a ninguna función sobre el libro de A.
  for (const [rpc, args] of [
    ['journal_entry_validar', { p_entry: propuesto.id }],
    ['journal_entry_anular', { p_entry: validado.id, p_motivo: 'Intruso B' }],
    ['journal_entry_descartar', { p_entry: propuesto.id, p_motivo: 'Intruso B' }],
    ['journal_entry_proponer', { p_company: EMPRESA_A, p_entry: { series: 4, fecha: '2026-10-07', concepto: 'Intruso B', source_type: 'manual', confianza: 'seguro', porque: 'x' }, p_lines: [] }],
    ['journal_cadena_comprobar', { p_company: EMPRESA_A }],
    ['conta_cerrar_mes', { p_company: EMPRESA_A, p_mes: '2026-10-01' }],
    ['conta_reabrir_mes', { p_company: EMPRESA_A, p_mes: '2026-09-01', p_motivo: 'Intruso B' }],
    ['conta_fijar_corte', { p_company: EMPRESA_A, p_hasta: '2026-08-31', p_programa: 'Intruso' }],
  ] as const) {
    const r = await rest<{ message?: string }>(b, 'POST', `rpc/${rpc}`, args)
    expect(r.status, `${rpc}: ${JSON.stringify(r.datos)}`).toBeGreaterThanOrEqual(400)
  }
  // Las de lectura (security invoker) no fallan: devuelven vacío para B.
  for (const [rpc, args] of [
    ['conta_sumas_saldos', { p_company: EMPRESA_A, p_desde: '2026-01-01', p_hasta: '2026-12-31' }],
    ['conta_resultado_por_local', { p_company: EMPRESA_A, p_desde: '2026-01-01', p_hasta: '2026-12-31', p_repartir: true }],
    ['conta_dias_por_asentar', { p_company: EMPRESA_A, p_desde: '2026-10-01', p_hasta: '2026-10-31' }],
  ] as const) {
    const r = await rest<unknown[]>(b, 'POST', `rpc/${rpc}`, args)
    expect(r.status >= 400 || (Array.isArray(r.datos) && r.datos.length === 0), `${rpc} devuelve a B: ${JSON.stringify(r.datos).slice(0, 200)}`).toBe(true)
  }

  // El libro de A sigue igual.
  const despues = await rest<{ id: string; status: string; number: number | null }[]>(a, 'GET', `journal_entry?select=id,status,number&company_id=eq.${EMPRESA_A}&order=created_at`)
  expect(despues.datos).toEqual(asientosA.datos)
})
