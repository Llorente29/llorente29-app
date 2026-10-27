/// <reference lib="dom" />
// tests/e2e/laboral/l0-pantallas.spec.ts
//
// L00 · Laboral, fase L0 (27/10/2026): LAS CAPTURAS de la auditoría. Abre cada
// pantalla de personal de hoy (Folvy Team) y cada página del portal del
// trabajador, en staging-conta, y saca una captura de cada una.
//
// Es una herramienta de la auditoría, no una prueba de regresión: NO falla si
// una pantalla tiene un error, lo apunta. Lo que vea va a
// docs/laboral/l0/auditoria.md («Diseño»). Las capturas van a test-results
// (artefacto «playwright-report-<trozo>» del run) y como adjuntos del informe
// de Playwright, no al repositorio: Laboral no es un frente con carpeta de
// capturas, y la L0 no toca la infraestructura común.
//
//   · Como el administrador de la cuenta A, en ordenador: las 17 rutas de
//     /personal y la predicción de personal (/ventas/prediccion).
//   · Como el trabajador de prueba de la cuenta A, en móvil: el inicio, «Mi
//     Portal» y cada página del portal.
//
// Los datos son los de staging (cuenta A, inventados): sirven para ver la
// pantalla, no para contar nada.
//
// No corre en la e2e de la noche (GITHUB_EVENT_NAME = schedule): sirve para la
// L0 y para volver a sacar las capturas a mano, no para vigilar nada.

import { test, type Page } from '@playwright/test'
import { CUENTA_A, correoDePrueba, entrarComo } from '../conta/sesion'

const TRABAJADOR = correoDePrueba('a.trabajador@prueba.folvy.test')

test.skip(process.env.GITHUB_EVENT_NAME === 'schedule', 'las capturas de la L0 no corren de noche')

const EMPRESA: { ruta: string; nombre: string }[] = [
  { ruta: '/personal', nombre: 'Empleados (StaffPage)' },
  { ruta: '/personal/ahora-mismo', nombre: 'Ahora mismo' },
  { ruta: '/personal/control-horario', nombre: 'Control horario (FichajesGlobal)' },
  { ruta: '/personal/recordatorios-fichaje', nombre: 'Recordatorios de fichaje' },
  { ruta: '/personal/kiosko', nombre: 'Kiosko de fichaje' },
  { ruta: '/personal/solicitudes', nombre: 'Solicitudes' },
  { ruta: '/personal/turnos-abiertos', nombre: 'Turnos abiertos' },
  { ruta: '/personal/cambios', nombre: 'Cambios de turno' },
  { ruta: '/personal/calendario', nombre: 'Calendario (cuadrantes)' },
  { ruta: '/personal/disponibilidad', nombre: 'Disponibilidad' },
  { ruta: '/personal/plantilla', nombre: 'Plantilla (horas y coste)' },
  { ruta: '/personal/plantilla-turnos', nombre: 'Plantilla de turnos' },
  { ruta: '/personal/informes-analitica', nombre: 'Informes de Team' },
  { ruta: '/personal/nominas', nombre: 'Nóminas' },
  { ruta: '/personal/informes', nombre: 'Informes Gestoría' },
  { ruta: '/personal/bolsa-horas', nombre: 'Bolsa de horas' },
  { ruta: '/personal/formacion', nombre: 'Formación' },
  { ruta: '/ventas/prediccion', nombre: 'Predicción de personal' },
]

const PORTAL = ['Mi horario', 'Turnos abiertos', 'Cambios de turno', 'Mis fichajes', 'Mi formación',
  'Mi bolsa de horas', 'Mis documentos', 'Mis vacaciones', 'Mis ajustes']

const nombreFichero = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

async function capturar(page: Page, n: number, nombre: string) {
  // Sin selector propio de «cargado» en estas pantallas: se espera a la red y un margen.
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(1_500)
  const fichero = `${String(n).padStart(2, '0')}-${nombreFichero(nombre)}.png`
  const png = await page.screenshot({ path: test.info().outputPath(fichero), fullPage: true })
  await test.info().attach(fichero, { body: png, contentType: 'image/png' })
}

test('L0 · las pantallas de personal de la empresa, en ordenador', async ({ page }) => {
  test.skip(test.info().project.name !== 'ordenador', 'la empresa, en ordenador')
  test.setTimeout(8 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  await entrarComo(page, CUENTA_A.email)
  let n = 0
  for (const p of EMPRESA) {
    n += 1
    await test.step(p.nombre, async () => {
      try {
        await page.goto(p.ruta, { timeout: 30_000 })
        await capturar(page, n, `empresa ${p.nombre}`)
      } catch (e) {
        test.info().annotations.push({ type: 'no se pudo capturar', description: `${p.ruta}: ${(e as Error).message.split('\n')[0]}` })
      }
    })
  }
  for (const e of errores) test.info().annotations.push({ type: 'error de la página', description: e })
  console.log(`[L0] empresa: ${EMPRESA.length} pantallas, ${errores.length} errores de página apuntados.`)
})

test('L0 · el portal del trabajador, en móvil', async ({ page }) => {
  test.skip(test.info().project.name !== 'movil', 'el portal, en móvil')
  test.setTimeout(8 * 60_000)
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(`${page.url()}: ${e.message}`))
  await entrarComo(page, TRABAJADOR)
  await page.goto('/')
  await capturar(page, 20, 'portal inicio')
  try {
    await page.getByText('Mi Portal', { exact: true }).first().click({ timeout: 15_000 })
    await capturar(page, 21, 'portal mi portal')
  } catch (e) {
    test.info().annotations.push({ type: 'no se pudo capturar', description: `Mi Portal: ${(e as Error).message.split('\n')[0]}` })
  }
  let n = 21
  for (const titulo of PORTAL) {
    n += 1
    await test.step(titulo, async () => {
      try {
        await page.goto('/')
        await page.getByText('Mi Portal', { exact: true }).first().click({ timeout: 15_000 })
        await page.getByText(titulo, { exact: true }).first().click({ timeout: 10_000 })
        await capturar(page, n, `portal ${titulo}`)
      } catch (e) {
        test.info().annotations.push({ type: 'no se pudo capturar', description: `${titulo}: ${(e as Error).message.split('\n')[0]}` })
      }
    })
  }
  for (const e of errores) test.info().annotations.push({ type: 'error de la página', description: e })
  console.log(`[L0] portal: ${PORTAL.length + 2} pantallas, ${errores.length} errores de página apuntados.`)
})
