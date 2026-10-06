// src/modules/conta/lib/importarPlan.ts
//
// C02c · Traer el plan de cuentas de otro programa: LECTURA (reglas puras, con
// pruebas en tests/unit/modules/conta/importarPlanC02c.test.ts).
//
// Lo que entra aquí ya es texto: el lector del PDF de Diez (lectorDiez.ts) y
// el de CSV/Excel (más abajo) sacan filas; esto las junta, las clasifica contra
// el cuadro de la empresa y dice si se puede seguir. Nunca inventa un código
// ni un NIF (encargo §4.1): lo que no se lee, no está.
//
//   · El código manda (§4.2): toda cuenta entra con su código exacto. La
//     longitud del fichero es la de sus subcuentas; si no es la de la empresa,
//     se para y se dice (no se renumera nada).
//   · Serie frente a propia (§4.3): una cuenta cuyo código es exactamente su
//     hoja rellenada (47200000, 76201000) es la de serie; el resto, propia.
//   · Una cuenta que no cuelga de ninguna hoja del plan de la empresa no puede
//     entrar: se para con la lista.

import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import { normalizarIban, validarIban } from '@/modules/conta/lib/iban'

export type Programa = 'diez' | 'sage50' | 'contasol' | 'holded' | 'otro'

export interface ProgramaDeOrigen {
  id: Programa
  nombre: string
  /** Qué ficheros se le piden, en palabras normales. */
  ficheros: string
  /** Lo que ya sabe leer Folvy (Sage 50 y Contasol, previstos: por ahora como Excel). */
  lee: 'pdf_diez' | 'tabla'
}

export const PROGRAMAS: readonly ProgramaDeOrigen[] = [
  { id: 'diez', nombre: 'Cegid Diez', ficheros: 'Los tres PDF de Diez: «Plan de Cuentas», «Listado de proveedores / acreedores» y «Listado de clientes / deudores». El del plan basta; los otros dos añaden el NIF.', lee: 'pdf_diez' },
  { id: 'sage50', nombre: 'Sage 50', ficheros: 'El plan de cuentas exportado a Excel o CSV, con el código, el nombre y, si lo tiene, el NIF.', lee: 'tabla' },
  { id: 'contasol', nombre: 'Contasol', ficheros: 'El plan de cuentas exportado a Excel o CSV, con el código, el nombre y, si lo tiene, el NIF.', lee: 'tabla' },
  { id: 'holded', nombre: 'Holded', ficheros: 'El plan de cuentas exportado desde Holded (Excel), con el código y el nombre.', lee: 'tabla' },
  { id: 'otro', nombre: 'Otro programa o Excel', ficheros: 'Un Excel o CSV con una fila por cuenta: código, nombre y, si lo tienes, NIF.', lee: 'tabla' },
]

export const programa = (id: Programa): ProgramaDeOrigen => PROGRAMAS.find((p) => p.id === id)!
/** Cómo se le llama en una frase corta («su número de Diez»). */
export const nombreCorto = (id: Programa): string => (id === 'diez' ? 'Diez' : programa(id).nombre)

/** Una cuenta tal como viene del fichero. */
export interface CuentaLeida {
  code: string
  /** El nombre tal cual venía (va a name_source). */
  nombreOrigen: string
  /** El mismo, limpio de espacios repetidos: lo que se enseña mientras no haya ficha. */
  nombre: string
}

/** Un tercero de los listados de proveedores / acreedores o clientes / deudores. */
export interface TerceroLeido {
  code: string
  nombreOrigen: string
  nombre: string
  /** Normalizado (sin espacios ni puntos, en mayúsculas); null si el listado no lo trae. */
  nif: string | null
  /** El NIF tal cual venía, para el porqué si no pasa la validación. */
  nifOrigen: string | null
  direccion: string | null
  cp: string | null
  poblacion: string | null
  provincia: string | null
}

export interface Lectura {
  programa: Programa
  cuentas: CuentaLeida[]
  terceros: TerceroLeido[]
  /** Lo que el lector ha visto raro pero no impide seguir (líneas que no entiende, etc.). */
  avisos: string[]
}

