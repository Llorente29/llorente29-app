/// <reference lib="dom" />
// tests/e2e/conta/c12/traspaso.spec.ts
//
// C12 (Julio, 24/10) · «Traspasar a Diez», arriba de Contabilidad › Cierre ›
// Cerrar el mes, contra staging-conta, en ordenador (1440) y móvil (390).
// Capturas en docs/conta/capturas/c12/ (van en el artefacto del run).
//
//   1. De verdad: la cuenta A (sin Diez en staging) lee su revisión y la
//      pantalla lo dice en una frase; no hay botón de traspasar.
//   2. Los estados del mes, con la revisión simulada (la pantalla es la de
//      verdad; solo la respuesta de conta_traspaso_revisar es inventada, para
//      no tocar staging): «Faltan 3 cosas» con sus enlaces, «listo para
//      traspasar» con el resumen y el diálogo de confirmar (que dice qué
//      autoriza), y «traspasado a Diez y cerrado» con el cuadre y el informe.
//   3. B01r26 · Los pasos 2 y 3 (las facturas por Excel, con su PDF), con la
//      revisión y la función simuladas: faltan subcuentas y «Crearlas en Diez»;
//      los dos Excel listos para descargar; «Ya lo he importado» y el cuadre.
// No escribe nada: el diálogo se cancela.

