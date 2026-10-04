// scripts/conta/lib/planContable.mjs
//
// C02 · La SERIE del plan contable, leída del texto consolidado del BOE que
// descarga Actions (docs/conta/fuentes/textos/rd-1514-2007.txt y
// rd-1515-2007.txt). Nunca de memoria.
//
// El texto trae las cuentas DOS veces:
//   · cuarta parte, «Cuadro de cuentas»: bloques [grupo1] … [grupo9];
//   · quinta parte, «Definiciones y relaciones contables»: bloques [grupo1-2] …,
//     que repiten la lista de cada subgrupo y luego definen cada cuenta
//     («100. Capital social» y su movimiento).
// La serie es la cuarta parte. Donde la cuarta y la quinta no dicen lo mismo,
// manda la cuarta SALVO que haya una corrección escrita en
// supabase/conta/pgc/correcciones.json con la cita literal de la quinta parte
// (decisión D1 de Julio, 04/10/2026). Nada se corrige sin cita.
//
// Normalización (no es corrección, es tipografía del XML del BOE y se aplica
// igual a los dos lados): se quita el guion blando (U+00AD), se juntan los
// espacios y se quita el punto final.
//
// Pura: recibe texto, devuelve datos. Sin red ni base.

export const PLANES = {
  pymes: { fuente: 'rd-1515-2007', norma: 'RD 1515/2007', idBoe: 'BOE-A-2007-19966', grupos: 7 },
  general: { fuente: 'rd-1514-2007', norma: 'RD 1514/2007', idBoe: 'BOE-A-2007-19884', grupos: 9 },
}