/** «  GLOVO   SPAIN  » → «GLOVO SPAIN». No corrige palabras: eso lo hace el lector con la posición de cada letra. */
export const limpiar = (s: string): string => s.replace(/\s+/g, ' ').trim()

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Formas jurídicas que se quitan para comparar nombres («Norte Socios, S.L.» = «NORTE SOCIOS»). */
const FORMAS = /\b(s\s*\.?\s*l\s*\.?\s*u|s\s*\.?\s*l\s*\.?\s*l|s\s*\.?\s*l|s\s*\.?\s*a\s*\.?\s*u|s\s*\.?\s*a|s\s*\.?\s*c\s*\.?\s*p|s\s*\.?\s*coop|c\s*\.?\s*b|sociedad limitada|sociedad anonima)\s*\.?\s*$/

/**
 * La clave con la que se comparan dos nombres: sin acentos, sin forma jurídica
 * y SIN ESPACIOS. Sin espacios porque el PDF de Diez parte palabras («GL OVO»,
 * «NOR TE»): «GL OVO» y «Glovo» dan la misma clave.
 */
export function claveNombre(s: string): string {
  let t = sinAcentos(limpiar(s)).toLowerCase().replace(/[,;]/g, ' ')
  for (let i = 0; i < 2; i++) t = t.replace(FORMAS, '').trim()
  return t.replace(/[^a-z0-9ñ]/g, '')
}

export type Parecido = 'igual' | 'parecido' | null

/**
 * ¿Es el mismo nombre? «igual» si la clave coincide; «parecido» si una
 * contiene a la otra y la corta tiene al menos 5 letras («glovoappspainplatform»
 * contiene «glovo»). Con menos, demasiadas casualidades: null.
 */
export function parecido(a: string, b: string): Parecido {
  const x = claveNombre(a), y = claveNombre(b)
  if (!x || !y) return null
  if (x === y) return 'igual'
  const [corta, larga] = x.length <= y.length ? [x, y] : [y, x]
  return corta.length >= 5 && larga.includes(corta) ? 'parecido' : null
}

/** NIF del listado: normalizado si es válido; null si no hay. Si no valida, se queda null y se avisa. */
export function nifDeListado(entrada: string | null | undefined): { nif: string | null; aviso: string | null } {
  const s = limpiar(entrada ?? '')
  if (!s) return { nif: null, aviso: null }
  const n = normalizarNif(s)
  const v = validarNifEs(n)
  // Un NIF extranjero (VAT de otro país) no pasa la validación española pero es un NIF: se guarda tal cual.
  if (v.ok || /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(n)) return { nif: n, aviso: null }
  return { nif: null, aviso: `«${s}» no es un NIF válido: no se usa para enlazar.` }
}

/** El IBAN que Diez escribe dentro del nombre de un banco («BANCO PRUEBA ES91 9999 … 2345»). Solo si valida entero. */
export function ibanEnNombre(nombre: string): string | null {
  const m = nombre.toUpperCase().match(/[A-Z]{2}\d{2}(?:[ \-.]?[A-Z0-9]){11,30}/)
  if (!m) return null
  const v = validarIban(normalizarIban(m[0]))
  return v.ok ? v.normalizado : null
}

// ── Clasificar contra el cuadro de la empresa ───────────────────────────────

/** La hoja del cuadro de la que cuelga un código: el prefijo más largo que es hoja. */
export function hojaDe(code: string, hojas: ReadonlySet<string>): string | null {
  for (let n = Math.min(5, code.length - 1); n >= 1; n--) {
    const p = code.slice(0, n)
    if (hojas.has(p)) return p
  }
  return null
}

/**
 * Respuesta 2 del C02c (camino B) · La «genérica» de Diez: Diez crea una
 * subcuenta para cada cuenta del cuadro aunque el plan de pymes la desglose
 * (16000000 para la 160, cuyas hojas son 1603, 1604 y 1605). Entra con su
 * número, colgada de su cuenta con hijas.
 *
 *   · Su madre es la cuenta del cuadro más larga que es prefijo del código y
 *     tiene hijas (160; 44 para la 44500000, porque la 445 no está; 7954).
 *   · El código es el RELLENO de la madre (16000000 = 160 + ceros) o de una
 *     cuenta de 3 dígitos que no está en el cuadro y empieza por ella
 *     (44500000 = 445 + ceros). Nada más: 16012300 no es el relleno de nadie,
 *     es una subcuenta propia colgada de una cuenta con hijas, y eso no lo
 *     cubre la regla: para y se pregunta (va a `fuera`).
 *   · Choque: si alguna hoja hija de la madre, rellenada, da el mismo código,
 *     no se sabe cuál es cuál: para y se pregunta. Leyendo un fichero no puede
 *     pasar (un código que empieza por una hoja es de esa hoja, hojaDe lo
 *     coge antes), pero la base lo vuelve a mirar y lo prueba staging.
 *
 * null = no es genérica (es de una hoja, o no cuelga de nada del cuadro).
 */
