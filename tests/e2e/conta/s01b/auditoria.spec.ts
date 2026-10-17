/// <reference lib="dom" />
// tests/e2e/conta/s01b/auditoria.spec.ts
//
// S01b · AUDITORÍA DE NAVEGACIÓN (18/10). SOLO MIRA: no comprueba nada que
// pueda fallar; apunta lo que ve en líneas «AUDITORIA|{json}» del log y saca
// una captura de cada pantalla (docs/conta/capturas/s01b). La rama de la
// auditoría no se fusiona: es la manera de recorrer staging-conta, que desde
// el contenedor de desarrollo no se alcanza.
//
// Recorre TODAS las pantallas a las que se llega desde la barra, la cabecera
// (pestañas) y la cinta (el catálogo de productos.ts y ordenes.ts), con las
// cuentas A (hostelería) y B (Canarias), en ordenador (1440) y móvil (390).
// En cada una apunta:
//   · errores de la página y peticiones a la base que fallan;
//   · pantalla vacía o de error;
//   · textos que se cortan, se salen del ancho, se parten en la barra o se pisan;
//   · contradicciones («No cuadra» y «Cuadra» a la vez);
//   · palabras de informático a la vista;
//   · en ordenador y con A, cada botón y enlace de la pantalla y de la cinta:
//     si al pulsarlo no pasa nada (ni dirección, ni diálogo, ni cambio, ni
//     petición, ni fichero) es un punto muerto; si lleva a una pantalla vacía
//     o de error, también. Lo que escribe o borra NO se pulsa (lista abajo).
// Las cuentas son las del carril: copias de las de prueba que se borran al
// acabar. Nada real.

