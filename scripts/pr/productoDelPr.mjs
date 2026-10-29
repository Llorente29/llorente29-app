// scripts/pr/productoDelPr.mjs
//
// N2 (cola de noche del 23/10, paso 3 de la auditoría C09) · Todo PR a main dice
// a qué producto va, y las funciones que despliega van por producto.
//
//   1. La descripción lleva «## Producto» con Sumied, Folvy o Común (uno o
//      varios, separados por comas o «y»). Se comprueba contra el diff:
//        · un fichero de Sumied (RUTAS_SUMIED de area.mjs: src/modules/conta,
//          conta-*, scripts/conta, sus pruebas, sus tandas…) pide «Sumied»;
//        · uno de Folvy (los demás módulos y páginas, sus funciones, sus
//          pruebas y sus tandas) pide «Folvy»;
//        · uno común (el arranque de la app, LO_COMUN_AMBOS; lo compartido de
//          src fuera de los módulos; y supabase/functions/_shared, que
//          despliega funciones de los dos) pide «Común»;
//        · el resto (migraciones, workflows, docs, scripts…) no pide nada: el
//          nombre del fichero no dice de quién es, y lo dice quien escribe el PR.
//      Decir un producto que el diff no toca solo falla si el PR no lleva
//      ninguno de esos ficheros «sin dueño» que lo pudieran justificar.
//   2. «Funciones a desplegar a mano» puede llevar sus funciones en «### Sumied»
//      y «### Folvy» (las conta-* son de Sumied; las demás, de Folvy). Si lleva
//      los grupos, cada función tiene que estar en el suyo.
// Puro (sin red ni disco): lo llama revisar-pr.mjs y lo prueban las unitarias.

import { RUTAS_SUMIED, LO_COMUN_AMBOS } from '../e2e/area.mjs'

export const PRODUCTOS = ['sumied', 'folvy', 'comun']
const NOMBRE = { sumied: 'Sumied', folvy: 'Folvy', comun: 'Común' }

const empieza = (f, lista) => lista.some((p) => f === p || f.startsWith(p))

