// tests/e2e/conta/v03/corregir-y-cuadrar.spec.ts
//
// V03 · E3 · «Corregir y cuadrar» en pantalla, en el ordenador y en el móvil:
//   1. «Me he equivocado en…» (tablero 27) en una emitida de D: los tres
//      caminos dicen ANTES qué va a pasar; anular pide el motivo y ANULAR, y
//      después dice lo que ha pasado; subsanar enseña qué cambia; rectificar
//      abre el «Corregir» de la V01.
//   2. «Comprobar con Hacienda» en Facturas › Más: pedido, esperando y el
//      resultado, con cada factura que no cuadra y qué hacer.
//   3. Ajustes › Verifactu: «Comprobar la cadena» y «Exportar los registros»
//      (el CSV con lo que entra en cada huella).
//   4. El despacho de la asesoría (carril): «Comprobar con Hacienda» con el
//      selector de sus clientes con Verifactu.
// Staging no habla con la AEAT (no hay certificado de pruebas) y el candado
// no deja crear registros: lo que contesta la base para Verifactu está
// SIMULADO en el navegador (page.route), con la forma que devuelven las
// funciones de la 1750. Lo que hacen esas funciones en la base (anular con su
// contrasiento, subsanar, la cadena, el cuadre) lo prueba la prueba de staging
// de la tanda, en su transacción.
// Las capturas, en docs/conta/capturas/v03 (van al artefacto del run).

import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { CARRIL, CUENTA_D, STAGING_URL, anonKey, correoDePrueba, enCarril, entrarComo, pedirSesion } from '../sesion'
import { rest } from '../api'

const DIR = 'docs/conta/capturas/v03'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')
const foto = (page: Page, nombre: string) => page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
  return errores
}
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
const cuerpo = (r: Route) => (r.request().postDataJSON() ?? {}) as Record<string, unknown>

const ahora = () => new Date().toISOString()
const MES = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date())

/** D en pruebas, con su última emitida «recibida» por Hacienda. */
async function emitidaDeD(page: Page) {
  const s = await pedirSesion(CUENTA_D.email)
  const emitidas = await rest<{ id: string; number_text: string; company_id: string; issue_date: string }[]>(s, 'GET',
    `customer_invoice?select=id,number_text,company_id,issue_date&account_id=eq.${CUENTA_D.id}&status=eq.emitida&order=issued_at.desc&limit=5`)
  const f = emitidas.datos[0]
  if (!f) return null
  const hace = new Date(Date.now() - 3 * 3600_000).toISOString()
  await page.route(/\/rest\/v1\/verifactu_empresa\b/, (r) => json(r, [{ company_id: f.company_id, account_id: CUENTA_D.id, modo: 'pruebas', via: 'colaborador', certificate_id: null, pruebas_desde: hace, real_desde: null, real_serie: null, real_obliga_hasta: null, otros_programas: [] }]))
  const fila = (id: string) => ({ invoice_id: id, account_id: CUENTA_D.id, company_id: f.company_id, estado: 'correcto', entorno: 'pruebas', registro_id: `r-${id}`, huella: null,
    codigo_error: null, descripcion_error: null, generado_at: hace, respondido_at: hace, intentos: 1, proximo_intento_at: hace, url_qr: null })
  await page.route(/\/rest\/v1\/verifactu_factura_estado\b/, (r) => {
    const una = /invoice_id=eq\.([0-9a-f-]{36})/.exec(r.request().url())?.[1]
    return json(r, una ? [fila(una)] : emitidas.datos.map((x) => fila(x.id)))
  })
  return { ...f, hace }
}