import { test, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'
import { PRODUCTOS } from '@/modules/conta/esqueleto/productos'
import { ORDENES } from '@/modules/conta/esqueleto/ordenes'

const DIR = 'docs/conta/capturas/s01b'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** Cada dirección una vez, con de dónde sale (pestaña u orden). */
function pantallas(): { ruta: string; de: string }[] {
  const m = new Map<string, string[]>()
  const poner = (ruta: string | null, de: string) => { if (!ruta) return; const l = m.get(ruta) ?? []; l.push(de); m.set(ruta, l) }
  for (const p of PRODUCTOS) {
    poner(p.ruta, `barra · ${p.etiqueta}`)
    for (const t of p.pestanas) poner(t.ruta, `pestaña · ${p.etiqueta} › ${t.etiqueta}${t.solo ? ` (solo ${t.solo})` : ''}`)
  }
  for (const o of ORDENES) if ('ruta' in o.a) poner(o.a.ruta, `cinta · ${o.etiqueta}${o.solo ? ` (solo ${o.solo})` : ''}`)
  return [...m].map(([ruta, de]) => ({ ruta, de: [...new Set(de)].join(' / ') }))
}

const NO_PULSAR = /borrar|eliminar|quitar|anular|descartar|no es una factura|enviar|presentar|validar|aprobar|contabilizar|guardar|confirmar|aplicar|cerrar (el |este )?(ejercicio|mes|periodo)|reabrir|deshacer|cerrar sesi|salir|desactivar|apagar|encender|importar|traer|pagar|cobrar|generar|archivar|contraseña|activar|regenerar|recalcular|casar|separar|asignar|marcar|rechazar|aceptar|sí,|repetir|reintentar|crear la|dar de alta|lanzar|ejecutar|sincronizar|conectar|desconectar/i
const JERGA = /\b(null|undefined|NaN|uuid|UUID|RPC|rpc|PGRST\d*|SQL|jsonb?|payload|endpoint|token|query|flag|feature|staging|debug|timestamp|stack|exception|42\d{3}|23\d{3}|P000\d|supabase|edge function|row|schema|bucket|source_id|account_id|company_id)\b/

function apuntar(o: Record<string, unknown>) { console.log(`AUDITORIA|${JSON.stringify(o)}`) }

const slug = (s: string) => s.replace(/[?=&]/g, '_').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'raiz'

/** Lo que se ve mal en la pantalla, medido en el navegador. */
async function mirar(page: Page): Promise<{ tipo: string; detalle: string }[]> {
  return page.evaluate((jergaSrc) => {
    const jerga = new RegExp(jergaSrc)
    const out: { tipo: string; detalle: string }[] = []
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 }
    const nombre = (el: Element) => ((el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70))
    const donde = (el: Element) => { const z = el.closest('nav,header,main,[role=toolbar],[role=dialog],aside'); return z ? (z.getAttribute('aria-label') || z.tagName.toLowerCase()) : 'página' }
    const W = window.innerWidth
    if (document.documentElement.scrollWidth > W + 1) out.push({ tipo: 'se sale del ancho', detalle: `la página mide ${document.documentElement.scrollWidth} px de ancho (pantalla ${W})` })
    const todos = Array.from(document.querySelectorAll('header *, nav *, main *, aside *, [role=toolbar] *, [role=dialog] *')).filter(visible)
    const vistos = new Set<string>()
    for (const el of todos) {
      const txt = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim()
      if (!txt) continue
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const k = `${donde(el)}|${txt.slice(0, 40)}`
      if (vistos.has(k)) continue
      if ((s.overflowX === 'hidden' || s.overflowX === 'clip' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) { vistos.add(k); out.push({ tipo: 'texto cortado', detalle: `${donde(el)}: «${txt.slice(0, 60)}» (${el.scrollWidth} px en ${el.clientWidth})` }) }
      else if (r.right > W + 1 && s.position !== 'fixed') { vistos.add(k); out.push({ tipo: 'se sale del ancho', detalle: `${donde(el)}: «${txt.slice(0, 60)}» acaba en ${Math.round(r.right)} px (pantalla ${W})` }) }
    }
    // Lo que debería ir en una línea y se parte: la barra, las pestañas, los chips, las cabeceras de tabla y los botones de la cabecera.
    for (const el of Array.from(document.querySelectorAll('nav a, nav button, .s-chip, th, header button, [role=tab]')).filter(visible)) {
      const t = nombre(el)
      if (!t || !/\s/.test(t) || t.length > 40) continue
      const s = getComputedStyle(el)
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.3
      const lineas = Array.from(el.querySelectorAll('*')).concat([el]).filter((x) => Array.from(x.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 2))
      for (const x of lineas) {
        const rr = document.createRange(); rr.selectNodeContents(x)
        const filas = new Set(Array.from(rr.getClientRects()).map((q) => Math.round(q.top))).size
        if (filas > 1 && x.getBoundingClientRect().height > lh * 1.6) { out.push({ tipo: 'se parte en dos líneas', detalle: `${donde(el)}: «${t}»` }); break }
      }
    }
    // Lo que se pisa: una casilla o un botón de radio con un texto encima.
    for (const c of Array.from(document.querySelectorAll('input[type=checkbox], input[type=radio]')).filter(visible)) {
      const rc = c.getBoundingClientRect()
      for (const t of Array.from(document.querySelectorAll('label, span, p')).filter(visible)) {
        if (t.contains(c) || c.contains(t)) continue
        const rt = t.getBoundingClientRect()
        const solapa = Math.min(rc.right, rt.right) - Math.max(rc.left, rt.left) > 2 && Math.min(rc.bottom, rt.bottom) - Math.max(rc.top, rt.top) > 2
        if (solapa && nombre(t)) { out.push({ tipo: 'se pisan', detalle: `${donde(c)}: la casilla y «${nombre(t)}»` }); break }
      }
    }
    const texto = document.body.innerText
    if (/No cuadra/.test(texto) && /(^|[^o] )Cuadra\b|^Cuadra|· Cuadra|Cuadra ·/m.test(texto)) out.push({ tipo: 'contradicción', detalle: '«No cuadra» y «Cuadra» a la vez' })
    const j = texto.match(new RegExp(jerga.source, 'g'))
    if (j) out.push({ tipo: 'palabra de informático', detalle: [...new Set(j)].slice(0, 8).join(', ') })
    const main = document.querySelector('main')
    const tm = (main as HTMLElement | null)?.innerText.trim() ?? ''
    if (!main) out.push({ tipo: 'sin pantalla', detalle: 'no hay <main>' })
    else if (tm.length < 15) out.push({ tipo: 'pantalla vacía', detalle: `«${tm}»` })
    const err = tm.match(/(No se ha podido[^\n]{0,100}|No he podido[^\n]{0,100}|Algo ha (ido|salido) mal[^\n]{0,80}|Página no encontrada|no existe[^\n]{0,60}|Error[^\n]{0,100})/)
    if (err) out.push({ tipo: 'error en pantalla', detalle: err[0] })
    return out
  }, JERGA.source)
}

async function cargada(page: Page) {
  await page.locator('.cx-hueso').first().waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(600)
}

/** Pulsa cada botón y enlace de la pantalla y de la cinta (lo que no escribe), y apunta los puntos muertos. */
async function pulsarTodo(page: Page, cuenta: string, ruta: string) {
  const origen = page.url()
  const zona = 'main, [role=toolbar]'
  const candidatos: { nombre: string; tipo: string }[] = await page.locator(`${zona.split(', ').map((z) => `${z} button, ${z} a[href], ${z} [role=button]`).join(', ')}`).evaluateAll((els) => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const out: { nombre: string; tipo: string }[] = []
    const vistos = new Set<string>()
    for (const el of els) {
      if (!vis(el) || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue
      const n = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ')
      if (!n || vistos.has(n)) continue
      vistos.add(n)
      out.push({ nombre: n.slice(0, 80), tipo: el.tagName === 'A' ? 'enlace' : 'botón' })
    }
    return out
  })
  let pulsados = 0
  for (const c of candidatos) {
    if (NO_PULSAR.test(c.nombre)) { apuntar({ cuenta, ruta, tipo: 'no pulsado (escribiría)', detalle: `${c.tipo} «${c.nombre}»` }); continue }
    if (pulsados >= 10) { apuntar({ cuenta, ruta, tipo: 'no pulsado (tope)', detalle: `${c.tipo} «${c.nombre}»` }); continue }
    pulsados++
    if (page.url() !== origen) { await page.goto(origen); await cargada(page) }
    const el = page.locator(`main, [role=toolbar]`).getByRole(c.tipo === 'enlace' ? 'link' : 'button', { name: c.nombre, exact: true }).first()
    if (!(await el.isVisible().catch(() => false))) continue
    const antes = { url: page.url(), html: await page.locator('main').innerHTML().catch(() => '') }
    let peticiones = 0
    let fichero = false
    const alPedir = () => { peticiones++ }
    const alFichero = () => { fichero = true }
    page.on('request', alPedir)
    page.on('filechooser', alFichero)
    page.on('download', alFichero)
    const nuevas: Page[] = []
    const alAbrir = (p: Page) => { nuevas.push(p) }
    page.context().on('page', alAbrir)
    try {
      await el.click({ timeout: 4_000 })
    } catch (e) {
      apuntar({ cuenta, ruta, tipo: 'no se puede pulsar', detalle: `${c.tipo} «${c.nombre}»: ${(e as Error).message.split('\n')[0].slice(0, 120)}` })
    }
    await page.waitForTimeout(1_000)
    page.off('request', alPedir); page.off('filechooser', alFichero); page.off('download', alFichero); page.context().off('page', alAbrir)
    const despues = { url: page.url(), html: await page.locator('main').innerHTML().catch(() => '') }
    const dialogo = await page.getByRole('dialog').count()
    const cambia = despues.url !== antes.url || despues.html !== antes.html || dialogo > 0 || peticiones > 0 || fichero || nuevas.length > 0
    if (!cambia) apuntar({ cuenta, ruta, tipo: 'punto muerto', detalle: `${c.tipo} «${c.nombre}»: al pulsarlo no pasa nada` })
    for (const p of nuevas) await p.close().catch(() => {})
    if (despues.url !== antes.url) {
      await cargada(page)
      const mal = (await mirar(page)).filter((h) => ['pantalla vacía', 'error en pantalla', 'sin pantalla'].includes(h.tipo))
      for (const h of mal) apuntar({ cuenta, ruta, tipo: `lleva a ${h.tipo}`, detalle: `${c.tipo} «${c.nombre}» → ${new URL(despues.url).pathname}${new URL(despues.url).search}: ${h.detalle}` })
    }
    if (dialogo > 0) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300) }
  }
}

