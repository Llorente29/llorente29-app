#!/usr/bin/env node
// scripts/e2e/area.mjs — qué pruebas corre la e2e de un PUSH, según la rama.
//
// W02 (17/10, gasto de Actions). La e2e de cada push corre solo las pruebas
// del área de la rama, en un trozo. La suite ENTERA ya no corre en ningún
// push (Julio, 26/10, abajo): solo cada noche y con la etiqueta.
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
//     push (ZONAS_POR_FICHERO: inventario, 21/10);
//   · y cada fichero .spec.ts de tests/e2e que cambia el PR y no cae ya en lo
//     de arriba (V03, respuesta 6, 26/10: la #933 no corría las dos pruebas que
//     arreglaba el PR, porque no eran de la zona de su rama).
// Nunca vacío: vacío sería la suite entera.
//
// LA ENTERA, NUNCA EN UN PR (Julio, 26/10; antes, W04 22/10, «la entera si
// toca lo común»). Corre solo de noche sobre main y con la etiqueta
// «e2e-entera». En un push:
//   · la zona (arriba) y cada .spec.ts que cambia el PR;
//   · lo común → además la rápida de pantallas (HUMO, ≤ 10 min);
//   · pedidos, cocina o reparto (PEDIDOS) → además la corta.
// «propias» (la zona del PR) son las que bloquean siempre; en las demás, un
// fallo por tiempo no bloquea (scripts/e2e/por-fichero.sh). Detalle:
// docs/conta/pruebas_de_un_pr.md.
//
//   node scripts/e2e/area.mjs <rama> --cambiados <fichero> --etiquetas "a,b"
//     → entera=…, pruebas=…, propias=…, porque=… (lo usa el plan del workflow)

import { existsSync, readdirSync } from 'node:fs'

export const COMUN = ['tests/e2e/conta/c00/marco.spec.ts', 'tests/e2e/conta/rls.spec.ts']

/**
 * La e2e CORTA de pedidos, cocina y reparto (Julio, 19/10). Lo que cubre, hoy:
 *   · direccion-falta: Pedidos en el ordenador (/orders y el Despacho), el
 *     ticket de la bolsa, la tablet de cocina (/estacion, con «Listo») y el
 *     permiso por local entre tablets: 9 pruebas, 59,6 s;
 *   · quien-reparte: «Quién reparte» y la etiqueta de reparto en la cocina, y
 *     que la cuenta B no ve ni toca lo de A: 4 pruebas, 31,4 s.
 * 91 s de pruebas en los dos tamaños (tests/e2e/tiempos/, la misma vara
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
/**
 * SUMIED Y FOLVY, SEPARADOS (C10, Julio, 23/10): «un cambio solo de Sumied no
 * lanza las de Folvy, y al revés; lo común lanza las dos». Sumied es la
 * contabilidad (sus pruebas, tests/e2e/conta); Folvy, el resto (tests/e2e/reparto,
 * tests/e2e/inventario…). LO_COMUN se parte en dos:
 *   · LO_COMUN_SUMIED: el marco, el diseño y la sesión de las pruebas de la
 *     contabilidad → la entera de Sumied;
 *   · LO_COMUN_AMBOS: el arranque de la app, las dependencias, Playwright y el
 *     reparto en trozos → la entera de las dos.
 * PEDIDOS (cocina, pedidos y reparto) es la entera de Folvy.
 */
export const LO_COMUN_SUMIED = [
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
  // Lo que mueve todas las pruebas de la contabilidad: la sesión, la API, la red, la burbuja y los solapes.
  'tests/e2e/conta/sesion.ts',
  'tests/e2e/conta/api.ts',
  'tests/e2e/conta/red.ts',
  'tests/e2e/conta/burbuja.ts',
  'tests/e2e/conta/solapes.ts',
]
export const LO_COMUN_AMBOS = [
  // El arranque de la app (el armazón de todo).
  'src/App.tsx',
  'src/main.tsx',
  'src/index.css',
  'src/routes.ts',
  'src/context/',
  'src/shell/',
  'src/marca/',
  'src/branding.ts',
  // Lo que mueve todas las pruebas: Playwright, el carril y el reparto en trozos.
  'playwright.config.ts',
  'scripts/e2e/carril',
  'scripts/e2e/por-fichero.sh',
  'scripts/e2e/trozos.mjs',
  '.github/workflows/e2e-staging-conta.yml',
  // Las dependencias y el build.
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig',
]
/** Lo común de antes del C10: los dos juntos. */
export const LO_COMUN = [...LO_COMUN_SUMIED, ...LO_COMUN_AMBOS]

