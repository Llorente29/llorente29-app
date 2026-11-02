#!/usr/bin/env node
// scripts/video/factura-al-pago.mjs — V01 · el vídeo «De la factura al pago».
//
//   node scripts/video/factura-al-pago.mjs reconocer <salida>
//   node scripts/video/factura-al-pago.mjs grabar <salida>
//
// Corre en el workflow video-staging-conta.yml, contra staging-conta, con la
// persona administradora de la empresa A de SU carril (scripts/e2e/carril.sh).
// El carril es una copia de las cuentas de prueba que se borra al acabar: lo
// que se siembre para el vídeo se va con él. Nada de producción.
//
// «reconocer»: una captura de cada pantalla del guion y su texto, para ver qué
// hay que sembrar. «grabar»: el guion con el ratón, en vídeo (ver guion.mjs).
//
// Entorno: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (públicas), CLAVE_PRUEBAS
// y E2E_CARRIL (los pone el workflow), VIDEO_URL (la app servida, por defecto
// http://127.0.0.1:4173).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { enCarril, correoDelCarril } from '../e2e/carril.mjs'

const [modo, salida] = process.argv.slice(2)
if (!['reconocer', 'grabar'].includes(modo) || !salida) {
  console.error('uso: factura-al-pago.mjs reconocer|grabar <salida>')
  process.exit(2)
}
const URL_SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const CLAVE = process.env.CLAVE_PRUEBAS
const CARRIL = Number(process.env.E2E_CARRIL)
const APP = process.env.VIDEO_URL || 'http://127.0.0.1:4173'
if (!URL_SUPA || !ANON || !CLAVE || !Number.isInteger(CARRIL)) {
  console.error('Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, CLAVE_PRUEBAS o E2E_CARRIL.')
  process.exit(2)
}
if (!URL_SUPA.includes('oseymswjlzplqoxrfjzi')) { console.error('No es staging-conta: paro.'); process.exit(2) }

export const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc', CARRIL)
export const CUENTA_A = enCarril('c01a0000-0000-4000-8000-00000000000a', CARRIL)
const CORREO = correoDelCarril('a.admin@prueba.folvy.test', CARRIL)
const CLAVE_STORAGE = 'sb-oseymswjlzplqoxrfjzi-auth-token'

async function sesion() {
  const r = await fetch(`${URL_SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE }),
  })
  if (!r.ok) throw new Error(`No se pudo entrar: HTTP ${r.status}`)
  return await r.json()
}

async function contexto(navegador, s, conVideo) {
  // VIDEO_ESCALA (2 por defecto): la página se pinta al doble de píxeles y se graba así (3840×2160),
  // para que el zoom del montaje amplíe texto nítido y no píxeles. Las coordenadas siguen en 1920×1080.
  const k = Number(process.env.VIDEO_ESCALA || 2)
  const ctx = await navegador.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: conVideo ? k : 1, locale: 'es-ES', timezoneId: 'Europe/Madrid',
    ...(conVideo ? { recordVideo: { dir: conVideo, size: { width: 1920 * k, height: 1080 * k } } } : {}),
  })
  await ctx.addInitScript(([k, v]) => { window.localStorage.setItem(k, v) }, [CLAVE_STORAGE, JSON.stringify(s)])
  return ctx
}

async function reconocer() {
  const dir = join(salida, 'reconocer')
  mkdirSync(dir, { recursive: true })
  const s = await sesion()
  const navegador = await chromium.launch({ args: ['--lang=es-ES'] })
  const ctx = await contexto(navegador, s, null)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  const rutas = [
    ['01-compras', '/conta/compras'],
    ['02-correo-facturas', '/conta/ajustes/correo-facturas'],
    ['03-recibidas', '/conta/documentos?ver=recibidas'],
    ['04-pagos', '/conta/compras/pagos'],
    ['05-bancos', '/conta/bancos'],
    ['06-cuentas', '/conta/bancos/cuentas'],
  ]
  for (const [nombre, ruta] of rutas) {
    try {
      await page.goto(APP + ruta, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(dir, `${nombre}.png`) })
      writeFileSync(join(dir, `${nombre}.txt`), `${page.url()}\n\n${await page.locator('body').innerText()}`)
      console.log(`· ${nombre}: ${page.url()}`)
    } catch (e) { console.log(`· ${nombre}: ${e.message}`) }
  }
  // La primera recibida de la lista, si la hay: su ficha.
  try {
    await page.goto(APP + '/conta/documentos?ver=recibidas', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    const enlace = page.locator('a[href*="/conta/documentos/recibidas/"]').first()
    if (await enlace.count()) {
      await enlace.click()
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(dir, '07-ficha-recibida.png') })
      writeFileSync(join(dir, '07-ficha-recibida.txt'), `${page.url()}\n\n${await page.locator('body').innerText()}`)
    } else console.log('· sin recibidas enlazadas en la lista')
  } catch (e) { console.log(`· ficha: ${e.message}`) }
  await navegador.close()
}

if (modo === 'reconocer') await reconocer()
else { const { grabar } = await import('./guion.mjs'); await grabar({ salida, sesion, contexto, APP, EMPRESA_A, CUENTA_A }) }