test('«Me he equivocado en…»: cada camino dice antes qué pasa, y después qué ha pasado', async ({ page }) => {
  const errores = vigilar(page)
  const f = await emitidaDeD(page)
  test.skip(!f, 'D no tiene ninguna emitida (la crea «sin IVA a Suiza» o la V01, en su carril).')
  const { id, number_text: num, hace } = f!
  await page.route(/\/rest\/v1\/verifactu_registro\b/, (r) => json(r, [{ id: `r-${id}`, tipo: 'alta', subsanacion: false, estado: 'correcto', generado_at: hace, respondido_at: hace, codigo_error: null, descripcion_error: null, envio_id: null }]))
  const pedidos: Record<string, unknown>[] = []
  await page.route(/\/rest\/v1\/rpc\/verifactu_previsto\b/, (r) => {
    const b = cuerpo(r)
    pedidos.push(b)
    const a = String(b.p_accion)
    if (a === 'rectificar') return json(r, { accion: a, puede: true, numero: num, cambios: [], aviso: 'Es lo que toca si tu cliente tiene la factura y algo de ella está mal: importes, líneas o sus datos.',
      frase: `Se prepara una rectificativa de la ${num} (serie R), enlazada a ella. Al emitirla lleva su número, su PDF y su asiento, y Hacienda recibe su alta como rectificativa por diferencias (R4). La ${num} no cambia ni se borra: tu cliente recibe la rectificativa.` })
    if (a === 'anular') return json(r, { accion: a, puede: true, numero: num, cambios: [], aviso: 'Solo si no tenía que haberse emitido: un duplicado, una prueba, la que se hizo a otro cliente antes de mandársela. Si tu cliente la tiene, se corrige con una rectificativa.',
      frase: `La ${num} queda anulada: no cuenta en tus ventas ni en el IVA de ${MES.slice(5)}/${MES.slice(0, 4)}, su asiento nº 7 se deshace con un contrasiento del mismo día, y Hacienda recibe un registro de anulación. Su número no se vuelve a usar.` })
    const d = (b.p_cambios as { descripcion?: string } | null)?.descripcion
    if (!d) return json(r, { accion: a, puede: false, numero: num, cambios: [], aviso: null, frase: `No hay nada que subsanar: lo que tiene Hacienda es lo que dice la ${num}. Si lo que está mal es la factura, es una rectificativa.` })
    return json(r, { accion: a, puede: true, numero: num, aviso: null, cambios: [{ campo: 'descripcion', que: 'La descripción', antes: 'Comidas', despues: d }],
      frase: `Hacienda recibe un registro nuevo de la ${num} que sustituye al que tiene (una subsanación). La factura de tu cliente no cambia: ni su número, ni sus importes, ni su PDF.` })
  })
  let anulada: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/verifactu_anular_factura\b/, (r) => { anulada = cuerpo(r); return json(r, { numero: num, registro_id: 'x', estado: 'pendiente', sin_registro_previo: false, contraasiento: 'y', numero_contraasiento: 8, numero_anulado: 7 }) })
  let subsanada: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/verifactu_subsanar\b/, (r) => { subsanada = cuerpo(r); return json(r, { numero: num, registro_id: 'z', estado: 'pendiente', rechazo_previo: null, cambios: [{ campo: 'descripcion', que: 'La descripción', antes: 'Comidas', despues: 'Menú del día' }] }) })
  await entrarComo(page, CUENTA_D.email)
  await page.goto(`/conta/ventas/facturas/${id}`)

  const equivocado = page.locator('[data-prueba="me-he-equivocado"]')
  await expect(equivocado).toBeVisible({ timeout: 30_000 })
  await equivocado.locator('summary').click()
  await expect(equivocado.getByRole('button')).toHaveText(['La factura de mi cliente está mal', 'No tenía que haberla emitido', 'Solo está mal lo que tiene Hacienda'])
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'e3-me-he-equivocado')

  // Rectificar: lo que va a pasar, y abre el «Corregir» de la V01.
  await equivocado.getByRole('button', { name: 'La factura de mi cliente está mal' }).click()
  let dialogo = page.getByRole('dialog', { name: 'La factura de mi cliente está mal' })
  await expect(dialogo.locator('[data-prueba="previsto"]')).toContainText(`Lo que va a pasar: Se prepara una rectificativa de la ${num}`)
  await dialogo.getByRole('button', { name: 'Hacer la rectificativa' }).click()
  await expect(page.getByRole('dialog').filter({ hasText: /rectificativa|Corregir/i }).first()).toBeVisible()
  await page.keyboard.press('Escape')

  // Anular: el motivo y ANULAR antes de dejar pulsar; después, lo que ha pasado.
  await equivocado.getByRole('button', { name: 'No tenía que haberla emitido' }).click()
  dialogo = page.getByRole('dialog', { name: 'No tenía que haberla emitido' })
  await expect(dialogo.locator('[data-prueba="previsto"]')).toContainText(`La ${num} queda anulada: no cuenta en tus ventas ni en el IVA`)
  const boton = dialogo.getByRole('button', { name: `Anular la ${num}` })
  await expect(boton).toBeDisabled()
  await dialogo.getByLabel('Por qué no tenía que emitirse').fill('La hice dos veces')
  await expect(boton).toBeDisabled()
  await dialogo.getByLabel('Escribe ANULAR').fill('anular')
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'e3-anular-antes')
  await boton.click()
  await expect(page.locator('[data-prueba="aviso-reenvio"]')).toContainText(`Anulada la ${num}: su asiento nº 7 queda deshecho con el nº 8 (mismo día)`, { timeout: 30_000 })
  expect(anulada).toMatchObject({ p_invoice: id, p_motivo: 'La hice dos veces', p_confirmacion: 'ANULAR' })

  // Subsanar: sin cambios no se puede; con otra descripción, dice qué cambia.
  // Después de anular, la ficha vuelve a leer: el desplegable puede haberse cerrado.
  if (!(await equivocado.getByRole('button', { name: 'Solo está mal lo que tiene Hacienda' }).isVisible())) await equivocado.locator('summary').click()
  await equivocado.getByRole('button', { name: 'Solo está mal lo que tiene Hacienda' }).click()
  dialogo = page.getByRole('dialog', { name: 'Solo está mal lo que tiene Hacienda' })
  await expect(dialogo.locator('[data-prueba="previsto"]')).toContainText('No se puede: No hay nada que subsanar')
  await dialogo.getByLabel('Descripción de la operación (opcional)').fill('Menú del día')
  await expect(dialogo.locator('[data-prueba="previsto-cambios"]')).toContainText('La descripción: «Comidas» → «Menú del día»', { timeout: 10_000 })
  await dialogo.getByRole('button', { name: 'Mandar el registro nuevo' }).click()
  await expect(page.locator('[data-prueba="aviso-reenvio"]')).toContainText(`Subsanada la ${num} en Hacienda: sale un registro nuevo en el próximo envío, que cambia la descripción.`, { timeout: 30_000 })
  expect(subsanada).toMatchObject({ p_invoice: id, p_descripcion: 'Menú del día' })
  expect(pedidos.map((p) => p.p_accion)).toEqual(expect.arrayContaining(['rectificar', 'anular', 'subsanar']))
  expect(errores).toEqual([])
})

