/// <reference lib="dom" />
// tests/e2e/conta/burbuja.ts
//
// La burbuja de Folvy AI (ordenador) y la barra inferior con su botón central
// (móvil) no pueden tapar NADA de la ficha ni de la lista (revisión de Julio,
// 02/10). Esto lo MIDE: devuelve lo que quede debajo, y la prueba exige que
// no haya nada.
//
// Qué cuenta como contenido: lo que se lee o se pulsa dentro de la pantalla
// (`.cf`): textos sueltos, enlaces, botones, campos e imágenes visibles.

import type { Page } from '@playwright/test'

interface Caja { x: number; y: number; w: number; h: number }

async function cajasDelContenido(page: Page): Promise<{ que: string; caja: Caja }[]> {
  return page.evaluate(() => {
    const raiz = document.querySelector('.cf')
    if (!raiz) return []
    const out: { que: string; caja: { x: number; y: number; w: number; h: number } }[] = []
    raiz.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const interactivo = el.matches('a, button, input, select, textarea, img, svg')
      const hojaConTexto = el.children.length === 0 && (el.textContent ?? '').trim() !== ''
      if (!interactivo && !hojaConTexto) return
      const r = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') return
      out.push({ que: (el.textContent ?? el.tagName).trim().slice(0, 40) || el.tagName, caja: { x: r.x, y: r.y, w: r.width, h: r.height } })
    })
    return out
  })
}

const cruza = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

async function caja(page: Page, selector: string): Promise<Caja | null> {
  const l = page.locator(selector).first()
  if (await l.count() === 0) return null
  const b = await l.boundingBox()
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null
}

/** Ordenador: nada debajo del botón flotante, arriba, a media página y al final. */
export async function loQueTapaLaBurbuja(page: Page): Promise<string[]> {
  const burbuja = await caja(page, 'button[aria-label$="Folvy Copiloto"]')
  if (!burbuja) throw new Error('No encuentro el botón de Folvy AI')
  const tapado = new Set<string>()
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  for (const y of [0, alto / 3, (2 * alto) / 3, alto]) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    for (const c of await cajasDelContenido(page)) if (cruza(c.caja, burbuja)) tapado.add(c.que)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  return [...tapado]
}

/** Móvil: al llegar al final, nada debajo de la barra inferior ni de su botón central. */
export async function loQueTapaLaBarra(page: Page): Promise<string[]> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const obstaculos = [await caja(page, 'nav[aria-label="Navegacion principal"]'), await caja(page, '[aria-label="Folvy AI"]')]
    .filter((c): c is Caja => c !== null)
  if (obstaculos.length === 0) throw new Error('No encuentro la barra inferior')
  const tapado = (await cajasDelContenido(page)).filter((c) => obstaculos.some((o) => cruza(c.caja, o))).map((c) => c.que)
  return [...new Set(tapado)]
}
