// tests/e2e/conta/v02/puerta.spec.ts
//
// V02d · Inicio › Documentos (tableros 22 y 24) y Qué esperas cada mes
// (tablero 23), en el ordenador y en el móvil. Sustituye a la e2e del tablero 19.
//
// La base de la tanda (20261025T1912_v02d_avisos) es «cambia»: staging la ensaya
// en ROLLBACK desde la rama y no la tiene hasta que esté en producción y se
// fusione (W04). Por eso lo que la pantalla LEE de las funciones de Documentos
// (conta_puerta, conta_puerta_fuentes y conta_puerta_al_dia) y lo que ESCRIBE
// con ellas se simula aquí, con la forma de las fuentes de Foodint medidas el
// 25/10 (alquileres de tres personas en un local, la gestoría con su correo,
// Glovo con su liquidación y su factura de comisiones, el banco sin conectar)
// y fechas relativas a hoy, para que «se retrasa» y «aún a tiempo» no caduquen.
// Las personas son inventadas. Todo lo demás (la sesión, el marco, las migas,
// el menú «Más») es staging de verdad. Las funciones las prueba su prueba de
// staging, en su transacción.
//
//   1. Cuenta A (hostelería) · Documentos: la banda del mes y «Pedir los N»
//      (dice que no ha mandado nada), «No sé qué es este documento», las dos
//      columnas sin personas, «Ver todo», «⋯ Ya lo tengo», «Pedir», «Tu
//      correo» y sin palabras de técnico (puerta, fuentes, aprender, margen).
//   2. Cuenta A · Qué esperas cada mes: desde «Más», las migas, los grupos con
//      su recuento, las personas (solo aquí), el local solo en alquileres y
//      suministros, encender lo apagado y «Guardar», que dice lo que ha hecho.
//   3. Cuenta D (sin hostelería): una papelería con Stripe y Amazon; subir
//      enseña el camino de cada fichero, y soltar un fichero en OTRA pantalla
//      abre Documentos con él.
// Las capturas, al lado de su tablero (docs/conta/v02/tableros), en el artefacto.

import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, CUENTA_D, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/v02'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

/**
 * La captura AL LADO de su tablero: el tablero aprobado a la izquierda y la
 * pantalla de verdad a la derecha, en una sola imagen del artefacto.
 */