/** Un cuadre de ese mes, con la forma de verifactu_cuadre_ver. */
const cuadre = (estado: string, resultado: unknown) => ({
  id: 'cu1', entorno: 'pruebas', ejercicio: Number(MES.slice(0, 4)), periodo: MES.slice(5), estado, pedido_at: new Date(Date.now() - 20_000).toISOString(), pedido_por: 'Admin D',
  empezado_at: estado === 'pedido' ? null : ahora(), terminado_at: estado === 'hecho' ? ahora() : null, paginas: estado === 'hecho' ? 1 : 0, error: null, resultado,
})
const DESCUADRE = {
  hacienda: 3, cuadran: 2, en_camino: 1, rechazadas: 0, ok: false, mes: MES, cuadrado_at: ahora(),
  falta_en_hacienda: [], solo_en_hacienda: [{ num_serie: 'TPV-0001', fecha: `${MES}-03`, estado: 'Correcto', importe: 12.1 }],
  distintas: [{ num_serie: 'F-2026/000009', fecha: `${MES}-04`, invoice_id: null, que: 'importe', sumied: { estado: 'Correcto', importe: 121, huella: 'A' }, hacienda: { estado: 'Correcto', importe: 126, huella: 'A', codigo: null, descripcion: null } }],
}

test('«Comprobar con Hacienda» en Facturas › Más: esperando y el resultado, con qué hacer', async ({ page }) => {
  const errores = vigilar(page)
  const f = await emitidaDeD(page)
  test.skip(!f, 'D no tiene ninguna emitida.')
  let vez = 0
  await page.route(/\/rest\/v1\/rpc\/verifactu_cuadre_ver\b/, (r) => {
    const b = cuerpo(r)
    if (!b.p_cuadre) return json(r, null)
    vez++
    return json(r, vez < 2 ? cuadre('consultando', null) : cuadre('hecho', DESCUADRE))
  })
  let pedido: Record<string, unknown> | null = null
  await page.route(/\/rest\/v1\/rpc\/verifactu_cuadre_pedir\b/, (r) => { pedido = cuerpo(r); return json(r, { id: 'cu1', ya_estaba: false, entorno: 'pruebas', estado: 'pedido' }) })
  await entrarComo(page, CUENTA_D.email)
  await page.goto('/conta/ventas/facturas')
  await expect(page.getByRole('heading', { level: 1, name: 'Facturas' })).toBeVisible({ timeout: 30_000 })
  await page.locator('header.s-encabezado').getByRole('button', { name: 'Más acciones', exact: true }).click()
  await page.getByRole('group', { name: 'Más acciones', exact: true }).getByText('Comprobar con Hacienda').click()
  const dialogo = page.getByRole('dialog', { name: 'Comprobar con Hacienda' })
  await expect(dialogo.locator('[data-prueba="cuadre"]')).toContainText('Ese mes todavía no se ha comprobado.', { timeout: 20_000 })
  await dialogo.getByRole('button', { name: 'Preguntar a Hacienda' }).click()
  await expect(dialogo.locator('[data-prueba="cuadre-titulo"]')).toContainText('Hacienda está contestando por', { timeout: 20_000 })
  await expect(dialogo.locator('[data-prueba="cuadre-titulo"]')).toContainText('no cuadra con Hacienda (entorno de pruebas de Hacienda)', { timeout: 20_000 })
  await expect(dialogo.locator('[data-prueba="cuadre"]')).toContainText('Hacienda tiene 1 registro que no es de Sumied; 1 factura no dice lo mismo en los dos sitios. 2 cuadran. 1 registro está de camino')
  const filas = dialogo.locator('[data-prueba="cuadre-descuadre"] li')
  await expect(filas).toHaveCount(2)
  await expect(filas.nth(0)).toContainText('Hacienda tiene otro importe: 126 €, y en Sumied 121 €.')
  await expect(filas.nth(1)).toContainText('otro programa')
  expect(pedido).toMatchObject({ p_company: f!.company_id, p_mes: `${MES}-01`, p_desde_account: null })
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'e3-comprobar-con-hacienda')
  expect(errores).toEqual([])
})