export const normalizarTitulo = (s) => String(s).replace(/­/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim()

/** Bloques del texto: id → [{ desde, norma, lineas }] en el orden en que aparecen. */
export function bloques(texto) {
  const out = new Map()
  let actual = null
  for (const l of texto.split('\n')) {
    const b = l.match(/^## \[(.+)\]$/)
    if (b) { actual = b[1]; if (!out.has(actual)) out.set(actual, []); continue }
    const v = l.match(/^### versión · vigente desde (\S+) · (\S+)/)
    if (v && actual) { out.get(actual).push({ desde: v[1], norma: v[2], lineas: [] }); continue }
    if (actual && out.get(actual).length) out.get(actual).at(-1).lineas.push(l)
  }
  return out
}

/** La versión vigente de un bloque: la de fecha mayor (empate: la última que aparece). */
export function vigente(versiones) {
  return versiones.reduce((a, v) => (a === null || v.desde >= a.desde ? v : a), null)
}

/**
 * Una lista de cuentas en el formato del cuadro: el código solo en su línea
 * («472.», o sin punto en cuatro casos del BOE: «203», «2804», «406», «485») y
 * el título en la línea siguiente. Se para en la primera línea que no es lista
 * (en la quinta parte, el texto de la definición del subgrupo).
 */
export function listaDeCuentas(lineas) {
  const l = lineas.map((x) => x.trim()).filter(Boolean)
  const esCodigo = (x) => /^\d{2,5}\.?$/.test(x)
  const cuentas = []
  for (let i = 0; i < l.length; i++) {
    const m = l[i].match(/^(\d{2,5})\.?$/)
    if (!m || i + 1 >= l.length || esCodigo(l[i + 1])) continue
    // El título puede ocupar dos líneas en el BOE («INVERSIONES FINANCIERAS A
    // LARGO PLAZO» / «EN PARTES VINCULADAS», subgrupo 24 de pymes). Solo se
    // junta una segunda línea si las dos van en mayúsculas (los subgrupos):
    // detrás de un título en minúsculas lo que viene son las notas de la
    // consolidación («Redactado conforme a la corrección de errores…», «Se
    // modifica la cuenta 133 por el art. 1.16.1 del Real Decreto 1/2021…») o,
    // en la quinta parte, el texto de la definición. No son título.
    const partes = [l[i + 1]]
    let j = i + 2
    while (j < l.length && !esCodigo(l[j]) && !/^Grupo \d$/.test(l[j])) {
      const mayus = (x) => x === x.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(x)
      if (!(mayus(partes[0]) && mayus(l[j]))) break
      partes.push(l[j]); j++
    }
    cuentas.push({ code: m[1], linea: partes.join(' '), lineas: partes })
    i = j - 1
  }
  return cuentas
}

/** Nombre del grupo (1 dígito): la línea que sigue a «Grupo N». */
function grupoDe(lineas) {
  const l = lineas.map((x) => x.trim()).filter(Boolean)
  const i = l.findIndex((x) => /^Grupo \d$/.test(x))
  return i >= 0 ? { code: l[i].slice(-1), linea: l[i + 1] ?? '' } : null
}

/**
 * El cuadro de cuentas (cuarta parte) de un plan, versión vigente de cada
 * grupo. Devuelve [{ code, name, group, desde, norma, bloque }], grupos incluidos.
 */
export function cuadro(texto, plan) {
  const bs = bloques(texto)
  const out = []
  for (let g = 1; g <= PLANES[plan].grupos; g++) {
    const vs = bs.get(`grupo${g}`)
    if (!vs) continue
    const v = vigente(vs)
    const gr = grupoDe(v.lineas)
    if (gr) out.push({ code: gr.code, name: normalizarTitulo(gr.linea), group: g, desde: v.desde, norma: v.norma, bloque: `grupo${g}` })
    for (const c of listaDeCuentas(v.lineas)) {
      out.push({ code: c.code, name: normalizarTitulo(c.linea), group: g, desde: v.desde, norma: v.norma, bloque: `grupo${g}` })
    }
  }
  return out
}

/**
 * La quinta parte de un plan, versión vigente: las listas de cada subgrupo
 * («NNN.» + título) y los encabezados de definición («NNN. Título»).
 * Devuelve { listas: Map(code → título), definiciones: Map(code → título), lineas: Map(code → [línea literal]) }.
 */
export function quintaParte(texto, plan) {
  const bs = bloques(texto)
  const listas = new Map()
  const definiciones = new Map()
  const literal = new Map()
  const anota = (code, linea) => { if (!literal.has(code)) literal.set(code, []); literal.get(code).push(linea) }
  for (let g = 1; g <= PLANES[plan].grupos; g++) {
    const vs = bs.get(`grupo${g}-2`)
    if (!vs) continue
    const v = vigente(vs)
    for (const c of listaDeCuentas(v.lineas)) {
      if (!listas.has(c.code)) listas.set(c.code, normalizarTitulo(c.linea))
      anota(c.code, `${c.code}.\n${c.lineas.join('\n')}`)
    }
    for (const l of v.lineas.map((x) => x.trim())) {
      const m = l.match(/^(\d{2,5})\. (\S.*)$/)
      if (m && !definiciones.has(m[1])) { definiciones.set(m[1], normalizarTitulo(m[2])); anota(m[1], l) }
    }
  }
  return { listas, definiciones, literal }
}

/** Padre de un código: el código más largo de la serie que lo prefija. */
export function padreDe(code, codigos) {
  for (let n = code.length - 1; n >= 1; n--) if (codigos.has(code.slice(0, n))) return code.slice(0, n)
  return null
}

/** Hojas: los códigos sin hijos (en ellas se apunta). */
export function hojas(codigos) {
  const lista = [...codigos]
  return lista.filter((c) => !lista.some((o) => o !== c && o.startsWith(c)))
}

/** Rellena con ceros a la derecha (4700 → 47000000). */
export const rellenar = (code, digitos) => code + '0'.repeat(Math.max(0, digitos - code.length))

/** Choques al rellenar: pares de códigos distintos que dan el mismo número. */
export function choques(codigos, digitos) {
  const vistos = new Map()
  const out = []
  for (const c of codigos) {
    const r = rellenar(c, digitos)
    if (vistos.has(r)) out.push([vistos.get(r), c, r])
    else vistos.set(r, c)
  }
  return out
}

// ── La serie: cuadro + correcciones con cita ────────────────────────────────

/** Distancia de edición (Levenshtein), para acotar lo que es una errata. */
export function distancia(a, b) {
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}

const tituloDeCita = (literal) => {
  // «232.\nInstalaciones técnicas en montaje.» (lista) o «239. Anticipos para…» (definición)
  const m = literal.match(/^\d{1,5}\.(?:\n| )([\s\S]+)$/)
  return m ? normalizarTitulo(m[1].replace(/\n/g, ' ')) : null
}

/**
 * Comprueba UNA corrección contra el texto descargado. Devuelve la lista de
 * problemas (vacía si vale). Las reglas son mecánicas, por tipo, para que
 * nadie tenga que opinar: o la cita dice lo que la corrección afirma, o no vale.
 */
export function revisarCorreccion(c, { cuadroPorCodigo, quinta, textoBloque }) {
  const p = []
  const yo = `${c.plan} ${c.code}`
  const literales = c.cita?.literal ?? []
  if (!literales.length) return [`${yo}: corrección sin cita. Nada se corrige sin cita.`]
  if (c.cita.parte !== 'quinta') p.push(`${yo}: la cita no es de la quinta parte.`)
  const bloque = textoBloque(c.cita.bloque)
  if (bloque === null) return [`${yo}: el bloque citado (${c.cita.bloque}) no está en el texto descargado.`]
  for (const l of literales) if (!bloque.includes(l)) p.push(`${yo}: la cita ya no está en la versión vigente de ${c.cita.bloque}: «${l.replace(/\n/g, ' ')}».`)
  const enCuadro = cuadroPorCodigo.get(c.code)
  const titulos = literales.map(tituloDeCita)
  const dice = (t) => titulos.includes(t)
  if (c.tipo === 'falta') {
    if (enCuadro) p.push(`${yo}: ya sale en el cuadro («${enCuadro.name}»): la corrección sobra.`)
    if (titulos.length < 2 || !titulos.every((t) => t === c.tituloCorrecto)) p.push(`${yo}: para añadir una cuenta que el cuadro no trae hacen falta la lista y la definición de la quinta parte, y las dos diciendo «${c.tituloCorrecto}».`)
    return p
  }
  if (!enCuadro) return [...p, `${yo}: no sale en el cuadro.`]
  if (enCuadro.name !== c.tituloCuadro) {
    if (enCuadro.name === c.tituloCorrecto) p.push(`${yo}: el cuadro ya dice «${c.tituloCorrecto}»: el BOE ha corregido la errata y esta corrección sobra.`)
    else p.push(`${yo}: el cuadro ya no dice «${c.tituloCuadro}» sino «${enCuadro.name}»: hay que revisar la corrección.`)
    return p
  }
  switch (c.tipo) {
    case 'titulo_de_otra_cuenta': {
      const otra = cuadroPorCodigo.get(c.otraCuenta)?.name ?? quinta.listas.get(c.otraCuenta) ?? quinta.definiciones.get(c.otraCuenta)
      if (otra !== c.tituloCuadro) p.push(`${yo}: dice que lleva el título de ${c.otraCuenta}, pero ${c.otraCuenta} se titula «${otra}».`)
      if (!dice(c.tituloCorrecto)) p.push(`${yo}: la cita no trae el título «${c.tituloCorrecto}».`)
      break
    }
    case 'lineas_fundidas':
      if (!c.tituloCuadro.startsWith(c.tituloCorrecto + ' ')) p.push(`${yo}: la línea del cuadro no empieza por «${c.tituloCorrecto}».`)
      if (!dice(c.tituloCorrecto)) p.push(`${yo}: la cita no trae el título «${c.tituloCorrecto}».`)
      break
    case 'errata':
      if (!dice(c.tituloCorrecto)) p.push(`${yo}: la cita no trae el título «${c.tituloCorrecto}».`)
      if (distancia(c.tituloCuadro, c.tituloCorrecto) > 3) p.push(`${yo}: entre el cuadro y la corrección hay más de 3 caracteres: no es una errata, es otro título.`)
      break
    case 'dos_testigos':
      if (titulos.length < 2 || !titulos.every((t) => t === c.tituloCorrecto)) p.push(`${yo}: la lista y la definición de la quinta parte no dicen las dos «${c.tituloCorrecto}».`)
      break
    case 'espacio':
      if (c.tituloCuadro.replace(/\s/g, '') !== c.tituloCorrecto.replace(/\s/g, '')) p.push(`${yo}: la corrección cambia algo más que un espacio.`)
      break
    default:
      p.push(`${yo}: tipo de corrección desconocido «${c.tipo}».`)
  }
  return p
}

/** Texto (literal, sin normalizar) de la versión vigente de un bloque, o null. */
export function textoVigente(texto, id) {
  const vs = bloques(texto).get(id)
  return vs ? vigente(vs).lineas.join('\n') : null
}

/**
 * La serie de un plan: el cuadro, con las correcciones aplicadas. Devuelve
 * { cuentas, hallazgos }. Un hallazgo es rojo: la serie no se genera.
 *   · cada corrección se revisa contra su cita (revisarCorreccion);
 *   · toda diferencia entre el cuadro y la quinta parte tiene que estar
 *     corregida o aceptada (si aparece una nueva, se dice);
 *   · una aceptada que ya no difiere, sobra.
 */
export function construirSerie(texto, plan, { correcciones, aceptadas }) {
  const hallazgos = []
  const filas = cuadro(texto, plan)
  const porCodigo = new Map(filas.map((f) => [f.code, f]))
  const q = quintaParte(texto, plan)
  const mias = correcciones.filter((c) => c.plan === plan)
  const acept = aceptadas.filter((a) => a.plan === plan)
  const ctx = { cuadroPorCodigo: porCodigo, quinta: q, textoBloque: (id) => textoVigente(texto, id) }
  for (const c of mias) hallazgos.push(...revisarCorreccion(c, ctx))

  // Diferencias cuadro ↔ quinta parte (la lista o la definición).
  const corregidas = new Set(mias.map((c) => c.code))
  const aceptadasPor = new Map(acept.map((a) => [a.code, a]))
  const difieren = new Set()
  for (const f of filas) {
    if (f.code.length < 2) continue
    // Difiere si el cuadro no coincide con NINGUNO de los testigos de la quinta
    // parte que existan (su lista y su definición). Si coincide con uno, son dos
    // contra uno a favor del cuadro: la errata está en la quinta parte (p. ej.
    // «Pérdidas por Deterioro…», «Arrendamiento y cánones» en las definiciones).
    const l = q.listas.get(f.code), d = q.definiciones.get(f.code)
    if ((l !== undefined || d !== undefined) && l !== f.name && d !== f.name) difieren.add(f.code)
  }
  for (const code of difieren) {
    if (corregidas.has(code) || aceptadasPor.has(code)) continue
    const f = porCodigo.get(code)
    hallazgos.push(`${plan} ${code}: el cuadro dice «${f.name}» y la quinta parte «${q.listas.get(code) ?? q.definiciones.get(code)}». No está ni corregida ni aceptada.`)
  }
  // Cuentas que la quinta parte trae y el cuadro no (la 502 y la 1141 del
  // general): o se añaden con su cita (tipo «falta») o se aceptan con su porqué.
  const soloEnQuinta = new Set([...q.listas.keys(), ...q.definiciones.keys()].filter((k) => !porCodigo.has(k)))
  for (const code of soloEnQuinta) {
    if (corregidas.has(code) || aceptadasPor.has(code)) continue
    hallazgos.push(`${plan} ${code}: la quinta parte la trae («${q.listas.get(code) ?? q.definiciones.get(code)}») y el cuadro no. No está ni corregida ni aceptada.`)
  }
  for (const a of acept) {
    if (a.tituloCuadro === null) {
      if (porCodigo.has(a.code)) hallazgos.push(`${plan} ${a.code}: estaba aceptada como ausente del cuadro, pero ya sale en él: sobra.`)
      else if (!soloEnQuinta.has(a.code)) hallazgos.push(`${plan} ${a.code}: estaba aceptada como ausente del cuadro, pero la quinta parte ya no la trae: sobra.`)
    } else if (!difieren.has(a.code)) hallazgos.push(`${plan} ${a.code}: estaba aceptada como diferencia, pero el cuadro ya coincide con la quinta parte: sobra.`)
    else if (porCodigo.get(a.code)?.name !== a.tituloCuadro) hallazgos.push(`${plan} ${a.code}: el cuadro ya no dice «${a.tituloCuadro}»: hay que revisar la aceptada.`)
  }

  // Aplicar.
  const cuentas = filas.map((f) => ({ ...f, boeName: f.name, correccion: null }))
  for (const c of mias) {
    if (c.tipo === 'falta') {
      if (!porCodigo.has(c.code)) {
        const vecina = filas.find((f) => f.group === Number(c.code[0])) ?? null
        cuentas.push({ code: c.code, name: c.tituloCorrecto, group: Number(c.code[0]), desde: vecina?.desde ?? null, norma: vecina?.norma ?? null,
          bloque: `grupo${c.code[0]}`, boeName: null, correccion: c.tipo })
      }
      continue
    }
    const fila = cuentas.find((x) => x.code === c.code)
    if (fila && fila.name === c.tituloCuadro) { fila.name = c.tituloCorrecto; fila.correccion = c.tipo }
  }
  cuentas.sort((a, b) => a.code.localeCompare(b.code))
  const codigos = new Set(cuentas.map((c) => c.code))
  const hs = new Set(hojas(codigos))
  for (const c of cuentas) { c.parent = padreDe(c.code, codigos); c.hoja = hs.has(c.code) }
  // Coherencia de la jerarquía: toda cuenta de 2 o más dígitos tiene padre.
  for (const c of cuentas) if (c.code.length > 1 && !c.parent) hallazgos.push(`${plan} ${c.code}: no tiene cuenta padre en el cuadro.`)
  return { cuentas, hallazgos }
}