export function genericaDe(code: string, hojas: ReadonlySet<string>, ramas: ReadonlySet<string>): { madre: string; relleno: string; choque: string | null } | null {
  if (hojaDe(code, hojas)) return null
  let madre: string | null = null
  for (let n = Math.min(5, code.length - 1); n >= 1 && !madre; n--) if (ramas.has(code.slice(0, n))) madre = code.slice(0, n)
  if (!madre) return null
  const sinCeros = code.replace(/0+$/, '')
  const relleno = sinCeros.length <= madre.length ? madre : sinCeros
  if (relleno !== madre && (relleno.length > 3 || ramas.has(relleno) || hojas.has(relleno))) return null
  const choque = [...hojas].find((h) => h.startsWith(madre!) && h.padEnd(code.length, '0') === code) ?? null
  return { madre, relleno, choque }
}

export type Clase = 'serie' | 'propia' | 'generica'

export interface CuentaClasificada extends CuentaLeida {
  /** La hoja de la que cuelga; en una genérica, su cuenta madre CON hijas (160, 44, 7954). */
  hoja: string
  clase: Clase
  /** Solo en las genéricas: la cuenta de la que es relleno (160; 445, aunque no esté en el cuadro). */
  relleno?: string
}

export interface ResumenLectura {
  ok: boolean
  /** Si no se puede seguir, por qué, en una frase. */
  motivo: string | null
  digitos: number | null
  total: number
  tuyas: number
  /** Las genéricas de Diez que entran con su número (respuesta 2). */
  genericas: number
  cuentas: CuentaClasificada[]
  /** Las que no cuelgan de ninguna hoja del plan de la empresa ni son una genérica. */
  fuera: CuentaLeida[]
  /** Genéricas cuyo código da también una hoja hija rellenada: no se sabe cuál es cuál. */
  choques: { code: string; madre: string; hoja: string }[]
  /** «743 cuentas, 96 tuyas y 42 genéricas · plan de pymes · 8 dígitos, igual que aquí». */
  frase: string
}

const nombrePlan = (p: 'pymes' | 'general') => (p === 'pymes' ? 'plan de pymes' : 'plan general')

/**
 * Resume lo leído frente a la empresa: longitud, serie/propias y lo que no
 * encaja. Las cuentas de grupo, subgrupo y cuenta (las cabeceras del listado,
 * con menos dígitos) no son subcuentas: no cuentan; la longitud es la de las
 * subcuentas (la más repetida entre las de 6 a 12 dígitos).
 */