import { test, expect, type Page, type Route } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c12'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const RUTA = '/conta/libros/cierre/cerrar-mes'

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  expect(await loQueTapanSinPregunta(page, '.cx-principal')).toEqual([])
}
const json = (r: Route, body: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** El mes anterior al de hoy (AAAA-MM-01): un mes terminado, que se puede traspasar. */
function mesAnterior(): string {
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

const revision = (o: Record<string, unknown> = {}) => ({
  mes: mesAnterior(), faltan: [], van: 120, ya_en_diez: 14, no_viajan: 2, mes_cerrado: false, modo: 'mensual', conectado: true, traspaso: null,
  por_tipo: [{ tipo: 'ventas', n: 62 }, { tipo: 'recibidas', n: 31 }, { tipo: 'banco', n: 25 }, { tipo: 'anulacion', n: 2 }],
  por_cuenta: [
    { cuenta: '43000002', nombre: 'Clientes plataformas', debe: 6820.4, haber: 0 },
    { cuenta: '57200001', nombre: 'Banco', debe: 5400, haber: 3120.15 },
    { cuenta: '70000002', nombre: 'Ventas', debe: 0, haber: 6200.36 },
  ],
  ...o,
})

/** Simula la revisión del mes (la pantalla y todo lo demás, de verdad). */
async function conRevision(page: Page, r: unknown) {
  await page.route(/\/rest\/v1\/rpc\/conta_traspaso_revisar/, (x) => json(x, r))
}

/** Elige el mes que se traspasa (el anterior, terminado). */
async function elegirMesAnterior(page: Page) {
  const zona = page.getByRole('region', { name: 'Traspasar a Diez' })
  await expect(zona).toBeVisible()
  const selector = zona.getByLabel('Mes que se traspasa')
  if (await selector.count()) {
    const valor = mesAnterior()
    const opciones = await selector.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    if (opciones.includes(valor)) await selector.selectOption(valor)
  }
  return zona
}

test('A · de verdad: sin Diez, la pantalla lo dice en una frase y no ofrece traspasar', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = page.getByRole('region', { name: 'Traspasar a Diez' })
  await expect(zona).toBeVisible()
  await expect(zona.getByTestId('traspaso-frase')).toHaveText('Esta empresa no está conectada con Diez: no hay nada que traspasar.')
  await expect(zona.getByRole('button', { name: /Traspasar .* a Diez/ })).toHaveCount(0)
  // «Cerrar el mes» sigue debajo, como antes.
  await expect(page.getByRole('heading', { name: 'La contabilidad, mes a mes' })).toBeVisible()
  await capturar(page, 'sin-diez')
})

test('A · faltan cosas: el mes en una frase, cada cosa con su enlace, y se puede traspasar igual', async ({ page }) => {
  await conRevision(page, revision({ faltan: [{ codigo: 'asientos', n: 2 }, { codigo: 'recibidas_sin_pdf', n: 1 }] }))
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  await expect(zona.getByTestId('traspaso-frase')).toHaveText(/^Faltan 3 cosas antes de traspasar \w+\.$/)
  const falta = zona.getByRole('list', { name: 'Lo que falta' })
  await expect(falta.getByText('2 asientos del mes sin validar')).toBeVisible()
  await expect(falta.getByText('1 factura recibida sin su PDF')).toBeVisible()
  await expect(falta.getByRole('link', { name: 'Ir a verlo' })).toHaveCount(2)
  // Palabras de la calle: nada de cola ni de envíos.
  await expect(zona.getByText(/cola|env[ií]o/i)).toHaveCount(0)
  await capturar(page, 'faltan')
  await zona.getByRole('button', { name: /^Traspasar \w+ a Diez$/ }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText('Antes faltan cosas:')).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Traspasar igual' })).toBeVisible()
  await capturar(page, 'faltan-confirmar')
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
})

test('A · listo: el resumen por tipo y por cuenta, y el diálogo dice qué autoriza', async ({ page }) => {
  await conRevision(page, revision())
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  await expect(zona.getByTestId('traspaso-frase')).toHaveText(/^\w+ está listo para traspasar\.$/)
  const resumen = zona.getByLabel('Lo que va')
  await expect(resumen.locator('p').first()).toContainText('Van 120 asientos · 14 ya estaban en Diez y no se vuelven a mandar · 2 anulados antes de llegar a Diez no viajan')
  // Los tipos, en su lista (el nombre de una cuenta puede llamarse igual: «Ventas»).
  const tipos = resumen.getByRole('list')
  for (const t of ['Ventas', 'Facturas recibidas', 'Banco', 'Anulaciones de lo que ya estaba en Diez']) await expect(tipos.getByText(t, { exact: true })).toBeVisible()
  await resumen.getByText('Totales por cuenta').click()
  await expect(resumen.getByRole('cell', { name: '43000002' })).toBeVisible()
  await capturar(page, 'listo')
  await zona.getByRole('button', { name: /^Traspasar \w+ a Diez$/ }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText(/autorizas escribir en Diez todo lo de \w+: ventas, facturas recibidas, banco, asientos a mano y liquidaciones\. .*por dos Excel que importas tú en Diez \(pasos 2 y 3\)\. Queda apuntado quién y cuándo\./)).toBeVisible()
  await expect(dialogo.getByRole('button', { name: 'Traspasar', exact: true })).toBeVisible()
  await capturar(page, 'listo-confirmar')
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
})

test('A · traspasado y cerrado: «Cuadra» en verde, quién lo confirmó y el informe', async ({ page }) => {
  const mes = mesAnterior()
  await conRevision(page, revision({
    mes_cerrado: true,
    traspaso: { id: 't1', mes, estado: 'terminado', confirmado_por_nombre: 'Julio', confirmado_en: `${mes.slice(0, 7)}-28T09:00:00Z`, faltaba: [], van: 120, llegaron: 120, no_llegaron: 0,
      cuadre: { cuadra: true, cuentas: 38, diferencias: [], solo_en_diez: [] }, cuadra: true, mes_cerrado: true, cierre_motivo: null, terminado_en: `${mes.slice(0, 7)}-28T09:06:00Z` },
  }))
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  await expect(zona.getByTestId('traspaso-frase')).toHaveText(/^\w+ está traspasado a Diez y cerrado\.$/)
  await expect(zona.getByTestId('traspaso-cuadre')).toHaveText('Cuadra: 38 cuentas tienen en Diez lo mismo que en Sumied.')
  await expect(zona.getByText(/Confirmado por Julio el/)).toBeVisible()
  await expect(zona.getByRole('button', { name: 'Descargar el informe' })).toBeVisible()
  await expect(zona.getByRole('button', { name: /Traspasar .* a Diez/ })).toHaveCount(0)
  await capturar(page, 'cerrado')
})

test('A · B01r26 · los pasos 2 y 3: las subcuentas, los dos Excel y «Ya lo he importado»', async ({ page }) => {
  const mes = mesAnterior()
  await conRevision(page, revision({
    traspaso: { id: 't1', mes, estado: 'traspasando', confirmado_por_nombre: 'Julio', confirmado_en: `${mes.slice(0, 7)}-28T09:00:00Z`, faltaba: [], van: 120, llegaron: 30, no_llegaron: 0,
      cuadre: null, cuadra: null, mes_cerrado: false, cierre_motivo: null, terminado_en: null },
  }))
  // La función del traspaso, simulada: la primera vez faltan dos subcuentas; después de crearlas, los Excel.
  let creadas = false
  const fila = (n: string) => ['43000002', 'Ventas', 'UBER EATS', '', '70000000', n, 100, '', '', '', 'https://ejemplo.invalid/conta-pdf/0', '', 100, 10, 10, 110, `${mes}T12:00:00.000Z`]
  await page.route(/\/functions\/v1\/conta-diez-traspaso/, async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}') as { accion?: string }
    if (b.accion === 'excel') {
      return json(r, creadas
        ? { base: 'C0009', faltan: [], comprobadas: 14, emitidas: [fila('UBR-FLO-1'), fila('UBR-FLO-2')], recibidas: [fila('F-1')], por_la_api: [{ entry_id: '00000000-0000-0000-0000-000000000001', numero: 'F-9', motivo: 'lleva 3 tipos de IVA y el Excel admite 2 (Julio, 13/11: estas, por la API)' }] }
        : { base: 'C0009', faltan: [{ codigo: '47200010', nombre: 'IVA soportado 10 %' }, { codigo: '62300004', nombre: 'Servicios profesionales' }], comprobadas: 14, por_la_api: [] })
    }
    if (b.accion === 'crear_subcuentas') {
      creadas = true
      return json(r, { base: 'C0009', intentadas: 3, creadas: [{ codigo: '47200010', nombre: 'IVA soportado 10 %' }, { codigo: '62300004', nombre: 'CATCHER MARKETPLACE SERVICIOS DE PROFESIONALES', recortado: true }],
        no_creadas: [{ codigo: '70009001', nombre: 'PROMOCIONES UBER EATS', porque: 'Diez no ha aceptado la subcuenta: 400 · La subcuenta ya existe' }], faltan: [], otra_vez: 47 })
    }
    if (b.accion === 'importado') return json(r, { van_por_excel: 3, enlazadas: 3, faltan: [], dobles: [] })
    if (b.accion === 'comprobar') return json(r, { cuadra: true, cuadre: { cuadra: true, cuentas: 21, diferencias: [], solo_en_diez: [] }, mes_cerrado: false, motivo: null })
    return r.fulfill({ status: 400, body: '{}' })
  })
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  const excel = zona.getByLabel('Las facturas, por Excel')
  await expect(excel.getByRole('heading', { name: '2 · Descarga los dos Excel e impórtalos en Diez' })).toBeVisible()
  await expect(excel.getByText(/Importaciones › Importación desde fichero › Facturas/)).toBeVisible()
  await excel.getByRole('button', { name: 'Preparar los Excel' }).click()
  await expect(excel.getByText(/Faltan 2 subcuentas en Diez \(C0009\): sin ellas no se prepara ningún Excel\./)).toBeVisible()
  await expect(excel.getByTestId('traspaso-subcuentas-faltan')).toContainText('47200010')
  await expect(excel.getByRole('button', { name: /^Descargar/ })).toHaveCount(0)
  await capturar(page, 'b01r26-faltan-subcuentas')
  await excel.getByRole('button', { name: 'Crearlas en Diez' }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText('Queda apuntado quién las ha creado y cuándo.')).toBeVisible()
  await dialogo.getByRole('button', { name: 'Crearlas' }).click()
  // Regla 8: lo que ha hecho, una a una, y lo que espera vuelve al traspaso.
  const hechas = excel.getByTestId('traspaso-subcuentas-creadas')
  await expect(hechas.getByText(/62300004.*creada \(con el nombre recortado: Diez admite 60 caracteres\)/)).toBeVisible()
  await expect(hechas.getByText(/70009001.*no se ha creado\. Diez no ha aceptado la subcuenta: 400/)).toBeVisible()
  await expect(excel.getByText(/En Diez \(C0009\): creadas 2; 1 no \(abajo, por qué\)\. Ya están todas\. 47 asientos que esperaban vuelven al traspaso: pulsa «Seguir traspasando \w+»\./)).toBeVisible()
  await expect(excel.getByText(/Listos: 2 emitidas y 1 recibidas\./)).toBeVisible()
  await expect(excel.getByRole('button', { name: 'Descargar emitidas (2)' })).toBeVisible()
  await expect(excel.getByRole('button', { name: 'Descargar recibidas (1)' })).toBeVisible()
  await expect(excel.getByText('1 factura va por la API, sin PDF en Diez')).toBeVisible()
  const descarga = page.waitForEvent('download')
  await excel.getByRole('button', { name: 'Descargar emitidas (2)' }).click()
  expect((await descarga).suggestedFilename()).toBe(`diez-emitidas-${mes.slice(0, 7)}.xlsx`)
  await expect(excel.getByText(/Descargado el Excel de emitidas: 2 facturas, cada una con el enlace a su PDF\./)).toBeVisible()
  await capturar(page, 'b01r26-excel-listos')
  await excel.getByRole('button', { name: 'Ya lo he importado' }).click()
  await expect(zona.getByText(/Cuadra: 21 cuentas tienen en Diez lo mismo que en Sumied\./).first()).toBeVisible()
  await capturar(page, 'b01r26-importado')
})