/** Las pruebas de cada producto. Folvy: cada carpeta de tests/e2e que no es la de la contabilidad. */
export const SUITE_SUMIED = ['tests/e2e/conta']
export function suiteFolvy(raiz = 'tests/e2e') {
  if (!existsSync(raiz)) return []
  // W12: tests/e2e/tiempos no son pruebas: son sus tiempos, uno por prueba.
  return readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'conta' && d.name !== 'tiempos').map((d) => `${raiz}/${d.name}`).sort()
}
/** Lo que es de Sumied (la contabilidad): sus pantallas, funciones, guiones, pruebas y documentos. */
export const RUTAS_SUMIED = [
  'src/modules/conta/', 'supabase/functions/conta-', 'scripts/conta/', 'tests/conta/', 'tests/e2e/conta/',
  'tests/unit/modules/conta/', 'docs/conta/', 'supabase/seeds/conta/', 'supabase/produccion/tandas/sumied/', 'supabase/staging/tandas/sumied/',
]
/** ¿Toca la contabilidad? ¿Toca Folvy (pantallas, funciones o pruebas que no son de la contabilidad)? */
export function productosTocados(cambiados) {
  // W12: un tiempo cuenta como la prueba que mide (tests/e2e/tiempos/conta/… es de Sumied); la nota y el techo, de nadie.
  cambiados = cambiados.flatMap((f) => {
    if (!f.startsWith('tests/e2e/tiempos/')) return [f]
    const m = /^tests\/e2e\/tiempos\/(.+\.spec\.ts)\.json$/.exec(f)
    return m ? [`tests/e2e/${m[1]}`] : []
  })
  const esSumied = (f) => RUTAS_SUMIED.some((p) => f.startsWith(p))
  const esFolvy = (f) => !esSumied(f) && /^(src\/|supabase\/functions\/|tests\/e2e\/|tests\/unit\/|supabase\/(produccion|staging)\/tandas\/folvy\/)/.test(f)
  return { sumied: cambiados.some(esSumied), folvy: cambiados.some(esFolvy) }
}

/**
 * LAS ZONAS POR FICHERO (Julio, 21/10, encargo del autoconteo): una zona que no
 * es de ninguna rama, sino de lo que se toca. Dos listas, para dos cosas:
 *   · `ficheros`: un push que cambia algo de aquí corre además su carpeta de
 *     e2e, sea cual sea la rama. Es ancha a propósito: incluye a los VECINOS
 *     (el portal del trabajador es la puerta del autoconteo), porque romperlos
 *     rompe la zona.
 *   · `duenos` (W08, 28/10): si la rama no es de ningún frente y cambia algo de
 *     aquí, la zona es la dueña de sus capturas (scripts/conta/capturas.mjs).
 *     Es estrecha: solo lo que ES de la zona. Hasta el W08 era la misma lista,
 *     y tres PR de Laboral que solo tocaban el portal (#350, #354 y #370)
 *     fijaron PNG de inventario y chocaron con main.
 */
export const ZONAS_POR_FICHERO = [
  {
    zona: 'inventario',
    pruebas: 'tests/e2e/inventario',
    capturas: 'docs/inventario/capturas',
    ficheros: ['src/modules/supply/', 'src/pages/trabajador/', 'tests/e2e/inventario/', 'supabase/seeds/conta/seed_autoconteo_e2e_staging.sql'],
    // Del portal, solo la pantalla del conteo.
    duenos: ['src/modules/supply/', 'src/pages/trabajador/MiAutoinventario.tsx', 'tests/e2e/inventario/', 'supabase/seeds/conta/seed_autoconteo_e2e_staging.sql'],
  },
  {
    // F01 (27/10): las marcas de Last (el aviso de Inicio y el alta en Marcas).
    zona: 'marcas',
    pruebas: 'tests/e2e/marcas',
    capturas: 'docs/marcas/capturas',
    ficheros: ['src/modules/multitenancy/', 'tests/e2e/marcas/', 'supabase/seeds/folvy/seed_f01_marcas_last_staging.sql', 'supabase/seeds/folvy/seed_f01b_cambios_carta_staging.sql',
      'supabase/seeds/folvy/seed_f01c_recetas_y_codigo_staging.sql'],
    duenos: ['src/modules/multitenancy/', 'tests/e2e/marcas/', 'supabase/seeds/folvy/seed_f01_marcas_last_staging.sql', 'supabase/seeds/folvy/seed_f01b_cambios_carta_staging.sql',
      'supabase/seeds/folvy/seed_f01c_recetas_y_codigo_staging.sql'],
  },
]