/** De qué producto es un fichero del diff: 'sumied', 'folvy', 'comun' o null (sin dueño por su nombre). */
export function productoDelFichero(f) {
  // W12: el tiempo de una prueba (tests/e2e/tiempos/<ruta>.json) es del producto de la prueba; la nota y el techo, de nadie.
  if (f.startsWith('tests/e2e/tiempos/')) {
    const prueba = /^tests\/e2e\/tiempos\/(.+\.spec\.ts)\.json$/.exec(f)
    return prueba ? productoDelFichero(`tests/e2e/${prueba[1]}`) : null
  }
  if (empieza(f, LO_COMUN_AMBOS)) return 'comun'
  if (f.startsWith('supabase/functions/_shared/')) return 'comun'
  if (empieza(f, RUTAS_SUMIED)) return 'sumied'
  if (/^src\/modules\/(?!conta\/)[^/]+\//.test(f)) return 'folvy'
  if (/^src\/pages\//.test(f)) return 'folvy'
  if (/^supabase\/functions\/[^/]+\//.test(f)) return 'folvy'   // ni conta-* ni _shared: arriba
  if (empieza(f, ['tests/unit/', 'tests/inventario/', 'tests/e2e/', 'scripts/inventario/',
    'supabase/produccion/tandas/folvy/', 'supabase/staging/tandas/folvy/', 'android/'])) return 'folvy'
  if (/^src\//.test(f)) return 'comun'   // src/lib, src/hooks, src/config, src/components…
  return null
}

/** De qué producto es una función: las conta-* de Sumied, el resto de Folvy. */
export function productoDeLaFuncion(fn) {
  return fn.startsWith('conta-') ? 'sumied' : 'folvy'
}

/** Lo que pide el diff: los productos que tiene que decir y si lleva ficheros sin dueño. */
export function productosDelDiff(cambiados) {
  const pide = new Set()
  let sinDueno = 0
  for (const f of cambiados) {
    const p = productoDelFichero(f)
    if (p) pide.add(p)
    else sinDueno++
  }
  return { pide: PRODUCTOS.filter((p) => pide.has(p)), sinDueno }
}

/** La sección «## Producto» del cuerpo: los productos que dice, [] si está vacía, null si no está. */
export function productoDelCuerpo(cuerpo) {
  const lineas = String(cuerpo ?? '').split(/\r?\n/)
  const i = lineas.findIndex((l) => /^#{1,6}\s*producto\s*$/i.test(l.trim()))
  if (i < 0) return null
  const texto = []
  for (const l of lineas.slice(i + 1)) {
    if (/^#{1,6}\s/.test(l.trim())) break
    texto.push(l)
  }
  const t = texto.join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return PRODUCTOS.filter((p) => new RegExp(`\\b${p}\\b`).test(t))
}

/** Las funciones de «Funciones a desplegar a mano» con su grupo («### Sumied» / «### Folvy»), o null si no usa grupos. */
export function gruposDeFunciones(cuerpo) {
  const lineas = String(cuerpo ?? '').split(/\r?\n/)
  const i = lineas.findIndex((l) => /^#{1,6}\s*funciones a desplegar a mano\s*$/i.test(l.trim()))
  if (i < 0) return null
  const nivel = lineas[i].trim().match(/^#+/)[0].length
  const out = []
  let grupo = null
  let hayGrupos = false
  for (const l of lineas.slice(i + 1)) {
    const h = l.trim().match(/^(#{1,6})\s*(.*)$/)
    if (h) {
      if (h[1].length <= nivel) break
      const g = h[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
      grupo = g === 'sumied' ? 'sumied' : g === 'folvy' ? 'folvy' : g
      hayGrupos = true
      continue
    }
    const m = l.match(/^\s*[-*]\s*`?([a-z0-9][a-z0-9_-]*)`?/i)
    if (m && m[1].toLowerCase() !== 'ninguna') out.push({ funcion: m[1], grupo })
  }
  return hayGrupos ? out : null
}

/** Los fallos de «## Producto» y de los grupos de funciones, en frases; [] si cumple. */
export function revisarProducto({ cuerpo, cambiados }) {
  const fallos = []
  const { pide, sinDueno } = productosDelDiff(cambiados)
  const dice = productoDelCuerpo(cuerpo)
  const lista = (xs) => xs.map((p) => NOMBRE[p]).join(', ')
  if (dice === null) {
    fallos.push(`Falta la sección «## Producto» en la descripción: Sumied, Folvy o Común${pide.length ? ` (el diff pide ${lista(pide)})` : ''}.`)
  } else if (!dice.length) {
    fallos.push('«## Producto» está vacía: di Sumied, Folvy o Común.')
  } else {
    const faltan = pide.filter((p) => !dice.includes(p))
    if (faltan.length) fallos.push(`«## Producto» no dice ${lista(faltan)}, y el diff lo toca.`)
    const sobran = dice.filter((p) => !pide.includes(p))
    if (sobran.length && sinDueno === 0) fallos.push(`«## Producto» dice ${lista(sobran)}, que este PR no toca.`)
  }
  const grupos = gruposDeFunciones(cuerpo)
  for (const { funcion, grupo } of grupos ?? []) {
    const suyo = productoDeLaFuncion(funcion)
    if (grupo !== suyo) fallos.push(`«${funcion}» va en «### ${NOMBRE[suyo]}» de «Funciones a desplegar a mano»${grupo ? `, no en «### ${NOMBRE[grupo] ?? grupo}»` : ''}.`)
  }
  return fallos
}

/** Las funciones tocadas, por producto, para el registro del run. */
export function funcionesPorProducto(funciones) {
  const out = { sumied: [], folvy: [] }
  for (const f of funciones) out[productoDeLaFuncion(f)].push(f)
  return out
}
