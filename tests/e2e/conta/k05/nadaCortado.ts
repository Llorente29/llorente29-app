/// <reference lib="dom" />
// tests/e2e/conta/k05/nadaCortado.ts
//
// K05 · «A 1456 y a 1366 no se corta nada» (Julio, 19/11; K06: también el nombre de una cuenta en dos líneas): lo que se corta en
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
    const sel = 'input, textarea, select, label, .kf-estado, .kf-origen, h1, h2, th, td, button, .kf-saldo, .kf-comprobaciones li, .kf-ayuda span, .kf-cola'
    for (const el of raiz.querySelectorAll<HTMLElement>(sel)) {
      if (el.offsetParent === null) continue
      let corta = el.scrollWidth > el.clientWidth + 1
      // K06 · Un nombre de cuenta (textarea) puede ir en dos líneas: se corta si no le caben (más alto que su caja).
      if (el instanceof HTMLTextAreaElement) corta = corta || el.scrollHeight > el.clientHeight + 1
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
      // K11b · En la recibida como ERP10 (.kr), lo cortado vale si su `title` lo dice entero (al pasar el ratón): la
      // maqueta aprobada corta los nombres largos («VENTAS DE MERCADE», nucleo_18b), como ERP10. Fuera de ella, como siempre.
      if (corta && el.closest('.kr')) {
        const visto = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
          ? (el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text ?? '' : el.value || (el as HTMLInputElement).placeholder) : el.textContent ?? ''
        const titulo = el.getAttribute('title') ?? el.closest('[title]')?.getAttribute('title') ?? ''
        if (visto.trim() && titulo.includes(visto.trim())) corta = false
      }
      if (corta) {
        const texto = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? (el.value || (el as HTMLInputElement).placeholder) : el.textContent
        l.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('aria-label') ? ` (${el.getAttribute('aria-label')})` : ''}: «${String(texto).trim().slice(0, 70)}», ${el.scrollWidth} en ${el.clientWidth}`)
      }
    }
    return l
  })
}
