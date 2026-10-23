/// <reference lib="dom" />
// tests/e2e/conta/b01/conciliar.spec.ts
//
// B02 · tarea 4: «Bancos · Conciliar» (maqueta N17b) en staging-conta, cuenta
// A, en ordenador (1440) y móvil (390). Prepara lo de las pantallas del B01
// (el Norma 43 inventado de los tres bancos, conciliado) y, además, un
// segundo extracto INVENTADO de «B01 · Mercado» con tres recargas iguales el
// mismo día y una regla encendida sin confirmar que las propone con punto
// verde. Mira:
//   · que el cuadre, la barra, la banda y los contadores dicen lo mismo;
//   · el bloque («3 seguros seleccionados · Confirmar los 3»), los iguales en
//     una fila, el teclado (↑↓, espacio, Intro) y el buscador;
//   · el panel lateral (texto del banco tal cual, «¿Es otra cosa?», el
//     asiento que se crea) y «Casados solos», que se abre y se deshace.
// Las capturas van a docs/conta/capturas/b02/. Al acabar DESHACE todo: los
// casados, las propuestas, el extracto de las recargas y la regla; el libro
// de A con los mismos asientos que antes (misma vara: regla 31).

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, entrarComo } from '../sesion'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA, conLimpieza } from './datos'

const DIR = 'docs/conta/capturas/b02'
const NORTE = BANCOS_B01[0]
const MERCADO = BANCOS_B01[2]
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// Mercado, después de su primer extracto (2.500 + 2.000 − 220 − 60 − 34,75): 4.185,25 €; después de este, 3.885,25 €.
const RECARGAS = escribirNorma43([
  { entidad: '0182', oficina: '9103', cuenta: '0000000013', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-14', hasta: '2026-10-14', saldoInicialCent: 418_525, movimientos: [
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA MONEDERO INVENTADO' },
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA MONEDERO INVENTADO' },
    { fecha: '2026-10-14', importeCent: -10_000, comun: '99', concepto: 'RECARGA MONEDERO INVENTADO' },
  ] },
])

