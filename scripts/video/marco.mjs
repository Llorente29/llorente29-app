// scripts/video/marco.mjs — V02 · el móvil dentro del vídeo 16:9, sobre la marca Folvy.
//
// La cocina se graba a tamaño de móvil (390×844). Aquí se pone esa pantalla
// dentro de un teléfono limpio, en el centro de un 1920×1080 con el fondo de la
// marca: crema, formas suaves en azul marino y terracota, y el logo arriba a la
// izquierda. Abajo queda el hueco del subtítulo. Sirve para las fotos fijas
// (una imagen dentro) y para el vídeo (ffmpeg pone la grabación en el HUECO).
//
//   fondoConMarco(navegador, ruta)  → PNG 1920×1080: fondo + teléfono, con la pantalla TRANSPARENTE
//   HUECO                           → dónde va la pantalla, en píxeles del 1920×1080
//   fotoEnMarco(navegador, captura, ruta, { zoom }) → PNG 1920×1080 con la captura dentro (fotos fijas)

import { readFileSync } from 'node:fs'

/** La marca (public/folvy_logo_principal.svg): azul marino, terracota, crema; Fraunces en el logotipo. */
export const FOLVY = { marino: '#1E3A5F', terracota: '#D67442', crema: '#F5F4F0', tinta: '#15171A' }

// La pantalla del móvil a 0,9 de su tamaño: 390×844 → 351×760, con una barra de
// estado de 26 px encima (la hora y la batería, como un móvil de verdad: así la
// muesca no tapa la cabecera de la app). Con el bisel, el teléfono mide 375×810 y
// va de y=44 a y=854: debajo cabe el subtítulo de dos líneas sin pisarlo.
export const K = 0.9
const BISEL = 12
export const ESTADO = 26
export const HUECO = { w: Math.round(390 * K), h: Math.round(844 * K) }
HUECO.x = Math.round((1920 - HUECO.w) / 2)
HUECO.y = 44 + BISEL + ESTADO
export const RADIO = 34

const logo = () => readFileSync('public/folvy_logo_transparente.svg', 'utf8')

function html({ pantalla }) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0}
    html,body{width:1920px;height:1080px;overflow:hidden;background:transparent}
    .lienzo{position:absolute;inset:0;background:${FOLVY.crema};overflow:hidden}
    .forma{position:absolute;border-radius:50%;filter:blur(2px)}
    .f1{width:900px;height:900px;left:-260px;top:-320px;background:radial-gradient(circle at 60% 60%, rgba(30,58,95,.13), rgba(30,58,95,0) 68%)}
    .f2{width:820px;height:820px;right:-240px;bottom:-300px;background:radial-gradient(circle at 40% 40%, rgba(214,116,66,.18), rgba(214,116,66,0) 66%)}
    .arco{position:absolute;right:210px;top:150px;width:260px;height:260px;border-radius:50%;border:10px solid rgba(214,116,66,.22);border-left-color:transparent;border-bottom-color:transparent;transform:rotate(18deg)}
    .anillo{position:absolute;left:230px;bottom:170px;width:180px;height:180px;border-radius:50%;border:6px solid rgba(30,58,95,.14)}
    .logo{position:absolute;left:64px;top:52px;height:64px}
    .logo svg{height:100%;width:auto;display:block}
    .telefono{position:absolute;left:${HUECO.x - BISEL}px;top:${HUECO.y - BISEL - ESTADO}px;width:${HUECO.w + 2 * BISEL}px;height:${HUECO.h + ESTADO + 2 * BISEL}px;
      border-radius:${RADIO + BISEL}px;background:${FOLVY.tinta};box-shadow:0 40px 80px rgba(30,58,95,.28),0 8px 20px rgba(21,23,26,.25),inset 0 0 0 2px #2c3036}
    .pantalla{position:absolute;left:${BISEL}px;top:${BISEL}px;width:${HUECO.w}px;height:${HUECO.h + ESTADO}px;border-radius:${RADIO}px;overflow:hidden;background:#fff}
    .estado{position:absolute;left:0;right:0;top:0;height:${ESTADO}px;background:#fff;font:600 13px Inter,Arial,sans-serif;color:${FOLVY.tinta};
      display:flex;align-items:center;justify-content:space-between;padding:4px 26px 0}
    .estado .bat{width:22px;height:10px;border:1.5px solid ${FOLVY.tinta};border-radius:3px;position:relative}
    .estado .bat:after{content:'';position:absolute;inset:1.5px;right:5px;background:${FOLVY.tinta};border-radius:1px}
    .hueco{position:absolute;left:0;top:${ESTADO}px;width:${HUECO.w}px;height:${HUECO.h}px;background:${pantalla ? '#fff' : 'transparent'}}
    .hueco img{position:absolute;left:0;top:0;width:${HUECO.w}px;height:${HUECO.h}px}
    .muesca{position:absolute;left:50%;top:${BISEL + 6}px;width:84px;height:22px;margin-left:-42px;border-radius:12px;background:${FOLVY.tinta};z-index:2}
  </style></head><body><div class="lienzo">
    <div class="forma f1"></div><div class="forma f2"></div><div class="arco"></div><div class="anillo"></div>
    <div class="logo">${logo()}</div>
    <div class="telefono"><div class="pantalla"><div class="estado"><span>9:41</span><span class="bat"></span></div><div class="hueco">${pantalla ? `<img src="${pantalla}">` : ''}</div></div><div class="muesca"></div></div>
  </div></body></html>`
}

/**
 * El fondo con el teléfono y la pantalla TRANSPARENTE (para el vídeo: ffmpeg pone la grabación debajo, en HUECO).
 * La pantalla se recorta con su radio: el PNG lleva el agujero.
 */
export async function fondoConMarco(navegador, ruta) {
  const p = await navegador.newPage({ viewport: { width: 1920, height: 1080 } })
  await p.setContent(html({ pantalla: null }))
  await p.evaluate(() => document.fonts.ready)
  // El agujero: la pantalla con fondo transparente sobre un lienzo que sí pinta; se recorta con una máscara.
  await p.addStyleTag({ content: `.lienzo{-webkit-mask: radial-gradient(#000 0 0) , linear-gradient(#000 0 0)}` })
  await p.evaluate(({ x, y, w, h, r }) => {
    const l = document.querySelector('.lienzo')
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'><defs><mask id='m'><rect width='1920' height='1080' fill='white'/><rect x='${x}' y='${y}' width='${w}' height='${h - r}' fill='black'/><rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' fill='black'/></mask></defs><rect width='1920' height='1080' fill='white' mask='url(#m)'/></svg>`
    const u = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
    l.style.webkitMaskImage = u; l.style.maskImage = u
    l.style.webkitMaskSize = '1920px 1080px'; l.style.maskSize = '1920px 1080px'
  }, { ...HUECO, r: RADIO })
  await p.screenshot({ path: ruta, omitBackground: true })
  await p.close()
}

/**
 * Una foto fija: la captura del móvil (390×844, a 2x) dentro del teléfono, tal como saldrá.
 */
export async function fotoEnMarco(navegador, captura, ruta) {
  const p = await navegador.newPage({ viewport: { width: 1920, height: 1080 } })
  const src = `data:image/png;base64,${readFileSync(captura).toString('base64')}`
  await p.setContent(html({ pantalla: src }))
  await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: ruta })
  await p.close()
}
