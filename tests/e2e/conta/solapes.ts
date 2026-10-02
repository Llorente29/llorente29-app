/// <reference lib="dom" />
// tests/e2e/conta/solapes.ts
//
// La medida del C01 (nada tapado por la burbuja ni por la barra inferior),
// generalizada para las pantallas del C00 (encargo §9.5): se le dice cuál es
// la raíz del contenido y qué piezas flotan encima, y devuelve lo que quede
// debajo a cuatro alturas de scroll. La prueba exige que no haya nada.

import type { Page } from '@playwright/test'

interface Caja { x: number; y: number; w: number; h: number }
const cruza = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export async function loQueTapan(page: Page, raiz: string, flotantes: string[]): Promise<string[]> {
  const tapado = new Set<string>()
  const alto = await page.evaluate(() => document.documentElement.scrollHeight)
  for (const y of [0, alto / 3, (2 * alto) / 3, alto]) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    const encontrado = await page.evaluate(([r, fl]) => {
      const caja = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
      const obst = (fl as string[]).flatMap((s) => Array.from(document.querySelectorAll(s))).map(caja).filter((c) => c.w > 0 && c.h > 0)
      const flotan = (fl as string[]).flatMap((s) => Array.from(document.querySelectorAll(s)))
      const raizEl = document.querySelector(r as string)
      if (!raizEl) return { error: `No encuentro ${r}`, tapado: [] as string[] }
      if (obst.length === 0) return { error: `No encuentro ninguna pieza flotante (${(fl as string[]).join(', ')})`, tapado: [] as string[] }
      const out: string[] = []
      raizEl.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (flotan.some((f) => f.contains(el))) return
        const interactivo = el.matches('a, button, input, select, textarea, img, svg')
        const hojaConTexto = el.children.length === 0 && (el.textContent ?? '').trim() !== ''
        if (!interactivo && !hojaConTexto) return
        const st = getComputedStyle(el)
        const c = caja(el)
        if (c.w === 0 || c.h === 0 || st.visibility === 'hidden' || st.display === 'none') return
        const x = (a: typeof c, b: typeof c) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        if (obst.some((o) => x(c, o))) out.push((el.textContent ?? el.tagName).trim().slice(0, 40) || el.tagName)
      })
      return { error: null, tapado: out }
    }, [raiz, flotantes] as const)
    if (encontrado.error) throw new Error(encontrado.error)
    encontrado.tapado.forEach((t) => tapado.add(t))
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  void cruza
  return [...tapado]
}

/** Las piezas que flotan en el marco del módulo de contabilidad. */
export const FLOTANTES_CONTA = ['.cx-pregunta', '.cx-barra-inferior']
