/// <reference lib="dom" />
// tests/e2e/conta/k05/nadaCortado.ts
//
// K05 · «A 1456 y a 1366 no se corta nada» (Julio, 19/11): lo que se corta en
// la ficha que se ve, con la misma vara que el arnés con el que se midió el
// CSS. Cada casilla con lo que lleva, cada rótulo, la franja, los títulos, las
// celdas, los botones, la línea del saldo, las comprobaciones y la ayuda de
// teclas: se corta si su contenido es más ancho que su caja. Un desplegable,
// midiendo el texto que enseña contra su ancho menos la flecha. Las pestañas de
// arriba son del marco (K03), no de la ficha.

import type { Page } from '@playwright/test'

export async function loQueSeCorta(page: Page, ficha: string): Promise<string[]> {
  return page.locator(`.k-zona[data-activa="si"] ${ficha}`).evaluate((raiz) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    const l: string[] = []
    const sel = 'input, select, label, .kf-estado, .kf-origen, h1, h2, th, td, button, .kf-saldo, .kf-comprobaciones li, .kf-ayuda span, .kf-cola'
    for (const el of raiz.querySelectorAll<HTMLElement>(sel)) {
      if (el.offsetParent === null) continue
      let corta = el.scrollWidth > el.clientWidth + 1
      if (el instanceof HTMLSelectElement) {
        const cs = getComputedStyle(el)
        ctx.font = `${cs.fontSize} ${cs.fontFamily}`
        corta = ctx.measureText(el.selectedOptions[0]?.text ?? '').width > el.clientWidth - 22
      }
      if (el instanceof HTMLInputElement && !el.value && !el.placeholder) continue
      if (el instanceof HTMLInputElement && !el.value && el.placeholder) {
        const cs = getComputedStyle(el)
        ctx.font = `${cs.fontSize} ${cs.fontFamily}`
        corta = ctx.measureText(el.placeholder).width > el.clientWidth - 12
      }
      if (corta) {
        const texto = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? (el.value || (el as HTMLInputElement).placeholder) : el.textContent
        l.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('aria-label') ? ` (${el.getAttribute('aria-label')})` : ''}: «${String(texto).trim().slice(0, 70)}», ${el.scrollWidth} en ${el.clientWidth}`)
      }
    }
    return l
  })
}
