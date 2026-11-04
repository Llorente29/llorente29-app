#!/usr/bin/env node
// scripts/video/albaran-fotos.mjs — V02 · las fotos fijas, una por escena, tal como saldrán en el vídeo.
//
//   node scripts/video/albaran-fotos.mjs <carpeta del recorrido> <salida>
//
// Antes de grabar (encargo V02, «Diseño»): cada escena con su marco, sus datos,
// su zoom y su subtítulo, para que Julio las apruebe. La cocina, en el móvil
// dentro del teléfono sobre la marca Folvy; la oficina, a pantalla completa.
// Portada y cierre: el logo, Fraunces y los colores de la marca, sin capturas.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { FOLVY, HUECO, K, fotoEnMarco } from './marco.mjs'

const [dir, salida] = process.argv.slice(2)
if (!dir || !salida) { console.error('uso: albaran-fotos.mjs <carpeta del recorrido> <salida>'); process.exit(2) }
mkdirSync(salida, { recursive: true })
const captura = (re) => { const f = readdirSync(dir).filter((x) => x.endsWith('.png') && re.test(x)).sort()[0]; return f ? join(dir, f) : null }
const png = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`
const logo = () => readFileSync('public/folvy_logo_transparente.svg', 'utf8')
const FUENTES = '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">'

/** El subtítulo, como lo quema el montaje (montar.mjs: DejaVu Sans, negrita, caja al 62 %). */
const subtitulo = (t) => t ? `<div style="position:absolute;left:180px;right:180px;bottom:36px;text-align:center">
  <span style="display:inline;font:700 44px/1.32 'DejaVu Sans',Arial,sans-serif;color:#fff;background:rgba(20,20,20,.62);padding:6px 18px;
  -webkit-box-decoration-break:clone;box-decoration-break:clone">${t}</span></div>` : ''

async function lienzo(navegador, ruta, cuerpo, { sub, fondoPagina } = {}) {
  const p = await navegador.newPage({ viewport: { width: 1920, height: 1080 } })
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${FUENTES}<style>*{box-sizing:border-box;margin:0}
    html,body{width:1920px;height:1080px;overflow:hidden;background:${fondoPagina ?? FOLVY.crema}}</style></head>
    <body>${cuerpo}${subtitulo(sub)}</body></html>`)
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)
  await p.screenshot({ path: ruta })
  await p.close()
}

/** Una tarjeta de la marca (portada y cierre): el logo grande, una frase en Fraunces y nada más. */
const tarjeta = (frase, abajo) => `<div style="position:absolute;inset:0;background:${FOLVY.crema};overflow:hidden">
  <div style="position:absolute;width:1100px;height:1100px;left:-380px;top:-420px;border-radius:50%;background:radial-gradient(circle at 60% 60%, rgba(30,58,95,.12), rgba(30,58,95,0) 68%)"></div>
  <div style="position:absolute;width:980px;height:980px;right:-300px;bottom:-380px;border-radius:50%;background:radial-gradient(circle at 40% 40%, rgba(214,116,66,.18), rgba(214,116,66,0) 66%)"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px">
    <div style="height:150px">${logo().replace('<svg', '<svg style="height:100%;width:auto;display:block"')}</div>
    <div style="width:120px;height:6px;border-radius:3px;background:${FOLVY.terracota}"></div>
    <div style="font:600 72px/1.15 Fraunces,Georgia,serif;color:${FOLVY.marino};text-align:center;max-width:1400px">${frase}</div>
    ${abajo ? `<div style="font:500 34px Inter,Arial,sans-serif;color:${FOLVY.marino};opacity:.7">${abajo}</div>` : ''}
  </div></div>`

/** La oficina a pantalla completa, con su zoom: la captura de 1920×1080 ampliada z veces hacia (cx, cy). */
function oficina(f, z = 1, cx = 960, cy = 540) {
  const w = 1920 * z; const h = 1080 * z
  const x = Math.min(Math.max(cx * z - 960, 0), w - 1920); const y = Math.min(Math.max(cy * z - 540, 0), h - 1080)
  return `<img src="${png(f)}" style="position:absolute;left:${-x}px;top:${-y}px;width:${w}px;height:${h}px">`
}

const navegador = await chromium.launch()
const hechas = []
const escena = async (n, nombre, f) => { const ruta = join(salida, `${n}-${nombre}.png`); await f(ruta); hechas.push(ruta); console.log(`· ${ruta}`) }

await escena(0, 'portada', (r) => lienzo(navegador, r, tarjeta('Del albarán a la oficina, sin papeles')))

/** Un punto de la pantalla del móvil (en px de 390×844) en el 1920×1080 de la composición. */
const enMarco = (x, y) => [HUECO.x + x * K, HUECO.y + y * K]
const movil = async (n, nombre, re, sub, zoom) => {
  const c = captura(re)
  if (!c) { console.log(`· ${n}-${nombre}: no hay captura (${re})`); return }
  await escena(n, nombre, async (r) => {
    const tmp = `${r}.marco.png`
    await fotoEnMarco(navegador, c, tmp)
    // El zoom, sobre la composición entera (como en el vídeo): se acerca el teléfono hacia lo que se comenta.
    const [cx, cy] = zoom ? enMarco(zoom.x, zoom.y) : [960, 540]
    await lienzo(navegador, r, oficina(tmp, zoom?.z ?? 1, cx, cy), { sub })
  })
}
await movil(1, 'escanear', /-recibir\.png$/, 'Llega el proveedor. En cocina abres Folvy en el móvil y escaneas el albarán.')
await movil(2, 'lectura', /-leido\.png$/, 'Folvy lee el albarán: el proveedor, el número y cada línea.')
await movil(3, 'contar', /-lechuga-2\.png$/, 'Cuentas lo que llega. Faltan cajas: lo ajustas y Folvy lo apunta.')
await movil(4, 'recibido', /-recibido\.png$/, 'Recibido: el stock ya está dentro.')

const of5 = captura(/-oficina-revision\.png$/)
if (of5) await escena(5, 'oficina', (r) => lienzo(navegador, r, oficina(of5, 1.3, 860, 450), { sub: 'En la oficina lo ves al momento: cada línea, lo que entra al almacén y a qué precio.' }))
else console.log('· 5-oficina: no hay captura')
const of6 = captura(/-oficina-aprobado\.png$/)
if (of6) await escena(6, 'aprobado', (r) => lienzo(navegador, r, oficina(of6, 1.25, 820, 330), { sub: 'Lo verificas, se cierra el albarán y Folvy te lo confirma.' }))
else console.log('· 6-aprobado: no hay captura')

await escena(7, 'cierre', (r) => lienzo(navegador, r, tarjeta('Folvy · la cocina en orden', 'app.folvy.app')))
await navegador.close()
console.log(`${hechas.length} fotos en ${salida}`)
