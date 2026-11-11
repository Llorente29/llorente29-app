#!/usr/bin/env node
// scripts/video/albaran-a-oficina.mjs — V02 · el vídeo «Del albarán a la oficina» (Folvy).
//
//   node scripts/video/albaran-a-oficina.mjs reconocer <salida>
//
// Corre en video-staging-conta.yml (scripts/video/graba.txt lo elige), contra
// staging-conta, en la cuenta A de SU carril, que se borra al acabar. Marca
// Folvy (sin ?marca=sumied). Nada de producción.
//
// «reconocer»: cómo se ven hoy las pantallas del recorrido, en el móvil
// (390×844) y en el ordenador (1920×1080), con la persona administradora y con
// la encargada de A. Una captura y su texto por pantalla, en <salida>/reconocer.
// Para decidir con datos qué se siembra y cómo se monta (las fotos fijas van después).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { enCarril, correoDelCarril } from '../e2e/carril.mjs'

const [modo, salida] = process.argv.slice(2)
if (!['reconocer', 'recorrer'].includes(modo) || !salida) { console.error('uso: albaran-a-oficina.mjs reconocer|recorrer <salida>'); process.exit(2) }
const URL_SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const CLAVE = process.env.CLAVE_PRUEBAS
const CARRIL = Number(process.env.E2E_CARRIL)
const APP = process.env.VIDEO_URL || 'http://127.0.0.1:4173'
if (!URL_SUPA || !ANON || !CLAVE || !Number.isInteger(CARRIL)) { console.error('Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, CLAVE_PRUEBAS o E2E_CARRIL.'); process.exit(2) }
if (!URL_SUPA.includes('oseymswjlzplqoxrfjzi')) { console.error('No es staging-conta: paro.'); process.exit(2) }

const CLAVE_STORAGE = 'sb-oseymswjlzplqoxrfjzi-auth-token'
const PERSONAS = {
  admin: correoDelCarril('a.admin@prueba.folvy.test', CARRIL),
  encargado: correoDelCarril('a.encargado@prueba.folvy.test', CARRIL),
  trabajador: correoDelCarril('a.trabajador@prueba.folvy.test', CARRIL),
}
export const CUENTA_A = enCarril('c01a0000-0000-4000-8000-00000000000a', CARRIL)

async function sesion(correo) {
  const r = await fetch(`${URL_SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: correo, password: CLAVE }),
  })
  if (!r.ok) throw new Error(`No se pudo entrar como ${correo}: HTTP ${r.status}`)
  return await r.json()
}

const SIN_FRANJA = `(() => { const st = document.createElement('style'); st.textContent = 'div[role=status].bg-warning{display:none!important}';
  const poner = () => document.head && document.head.appendChild(st); if (document.head) poner(); else document.addEventListener('DOMContentLoaded', poner) })()`

async function contexto(navegador, s, movil) {
  const ctx = await navegador.newContext({
    viewport: movil ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    deviceScaleFactor: movil ? 2 : 1, isMobile: !!movil, hasTouch: !!movil,
    locale: 'es-ES', timezoneId: 'Europe/Madrid',
  })
  await ctx.addInitScript(([k, v]) => { window.localStorage.setItem(k, v) }, [CLAVE_STORAGE, JSON.stringify(s)])
  await ctx.addInitScript(SIN_FRANJA)
  return ctx
}

async function reconocer() {
  const dir = join(salida, 'reconocer')
  mkdirSync(dir, { recursive: true })
  const navegador = await chromium.launch({ args: ['--lang=es-ES'], env: { ...process.env, LANG: 'es_ES.UTF-8', LANGUAGE: 'es_ES:es' } })
  const foto = async (page, nombre) => {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(dir, `${nombre}.png`), scale: 'css' })
    writeFileSync(join(dir, `${nombre}.txt`), `${page.url()}\n\n${await page.locator('body').innerText().catch(() => '')}`)
    console.log(`· ${nombre}: ${page.url()}`)
  }
  const intento = async (nombre, f) => { try { await f() } catch (e) { console.log(`· ${nombre}: ${e.message.split('\n')[0]}`) } }

  for (const [quien, correo] of Object.entries(PERSONAS).filter(([k]) => k !== 'trabajador')) {
    let s
    try { s = await sesion(correo) } catch (e) { console.log(`· ${quien}: ${e.message}`); continue }
    // El móvil.
    const m = await contexto(navegador, s, true)
    const p = await m.newPage()
    p.on('pageerror', (e) => console.log(`[error de la página · ${quien}] ${e.message}`))
    await intento(`${quien}-m0-inicio`, async () => { await p.goto(`${APP}/`); await foto(p, `${quien}-m0-inicio`) })
    await intento(`${quien}-m1-recepciones`, async () => { await p.goto(`${APP}/supply/recepciones`); await foto(p, `${quien}-m1-recepciones`) })
    await intento(`${quien}-m2-recibir-pedido`, async () => {
      await p.getByRole('button', { name: /Recibir pedido/ }).first().click({ timeout: 10_000 })
      await foto(p, `${quien}-m2-recibir-pedido`)
    })
    await intento(`${quien}-m3-escanear`, async () => {
      await p.getByRole('button', { name: /Escanear albarán/ }).first().click({ timeout: 10_000 })
      await foto(p, `${quien}-m3-escanear`)
    })
    // El menú de la persona: ¿«Ver como trabajador»?
    await intento(`${quien}-m4-menu`, async () => {
      await p.goto(`${APP}/supply/recepciones`); await p.waitForTimeout(1500)
      const ver = p.getByText(/Ver como trabajador/).first()
      if (!(await ver.isVisible().catch(() => false))) {
        const boton = p.getByRole('button', { name: /menú|cuenta|perfil|usuario/i }).first()
        if (await boton.isVisible().catch(() => false)) await boton.click()
      }
      await foto(p, `${quien}-m4-menu`)
      if (await p.getByText(/Ver como trabajador/).first().isVisible().catch(() => false)) {
        await p.getByText(/Ver como trabajador/).first().click()
        await foto(p, `${quien}-m5-trabajador`)
      }
    })
    await m.close()
    if (quien !== 'admin') continue
    // El ordenador.
    const o = await contexto(navegador, s, false)
    const q = await o.newPage()
    await intento('o1-recepciones', async () => { await q.goto(`${APP}/supply/recepciones`); await foto(q, 'o1-recepciones') })
    await intento('o2-pedidos', async () => { await q.goto(`${APP}/supply`); await foto(q, 'o2-pedidos') })
    await intento('o3-pendientes', async () => { await q.goto(`${APP}/supply/pendientes`); await foto(q, 'o3-pendientes') })
    await o.close()
  }
  await navegador.close()
}

if (modo === 'reconocer') await reconocer()
if (modo === 'recorrer') { const { recorrer } = await import('./albaran-recorrer.mjs'); await recorrer({ salida, sesion, contexto, APP, CUENTA_A, PERSONAS }) }
