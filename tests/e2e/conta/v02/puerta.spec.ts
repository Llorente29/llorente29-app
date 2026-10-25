// tests/e2e/conta/v02/puerta.spec.ts
//
// V02 · Entrega 1 · La puerta: Inicio › Documentos (tablero 19), en el
// ordenador y en el móvil.
//
// La base de la puerta (20261025T1212_v02_puerta) es «cambia»: staging la ensaya
// en ROLLBACK desde la rama y no la tiene hasta que esté en producción y se
// fusione (W04). Por eso lo que la pantalla LEE de sus funciones nuevas
// (conta_puerta y conta_puerta_fuentes) y lo que ESCRIBE con ellas se simula
// aquí, con las fuentes de verdad de Foodint medidas el 25/10 (Xfera el 22,
// Uber cada domingo, Glovo quincenal sin nada desde el 30/06, la quincena de
// Catcher y los alquileres de un local, sin nombres de personas). Todo lo
// demás (la sesión, el marco, la barra, las migas, Bancos) es staging de verdad.
// Las funciones las prueba entera su prueba de staging, en su transacción.
//
//   1. Cuenta A (hostelería): las cuatro cifras, «Lo que falta» con el local de
//      los alquileres en una fila, las pestañas, «Dime qué es» (dice lo que ha
//      hecho), «Pedírsela» con el correo propuesto y «Cómo te llegan».
//   2. Cuenta D (sin hostelería, otra actividad): una papelería con Stripe y
//      Amazon; subir por la puerta enseña el camino de cada fichero, y soltar un
//      fichero en OTRA pantalla abre la puerta con él.
// Las capturas, en docs/conta/capturas/v02 (van al artefacto del run).

import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, CUENTA_D, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/v02'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

/**
 * La captura AL LADO de su tablero (encargo: «capturas de cada pantalla al lado
 * de su tablero»): el tablero 19 aprobado a la izquierda y la pantalla de
 * verdad a la derecha, en una sola imagen del artefacto.
 */
