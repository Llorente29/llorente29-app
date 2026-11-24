/// <reference lib="dom" />
// tests/e2e/conta/k13/calco.spec.ts
//
// K13 · La prueba de calco: la factura recibida de Sumied, contra la maqueta 17b (maquetas/17b, que no se tocan), al
// mismo tamaño, 1366 × 768 y 1920 × 1080, sin duda y con una duda. En staging, en el restaurante de la cuenta del núcleo
// (semillas K11b y K13): K13-CALCO-1, por revisar, y K13-CALCO-2, de un emisor que no se conoce (su duda, en la franja).
//   · Cada `data-campo` de la maqueta tiene que estar en Sumied, en el mismo sitio y del mismo tamaño respecto a la
//     ficha, con 4 px de margen. Si falta o se mueve, en rojo.
//   · Y la altura del título de la ventana a «Visualización del asiento», con 4 px de margen.
//   · La maqueta y Sumied, una al lado de la otra, en docs/conta/capturas/k13 (el artefacto «capturas» del run); y en el
//     resumen del run, cada casilla que ha necesitado margen, con cuánto.
// Solo abre y mide: no escribe nada en la base.

import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { entrarComo, enCarril } from '../sesion'
import { abierta, NUCLEO } from '../k02/comun'

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })

const DIR = 'docs/conta/capturas/k13'
const MAQUETAS = path.resolve('maquetas/17b')
const MARGEN = 4
const RESTAURANTE = 'Restaurante de Ejemplo Núcleo, S.L.'
const FICHA = '[data-prueba="ficha-recibida-nucleo"]'
const ficha = (page: Page) => page.locator(`.k-zona[data-activa="si"] ${FICHA}`)
const SIN_DUDA = enCarril('c0f14000-0000-4000-8000-0000000000f1')
const CON_DUDA = enCarril('c0f14000-0000-4000-8000-0000000000f2')

interface Medida { ficha: [number, number]; alto: number | null; campos: Record<string, [number, number, number, number]> }

/** Cada `data-campo` (izquierda, arriba, ancho y alto) respecto a la ficha, y del título de la ventana a «Visualización». */
async function medir(page: Page, raiz: string, fichaSel: string, tituloSel: string, cabeceraSel: string): Promise<Medida> {
  return page.locator(raiz).first().evaluate((r, [fs_, ts, cs]) => {
    const f = r.querySelector(fs_)!.getBoundingClientRect()
    const t = r.querySelector(ts)?.getBoundingClientRect()
    const v = [...r.querySelectorAll(cs)].find((e) => /Visualización del asiento/.test(e.textContent ?? ''))?.getBoundingClientRect()
    const campos: Record<string, [number, number, number, number]> = {}
    for (const e of r.querySelectorAll('[data-campo]')) {
      const b = e.getBoundingClientRect()
      campos[e.getAttribute('data-campo')!] = [b.left - f.left, b.top - f.top, b.width, b.height].map((x) => Math.round(x)) as [number, number, number, number]
    }
    return { ficha: [Math.round(f.width), Math.round(f.height)] as [number, number], alto: t && v ? Math.round(v.top - t.top) : null, campos }
  }, [fichaSel, tituloSel, cabeceraSel] as const)
}

