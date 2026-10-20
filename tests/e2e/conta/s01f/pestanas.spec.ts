/// <reference lib="dom" />
// tests/e2e/conta/s01f/pestanas.spec.ts
//
// S01f · La cabecera de pestañas, pieza común del marco (Julio, 20/10: «texto
// plano muy rudimentario»). En cada módulo con pestañas, con Sumied (lo que ve
// Julio), en ordenador y en móvil:
//   · ordenador: 56 px; la empresa con su logo y una línea que la separa; cada
//     pestaña con su icono de trazo de 14 px; la activa en #1E63C9, en
//     negrita y subrayada con 3 px; el contador gris o rojo, si lo hay;
//   · móvil: la fila de pestañas se desliza, ninguna se corta, la activa a la
//     vista y la página no se ensancha.
// Las pantallas de dentro no se miran: no se han tocado.
// Capturas en docs/conta/capturas/s01f.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/s01f'
const LAURA = correoDePrueba('p01.laura@p01-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const AZUL = 'rgb(30, 99, 201)'   // #1E63C9, la acción de Sumied

interface Modulo { nombre: string; producto: string; ruta: string; activa: string; quien?: string; sinPestanasEnMovil?: boolean }
const MODULOS: Modulo[] = [
  { nombre: 'contabilidad', producto: 'Contabilidad', ruta: '/conta/libros/diario', activa: 'Asientos' },
  { nombre: 'compras', producto: 'Compras y gastos', ruta: '/conta/compras', activa: 'Por revisar' },
  // Bancos va por niveles en el móvil (portada, sin fila de pestañas): solo se fotografía.
  { nombre: 'bancos', producto: 'Bancos', ruta: '/conta/bancos', activa: 'Movimientos', sinPestanasEnMovil: true },
  { nombre: 'impuestos', producto: 'Impuestos', ruta: '/conta/impuestos', activa: 'Calendario' },
  { nombre: 'impuestos-asesoria', producto: 'Impuestos', ruta: '/conta/impuestos/clientes?hoy=2026-10-13', activa: 'Tus clientes', quien: LAURA },
  { nombre: 'contactos', producto: 'Contactos', ruta: '/conta/clientes-y-proveedores', activa: 'Todos' },
  { nombre: 'ajustes', producto: 'Ajustes', ruta: '/conta/ajustes', activa: 'Empresa' },
]

const conMarca = (ruta: string) => `${ruta}${ruta.includes('?') ? '&' : '?'}marca=sumied`
const pestanas = (page: Page, producto: string) => page.getByRole('navigation', { name: `Pestañas de ${producto}` })

async function quieta(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  // Los contadores llegan después (lo cuenta la barra): una lectura igual a la de 1 s antes.
  let antes = ''
  for (let i = 0; i < 10; i++) {
    const ahora = (await page.locator('.s-pestana-contador').allTextContents()).join(',')
    if (i > 0 && ahora === antes) return
    antes = ahora
    await page.waitForTimeout(1000)
  }
}

/** Cada contador, con su tono y si su color es el que le toca (gris de apoyo o rojo de «falta»). */
async function contadores(page: Page) {
  return page.locator('.s-cabecera .s-pestana-contador, .s-pestanas-movil .s-pestana-contador').evaluateAll((xs) => xs.map((x) => {
    const muestra = document.createElement('span')
    muestra.style.color = x.getAttribute('data-tono') === 'vence' ? 'var(--s-falta)' : 'var(--s-apoyo)'
    x.parentElement!.appendChild(muestra)
    const debe = getComputedStyle(muestra).color
    muestra.remove()
    return { tono: x.getAttribute('data-tono'), n: x.textContent, bien: getComputedStyle(x).color === debe }
  }))
}

for (const m of MODULOS) {
  test(`${m.producto} · ${m.activa}: la cabecera de pestañas`, async ({ page }) => {
    await entrarComo(page, m.quien ?? CUENTA_A.email)
    await page.goto(conMarca(m.ruta))
    await expect(page.locator('.s-cabecera')).toBeVisible()
    const movil = lado(page) === 'movil'

    if (movil && m.sinPestanasEnMovil) {
      await expect(pestanas(page, m.producto)).toHaveCount(0)
      await quieta(page)
      await page.screenshot({ path: `${DIR}/${m.nombre}-movil.png` })
      return
    }

    const nav = pestanas(page, m.producto)
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: m.activa, exact: true })).toHaveAttribute('aria-current', 'page')
    await quieta(page)

    // Lo que mide la franja (para el parte): el hueco de las pestañas y cada pestaña.
    if (!movil) {
      const m2 = await page.evaluate(() => {
        const w = (sel: string) => Math.round(document.querySelector(sel)?.getBoundingClientRect().width ?? 0)
        const tabs = Array.from(document.querySelectorAll('.s-cabecera .s-pestanas-medida > .s-pestana')).map((x) => Math.round(x.getBoundingClientRect().width))
        return { izquierda: w('.s-cabecera .s-cab-izquierda'), centro: w('.s-cabecera .s-cab-centro'), derecha: w('.s-cabecera .s-cab-derecha'), medidas: tabs, mas: !!document.querySelector('.s-cabecera .s-pestana-mas') }
      })
      test.info().annotations.push({ type: 'medidas', description: JSON.stringify(m2) })
      console.log(`[medidas] ${m.producto}: ${JSON.stringify(m2)}`)
    }

    // Cada pestaña con su icono de trazo, de 14 px.
    const iconos = await nav.getByRole('link').evaluateAll((xs) => xs.map((x) => {
      const svg = x.querySelector('svg')
      return svg ? Math.round(svg.getBoundingClientRect().width) : 0
    }))
    expect(iconos.length).toBeGreaterThan(0)
    expect(iconos.every((t) => t === 14)).toBe(true)

    // La activa: azul, negrita y subrayada con 3 px.
    const activa = nav.locator('.s-pestana[data-activa]').first()
    await expect(activa).toHaveCSS('color', AZUL)
    await expect(activa).toHaveCSS('font-weight', '600')
    await expect(activa).toHaveCSS('border-bottom-width', '3px')
    await expect(activa).toHaveCSS('border-bottom-color', AZUL)

    // El contador, si lo hay: gris lo que pide una decisión, rojo lo que vence.
    for (const c of await contadores(page)) expect(c, `contador ${c.tono} ${c.n}`).toMatchObject({ bien: true })

    if (!movil) {
      // 56 px; la empresa con su logo, separada por una línea.
      expect(Math.round((await page.locator('.s-cabecera').boundingBox())!.height)).toBe(56)
      await expect(page.locator('.s-cabecera .s-cab-cliente-logo')).toBeVisible()
      await expect(page.locator('.s-cabecera .s-cab-izquierda')).toHaveCSS('border-right-width', '1px')
      // Todo dentro de la franja: nada se sale por arriba ni por abajo.
      const caja = (await page.locator('.s-cabecera').boundingBox())!
      const fuera = await nav.locator('.s-pestana').evaluateAll((xs, b) => xs.filter((x) => {
        const r = x.getBoundingClientRect()
        return r.height > 0 && (r.top < (b as number[])[0] - 1 || r.bottom > (b as number[])[1] + 1)
      }).length, [caja.y, caja.y + caja.height])
      expect(fuera).toBe(0)
    } else {
      // Deslizable sin cortarse: cada pestaña entera, la activa a la vista, la página no se ensancha.
      const cortadas = await nav.locator('.s-pestana').evaluateAll((xs) => xs.filter((x) => x.scrollWidth > x.clientWidth + 1).length)
      expect(cortadas).toBe(0)
      const vista = await nav.evaluate((fila) => {
        const a = fila.querySelector('.s-pestana[data-activa]')!.getBoundingClientRect()
        const f = fila.getBoundingClientRect()
        return a.left >= f.left - 1 && a.right <= f.right + 1
      })
      expect(vista).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(nav).toHaveCSS('overflow-x', 'auto')
    }

    await page.screenshot({ path: `${DIR}/${m.nombre}-${lado(page)}.png` })
  })
}
