/// <reference lib="dom" />
// tests/e2e/conta/s01f/pestanas.spec.ts
//
// S01f · Las páginas de cada apartado, pieza común del marco. Rehecho con el
// patrón único del S02 (PR 1): la franja de pestañas debajo de la cabecera ya
// no existe (S01f, Julio 20/10, maqueta_trimestre_v3); las páginas salen
// DEBAJO del apartado activo, en la barra (en el móvil, en el cajón), y la
// cinta es ahora la fila de acciones de la página. En cada apartado con
// páginas, con Sumied (lo que ve Julio), en ordenador y en móvil:
//   · la cabecera de 56 px con la franja de 3 px del color de la empresa, y la
//     empresa con su cuadrado de 28 px;
//   · el apartado activo, abierto, con sus páginas; la activa en el azul de
//     acción #1E63C9 con el texto blanco y en negrita; el contador de cada
//     página con el color que le toca;
//   · ordenador, a 1440: la barra no se desliza de lado y ningún nombre se
//     corta; al bajar, la cabecera (con su franja pegada) y la barra se quedan;
//   · móvil: en el cajón, ninguna página se corta, la activa a la vista y la
//     página no se ensancha; la fila de acciones cabe en 390 px.
// Las pantallas de dentro no se miran: no se han tocado.
// Capturas en docs/conta/capturas/s01f.

