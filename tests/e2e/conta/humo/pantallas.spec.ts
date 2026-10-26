// tests/e2e/conta/humo/pantallas.spec.ts
//
// La prueba RÁPIDA de lo común (Julio, 26/10): «una prueba rápida que abra cada
// pantalla de Sumied una vez en ordenador y en móvil (máximo 10 minutos)». La
// lleva la e2e de un PR que toca lo común —el menú, el marco, module.tsx…— en
// vez de la entera, que ya solo corre de noche sobre main (y con la etiqueta
// «e2e-entera»).
//
// Las pantallas salen del CÓDIGO, no de una lista escrita aquí (regla 31): cada
// ruta de CONTA.rutas que no lleva parámetros, más cada entrada del índice de
// Ajustes. Una ruta nueva entra sola.
//
// Qué mira en cada una, como la cuenta A (hostelería, la que tiene de todo):
//   · que abre sin error de la página (pageerror);
//   · que no se queda en el esqueleto de carga (.cx-hueso) más de 20 s;
//   · que sigue dentro de contabilidad (no la echa a la entrada).
// No mira lo que dice cada pantalla: eso es de sus pruebas, en su zona.
// Un tope de 5 min por tamaño: 10 en total.

import { test, expect } from '@playwright/test'
import { CONTA, INDICE_AJUSTES } from '@/config/navegacion'
import { CUENTA_A, entrarComo } from '../sesion'

/** Las que no son una pantalla que se abre sin más: el alta crea una empresa, la de la asesoría pide una invitación, y las que solo redirigen. */
const FUERA = new Set(['alta', 'asesoria', 'ajustes/muestra-piezas', 'facturacion/emitidas', 'facturacion/emitidas/nueva', 'libros/diario/recibidas'])

export const PANTALLAS: string[] = [...new Set([
  ...Object.values(CONTA.rutas).filter((r) => !r.includes(':')),
  ...INDICE_AJUSTES.flatMap((g) => g.entradas.map((e) => e.ruta)),
])].filter((r) => !FUERA.has(r)).sort()

test('cada pantalla de Sumied abre: sin error, sin quedarse cargando y dentro de contabilidad', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  await entrarComo(page, CUENTA_A.email)
  const mal: string[] = []
  for (const ruta of PANTALLAS) {
    await test.step(ruta, async () => {
      const antes = errores.length
      await page.goto(`/${CONTA.modulo}/${ruta}`, { timeout: 30_000 })
      try {
        await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 20_000 })
        await expect(page).toHaveURL(new RegExp(`/${CONTA.modulo}(/|$)`), { timeout: 5_000 })
      } catch (e) {
        mal.push(`${ruta}: ${(e as Error).message.split('\n')[0]}`)
      }
      if (errores.length > antes) mal.push(`${ruta}: error de la página`)
    })
  }
  console.log(`[humo] ${PANTALLAS.length} pantallas abiertas, ${mal.length} mal.`)
  expect(mal, 'pantallas que no abren bien').toEqual([])
  expect(errores).toEqual([])
})