async function alLado(page: Page, nombre: string) {
  const l = lado(page)
  const pantalla = await page.screenshot({ fullPage: true })
  const tablero = readFileSync(`docs/conta/v02/tableros/entrada-${l}.png`)
  const ancho = l === 'movil' ? 390 : 1440
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">Tablero 19 (aprobado)</figcaption><img style="width:100%" src="data:image/png;base64,${tablero.toString('base64')}"></figure>
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">La pantalla (staging)</figcaption><img style="width:100%" src="data:image/png;base64,${pantalla.toString('base64')}"></figure>
    </div></body>`)
  await otra.screenshot({ path: `${DIR}/al-lado-${nombre}-${l}.png`, fullPage: true })
  // Solo en esta pasada: la pantalla, pequeña y en el registro, para revisarla sin bajar el artefacto.
  const chica = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 35, scale: 'css' })
  const b64 = chica.toString('base64')
  for (let i = 0; i < b64.length; i += 3000) console.log(`CAPTURA ${nombre}-${l} ${i / 3000} ${b64.slice(i, i + 3000)}`)
  await otra.close()
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

// ── Lo simulado: fechas relativas a hoy, para que «tarde» y «a tiempo» no caduquen ──
const hoy = () => new Date().toISOString().slice(0, 10)
const dias = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString()
const fuente = (o: Record<string, unknown>) => ({ grupo: null, proveedor_id: null, dia: null, dia_semana: null, cada: null, margen: null, activa: true, origen: 'propuesta', cubierta: false, llegadas: [], pedida: null, ...o })

/** Hostelería (A): las fuentes de Foodint, con sus llegadas en la misma forma que el 25/10. */
function fuentesHosteleria() {
  const diaHoy = Number(hoy().slice(8, 10))
  const mensualDe = (dia: number, meses: number) => Array.from({ length: meses }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i - 1); d.setUTCDate(dia); return d.toISOString().slice(0, 10) })
  return {
    ajustes: { lo_que_falta: true, margen: 5 },
    fuentes: [
      // Una factura mensual que llega dentro de 3 días: aún a tiempo.
      fuente({ id: 'f-xfera', tipo: 'proveedor', nombre: 'Xfera', cadencia: 'mensual', dia: Math.min(28, diaHoy + 3), llegadas: mensualDe(Math.min(28, diaHoy + 3), 4) }),
      // Glovo: quincenal y nada en meses (falta importar el histórico): tarde.
      fuente({ id: 'f-glovo', tipo: 'intermediario', nombre: 'Glovo', cadencia: 'quincenal', dia: 0, llegadas: [dias(-140), dias(-125), dias(-110)] }),
      // Los alquileres de un local: tres fuentes, una fila, sin nombres; una no ha llegado.
      ...[1, 2, 3].map((i) => fuente({ id: `f-alq${i}`, tipo: 'alquiler', nombre: `Propietaria ${i}`, grupo: 'Alquiler · Cañaveral 75', cadencia: 'mensual', dia: 1,
        llegadas: i === 3 ? mensualDe(1, 4).slice(1) : mensualDe(1, 4) })),
    ],
  }
}
function puertaHosteleria() {
  return {
    direcciones: [{ tipo: 'documentos', direccion: 'taberna-de-prueba-norte@entrada.folvy.app', activa: true }],
    conectados: { bancos: [{ proveedor: 'BBVA ···4417', estado: 'activo', ultima: hace(20) }], uber_por_correo: true },
    ultimos: [
      { id: 'u1', fuente: 'liquidacion', cuando: hace(2), por: 'correo', que: 'liquidacion', de: 'Uber Eats · semana', importe: 1842.3, estado: 'colocado', donde: 'liquidaciones' },
      { id: 'u2', fuente: 'bandeja', cuando: hace(3), por: 'correo', que: 'factura', que_por: 'lectura', de: 'Uber Eats · comisión', importe: 612.08, estado: 'factura', donde: 'factura', factura_id: null },
      { id: 'u3', fuente: 'bandeja', cuando: hace(20), por: 'subido', que: 'ticket', que_por: 'persona', de: 'Ferretería', importe: 23.4, estado: 'factura', donde: 'factura', factura_id: null },
      { id: 'u4', fuente: 'extracto', cuando: hace(26), por: 'conexion', que: 'extracto', de: 'BBVA ···4417 · 31 mov.', importe: null, estado: 'colocado', donde: 'bancos' },
      { id: 'u5', fuente: 'bandeja', cuando: hace(27), por: 'correo', que: null, de: 'Gestoría de prueba <laboral@gestoria.test>', importe: null, estado: 'no_es_factura', donde: null, nombre: 'documento_scan_0231.pdf' },
    ],
  }
}
/** Otra actividad (D): una papelería con datáfono, Stripe y Amazon. */
function fuentesPapeleria() {
  return {
    ajustes: { lo_que_falta: true, margen: 5 },
    fuentes: [
      fuente({ id: 'p-stripe', tipo: 'intermediario', nombre: 'Stripe', cadencia: 'semanal', dia_semana: 1, margen: 2, llegadas: [dias(-28), dias(-21), dias(-14)] }),
      fuente({ id: 'p-amazon', tipo: 'intermediario', nombre: 'Amazon', cadencia: 'quincenal', dia: 3, llegadas: [dias(-40), dias(-25)] }),
      fuente({ id: 'p-papel', tipo: 'proveedor', nombre: 'Distribuidora de papel', cadencia: 'mensual', dia: 10, llegadas: [dias(-80), dias(-50), dias(-20)] }),
    ],
  }
}
function puertaPapeleria() {
  return {
    direcciones: [],
    conectados: { bancos: [], uber_por_correo: false },
    ultimos: [
      { id: 'd1', fuente: 'bandeja', cuando: hace(5), por: 'correo', que: 'factura', que_por: 'lectura', de: 'Distribuidora de papel', importe: 318.6, estado: 'factura', donde: 'factura', factura_id: null },
      { id: 'd2', fuente: 'extracto', cuando: hace(30), por: 'subido', que: 'extracto', de: 'Banco · 54 mov.', importe: null, estado: 'colocado', donde: 'bancos' },
    ],
  }
}

/** Simula las funciones de la puerta (solo esas: lo demás es staging). Devuelve lo que se ha llamado. */
async function simular(page: Page, datos: { puerta: unknown; fuentes: unknown }): Promise<{ llamadas: { f: string; cuerpo: unknown }[] }> {
  const llamadas: { f: string; cuerpo: unknown }[] = []
  const responder = (cuerpo: unknown) => (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  await page.route(/\/rest\/v1\/rpc\/conta_puerta(\?|$)/, responder(datos.puerta))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_fuentes(\?|$)/, responder(datos.fuentes))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_dime_que_es(\?|$)/, (r) => {
    llamadas.push({ f: 'dime', cuerpo: r.request().postDataJSON() })
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ texto: 'Apuntado: es una nómina. Lo que llegue de ese remitente irá igual.' }) })
  })
  return { llamadas }
}

test('la puerta de una empresa de hostelería: cifras, lo que falta, lo último y «Dime qué es»', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const { llamadas } = await simular(page, { puerta: puertaHosteleria(), fuentes: fuentesHosteleria() })
  await page.goto('/conta/inicio/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Inicio', 'Documentos'])
  // Las cuatro cifras.
  for (const c of ['Ha llegado esta semana', 'Necesita que lo mires', 'Falta y ya debería estar', 'Por llegar este mes']) await expect(page.locator('.cxp-cifra-etiqueta', { hasText: c })).toBeVisible()
  await expect(page.locator('.cxp-cifra', { hasText: 'Necesita que lo mires' }).locator('.cxp-cifra-valor')).toHaveText('1')
  await expect(page.locator('.cxp-cifra', { hasText: 'Falta y ya debería estar' }).locator('.cxp-cifra-valor')).toHaveText('2')
  // «Lo que falta»: el local de los alquileres en UNA fila, sin nombres; Glovo tarde; Xfera aún a tiempo.
  const falta = page.getByRole('region', { name: 'Lo que falta' })
  await expect(falta.getByText('Alquiler · Cañaveral 75')).toHaveCount(1)
  await expect(falta.getByText(/\(3 facturas\)/)).toBeVisible()
  await expect(falta.getByText(/Propietaria/)).toHaveCount(0)
  await expect(falta.getByText('Glovo')).toBeVisible()
  await expect(falta.getByText(/días? tarde/).first()).toBeVisible()
  await expect(falta.getByText('Aún a tiempo').first()).toBeVisible()
  // Lo último, con sus pestañas.
  const pestanas = page.getByRole('tablist', { name: 'Lo que ha llegado' })
  for (const p of ['Lo último', 'Necesita que lo mires', 'Colocado']) await expect(pestanas.getByRole('tab', { name: new RegExp(`^${p}`) })).toBeVisible()
  await expect(page.getByText('No sé qué es')).toBeVisible()
  // Cómo te llegan: la dirección única.
  await expect(page.getByText('taberna-de-prueba-norte@entrada.folvy.app')).toBeVisible()
  await foto(page, 'puerta')
  await alLado(page, 'puerta')

  // «Dime qué es»: se elige, se apunta y lo dice (regla 8), recordando el remitente.
  await pestanas.getByRole('tab', { name: /^Necesita que lo mires/ }).click()
  await page.getByRole('button', { name: 'Dime qué es' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Dime qué es' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel('Nómina').check()
  await expect(dialogo.getByLabel(/igual la próxima vez/)).toBeChecked()
  await foto(page, 'dime-que-es')
  await dialogo.getByRole('button', { name: 'Apuntarlo' }).click()
  await expect(page.locator('[data-prueba="puerta-aviso"]')).toHaveText('Apuntado: es una nómina. Lo que llegue de ese remitente irá igual.')
  expect(llamadas).toEqual([{ f: 'dime', cuerpo: expect.objectContaining({ p_inbox: 'u5', p_tipo: 'nomina', p_recordar: true }) }])

  // «Pedírsela»: el correo propuesto, para revisarlo (aquí no se manda).
  await page.getByRole('button', { name: 'Pedírsela' }).first().click()
  const pedir = page.getByRole('dialog', { name: /^Pedírsela a / })
  await expect(pedir).toBeVisible()
  await expect(pedir.getByLabel('Texto')).toHaveValue(/No nos ha llegado todavía/)
  await expect(pedir.getByLabel('Texto')).toHaveValue(/taberna-de-prueba-norte@entrada\.folvy\.app/)
  await foto(page, 'pedirsela')
  await pedir.getByRole('button', { name: 'Cancelar' }).click()
  expect(errores).toEqual([])
})

test('otra actividad (sin hostelería): la papelería, subir por la puerta y soltar en cualquier pantalla', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_D.email)
  await simular(page, { puerta: puertaPapeleria(), fuentes: fuentesPapeleria() })
  await page.goto('/conta/inicio/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible({ timeout: 30_000 })
  const falta = page.getByRole('region', { name: 'Lo que falta' })
  await expect(falta.getByText('Stripe')).toBeVisible()
  await expect(falta.getByText(/Uber|Glovo|Catcher|riders/i)).toHaveCount(0)
  // Sin dirección todavía: se puede crear desde aquí.
  await expect(page.getByRole('button', { name: 'Crear tu dirección' })).toBeVisible()
  await foto(page, 'puerta-papeleria')
  await alLado(page, 'puerta-papeleria')

  // Subir por la puerta: cada fichero, su camino (aquí no se sube nada: solo se enseña).
  await page.getByLabel('Elegir los documentos').setInputFiles([
    { name: 'Factura F-77.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prueba') },
    { name: 'Extracto movimientos octubre.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK prueba') },
    { name: 'contrato.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK prueba') },
  ])
  const grupos = page.locator('[data-prueba="puerta-grupos"]')
  await expect(grupos.getByText('Una factura o ticket: se lee y va a Compras › Facturas recibidas.')).toBeVisible()
  await expect(grupos.getByText('Un extracto del banco: se importa en Bancos.')).toBeVisible()
  await expect(grupos.getByText('Uno que no sé qué es: se guarda aquí y me lo dices.')).toBeVisible()
  await foto(page, 'subir')

  if (lado(page) === 'ordenador') {
    // Soltar un fichero en OTRA pantalla (Ventas › Facturas) abre la puerta con él.
    await page.goto('/conta/ventas/facturas')
    await expect(page.getByRole('heading', { level: 1, name: 'Facturas' })).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['%PDF-1.4 prueba'], 'ticket-gasolinera.pdf', { type: 'application/pdf' }))
      document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expect(page).toHaveURL(/\/conta\/inicio\/documentos$/, { timeout: 15_000 })
    await expect(page.locator('[data-prueba="puerta-grupos"]').getByText(/ticket-gasolinera\.pdf/)).toBeVisible()
  }
  expect(errores).toEqual([])
})