export function resumir(
  lectura: Pick<Lectura, 'cuentas'>, empresa: { plan: 'pymes' | 'general'; digitos: number }, hojas: ReadonlySet<string>,
  /** Las cuentas del cuadro CON hijas (para las genéricas de Diez). Sin ellas, ninguna lo es. */
  ramas: ReadonlySet<string> = new Set(),
): ResumenLectura {
  const sub = lectura.cuentas.filter((c) => /^\d{6,12}$/.test(c.code))
  const vacio = (motivo: string): ResumenLectura => ({ ok: false, motivo, digitos: null, total: 0, tuyas: 0, genericas: 0, cuentas: [], fuera: [], choques: [], frase: motivo })
  if (sub.length === 0) return vacio('En el fichero no hay ninguna subcuenta (códigos de 6 a 12 dígitos).')
  const porLong = new Map<number, number>()
  for (const c of sub) porLong.set(c.code.length, (porLong.get(c.code.length) ?? 0) + 1)
  const digitos = [...porLong].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  const distintas = sub.filter((c) => c.code.length !== digitos)
  if (distintas.length) {
    return { ...vacio(`El fichero mezcla longitudes: ${porLong.get(digitos)} cuentas de ${digitos} dígitos y ${distintas.length} de otra (${distintas.slice(0, 3).map((c) => c.code).join(', ')}${distintas.length > 3 ? '…' : ''}). No se renumera nada: revisa el fichero.`), digitos }
  }
  if (digitos !== empresa.digitos) {
    return { ...vacio(`Tus cuentas de ese programa tienen ${digitos} dígitos y tu empresa en Folvy usa ${empresa.digitos}. Para traerlas con su número tienen que coincidir: cambia la longitud en Tus impuestos y detalle contable (aún se puede, no hay asientos) y vuelve.`), digitos }
  }
  const vistos = new Set<string>()
  const cuentas: CuentaClasificada[] = []
  const fuera: CuentaLeida[] = []
  const choques: ResumenLectura['choques'] = []
  for (const c of sub) {
    if (vistos.has(c.code)) continue
    vistos.add(c.code)
    const hoja = hojaDe(c.code, hojas)
    if (hoja) { cuentas.push({ ...c, hoja, clase: c.code === hoja.padEnd(digitos, '0') ? 'serie' : 'propia' }); continue }
    const g = genericaDe(c.code, hojas, ramas)
    if (!g) { fuera.push(c); continue }
    if (g.choque) { choques.push({ code: c.code, madre: g.madre, hoja: g.choque }); continue }
    cuentas.push({ ...c, hoja: g.madre, clase: 'generica', relleno: g.relleno })
  }
  cuentas.sort((a, b) => a.code.localeCompare(b.code))
  const tuyas = cuentas.filter((c) => c.clase === 'propia').length
  const genericas = cuentas.filter((c) => c.clase === 'generica').length
  const lista = (xs: readonly { code: string }[]) => `${xs.slice(0, 3).map((c) => c.code).join(', ')}${xs.length > 3 ? '…' : ''}`
  if (fuera.length || choques.length) {
    const motivos: string[] = []
    // Si NADA cuelga del cuadro, lo más probable es el otro plan; si son unas pocas, se dice cuáles y por qué.
    if (fuera.length) {
      motivos.push(cuentas.length === 0
        ? `Ninguna cuenta cuelga del ${nombrePlan(empresa.plan)} (${lista(fuera)}). ¿El programa usa el otro plan? Revisa el plan en Tus impuestos y detalle contable.`
        : `${fuera.length === 1 ? 'Una cuenta no encaja' : `${fuera.length} cuentas no encajan`} en el ${nombrePlan(empresa.plan)} (${lista(fuera)}): no son subcuenta de una cuenta sin hijas ni la genérica de una cuenta con hijas. No sé dónde ponerlas sin cambiarles el número: revisa el fichero o pregúntanos.`)
    }
    for (const x of choques) motivos.push(`${x.code} sería la genérica de la ${x.madre}, pero la ${x.hoja} rellenada da el mismo número: no sé cuál es cuál.`)
    return { ok: false, digitos, total: cuentas.length + fuera.length + choques.length, tuyas, genericas, cuentas, fuera, choques, motivo: motivos.join(' '), frase: '' }
  }
  const frase = `${cuentas.length} cuentas, ${tuyas} tuyas${genericas ? ` y ${genericas} ${genericas === 1 ? 'genérica' : 'genéricas'}` : ''} · ${nombrePlan(empresa.plan)} · ${digitos} dígitos, igual que aquí`
  return { ok: true, motivo: null, digitos, total: cuentas.length, tuyas, genericas, cuentas, fuera, choques, frase }
}

// ── CSV / Excel genérico (código; nombre; nif) ───────────────────────────────

export interface Columnas { codigo: number; nombre: number; nif: number | null }

/** Parte un CSV respetando comillas. El separador se adivina con la primera línea (; , o tabulador). */
export function partirCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, '')
  const primera = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = [';', '\t', ','].map((s) => [s, primera.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const filas: string[][] = []
  let fila: string[] = [], campo = '', comillas = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (ch === '"') comillas = false
      else campo += ch
    } else if (ch === '"') comillas = true
    else if (ch === sep) { fila.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      fila.push(campo); filas.push(fila); fila = []; campo = ''
    } else campo += ch
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas.filter((f) => f.some((c) => c.trim() !== ''))
}

const CABECERAS: Record<keyof Columnas, RegExp> = {
  codigo: /^(c[oó]digo|cod\.?|cuenta|subcuenta|n[uú]mero|account|code)$/i,
  nombre: /^(nombre|descripci[oó]n|t[ií]tulo|denominaci[oó]n|name|description)$/i,
  nif: /^(nif|cif|dni|n\.?i\.?f\.?|vat|tax ?id|nif\/cif)$/i,
}

/**
 * Asignación de columnas: por la cabecera si la reconoce; si no, por el
 * contenido (la columna con códigos de 6–12 dígitos, la de texto más larga).
 * Devuelve también si la primera fila es cabecera.
 */
