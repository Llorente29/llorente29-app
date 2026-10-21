// tests/inventario/capturas/sacar.mjs · Saca las capturas del banco.
//   npx vite --port 5199 &   node tests/inventario/capturas/sacar.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BANCO ?? 'http://localhost:5199/tests/inventario/capturas/banco.html'
const dir = 'docs/inventario/capturas'
mkdirSync(dir, { recursive: true })
const tomas = [
  ['tablet-aplicado', 800, 1280], ['tablet-faltan', 800, 1280], ['tablet-error', 800, 1280],
  ['conteo-noche', 1280, 900], ['conteo-noche', 390, 844], ['conteo-tablet', 1280, 900],
  ['aviso', 1280, 520], ['aviso', 390, 844],
]
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined })
for (const [escena, w, h] of tomas) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await p.goto(`${base}?escena=${escena}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const f = `${dir}/${escena}-${w < 600 ? 'movil' : w === 800 ? 'tablet' : 'ordenador'}.png`
  await p.screenshot({ path: f, fullPage: true })
  console.log(f)
  await p.close()
}
await b.close()
