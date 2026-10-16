/// <reference lib="dom" />
// tests/e2e/conta/c04/libro.spec.ts
//
// C04 · Libro diario (N11), asiento (N12), asiento a mano, mes cerrado y el
// extracto en las fichas, contra staging-conta, en ordenador (1440) y móvil
// (390). Las capturas van junto a las maquetas (docs/conta/capturas/c04/,
// COMPARACION.md frente a N11Diario y N12Asiento) y se toman ANTES de
// escribir nada, para que salgan siempre iguales.
//
// Datos: supabase/seeds/conta/seed_c04_staging.sql (todo inventado). Lo que
// escribe (cambiar una cuenta, un asiento a mano) se hace en UN tamaño y se
// deshace al acabar: la cuenta vuelve a la suya y el borrador se descarta.
// Validar y anular dejan huella para siempre (es su gracia): los prueba la
// tanda SQL de staging (20261010_c04_prueba_libro.sql) dentro de un ROLLBACK.

import { test, expect, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, HERMANOS_RUIZ, entrarComo } from '../sesion'
import { rest } from '../api'
import { FLOTANTES_CONTA, loQueTapan, loQueTapanSinPregunta } from '../solapes'

const DIR = 'docs/conta/capturas/c04'
const BARRA_FOLVY_MOVIL = 'nav[aria-label="Navegacion principal"]'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

