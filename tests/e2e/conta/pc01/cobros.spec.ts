// tests/e2e/conta/pc01/cobros.spec.ts
//
// PC01 · Entregas 3 y 4 · Ventas › Cobros (tablero cobros-1), la ficha de una
// remesa de recibos (cobros-2) y la página para firmar un mandato sin cuenta, en
// el ordenador y en el móvil. E4: la columna y el diálogo «Recordatorios»,
// Ajustes › Cobros y el mandato que sale desde Sumied (conta-mandato-enviar y
// conta-recordatorios, simuladas: la base de la 0641 y las dos funciones no
// están en staging hasta su tanda y su fusión).
//
// La base de la tanda (20261026T2142_pc01e3_cobros_mandatos_recibos) solo
// añade, pero staging no la tiene hasta que esté en producción y se fusione
// (W04). Por eso lo que la pantalla LEE (conta_cobros_lista,
// conta_remesa_cobros_ficha, conta_remesas_cobros_lista,
// conta_mandato_para_firmar) y lo que ESCRIBE (preparar la remesa, preparar
// el mandato, firmarlo) se simula aquí con la forma de la 2142 y los casos del
// tablero (Foodint no tiene clientes domiciliados: todo lo suyo es de
// plataforma), con fechas de hoy para que no caduquen. Lo demás (la sesión,
// el marco, el menú de Ventas, los bancos de la empresa) es staging y el código
// de verdad. Las funciones las prueba su prueba de staging
// (supabase/staging/sql/20261026_pc01e3_cobros_prueba.sql); el fichero para
// el banco, la unitaria contra el esquema (pc01/sepaRecibos.test.ts).
//
//   1. Cobros: las cifras, el aviso del domiciliado sin mandato, las pestañas;
//      marcar uno domiciliado y el que no tiene mandato: la barra dice cuál no
//      entra y por qué; «Cobrar por remesa» prepara la remesa y abre su ficha,
//      que lo dice (regla 8).
//   2. La ficha con un recibo devuelto: los pasos hasta el plazo de
//      devoluciones, el aviso del devuelto, el asiento de la devolución (430 y
//      626 contra 572) y el mandato; «Pasar el devuelto en la próxima remesa»
//      vuelve a Cobros con su factura marcada.
//   3. «Enviarle el mandato para firmar» (E4): lo manda Sumied y lo dice; sin
//      correo, prepara el enlace para copiarlo.
//   4. La página del mandato, sin cuenta: un IBAN mal escrito no firma; con
//      todo bien, firma y enseña la copia firmada.
//   5. (E4) «Recordatorios»: los días, los últimos, apagar a un cliente y
//      mandarte una prueba.
//   6. (E4) Ajustes › Cobros: los días en palabras, lo que no vale, guardar.
//   7. (S01) Ajustes › Cobros: el TPV del banco (Redsys): sin datos, «Falta el
//      número de comercio»; lo que no vale; «Guardar cambios» lo dice y queda
//      «En pruebas». La clave no vuelve a la pantalla.
//   8. (S01) Cobrados: «Cobrado · pendiente del abono» y «Cobrado · abonado el».
//   9. (S01) La página de pago con el TPV: dónde se paga, y «Pagar» manda el
//      formulario firmado a Redsys (sis-t, simulado).
//   (conta_cobro_redsys_leer, conta-redsys y conta_cobros_abonos, de la 2030,
//   simulados con su forma: staging no los tiene hasta la tanda.)
// Las capturas, al lado de su tablero (docs/conta/pc01/tableros), en el artefacto.

import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'