test('Ajustes › Verifactu: comprobar la cadena y exportar los registros', async ({ page }) => {
  const errores = vigilar(page)
  const f = await emitidaDeD(page)
  test.skip(!f, 'D no tiene ninguna emitida.')
  await page.route(/\/rest\/v1\/rpc\/verifactu_comprobar_cadena\b/, (r) => json(r, {
    ok: false, registros: 3, problemas: 1, comprobada_at: ahora(), frase: 'La cadena tiene 1 problema en 3 registros: abajo, cuál y dónde.',
    cadenas: [{ entorno: 'pruebas', nif: 'B12345682', registros: 3, de_otras_empresas: 0, desde: f!.hace, hasta: ahora(), ok: false, problemas_total: 1,
      problemas: [{ registro: 'r3', num_serie: f!.number_text, tipo: 'alta', que: 'no_sigue', frase: `El registro de la ${f!.number_text} no sigue al de la F-2026/000001: falta uno entre los dos, o se ha tocado.` }] }],
  }))
  const reg = (n: number, anterior: string | null) => ({
    entorno: 'pruebas', tipo: 'alta', subsanacion: false, rechazo_previo: null, sin_registro_previo: false, nif_emisor: 'B12345682', num_serie: `F-2026/00000${n}`,
    fecha_expedicion: `${MES}-0${n}`, tipo_factura: 'F1', cuota_total: 21, importe_total: 121, primer_registro: anterior === null, anterior_num_serie: anterior, anterior_fecha: anterior ? `${MES}-01` : null,
    huella_anterior: anterior ? 'A'.repeat(64) : null, fecha_hora_huso: `${MES}-0${n}T10:00:00+02:00`, generado_at: `${MES}-0${n}T08:00:00Z`,
    cadena_huella: `IDEmisorFactura=B12345682&NumSerieFactura=F-2026/00000${n}&…`, huella: String(n).repeat(64), estado: 'correcto', codigo_error: null, descripcion_error: null, csv: null, respondido_at: null, id: `r${n}`,
  })
  await page.route(/\/rest\/v1\/verifactu_registro\b/, (r) => json(r, [reg(1, null), reg(2, 'F-2026/000001')]))
  await entrarComo(page, CUENTA_D.email)
  await page.goto('/conta/ajustes/verifactu')
  await expect(page.getByRole('heading', { level: 1, name: 'Verifactu: tus facturas, directas a Hacienda' })).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-prueba="comprobar-cadena"]').click()
  const cadena = page.locator('[data-prueba="cadena"]')
  await expect(cadena).toContainText('La cadena no está entera', { timeout: 20_000 })
  await expect(cadena).toContainText(`El registro de la ${f!.number_text} no sigue al de la F-2026/000001`)
  await expect(cadena).toContainText('3 registros')
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'e3-cadena')
  const [bajada] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'En CSV' }).click()])
  expect(bajada.suggestedFilename()).toMatch(/\.csv$/)
  const texto = readFileSync(await bajada.path(), 'utf8')
  expect(texto).toContain('Lo que entra en la huella')
  expect(texto).toContain('IDEmisorFactura=B12345682&NumSerieFactura=F-2026/000002&')
  await expect(page.locator('[data-prueba="aviso-registros"]')).toContainText('2 registros, en el orden de la cadena')
  expect(errores).toEqual([])
})