// `incrustado`: la pantalla es de Contabilidad pero vive dentro de otra (la
// ficha del proveedor, en Cocina): su raíz es .cx-incrustado y en móvil la
// tapa la barra de Folvy, no la de Contabilidad (como en c02/ficha.spec.ts).
async function capturar(page: Page, nombre: string, incrustado = false) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${DIR}/${nombre}-${lado(page)}.png`, fullPage: true })
  const flotantes = incrustado && lado(page) === 'movil' ? [BARRA_FOLVY_MOVIL] : FLOTANTES_CONTA
  expect(await (incrustado ? loQueTapan(page, '.cx-incrustado', flotantes) : loQueTapanSinPregunta(page, '.cx-principal', flotantes))).toEqual([])
}

function vigilar(page: Page) {
  page.on('pageerror', (e) => console.log(`[error de la página] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[consola] ${m.text().slice(0, 300)}`) })
}

/**
 * M01 · Un asiento del libro: en el ordenador, una fila de la tabla densa del
 * marco (role «row»); en el móvil, su tarjeta (un botón).
 */
function filaDe(page: Page, nombre: RegExp) {
  return lado(page) === 'ordenador'
    ? page.getByRole('grid', { name: 'Asientos del libro diario' }).getByRole('row', { name: nombre })
    : page.getByRole('list', { name: 'Asientos del libro diario' }).getByRole('button', { name: nombre })
}

async function abrirAsiento(page: Page, concepto: string) {
  await filaDe(page, new RegExp(concepto)).first().click()
  if (lado(page) === 'ordenador') await page.getByRole('link', { name: 'Abrir el asiento' }).click()
  await expect(page.getByRole('heading', { level: 1, name: concepto })).toBeVisible()
}

test('A · libro diario (N11) en el marco: vistas que existen, el mes, estados, Diez y lo que he hecho yo', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  // M01: el título lo dicen las pestañas del marco (Diario › Libro diario); el encabezado, para el lector.
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  // Desde el menú: «Libros» ya tiene su pantalla.
  if (lado(page) === 'ordenador') await expect(page.getByRole('link', { name: 'Libros', exact: true }).first()).toBeVisible()
  // Las vistas: solo los orígenes que hay, con cuántos (los filtros de antes).
  const vistas = page.getByRole('group', { name: 'Vistas' })
  for (const f of [/^Para revisar · \d+$/, /^Ventas · \d+$/, /^Compras · \d+$/, /^Plataformas · \d+$/, /^Nóminas · \d+$/, /^Manuales · \d+$/, /^Anulados · \d+$/]) {
    await expect(vistas.getByRole('button', { name: f })).toBeVisible()
  }
  await expect(vistas.getByRole('button', { name: /^Banco · / })).toHaveCount(0)
  // «Te toca hoy»: lo que espera revisión, con su número (filtra al pulsarlo).
  await expect(page.getByRole('region', { name: 'Te toca hoy' }).getByRole('button', { name: /^\d+ para revisar$/ })).toBeVisible()
  // El mes, en una línea: sus asientos, si está abierto y su resultado.
  await expect(page.getByText(/^Asientos en (octubre|noviembre|diciembre)$/)).toBeVisible()
  await expect(page.getByText(/^Resultado de /)).toBeVisible()
  // Estados: lo propuesto, lo hecho por Folvy, lo anulado.
  const ventas = filaDe(page, /Ventas del día · Norte Centro/)
  await expect(ventas.filter({ hasText: 'Para revisar' })).toHaveCount(1)
  await expect(ventas.filter({ hasText: 'Hecho por Folvy' })).toHaveCount(1)
  await expect(filaDe(page, /Publicidad en la plataforma · octubre/).getByText('Anulado')).toBeVisible()
  // La marca cedida, dicha.
  await expect(filaDe(page, /Liquidación Plataforma Norte/).getByText('Brasa Prestada · cedida')).toBeVisible()
  // Respuesta 3 · 1: el número con su serie, y el contraasiento la dice por su nombre.
  const contra = filaDe(page, /Anula General nº 2: Estaba repetido/)
  await expect(contra).toBeVisible()
  if (lado(page) === 'ordenador') {
    await expect(contra.locator('.cxd-num')).toHaveText('General 3')
    await expect(filaDe(page, /Nóminas de septiembre/).locator('.cxd-num')).toHaveText('Nóminas 1')
    // El número en Diez, en su columna; sin número, «—» con su porqué (nunca un hueco mudo).
    await expect(page.getByRole('columnheader', { name: 'Diez' })).toBeVisible()
    await expect(contra.locator('.cxd-diez')).toHaveText(/^—/)
    await expect(contra.locator('.cxd-diez')).toHaveAttribute('title', /.+/)
  } else {
    await expect(contra.locator('.cxd-num-movil')).toHaveText('General 3')
  }
  await expect(page.getByText(/Anula el \d+\/\d+/)).toHaveCount(0)
  // M01 (maqueta N30 §4): en el ordenador, cada asiento en UNA fila del alto que
  // pone la densidad (compacta, unas 30 por pantalla); el concepto en una línea
  // con «…» y entero en el title; los chips enteros. En el móvil, la tarjeta
  // sigue en ≤ 110 px (respuesta 5). Se mide fila a fila, todas las del libro.
  if (lado(page) === 'ordenador') {
    const fila = await page.locator('.cxm').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--cxm-fila')))
    const filas = await page.locator('.cxt-fila').all()
    expect(filas.length).toBeGreaterThan(5)
    for (const f of filas) {
      const m = await f.evaluate((tr) => {
        const t = tr.querySelector('.cxd-concepto-titulo') as HTMLElement
        const linea = tr.querySelector('.cxd-linea-libro') as HTMLElement
        const caja = linea.getBoundingClientRect()
        const chips = [...linea.querySelectorAll('.cx-chip')].map((c) => {
          const r = c.getBoundingClientRect()
          return { texto: c.textContent ?? '', cortado: c.scrollWidth > c.clientWidth + 0.5 || r.right > caja.right + 0.5 }
        })
        return { alto: tr.getBoundingClientRect().height, concepto: t.textContent ?? '', title: t.title, altoConcepto: t.getBoundingClientRect().height, chips }
      })
      expect(m.alto, `fila «${m.concepto}» de ${m.alto} px (la densidad pide ${fila})`).toBeLessThanOrEqual(fila + 1.5)
      expect(m.altoConcepto, `«${m.concepto}» en más de una línea`).toBeLessThanOrEqual(20)
      expect(m.title, 'el concepto entero, en el title').toBe(m.concepto)
      for (const c of m.chips) expect(c.cortado, `chip «${c.texto}» cortado en «${m.concepto}»`).toBe(false)
    }
  } else {
    const tarjetas = await page.locator('.cxt-tarjeta').all()
    expect(tarjetas.length).toBeGreaterThan(5)
    for (const t of tarjetas) {
      const alto = (await t.boundingBox())!.height
      expect(alto, `tarjeta de ${alto} px (tope 110)`).toBeLessThanOrEqual(110)
    }
  }
  // El pie: cuántos y el cuadre del libro.
  await expect(page.getByRole('status', { name: 'Cuadre' })).toContainText('Cuadra')
  await expect(page.locator('.cxt-pie')).toContainText(/\d+ asientos/)
  // «Lo que he hecho yo» está; lo que dice se prueba aparte, con su propio
  // asiento (abajo): aquí enseña los cinco últimos de una cuenta compartida.
  await expect(page.getByRole('region', { name: 'Lo que he hecho yo' })).toBeVisible()
  // El cierre del mes anterior, con sus números.
  await expect(page.getByRole('region', { name: /^Cierre de / })).toBeVisible()
  await capturar(page, 'diario')

  if (lado(page) === 'ordenador') {
    // La fila se despliega en sus apuntes (clic, o Intro con la tabla).
    await ventas.filter({ hasText: 'Hecho por Folvy' }).click()
    await expect(page.getByRole('link', { name: '47700010' }).first()).toBeVisible()
    await expect(page.getByText('al Haber').first()).toBeVisible()
    await capturar(page, 'diario-abierto')
  }
  // Para revisar: solo lo que espera, sin esconder el resto (Todos sigue con todo).
  await vistas.getByRole('button', { name: /^Para revisar · \d+$/ }).click()
  await expect(filaDe(page, /Ventas del día/).filter({ hasText: 'Hecho por Folvy' })).toHaveCount(0)
  await expect(filaDe(page, /Alquiler Norte Mercado · octubre/)).toBeVisible()
  await expect(page.locator('.cxt-pie')).toContainText(/\d+ de \d+ asientos/)
})

// D01 R3 (14/10): «Lo que he hecho yo» se prueba con un asiento que crea la
// propia prueba y busca por lo que es, no por estar entre los cinco últimos
// de la cuenta A, que es compartida (la semilla de otro frente lo desplazó el
// 13/10). Un asiento validado deja número para siempre: se escribe en UN
// tamaño, y se deshace con su propio «Deshacer» (anulado con su contraasiento,
// a cero en el libro). Si la prueba se corta antes, lo anula al acabar.
test('A · «Lo que he hecho yo»: lo que valida Folvy sale con su Deshacer, y deshacerlo lo anula', async ({ page }) => {
  test.skip(lado(page) === 'movil', 'Escribe en el libro de la cuenta A: una vez, en el ordenador.')
  const s = await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  const PREFIJO = 'Ventas del día · Prueba e2e'
  // Lo que dejó un run cortado: lo validado se anula y lo propuesto se descarta.
  const quedan = await rest<{ id: string; status: string }[]>(s, 'GET',
    `journal_entry?select=id,status&company_id=eq.${EMPRESA_A}&concept=like.${encodeURIComponent(`${PREFIJO}*`)}&status=in.(propuesto,validado)`)
  for (const x of quedan.datos ?? []) await limpiar(s, x.id, x.status)
  const concepto = `${PREFIJO} ${Date.now().toString(36)}`
  const p = await rest<{ id: string }>(s, 'POST', 'rpc/journal_entry_proponer', {
    p_company: EMPRESA_A,
    p_entry: { series: 4, fecha: hoy, concepto, source_type: 'manual', confianza: 'seguro', porque: 'Asiento de la prueba e2e del libro (se deshace al acabar).' },
    // Común a los locales: un apunte sin local ni «común» no se valida.
    p_lines: [{ cuenta: '57000000', debe: 1, haber: 0, comun: true }, { cuenta: '70000000', debe: 0, haber: 1, comun: true }],
    p_quien_nombre: 'Prueba e2e',
  })
  expect(p.status, JSON.stringify(p.datos)).toBe(200)
  const id = p.datos.id
  try {
    const v = await rest(s, 'POST', 'rpc/journal_entry_validar', { p_entry: id, p_quien_nombre: 'Folvy (validación automática de ventas)' })
    expect(v.status, JSON.stringify(v.datos)).toBe(200)
    await page.goto('/conta/libros/diario')
    const ia = page.getByRole('region', { name: 'Lo que he hecho yo' })
    const fila = ia.locator('.cxd-ia-fila', { hasText: `Asenté «${concepto}»` })
    await expect(fila).toHaveCount(1)
    await fila.getByRole('button', { name: 'Deshacer' }).click()
    // Lo dice (regla 8): anulado con su contraasiento; y deja de salir.
    await expect(page.getByText(new RegExp(`Deshecho: «${concepto}» queda anulado con el contraasiento`))).toBeVisible()
    await expect(ia.locator('.cxd-ia-fila', { hasText: concepto })).toHaveCount(0)
  } finally {
    // Si se cortó antes de «Deshacer»: validado se anula, propuesto se descarta; anulado, nada.
    const [x] = (await rest<{ status: string }[]>(s, 'GET', `journal_entry?select=status&id=eq.${id}`)).datos ?? []
    if (x) await limpiar(s, id, x.status)
  }
})

async function limpiar(s: Awaited<ReturnType<typeof entrarComo>>, id: string, estado: string) {
  if (estado === 'validado') await rest(s, 'POST', 'rpc/journal_entry_anular', { p_entry: id, p_motivo: 'Limpieza de la prueba e2e del libro', p_fecha: null, p_quien_nombre: 'Prueba e2e' })
  else if (estado === 'propuesto') await rest(s, 'POST', 'rpc/journal_entry_descartar', { p_entry: id, p_motivo: 'Limpieza de la prueba e2e del libro', p_quien_nombre: 'Prueba e2e' })
}

test('A · asiento (N12): por qué lo propongo así, cuadre y detalle contable', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await abrirAsiento(page, 'Liquidación Plataforma Norte · 16–30 sep')
  await expect(page.getByText('Propuesto por Folvy · Seguro')).toBeVisible()
  await expect(page.getByText('Serie Banco')).toBeVisible()
  const porque = page.getByRole('region', { name: 'Por qué lo propongo así' })
  await expect(porque.getByText('Brasa Prestada va al socio, no a tus ventas')).toBeVisible()
  await expect(porque.getByText(/NRV 16\.ª/)).toBeVisible()
  await expect(page.getByText('Cuadra', { exact: true })).toBeVisible()
  await expect(page.getByText('✓ 0,00 €')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeEnabled()
  // Respuesta 3 · 3 y 4: cada cuenta por su nombre de uso; lo de la marca cedida,
  // a la cuenta de liquidación del socio y no a su 400.
  const apuntes = page.getByRole('region', { name: 'Apuntes' })
  await expect(apuntes.getByText('Comisiones de plataformas', { exact: true })).toBeVisible()
  await expect(apuntes.getByText('Liquidación pendiente con Marcas del Sur', { exact: true })).toBeVisible()
  await expect(apuntes.getByText('Servicios de profesionales independientes')).toHaveCount(0)
  await expect(apuntes.getByText('Proveedores · Marcas del Sur')).toHaveCount(0)
  // Cada código de cuenta se lee entero, también con el chip de la marca al lado
  // (e2e 134: salía «410000» por «41000003»).
  for (const codigo of await apuntes.locator('a.cxd-codigo').all()) {
    const sobra = await codigo.evaluate((el) => {
      const caja = el.closest('.cxd-concepto-apoyo')!.getBoundingClientRect()
      return el.getBoundingClientRect().right - caja.right
    })
    expect(sobra, `${await codigo.textContent()} cortado`).toBeLessThanOrEqual(0.5)
  }
  await capturar(page, 'asiento')
  // El título oficial, en Detalle contable.
  await page.getByRole('button', { name: /Detalle contable/ }).click()
  await expect(page.getByText('Servicios de profesionales independientes')).toBeVisible()
  await expect(page.getByText('Acreedores por prestaciones de servicios (euros)')).toBeVisible()

  // Un validado: su número por serie y su huella, en Detalle contable.
  await page.goto('/conta/libros/diario')
  await abrirAsiento(page, 'Nóminas de septiembre · Norte Centro')
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toHaveCount(0)
  // exact: en ordenador el menú lleva «Cambiar de empresa» (e2e 127).
  await expect(page.getByRole('button', { name: 'Cambiar', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Detalle contable/ }).click()
  await expect(page.getByText('Nóminas · código 9')).toBeVisible()
  await page.getByRole('button', { name: 'Comprobar la cadena' }).click()
  await expect(page.getByText(/^La cadena está intacta: \d+ asientos validados/)).toBeVisible()

  // Un anulado lleva a su contraasiento, y vuelta.
  await page.goto('/conta/libros/diario?ver=anulados')
  await abrirAsiento(page, 'Publicidad en la plataforma · octubre')
  await expect(page.getByText(/Estaba repetido/)).toBeVisible()
  await page.getByRole('link', { name: 'Ver el contraasiento' }).click()
  await expect(page.getByText('Este asiento da la vuelta a otro, apunte por apunte.')).toBeVisible()
})

test('A · cambiar una cuenta de una propuesta: lo dice y lo aprende; y se deja como estaba', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario?ver=revisar')
  await abrirAsiento(page, 'Alquiler Norte Mercado · octubre')
  // Respuesta 3: la línea se llama por su nombre de uso (el «qué se apunta aquí» de la 621), no por su título del BOE.
  const fila = page.locator('.cxd-linea-envoltura', { hasText: 'El alquiler del local' })
  await fila.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByLabel('Buscar cuenta por nombre o código').fill('otros servicios')
  // Se busca también por el título oficial («otros servicios»), y sale con su nombre de uso.
  await page.getByRole('button', { name: /62900000 Servicios que no van en otra/ }).click()
  await expect(page.getByRole('status').getByText(/Cambiada la 62100000 por la 62900000 \(Servicios que no van en otra.*\)\. La próxima del mismo origen la propondré así\./)).toBeVisible()
  // Y vuelta a la suya (también queda aprendido: la última manda).
  const otra = page.locator('.cxd-linea-envoltura', { hasText: 'Servicios que no van en otra' })
  await otra.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByLabel('Buscar cuenta por nombre o código').fill('62100000')
  await page.getByRole('button', { name: /62100000 El alquiler del local/ }).click()
  await expect(page.getByRole('status').getByText(/Cambiada la 62900000 por la 62100000/)).toBeVisible()
})

test('A · asiento a mano: cuadre en vivo, borrador y descartar', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'Escribe: solo en un tamaño')
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/libros/diario/nuevo')
  await expect(page.getByRole('heading', { level: 1, name: 'Nuevo asiento' })).toBeVisible()
  await page.getByLabel('Concepto', { exact: true }).fill('Prueba e2e · se descarta')
  await page.getByLabel('Cuenta del apunte 1').fill('62900000')
  await page.getByLabel('Local del apunte 1').selectOption({ label: 'Norte Centro' })
  await page.getByLabel('Debe del apunte 1').fill('12,50')
  await page.getByLabel('Cuenta del apunte 2').fill('57200001')
  await page.getByLabel('Local del apunte 2').selectOption({ label: 'Común (se reparte)' })
  await page.getByLabel('Haber del apunte 2').fill('12')
  await expect(page.getByText('No cuadra: faltan 0,50 € en el Haber')).toBeVisible()
  await capturar(page, 'nuevo-asiento')
  await page.getByLabel('Haber del apunte 2').fill('12,50')
  await expect(page.getByText('✓ 0,00 €')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar borrador' }).click()
  await expect(page.getByText('Guardado como borrador: sale en «Para revisar» hasta que lo valides.')).toBeVisible()
  await expect(page.getByText('Borrador', { exact: true })).toBeVisible()
  // Se deshace: descartar, con su porqué.
  await page.getByRole('button', { name: 'Descartar' }).click()
  await page.getByLabel('Por qué').fill('Era una prueba')
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click()
  await expect(page).toHaveURL(/\/conta\/libros\/diario\?ver=revisar$/)
  await expect(page.getByText('Prueba e2e · se descarta')).toHaveCount(0)
})

test('A · el extracto del proveedor lee del libro y lleva a su asiento', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto(`/kitchen/proveedores/${HERMANOS_RUIZ}/contabilidad`)
  await page.getByRole('button', { name: 'Ver extracto' }).click()
  const enlace = page.getByRole('link', { name: 'Ver el asiento F-2026-0915' }).first()
  await expect(enlace).toBeVisible()
  await capturar(page, 'extracto-proveedor', true)
  await enlace.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Factura Hermanos Ruiz · F-2026-0915' })).toBeVisible()
})

test('B · sin plataformas ni ventas, septiembre cerrado y un borrador que no se valida', async ({ page }) => {
  await entrarComo(page, CUENTA_B.email)
  vigilar(page)
  await page.goto('/conta/libros/diario')
  await expect(page.getByRole('heading', { name: 'Libro diario' })).toHaveCount(1)
  await expect(page.getByRole('group', { name: 'Vistas' })).toBeVisible()
  // Regla 9: nada de A.
  await expect(page.getByText(/Norte Centro|Plataforma Norte/)).toHaveCount(0)
  // Solo los filtros de lo que B tiene.
  const vistas = page.getByRole('group', { name: 'Vistas' })
  await expect(vistas.getByRole('button', { name: /^Plataformas/ })).toHaveCount(0)
  await expect(vistas.getByRole('button', { name: /^Ventas/ })).toHaveCount(0)
  await expect(vistas.getByRole('button', { name: /^Manuales · \d+$/ })).toBeVisible()
  await expect(page.getByText('septiembre cerrado')).toBeVisible()
  await capturar(page, 'diario-b')
  await abrirAsiento(page, 'Honorarios de la gestoría · septiembre')
  await expect(page.getByText(/septiembre está cerrado/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validar asiento' })).toBeDisabled()
  await capturar(page, 'mes-cerrado-b')
})

test('A · Ajustes › Ejercicio: desde cuándo asienta Folvy (el corte con el programa anterior)', async ({ page }) => {
  await entrarComo(page, CUENTA_A.email)
  vigilar(page)
  await page.goto('/conta/ajustes/ejercicio')
  // Respuesta 4 · 1: el corte se ve siempre; se cambia mientras no haya asientos traídos.
  const corte = page.getByTestId('corte-actual')
  await expect(corte).toBeVisible()
  await expect(corte).toHaveText(/^(Hasta el .+ lo trae .+; desde el .+ asienta Folvy\.|Sin fecha de corte: Folvy asienta el ejercicio entero\.)$/)
  const fijo = await page.getByTestId('corte-fijo').count()
  if (fijo) await expect(page.getByTestId('corte-fijo')).toContainText('Para moverla, primero se deshace lo traído')
  else await expect(page.getByRole('button', { name: 'Cambiar' }).last()).toBeVisible()
  await capturar(page, 'ajustes-corte')
})