/** Las zonas que tocan unos ficheros cambiados, en el orden de la tabla (qué e2e corre). */
export function zonasTocadas(cambiados) {
  return ZONAS_POR_FICHERO.filter((z) => cambiados.some((f) => z.ficheros.some((p) => f.startsWith(p))))
}

/** Las zonas de las que unos ficheros cambiados SON (no solo vecinos): las dueñas de capturas. */
export function zonasDuenas(cambiados) {
  return ZONAS_POR_FICHERO.filter((z) => cambiados.some((f) => z.duenos.some((p) => f === p || f.startsWith(p))))
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
/** La prueba rápida de lo común (Julio, 26/10): abre cada pantalla de Sumied una vez, en los dos tamaños (≤ 10 min). */
export const HUMO = 'tests/e2e/conta/humo/pantallas.spec.ts'

/**
 * Qué corre la e2e de un PUSH (Julio, 26/10: «la entera NO corre en ningún PR,
 * nunca, solo de noche sobre main, y con la etiqueta «e2e-entera»»):
 *   · siempre, la zona de la rama (y la de lo que toca) y cada .spec.ts que
 *     cambia el PR;
 *   · si toca lo común (el marco, el menú, module.tsx, el arranque…), además
 *     la prueba rápida (HUMO);
 *   · si toca pedidos, cocina o reparto, además la corta (CORTA);
 *   · la entera, solo con la etiqueta.
 * «propias» son las de la zona del PR: un fallo por TIEMPO en una que no es
 * propia (el juego común, la rápida) no bloquea fusionar; se apunta y lo mira
 * la de la noche (por-fichero.sh). «porque» va al resumen del run.
 */
export function queCorre(rama, { cambiados = [], etiquetas = [], existe = existsSync } = {}, carpetas = carpetasConta(), folvy = suiteFolvy()) {
  const muestra = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` y ${xs.length - 3} más` : '')
  if (etiquetas.includes(ETIQUETA_ENTERA)) {
    return { entera: true, pruebas: [], propias: [], porque: `el PR lleva la etiqueta «${ETIQUETA_ENTERA}»` }
  }
  const de = (lista) => cambiados.filter((f) => lista.some((p) => f === p || f.startsWith(p)))
  const comun = [...de(LO_COMUN_AMBOS), ...de(LO_COMUN_SUMIED)]
  const toca = productosTocados(cambiados)
  const pedidos = dePedidos(cambiados)
  const zonas = zonasTocadas(cambiados)
  const porque = []
  const propias = []
  const ajenas = []
  // La zona de la rama: lo de la contabilidad si la toca (o no toca nada de Folvy); si solo toca Folvy, las de Folvy.
  if (toca.sumied || !toca.folvy || comun.length) {
    const zona = pruebasDeLaZona(rama, carpetas)
    propias.push(...zona.filter((p) => !COMUN.includes(p)))
    ajenas.push(...zona.filter((p) => COMUN.includes(p)))
    porque.push('la zona de la rama')
  } else if (!pedidos.length && !zonas.length) {
    propias.push(...folvy)
    porque.push('las de Folvy (solo toca Folvy)')
  }
  if (zonas.length) { propias.push(...zonas.map((z) => z.pruebas)); porque.push(`la de lo que toca (${zonas.map((z) => z.zona).join(', ')})`) }
  if (pedidos.length) { propias.push(...CORTA); porque.push(`la corta, porque toca pedidos, cocina o reparto: ${muestra(pedidos)}`) }
  if (comun.length) { ajenas.push(HUMO); porque.push(`la rápida de pantallas, porque toca lo común: ${muestra([...new Set(comun)])}`) }
  // Las que cambia el PR (una prueba borrada no se corre: ya no existe), sin repetir lo que ya va dentro.
  const dentro = (f, lista) => lista.some((p) => f === p || f.startsWith(`${p}/`))
  const tocadas = specsTocadas(cambiados, existe).filter((f) => !dentro(f, propias) && !dentro(f, ajenas))
  if (tocadas.length) { propias.push(...tocadas); porque.push(`las que cambia el PR: ${muestra(tocadas)}`) }
  const unicas = (xs) => [...new Set(xs)]
  const p = unicas(propias)
  return { entera: false, pruebas: unicas([...p, ...ajenas]), propias: p, porque: 'sin la entera: ' + porque.join('; ') }
}

/** Los .spec.ts de tests/e2e que cambia el PR y siguen existiendo, sin repetir. */
export function specsTocadas(cambiados, existe = existsSync) {
  return [...new Set(cambiados.filter((f) => /^tests\/e2e\/.+\.spec\.ts$/.test(f) && existe(f)))]
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
    console.log(`propias=${r.propias.join(' ')}`)
    console.log(`porque=${r.porque}`)
  }
}