const DIR = 'docs/conta/capturas/pc01'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function alLado(page: Page, nombre: string, tablero: string) {
  const l = lado(page)
  await page.evaluate(() => document.fonts.ready)
  const pantalla = await page.screenshot({ fullPage: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${l}.png`, fullPage: true })
  const fichero = `docs/conta/pc01/tableros/${tablero}-${l}.${l === 'movil' ? 'webp' : 'png'}`
  const imagen = readFileSync(fichero)
  const tipo = l === 'movil' ? 'image/webp' : 'image/png'
  const ancho = l === 'movil' ? 390 : 1440
  const otra = await page.context().newPage()
  await otra.setViewportSize({ width: ancho * 2 + 48, height: 900 })
  await otra.setContent(`<body style="margin:0;padding:16px;background:#E9EEF5;font:600 14px system-ui;color:#172443">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <figure style="margin:0;width:${ancho}px"><figcaption style="margin:0 0 8px">${tablero} (aprobado)</figcaption><img style="width:100%" src="data:${tipo};base64,${imagen.toString('base64')}"></figure>
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

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
const dia = (d: number) => { const x = new Date(`${hoy()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const TOKEN = 'ab'.repeat(32)

const fila = (x: Record<string, unknown>) => ({
  id: 'x', party_id: 'c', cliente: 'Cliente', numero: 'A-1', fecha: dia(-20), vence: dia(6), total: 100, cobrado: 0, pendiente: 100,
  estado: 'por_cobrar', dias_vencida: null, forma: 'direct_debit', location_id: null, local: null, mandato: 'SUM-000123', mandato_firmado: dia(-50),
  con_mandato: true, iban4: '1332', con_cuenta: true, remesa: null, devuelto: null, ...x,
})
const FILAS = [
  fila({ id: 'f-ghost', party_id: 'c-ghost', cliente: 'Ghost Kitchens Prueba SL', numero: 'A-2026/0010', vence: dia(-15), total: 1452, pendiente: 1452, estado: 'vencida', dias_vencida: 15, forma: 'transfer', con_mandato: false, mandato: null }),
  fila({ id: 'f-club', party_id: 'c-club', cliente: 'Club Deportivo Prueba', numero: 'F-2026/0084', total: 432, pendiente: 432 }),
  fila({ id: 'f-acad', party_id: 'c-acad', cliente: 'Academia de Baile Prueba', numero: 'A-2026/0012', total: 660, pendiente: 660, mandato: 'SUM-000131' }),
  fila({ id: 'f-cole', party_id: 'c-cole', cliente: 'Colegio Prueba del Pilar', numero: 'A-2026/0013', total: 1248, pendiente: 1248, mandato: 'SUM-000140' }),
  fila({ id: 'f-bar', party_id: 'c-bar', cliente: 'Bar La Esquina Prueba', numero: 'A-2026/0014', total: 385, pendiente: 385, con_mandato: false, mandato: null, mandato_firmado: null, iban4: null }),
  fila({ id: 'f-eventos', party_id: 'c-eventos', cliente: 'Eventos Catering Prueba SL', numero: 'F-2026/0089', vence: dia(19), total: 780.5, pendiente: 780.5, forma: 'transfer', con_mandato: false, mandato: null }),
  fila({ id: 'f-uber', party_id: 'c-uber', cliente: 'Uber Eats', numero: 'CD-2026/0412', vence: dia(4), total: 349.47, pendiente: 349.47, estado: 'esperando_liquidacion', forma: 'plataforma', con_mandato: false, mandato: null }),
]

const FICHA = (estado: 'preparada' | 'plazo') => ({
  id: 'rc-9', codigo: 'C-2026/009', cargo: estado === 'plazo' ? dia(-25) : dia(6), estado, total: 2340, cobrado: estado === 'plazo' ? 1908 : 0,
  por_abonar: estado === 'plazo' ? 0 : 2340, recibos_vivos: 3, cobrados: estado === 'plazo' ? 2 : 0, devueltos: estado === 'plazo' ? 1 : 0,
  abonada_el: estado === 'plazo' ? dia(-25) : null, plazo_hasta: estado === 'plazo' ? dia(31) : null,
  fichero_at: estado === 'plazo' ? new Date().toISOString() : null, fichero_por: estado === 'plazo' ? 'Ana Prueba' : null,
  creada: new Date().toISOString(), creada_por: 'Ana Prueba', empresa: 'Foodint', acreedor: 'ES79000B12345678',
  banco: { id: 'b', nombre: 'Banco de Prueba', iban4: '4417', cuenta: '57200001' }, cuenta_gastos: '62600001',
  recibos: [
    { id: 'l-1', factura_id: 'f-club', numero: 'F-2026/0071', fecha: dia(-30), importe: 432, estado: estado === 'plazo' ? 'devuelto' : 'pendiente', cliente: 'Club Deportivo Prueba', cliente_id: 'c-club',
      cuenta: '43000231', iban4: '1332', iban_pais: 'ES', mandato: 'SUM-000123', firmado: dia(-53), primero: false, abonado: estado === 'plazo' ? dia(-25) : null,
      devuelto: estado === 'plazo' ? dia(-18) : null, motivo: estado === 'plazo' ? 'sin fondos' : null, gastos: estado === 'plazo' ? 3.5 : null, pendiente: 432,
      mandato_ficha: { ref: 'SUM-000123', firmado: `${dia(-53)}T10:00:00Z`, como: 'enlace', firmante: 'Marta Prueba', token: TOKEN },
      ultimo_cobro: { fecha: dia(-55), estado: 'cobrado' } },
    { id: 'l-2', factura_id: 'f-acad', numero: 'A-2026/0007', fecha: dia(-30), importe: 660, estado: estado === 'plazo' ? 'cobrado' : 'pendiente', cliente: 'Academia de Baile Prueba', cliente_id: 'c-acad',
      cuenta: '43000232', iban4: '6789', iban_pais: 'ES', mandato: 'SUM-000131', firmado: dia(-46), primero: true, abonado: estado === 'plazo' ? dia(-25) : null,
      devuelto: null, motivo: null, gastos: null, pendiente: estado === 'plazo' ? 0 : 660, mandato_ficha: null, ultimo_cobro: null },
    { id: 'l-3', factura_id: 'f-cole', numero: 'A-2026/0008', fecha: dia(-30), importe: 1248, estado: estado === 'plazo' ? 'cobrado' : 'pendiente', cliente: 'Colegio Prueba del Pilar', cliente_id: 'c-cole',
      cuenta: '43000233', iban4: '7891', iban_pais: 'ES', mandato: 'SUM-000140', firmado: dia(-44), primero: true, abonado: estado === 'plazo' ? dia(-25) : null,
      devuelto: null, motivo: null, gastos: null, pendiente: estado === 'plazo' ? 0 : 1248, mandato_ficha: null, ultimo_cobro: null },
  ],
  historial: [
    { at: new Date().toISOString(), por: 'Ana Prueba', texto: 'Prepara la remesa con 3 recibos por 2.340,00 €.' },
    ...(estado === 'plazo' ? [{ at: new Date().toISOString(), por: 'Ana Prueba', texto: 'Club Deportivo Prueba devuelve el recibo de la F-2026/0071 (sin fondos), con 3,50 € de gastos.' }] : []),
  ],
})

type Llamada = { f: string; cuerpo: Record<string, unknown> }
async function simular(page: Page, ficha: 'preparada' | 'plazo' = 'preparada'): Promise<Llamada[]> {
  const llamadas: Llamada[] = []
  const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
  const apuntar = (f: string, respuesta: () => unknown) => (r: Route) => { llamadas.push({ f, cuerpo: r.request().postDataJSON() }); return json(r, respuesta()) }
  await page.route(/\/rest\/v1\/rpc\/conta_cobros_lista(\?|$)/, (r) => json(r, {
    filas: FILAS, cobrado_mes: 31240.55, cobradas_mes: 218, remesas: 9,
    sin_mandato: [{ id: 'c-bar', nombre: 'Bar La Esquina Prueba', facturas: 1, pendiente: 385, correo: null, enviado: null }],
  }))
  await page.route(/\/rest\/v1\/rpc\/conta_remesas_cobros_lista(\?|$)/, (r) => json(r, [
    { id: 'rc-9', codigo: 'C-2026/009', cargo: dia(-25), estado: 'plazo', total: 2340, cobrado: 1908, recibos: 3, cobrados: 2, devueltos: 1, plazo_hasta: dia(31), banco: 'Banco de Prueba' },
  ]))
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_cobros_crear(\?|$)/, apuntar('crear', () => ({
    remesa: 'rc-9', codigo: 'C-2026/009', recibos: 1, primeros: 0, total: 432,
    frase: `Remesa C-2026/009 preparada: 1 recibo, 432,00 €, con cargo el ${ddmm(dia(6))}. Descarga el fichero y súbelo a la banca de Banco de Prueba.`,
  })))
  await page.route(/\/rest\/v1\/rpc\/conta_remesa_cobros_ficha(\?|$)/, (r) => json(r, FICHA(ficha)))
  await page.route(/\/rest\/v1\/rpc\/conta_mandato_preparar(\?|$)/, apuntar('mandato', () => ({
    mandato: 'm-1', ref: 'SUM-000124', token: TOKEN, enlace: `/mandato.html?t=${TOKEN}`, correo: null, caduca: dia(30),
    frase: 'Mandato SUM-000124 de Bar La Esquina Prueba preparado: el enlace para firmarlo vale 30 días.',
  })))
  // E4 · Los recordatorios (la 0641) y las dos funciones de correo.
  const dom = { enviados: 0, ultimo: null, proximo: null, sin: 'domiciliada', no_salio: null }
  await page.route(/\/rest\/v1\/rpc\/conta_recordatorios_resumen(\?|$)/, (r) => json(r, {
    activos: true, dias: [-3, 0, 7, 15], cambiado: null, hoy: hoy(),
    clientes_apagados: [{ id: 'c-otro', nombre: 'Cliente Apagado Prueba', por: 'Ana Prueba', at: new Date().toISOString() }],
    facturas: [
      { id: 'f-ghost', enviados: 3, ultimo: dia(-8), proximo: dia(0), sin: null, no_salio: null },
      { id: 'f-eventos', enviados: 0, ultimo: null, proximo: dia(16), sin: null, no_salio: null },
      { id: 'f-uber', enviados: 0, ultimo: null, proximo: null, sin: 'plataforma', no_salio: null },
      ...['f-club', 'f-acad', 'f-cole', 'f-bar'].map((id) => ({ id, ...dom })),
    ],
    ultimos: [
      { at: `${dia(-8)}T07:00:00Z`, factura: 'A-2026/0010', factura_id: 'f-ghost', cliente: 'Ghost Kitchens Prueba SL', para: 'pagos@ghost.example', enviado: true, motivo: null, dia: 7 },
      { at: `${dia(-15)}T07:00:00Z`, factura: 'A-2026/0010', factura_id: 'f-ghost', cliente: 'Ghost Kitchens Prueba SL', para: 'pagos@ghost.example', enviado: true, motivo: null, dia: 0 },
    ],
  }))
  await page.route(/\/rest\/v1\/rpc\/conta_recordatorios_cliente(\?|$)/, apuntar('cliente', () => ({ frase: 'A Eventos Catering Prueba SL ya no se le mandan recordatorios.' })))
  await page.route(/\/rest\/v1\/rpc\/conta_cobro_ajustes_guardar(\?|$)/, apuntar('ajustes', () => ({ frase: 'Guardado: los recordatorios se mandan 5 días antes, el día que vence, a los 30 días.' })))
  await page.route(/\/functions\/v1\/conta-mandato-enviar(\?|$)/, apuntar('enviar', () => ({ enviado: true, texto: 'Enviado el mandato SUM-000124 a admin@bar-prueba.example. Cuando lo firme, su ficha queda domiciliada con su IBAN.' })))
  await page.route(/\/functions\/v1\/conta-recordatorios(\?|$)/, apuntar('prueba', () => ({ enviado: true, texto: 'Prueba mandada a julio@prueba.example: el recordatorio de la A-2026/0010, tal como lo recibiría el cliente.' })))
  // E4 · Cómo te pagan (la 1121) y el alta en Stripe (conta-stripe), con la tarjeta activa y Bizum por terminar.
  await page.route(/\/rest\/v1\/rpc\/conta_cobro_stripe_leer(\?|$)/, (r) => json(r, { tarjeta: 'activo', bizum: 'falta_alta', bizum_encendido: false, pendiente: 3, modo: 'prueba', leido: new Date().toISOString(), desde: new Date().toISOString() }))
  await page.route(/\/rest\/v1\/rpc\/conta_enlaces_pago_resumen(\?|$)/, (r) => json(r, [{ id: 'f-eventos', aperturas: 2, abierto: new Date().toISOString() }]))
  await page.route(/\/functions\/v1\/conta-stripe(\?|$)/, apuntar('stripe', () => ({ ok: true, url: 'https://stripe-prueba.example/alta', texto: 'Te llevo al alta de Stripe.' })))
  await page.route('https://stripe-prueba.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Alta de Stripe (simulada)</title><h1>Alta de Stripe (simulada)</h1>' }))
  // S01 · El TPV del banco (la 2030): sin datos hasta que se guardan; después, en pruebas.
  let tpv: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/conta_cobro_redsys_leer(\?|$)/, (r) => json(r, tpv))
  await page.route(/\/functions\/v1\/conta-redsys(\?|$)/, (r) => {
    llamadas.push({ f: 'redsys', cuerpo: r.request().postDataJSON() })
    tpv = { estado: 'pruebas', comercio: '999008881', terminal: '1', con_clave: true, bizum: false, en_enlace: true, modo: 'prueba', cobra: true, proveedor_enlace: 'redsys',
      cambiado: { at: new Date().toISOString(), por: 'Ana Prueba' } }
    return json(r, { ok: true, texto: 'Guardado. Redsys en pruebas, comercio 999008881.', estado: 'pruebas', proveedor: 'redsys' })
  })
  await page.route(/\/rest\/v1\/rpc\/conta_cobros_abonos(\?|$)/, (r) => json(r, [
    { id: 'f-tarjeta-1', proveedor: 'stripe', cobrado: dia(-3), abonado: null },
    { id: 'f-tarjeta-2', proveedor: 'redsys', cobrado: dia(-6), abonado: dia(-4) },
  ]))
  return llamadas
}

/** Las palabras de técnico que no salen en pantalla (encargo, diseño). */
const TECNICAS = /\b(pain\.0|XML|SDD|payment|batch|remesa_id|null|undefined|NaN|token)\b/i

test('Cobros: cifras, sin mandato, pestañas; cobrar por remesa (el que no tiene mandato no entra) y su ficha', async ({ page }) => {
  test.setTimeout(120_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/ventas/cobros')
  await expect(page.getByRole('heading', { level: 1, name: 'Cobros' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Ventas', 'Cobros'])

  // Las cifras: por cobrar (todas las que quedan), vencido, la próxima remesa (3 recibos) y lo cobrado en el mes.
  const cifras = page.locator('.pg-cifras')
  await expect(cifras).toContainText('Próxima remesa', { timeout: 30_000 })
  await expect(cifras).toContainText('2.340,00')
  await expect(cifras).toContainText('3 recibos · cargo el')
  await expect(cifras).toContainText('1.452,00')
  await expect(cifras).toContainText('31.240,55')
  await expect(cifras).toContainText('7 facturas')

  // El aviso del domiciliado sin mandato.
  const sinMandato = page.locator('[data-prueba="sin-mandato"]')
  await expect(sinMandato).toContainText('Bar La Esquina Prueba paga por domiciliación y no tiene mandato firmado.')
  await expect(sinMandato.getByRole('button', { name: 'Enviarle el mandato para firmar' })).toBeVisible()

  // Las pestañas, con la de las remesas.
  const pestanas = page.getByRole('tablist', { name: 'Estado de los cobros' })
  for (const t of ['Por cobrar', 'Vencidas', 'Próxima remesa', 'Remesas', 'Devueltos', 'Cobrados']) await expect(pestanas.getByRole('tab', { name: new RegExp(t) })).toBeVisible()
  await pestanas.getByRole('tab', { name: /Remesas/ }).click()
  await expect(page.getByRole('table', { name: 'Remesas de recibos' })).toContainText('C-2026/009')
  await pestanas.getByRole('tab', { name: /Por cobrar/ }).click()
  await expect(pestanas.getByRole('tab', { name: /Por cobrar/ })).toHaveAttribute('aria-selected', 'true')

  // Marcar el Club (domiciliado, con mandato) y el Bar (sin mandato): la barra dice cuál no entra y por qué.
  await page.getByRole('checkbox', { name: /^Marcar Club Deportivo/ }).check()
  await page.getByRole('checkbox', { name: /^Marcar Bar La Esquina/ }).check()
  const barra = page.getByRole('region', { name: 'Cobrar las seleccionadas' })
  await expect(barra).toContainText('1 recibo · 432,00 €')
  await expect(barra).toContainText('1 no entra: Bar La Esquina Prueba no tiene mandato firmado')
  await expect(barra.getByRole('button', { name: /Cobrar por remesa/ })).toBeEnabled()
  // E4 · La columna «Recordatorios», como en el tablero (en el móvil, la tarjeta no la lleva).
  if (lado(page) === 'ordenador') {
    const tabla = page.getByRole('table', { name: /^Cobros · / })
    await expect(tabla).toContainText(`3 enviados · próximo ${ddmm(dia(0))}`)
    await expect(tabla).toContainText('no hacen falta')
    await expect(tabla).toContainText('con enlace · abierta 2 veces')
  }
  // E4 · Cómo te pagan: la tarjeta activa y el aviso de Bizum, con su botón.
  const como = page.locator('[data-prueba="como-te-pagan"]').first()
  await expect(como.locator('[data-prueba="aviso-bizum"]')).toHaveText('Bizum: falta terminar el alta en Stripe.')
  await expect(como.getByRole('list', { name: 'Métodos de pago' }).getByRole('listitem')).toHaveText([/Tarjeta\s*Activo/, /Bizum\s*Falta tu alta en Stripe/])
  await expect(page.locator('.pg-notas')).toContainText('Recordatorios que se mandan solos: 3 días antes, el día que vence y a los 7 y 15 días')
  expect(await page.locator('.pg-pagina').first().innerText()).not.toMatch(TECNICAS)
  await alLado(page, 'cobros', 'cobros-1')

  await barra.getByRole('button', { name: /Cobrar por remesa/ }).click()
  await expect(page).toHaveURL(/\/conta\/ventas\/cobros\/remesas\/rc-9/, { timeout: 30_000 })
  expect(llamadas.find((l) => l.f === 'crear')!.cuerpo.p_facturas).toEqual([{ id: 'f-club', importe: 432 }])
  await expect(page.getByRole('heading', { level: 1, name: `Remesa de recibos · ${ddmm(dia(6))}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-prueba="aviso-remesa"]')).toHaveText(`Remesa C-2026/009 preparada: 1 recibo, 432,00 €, con cargo el ${ddmm(dia(6))}. Descarga el fichero y súbelo a la banca de Banco de Prueba.`)
  await expect(page.getByRole('button', { name: 'Descargar el fichero' }).first()).toBeVisible()
  const pasos = page.getByRole('list', { name: 'En qué punto está la remesa' }).getByRole('listitem')
  await expect(pasos).toHaveText([/Preparada/, /En el banco/, /Abonada/, /Plazo de devoluciones/])
  expect(errores).toEqual([])
})

test('La ficha con un recibo devuelto: el plazo de devoluciones, su asiento y su mandato; «Pasar el devuelto en la próxima remesa»', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await simular(page, 'plazo')
  await page.goto('/conta/ventas/cobros/remesas/rc-9')
  await expect(page.getByRole('heading', { level: 1, name: `Remesa de recibos · ${ddmm(dia(-25))}` })).toBeVisible({ timeout: 30_000 })
  const pasos = page.getByRole('list', { name: 'En qué punto está la remesa' }).getByRole('listitem')
  await expect(pasos).toHaveText([/Preparada/, /En el banco/, /Abonada/, new RegExp(`Plazo de devoluciones · hasta el ${ddmm(dia(31))}`)])
  await expect(pasos.nth(3)).toHaveAttribute('aria-current', 'step')
  await expect(page.locator('[data-prueba="aviso-devuelto"]')).toContainText(`Club Deportivo Prueba devolvió el recibo el ${ddmm(dia(-18))}`)
  await expect(page.locator('[data-prueba="aviso-devuelto"]')).toContainText('motivo del banco: sin fondos')
  await expect(page.locator('[data-prueba="aviso-devuelto"]')).toContainText('con 3,50 € de gastos de devolución')
  await expect(page.getByText('Su asiento, la devolución')).toBeVisible()
  for (const c of ['43000231', '62600001', '57200001']) await expect(page.getByText(c).first()).toBeVisible()
  await expect(page.getByText('ES79000B12345678')).toBeVisible()
  await expect(page.locator('[data-prueba="mandato"]')).toContainText('SUM-000123')
  await expect(page.getByRole('link', { name: 'Ver el mandato firmado' })).toHaveAttribute('href', `/mandato.html?t=${TOKEN}`)
  expect(await page.locator('.pg-pagina').innerText()).not.toMatch(TECNICAS)
  await alLado(page, 'remesa-cobros', 'cobros-2')

  await page.getByRole('button', { name: 'Pasar el devuelto en la próxima remesa' }).first().click()
  await expect(page).toHaveURL(/\/conta\/ventas\/cobros\?pestana=proxima/, { timeout: 30_000 })
  await expect(page.getByRole('checkbox', { name: /^Marcar Club Deportivo/ })).toBeChecked({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Cobrar las seleccionadas' })).toContainText('1 recibo · 432,00 €')
  expect(errores).toEqual([])
})

test('«Enviarle el mandato para firmar» lo manda Sumied y lo dice; sin correo, da el enlace', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/ventas/cobros')
  await page.locator('[data-prueba="sin-mandato"]').getByRole('button', { name: 'Enviarle el mandato para firmar' }).click({ timeout: 30_000 })
  let dialogo = page.getByRole('dialog', { name: 'Mandato de Bar La Esquina Prueba' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel('Su correo').fill('admin@bar-prueba.example')
  await dialogo.getByRole('button', { name: 'Preparar y mandar' }).click()
  await expect(dialogo.locator('[data-prueba="mandato-preparado"]')).toContainText('Mandato SUM-000124 de Bar La Esquina Prueba preparado: el enlace para firmarlo vale 30 días. Enviado el mandato SUM-000124 a admin@bar-prueba.example.')
  expect(llamadas.find((l) => l.f === 'enviar')!.cuerpo).toEqual({ mandato: 'm-1', para: 'admin@bar-prueba.example', origen: expect.stringMatching(/^https?:\/\//) })
  await dialogo.getByRole('button', { name: 'Hecho' }).click()

  // Sin correo: prepara el enlace, no llama al envío, y lo dice.
  await page.locator('[data-prueba="sin-mandato"]').getByRole('button', { name: 'Enviarle el mandato para firmar' }).click()
  dialogo = page.getByRole('dialog', { name: 'Mandato de Bar La Esquina Prueba' })
  await dialogo.getByRole('button', { name: 'Preparar el enlace' }).click()
  await expect(dialogo.locator('[data-prueba="mandato-preparado"]')).toContainText('preparado: el enlace para firmarlo vale 30 días. Copia el enlace y mándaselo.')
  await expect(dialogo.getByLabel('El enlace para firmar')).toHaveValue(new RegExp(`/mandato\\.html\\?t=${TOKEN}$`))
  expect(llamadas.filter((l) => l.f === 'enviar')).toHaveLength(1)
  expect(errores).toEqual([])
})

test('«Recordatorios»: los días, los últimos, apagar a un cliente y mandarte una prueba', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/ventas/cobros')
  await page.getByRole('button', { name: 'Recordatorios', exact: true }).click({ timeout: 30_000 })
  const dialogo = page.getByRole('dialog', { name: 'Recordatorios' })
  await expect(dialogo).toContainText('Se mandan solos, 3 días antes, el día que vence y a los 7 y 15 días')
  await expect(dialogo).toContainText('Ghost Kitchens Prueba SL · A-2026/0010')
  await expect(dialogo).toContainText('mandado a pagos@ghost.example')
  await expect(dialogo).toContainText('Cliente Apagado Prueba')
  await expect(dialogo.getByRole('link', { name: /Ajustes › Cobros/ })).toBeVisible()
  expect(await dialogo.innerText()).not.toMatch(TECNICAS)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/recordatorios-${lado(page)}.png`, fullPage: true })

  await dialogo.getByLabel('Apagar los de un cliente').selectOption({ label: 'Eventos Catering Prueba SL' })
  await expect(dialogo.getByRole('status')).toHaveText('A Eventos Catering Prueba SL ya no se le mandan recordatorios.')
  expect(llamadas.find((l) => l.f === 'cliente')!.cuerpo).toEqual({ p_company: expect.any(String), p_party: 'c-eventos', p_apagar: true })

  await dialogo.getByLabel('A este correo').fill('julio@prueba.example')
  await dialogo.getByRole('button', { name: 'Mandar la prueba' }).click()
  await expect(dialogo.getByRole('status')).toHaveText('Prueba mandada a julio@prueba.example: el recordatorio de la A-2026/0010, tal como lo recibiría el cliente.')
  expect(llamadas.find((l) => l.f === 'prueba')!.cuerpo).toEqual({ factura: 'f-ghost', para: 'julio@prueba.example' })
  expect(errores).toEqual([])
})

test('Ajustes › Cobros: los días en palabras mientras se escriben, lo que no vale, y guardar lo dice', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/ajustes/cobros')
  const ajustes = page.locator('[data-prueba="ajustes-cobros"]')
  await expect(ajustes.getByLabel('Qué días')).toHaveValue('-3, 0, 7, 15', { timeout: 30_000 })
  // E4 · Cómo te pagan: tarjeta y Bizum, su estado en palabras y un solo botón al alta de Stripe.
  const como = ajustes.locator('[data-prueba="como-te-pagan"]')
  await expect(como.getByRole('list', { name: 'Métodos de pago' }).getByRole('listitem')).toHaveText([/Tarjeta\s*Activo/, /Bizum\s*Falta tu alta en Stripe/])
  await expect(page.getByRole('button', { name: 'Terminar tu alta en Stripe' })).toHaveCount(1)
  expect(await como.innerText()).not.toMatch(/\b(capacidad|capability|v2|Connect)\b/i)
  await expect(ajustes).toContainText('Así: 3 días antes, el día que vence y a los 7 y 15 días.')
  await expect(ajustes).toContainText('Cliente Apagado Prueba')
  await expect(ajustes.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await ajustes.getByLabel('Qué días').fill('-3, 120')
  await expect(ajustes).toContainText('Cada día, entre 30 antes de vencer (-30) y 90 después.')
  await expect(ajustes.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await ajustes.getByLabel('Qué días').fill('30, -5, 0')
  await expect(ajustes).toContainText('Así: 5 días antes, el día que vence y a los 30 días.')
  expect(await ajustes.innerText()).not.toMatch(TECNICAS)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ajustes-cobros-${lado(page)}.png`, fullPage: true })
  await ajustes.getByRole('button', { name: 'Guardar' }).click()
  await expect(ajustes.getByRole('status').last()).toHaveText('Guardado: los recordatorios se mandan 5 días antes, el día que vence, a los 30 días.')
  expect(llamadas.find((l) => l.f === 'ajustes')!.cuerpo).toEqual({ p_company: expect.any(String), p_recordatorios: true, p_dias: [-5, 0, 30] })

  // El botón lleva al alta de Stripe (simulada).
  await page.getByRole('button', { name: 'Terminar tu alta en Stripe' }).click()
  await expect(page.getByRole('heading', { name: 'Alta de Stripe (simulada)' })).toBeVisible({ timeout: 30_000 })
  expect(llamadas.find((l) => l.f === 'stripe')!.cuerpo).toEqual({ empresa: expect.any(String), accion: 'alta', origen: expect.stringMatching(/^https?:\/\//) })
  expect(errores).toEqual([])
})

test('La página del mandato, sin cuenta: un IBAN mal escrito no firma; con todo bien, firma y enseña la copia', async ({ page }) => {
  test.setTimeout(60_000)
  const errores = vigilar(page)
  let firmado = false
  const firmas: Record<string, unknown>[] = []
  const base = { ref: 'SUM-000124', acreedor: { nombre: 'Foodint Prueba SL', identificador: 'ES79000B12345678', direccion: 'Calle de Prueba 1, 28000 Madrid' }, deudor: { nombre: 'Bar La Esquina Prueba SL', nif: 'B00000303' } }
  await page.route(/\/rest\/v1\/rpc\/conta_mandato_para_firmar(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
    firmado ? { ...base, estado: 'firmado', firmado: { at: new Date().toISOString(), nombre: 'Marta Prueba', nif: null, iban: 'ES79 •••• •••• 6789' } } : { ...base, estado: 'por_firmar', firmado: null }) }))
  await page.route(/\/rest\/v1\/rpc\/conta_mandato_firmar(\?|$)/, (r) => {
    firmas.push(r.request().postDataJSON()); firmado = true
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ frase: 'Mandato SUM-000124 firmado. Gracias: los próximos recibos se cargarán en la cuenta que termina en 6789.' }) })
  })
  await page.goto(`/mandato.html?t=${TOKEN}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Orden de domiciliación de adeudo directo SEPA' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('ES79000B12345678')).toBeVisible()
  await expect(page.getByText(/las ocho semanas que siguen a la fecha de adeudo/)).toBeVisible()
  await page.getByLabel('Nombre y apellidos de quien firma').fill('Marta Prueba')
  await page.getByLabel('IBAN de la cuenta de cargo').fill('ES00 2100 0418 4502 0005 1332')
  await page.getByLabel('He leído la orden de domiciliación y la acepto.').check()
  await page.getByRole('button', { name: 'Firmar el mandato' }).click()
  await expect(page.getByRole('alert')).toHaveText('Este IBAN no es correcto: revisa los dígitos.')
  expect(firmas).toHaveLength(0)
  await page.getByLabel('IBAN de la cuenta de cargo').fill('ES79 2100 0813 6101 2345 6789')
  await expect(page.getByText('Correcto: ES79 2100 0813 6101 2345 6789')).toBeVisible()
  await page.getByRole('button', { name: 'Firmar el mandato' }).click()
  await expect(page.getByRole('status')).toHaveText('Mandato SUM-000124 firmado. Gracias: los próximos recibos se cargarán en la cuenta que termina en 6789.', { timeout: 30_000 })
  await expect(page.getByText('Firmado por')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar en PDF o imprimir' })).toBeVisible()
  expect(firmas[0]).toEqual({ p_token: TOKEN, p_nombre: 'Marta Prueba', p_nif: null, p_iban: 'ES7921000813610123456789', p_acepto: true })
  await page.screenshot({ path: `${DIR}/mandato-firmado-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('La página de pago, sin cuenta: la factura, lo pendiente, tarjeta y Bizum; «Pagar» va a Stripe; a la vuelta lo dice', async ({ page }) => {
  test.setTimeout(60_000)
  const errores = vigilar(page)
  const pagos: Record<string, unknown>[] = []
  const ver = { estado: 'abierto', empresa: 'Foodint Prueba SL', color: '#1E63C9', factura: 'F-2026/0089', fecha: dia(-20), vence: dia(19), total: 780.5, pendiente: 780.5, metodos: ['tarjeta', 'bizum'], pagado: null }
  await page.route(/\/rest\/v1\/rpc\/conta_enlace_pago_ver(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ver) }))
  await page.route(/\/functions\/v1\/conta-pago(\?|$)/, (r) => { pagos.push(r.request().postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://stripe-prueba.example/pago' }) }) })
  await page.route('https://stripe-prueba.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Pago de Stripe (simulado)</title><h1>Pago de Stripe (simulado)</h1>' }))
  await page.goto(`/pagar.html?t=${TOKEN}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Pagar la factura' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Foodint Prueba SL', { exact: true })).toBeVisible()
  await expect(page.getByText('F-2026/0089', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Puedes pagar con' }).getByRole('listitem')).toHaveText(['Tarjeta', 'Bizum'])
  await expect(page.getByText('Pagas en la página segura de Stripe, con tarjeta y Bizum.')).toBeVisible()
  expect(await page.locator('main').innerText()).not.toMatch(TECNICAS)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/pagar-${lado(page)}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Pagar 780,50 €' }).click()
  await expect(page.getByRole('heading', { name: 'Pago de Stripe (simulado)' })).toBeVisible({ timeout: 30_000 })
  expect(pagos).toEqual([{ token: TOKEN, origen: expect.stringMatching(/^https?:\/\//) }])

  // A la vuelta, aún sin el aviso de Stripe: lo está confirmando.
  await page.goto(`/pagar.html?t=${TOKEN}&vuelta=ok`)
  await expect(page.getByRole('status')).toHaveText('Pago recibido: Stripe lo está confirmando. Si has pagado con Bizum, termina de aceptarlo en el móvil. No hace falta que hagas nada más.')
  expect(errores).toEqual([])
})


// ── S01 · PR 1 · El TPV del banco (Redsys) y el abono ──────────────────────

test('Ajustes › Cobros: el TPV del banco, sin datos; lo que no vale; «Guardar cambios» lo dice y queda en pruebas', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  const llamadas = await simular(page)
  await page.goto('/conta/ajustes/cobros')
  const tpv = page.locator('[data-prueba="ajustes-cobros"] [data-prueba="redsys"]')
  await expect(tpv.getByRole('list', { name: 'Tu TPV' }).getByRole('listitem')).toHaveText(/Tarjeta con tu banco\s*Falta el número de comercio/, { timeout: 30_000 })
  await expect(tpv).toContainText('Sumied guarda la clave en su caja fuerte y no la vuelve a enseñar.')

  await tpv.getByRole('textbox', { name: 'Número de comercio' }).fill('99900888')
  await expect(tpv).toContainText('El número de comercio son 9 cifras.')
  await tpv.getByRole('textbox', { name: 'Número de comercio' }).fill('999 008 881')
  await tpv.getByLabel('Clave del comercio', { exact: true }).fill('corta')
  await expect(tpv).toContainText('La clave son 32 letras y números')
  await tpv.getByLabel('Clave del comercio', { exact: true }).fill('sq7HjrUOBfKmC576ILgskD5srU870gJ7')
  await tpv.getByLabel('¿Tu banco tiene Bizum en el TPV?').selectOption('si')
  const barra = tpv.getByRole('region', { name: 'Cambios sin guardar' })
  await expect(barra).toContainText('3 cambios sin guardar')
  expect(await tpv.innerText()).not.toContain('sq7HjrUOBfKmC576ILgskD5srU870gJ7')
  expect(await tpv.innerText()).not.toMatch(/\b(webhook|HMAC|cuenta puente|Vault|FUC|3DES)\b/i)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/ajustes-redsys-${lado(page)}.png`, fullPage: true })

  await barra.getByRole('button', { name: /Guardar cambios/ }).click()
  // El aviso por su texto, no «el primer status» (la barra de cambios también es
  // uno). Si no sale, el fallo dice lo que enseña el TPV en ese momento.
  await expect(tpv.getByRole('status').filter({ hasText: /^Guardado\./ })).toHaveText('Guardado. Redsys en pruebas, comercio 999008881.')
    .catch(async (e: Error) => {
      const enseña = (await tpv.innerText().catch(() => '(el TPV ya no está en la pantalla)')).replace(/\s+/g, ' ').trim()
      throw new Error(`Al guardar no sale «Guardado» en el TPV. Enseña: «${enseña}».\n${e.message}`)
    })
  expect(llamadas.find((l) => l.f === 'redsys')!.cuerpo).toEqual({ empresa: expect.any(String), comercio: '999008881', terminal: '1',
    clave: 'sq7HjrUOBfKmC576ILgskD5srU870gJ7', bizum: true, en_enlace: true, quien: null })
  await expect(tpv.getByRole('list', { name: 'Tu TPV' }).getByRole('listitem')).toHaveText(/Tarjeta con tu banco\s*En pruebas/)
  await expect(tpv).toContainText('En pruebas: los pagos van al entorno de pruebas de Redsys y no mueven dinero.')
  await expect(tpv.getByLabel('Clave del comercio', { exact: true })).toHaveValue('')
  await expect(tpv.getByLabel('Clave del comercio', { exact: true })).toHaveAttribute('placeholder', '•••••••• (guardada)')
  await page.screenshot({ path: `${DIR}/ajustes-redsys-guardado-${lado(page)}.png`, fullPage: true })
  expect(errores).toEqual([])
})

test('Cobrados: «Cobrado · pendiente del abono» hasta que Bancos casa el abono, y «Cobrado · abonado el»', async ({ page }) => {
  test.setTimeout(90_000)
  const errores = vigilar(page)
  await entrarComo(page, CUENTA_A.email)
  await simular(page)
  const cobradas = [
    fila({ id: 'f-tarjeta-1', party_id: 'c-eventos', cliente: 'Eventos Catering Prueba SL', numero: 'F-2026/0091', total: 121, cobrado: 121, pendiente: 0, estado: 'cobrada', forma: 'card', con_mandato: false, mandato: null }),
    fila({ id: 'f-tarjeta-2', party_id: 'c-ghost', cliente: 'Ghost Kitchens Prueba SL', numero: 'A-2026/0015', total: 242, cobrado: 242, pendiente: 0, estado: 'cobrada', forma: 'card', con_mandato: false, mandato: null }),
  ]
  await page.route(/\/rest\/v1\/rpc\/conta_cobros_lista(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    filas: [...FILAS, ...cobradas], cobrado_mes: 31240.55, cobradas_mes: 218, remesas: 9,
    sin_mandato: [{ id: 'c-bar', nombre: 'Bar La Esquina Prueba', facturas: 1, pendiente: 385, correo: null, enviado: null }],
  }) }))
  await page.goto('/conta/ventas/cobros?pestana=cobrados')
  await expect(page.getByRole('heading', { level: 1, name: 'Cobros' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Cobrado · pendiente del abono').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(`Cobrado · abonado el ${ddmm(dia(-4))}`).first()).toBeVisible()
  await alLado(page, 'cobrados-abono', 'cobros-1')
  expect(errores).toEqual([])
})

test('La página de pago con el TPV del banco: dónde se paga, y «Pagar» manda el formulario firmado a Redsys', async ({ page }) => {
  test.setTimeout(60_000)
  const errores = vigilar(page)
  const ver = { estado: 'abierto', empresa: 'Foodint Prueba SL', color: '#1E63C9', factura: 'F-2026/0089', fecha: dia(-20), vence: dia(19), total: 780.5, pendiente: 780.5,
    metodos: ['tarjeta'], proveedor: 'redsys', pagado: null }
  const campos = { Ds_SignatureVersion: 'HMAC_SHA256_V1', Ds_MerchantParameters: 'eyJEU19NRVJDSEFOVF9PUkRFUiI6IjI2MTAyNzIxNDc5MyJ9', Ds_Signature: 'firma-de-prueba=' }
  let enviado = ''
  await page.route(/\/rest\/v1\/rpc\/conta_enlace_pago_ver(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ver) }))
  await page.route(/\/functions\/v1\/conta-pago(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, redsys: { url: 'https://sis-t.redsys.es:25443/sis/realizarPago', campos } }) }))
  await page.route('https://sis-t.redsys.es:25443/**', (r) => { enviado = r.request().postData() ?? ''
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>TPV de pruebas (simulado)</title><h1>TPV de pruebas (simulado)</h1>' }) })
  await page.goto(`/pagar.html?t=${TOKEN}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Pagar la factura' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Pagas en la página segura del banco (Redsys), con tarjeta.')).toBeVisible()
  expect(await page.locator('main').innerText()).not.toMatch(TECNICAS)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/pagar-redsys-${lado(page)}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Pagar 780,50 €' }).click()
  await expect(page.getByRole('heading', { name: 'TPV de pruebas (simulado)' })).toBeVisible({ timeout: 30_000 })
  expect(Object.fromEntries(new URLSearchParams(enviado))).toEqual(campos)

  // A la vuelta, lo confirma el banco.
  await page.goto(`/pagar.html?t=${TOKEN}&vuelta=ok`)
  await expect(page.getByRole('status')).toHaveText('Pago recibido: el banco lo está confirmando. Si has pagado con Bizum, termina de aceptarlo en el móvil. No hace falta que hagas nada más.')
  expect(errores).toEqual([])
})
