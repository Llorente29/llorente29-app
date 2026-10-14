// scripts/conta/lib/citarNorma.mjs
//
// D01 R2 punto 5 · Citar la norma LITERAL desde los textos oficiales que
// descarga fuentes-oficiales-conta.yml (docs/conta/fuentes/textos/, con su URL
// y su sha256 en registro.json). Nada de memoria: si el artículo o el apartado
// no está en el texto, lanza.
//
// Los textos consolidados del BOE traen cada artículo en un bloque «## [aN]»
// (o «## [artN]») con sus versiones «### versión · vigente desde AAAA-MM-DD ·
// BOE-…». La que vale es la de fecha más reciente que no sea futura.

const ORDINALES = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez']
const ES_APARTADO = new RegExp(`^(?:\\d+\\.|(?:${ORDINALES.join('|')})\\.)\\s`)

/** El texto vigente de un artículo: { desde, boe, lineas }. */
export function articuloVigente(texto, numero, hoy = new Date().toISOString().slice(0, 10)) {
  const lineas = String(texto).split('\n')
  const ids = [`## [a${numero}]`, `## [art${numero}]`]
  const ini = lineas.findIndex((l) => ids.includes(l.trim()))
  if (ini < 0) throw new Error(`no está el artículo ${numero}`)
  let fin = lineas.findIndex((l, i) => i > ini && l.startsWith('## ['))
  if (fin < 0) fin = lineas.length
  const versiones = []
  for (let i = ini + 1; i < fin; i++) {
    const m = /^### versión · vigente desde (\d{4}-\d{2}-\d{2}) · (\S+)/.exec(lineas[i])
    if (m) versiones.push({ desde: m[1], boe: m[2], i })
  }
  const validas = versiones.filter((v) => v.desde <= hoy)
  if (!validas.length) throw new Error(`el artículo ${numero} no tiene versión vigente`)
  const v = validas.reduce((a, b) => (b.desde >= a.desde ? b : a))
  const siguiente = versiones.find((x) => x.i > v.i)?.i ?? fin
  const cuerpo = lineas.slice(v.i + 1, siguiente).filter((l) => l.trim() !== '')
  return { desde: v.desde, boe: v.boe, lineas: cuerpo }
}

/** Solo los apartados pedidos («Tres», «1», «a)»…): desde su línea hasta el siguiente apartado. */
export function apartados(art, pedidos) {
  if (!pedidos?.length) return art.lineas
  const out = []
  for (const p of pedidos) {
    const k = art.lineas.findIndex((l) => l.startsWith(`${p}. `) || l.startsWith(`${p} `))
    if (k < 0) throw new Error(`no está el apartado ${p}`)
    out.push(art.lineas[k])
    for (let j = k + 1; j < art.lineas.length && !ES_APARTADO.test(art.lineas[j]) && !/^(Se modifica|Se añade|Se suprime|Se da nueva|Téngase en cuenta)/.test(art.lineas[j]); j++) out.push(art.lineas[j])
  }
  return out
}
