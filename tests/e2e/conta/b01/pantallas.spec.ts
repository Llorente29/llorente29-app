/// <reference lib="dom" />
// tests/e2e/conta/b01/pantallas.spec.ts
//
// B01 · tarea 5: las pantallas de Bancos en staging-conta, cuenta A, en
// ordenador (1440) y móvil (390). Antes de mirar, prepara lo mismo que la
// demostración del motor (el Norma 43 inventado de los tres bancos B01, ver
// datos.ts), da de alta UNA tarjeta de débito (···0937, «Ana Prueba», en
// Banco B01 · Norte) y concilia. Las capturas van a docs/conta/capturas/b01/
// pantallas/ para compararlas con N17Bancos. Al acabar, DESHACE todo: los
// casados, las propuestas y la tarjeta; el libro de A con los mismos asientos
// que antes (mismo recuento, misma vara: regla 31).

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { FLOTANTES_CONTA, loQueTapan } from '../solapes'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA, conLimpieza } from './datos'

const DIR = 'docs/conta/capturas/b01/pantallas'
const NORTE = BANCOS_B01[0]
const MERCADO = BANCOS_B01[2]
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

/** Una pieza sola (la banda del agente), para verla de cerca. */
async function capturarPieza(page: Page, selector: string, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.locator(selector).first().screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png` })
}

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  // Nada flotante tapa contenido (respuesta 4). Desde el S01c no flota nada ni
  // en el ordenador (sin la barra de «Muy pronto») ni en el móvil (el menú es un
  // cajón); si alguna pantalla vuelve a pintar una pieza flotante, se mide.
  if (await page.locator(FLOTANTES_CONTA.join(', ')).count() > 0) expect(await loQueTapan(page, '.cx-principal', FLOTANTES_CONTA)).toEqual([])
}

/** Un importe cortado con «…» esconde lo que la pantalla existe para enseñar (respuesta 4: el cierre en el móvil decía «44.237,8…»). */
async function importesCortados(page: Page): Promise<string[]> {
  return page.locator('.cxb-cifra-valor').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent ?? ''))
}

/**
 * S02 · PR 2: el cierre del mes del banco ya no es una página de Bancos. La dirección de antes
 * (bancos/cierre) lleva a Contabilidad › Cierre y Registro › Cerrar el mes con su mes y su banco,
 * y allí, debajo de «La contabilidad, mes a mes», están «Los bancos, en octubre de 2026».
 */
async function irAlCierreDelBanco(page: Page) {
  await page.goto(`/conta/bancos/cierre?banco=${NORTE}&mes=2026-10`)
  await expect(page).toHaveURL(new RegExp(`/conta/libros/cierre/cerrar-mes\\?mes=2026-10&banco=${NORTE}`))
  await expect(page.getByRole('heading', { name: 'La contabilidad, mes a mes', level: 3 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Los bancos, en octubre de 2026', level: 3 })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Mes de los bancos' })).toHaveValue('2026-10')
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

/** Como la demostración del motor, con la tarjeta de Ana dada de alta. */
async function preparar() {
  const base = await baseDeA()
  await base.deshacerTodo('Limpieza antes de las pantallas B01')
  const asientosAntes = await base.contarAsientosA()
  const bancos = crearBancos(base.bd)
  const abierto = { nombre: 'b01-tres-cuentas.n43', sha256: createHash('sha256').update(FICHERO).digest('hex'), contenido: { texto: FICHERO } }
  const { extracto, cuadre } = leerYCuadrar(abierto)
  const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
  await bancos.importar(abierto, extracto, cuadre, emparejar(extracto, mios))
  await base.bd.rpc('bank_tarjeta_guardar', { p_treasury: NORTE, p_id: null, p_last4: '0937', p_titular: 'Ana Prueba', p_local: null, p_comun: true })
  const r = await bancos.conciliarPendientes(CUENTA_A.id, EMPRESA_A, '2026-10-13')
  expect(r.fallos).toEqual([])
  // Como «Subir extracto»: la pasada del agente queda registrada con su resumen (la banda la enseña).
  await base.bd.rpc('bank_agente_registrar', { p_company: EMPRESA_A, p_disparo: 'extracto',
    p_resultado: { casados: r.casadosSolos, propuestos: r.propuestos, por_aclarar: r.porAclarar, antes_corte: r.antesDelCorte, fallos: 0 } })
  return { ...base, asientosAntes }
}

test.describe('B01 · Bancos, las pantallas', () => {
  test.describe.configure({ timeout: 240_000 })

  test('ordenador: N17 en tres niveles, las cinco sin maqueta y los botones que confirman', async ({ page }) => {
    test.skip(lado(page) !== 'ordenador', 'En el móvil va su prueba.')
    const base = await preparar()
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
      // S02 · PR 2: cada página de Bancos pinta su encabezado (EncabezadoPagina); el h1, visible, es
      // el nombre de la página («Movimientos»), no el del apartado.
      const encabezado = page.locator('header.s-encabezado')
      await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
      // S02: las pestañas de la cabecera ya no existen; las páginas de Bancos salen debajo del
      // apartado, en la barra, todas a la vista y en el orden del mapa. PR 2: «Cierre del mes» ya
      // no es de Bancos (vive en Contabilidad › Cierre y Registro › Cerrar el mes).
      const paginas = page.getByRole('navigation', { name: 'Menú de contabilidad' }).getByRole('list', { name: 'Páginas de Bancos' })
      await expect(paginas.getByRole('link')).toHaveText(['Movimientos', 'Préstamos y aplazamientos', 'Cuentas y extractos', 'Reglas'])
      for (const l of await paginas.getByRole('link').all()) await expect(l).toBeVisible()
      // El mes, en el botón del periodo de la cabecera (S02: «Octubre 2026», el formato de todas).
      await expect(page.locator('.s-cab-periodo').getByRole('combobox', { name: 'Mes' })).toHaveValue('2026-10')
      await expect(page.locator('.s-cab-periodo').getByRole('combobox', { name: 'Mes' }).locator('option:checked')).toHaveText('Octubre 2026')
      await expect(paginas.getByRole('link', { name: 'Movimientos' })).toHaveAttribute('aria-current', 'page')
      // S02 · PR 2: las acciones, en el encabezado (bancos/acciones.ts). «Tus bancos» es un selector
      // (solo en Movimientos, la única página de UN banco); «Subir extracto», el principal; «Reglas»
      // y «Lo que he hecho», los dos blancos. «Casados solos» no sale aquí: en Movimientos es una
      // de sus bandejas. Con todo a la vista no queda nada para «Más acciones». «Tuyos» sigue sin
      // estar: Favoritos y Ctrl K son del marco. Ya no hay fila de acciones del marco: nada sale dos veces.
      await expect(page.getByRole('toolbar', { name: 'Acciones de Movimientos' })).toHaveCount(0)
      const selectorBancos = encabezado.getByRole('button', { name: /^Tus bancos: B01 Norte.*\. Cambiar$/ })
      await expect(selectorBancos).toBeVisible()
      await expect(page.getByRole('group', { name: 'Tuyos' })).toHaveCount(0)
      const subir = encabezado.getByRole('button', { name: 'Subir extracto' })
      await expect(subir).toBeVisible()
      await expect(subir).toHaveClass(/s-boton-principal/)
      await expect(encabezado.locator('.s-boton-principal')).toHaveCount(1)
      const loHecho = encabezado.getByRole('link', { name: /^Lo que he hecho/ })
      await expect(encabezado.getByRole('link', { name: /^Reglas/ })).toBeVisible()
      await expect(loHecho).toBeVisible()
      await expect(encabezado.getByRole('link', { name: /^Casados solos/ })).toHaveCount(0)
      await expect(encabezado.getByRole('button', { name: 'Más acciones' })).toHaveCount(0)
      // Respuesta 4: las acciones en UNA fila (S02: el selector, un blanco y el principal, con el
      // centro a la misma altura).
      const centros = await Promise.all([selectorBancos, loHecho, subir]
        .map(async (l) => { const c = (await l.boundingBox())!; return c.y + c.height / 2 }))
      expect(Math.max(...centros) - Math.min(...centros)).toBeLessThan(4)
      // El banco que se ve es el actual dentro del selector (S02: 'true' en la entrada del menú).
      await selectorBancos.click()
      await expect(page.getByRole('group', { name: 'Tus bancos' }).getByRole('link', { name: /^B01 Norte/ })).toHaveAttribute('aria-current', 'true')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('group', { name: 'Tus bancos' })).toHaveCount(0)
      await expect(page.getByText('Conectar')).toHaveCount(0)
      await expect(page.locator('.cx-pregunta')).toHaveCount(0)
      // Lo que no funciona no se enseña (respuesta 3, punto 4).
      await expect(page.getByText('Por correo')).toHaveCount(0)
      await expect(page.getByText(/crédito/i)).toHaveCount(0)

      // La banda, el cuadre (B02: en el banco − en contabilidad = te falta por casar) y la lista.
      await expect(page.getByText(/^He casado yo 3 de 8 movimientos de octubre\./)).toBeVisible()
      // S02 · PR 3: el extracto es «Según el banco» (las palabras del Inicio).
      for (const c of ['Según el banco', 'En contabilidad', 'Te falta por casar']) await expect(page.locator('.cxb-cifra-etiqueta', { hasText: c })).toBeVisible()
      await expect(page.getByText(/· tarjeta de Ana Prueba \(···0937\)/)).toBeVisible()
      await expect(page.getByText(/Tarjeta de Ana \(···0937\)|pídele el ticket a Ana/).first()).toBeVisible()
      // Las migas, sin caracteres raros; un solo botón principal por fila; y la banda del agente.
      // S02 · PR 2: las migas son las del encabezado (Bancos › Movimientos); el banco y el mes, en su frase.
      await expect(encabezado.getByRole('navigation', { name: 'Estás en' }).getByRole('listitem')).toHaveText(['Bancos', 'Movimientos'])
      await expect(encabezado.locator('.s-frase-pagina')).toHaveText('Banco B01 · Norte ···0011, octubre: lo que trae el banco, para casarlo con contabilidad.')
      await expect(page.locator('.cxn-fila', { hasText: 'Comision mantenimiento' }).getByRole('button', { name: 'Sí', exact: true })).toHaveClass('cx-boton')
      await expect(page.locator('.cxn-fila', { hasText: 'Transferencia recibida' }).getByRole('button', { name: 'Decirlo yo' })).toHaveClass('cx-boton')
      await expect(page.locator('.cxn-fila', { hasText: 'GLOVO' }).getByRole('button', { name: 'Ver' })).toHaveClass('cx-boton-sec')
      await expect(page.getByTestId('pasada-agente')).toContainText(/^Mi última pasada por todos tus bancos y todos los meses, hoy a las \d\d:\d\d \(al subir un extracto\): He casado yo \d+; te propongo \d+ y quedan \d+ por aclarar\.$/)
      // Con la apertura de la semilla, lo que falta por casar es exactamente lo que queda sin casar.
      await expect(page.getByTestId('cuadre')).toContainText('2.175,50 €')
      await expect(page.getByTestId('cuadre')).toContainText('son justo los movimientos sin casar')
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'movimientos')
      await capturarPieza(page, '.cxb-banda', 'banda-agente')

      // «Sí» confirma con contenido, y «Deshacer» lo devuelve (regla 8).
      const comision = page.locator('.cxn-fila', { hasText: 'Comision mantenimiento' })
      await comision.getByRole('button', { name: 'Sí', exact: true }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Casado: Comisión del banco')
      await page.locator('.cxn-fila', { hasText: 'Comision mantenimiento' }).getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Deshecho: el movimiento del 03/10')

      // Por aclarar, y la tarjeta que nadie ha dado de alta (respuesta 3).
      await page.getByRole('button', { name: /^Por aclarar \d+$/ }).click()
      await capturar(page, 'por-aclarar')
      // S02 · PR 2: el otro banco se elige en el selector «Tus bancos» del encabezado.
      await encabezado.getByRole('button', { name: /^Tus bancos: .*\. Cambiar$/ }).click()
      await page.getByRole('group', { name: 'Tus bancos' }).getByRole('link', { name: /^B01 Mercado/ }).click()
      // B02: la tarjeta sin dar de alta la anota el motor (se pregunta una vez por tarjeta, no en cada pago).
      await expect(page.locator('.cxn-fila', { hasText: 'FERRETERIA' })).toContainText('tarjeta ···1234 sin dar de alta')
      await expect(page.locator('.cxn-fila', { hasText: 'FERRETERIA' }).getByRole('button', { name: 'Dar de alta la tarjeta' })).toBeVisible()
      await expect(encabezado.getByRole('button', { name: /^Tus bancos: B01 Mercado.*\. Cambiar$/ })).toBeVisible()
      await expect(encabezado.locator('.s-frase-pagina')).toHaveText(/^Banco B01 · Mercado/)
      await capturar(page, 'tarjeta-desconocida')

      // Reglas.
      // S02: la página Reglas, en la barra (no el botón blanco «Reglas» del encabezado, que lleva su número).
      await paginas.getByRole('link', { name: 'Reglas' }).click()
      // S02 · PR 2: el título es el h1 del encabezado. Una página no se ofrece a sí misma (sin el
      // blanco «Reglas»), y el selector de bancos y el mes solo salen donde se leen (Movimientos).
      await expect(page.getByRole('heading', { name: 'Reglas', level: 1 })).toBeVisible()
      await expect(encabezado.getByRole('link', { name: /^Reglas/ })).toHaveCount(0)
      await expect(encabezado.getByRole('button', { name: /^Tus bancos: / })).toHaveCount(0)
      await expect(page.locator('.s-cab-periodo').getByRole('combobox', { name: 'Mes' })).toHaveCount(0)
      await expect(encabezado.getByRole('button', { name: 'Subir extracto' })).toHaveClass(/s-boton-principal/)
      await expect(page.getByRole('form', { name: 'Regla nueva' })).toBeVisible()
      await expect(page.getByText('Mirando lo que se repite…')).toHaveCount(0, { timeout: 30_000 })
      await capturar(page, 'reglas')

      // El gesto único: soltar el Norma 43 en una pantalla de Bancos que no es «Subir».
      await page.locator('.cxb-pagina').evaluate((el, texto) => {
        const dt = new DataTransfer()
        dt.items.add(new File([texto], 'b01-tres-cuentas.n43', { type: 'text/plain' }))
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      }, FICHERO)
      // S02 · PR 2: «Subir extracto» con su encabezado (y sin principal: la página entera es esa acción).
      await expect(page.getByRole('heading', { name: 'Subir extracto', level: 1 })).toBeVisible()
      await expect(encabezado.locator('.s-boton-principal')).toHaveCount(0)
      await expect(page.getByText('He leído 3 cuentas, 15 movimientos, del 02/10 al 13/10; cuadra con el saldo del banco.')).toBeVisible()
      await expect(page.getByText('«b01-tres-cuentas.n43» · 3 cuentas')).toBeVisible()
      await capturar(page, 'subir-leido')
      await page.getByRole('button', { name: 'Subir las 3 cuentas' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Subido «b01-tres-cuentas.n43».')
      await expect(page.getByText(/^Después los he mirado: he casado yo/)).toBeVisible()
      await capturar(page, 'subir-hecho')

      // Cuentas y extractos, con la tarjeta de Ana.
      await page.goto(`/conta/bancos/cuentas?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Cuentas y extractos', level: 1 })).toBeVisible()
      // S02 · PR 2: «+ Nuevo banco o tarjeta» es el primer blanco del encabezado (antes, un segundo
      // azul dentro de la página) y abre su diálogo; «Casados solos», el otro blanco; «Reglas» y
      // «Lo que he hecho», en «Más acciones», con el título de su grupo.
      await expect(encabezado.getByRole('button', { name: '+ Nuevo banco o tarjeta' })).toBeVisible()
      await expect(encabezado.getByRole('link', { name: /^Casados solos/ })).toBeVisible()
      await encabezado.getByRole('button', { name: 'Más acciones' }).click()
      const automatico = page.getByRole('group', { name: 'Más acciones' }).getByRole('group', { name: 'Lo automático' })
      await expect(automatico.getByRole('link', { name: /^Reglas/ })).toBeVisible()
      await expect(automatico.getByRole('link', { name: /^Lo que he hecho/ })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('group', { name: 'Más acciones' })).toHaveCount(0)
      await expect(page.getByText('Tarjeta ···0937 · Ana Prueba')).toBeVisible()
      await expect(page.getByText('Solo los 4 últimos dígitos: el número entero no se guarda nunca.').first()).toBeVisible()
      await capturar(page, 'cuentas')

      // Desde la fila de la tarjeta desconocida: el alta viene con sus 4 dígitos puestos.
      await page.goto(`/conta/bancos/cuentas?banco=${MERCADO}&tarjeta=1234&mes=2026-10`)
      await expect(page.getByRole('form', { name: 'Añadir una tarjeta a Banco B01 · Mercado' }).getByLabel('Últimos 4 dígitos')).toHaveValue('1234')

      // Cierre del mes y «Lo que he hecho» (B02: sin la marca, en primera persona).
      // S02 · PR 2: el cierre del mes del banco se mudó a Contabilidad › Cierre y Registro › Cerrar
      // el mes, junto al de la contabilidad; la dirección de antes lleva allí con su mes y su banco.
      await irAlCierreDelBanco(page)
      await expect(page.getByText('Octubre aún no ha terminado: el banco se cierra a partir del día 1 del mes siguiente.')).toBeVisible()
      await expect(page.getByRole('article', { name: 'Cierre de Banco B01 · Norte' })).toContainText('la explican los movimientos sin casar')
      // El banco por el que se llega va el primero.
      await expect(page.getByTestId('cierre-bancos').getByRole('article').first()).toHaveAttribute('aria-label', 'Cierre de Banco B01 · Norte')
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'cierre')
      await page.goto(`/conta/bancos/hecho?banco=${NORTE}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Lo que he hecho', level: 1 })).toBeVisible()
      // S02 · PR 2: «Lo que he hecho» lee el mes (sale en la cabecera) y es de todos los bancos (sin selector).
      await expect(page.locator('.s-cab-periodo').getByRole('combobox', { name: 'Mes' })).toHaveValue('2026-10')
      await expect(encabezado.getByRole('button', { name: /^Tus bancos: / })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Deshacer' }).first()).toBeVisible()
      await capturar(page, 'hecho-por-folvy')
    }, async () => {
      await base.deshacerTodo('Limpieza después de las pantallas B01')
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    })
  })

  test('móvil (M4): Movimientos con su encabezado, Para confirmar y Por aclarar en tarjetas', async ({ page }) => {
    test.skip(lado(page) !== 'movil', 'En el ordenador va la suya.')
    const base = await preparar()
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10`)
      // S02 · PR 2: se fue la portada por niveles del móvil (PortadaMovil, sus apartados y «‹ Bancos»):
      // el móvil abre Movimientos, con su encabezado, en «Para confirmar». Las páginas, en el cajón;
      // el principal, abajo, bajo el pulgar; los blancos, dentro de «Más acciones».
      const encabezado = page.locator('header.s-encabezado')
      await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
      await expect(page.locator('.cxb-apartado')).toHaveCount(0)
      await expect(page.getByRole('link', { name: '‹ Bancos' })).toHaveCount(0)
      await expect(encabezado.getByRole('button', { name: /^Tus bancos: B01 Norte.*\. Cambiar$/ })).toBeVisible()
      const subir = page.locator('.s-pulgar').getByRole('button', { name: 'Subir extracto' })
      await expect(subir).toBeVisible()
      await expect(subir).toHaveClass(/s-boton-principal/)
      await expect(encabezado.getByRole('button', { name: 'Subir extracto' })).toHaveCount(0)
      await encabezado.getByRole('button', { name: 'Más acciones' }).click()
      const automatico = page.getByRole('group', { name: 'Más acciones' }).getByRole('group', { name: 'Lo automático' })
      await expect(automatico.getByRole('link', { name: /^Reglas/ })).toBeVisible()
      await expect(automatico.getByRole('link', { name: /^Lo que he hecho/ })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('group', { name: 'Más acciones' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Para confirmar \d+$/ })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByText(/^He casado yo 3 de 8 movimientos de octubre\./)).toBeVisible()
      await expect(page.getByText('Por correo')).toHaveCount(0)
      await expect(page.locator('.cxn-fila').first()).toBeVisible()
      await capturarPieza(page, 'header.s-encabezado', 'encabezado')
      await capturar(page, 'para-confirmar')

      await page.getByRole('button', { name: /^Por aclarar \d+$/ }).click()
      await expect(page.getByText(/· tarjeta de Ana Prueba \(···0937\)/)).toBeVisible()
      await capturar(page, 'por-aclarar')

      // Respuesta 4, punto 2.6: Movimientos entero en el móvil, para verlo al lado del de ordenador.
      await page.getByRole('button', { name: /^Todos \d+$/ }).click()
      await expect(page.getByTestId('pasada-agente')).toBeVisible()
      await expect(page.locator('.cx-barra-ia')).toHaveCount(0)
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'movimientos')
      await capturarPieza(page, '.cxb-banda', 'banda-agente')

      // Respuesta 4: el cierre del mes también en el móvil (S02 · PR 2: en Cerrar el mes).
      await irAlCierreDelBanco(page)
      await expect(page.getByRole('article', { name: 'Cierre de Banco B01 · Norte' })).toContainText('la explican los movimientos sin casar')
      expect(await importesCortados(page)).toEqual([])
      await capturar(page, 'cierre')
    }, async () => {
      await base.deshacerTodo('Limpieza después de las pantallas B01 (móvil)')
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    })
  })
})