test('A · B01r26 · plan B: las que no casan, con su porqué, y «Mandarlas por la API»', async ({ page }) => {
  const mes = mesAnterior()
  await conRevision(page, revision({
    traspaso: { id: 't1', mes, estado: 'traspasando', confirmado_por_nombre: 'Julio', confirmado_en: `${mes.slice(0, 7)}-28T09:00:00Z`, faltaba: [], van: 120, llegaron: 30, no_llegaron: 0,
      cuadre: null, cuadra: null, mes_cerrado: false, cierre_motivo: null, terminado_en: null },
  }))
  const E1 = '00000000-0000-0000-0000-0000000000b1'
  const E2 = '00000000-0000-0000-0000-0000000000b2'
  let llamadas = 0
  await page.route(/\/functions\/v1\/conta-diez-traspaso/, async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}') as { accion?: string; entry_ids?: string[] }
    if (b.accion === 'importado') {
      return json(r, { van_por_excel: 4, enlazadas: 2, dobles: [], faltan: [
        { entry_id: E1, numero: 'PRUEBA-0001', porque: 'En Diez hay una de la misma subcuenta y el mismo importe con otro número, «OTRO-1» (documento 2026.2.9001): mírala antes de mandarla.', en_diez: '2026.2.9001' },
        { entry_id: E2, numero: 'PRUEBA-0002', porque: 'No está en Diez: ni con su número ni con su subcuenta y su importe.', en_diez: null },
      ], sin_enlace_en_diez: [{ ref: '2026.2.9001', serie: '2', documento: 9001, numero: 'OTRO-1', cuenta: '41000099', fecha: 20261020, total: 37.6 }] })
    }
    if (b.accion === 'por_la_api') {
      llamadas++
      // La primera vuelta manda una y queda otra; la segunda, la que queda falla con su motivo.
      return json(r, llamadas === 1
        ? { llegaron: 1, fallaron: [], quedan: 1, fuera_de_la_lista: 0 }
        : { llegaron: 0, fallaron: [{ entry_id: E2, numero: 12, motivo: 'falta el documento' }], quedan: 0, fuera_de_la_lista: 1 })
    }
    if (b.accion === 'comprobar') return json(r, { cuadra: false, cuadre: { cuadra: false, cuentas: 21, diferencias: [], solo_en_diez: [] }, mes_cerrado: false, motivo: null })
    return r.fulfill({ status: 400, body: '{}' })
  })
  await entrarComo(page, CUENTA_A.email)
  await page.goto(RUTA)
  const zona = await elegirMesAnterior(page)
  const excel = zona.getByLabel('Las facturas, por Excel')
  await excel.getByRole('button', { name: 'Ya lo he importado' }).click()
  const faltan = excel.getByTestId('traspaso-faltan')
  await expect(faltan.getByText(/PRUEBA-0001: En Diez hay una de la misma subcuenta y el mismo importe con otro número, «OTRO-1»/)).toBeVisible()
  await expect(faltan.getByText(/PRUEBA-0002: No está en Diez/)).toBeVisible()
  await expect(excel.getByTestId('traspaso-sin-enlace')).toContainText('1 factura está en Diez sin enlace con Sumied')
  await excel.getByRole('button', { name: 'Mandarlas por la API (2)' }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText(/Si alguna es una de estas con otro número, bórrala antes en Diez/)).toBeVisible()
  await dialogo.getByRole('button', { name: 'Mandarlas' }).click()
  // Regla 8: lo que ha llegado, lo que no y por qué.
  await expect(excel.getByText(/Por la API: 1 factura ha llegado a Diez; 1 no \(abajo, por qué\)/)).toBeVisible()
  await expect(excel.getByLabel('Las que no han llegado por la API').getByText(/Asiento 12: falta el documento/)).toBeVisible()
  expect(llamadas).toBe(2)
  await capturar(page, 'b01r26-plan-b')
})
