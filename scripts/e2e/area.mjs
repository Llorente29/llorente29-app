#!/usr/bin/env node
// scripts/e2e/area.mjs — qué pruebas corre la e2e de un PUSH, según la rama.
//
// W02 (17/10, gasto de Actions). La e2e de cada push corre solo las pruebas
// del área de la rama, en un trozo. La suite ENTERA corre en un push solo si
// toca lo común o pedidos, cocina o reparto (abajo); si no, cada noche.
// El 16/10 las e2e gastaron 2.953 min; cada push de una rama sin frente (las
// reparto-**, las conta/c00…c05, las conta/w*) corría la suite entera en 2
// trozos.
//
//   node scripts/e2e/area.mjs <rama>   → las pruebas, separadas por espacios
//
// El reparto:
//   · las de frente (A d*, B b*, C c06*/f*, D m*): su carpeta y el juego común;
//   · una conta/<x> cuya carpeta tests/e2e/conta/<x> existe (c02c, c04, cierre…):
//     esa carpeta (la más larga que casa) y el juego común;
//   · reparto-**: tests/e2e/reparto;
//   · cualquier otra (conta/w02-…, de herramientas): solo el juego común;
//   · y, sea cual sea la rama, la carpeta de cada ZONA POR FICHERO que toque el
//     push (ZONAS_POR_FICHERO: inventario, 21/10).
// Nunca vacío: vacío sería la suite entera.
//
// UN CRITERIO POR RIESGO (W04, Julio, 22/10, la auditoría de las reglas de pruebas):
//   · solo pantallas → la zona de la rama (y la de lo que toca);
//   · lo común → la entera (lo ven todas las pantallas);
//   · pedidos, cocina o reparto (PEDIDOS, abajo) → todo: la entera, que lleva la corta.
// La corta ya no va en cada push: no protege nada que una rama que no toca
// pedidos pueda romper. La entera corre además cada noche sobre main
// (e2e-staging-conta.yml, «schedule»), y con la etiqueta «e2e-entera».
//
//   node scripts/e2e/area.mjs <rama> --cambiados <fichero> --etiquetas "a,b"
//     → entera=…, pruebas=…, porque=… (lo usa el plan del workflow)

import { existsSync, readdirSync } from 'node:fs'

export const COMUN = ['tests/e2e/conta/c00/marco.spec.ts', 'tests/e2e/conta/rls.spec.ts']

/**
 * La e2e CORTA de pedidos, cocina y reparto (Julio, 19/10). Lo que cubre, hoy:
 *   · direccion-falta: Pedidos en el ordenador (/orders y el Despacho), el
 *     ticket de la bolsa, la tablet de cocina (/estacion, con «Listo») y el
 *     permiso por local entre tablets: 9 pruebas, 59,6 s;
 *   · quien-reparte: «Quién reparte» y la etiqueta de reparto en la cocina, y
 *     que la cuenta B no ve ni toca lo de A: 4 pruebas, 31,4 s.
 * 91 s de pruebas en los dos tamaños (tests/e2e/tiempos.json, la misma vara
 * que la entera). Lo que NO cubre, porque no hay e2e de ello: crear un pedido
 * y llevarlo por todos sus estados en cocina.
 */
export const CORTA = ['tests/e2e/reparto/direccion-falta.spec.ts', 'tests/e2e/reparto/quien-reparte.spec.ts']

/**
 * PEDIDOS, COCINA Y REPARTO (W04, 22/10): lo que, si se toca, pide «todo». Las
 * pantallas y las funciones del camino del pedido: pedidos, cocina, pase, TPV,
 * tickets, tablets, reparto y seguimiento, y las integraciones que traen o
 * mueven pedidos. La base del camino la mira el analizador de la tanda (W01).
 */
export const PEDIDOS = [
  'src/modules/orders/', 'src/modules/kds/', 'src/modules/kitchen/', 'src/modules/pase/',
  'src/modules/pos/', 'src/modules/printing/', 'src/modules/tablet/', 'src/modules/shop/',
  'src/modules/reparto/', 'src/modules/repartidor/', 'src/modules/seguimiento/',
  'src/pages/RepartoSettingsPage.tsx',
  'supabase/functions/hubrise-', 'supabase/functions/lastapp-', 'supabase/functions/order-',
  'supabase/functions/catcher-dispatch/', 'supabase/functions/availability-dispatch/',
  'supabase/functions/courier-proof-upload/',
  'tests/e2e/reparto/',
]

