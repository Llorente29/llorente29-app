// scripts/pr/funcionesADesplegar.mjs
//
// C06b (respuesta 5, punto 5) · Las reglas de un PR a main, comprobables:
//   1. El título nunca lleva una marca de saltar CI («[skip ci]» y sus
//      hermanas). Con ella, el push a main no lanza deploy-edge-functions y
//      las funciones se quedan sin desplegar: la #181, el 14/10.
//   2. El cuerpo dice qué funciones hay que desplegar A MANO, en una sección
//      «Funciones a desplegar a mano», y dice exactamente las que toca el
//      diff: las carpetas de supabase/functions cambiadas y, si cambia algo de
//      _shared, cada función que lo importa (deploy-edge-functions se salta
//      _shared, y un cambio ahí no despliega a nadie solo). «ninguna» si no hay.
// Puro (sin red ni disco): lo llama el workflow pr-a-main.yml con el diff y
// los imports ya leídos, y lo prueban las unitarias.

export const MARCAS_SALTAR = ['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]']

/** La marca de saltar CI que lleve el título, o null. */
export function marcaDeSaltar(titulo) {
  const t = String(titulo ?? '').toLowerCase()
  return MARCAS_SALTAR.find((m) => t.includes(m)) ?? null
}

/**
 * Las funciones que tocan este diff. `cambiados`: rutas del diff. `importa`:
 * { función: [rutas de _shared que importa, directa o indirectamente] }.
 */
export function funcionesTocadas(cambiados, importa) {
  const out = new Set()
  const shared = new Set()
  for (const f of cambiados) {
    const m = f.match(/^supabase\/functions\/([^/]+)\//)
    if (!m) continue
    if (m[1] === '_shared') shared.add(f)
    else out.add(m[1])
  }
  for (const [fn, deps] of Object.entries(importa)) if (deps.some((d) => shared.has(d))) out.add(fn)
  return [...out].sort()
}

/** Lo que dice el cuerpo, de la sección «Funciones a desplegar a mano»: una lista, [] si dice «ninguna», null si no está. */
export function funcionesDelCuerpo(cuerpo) {
  const lineas = String(cuerpo ?? '').split(/\r?\n/)
  const i = lineas.findIndex((l) => /^#{1,6}\s*funciones a desplegar a mano\s*$/i.test(l.trim()))
  if (i < 0) return null
  // N2: las funciones pueden ir en «### Sumied» y «### Folvy»; solo para un encabezado de su nivel o más alto.
  const nivel = lineas[i].trim().match(/^#+/)[0].length
  const out = []
  // W12 (29/10): «ninguna» vale solo para su grupo («### Folvy» → ninguna de Folvy). Antes, una
  // línea «ninguna» bajo un grupo vaciaba la sección entera y se perdían las del otro grupo (#390).
  for (const l of lineas.slice(i + 1)) {
    const h = l.trim().match(/^(#{1,6})\s/)
    if (h && h[1].length <= nivel) break
    if (h) continue
    if (/^\s*[-*]?\s*ninguna\b/i.test(l)) continue
    const m = l.match(/^\s*[-*]\s*`?([a-z0-9][a-z0-9_-]*)`?/i)
    if (m) out.push(m[1])
  }
  return out.sort()
}

/** Los fallos del PR, en frases; [] si cumple. */
export function revisarPr({ titulo, cuerpo, cambiados, importa }) {
  const fallos = []
  const marca = marcaDeSaltar(titulo)
  if (marca) fallos.push(`El título lleva «${marca}»: el push a main no desplegaría las funciones. Quítalo del título y no lo pongas en el mensaje de la fusión.`)
  const tocadas = funcionesTocadas(cambiados, importa)
  const dichas = funcionesDelCuerpo(cuerpo)
  if (dichas === null) {
    fallos.push(`Falta la sección «## Funciones a desplegar a mano» en la descripción (${tocadas.length ? tocadas.join(', ') : 'ninguna'}).`)
  } else {
    const faltan = tocadas.filter((f) => !dichas.includes(f))
    const sobran = dichas.filter((f) => !tocadas.includes(f))
    if (faltan.length) fallos.push(`«Funciones a desplegar a mano» no dice: ${faltan.join(', ')}.`)
    if (sobran.length) fallos.push(`«Funciones a desplegar a mano» dice ${sobran.join(', ')}, que este PR no toca.`)
  }
  return fallos
}