async function alLado(page: Page, nombre: string, tablero: string, numero: number) {
  const l = lado(page)
  const pantalla = await page.screenshot({ fullPage: true })
  const imagen = readFileSync(`docs/conta/v02/tableros/${tablero}`)
  const ancho = l === 'movil' ? 390 : 1440
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px;overflow:hidden"><figcaption style="margin:0 0 8px">Tablero ${numero} (aprobado)</figcaption><img style="${l === 'movil' ? 'width:1440px;max-width:none' : 'width:100%'}" src="data:image/png;base64,${imagen.toString('base64')}"></figure>
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">La pantalla (staging)</figcaption><img style="width:100%" src="data:image/png;base64,${pantalla.toString('base64')}"></figure>
    </div></body>`)
  await otra.screenshot({ path: `${DIR}/al-lado-${nombre}-${l}.png`, fullPage: true })
  await otra.close()
}

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}

// ── Lo simulado: fechas relativas a hoy ──────────────────────────────────────
const dias = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString()
/** El mismo día de los meses de antes (1 = el mes pasado). */
const mensual = (dia: number, meses: number[]) => meses.map((i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); d.setUTCDate(dia); return d.toISOString().slice(0, 10) })
const fuente = (o: Record<string, unknown>) => ({
  grupo: null, proveedor_id: null, dia: null, dia_semana: null, cada: null, margen: null, activa: true, origen: 'aprendido', cubierta: false,
  llegadas: [], pedida: null, local: null, tocada: false, cubre: [], familia: 'proveedor', canal: null, correo: null, ...o,
})
const NORTE = { id: 'l-norte', nombre: 'Local Norte', direccion: 'Cañaveral, 75' }
const SUR = { id: 'l-sur', nombre: 'Local Sur', direccion: 'Camichi, 4' }
const GLOVO = { id: 'c-glovo', nombre: 'Glovo' }

/** Hostelería (A): la forma de las fuentes de Foodint del 25/10. */
function fuentesHosteleria() {
  const hoyDia = Number(dias(0).slice(8, 10))
  // Un día del mes que ya pasó hace más del margen (y no de más de un mes): «Se retrasa N días».
  const diaTarde = Math.max(1, hoyDia - 9)
  // Un día de hace 3 (dentro del margen): la de este mes aún no se pide; la del mes pasado, a más de 30 días.
  const diaReciente = hoyDia <= 3 ? 1 : hoyDia - 3
  return {
    ajustes: { lo_que_falta: true, margen: 5 },
    corte: '2026-01-01',
    locales: [{ ...NORTE, activo: true }, { ...SUR, activo: true }],
    fuentes: [
      // Tres personas, un local: una fila «Alquiler de Cañaveral 75»; la del mes no ha llegado de ninguna.
      ...['Lucía', 'Marta', 'Elena'].map((n, i) => fuente({ id: `f-alq${i}`, tipo: 'alquiler', familia: 'alquiler', nombre: `${n.toUpperCase()} PRIETO SANZ`, proveedor_id: `p-alq${i}`, local: NORTE, cadencia: 'mensual', dia: 1, tocada: true, llegadas: mensual(1, [1, 2, 3]) })),
      // La gestoría, con su correo, tarde.
      fuente({ id: 'f-nominas', tipo: 'nominas', familia: 'gestoria', nombre: 'Nóminas · Asesoría QBO', cadencia: 'mensual', dia: diaTarde, correo: 'nominas@asesoria.test', llegadas: mensual(diaTarde, [1, 2, 3]) }),
      // Un proveedor tarde (en mayúsculas, como lo deja el libro).
      fuente({ id: 'f-last', tipo: 'proveedor', nombre: 'LAST SYSTEMS S.L.', proveedor_id: 'p-last', cadencia: 'mensual', dia: diaTarde, llegadas: mensual(diaTarde, [1, 2, 3]) }),
      // Uno al que le falta la del mes pasado (la de este mes aún está en su margen): rojo, «Hace más de un mes».
      fuente({ id: 'f-viejo', tipo: 'proveedor', nombre: 'DISTRIBUCIONES DEL NORTE, S.L.', proveedor_id: 'p-viejo', cadencia: 'mensual', dia: diaReciente, llegadas: mensual(diaReciente, [2, 3, 4]) }),
      // Un suministro aún a tiempo.
      fuente({ id: 'f-xfera', tipo: 'proveedor', familia: 'suministro', nombre: 'XFERA MOVILES, S.A.U.', proveedor_id: 'p-xfera', cadencia: 'mensual', dia: Math.min(28, hoyDia + 3), llegadas: mensual(Math.min(28, hoyDia + 3), [1, 2, 3]) }),
      // Uno apagado que lleva meses sin llegar.
      fuente({ id: 'f-makro', tipo: 'proveedor', nombre: 'MAKRO AUTOSERVICIO MAYORISTA, S.A.U.', proveedor_id: 'p-makro', cadencia: 'mensual', dia: 10, activa: false, llegadas: mensual(10, [4, 5]) }),
      // Glovo: su liquidación y su factura de comisiones, una fila, tarde (nada desde hace tres quincenas).
      fuente({ id: 'f-glovo', tipo: 'intermediario', familia: 'plataforma', canal: GLOVO, nombre: 'Glovo · liquidaciones', cadencia: 'quincenal', dia: 0, llegadas: [dias(-55), dias(-40)] }),
      fuente({ id: 'f-glovo-fac', tipo: 'proveedor', familia: 'plataforma', canal: GLOVO, nombre: 'GLOVOAPP SPAIN PLATFORM', proveedor_id: 'p-glovo', cadencia: 'quincenal', dia: 0, llegadas: [dias(-55), dias(-40)] }),
      // El banco, sin conectar: la semana pasada, cubierta por el extracto subido; nada tarde.
      fuente({ id: 'f-banco', tipo: 'banco', familia: 'banco', nombre: 'Extracto · BBVA ···4417', cadencia: 'semanal', llegadas: [dias(-2)], cubre: [[dias(-30), dias(-2)]] }),
    ],
  }
}
function puertaHosteleria() {
  return {
    direcciones: [{ tipo: 'documentos', direccion: 'taberna-de-prueba-norte@entrada.folvy.app', activa: true }],
    conectados: { bancos: [], uber_por_correo: true },
    ultimos: [
      { id: 'n1', fuente: 'bandeja', cuando: hace(2), por: 'correo', que: null, de: 'info@talleresruiz.test', importe: null, estado: 'no_es_factura', donde: null, nombre: 'documento_scan_0231.pdf' },
      { id: 'u1', fuente: 'liquidacion', cuando: hace(20), por: 'correo', que: 'liquidacion', de: 'Uber Eats', importe: 1842.3, estado: 'colocado', donde: 'liquidaciones' },
      { id: 'u2', fuente: 'bandeja', cuando: hace(26), por: 'correo', que: 'factura', que_por: 'lectura', de: 'Uber Eats', importe: 612.08, estado: 'factura', donde: 'factura', factura_id: null },
      { id: 'x1', fuente: 'bandeja', cuando: hace(50), por: 'correo', que: 'factura', que_por: 'lectura', de: 'Xfera Móviles', importe: 48.35, estado: 'factura', donde: 'factura', factura_id: null },
      { id: 'b1', fuente: 'extracto', cuando: hace(60), por: 'subido', que: 'extracto', de: 'BBVA ···4417', importe: null, estado: 'colocado', donde: 'bancos' },
    ],
  }
}
/** Otra actividad (D): una papelería con datáfono, Stripe y Amazon. */
function fuentesPapeleria() {
  return {
    ajustes: { lo_que_falta: true, margen: 5 },
    corte: null,
    locales: [],
    fuentes: [
      fuente({ id: 'p-stripe', tipo: 'intermediario', familia: 'plataforma', canal: { id: 'c-stripe', nombre: 'Stripe' }, nombre: 'Stripe · liquidaciones', cadencia: 'semanal', dia_semana: 1, margen: 2, llegadas: [dias(-28), dias(-21), dias(-14)] }),
      fuente({ id: 'p-amazon', tipo: 'intermediario', familia: 'plataforma', canal: { id: 'c-amazon', nombre: 'Amazon' }, nombre: 'Amazon · liquidaciones', cadencia: 'quincenal', dia: 3, llegadas: [dias(-40), dias(-25)] }),
      fuente({ id: 'p-papel', tipo: 'proveedor', nombre: 'DISTRIBUIDORA DE PAPEL, S.L.', proveedor_id: 'p-pap', cadencia: 'mensual', dia: 10, llegadas: mensual(10, [1, 2, 3]) }),
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

/** Simula las funciones de Documentos (solo esas: lo demás es staging). Devuelve lo que se ha llamado. */
async function simular(page: Page, datos: { puerta: unknown; fuentes: unknown }): Promise<{ llamadas: { f: string; cuerpo: Record<string, unknown> }[] }> {
  const llamadas: { f: string; cuerpo: Record<string, unknown> }[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  const apuntar = (f: string, respuesta: unknown) => (r: Route) => { llamadas.push({ f, cuerpo: r.request().postDataJSON() }); return json(r, respuesta) }
  await page.route(/\/rest\/v1\/rpc\/conta_puerta(\?|$)/, (r) => json(r, datos.puerta))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_fuentes(\?|$)/, (r) => json(r, datos.fuentes))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_al_dia(\?|$)/, apuntar('al_dia', { nuevas: 0, reaprendidas: 0, dormidas: 0, despiertas: 0 }))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_dime_que_es(\?|$)/, apuntar('dime', { texto: 'Apuntado: es una nómina. Lo que llegue de ese remitente irá igual.' }))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_fuente_guardar(\?|$)/, apuntar('guardar', { id: 'x', nueva: false, activa: true, texto: 'Guardado.' }))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_ya_lo_tengo(\?|$)/, apuntar('ya', { id: 'r1', ya_estaba: false }))
  await page.route(/\/rest\/v1\/rpc\/conta_puerta_ajustes_poner(\?|$)/, apuntar('ajustes', { texto: 'ok' }))
  return { llamadas }
}

/** Las palabras de técnico que no salen en Documentos ni en su «Más» (encargo V02d, punto 6). */
const TECNICAS = /\b(puerta|fuentes?|aprend\w*|margen)\b/i

test('Documentos de una empresa de hostelería: el mes, lo que no sé qué es, las dos columnas y tu correo', async ({ page }) => {
  const errores = vigilar(page)
  const movil = lado(page) === 'movil'
  await entrarComo(page, CUENTA_A.email)
  const { llamadas } = await simular(page, { puerta: puertaHosteleria(), fuentes: fuentesHosteleria() })
  await page.goto('/conta/inicio/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Inicio', 'Documentos'])
  // Lo aprendido se pone al día solo, al abrir.
  await expect.poll(() => llamadas.some((x) => x.f === 'al_dia')).toBe(true)

  // La banda del mes, con su barra y su leyenda.
  const banda = page.locator('[data-prueba="banda-mes"]')
  await expect(banda).toBeVisible()
  await expect(banda.getByRole('heading', { level: 2 })).toHaveText(movil ? /^\d+ de \d+ documentos$/ : /^Tienes \d+ de \d+ documentos que esperas este mes$/)
  if (!movil) for (const t of ['ya están, en su sitio', 'se retrasan', 'aún a tiempo']) await expect(banda.getByRole('listitem').filter({ hasText: t })).toBeVisible()

  // «No sé qué es este documento»: cuatro botones y el remitente, marcado de serie.
  const noSe = page.locator('[data-prueba="no-se-que-es"]')
  await expect(noSe).toHaveCount(1)
  await expect(noSe.getByText('documento_scan_0231.pdf', { exact: false })).toBeVisible()
  for (const b of ['Factura de gasto', 'Extracto del banco', 'Nómina', 'Otra cosa']) await expect(noSe.getByRole('button', { name: b })).toBeVisible()
  await expect(noSe.getByLabel('Lo mismo la próxima vez que escriba este remitente')).toBeChecked()

  // Las dos columnas.
  const mandar = page.getByRole('region', { name: 'Te lo tienen que mandar' })
  const subir = page.getByRole('region', { name: 'Lo tienes que subir tú' })
  await expect(mandar.getByText('Alquiler de Cañaveral 75')).toHaveCount(1)
  await expect(mandar.getByText('Los 3 de', { exact: false })).toBeVisible()
  await expect(page.getByText(/Prieto|Lucía|Marta|Elena/)).toHaveCount(0)
  await expect(mandar.getByText('Se retrasa', { exact: false }).first()).toBeVisible()
  await expect(subir.getByText('Glovo', { exact: true })).toBeVisible()
  await expect(subir.getByText(/Liquidación del .* y su factura/)).toBeVisible()
  await expect(subir.getByRole('button', { name: 'Subirla' })).toBeVisible()
  // Se ven 3 y el resto detrás de «Ver todo»: nada se esconde.
  await expect(mandar.locator('[data-prueba="fila-doc"]')).toHaveCount(3)
  await expect(mandar.getByText(/^Y \d+ más/)).toBeVisible()
  await mandar.getByRole('button', { name: 'Ver todo' }).click()
  await expect(mandar.getByText('Hace más de un mes')).toBeVisible()
  await expect(mandar.getByText('Distribuciones del Norte')).toBeVisible()
  await expect(mandar.getByText('Xfera Móviles')).toBeVisible()
  await expect(mandar.getByText('Aún a tiempo')).toBeVisible()
  await mandar.getByRole('button', { name: 'Ver menos' }).click()
  if (!movil) {
    // El truco del banco sin conectar; tu correo, con sus tres marcas.
    await expect(subir.getByText('conecta el banco', { exact: false })).toBeVisible()
    const correo = page.getByRole('region', { name: 'Tu correo de documentos' })
    await expect(correo.getByText('taberna-de-prueba-norte@entrada.folvy.app')).toBeVisible()
    await expect(correo.getByText('Uber Eats manda solo sus liquidaciones')).toBeVisible()
    await expect(correo.getByText('Arrastra un fichero a cualquier pantalla')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Ha llegado esta semana' }).getByText('en Liquidaciones', { exact: false })).toBeVisible()
  } else {
    await expect(page.getByRole('button', { name: 'Hacer foto o subir' })).toBeVisible()
  }
  // Sin palabras de técnico, ni en la pantalla ni en su «Más».
  expect(await page.locator('.cxdo').innerText()).not.toMatch(TECNICAS)
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click()
  const mas = page.getByRole('group', { name: 'Más acciones' }).getByRole('group', { name: 'Documentos' })
  await expect(mas.getByRole('button', { name: /^Qué esperas cada mes/ })).toBeVisible()
  expect(await mas.innerText()).not.toMatch(TECNICAS)
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click()
  await foto(page, 'documentos')
  await alLado(page, 'documentos', `documentos-${lado(page)}.png`, movil ? 24 : 22)

  // «Pedir los N que se retrasan»: el envío automático está cerrado y lo dice; no hace como que envía.
  await banda.getByRole('button', { name: /^Pedir (los \d+ que se retrasan|el que se retrasa)$/ }).click()
  await expect(page.locator('[data-prueba="puerta-aviso"]')).toContainText('no he mandado nada')
  expect(llamadas.some((x) => x.f === 'pedir')).toBe(false)

  // «Nómina» en lo que no sé qué es: se apunta, recordando el remitente, y lo dice (regla 8).
  await noSe.getByRole('button', { name: 'Nómina' }).click()
  await expect(page.locator('[data-prueba="puerta-aviso"]')).toHaveText('Apuntado: es una nómina. Lo que llegue de ese remitente irá igual.')
  expect(llamadas.find((x) => x.f === 'dime')?.cuerpo).toMatchObject({ p_inbox: 'n1', p_tipo: 'nomina', p_recordar: true })

  // «Pedir» a la gestoría: el correo propuesto, a su dirección, para revisarlo (aquí no se manda).
  await mandar.locator('[data-prueba="fila-doc"]', { hasText: 'Asesoría QBO' }).getByRole('button', { name: 'Pedir' }).click()
  const pedir = page.getByRole('dialog', { name: 'Pedir · Asesoría QBO' })
  await expect(pedir).toBeVisible()
  await expect(pedir.getByLabel('A', { exact: true })).toHaveValue('nominas@asesoria.test')
  await expect(pedir.getByLabel('Texto')).toHaveValue(/No nos ha llegado todavía/)
  await foto(page, 'pedir')
  await pedir.getByRole('button', { name: 'Cancelar' }).click()

  if (!movil) {
    // «⋯ Ya lo tengo»: deja de avisar y lo dice (Last Systems está detrás de «Ver todo»).
    await mandar.getByRole('button', { name: 'Ver todo' }).click()
    const fila = mandar.locator('[data-prueba="fila-doc"]', { hasText: 'Last Systems' })
    await fila.getByRole('button', { name: 'Más de Last Systems' }).click()
    await fila.getByRole('menuitem', { name: 'Ya lo tengo' }).click()
    await expect(page.locator('[data-prueba="puerta-aviso"]')).toContainText('Apuntado: ya tienes Last Systems')
    expect(llamadas.find((x) => x.f === 'ya')?.cuerpo).toMatchObject({ p_expected: 'f-last' })
  }
  expect(errores).toEqual([])
})

test('Qué esperas cada mes: los grupos, las personas solo aquí, el local donde toca y Guardar', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const { llamadas } = await simular(page, { puerta: puertaHosteleria(), fuentes: fuentesHosteleria() })
  await page.goto('/conta/inicio/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click()
  await page.getByRole('button', { name: /^Qué esperas cada mes/ }).click()
  await expect(page).toHaveURL(/\/conta\/inicio\/documentos\/que-esperas$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Qué esperas cada mes' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Inicio', 'Documentos', 'Qué esperas cada mes'])

  await expect(page.getByRole('switch', { name: 'Avisarme cuando algo se retrase' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Días de margen')).toHaveValue('5')
  // Los grupos, con su recuento.
  const alquileres = page.locator('[data-prueba="grupo-alquiler"]')
  await expect(alquileres.getByText('1 local · 3 facturas al mes')).toBeVisible()
  // Las personas sí, aquí, y las tres del mismo local en una fila.
  await expect(alquileres.getByText('Prieto Sanz (3 personas)')).toBeVisible()
  await expect(alquileres.getByLabel('Local de Prieto Sanz (3 personas)')).toHaveValue('l-norte')
  // El local, solo en alquileres y suministros.
  await expect(page.locator('[data-prueba="grupo-suministro"]').getByLabel('Local de Xfera Móviles')).toBeVisible()
  await expect(page.locator('[data-prueba="grupo-proveedor"]').getByRole('combobox')).toHaveCount(0)
  // Lo que lleva meses sin llegar, apagado y dicho; Glovo con su factura, en una fila.
  const proveedores = page.locator('[data-prueba="grupo-proveedor"]')
  await expect(proveedores.getByText(/sin facturas desde/)).toBeVisible()
  await expect(page.locator('[data-prueba="grupo-plataforma"]').getByText('Liquidación cada quincena · y su factura de comisiones')).toBeVisible()
  await foto(page, 'que-esperas')
  if (lado(page) === 'ordenador') await alLado(page, 'que-esperas', 'que-esperas-ordenador.png', 23)

  // Encender Makro y Guardar: lo hace y lo dice (regla 8).
  await proveedores.getByRole('switch', { name: 'Avisar de Makro Autoservicio Mayorista' }).click()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.locator('[data-prueba="esperas-aviso"]')).toHaveText('Guardado: Makro Autoservicio Mayorista encendido.')
  expect(llamadas.filter((x) => x.f === 'guardar').map((x) => x.cuerpo.p)).toEqual([{ id: 'f-makro', activa: true }])
  expect(errores).toEqual([])
})

test('otra actividad (sin hostelería): la papelería, subir y soltar en cualquier pantalla', async ({ page }) => {
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_D.email)
  await simular(page, { puerta: puertaPapeleria(), fuentes: fuentesPapeleria() })
  await page.goto('/conta/inicio/documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible({ timeout: 30_000 })
  const subir = page.getByRole('region', { name: 'Lo tienes que subir tú' })
  await expect(subir.getByText('Stripe', { exact: true })).toBeVisible()
  await expect(page.getByText(/Uber|Glovo|Catcher|riders/i)).toHaveCount(0)
  // Sin dirección todavía: se puede crear desde aquí.
  if (lado(page) === 'ordenador') await expect(page.getByRole('button', { name: 'Crear tu dirección' })).toBeVisible()
  await foto(page, 'documentos-papeleria')

  // Subir: cada fichero, su camino (aquí no se sube nada: solo se enseña).
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
    // Soltar un fichero en OTRA pantalla (Ventas › Facturas) abre Documentos con él.
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
