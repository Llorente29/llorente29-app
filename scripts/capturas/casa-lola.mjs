// scripts/capturas/casa-lola.mjs
//
// DM1·8 (03/11) · Las capturas de Casa Lola para la guía de la gestoría, en
// PRODUCCIÓN, con el usuario que Julio creó solo para esto (invitado a Casa
// Lola con «Todo»). Solo lee: entra por la pantalla de siempre y abre cinco
// pantallas; no pulsa nada más que «Entrar».
//
//   CAPTURAS_CORREO, CAPTURAS_CLAVE   el usuario (secretos de Actions; nunca se imprimen)
//   CAPTURAS_URL                      por defecto https://app.sumied.com
//   CAPTURAS_DIR                      por defecto capturas/casa-lola
//
// Las cinco pantallas, a 1440 px de ancho (y la página entera de alto):
// Inicio, Compras, Bancos, Impuestos y Pagos. En producción no hay banda de
// pruebas (FranjaEntorno solo sale fuera de producción), y aun así se mira.
// Para sin guardar nada si la empresa que se ve no es Casa Lola o si en la
// página sale Llorente29 o Foodint: la guía no lleva datos de nadie más.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const URL = (process.env.CAPTURAS_URL ?? 'https://app.sumied.com').replace(/\/$/, '')
const DIR = process.env.CAPTURAS_DIR ?? 'capturas/casa-lola'
const correo = process.env.CAPTURAS_CORREO ?? ''
const clave = process.env.CAPTURAS_CLAVE ?? ''
if (!correo || !clave) {
  console.error('✗ Faltan CAPTURAS_CORREO o CAPTURAS_CLAVE (los secretos CAPTURAS_CASA_LOLA_CORREO y CAPTURAS_CASA_LOLA_CLAVE).')
  process.exit(1)
}

export const PANTALLAS = [
  { nombre: '1-inicio', ruta: '/conta/inicio', titulo: 'Inicio' },
  { nombre: '2-compras', ruta: '/conta/compras', titulo: 'Compras' },
  { nombre: '3-bancos', ruta: '/conta/bancos', titulo: 'Bancos' },
  { nombre: '4-impuestos', ruta: '/conta/impuestos', titulo: 'Impuestos' },
  { nombre: '5-pagos', ruta: '/conta/compras/pagos', titulo: 'Pagos' },
]
const PROHIBIDO = /llorente29|foodint/i

mkdirSync(DIR, { recursive: true })
const navegador = await chromium.launch()
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid' })
pagina.setDefaultTimeout(30_000)
let fallo = null
try {
  await pagina.goto(`${URL}/`, { waitUntil: 'networkidle' })
  await pagina.locator('input[type="email"]').fill(correo)
  await pagina.locator('input[type="password"]').fill(clave)
  await pagina.getByRole('button', { name: 'Entrar', exact: true }).click()
  await pagina.waitForURL(/\/conta\//, { timeout: 45_000 })
  for (const p of PANTALLAS) {
    await pagina.goto(`${URL}${p.ruta}`, { waitUntil: 'networkidle' })
    // Lo que se lee después de cargar: sin «Cargando…» a la vista.
    await pagina.waitForFunction(() => !/Cargando…|Leyendo…/.test(document.body.innerText), null, { timeout: 45_000 }).catch(() => {})
    await pagina.waitForTimeout(1500)
    await pagina.evaluate(() => document.fonts.ready)
    // Los correos no cuentan para la guarda (el del propio usuario de capturas lleva «foodint» en el buzón de
    // Julio) y en la imagen van tapados: la guía no lleva ningún correo.
    const texto = (await pagina.evaluate(() => document.body.innerText)).replace(/[^\s@]+@[^\s@]+/g, '')
    if (/NO ES PRODUCCIÓN/.test(texto)) throw new Error(`«${p.titulo}» lleva la banda de pruebas: esto no es producción.`)
    if (PROHIBIDO.test(texto)) throw new Error(`«${p.titulo}» enseña Llorente29 o Foodint: no se guarda ninguna captura.`)
    if (!/Casa Lola/.test(texto)) throw new Error(`«${p.titulo}» no dice Casa Lola: la empresa abierta no es la de la demo.`)
    await pagina.screenshot({ path: `${DIR}/${p.nombre}.png`, fullPage: true, mask: [pagina.getByText(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)], maskColor: '#E9E6DF' })
    console.log(`✓ ${p.titulo} (${p.ruta})`)
  }
} catch (e) {
  fallo = e instanceof Error ? e.message : String(e)
} finally {
  await navegador.close()
}
if (fallo) {
  // Lo que se haya guardado antes del fallo no vale: puede ser de otra empresa.
  const { rmSync } = await import('node:fs')
  rmSync(DIR, { recursive: true, force: true })
  console.error(`✗ ${fallo}`)
  process.exit(1)
}
console.log(`Capturas en ${DIR}: ${PANTALLAS.length}.`)