async function entrarEnElRestaurante(page: Page) {
  await entrarComo(page, NUCLEO.email)
  await page.goto('/conta/inicio?marca=sumied', { timeout: 30_000 })
  await expect(page.locator('.k-nucleo')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.sessionStorage.removeItem('folvy.conta.nucleo.pestanas'))
  await page.getByRole('button', { name: /Cambiar de empresa o de ejercicio/ }).click()
  await page.getByRole('group', { name: 'Empresa y ejercicio' }).getByRole('button', { name: new RegExp(`^${RESTAURANTE}`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${RESTAURANTE}`) })).toBeVisible({ timeout: 30_000 })
  await abierta(page, 'Inicio')
}

const resumen = (texto: string) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto) }

for (const [ancho, alto] of [[1366, 768], [1920, 1080]] as const) {
  for (const duda of [false, true]) {
    const cual = `${ancho}${duda ? '-con-duda' : ''}`
    test(`la recibida calcada de la 17b a ${ancho} × ${alto}, ${duda ? 'con una duda' : 'sin duda'}`, async ({ page, browser }) => {
      test.setTimeout(180_000)
      const errores: string[] = []
      page.on('pageerror', (e) => errores.push(e.message))
      await page.setViewportSize({ width: ancho, height: alto })
      await entrarEnElRestaurante(page)
      await page.goto(`/conta/documentos/recibidas/${duda ? CON_DUDA : SIN_DUDA}?ver=por-revisar`, { timeout: 30_000 })
      await expect(ficha(page)).toBeVisible({ timeout: 30_000 })
      await expect(ficha(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
      await expect(ficha(page).locator('[data-prueba="cuadra"]')).toBeVisible({ timeout: 30_000 })
      if (duda) await expect(ficha(page).locator('.kr-dudas .kf-duda')).toHaveCount(1, { timeout: 30_000 })
      else await expect(ficha(page).locator('.kr-dudas > *')).toHaveCount(0)
      await page.waitForTimeout(500)
      const sumied = await medir(page, `.k-zona[data-activa="si"] ${FICHA}`, '.kp-ventana-cuerpo', '.kp-ventana-titulo', '.kr-hd')

      // La maqueta, al mismo tamaño.
      const m = await browser.newPage({ viewport: { width: ancho, height: alto } })
      await m.goto(`file://${MAQUETAS}/maqueta_17b_recibida_${duda ? 'duda_' : ''}${ancho}.html`)
      const maqueta = await medir(m, 'body', '.ficha', '.wt', '.hd')

      // Casilla a casilla.
      const fallos: string[] = []
      const margen: string[] = []
      for (const [campo, v] of Object.entries(maqueta.campos)) {
        const s = sumied.campos[campo]
        if (!s) { fallos.push(`${campo}: falta en Sumied`); continue }
        const d = v.map((x, i) => s[i] - x)
        const texto = `${campo}: maqueta ${v.join(', ')} · Sumied ${s.join(', ')} (Δ izquierda ${d[0]}, arriba ${d[1]}, ancho ${d[2]}, alto ${d[3]})`
        if (d.some((x) => Math.abs(x) > MARGEN)) fallos.push(texto)
        else if (d.some((x) => x !== 0)) margen.push(texto)
      }
      const dAlto = sumied.alto === null || maqueta.alto === null ? null : sumied.alto - maqueta.alto
      if (dAlto === null) fallos.push('del título a «Visualización del asiento»: no se ha podido medir')
      else if (Math.abs(dAlto) > MARGEN) fallos.push(`del título a «Visualización del asiento»: maqueta ${maqueta.alto} · Sumied ${sumied.alto} (Δ ${dAlto})`)

      // Una al lado de la otra.
      fs.mkdirSync(DIR, { recursive: true })
      const fotoMaqueta = await m.screenshot()
      const fotoSumied = await page.screenshot()
      await m.close()
      const lado = await browser.newPage({ viewport: { width: ancho * 2 + 24, height: alto + 40 } })
      await lado.setContent(`<body style="margin:0;font:600 16px sans-serif;background:#fff"><div style="display:flex;gap:24px">
        <div><div style="height:32px;padding:6px 8px">Maqueta 17b · ${ancho} × ${alto}${duda ? ' · con una duda' : ''}</div><img src="data:image/png;base64,${fotoMaqueta.toString('base64')}"></div>
        <div><div style="height:32px;padding:6px 8px">Sumied (staging) · ${ancho} × ${alto}${duda ? ' · con una duda' : ''}</div><img src="data:image/png;base64,${fotoSumied.toString('base64')}"></div>
      </div></body>`)
      await lado.screenshot({ path: `${DIR}/calco-${cual}.png` })
      await lado.close()

      console.log(`[K13 calco ${cual}] ficha maqueta ${maqueta.ficha} · Sumied ${sumied.ficha}; título→visualización maqueta ${maqueta.alto} · Sumied ${sumied.alto}`)
      for (const x of margen) console.log(`[K13 calco ${cual}] con margen · ${x}`)
      for (const x of fallos) console.log(`[K13 calco ${cual}] FUERA · ${x}`)
      resumen([
        `\n### Calco 17b · ${ancho} × ${alto}${duda ? ' · con una duda' : ''}\n`,
        `Del título a «Visualización del asiento»: maqueta ${maqueta.alto} px · Sumied ${sumied.alto} px. Lado a lado: \`${DIR}/calco-${cual}.png\` (artefacto «capturas»).\n\n`,
        fallos.length ? `**Fuera del margen de ${MARGEN} px:**\n${fallos.map((x) => `- ${x}`).join('\n')}\n\n` : `Todas las casillas, dentro del margen de ${MARGEN} px.\n\n`,
        margen.length ? `Con margen (aunque sea pequeño):\n${margen.map((x) => `- ${x}`).join('\n')}\n` : '',
      ].join(''))

      expect(fallos, `a ${ancho} × ${alto}${duda ? ', con una duda' : ''}: las casillas fuera del margen de ${MARGEN} px`).toEqual([])
      expect(errores, 'errores de la página').toEqual([])
    })
  }
}