import { test, expect, type Locator, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../sesion'
import { barraAbiertaSiPlegada } from '../barra'

const DIR = 'docs/conta/capturas/s01f'
const LAURA = correoDePrueba('p01.laura@p01-prueba.test')
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const AZUL = 'rgb(30, 99, 201)'   // #1E63C9, la acción del patrón
const BLANCO = 'rgb(255, 255, 255)'

/** `activa: null`: el apartado no tiene páginas (Clientes del despacho), y es él el marcado. */
interface Modulo { nombre: string; producto: string; ruta: string; activa: string | null; quien?: string }
const MODULOS: Modulo[] = [
  { nombre: 'contabilidad', producto: 'Contabilidad', ruta: '/conta/libros/diario', activa: 'Asientos' },
  // S02: «Por revisar» (/conta/compras, ahora «Recepciones del local») cuelga de Facturas recibidas.
  { nombre: 'compras', producto: 'Compras y gastos', ruta: '/conta/compras', activa: 'Facturas recibidas' },
  // S02 · PR 2: Bancos ya no va por niveles en el móvil (se fue su portada): abre Movimientos con su
  // encabezado, y sus páginas están en el cajón como las de todos.
  { nombre: 'bancos', producto: 'Bancos', ruta: '/conta/bancos', activa: 'Movimientos' },
  { nombre: 'impuestos', producto: 'Impuestos', ruta: '/conta/impuestos', activa: 'Calendario' },
  // S02: la pestaña «Tus clientes» de Impuestos es ahora el apartado «Clientes del despacho», sin páginas.
  { nombre: 'impuestos-asesoria', producto: 'Clientes del despacho', ruta: '/conta/impuestos/clientes?hoy=2026-10-13', activa: null, quien: LAURA },
  { nombre: 'contactos', producto: 'Contactos', ruta: '/conta/clientes-y-proveedores', activa: 'Todos' },
  // S02: Ajustes es un apartado con sus páginas; su portada es «Tu empresa».
  { nombre: 'ajustes', producto: 'Ajustes', ruta: '/conta/ajustes', activa: 'Tu empresa' },
]

const conMarca = (ruta: string) => `${ruta}${ruta.includes('?') ? '&' : '?'}marca=sumied`
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menú de contabilidad' })
const paginas = (page: Page, producto: string) => page.getByRole('list', { name: `Páginas de ${producto}` })

async function quieta(page: Page) {
  await expect(page.locator('.cx-hueso')).toHaveCount(0, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  // Los contadores llegan después (lo cuenta la barra): una lectura igual a la de 1 s antes.
  let antes = ''
  for (let i = 0; i < 10; i++) {
    const ahora = (await page.locator('.s-barra-pagina-chip').allTextContents()).join(',')
    if (i > 0 && ahora === antes) return
    antes = ahora
    await page.waitForTimeout(1000)
  }
}

/**
 * Cada contador de página (S02: el chip dentro del enlace, antes
 * .s-pestana-contador), con su tono y si su color es el que le toca: en la
 * página activa, el azul de acción sobre blanco; si vence, el rojo de
 * «falta»; si no, el blanco de la barra.
 */
async function contadores(lista: Locator) {
  return lista.locator('.s-barra-pagina-chip').evaluateAll((xs) => xs.map((x) => {
    const muestra = document.createElement('span')
    const activa = x.closest('a')?.getAttribute('aria-current') === 'page'
    muestra.style.color = activa ? 'var(--s-accion)' : x.getAttribute('data-tono') === 'vence' ? 'var(--s-falta)' : 'var(--s-barra-activo-texto)'
    x.parentElement!.appendChild(muestra)
    const debe = getComputedStyle(muestra).color
    muestra.remove()
    return { tono: x.getAttribute('data-tono'), n: x.textContent, bien: getComputedStyle(x).color === debe }
  }))
}

for (const m of MODULOS) {
  test(`${m.producto}${m.activa ? ` · ${m.activa}` : ''}: sus páginas en la barra`, async ({ page }) => {
    await entrarComo(page, m.quien ?? CUENTA_A.email)
    await page.goto(conMarca(m.ruta))
    const cabecera = page.locator('.s-cabecera')
    await expect(cabecera).toBeVisible()
    const movil = lado(page) === 'movil'

    // La cabecera: 56 px (antes 48), con la franja de 3 px del color de la empresa pegada encima.
    const c0 = (await cabecera.boundingBox())!
    expect(Math.round(c0.height)).toBe(56)
    const franja = (await page.locator('.s-franja-empresa').boundingBox())!
    expect(Math.round(franja.height)).toBe(3)
    expect(Math.abs(franja.y + franja.height - c0.y)).toBeLessThanOrEqual(1)
    // La empresa, con su cuadrado (su logo o su inicial en su color) de 28 px (antes, el logo de 24).
    const cuadrado = page.locator(movil ? '.s-cab-fila-movil .s-empresa-cuadrado' : '.s-cabecera .s-empresa-cuadrado')
    await expect(cuadrado).toBeVisible()
    // El cuadrado se pinta con la inicial y se cambia por el logo cuando llega:
    // se mide el que queda, con reintento (entre los dos no hay caja).
    await expect.poll(async () => Math.round((await cuadrado.boundingBox())?.width ?? 0)).toBe(28)
    // S02: ya no hay franja de pestañas ni «Más ▾» de pestañas en ninguna parte.
    await expect(page.getByRole('navigation', { name: /^Pestañas de / })).toHaveCount(0)

    if (movil) {
      // En el móvil, las páginas van en el cajón: fuera de él no hay ninguna.
      await expect(paginas(page, m.producto)).toHaveCount(0)
      await page.getByRole('button', { name: 'Abrir el menú' }).click()
      await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible()
    } else await barraAbiertaSiPlegada(page)
    await quieta(page)

    // El apartado activo: «estás aquí» si no tiene páginas; «estás dentro» si estás en una de ellas.
    const apartado = menu(page).getByRole('link', { name: m.producto, exact: true })
    await expect(apartado).toHaveAttribute('aria-current', m.activa ? 'true' : 'page')
    if (!m.activa) {
      await expect(paginas(page, m.producto)).toHaveCount(0)
    } else {
      const lista = paginas(page, m.producto)
      await expect(lista).toBeVisible()
      const activa = lista.getByRole('link', { name: m.activa, exact: true })
      await expect(activa).toHaveAttribute('aria-current', 'page')
      await expect(lista.locator('a[aria-current="page"]')).toHaveCount(1)

      // La activa: el azul de acción, el texto blanco y en negrita.
      await expect(activa).toHaveCSS('background-color', AZUL)
      await expect(activa).toHaveCSS('color', BLANCO)
      await expect(activa).toHaveCSS('font-weight', '600')

      // El contador, si lo hay, con el color que le toca.
      for (const c of await contadores(lista)) expect(c, `contador ${c.tono} ${c.n}`).toMatchObject({ bien: true })

      // Ninguna página se corta: cada nombre, entero.
      const cortadas = await lista.locator('.s-barra-nombre').evaluateAll((xs) => xs.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent))
      expect(cortadas, 'nombres de página cortados').toEqual([])
      // La activa, a la vista (en el móvil, dentro del cajón).
      await activa.scrollIntoViewIfNeeded()
      await expect(activa).toBeInViewport({ ratio: 1 })
    }

    if (!movil) {
      // A 1440 la barra no se desliza de lado: cabe entera, con sus nombres.
      expect(await menu(page).evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true)
      const cortados = await menu(page).locator('.s-barra-item .s-barra-nombre').evaluateAll((xs) => xs.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent))
      expect(cortados, 'apartados cortados').toEqual([])
    } else {
      // El cajón no ensancha la página.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${DIR}/${m.nombre}-movil-menu.png` })
      await page.getByRole('button', { name: 'Cerrar el menú' }).click()
      await expect(page.getByRole('dialog', { name: 'Menú' })).toHaveCount(0)

      // S01f (Julio, 20/10) · La cinta se deslizaba entera con «Ocultar» fuera de la fila.
      // S02: la cinta es ahora la fila de acciones, sin «Ocultar» y sin títulos debajo
      // de los botones: en el móvil, el principal y «Más acciones» (los blancos, dentro).
      // Lo que se cuida es lo mismo: nada se sale de los 390 px ni tapa a otro.
      // S02 · PR 2: una página que pinta su encabezado (Bancos) no lleva la fila del marco: sus
      // botones van en el encabezado, y se mide esa fila con la misma vara.
      const acciones = page.getByRole('toolbar', { name: /^Acciones de / })
      const delEncabezado = page.locator('header.s-encabezado .s-encabezado-acciones')
      const fila = await acciones.count() && await acciones.first().isVisible() ? acciones.first()
        : await delEncabezado.count() && await delEncabezado.first().isVisible() ? delEncabezado.first() : null
      if (m.nombre === 'bancos') expect(fila, 'Bancos: la fila de su encabezado, con «Tus bancos» y «Más acciones»').not.toBeNull()
      if (fila) {
        await expect(fila.getByRole('button', { name: 'Ocultar', exact: true })).toHaveCount(0)
        const ancho = page.viewportSize()!.width
        const cajas = await fila.locator('a:visible, button:visible').evaluateAll((xs) => xs.map((x) => {
          const r = x.getBoundingClientRect()
          return { texto: (x.getAttribute('aria-label') ?? x.textContent ?? '').trim(), izq: r.left, der: r.right, arriba: r.top, abajo: r.bottom }
        }))
        expect(cajas.length).toBeGreaterThan(0)
        const fuera = cajas.filter((x) => x.izq < -1 || x.der > ancho + 1).map((x) => x.texto)
        expect(fuera, 'botones de la fila que se salen de la pantalla').toEqual([])
        const pisados = cajas.flatMap((a, i) => cajas.slice(i + 1)
          .filter((b) => a.izq < b.der - 1 && b.izq < a.der - 1 && a.arriba < b.abajo - 1 && b.arriba < a.abajo - 1)
          .map((b) => `${a.texto} / ${b.texto}`))
        expect(pisados, 'botones de la fila que se pisan').toEqual([])
        const caja = (await fila.boundingBox())!
        await page.screenshot({ path: `${DIR}/fila-acciones-${m.nombre}-movil.png`, clip: { x: 0, y: 0, width: ancho, height: caja.y + caja.height } })
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    await page.screenshot({ path: `${DIR}/${m.nombre}-${lado(page)}.png` })

    // Al bajar (en el ordenador): la cabecera, con su franja pegada encima, y la barra se quedan a la vista.
    if (!movil) {
      const fijas = await page.evaluate(async () => {
        window.scrollTo(0, 400)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const c = document.querySelector('.s-cabecera')!.getBoundingClientRect()
        const f = document.querySelector('.s-franja-empresa')!.getBoundingClientRect()
        const b = document.querySelector('.s-barra')!.getBoundingClientRect()
        const fuera = { bajado: window.scrollY, cabecera: Math.round(c.top), franja: Math.round(f.bottom), barra: Math.round(b.top) }
        window.scrollTo(0, 0)
        return fuera
      })
      console.log(`[al bajar] ${m.producto}: ${JSON.stringify(fijas)}`)
      if (fijas.bajado > 0) {
        expect(fijas.cabecera, 'la cabecera se queda arriba').toBeGreaterThanOrEqual(0)
        expect(Math.abs(fijas.franja - fijas.cabecera), 'la franja, pegada encima').toBeLessThanOrEqual(1)
        expect(fijas.barra, 'la barra se queda arriba').toBeGreaterThanOrEqual(0)
      }
    }
  })
}
