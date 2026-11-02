// scripts/video/raton.mjs — V01 · el ratón que se ve, el círculo de cada clic,
// las marcas de tiempo de los subtítulos y los cortes de las esperas.
//
// Chromium sin pantalla no pinta el cursor: se pinta uno con un <div> que
// sigue a mousemove, y cada mousedown deja un círculo suave que se apaga.
// Todo pointer-events: none, así que no cambia lo que se pulsa.

import { readFileSync } from 'node:fs'

export const CURSOR = `
(() => {
  if (window.__raton) return; window.__raton = true
  const poner = () => {
    const c = document.createElement('div')
    c.id = '__cursor'
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 2 L3 22 L8.5 17 L12.5 26 L16 24.5 L12 15.8 L19.5 15.5 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' })
    document.documentElement.appendChild(c)
    const st = document.createElement('style')
    st.textContent = '@keyframes __onda{from{transform:translate(-50%,-50%) scale(.3);opacity:.85}to{transform:translate(-50%,-50%) scale(1);opacity:0}}' +
      '.__onda{position:fixed;width:58px;height:58px;border-radius:50%;border:3px solid rgba(37,99,235,.9);background:rgba(37,99,235,.18);pointer-events:none;z-index:2147483646;animation:__onda .6s ease-out forwards}'
    document.documentElement.appendChild(st)
    const xy = window.__ultimo || { x: -100, y: -100 }
    c.style.left = xy.x + 'px'; c.style.top = xy.y + 'px'
    addEventListener('mousemove', (e) => { window.__ultimo = { x: e.clientX, y: e.clientY }; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', (e) => {
      const o = document.createElement('div'); o.className = '__onda'
      o.style.left = e.clientX + 'px'; o.style.top = e.clientY + 'px'
      document.documentElement.appendChild(o); setTimeout(() => o.remove(), 700)
    }, true)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poner); else poner()
})()
`

/** El reloj del vídeo: segundos desde que se abrió la página (cuando empieza a grabar). */
export function reloj() {
  const t0 = Date.now()
  const pasos = []
  const cortes = []
  const dichos = []
  return {
    t: () => (Date.now() - t0) / 1000,
    pasos, cortes, dichos,
    /**
     * Una frase de la locución: se marca aquí (su subtítulo y su voz empiezan
     * ahora), se hace el gesto que cuenta y se espera a que la voz acabe, con
     * un respiro, antes del gesto siguiente. Dentro no puede haber esperas que
     * se corten (sinVer): cortarían la frase.
     */
    async di(id, texto, dura, gesto) {
      const a = Date.now()
      dichos.push({ id, texto, dura, desde: (a - t0) / 1000 })
      console.log(`  «${texto}»`)
      if (gesto) await gesto()
      const falta = dura + 0.55 - (Date.now() - a) / 1000
      if (falta > 0) await new Promise((ok) => setTimeout(ok, falta * 1000))
    },
    /** Empieza el paso: su subtítulo sale desde aquí hasta el siguiente. */
    marca(paso, subtitulo) { pasos.push({ paso, subtitulo, desde: (Date.now() - t0) / 1000 }); console.log(`· paso ${paso}: ${subtitulo}`) },
    /** Lo que pase dentro (esperas de red) no sale en el montaje. */
    async sinVer(fn) {
      const a = (Date.now() - t0) / 1000
      try { return await fn() } finally { cortes.push([a, (Date.now() - t0) / 1000]) }
    },
  }
}

/** Mover el ratón como una persona: en unos pasos, con una pausa corta. */
export function raton(page) {
  let x = 960; let y = 540
  const a = {
    async ir(nx, ny, ms = 650) {
      const pasos = Math.max(12, Math.round(ms / 16))
      // Con un poco de curva, de origen a destino.
      for (let i = 1; i <= pasos; i++) {
        const k = i / pasos; const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
        await page.mouse.move(x + (nx - x) * e, y + (ny - y) * e)
        await page.waitForTimeout(ms / pasos)
      }
      x = nx; y = ny
    },
    async a(locator, ms) {
      await locator.scrollIntoViewIfNeeded()
      const c = await locator.boundingBox()
      if (!c) throw new Error('El elemento no se ve.')
      await a.ir(c.x + Math.min(c.width / 2, 60 + c.width / 4), c.y + c.height / 2, ms)
    },
    async clic(locator, ms) {
      await a.a(locator, ms)
      await page.waitForTimeout(180)
      await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up()
    },
  }
  return a
}

/** La portada y el cierre: el logo de Sumied y su frase, en 1920×1080. */
export async function tarjeta(navegador, ruta, frase, abajo) {
  const logo = readFileSync('public/marcas/sumied/sumied-logo-horizontal.svg', 'utf8')
  const page = await navegador.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#fff;font-family:'DejaVu Sans',Arial,sans-serif}
    .c{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px}
    .l svg{width:760px;height:auto;display:block}
    .f{font-size:56px;font-weight:700;color:#14213d;text-align:center;max-width:1500px;line-height:1.25}
    .a{font-size:40px;color:#4b5563}
  </style></head><body><div class="c"><div class="l">${logo}</div><div class="f">${frase}</div>${abajo ? `<div class="a">${abajo}</div>` : ''}</div></body></html>`)
  await page.screenshot({ path: ruta })
  await page.close()
}