async function capturar(page: Page, nombre: string) {
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(DIR, { recursive: true })
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

async function abrir(nombre: string, texto: string) {
  return { nombre, sha256: createHash('sha256').update(texto).digest('hex'), contenido: { texto } }
}

async function preparar() {
  const base = await baseDeA()
  await base.deshacerTodo('Limpieza antes de Conciliar B02')
  await quitarLoMio(base)
  const asientosAntes = await base.contarAsientosA()
  const bancos = crearBancos(base.bd)
  const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
  for (const [nombre, texto] of [['b01-tres-cuentas.n43', FICHERO], ['b02-recargas.n43', RECARGAS]] as const) {
    const a = await abrir(nombre, texto)
    const { extracto, cuadre } = leerYCuadrar(a)
    await bancos.importar(a, extracto, cuadre, emparejar(extracto, mios))
  }
  await base.bd.rpc('bank_regla_guardar', { p_company: EMPRESA_A, p_id: null, p_palabras: 'Cuando el concepto tenga «RECARGA MONEDERO» → Saldo prepago · 40700001',
    p_condicion: { contiene: 'RECARGA MONEDERO' }, p_destino: { cuenta: '40700001' }, p_origen: 'persona', p_estado: 'activa' })
  const r = await bancos.conciliarPendientes(CUENTA_A.id, EMPRESA_A, '2026-10-15')
  expect(r.fallos).toEqual([])
  return { ...base, asientosAntes }
}

/** El extracto de las recargas y la regla de prueba, fuera (después de deshacer los casados). */
async function quitarLoMio(base: Awaited<ReturnType<typeof baseDeA>>) {
  const { data: ext } = await base.cliente.from('bank_statement').select('id').eq('treasury_account_id', MERCADO).eq('file_name', 'b02-recargas.n43')
  for (const e of ext ?? []) await base.bd.rpc('bank_extracto_deshacer', { p_statement: e.id, p_motivo: 'Limpieza de Conciliar B02' })
  const { data: reglas } = await base.cliente.from('bank_rule').select('id, status').eq('company_id', EMPRESA_A).contains('condition', { contiene: 'RECARGA MONEDERO' })
  for (const r of reglas ?? []) {
    if (r.status !== 'apagada') await base.bd.rpc('bank_regla_estado', { p_id: r.id, p_estado: 'apagada' })
    await base.bd.rpc('bank_regla_borrar', { p_id: r.id })
  }
}

/** Los números que enseñan la banda, la barra y los contadores, leídos de la pantalla. */
async function lasCifras(page: Page) {
  const frase = (await page.getByTestId('frase').textContent()) ?? ''
  const barra = (await page.getByTestId('barra').textContent()) ?? ''
  const n = (re: RegExp, t: string) => Number(re.exec(t)?.[1] ?? NaN)
  const contador = async (b: string) => Number(await page.getByTestId(`contador-${b}`).textContent())
  return {
    frase: { casados: n(/He casado yo (\d+)/, frase), todos: n(/de (\d+) movimientos/, frase), confirmar: n(/Te quedan (\d+) por confirmar/, frase), aclarar: n(/y (\d+) por aclarar/, frase) },
    barra: { casados: n(/(\d+) casados solos/, barra), confirmar: n(/(\d+) para confirmar/, barra), aclarar: n(/(\d+) por aclarar/, barra) },
    contadores: { casados: await contador('casados'), confirmar: await contador('confirmar'), aclarar: await contador('aclarar'), todos: await contador('todos') },
  }
}

test.describe('B02 · Bancos, conciliar', () => {
  test.describe.configure({ timeout: 300_000 })
  // Un clic que no puede darse falla en 20 s con su motivo, no al acabarse la prueba.
  test.use({ actionTimeout: 20_000 })

  test('ordenador: cuadre, bloque, iguales, teclado, panel y Casados solos', async ({ page }) => {
    test.skip(lado(page) !== 'ordenador', 'En el móvil va la suya.')
    const base = await preparar()
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      // La pasada del día del agente, a propósito y cuando el panel ya está abierto: se le dice
      // que hoy toca y se retiene la respuesta hasta soltarla (los fallos del panel cerrado
      // solo pasaban en los runs después de medianoche, cuando la pasada corría con él abierto).
      let soltarPasada: () => void = () => {}
      const pasadaSoltada = new Promise<void>((r) => { soltarPasada = r })
      await page.route('**/rest/v1/rpc/bank_agente_toca_hoy', async (ruta) => {
        await pasadaSoltada
        await ruta.fulfill({ status: 200, contentType: 'application/json', body: 'true' })
      })
      // Cuántas veces vuelve a salir el esqueleto de Movimientos después de haber tenido datos.
      await page.addInitScript(() => {
        const w = window as unknown as { __conDatos: boolean; __esqueletos: number; __donde: string[] }
        w.__conDatos = false; w.__esqueletos = 0; w.__donde = []
        new MutationObserver(() => {
          const esqueleto = !!document.querySelector('[aria-label="Cargando los movimientos"]')
          if (!esqueleto && document.querySelector('[data-testid="cuadre"]')) w.__conDatos = true
          else if (esqueleto && w.__conDatos) { w.__esqueletos++; w.__conDatos = false; w.__donde.push(`${Math.round(performance.now())} ${location.pathname}${location.search}`) }
        }).observe(document, { subtree: true, childList: true })
      })
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      // S02 · PR 2: el título de la página es el h1 de su encabezado.
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()

      // Una sola cuenta: la banda, la barra y los contadores dicen lo mismo.
      const c = await lasCifras(page)
      expect(c.frase).toEqual({ casados: c.contadores.casados, todos: c.contadores.todos, confirmar: c.contadores.confirmar, aclarar: c.contadores.aclarar })
      expect(c.barra).toEqual({ casados: c.contadores.casados, confirmar: c.contadores.confirmar, aclarar: c.contadores.aclarar })
      // S02 · PR 3: el extracto es «Según el banco» (las palabras del Inicio).
      for (const t of ['Según el banco', 'En contabilidad', 'Te falta por casar']) await expect(page.getByTestId('cuadre')).toContainText(t)
      // El último extracto de Mercado (el de las recargas) acaba en 4.185,25 − 300 = 3.885,25 €.
      await expect(page.getByTestId('cuadre')).toContainText('3.885,25 €')

      // El bloque: lo de punto verde viene marcado; los iguales, en una fila.
      const bloque = page.getByRole('region', { name: 'Confirmar en bloque' })
      await expect(bloque).toContainText('3 seguros seleccionados')
      await expect(bloque.getByRole('button', { name: 'Confirmar los 3' })).toBeVisible()
      const recargas = page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' })
      await capturar(page, 'conciliar')
      await expect(recargas, `Las filas: ${(await page.locator('.cxn-fila').allTextContents()).join(' ‖ ').slice(0, 900)}`).toHaveCount(1)
      await expect(recargas).toContainText('3 iguales')
      await expect(recargas.locator('.cxn-pildora', { hasText: 'Regla' })).toBeVisible()
      await expect(recargas.getByRole('button', { name: 'Confirmar las 3' })).toBeVisible()

      // La casilla quita: ya no son «los seguros».
      await recargas.getByRole('checkbox').uncheck()
      await expect(bloque).toHaveCount(0)
      // Teclado: espacio marca, ↑↓ se mueve y abre el panel.
      const lista = page.getByRole('grid')
      await lista.focus()
      await page.keyboard.press(' ')
      await expect(bloque).toContainText('3 seguros seleccionados')
      await page.keyboard.press('ArrowDown')
      await expect(page.locator('.cxn-panel')).toBeVisible()
      await expect(page.locator('.cxn-panel')).toContainText('Lo que dice el banco, tal cual')

      // El buscador: por importe.
      await page.getByRole('searchbox', { name: 'Buscar movimientos' }).fill('34,75')
      await expect(page.locator('.cxn-fila')).toHaveCount(1)
      await expect(page.locator('.cxn-fila')).toContainText('FERRETERIA')
      await page.getByRole('searchbox', { name: 'Buscar movimientos' }).fill('')

      // El panel de un pago: «¿Es otra cosa?» y el asiento que se crea.
      await page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }).click()
      const panel = page.locator('.cxn-panel')
      await expect(panel).toContainText('RECARGA MONEDERO INVENTADO')
      // Ahora, con el panel abierto, la pasada del día: ni se cierra el panel ni vuelve el esqueleto.
      soltarPasada()
      await expect(page.getByText('Haciendo la pasada del día: miro los movimientos pendientes…')).toBeVisible()
      await expect(page.getByText('Haciendo la pasada del día: miro los movimientos pendientes…')).toHaveCount(0, { timeout: 60_000 })
      await page.waitForTimeout(1_500)
      expect(await page.evaluate(() => (window as unknown as { __esqueletos: number }).__esqueletos), 'la pasada del día ha vuelto a montar Movimientos').toBe(0)
      await expect(panel).toContainText('RECARGA MONEDERO INVENTADO')
      await panel.getByText('¿Es otra cosa?').click()
      await expect(panel.getByRole('button', { name: 'Apuntar sin factura…' })).toBeVisible()
      await expect(panel.getByRole('button', { name: /^Traspaso a / }).first()).toBeVisible()
      await expect(panel.getByRole('button', { name: 'No va a contabilidad…' })).toBeVisible()
      await panel.getByText('Ver el asiento que se crea').click()
      // El asiento común (diseno/plantillas): la tabla Cuenta · Nombre · Debe · Haber.
      await expect(panel.locator('details.s-asiento-ficha .s-asiento-tabla')).toContainText('40700001')
      // Cambiar el alto de la ventana con el panel abierto no vuelve a montar la pantalla:
      // ni recarga la página (la marca en window sigue), ni reaparece el esqueleto, ni navega.
      const navegaciones: string[] = []
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) navegaciones.push(f.url()) })
      await page.evaluate(() => {
        const w = window as unknown as { __marca: number; __esqueletos: number }
        w.__marca = 1; w.__esqueletos = 0
        new MutationObserver(() => { if (document.querySelector('[aria-label="Cargando los movimientos"]')) w.__esqueletos++ })
          .observe(document.body, { subtree: true, childList: true })
      })
      for (const alto of [2400, 700, 1600, 900]) { await page.setViewportSize({ width: 1440, height: alto }); await page.waitForTimeout(700) }
      const tras = await page.evaluate(() => {
        const w = window as unknown as { __marca?: number; __esqueletos?: number }
        return { marca: w.__marca ?? null, esqueletos: w.__esqueletos ?? null }
      })
      expect(tras, `al cambiar el alto: navegaciones ${JSON.stringify(navegaciones)}`).toEqual({ marca: 1, esqueletos: 0 })
      await expect(panel).toBeVisible()
      // La lista y el panel, a la vez, antes y después de la captura: si algo los desmonta, se ve aquí.
      await expect(page.getByRole('grid')).toBeVisible()
      // Diez capturas seguidas con el panel abierto: si alguna vuelve a montar la pantalla, se dice dónde.
      for (let i = 0; i < 10; i++) {
        await page.screenshot({ fullPage: true })
        await page.waitForTimeout(300)
        const d = await page.evaluate(() => {
          const w = window as unknown as { __marca?: number; __esqueletos?: number; __donde?: string[] }
          return { marca: w.__marca ?? null, esqueletos: w.__esqueletos ?? null, donde: w.__donde ?? [] }
        })
        expect(d, `captura ${i + 1}: navegaciones ${JSON.stringify(navegaciones)} · ahora ${page.url()}`).toEqual({ marca: 1, esqueletos: 0, donde: [] })
      }
      await capturar(page, 'panel')
      const trasCaptura = await page.evaluate(() => {
        const w = window as unknown as { __marca?: number; __esqueletos?: number }
        return { marca: w.__marca ?? null, esqueletos: w.__esqueletos ?? null }
      })
      expect(trasCaptura, `durante la captura: navegaciones ${JSON.stringify(navegaciones)}`).toEqual({ marca: 1, esqueletos: 0 })
      await expect(panel, 'el panel se ha cerrado solo durante la captura').toBeVisible()

      // Intro confirma la fila enfocada (los 3 iguales), cada uno como si fuera solo, y lo dice.
      await page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }).getByRole('button', { name: 'Confirmar las 3' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Confirmados los 3')

      // Casados solos: en Norte, cada línea dice de qué movimiento habla y se deshace desde ella.
      await page.goto(`/conta/bancos?banco=${NORTE}&mes=2026-10&ver=casados`)
      const casados = page.getByRole('list', { name: 'Casados solos' })
      await expect(casados.getByRole('listitem').first()).toContainText('Casado con')
      const antes = await casados.getByRole('listitem').count()
      expect(antes).toBe(Number(await page.getByTestId('contador-casados').textContent()))
      await capturar(page, 'casados-solos')
      await casados.getByRole('listitem').first().getByRole('button', { name: 'Deshacer' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Deshecho: el movimiento del')
      await expect(casados.getByRole('listitem')).toHaveCount(antes - 1)
      const d = await lasCifras(page)
      expect(d.contadores.casados).toBe(antes - 1)
      expect(d.frase.casados).toBe(antes - 1)
    }, async () => {
      await base.deshacerTodo('Limpieza después de Conciliar B02')
      await quitarLoMio(base)
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    })
  })

  // S02 · PR 2 (Julio, 22/10): el asiento de lo casado se valida en Bancos › Movimientos › «Por validar»,
  // uno a uno («Validar y siguiente» o Intro) y en bloque («Validar los N»); Contabilidad › Asientos ya no lo enseña.
  test('Por validar: el asiento de lo casado se valida aquí, con Intro y en bloque, y no sale en Asientos', async ({ page }) => {
    test.skip(lado(page) !== 'ordenador', 'El teclado y el bloque, en el ordenador.')
    const base = await preparar()
    let validados = 0
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()
      // Confirmar las 3 recargas: sus asientos quedan propuestos y lo dice dónde esperan.
      await page.getByRole('region', { name: 'Confirmar en bloque' }).getByRole('button', { name: 'Confirmar los 3' }).click()
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText('Confirmados los 3: sus asientos esperan en «Por validar».')

      const contador = async () => Number(await page.getByTestId('contador-validar').textContent())
      await expect.poll(contador).toBeGreaterThanOrEqual(3)
      const n = await contador()
      await page.getByRole('button', { name: `Por validar ${n}`, exact: true }).click()
      const lista = page.getByRole('grid', { name: /^Por validar de octubre en / })
      const filas = lista.getByRole('row')
      await expect(filas).toHaveCount(n)
      // Cada uno con su veredicto y su porqué: las recargas las confirmaste tú.
      const recarga = filas.filter({ hasText: 'Lo casaste tú al confirmarlo' }).first()
      await expect(recarga).toContainText('Lista para contabilizar.')
      const concepto = ((await recarga.getByText(/^Casado con /).textContent()) ?? '').replace(/^Casado con /, '').trim()
      expect(concepto.length).toBeGreaterThan(0)
      const bloque = page.getByRole('region', { name: 'Validar en bloque' })
      await expect(bloque).toContainText(`${n} listas para contabilizar`)
      await capturar(page, 'por-validar')

      // Contabilidad › Asientos, «Para revisar»: los del banco ya no salen (se deciden aquí).
      await page.goto('/conta/libros/diario?ver=revisar')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(concepto, { exact: true })).toHaveCount(0)

      // Intro valida la elegida y pasa a la siguiente; lo dice con su número de asiento (regla 8).
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10&ver=validar`)
      await expect(filas).toHaveCount(n)
      await lista.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText(/^Validado: .+ es el asiento \d+\. Ya está en el libro diario\.$/)
      validados++
      await expect(filas).toHaveCount(n - 1)
      await expect(filas.first()).toHaveAttribute('aria-selected', 'true')

      // «Validar los N»: el resto, cada uno como si fuera solo, y dice cuántos y qué números.
      if (n - 1 > 0) {
        await bloque.getByRole('button', { name: n - 1 === 1 ? 'Validar la 1' : `Validar los ${n - 1}` }).click()
        await expect(page.locator('.cx-guardado, .cx-error').first()).toContainText(n - 1 === 1 ? 'Validado el 1' : `Validados los ${n - 1}`)
        validados += n - 1
      }
      await expect(page.getByText('Nada por validar de octubre en')).toBeVisible()
      await expect.poll(contador).toBe(0)
    }, async () => {
      await base.deshacerTodo('Limpieza después de Por validar B02')
      await quitarLoMio(base)
      // Lo validado no se borra: deshacerlo lo anula con su contraasiento (dos asientos por cada uno).
      expect(await base.contarAsientosA()).toBe(base.asientosAntes + 2 * validados)
    })
  })

  test('móvil: tarjetas, «Confirmar los 3 seguros» arriba y el panel en hoja', async ({ page }) => {
    test.skip(lado(page) !== 'movil', 'En el ordenador va la suya.')
    const base = await preparar()
    await conLimpieza(page, async () => {
      await entrarComo(page, CUENTA_A.email)
      vigilar(page)
      await page.goto(`/conta/bancos?banco=${MERCADO}&mes=2026-10`)
      // S02 · PR 2: sin la portada por niveles (y su enlace «Confirmar los 3 seguros»): el móvil abre
      // Movimientos en «Para confirmar», con «Confirmar los 3 seguros» arriba, en el bloque.
      await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Para confirmar \d+$/ })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('region', { name: 'Confirmar en bloque' }).getByRole('button', { name: 'Confirmar los 3 seguros' })).toBeVisible()
      await capturar(page, 'conciliar')
      await expect(page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }), `Las filas: ${(await page.locator('.cxn-fila').allTextContents()).join(' ‖ ').slice(0, 900)}`).toHaveCount(1)
      await page.locator('.cxn-fila', { hasText: 'RECARGA MONEDERO INVENTADO' }).locator('.cxn-quien').click()
      await expect(page.getByRole('dialog')).toContainText('Lo que dice el banco, tal cual')
      await capturar(page, 'panel')
      await page.getByRole('dialog').getByRole('button', { name: 'Cerrar el panel' }).click()
      await page.getByRole('button', { name: /^Por aclarar/ }).click()
      await expect(page.locator('.cxn-fila', { hasText: 'FERRETERIA' })).toBeVisible()
      await capturar(page, 'por-aclarar')
    }, async () => {
      await base.deshacerTodo('Limpieza después de Conciliar B02 (móvil)')
      await quitarLoMio(base)
      expect(await base.contarAsientosA()).toBe(base.asientosAntes)
    })
  })
})
