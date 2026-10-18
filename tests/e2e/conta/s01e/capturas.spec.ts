/// <reference lib="dom" />
// tests/e2e/conta/s01e/capturas.spec.ts
//
// S01e · Las capturas de ANTES y DESPUÉS del PR 3 (encargo S01b, 18/10: lo que
// confunde y lo estético de la auditoría), con la marca Sumied, en ordenador y
// móvil, con A (hostelería) y B (Canarias). Solo mira: no escribe nada.
// FASE dice con qué nombre salen: «antes» en el commit que solo trae esta
// prueba; «despues» desde los arreglos.

import { test, type Page } from '@playwright/test'
import { CUENTA_A, CUENTA_B, entrarComo } from '../sesion'

const FASE = 'antes'
const DIR = 'docs/conta/capturas/s01e'
const lado = (page: Page) => ((page.viewportSize()?.width ?? 1440) < 768 ? 'movil' : 'ordenador')

async function cargada(page: Page) {
  await page.locator('.cx-hueso').first().waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

/** Cada pantalla de la auditoría que el PR 3 toca, con la cuenta en la que se ve el fallo. */
const PANTALLAS: { cuenta: 'A' | 'B'; nombre: string; ruta: string }[] = [
  { cuenta: 'A', nombre: 'recibida-a-mano', ruta: 'libros/diario/recibidas?nueva=a-mano' },
  { cuenta: 'A', nombre: 'inicio', ruta: 'inicio' },
  { cuenta: 'A', nombre: 'libro-diario', ruta: 'libros/diario' },
  { cuenta: 'A', nombre: 'predefinido', ruta: 'libros/diario/nuevo?tipo=predefinido' },
  { cuenta: 'A', nombre: 'recibidas', ruta: 'libros/diario/recibidas' },
  { cuenta: 'A', nombre: 'diario-resumido', ruta: 'libros/diario/resumido' },
  { cuenta: 'A', nombre: 'sumas-saldos', ruta: 'libros/mayor/sumas-saldos' },
  { cuenta: 'A', nombre: 'retenciones', ruta: 'libros/registro/retenciones' },
  { cuenta: 'A', nombre: 'formato-aeat', ruta: 'libros/registro/formato-aeat' },
  { cuenta: 'A', nombre: 'ecpn', ruta: 'libros/balances/ecpn' },
  { cuenta: 'A', nombre: 'cuentas-anuales', ruta: 'libros/anuales/cuentas-anuales' },
  { cuenta: 'A', nombre: 'mapeo', ruta: 'libros/anuales/mapeo' },
  { cuenta: 'A', nombre: 'cierre-ejercicio', ruta: 'libros/cierre/cierre-ejercicio' },
  { cuenta: 'A', nombre: 'cerrar-mes', ruta: 'libros/cierre/cerrar-mes' },
  { cuenta: 'A', nombre: 'compras', ruta: 'compras' },
  { cuenta: 'A', nombre: 'subir-factura', ruta: 'compras?subir=' },
  { cuenta: 'A', nombre: 'documentos', ruta: 'documentos' },
  { cuenta: 'A', nombre: 'bancos', ruta: 'bancos' },
  { cuenta: 'A', nombre: 'bancos-casados', ruta: 'bancos?ver=casados' },
  { cuenta: 'A', nombre: 'bancos-reglas', ruta: 'bancos/reglas' },
  { cuenta: 'A', nombre: 'contactos-proveedores', ruta: 'clientes-y-proveedores?ver=proveedores' },
  { cuenta: 'A', nombre: 'ajustes', ruta: 'ajustes' },
  { cuenta: 'A', nombre: 'ajustes-folvy', ruta: 'ajustes/folvy' },
  { cuenta: 'A', nombre: 'analitica', ruta: 'ajustes/analitica' },
  { cuenta: 'A', nombre: 'plan', ruta: 'ajustes/plan' },
  { cuenta: 'A', nombre: 'tablas-numeracion', ruta: 'ajustes/tablas/numeracion' },
  { cuenta: 'A', nombre: 'tablas-tipos-de-gasto', ruta: 'ajustes/tablas/tipos-de-gasto' },
  { cuenta: 'B', nombre: 'inicio', ruta: 'inicio' },
  { cuenta: 'B', nombre: 'para-revisar', ruta: 'libros/diario?ver=revisar' },
  { cuenta: 'B', nombre: 'expedida', ruta: 'libros/diario/nuevo?tipo=expedida' },
  { cuenta: 'B', nombre: 'registro-expedidas', ruta: 'libros/registro/expedidas' },
  { cuenta: 'B', nombre: 'tablas-impuestos', ruta: 'ajustes/tablas/impuestos' },
  { cuenta: 'B', nombre: 'plan', ruta: 'ajustes/plan' },
  { cuenta: 'B', nombre: 'tablas-retenciones', ruta: 'ajustes/tablas/retenciones' },
]

for (const p of PANTALLAS) {
  test(`${FASE} · ${p.cuenta} · ${p.nombre}`, async ({ page }) => {
    await entrarComo(page, (p.cuenta === 'B' ? CUENTA_B : CUENTA_A).email)
    await page.goto(`/conta/${p.ruta}${p.ruta.includes('?') ? '&' : '?'}marca=sumied`)
    await cargada(page)
    await page.screenshot({ path: `${DIR}/${FASE}-${p.cuenta}-${p.nombre}-${lado(page)}.jpg`, type: 'jpeg', quality: 75 })
  })
}
