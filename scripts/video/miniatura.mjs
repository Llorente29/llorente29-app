#!/usr/bin/env node
// scripts/video/miniatura.mjs — V01 · la portada del vídeo para las plataformas.
//
//   node scripts/video/miniatura.mjs <salida>
//
// La imagen que sale antes de darle al play (YouTube, la web, LinkedIn) y la
// que se manda sola por correo o WhatsApp. Dos tamaños:
//   miniatura-16x9.jpg  1280×720   YouTube, la web, el correo, LinkedIn
//   miniatura-1x1.jpg   1080×1080  WhatsApp, Instagram (la horizontal se ve pequeña)
// Lleva capturas DE ESTA GRABACIÓN (capturas/4-titular.png y 7-casados.png):
// cuando cambia una pantalla y se regraba, la portada cambia con ella. Datos
// inventados, los mismos que el vídeo (ya revisados por revisar.mjs).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const salida = process.argv[2]
if (!salida) { console.error('uso: miniatura.mjs <salida>'); process.exit(2) }
const png = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`
const pagar = join(salida, 'capturas', '4-titular.png')
const casados = join(salida, 'capturas', '7-casados.png')
if (!existsSync(pagar) || !existsSync(casados)) { console.error('Faltan capturas/4-titular.png o 7-casados.png: ¿ha corrido el guion?'); process.exit(1) }
const logo = readFileSync('public/marcas/sumied/sumied-logo-horizontal.svg', 'utf8')

// Las zonas de cada captura (en píxeles de la captura, 1920×1080): la ventana
// «Pagar con Revolut» y la lista de los tres cargos casados solos.
const ZONA_PAGAR = { x: 700, y: 288, w: 520, h: 505 }
const ZONA_CASADOS = { x: 252, y: 476, w: 1000, h: 262 }

/** Un recorte de una captura como <div> con fondo, escalado a ancho px. */
const recorte = (img, z, ancho, clase) => {
  const k = ancho / z.w
  return `<div class="${clase}" style="width:${ancho}px;height:${Math.round(z.h * k)}px;background:url(${img}) -${Math.round(z.x * k)}px -${Math.round(z.y * k)}px / ${Math.round(1920 * k)}px ${Math.round(1080 * k)}px no-repeat"></div>`
}

const CSS = `
  *{box-sizing:border-box;margin:0}
  body{font-family:'DejaVu Sans',Arial,sans-serif;background:#0f1a33;color:#fff;overflow:hidden}
  .lienzo{position:relative;overflow:hidden;background:
    radial-gradient(1200px 700px at 85% 15%, rgba(10,142,255,.35), transparent 60%),
    radial-gradient(900px 600px at 0% 100%, rgba(0,207,203,.28), transparent 60%), #0f1a33}
  .logo{background:#fff;border-radius:14px;display:inline-flex;align-items:center}
  .logo svg{display:block;height:100%;width:auto}
  .etiqueta{display:inline-block;margin-top:30px;background:linear-gradient(90deg,#0A5BF0,#00CFCB);color:#fff;font-weight:700;border-radius:999px}
  h1{font-weight:800;line-height:1.08;letter-spacing:-.5px}
  h1 em{font-style:normal;background:linear-gradient(90deg,#0A8EFF,#06E6DC);-webkit-background-clip:text;background-clip:text;color:transparent}
  .sub{color:#c9d6f0;line-height:1.35}
  .cap{border-radius:14px;box-shadow:0 30px 60px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08);background-color:#fff}
  .sello{position:absolute;background:#16a34a;color:#fff;font-weight:700;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.35)}
  .play{position:absolute;border-radius:50%;background:rgba(255,255,255,.95);box-shadow:0 18px 40px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
  .play:after{content:'';border-style:solid;border-color:transparent transparent transparent #0A5BF0;margin-left:10%}
`

const horizontal = `<div class="lienzo" style="width:1280px;height:720px">
  <div style="position:absolute;left:64px;top:58px;width:500px">
    <div class="logo" style="height:64px;padding:10px 18px">${logo}</div>
    <div><span class="etiqueta" style="margin-top:30px;font-size:22px;padding:8px 18px">Vídeo · 2 minutos</span></div>
    <h1 style="margin-top:20px;font-size:62px">De la factura<br>al pago, <em>sin teclear nada</em></h1>
    <p class="sub" style="margin-top:22px;font-size:25px">La lee, la apunta, la paga con Revolut y la concilia sola.</p>
  </div>
  <div style="position:absolute;right:56px;top:70px;transform:rotate(1.5deg)">${recorte(png(pagar), ZONA_PAGAR, 470, 'cap')}</div>
  <div style="position:absolute;right:250px;top:470px;transform:rotate(-2deg)">${recorte(png(casados), ZONA_CASADOS, 560, 'cap')}</div>
  <div class="sello" style="right:60px;bottom:52px;font-size:22px;padding:10px 18px">✓ Casado solo con su factura</div>
  <div class="play" style="width:118px;height:118px;left:604px;top:520px"><style>.play:after{border-width:26px 0 26px 42px}</style></div>
</div>`

const cuadrada = `<div class="lienzo" style="width:1080px;height:1080px">
  <div style="position:absolute;left:70px;top:64px;right:70px">
    <div class="logo" style="height:70px;padding:11px 20px">${logo}</div>
    <h1 style="margin-top:40px;font-size:76px">De la factura al pago,<br><em>sin teclear nada</em></h1>
    <p class="sub" style="margin-top:22px;font-size:30px">La lee, la apunta, la paga con Revolut y la concilia sola.</p>
  </div>
  <div style="position:absolute;left:70px;top:470px;transform:rotate(-1.5deg)">${recorte(png(pagar), ZONA_PAGAR, 500, 'cap')}</div>
  <div style="position:absolute;right:50px;top:640px;transform:rotate(2deg)">${recorte(png(casados), ZONA_CASADOS, 470, 'cap')}</div>
  <div class="sello" style="right:60px;top:560px;font-size:26px;padding:12px 20px">✓ Casado solo</div>
  <div class="etiqueta" style="position:absolute;left:70px;bottom:56px;font-size:26px;padding:10px 22px">▶ Vídeo · 2 minutos</div>
</div>`

const navegador = await chromium.launch()
// portada-video.png: la misma horizontal, sin el botón de play, a 1920×1080: es el PRIMER fotograma del
// vídeo (montar.mjs la usa de portada). WhatsApp y el correo enseñan ese fotograma como vista previa.
const sinPlay = horizontal.replace(/<div class="play"[^]*?<\/div>/, '')
for (const [nombre, html, w, h, k] of [['miniatura-16x9.jpg', horizontal, 1280, 720, 1], ['miniatura-1x1.jpg', cuadrada, 1080, 1080, 1], ['portada-video.png', sinPlay, 1280, 720, 1.5]]) {
  const p = await navegador.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: k })
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`)
  await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: join(salida, nombre), ...(nombre.endsWith('.jpg') ? { type: 'jpeg', quality: 90 } : {}) })
  await p.close()
  console.log(`· ${nombre}`)
}
await navegador.close()