test('el despacho: «Comprobar con Hacienda» de un cliente con Verifactu', async ({ page }) => {
  test.skip(CARRIL === null, 'La asesoría de demo vive en el carril.')
  const errores = vigilar(page)
  // Impuestos encendido para la asesoría de este carril, como en la e2e del despacho (P01).
  const plataforma = await pedirSesion(correoDePrueba('c06.plataforma@c06-prueba.test'))
  const flag = await fetch(`${STAGING_URL}/rest/v1/feature_flags?on_conflict=account_id,feature_key`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${plataforma.access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: enCarril('d5ac0000-0000-4000-8000-0000000000a0'), feature_key: 'conta_impuestos', enabled: true, source: 'manual_grant', grant_reason: 'e2e V03 E3 (carril)' }),
  })
  expect(flag.ok, `feature_flags: HTTP ${flag.status}`).toBe(true)
  const empresas = [{ company_id: 'e0000000-0000-4000-8000-000000000001', nombre: 'Bar Uno', nif: 'B00000001', modo: 'real' }, { company_id: 'e0000000-0000-4000-8000-000000000002', nombre: 'Bar Dos', nif: 'B00000002', modo: 'pruebas' }]
  await page.route(/\/rest\/v1\/rpc\/verifactu_despacho_empresas\b/, (r) => json(r, empresas))
  const vistos: Record<string, unknown>[] = []
  await page.route(/\/rest\/v1\/rpc\/verifactu_cuadre_ver\b/, (r) => {
    const b = cuerpo(r)
    vistos.push(b)
    return json(r, b.p_company === empresas[1].company_id
      ? cuadre('hecho', { ...DESCUADRE, hacienda: 4, cuadran: 4, en_camino: 0, solo_en_hacienda: [], distintas: [], ok: true })
      : null)
  })
  await entrarComo(page, correoDePrueba('p01.laura@p01-prueba.test'))
  await page.goto('/conta/impuestos/clientes?marca=sumied')
  await expect(page.getByRole('heading', { name: 'Impuestos de tus clientes' })).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-prueba="despacho-comprobar-hacienda"]').click()
  const dialogo = page.getByRole('dialog', { name: 'Comprobar con Hacienda' })
  await expect(dialogo.getByLabel('Empresa')).toBeVisible()
  await dialogo.getByLabel('Empresa').selectOption({ label: 'Bar Dos' })
  await expect(dialogo.locator('[data-prueba="cuadre-titulo"]')).toContainText('cuadra con Hacienda (entorno de pruebas de Hacienda)', { timeout: 20_000 })
  await expect(dialogo.locator('[data-prueba="cuadre"]')).toContainText('Hacienda tiene 4 registros')
  // Pregunta como la asesoría: con su cuenta, por la empresa que lleva.
  expect(vistos.at(-1)).toMatchObject({ p_company: empresas[1].company_id })
  expect(vistos.at(-1)?.p_desde_account).toBeTruthy()
  await page.evaluate(() => document.fonts.ready)
  await foto(page, 'e3-despacho-comprobar')
  expect(errores).toEqual([])
})
