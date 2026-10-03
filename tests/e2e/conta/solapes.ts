/// <reference lib="dom" />
// tests/e2e/conta/solapes.ts
//
// La medida del C01 (nada tapado por la burbuja ni por la barra inferior),
// generalizada para las pantallas del C00 (encargo §9.5): se le dice cuál es
// la raíz del contenido y qué piezas flotan encima, y devuelve lo que se queda
// debajo SIN REMEDIO. La prueba exige que no haya nada.
//
// «Sin remedio» se mide con la página bajada del todo. Las piezas flotantes
// del módulo van pegadas ABAJO (la barra «Pregunta o pide algo», la barra
// inferior del móvil), así que en una página larga todo pasa por debajo de
// ellas a media altura: eso no es tapar, se ve bajando un poco más. Lo que no
// se puede ver nunca es lo que sigue debajo cuando ya no se puede bajar más:
// ahí es donde el relleno inferior del marco tiene que dejar sitio. (Hasta el
// 03/10 se miraba a cuatro alturas; con las tablas largas del C00 eso contaba
// como tapadas filas que se ven bajando, y no medía lo que quería medir.)

import type { Page } from '@playwright/test'

interface Caja { x: number; y: number; w: number; h: number }
const cruza = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export async function loQueTapan(page: Page, raiz: string, flotantes: string[]): Promise<string[]> {
  const tapado = new Set<string>()
  // Se mide con la página QUIETA: si aún llega contenido, la medida se hace
  // sobre una página que ya no existe (03/10: pasaba con el esqueleto y falló
  // el día que los datos llegaron a mitad de medida).
  const altura = () => page.evaluate(() => document.documentElement.scrollHeight)
  let alto = await altura()
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250)
    const ahora = await altura()
    if (ahora === alto) break
    alto = ahora
  }
  for (const y of [alto]) {
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
    if (await altura() !== alto) throw new Error('La página cambió de alto mientras se medía: la medida no vale')
    encontrado.tapado.forEach((t) => tapado.add(t))
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  void cruza
  return [...tapado]
}

/** Las piezas que flotan en el marco del módulo de contabilidad. */
export const FLOTANTES_CONTA = ['.cx-pregunta', '.cx-barra-inferior']