/** De los ficheros cambiados, los de pedidos, cocina o reparto. */
export function dePedidos(cambiados) {
  return cambiados.filter((f) => PEDIDOS.some((p) => f.startsWith(p)))
}

/**
 * LO COMÚN (Julio, 21/10): «la entera solo si el PR toca lo común (marco,
 * cabecera, barra, diseño compartido) o con una etiqueta que la pida». Lo que
 * ven TODAS las pantallas a la vez, y lo que mueve TODAS las pruebas a la vez.
 * Un camino que acaba en «/» es una carpeta; si no, un fichero o el principio
 * de un nombre (tsconfig → tsconfig.json, tsconfig.app.json…).
 */
export const LO_COMUN = [
  // El marco, la cabecera, la barra de productos y el esqueleto.
  'src/modules/conta/esqueleto/',
  'src/modules/conta/marco/',
  'src/modules/conta/ui/marco/',
  // El diseño compartido: piezas, tokens e iconos, y los estilos de todos.
  'src/modules/conta/diseno/',
  'src/modules/conta/estilo/marco.css',
  'src/modules/conta/estilo/tokens.css',
  'src/modules/conta/estilo/piezas.css',
  'src/modules/conta/estilo/componentes.css',
  'src/modules/conta/estilo/index.ts',
  // Las rutas de contabilidad y el arranque de la app (el armazón de todo).
  'src/modules/conta/module.tsx',
  'src/App.tsx',
  'src/main.tsx',
  'src/index.css',
  'src/routes.ts',
  'src/context/',
  'src/shell/',
  'src/marca/',
  'src/branding.ts',
  // Lo que mueve todas las pruebas: Playwright, la sesión, el carril y el reparto en trozos.
  'playwright.config.ts',
  'tests/e2e/conta/sesion.ts',
  'tests/e2e/conta/api.ts',
  'tests/e2e/conta/red.ts',
  'tests/e2e/conta/burbuja.ts',
  'tests/e2e/conta/solapes.ts',
  'scripts/e2e/carril',
  'scripts/e2e/trozos.mjs',
  '.github/workflows/e2e-staging-conta.yml',
  // Las dependencias y el build.
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig',
]

/**
 * LAS ZONAS POR FICHERO (Julio, 21/10, encargo del autoconteo): una zona que no
 * es de ninguna rama, sino de lo que se toca. Un push que cambia algo de aquí
 * corre además su carpeta de e2e, sea cual sea la rama. Y si la rama no es de
 * ningún frente, la zona es también la dueña de sus capturas
 * (scripts/conta/capturas.mjs): la misma tabla para las dos cosas.
 */
export const ZONAS_POR_FICHERO = [
  {
    zona: 'inventario',
    pruebas: 'tests/e2e/inventario',
    capturas: 'docs/inventario/capturas',
    ficheros: ['src/modules/supply/', 'src/pages/trabajador/', 'tests/e2e/inventario/', 'supabase/seeds/conta/seed_autoconteo_e2e_staging.sql'],
  },
]

/** Las zonas que tocan unos ficheros cambiados, en el orden de la tabla. */
export function zonasTocadas(cambiados) {
  return ZONAS_POR_FICHERO.filter((z) => cambiados.some((f) => z.ficheros.some((p) => f.startsWith(p))))
}

/** La etiqueta de un PR que pide la entera aunque no toque lo común. */
export const ETIQUETA_ENTERA = 'e2e-entera'

/** De los ficheros cambiados, los que son de lo común. */
export function deLoComun(cambiados) {
  return cambiados.filter((f) => LO_COMUN.some((p) => f === p || f.startsWith(p)))
}

/**
 * Qué corre la e2e de un PUSH: la entera si el PR toca lo común, pedidos, cocina
 * o reparto, o lleva la etiqueta; si no, la zona de la rama (y la de lo que
 * toca). «porque» va al resumen del run.
 */
