// tests/e2e/conta/x20/subcuenta.spec.ts — X20 · Crear una subcuenta como en ERP10 (21/11), contra staging, a
// 1456 × 816 y a 1366 × 768:
//   1. En Plan contable, dos casillas: «572» → la siguiente libre (57200NNN), «Banco del datáfono», Intro; y
//      «430» → Intro la deja escrita (4300NNNN), «Glovo», Intro. Cada una, con su ficha al lado (banco, cliente).
//   2. La que ya existe lo dice, con «Ábrela».
//   3. Desde «A qué cuenta va cada forma de pago» (su buscador de la factura del día), un código que no está: «No está: crear la …», el nombre e
//      Intro, sin salir de la ventana; y queda elegida (no se guarda: la ventana sigue como estaba).
// Los códigos, los siguientes libres de staging en cada pasada; los nombres, inventados con un número (T11).

import { test, expect, type Page } from '@playwright/test'
import { CARRIL, CUENTA_A, enCarril, entrarComo, type Sesion } from '../sesion'
import { rest } from '../api'
import { siguienteLibre } from '../../../../src/modules/conta/lib/planEmpresa'

test.skip(CARRIL === null, 'El X20 crea subcuentas en la empresa de la cuenta A: necesita su carril.')

const DIR = 'docs/conta/capturas/x20'
const EMPRESA_A = enCarril('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
const TAMANOS = [{ width: 1456, height: 816 }, { width: 1366, height: 768 }] as const

function vigilar(page: Page): string[] {
  const errores: string[] = []
  page.on('pageerror', (e) => { errores.push(e.message); console.log(`[error de la página] ${e.message}`) })
  return errores
}

/** El siguiente código libre bajo un prefijo, en la empresa de staging (lo que propondrá Sumied). */
async function libre(s: Sesion, prefijo: string): Promise<string> {
  const r = await rest<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&code=like.${prefijo}*`)
  const todas = await rest<{ code: string }[]>(s, 'GET', `company_account?select=code&company_id=eq.${EMPRESA_A}&limit=1`)
  const digitos = todas.datos[0]?.code.length ?? 8
  const c = siguienteLibre(prefijo, digitos, new Set(r.datos.map((x) => x.code)))
  if (!c) throw new Error(`No quedan códigos libres bajo ${prefijo}.`)
  return c
}

for (const tam of TAMANOS) {
  test(`X20 · ${tam.width} × ${tam.height}: una subcuenta como en ERP10 (código, nombre, Intro), con su ficha al lado, y desde las formas de pago sin salir de la ventana`, async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'En el ordenador (encargo X20).')
    test.setTimeout(180_000)
    await page.setViewportSize(tam)
    const s = await entrarComo(page, CUENTA_A.email)
    const errores = vigilar(page)
    const n = Date.now() % 100000

    // 1 · En Plan contable: Código y Nombre en una línea, encima del árbol.
    await page.goto('/conta/ajustes/plan', { waitUntil: 'load' })
    const linea = page.getByRole('form', { name: 'Añadir subcuenta' })
    await expect(linea).toBeVisible({ timeout: 40_000 })
    const codigo = linea.getByRole('textbox', { name: 'Código' })
    const nombre = linea.getByRole('textbox', { name: 'Nombre' })
    const frase = page.locator('#cx-subcuenta-frase')

    // 572 → la siguiente libre; «Banco del datáfono»; Intro. Su ficha, la del banco, al lado.
    const banco = await libre(s, '572')
    await codigo.fill('572')
    await expect(frase).toHaveText(new RegExp(`^Será la ${banco}, bajo la 572 · `))
    await codigo.press('Enter')
    await expect(codigo).toHaveValue(banco)
    await expect(nombre).toBeFocused()
    await nombre.fill(`Banco del datáfono X20 ${n}`)
    await nombre.press('Enter')
    await expect(frase).toHaveText(new RegExp(`^Creada la ${banco} · Banco del datáfono X20 ${n}, bajo la 572 · `), { timeout: 30_000 })
    const fichaBanco = page.getByRole('complementary', { name: 'La ficha del banco' })
    await expect(fichaBanco).toBeVisible()
    await expect(fichaBanco.getByRole('link', { name: 'Rellenar la ficha' })).toBeVisible()
    await expect(fichaBanco.getByRole('button', { name: 'Luego' })).toBeVisible()
    const [creada] = (await rest<{ code: string; template_code: string; name: string }[]>(s, 'GET', `company_account?select=code,template_code,name&company_id=eq.${EMPRESA_A}&code=eq.${banco}`)).datos
    expect(creada).toEqual({ code: banco, template_code: '572', name: `Banco del datáfono X20 ${n}` })
    await page.screenshot({ path: `${DIR}/banco-${tam.width}.png` })

    // 430 → Intro la deja escrita (la siguiente libre, bajo la 4300); «Glovo»; Intro. Su ficha, la del cliente.
    const glovo = await libre(s, '430')
    await codigo.fill('430')
    await codigo.press('Enter')
    await expect(codigo).toHaveValue(glovo)
    await expect(frase).toHaveText(new RegExp(`^Será la ${glovo}, bajo la 4300 · `))
    await nombre.fill(`Glovo X20 ${n}`)
    await nombre.press('Enter')
    await expect(frase).toHaveText(new RegExp(`^Creada la ${glovo} · Glovo X20 ${n}, bajo la 4300 · `), { timeout: 30_000 })
    await expect(page.getByRole('complementary', { name: 'La ficha del cliente' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/glovo-${tam.width}.png` })

    // 2 · La que ya existe: lo dice, con «Ábrela».
    await codigo.fill(glovo.replace(/^4300+/, '430.'))
    await expect(frase).toHaveText(`Ya existe: la ${glovo} · Glovo X20 ${n}. Ábrela`)
    await expect(frase.getByRole('link', { name: 'Ábrela' })).toBeVisible()
    await codigo.fill('')

    // 3 · Desde «A qué cuenta va cada forma de pago»: un código que no está, creado sin salir de la ventana.
    await page.goto('/conta/ajustes/ventas-por-dia', { waitUntil: 'load' })
    await page.getByRole('button', { name: 'A qué cuenta va cada forma de pago' }).click({ timeout: 30_000 })
    const v = page.getByRole('dialog', { name: 'A qué cuenta va cada forma de pago' })
    // El buscador de la ventana: el de «La factura del día» (está siempre; las formas de pago, solo con un día subido).
    const boton = v.getByRole('button', { name: 'Cuenta de la factura del día' })
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await boton.click()
    const otra = await libre(s, '4300')
    await v.getByRole('combobox', { name: 'Número o nombre de la cuenta' }).fill(otra)
    await v.getByRole('button', { name: `No está: crear la ${otra}` }).click()
    const enVentana = v.getByRole('form', { name: 'Añadir subcuenta' })
    await expect(enVentana.getByRole('textbox', { name: 'Código' })).toHaveValue(otra)
    await enVentana.getByRole('textbox', { name: 'Nombre' }).fill(`Plataforma X20 ${n}`)
    await page.screenshot({ path: `${DIR}/desde-formas-${tam.width}.png` })
    await enVentana.getByRole('textbox', { name: 'Nombre' }).press('Enter')
    await expect(boton).toContainText(`${otra} · Plataforma X20 ${n}`, { timeout: 30_000 })
    await expect(v).toBeVisible()
    await page.screenshot({ path: `${DIR}/desde-formas-elegida-${tam.width}.png` })
    expect(errores).toEqual([])
  })
}