// En un push solo corre el juego común: la auditoría se lanza a mano (pruebas=tests/e2e/conta/s01b, fijar_capturas).
test.skip(process.env.GITHUB_EVENT_NAME === 'push', 'la auditoría se lanza a mano')

const CUENTAS = [{ letra: 'A', email: CUENTA_A.email }, { letra: 'B', email: CUENTA_B.email }]

for (const cuenta of CUENTAS) {
  test.describe(`cuenta ${cuenta.letra}`, () => {
    for (const { ruta, de } of pantallas()) {
      test(`${cuenta.letra} · /conta/${ruta}`, async ({ page }) => {
        test.setTimeout(150_000)
        const errores: string[] = []
        const red: string[] = []
        page.on('pageerror', (e) => errores.push(e.message.slice(0, 160)))
        page.on('response', (r) => { if (r.status() >= 400 && /supabase\.co|\/functions\//.test(r.url())) red.push(`${r.status()} ${new URL(r.url()).pathname}`) })
        await entrarComo(page, cuenta.email)
        await page.goto(`/conta/${ruta}`)
        await cargada(page)
        const donde = `${new URL(page.url()).pathname}${new URL(page.url()).search}`
        apuntar({ cuenta: cuenta.letra, lado: lado(page), ruta, tipo: 'pantalla', detalle: `${de} → ${donde} · «${(await page.title()).slice(0, 60)}»` })
        if (donde !== `/conta/${ruta}`.replace(/\?$/, '') && !donde.startsWith(`/conta/${ruta.split('?')[0]}`)) apuntar({ cuenta: cuenta.letra, lado: lado(page), ruta, tipo: 'redirige', detalle: `a ${donde}` })
        for (const h of await mirar(page)) apuntar({ cuenta: cuenta.letra, lado: lado(page), ruta, ...h })
        await page.screenshot({ path: `${DIR}/${cuenta.letra}-${slug(ruta)}-${lado(page)}.jpg`, type: 'jpeg', quality: 55 })
        if (cuenta.letra === 'A' && lado(page) === 'ordenador') await pulsarTodo(page, cuenta.letra, ruta)
        for (const e of [...new Set(errores)]) apuntar({ cuenta: cuenta.letra, lado: lado(page), ruta, tipo: 'error de la página', detalle: e })
        for (const r of [...new Set(red)]) apuntar({ cuenta: cuenta.letra, lado: lado(page), ruta, tipo: 'petición que falla', detalle: r })
      })
    }
  })
}

// La barra y la cabecera, por separado: cada entrada de la barra (ancho,
// líneas, contador) y el logo (cuántas veces sale y cuál).
test('A · la barra, la cabecera y el logo', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto('/conta/inicio')
  await cargada(page)
  const datos = await page.evaluate(() => {
    const barra = document.querySelector('nav[aria-label="Menú de contabilidad"]')
    const rb = barra?.getBoundingClientRect()
    const entradas = Array.from(barra?.querySelectorAll('a, button') ?? []).map((a) => {
      const r = a.getBoundingClientRect()
      return { texto: (a as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), ancho: Math.round(r.width), alto: Math.round(r.height), sobra: Math.round(r.right - (rb?.right ?? 0)), corta: a.scrollWidth > a.clientWidth + 1 }
    })
    const logos = Array.from(document.querySelectorAll('img, svg')).filter((x) => {
      const r = x.getBoundingClientRect(); if (r.width === 0) return false
      const t = `${x.getAttribute('alt') ?? ''} ${x.getAttribute('aria-label') ?? ''} ${(x as HTMLImageElement).src ?? ''} ${x.getAttribute('class') ?? ''}`
      return /sumied|folvy|logo|marca|isotipo|simbolo/i.test(t)
    }).map((x) => ({ que: `${x.tagName} ${x.getAttribute('alt') ?? x.getAttribute('aria-label') ?? ''} ${(x as HTMLImageElement).src ?? ''}`.trim().slice(0, 120), donde: x.closest('nav,header,aside')?.getAttribute('aria-label') ?? x.closest('nav,header,aside')?.tagName ?? 'otro' }))
    const cab = document.querySelector('header')?.getBoundingClientRect()
    return { anchoBarra: Math.round(rb?.width ?? 0), entradas, logos, altoCabecera: Math.round(cab?.height ?? 0) }
  })
  apuntar({ cuenta: 'A', lado: lado(page), ruta: 'inicio', tipo: 'barra', detalle: JSON.stringify(datos) })
  await page.screenshot({ path: `${DIR}/A-barra-${lado(page)}.jpg`, type: 'jpeg', quality: 70 })
})
