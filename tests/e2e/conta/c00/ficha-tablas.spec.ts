/// <reference lib="dom" />
// tests/e2e/conta/c00/ficha-tablas.spec.ts
//
// Tarea 7 del C00: la ficha de proveedor del C01 LEE de las tablas generales
// el IVA, la retención, la forma y el plazo de pago, sin cambiar su aspecto.
// Y las dos formas de ocultar un tipo de gasto dicen lo mismo en la ficha y en
// «Tablas generales».
//
// Lo que se oculta aquí se deja como estaba al acabar; si una prueba se rompe
// a mitad, la limpieza lo borra por la API con la sesión del usuario.
//
// Sin prueba en la cuenta B: la ficha de proveedor vive en Cocina y B no tiene
// Cocina, así que en B no hay ficha que abrir. Lo que cambia en Canarias (el
// IGIC en vez del IVA) lo prueba opcionesFichaC00.test.ts con las filas reales.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, HERMANOS_RUIZ, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'

const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
const IVA_REDUCIDO = '5bbab66f-a022-44a6-b146-ac577a2988d3'
const SEGUROS = 'a028b4e6-b7d6-47ed-a1ac-d6ebe63dd9d8'

async function dejarComoEstaba(s: Sesion) {
  for (const id of [IVA_REDUCIDO, SEGUROS]) {
    await rest(s, 'DELETE', `general_row_setting?account_id=eq.${CUENTA_A.id}&company_id=eq.${EMPRESA_A}&row_id=eq.${id}`)
  }
  await rest(s, 'DELETE', `expense_category_hidden?account_id=eq.${CUENTA_A.id}&expense_category_id=eq.${SEGUROS}`)
}

/** Los valores de la lista de sugerencias de un campo. */
async function sugerencias(page: Page, etiqueta: string): Promise<string[]> {
  await expect(page.getByLabel(etiqueta)).toBeVisible()
  const lista = await page.getByLabel(etiqueta).getAttribute('list')
  expect(lista, `«${etiqueta}» lleva su lista`).toBeTruthy()
  return page.evaluate((id) => Array.from(document.getElementById(id!)?.querySelectorAll('option') ?? []).map((o) => o.value), lista)
}

test('cuenta A: el IVA, la retención, la forma y el plazo salen de las tablas, y lo guardado no se pierde', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  await dejarComoEstaba(s)
  try {
    await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/datos-fiscales`)
    const iva = page.getByRole('group', { name: 'IVA habitual en sus facturas' })
    // Los de hoy en la península, de la tabla: sin el 5 % que tenía escrito el C01.
    for (const t of ['0 %', '4 %', '10 %', '21 %']) await expect(iva.getByRole('checkbox', { name: new RegExp(`^${t}`) })).toBeVisible()
    await expect(iva.getByRole('checkbox', { name: /^5 %/ })).toHaveCount(0)
    await expect(iva.getByRole('checkbox', { name: /^10 %/ })).toBeChecked()
    expect(await sugerencias(page, 'Retención de IRPF (%)')).toEqual(['7', '15', '19', '35'])

    // Se oculta el IVA reducido en «Tablas generales»…
    await page.goto('/conta/ajustes/tablas/impuestos')
    await page.getByRole('button', { name: 'Abrir IVA reducido' }).click()
    await page.getByRole('button', { name: 'Ocultar' }).click()
    await expect(page.getByRole('status').getByText(/Ocultado «IVA reducido»/)).toBeVisible()
    // …y la ficha ya no lo ofrece, pero Hermanos Ruiz lo tiene guardado: sale, y dice por qué (regla 30).
    await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/datos-fiscales`)
    const diez = page.getByRole('group', { name: 'IVA habitual en sus facturas' }).getByRole('checkbox', { name: /^10 %/ })
    await expect(diez).toBeChecked()
    await expect(page.getByText('· ya no está en tus tablas')).toBeVisible()

    await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/pago`)
    // Se espera a la pantalla cargada: leer las opciones al momento daba una lista vacía.
    await expect(page.getByLabel('Forma de pago').locator('option')).toHaveText(['Sin decir', 'Transferencia', 'Domiciliación', 'Tarjeta', 'Efectivo'])
    // «30 y 60 días» no cabe en un solo plazo (D6): no se sugiere.
    expect(await sugerencias(page, 'Plazo (días desde la factura)')).toEqual(['0', '30', '60'])
  } finally {
    await dejarComoEstaba(s)
  }
})

test('cuenta A: ocultar un tipo de gasto en la ficha lo oculta en «Tablas generales», y al revés', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  const s = await entrarComo(page, CUENTA_A.email)
  await dejarComoEstaba(s)
  try {
    await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/contabilidad`)
    await page.getByRole('button', { name: 'Elegir qué tipos de gasto usa tu negocio' }).click()
    const seguros = page.getByRole('checkbox', { name: /^Seguros/ })
    await expect(seguros).toBeChecked()
    // La casilla guarda y luego se relee: cambia al acabar, no en el clic.
    await seguros.click()
    await expect(page.getByText('Seguros: ya no sale al elegir.')).toBeVisible()
    await expect(seguros).not.toBeChecked()

    await page.goto('/conta/ajustes/tablas/tipos-de-gasto')
    await page.getByRole('button', { name: 'Abrir Primas de seguros' }).click()
    // «Los demás» es una cabecera; la fila va a continuación, no dentro: se mira la fila.
    const fila = page.getByRole('rowgroup').filter({ has: page.getByRole('button', { name: 'Cerrar Primas de seguros' }) })
    await expect(fila.getByText('Oculto', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Volver a mostrar' }).click()
    await expect(page.getByRole('status').getByText('«Primas de seguros» vuelve a salir en tus desplegables.')).toBeVisible()

    await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/contabilidad`)
    await page.getByRole('button', { name: 'Elegir qué tipos de gasto usa tu negocio' }).click()
    await expect(page.getByRole('checkbox', { name: /^Seguros/ })).toBeChecked()
  } finally {
    await dejarComoEstaba(s)
  }
})
