/// <reference lib="dom" />
// tests/e2e/conta/s01g/ancho.spec.ts
//
// S01g · El ancho de las pantallas (Julio, 20/10: «en Impuestos el contenido se
// queda en 960–1200 px y a 1440 o 1900 deja media pantalla vacía; Bancos sí usa
// todo el ancho»). Las pantallas de contenido usan todo el ancho que hay, hasta
// 1800 px (--s-ancho-pantalla), y reparten en columnas cuando cabe. Un
// formulario no se estira. El Trimestre no se toca (lo hace C con su maqueta v4):
// se queda en sus 960. En el ordenador, a 1440 y a 1900, con Sumied.
// Capturas en docs/conta/capturas/s01g.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01g'
const LAURA = correoDePrueba('p01.laura@p01-prueba.test')
const TOPE = 1800
const ESTRECHA = 960

interface Pantalla { nombre: string; ruta: string; quien?: string; ancho: 'todo' | 'estrecha' }
const PANTALLAS: Pantalla[] = [
  { nombre: 'impuestos-calendario', ruta: '/conta/impuestos', ancho: 'todo' },
  { nombre: 'impuestos-presentados', ruta: '/conta/impuestos/presentados', ancho: 'todo' },
  { nombre: 'impuestos-sociedades', ruta: '/conta/impuestos/sociedades', ancho: 'todo' },
  { nombre: 'impuestos-certificados', ruta: '/conta/impuestos/certificados', ancho: 'todo' },
  { nombre: 'impuestos-iva', ruta: '/conta/impuestos/iva/2026/3T', ancho: 'todo' },
  { nombre: 'impuestos-clientes', ruta: '/conta/impuestos/clientes?hoy=2026-10-13', quien: LAURA, ancho: 'todo' },
  // Lo que no se estira: un formulario y el Trimestre (de C).
  { nombre: 'analitica', ruta: '/conta/ajustes/analitica', ancho: 'estrecha' },
  { nombre: 'impuestos-trimestre', ruta: '/conta/impuestos/trimestre', ancho: 'estrecha' },
]

const conMarca = (ruta: string) => `${ruta}${ruta.includes('?') ? '&' : '?'}marca=sumied`

async function quieta(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
}

test.beforeEach(({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 768, 'El ancho es del ordenador: en el móvil todo va en una columna')
})

for (const p of PANTALLAS) {
  test(`${p.nombre}: ${p.ancho === 'todo' ? 'usa todo el ancho, hasta 1800' : 'no se estira'} (1440 y 1900)`, async ({ page }) => {
    await entrarComo(page, p.quien ?? CUENTA_A.email)
    for (const ancho of [1440, 1900]) {
      await page.setViewportSize({ width: ancho, height: 1000 })
      await page.goto(conMarca(p.ruta))
      const pantalla = page.locator('.cx-principal .s-pantalla').first()
      await expect(pantalla).toBeVisible({ timeout: 30_000 })
      await quieta(page)
      // Lo que hay: el ancho del hueco de la pantalla, sin su relleno.
      const m = await page.evaluate(() => {
        const principal = document.querySelector('.cx-principal')!
        const cs = getComputedStyle(principal)
        const hueco = principal.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        const s = document.querySelector('.cx-principal .s-pantalla')!.getBoundingClientRect()
        return { hueco: Math.round(hueco), pantalla: Math.round(s.width) }
      })
      console.log(`[ancho] ${p.nombre} a ${ancho}: ${JSON.stringify(m)}`)
      if (p.ancho === 'todo') {
        expect(m.pantalla, 'llena el hueco, hasta el tope').toBeGreaterThanOrEqual(Math.min(m.hueco, TOPE) - 2)
        expect(m.pantalla).toBeLessThanOrEqual(TOPE)
      } else {
        expect(m.pantalla, 'no se estira').toBeLessThanOrEqual(ESTRECHA)
      }
      // Nada se sale por la derecha.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${DIR}/${p.nombre}-${ancho}.png` })
    }
  })
}

test('con sitio, el Calendario reparte en dos columnas que crecen (1900)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto(conMarca('/conta/impuestos'))
  await expect(page.locator('.s-impuestos-columnas')).toBeVisible({ timeout: 30_000 })
  await quieta(page)
  const [principal, lado] = await page.locator('.s-impuestos-columnas > *').evaluateAll((xs) => xs.map((x) => Math.round(x.getBoundingClientRect().width)))
  // A 1900 la de al lado ya no se queda en 340: un tercio.
  expect(lado).toBeGreaterThan(400)
  expect(principal).toBeGreaterThan(lado)
})