export function adivinarColumnas(filas: readonly string[][]): { columnas: Columnas | null; cabecera: boolean } {
  if (!filas.length) return { columnas: null, cabecera: false }
  const cab = filas[0].map((c) => limpiar(c))
  const idx = (k: keyof Columnas) => cab.findIndex((c) => CABECERAS[k].test(c))
  if (idx('codigo') >= 0 && idx('nombre') >= 0) {
    return { columnas: { codigo: idx('codigo'), nombre: idx('nombre'), nif: idx('nif') >= 0 ? idx('nif') : null }, cabecera: true }
  }
  const muestra = filas.slice(0, 50)
  const ancho = Math.max(...muestra.map((f) => f.length))
  let codigo = -1, nombre = -1
  for (let i = 0; i < ancho; i++) {
    const vals = muestra.map((f) => limpiar(f[i] ?? '')).filter(Boolean)
    if (codigo < 0 && vals.length && vals.filter((v) => /^\d{6,12}$/.test(v)).length >= vals.length * 0.8) codigo = i
  }
  if (codigo < 0) return { columnas: null, cabecera: false }
  let largo = -1
  for (let i = 0; i < ancho; i++) {
    if (i === codigo) continue
    const media = muestra.reduce((s, f) => s + limpiar(f[i] ?? '').length, 0) / muestra.length
    if (media > largo && muestra.some((f) => /[a-zñ]/i.test(f[i] ?? ''))) { largo = media; nombre = i }
  }
  return nombre < 0 ? { columnas: null, cabecera: false } : { columnas: { codigo, nombre, nif: null }, cabecera: !/^\d/.test(limpiar(filas[0][codigo] ?? '')) }
}

/**
 * Las filas de una tabla (CSV o Excel ya pasado a texto) con su asignación de
 * columnas → cuentas y terceros. Una fila sin código de 6–12 dígitos no es una
 * cuenta (cabecera, total, línea en blanco): se salta y, si tenía texto, se avisa.
 */
export function leerTabla(programa: Programa, filas: readonly string[][], col: Columnas, cabecera: boolean): Lectura {
  const cuentas: CuentaLeida[] = []
  const terceros: TerceroLeido[] = []
  const avisos: string[] = []
  filas.slice(cabecera ? 1 : 0).forEach((f, i) => {
    const code = limpiar(f[col.codigo] ?? '').replace(/[.\s]/g, '')
    const nombreOrigen = (f[col.nombre] ?? '').trim()
    if (!/^\d{6,12}$/.test(code)) {
      if (f.some((c) => c.trim())) avisos.push(`Fila ${i + (cabecera ? 2 : 1)}: «${limpiar(f.join(' '))}» no lleva un código de cuenta; no se usa.`)
      return
    }
    cuentas.push({ code, nombreOrigen, nombre: limpiar(nombreOrigen) })
    if (col.nif !== null) {
      const { nif, aviso } = nifDeListado(f[col.nif])
      if (aviso) avisos.push(`${code}: ${aviso}`)
      if (nif) terceros.push({ code, nombreOrigen, nombre: limpiar(nombreOrigen), nif, nifOrigen: limpiar(f[col.nif] ?? ''), direccion: null, cp: null, poblacion: null, provincia: null })
    }
  })
  return { programa, cuentas, terceros, avisos }
}

/**
 * Junta varias lecturas (los tres PDF de Diez): las cuentas del plan, y los
 * terceros de los listados. Si un listado trae una cuenta que no está en el
 * plan, entra igual (con el nombre del listado) y se avisa.
 */
export function juntar(programa: Programa, partes: readonly Lectura[]): Lectura {
  const cuentas = new Map<string, CuentaLeida>()
  const terceros = new Map<string, TerceroLeido>()
  const avisos: string[] = []
  for (const p of partes) {
    avisos.push(...p.avisos)
    for (const c of p.cuentas) if (!cuentas.has(c.code)) cuentas.set(c.code, c)
  }
  for (const p of partes) {
    for (const t of p.terceros) {
      if (!cuentas.has(t.code)) {
        cuentas.set(t.code, { code: t.code, nombreOrigen: t.nombreOrigen, nombre: t.nombre })
        avisos.push(`${t.code} (${t.nombre}) está en el listado de terceros pero no en el plan: entra con el nombre del listado.`)
      }
      const ya = terceros.get(t.code)
      terceros.set(t.code, ya ? { ...ya, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null)) } as TerceroLeido : t)
    }
  }
  return { programa, cuentas: [...cuentas.values()], terceros: [...terceros.values()], avisos }
}