export function queCorre(rama, { cambiados = [], etiquetas = [] } = {}, carpetas = carpetasConta()) {
  const comun = deLoComun(cambiados)
  if (etiquetas.includes(ETIQUETA_ENTERA)) {
    return { entera: true, pruebas: [], porque: `el PR lleva la etiqueta «${ETIQUETA_ENTERA}»` }
  }
  if (comun.length) {
    const muestra = comun.slice(0, 3).join(', ') + (comun.length > 3 ? ` y ${comun.length - 3} más` : '')
    return { entera: true, pruebas: [], porque: `toca lo común: ${muestra}` }
  }
  const pedidos = dePedidos(cambiados)
  if (pedidos.length) {
    const muestra = pedidos.slice(0, 3).join(', ') + (pedidos.length > 3 ? ` y ${pedidos.length - 3} más` : '')
    return { entera: true, pruebas: [], porque: `toca pedidos, cocina o reparto: ${muestra}` }
  }
  const zonas = zonasTocadas(cambiados)
  const deLaRama = pruebasDeLaZona(rama, carpetas)
  const extra = zonas.map((z) => z.pruebas).filter((p) => !deLaRama.includes(p))
  const porque = extra.length
    ? `solo pantallas: la zona de la rama y la de lo que toca (${zonas.map((z) => z.zona).join(', ')})`
    : 'solo pantallas: la zona de la rama'
  return { entera: false, pruebas: [...deLaRama, ...extra], porque }
}

/** Las carpetas de tests/e2e/conta (b01, c02c, cierre…). */
export function carpetasConta(dir = 'tests/e2e/conta') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
}

/** Lo que corre un push sin saber qué toca: solo la zona de la rama. */
export function pruebasDelPush(rama, carpetas = carpetasConta()) {
  return pruebasDeLaZona(rama, carpetas)
}

/** Solo las de la zona de la rama (sin la corta). */
export function pruebasDeLaZona(rama, carpetas = carpetasConta()) {
  const r = String(rama ?? '')
  // Sin repetir: conta/c00 ya lleva marco.spec.ts dentro.
  const con = (c) => [`tests/e2e/conta/${c}`, ...COMUN.filter((f) => !f.startsWith(`tests/e2e/conta/${c}/`))]
  if (/^reparto-/.test(r)) return ['tests/e2e/reparto']
  if (/^conta\/b\d/.test(r)) return con('b01')   // B01, B02…: las pantallas de Bancos viven en b01
  if (/^conta\/d\d/.test(r)) return con('d01')
  if (/^conta\/(c06|f\d)/.test(r)) return con('c06')
  if (/^conta\/m\d/.test(r)) return con('m01')
  const m = /^conta\/([a-z0-9]+)/.exec(r)
  if (m) {
    // La carpeta más larga que es principio del nombre: conta/c02c-traer → c02c, no c02.
    const c = carpetas.filter((x) => m[1].startsWith(x)).sort((a, b) => b.length - a.length)[0]
    if (c) return con(c)
  }
  return [...COMUN]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // node scripts/e2e/area.mjs <rama>                                  → las pruebas de la zona
  // node scripts/e2e/area.mjs <rama> --cambiados <fichero> --etiquetas "a,b"
  //   → tres líneas para $GITHUB_OUTPUT: entera=true|false, pruebas=…, porque=…
  const args = process.argv.slice(2)
  const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? '' : undefined }
  const fCambiados = valor('--cambiados')
  if (fCambiados === undefined) {
    const p = pruebasDelPush(args[0])
    if (!p.length) { console.error('area.mjs: sin pruebas (sería la suite entera)'); process.exit(1) }
    console.log(p.join(' '))
  } else {
    const { readFileSync } = await import('node:fs')
    const cambiados = readFileSync(fCambiados, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)
    const etiquetas = (valor('--etiquetas') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    const r = queCorre(args[0], { cambiados, etiquetas })
    if (!r.entera && !r.pruebas.length) { console.error('area.mjs: sin pruebas (sería la suite entera)'); process.exit(1) }
    console.log(`entera=${r.entera}`)
    console.log(`pruebas=${r.pruebas.join(' ')}`)
    console.log(`porque=${r.porque}`)
  }
}
