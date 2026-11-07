// supabase/functions/conta-bitrix-leer/mapa.ts
//
// G01 · Tarea 2 (06/11/2026). Lo de leer las empresas de Bitrix24 que no
// necesita Deno: el mapa de campos (es DATO, no código), qué se pide, cómo se
// convierte cada empresa en la ficha de un cliente y cómo se pagina con el
// límite de peticiones. Puro: lo prueban las unitarias
// (tests/unit/modules/conta/gestoria/mapaBitrix.test.ts).
//
// Solo LEE: crm.company.list. Nunca escribe en Bitrix24.
//
// API REST de Bitrix24 (documentación oficial, https://apidocs.bitrix24.com):
//   · crm.company.list: «select» (los campos que se quieren), «order», «filter»
//     y «start». Devuelve 50 por página y, si hay más, «next» con el «start» de
//     la siguiente; «total», cuántas hay.
//   · Límite: 2 peticiones por segundo por portal (con un margen de ráfaga);
//     si se pasa, «QUERY_LIMIT_EXCEEDED». Aquí, una petición cada 500 ms.
//   · Los campos propios se llaman UF_CRM_…; los de lista devuelven el id de
//     la opción, no su texto: el mapa dice qué significa cada id.

export const POR_PAGINA = 50
export const ESPERA_MS = 500

/** Lo que Sumied guarda de cada empresa de Bitrix24. */
export type CampoSumied =
  | 'nombre' | 'nif' | 'calle' | 'cp' | 'poblacion' | 'provincia' | 'correo' | 'telefono'
  | 'situacion' | 'servicios' | 'forma_pago' | 'cuota_referencia'

/** G01b · «sin_clasificar»: una opción de Bitrix24 sin significado en Sumied (GRAVE DESAPARECIDO, las «Vzla»…), con su texto. */
export type Situacion = 'activo' | 'baja' | 'moroso' | 'solo_renta' | 'sin_clasificar'
/** Los servicios contratados que enseña la tabla: C (contabilidad), L (laboral), S (otros servicios). */
export type Servicio = 'C' | 'L' | 'S'

export interface CampoDelMapa {
  /** El código del campo en Bitrix24 (TITLE, EMAIL, UF_CRM_…). Null: está en el mapa, pero falta medirlo en el portal. */
  codigo: string | null
  campo: CampoSumied
  /** Para cuota_referencia: cómo se enseña («Cuota mensual», «Laboral»…). */
  etiqueta?: string
  /** En los de lista: qué quiere decir cada id de opción. */
  opciones?: Record<string, string>
  /** G01b · En los de lista: el texto de cada id en Bitrix24 (para «Sin clasificar» y para la pantalla). */
  textos?: Record<string, string>
}

/**
 * G01b · De dónde sale la dirección: un campo de Bitrix24 y, si los tiene, los
 * suyos de código postal, población y provincia. Se usan por orden, el primero
 * con algo, y nunca se mezclan dos (Julio, 07/11). Un campo de tipo dirección
 * trae todo en un texto: el código postal se saca de él; la población y la
 * provincia, no (se quedan en el texto de la calle).
 */
export interface FuenteDireccion {
  etiqueta: string
  calle: string
  cp?: string | null
  poblacion?: string | null
  provincia?: string | null
}

export interface MapaBitrix {
  /** Quién es el mapa (la cuenta de Sumied o su nombre), para el registro. */
  nombre: string
  campos: CampoDelMapa[]
  /**
   * El texto de «Forma de pago» → el emisor (la empresa de Sumied) que dice.
   * Es solo referencia: el emisor de verdad lo dice la cuenta de GoCardless.
   */
  formaPagoAEmisor: Record<string, string>
  /**
   * G01b · Los campos de Sumied que la propuesta no ha podido decidir: ninguno
   * o varios campos de Bitrix24 encajan. Se guardan con el mapa y salen en
   * «Qué es cada campo» para que una persona elija (antes era una nota del
   * informe de la conexión que no guardaba ni veía nadie).
   */
  dudas?: DudaDelMapa[]
  /** G01b · Las fuentes de la dirección, por orden (si no hay, valen los campos calle, cp… de antes). */
  direcciones?: FuenteDireccion[]
  /**
   * G01b · Quién confirmó el mapa en «Qué es cada campo» y cuándo. Sin
   * confirmar, no se guarda la situación de nadie (Julio, 07/11).
   */
  confirmado?: { quien: string | null; cuando: string } | null
}

export interface DudaDelMapa {
  campo: CampoSumied
  /** Para cuota_referencia: cuál («Laboral»…). */
  etiqueta?: string
  porque: 'ninguno' | 'varios'
  /** Los que encajan, con su etiqueta en Bitrix24 (vacío si ninguno). */
  candidatos: { codigo: string; etiqueta: string }[]
}

/**
 * El mapa de QBO, primero. Los campos estándar de Bitrix24 van con su código;
 * los propios del portal de QBO (UF_CRM_…) están por medir con
 * crm.company.fields (solo lectura) y van con codigo null: el lector los
 * salta y lo dice. Los emisores se rellenan con los ids de las empresas de
 * la cuenta al conectarse (formaPagoAEmisor), no aquí.
 */
export const MAPA_QBO: MapaBitrix = {
  nombre: 'Asesoría QBO',
  campos: [
    { codigo: 'TITLE', campo: 'nombre' },
    { codigo: 'EMAIL', campo: 'correo' },
    { codigo: 'PHONE', campo: 'telefono' },
    { codigo: null, campo: 'nif' },
    { codigo: null, campo: 'calle' },
    { codigo: null, campo: 'cp' },
    { codigo: null, campo: 'poblacion' },
    { codigo: null, campo: 'provincia' },
    { codigo: null, campo: 'situacion' },
    { codigo: null, campo: 'servicios' },
    { codigo: null, campo: 'forma_pago' },
    { codigo: null, campo: 'cuota_referencia', etiqueta: 'Cuota mensual' },
    { codigo: null, campo: 'cuota_referencia', etiqueta: 'Laboral' },
    { codigo: null, campo: 'cuota_referencia', etiqueta: 'ContaSimple' },
    { codigo: null, campo: 'cuota_referencia', etiqueta: 'Tarifa recurrente' },
  ],
  formaPagoAEmisor: {},
}

/** Lo que se pide a crm.company.list: el id y solo los campos del mapa que tienen código. */
export function camposQueSePiden(mapa: MapaBitrix): string[] {
  const out = new Set<string>(['ID'])
  for (const c of mapa.campos) if (c.codigo) out.add(c.codigo)
  return [...out]
}

/** Los campos del mapa que faltan por medir en el portal (sin código). */
export function camposSinCodigo(mapa: MapaBitrix): string[] {
  return mapa.campos.filter((c) => !c.codigo).map((c) => c.etiqueta ?? c.campo)
}

export function normalizarNif(v: string | null | undefined): string | null {
  if (!v) return null
  let n = v.toUpperCase().replace(/[\s.\-_/]/g, '')
  if (n.startsWith('ES') && n.length > 9) n = n.slice(2)
  return n === '' ? null : n
}

export interface FichaBitrix {
  bitrixId: string
  nombre: string
  nif: string | null
  calle: string | null
  cp: string | null
  poblacion: string | null
  provincia: string | null
  correos: string[]
  telefonos: string[]
  situacion: Situacion | null
  /** G01b · El texto de la situación en Bitrix24 (el de la opción), para «Sin clasificar». */
  situacionTexto: string | null
  /** G01b · De qué campo sale la dirección y las otras direcciones que tiene, de referencia. */
  direccionDe: string | null
  otrasDirecciones: { etiqueta: string; texto: string }[]
  servicios: Servicio[]
  /** El texto de «Forma de pago», tal cual, y el emisor que dice (si el mapa lo sabe). */
  formaPago: string | null
  emisorSegunBitrix: string | null
  /** Las cuotas de Bitrix24: solo referencia, no se usan para calcular nada. */
  cuotasReferencia: { etiqueta: string; importeCent: number | null; texto: string }[]
  /** Lo que no se ha podido leer, en palabras. */
  avisos: string[]
}

const textoDe = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.length ? textoDe(v[0]) : null
  if (typeof v === 'object') return textoDe((v as { VALUE?: unknown }).VALUE)
  const t = String(v).trim()
  return t === '' ? null : t
}

/** EMAIL y PHONE vienen como [{ VALUE, VALUE_TYPE }]: todos los valores, sin repetir. */
const valoresMultiples = (v: unknown): string[] => {
  const lista = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
  const out: string[] = []
  for (const x of lista) {
    const t = textoDe(x)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

const SITUACIONES: readonly Situacion[] = ['activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar']

/** El texto de un campo de dirección: lo de antes de «|;|» (o de «|»); de varios, el primero con algo. */
export function textoDeDireccion(v: unknown): string | null {
  if (Array.isArray(v)) { for (const x of v) { const t = textoDeDireccion(x); if (t) return t } return null }
  if (v === null || v === undefined || typeof v === 'object') return null
  const t = String(v).split('|')[0].replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

/** Un código postal español (5 cifras) dentro de un texto de dirección. */
const cpDelTexto = (t: string | null) => (t ? /\b(\d{5})\b/.exec(t)?.[1] ?? null : null)

/** «24,20», «24.20», «1.234,50 €», «24|EUR» → céntimos; null si no es un número. */
export function importeACent(v: string | null): number | null {
  if (!v) return null
  let t = v.split('|')[0].replace(/[€\s]/g, '')
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** Una empresa de crm.company.list → la ficha del cliente, solo con los campos del mapa. */
export function leerEmpresa(fila: Record<string, unknown>, mapa: MapaBitrix): FichaBitrix {
  const f: FichaBitrix = {
    bitrixId: String(fila.ID ?? ''),
    nombre: '',
    nif: null, calle: null, cp: null, poblacion: null, provincia: null,
    correos: [], telefonos: [],
    situacion: null, situacionTexto: null, direccionDe: null, otrasDirecciones: [], servicios: [], formaPago: null, emisorSegunBitrix: null,
    cuotasReferencia: [], avisos: [],
  }
  const conFuentes = (mapa.direcciones?.length ?? 0) > 0
  for (const c of mapa.campos) {
    if (!c.codigo) continue
    // G01b · Con fuentes de dirección, la dirección sale de ellas (abajo), no de estos campos sueltos.
    if (conFuentes && (c.campo === 'calle' || c.campo === 'cp' || c.campo === 'poblacion' || c.campo === 'provincia')) continue
    const crudo = fila[c.codigo]
    // Un id de opción que el mapa no conoce se queda tal cual: así el aviso dice cuál era.
    const opcion = (t: string | null) => (t && c.opciones ? c.opciones[t] ?? t : t)
    switch (c.campo) {
      case 'nombre': f.nombre = textoDe(crudo) ?? ''; break
      case 'nif': f.nif = normalizarNif(textoDe(crudo)); break
      case 'calle': f.calle = textoDe(crudo); break
      case 'cp': f.cp = textoDe(crudo); break
      case 'poblacion': f.poblacion = textoDe(crudo); break
      case 'provincia': f.provincia = textoDe(crudo); break
      case 'correo': f.correos = [...new Set(valoresMultiples(crudo).map((x) => x.toLowerCase()))]; break
      case 'telefono': f.telefonos = valoresMultiples(crudo); break
      case 'situacion': {
        // G01b · Sin el mapa confirmado en «Qué es cada campo», no se guarda la situación de nadie.
        if (!mapa.confirmado) break
        const id = textoDe(crudo)
        if (!id) break
        const t = opcion(id)
        f.situacionTexto = c.textos?.[id] ?? id
        if (t && (SITUACIONES as readonly string[]).includes(t)) f.situacion = t as Situacion
        else { f.situacion = 'sin_clasificar'; f.avisos.push(`Situación «${f.situacionTexto}» sin clasificar en Sumied.`) }
        break
      }
      case 'servicios': {
        const ids = Array.isArray(crudo) ? crudo.map((x) => String(x)) : textoDe(crudo) ? [String(textoDe(crudo))] : []
        for (const id of ids) {
          const s = opcion(id)
          if (s === 'C' || s === 'L' || s === 'S') { if (!f.servicios.includes(s)) f.servicios.push(s) }
          else f.avisos.push(`Servicio «${id}» que el mapa no conoce.`)
        }
        f.servicios.sort()
        break
      }
      case 'forma_pago': {
        const t = opcion(textoDe(crudo))
        f.formaPago = t
        f.emisorSegunBitrix = t ? mapa.formaPagoAEmisor[t] ?? null : null
        if (t && !f.emisorSegunBitrix) f.avisos.push(`«Forma de pago» dice «${t}», que el mapa no sabe de qué emisor es.`)
        break
      }
      case 'cuota_referencia': {
        const t = textoDe(crudo)
        if (t) f.cuotasReferencia.push({ etiqueta: c.etiqueta ?? c.codigo, importeCent: importeACent(t), texto: t })
        break
      }
    }
  }
  if (conFuentes) {
    // La primera fuente con algo da la dirección entera; las demás con algo, de referencia.
    for (const d of mapa.direcciones!) {
      const calle = textoDeDireccion(fila[d.calle])
      const cp = d.cp ? textoDe(fila[d.cp]) : cpDelTexto(calle)
      const poblacion = d.poblacion ? textoDe(fila[d.poblacion]) : null
      const provincia = d.provincia ? textoDe(fila[d.provincia]) : null
      if (!calle && !cp && !poblacion && !provincia) continue
      if (!f.direccionDe) { Object.assign(f, { calle, cp, poblacion, provincia, direccionDe: d.etiqueta }); continue }
      f.otrasDirecciones.push({ etiqueta: d.etiqueta, texto: [calle, cp, poblacion, provincia].filter(Boolean).join(', ') })
    }
  }
  if (!f.nombre) { f.nombre = `Empresa ${f.bitrixId} de Bitrix24`; f.avisos.push('Sin nombre en Bitrix24.') }
  return f
}

/** El «start» de la página siguiente, o null si es la última. */
export function siguienteStart(respuesta: unknown): number | null {
  const n = (respuesta as { next?: unknown } | null)?.next
  return typeof n === 'number' && n > 0 ? n : null
}

/**
 * Lee todas las empresas, de 50 en 50, con una espera entre peticiones para
 * no pasar de 2 por segundo. Quien pide la página y quien espera vienen de
 * fuera (en las pruebas, falsos). Para si el «start» no avanza o pasa del tope.
 */
export async function leerTodas(
  pedir: (start: number) => Promise<unknown>,
  esperar: (ms: number) => Promise<void>,
  tope = 400,
): Promise<{ filas: Record<string, unknown>[]; total: number | null; peticiones: number }> {
  const filas: Record<string, unknown>[] = []
  let start = 0
  let total: number | null = null
  for (let i = 0; i < tope; i++) {
    if (i > 0) await esperar(ESPERA_MS)
    const r = (await pedir(start)) as { result?: unknown; total?: unknown; error?: unknown; error_description?: unknown } | null
    if (r?.error) throw new Error(`Bitrix24 ha contestado «${String(r.error)}»${r.error_description ? `: ${String(r.error_description)}` : ''}.`)
    if (!Array.isArray(r?.result)) throw new Error(`Bitrix24 no ha devuelto la lista de empresas en la página ${i + 1}.`)
    filas.push(...(r!.result as Record<string, unknown>[]))
    if (typeof r?.total === 'number') total = r.total
    const sig = siguienteStart(r)
    if (sig === null) return { filas, total, peticiones: i + 1 }
    if (sig <= start) throw new Error('Bitrix24 no avanza de página: se para para no leer en bucle.')
    start = sig
  }
  throw new Error(`Más de ${tope} páginas de empresas: se para sin terminar.`)
}

// ── El mapa, propuesto desde lo que mide crm.company.fields ─────────────────
// Julio (respuesta 1 a la tarea 2): los códigos UF_CRM_… no se inventan: se
// miden en el portal con crm.company.fields (solo lectura) y el mapa sale de
// esa medición. Esto PROPONE: cada campo de Sumied, el campo de Bitrix24 cuya
// etiqueta lo dice; si ninguno, sin código; si más de uno, sin código y
// «dudoso». Y dice qué campo es cada uno, para el informe.

/** Lo que devuelve crm.company.fields de cada campo (lo que se usa). */
export interface CampoMedido {
  type?: string
  isMultiple?: boolean
  title?: string
  formLabel?: string
  listLabel?: string
  items?: { ID: string | number; VALUE: string }[]
}

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const etiquetaDe = (c: CampoMedido) => sinTildes([c.formLabel, c.listLabel, c.title].find((x) => x && x.trim()) ?? '')

/** Qué etiqueta dice cada campo de Sumied (sin tildes, en mayúsculas). */
const QUIEN_ES: { campo: CampoSumied; etiqueta?: string; patron: RegExp; lista?: boolean }[] = [
  { campo: 'nif', patron: /^(NIF|CIF|DNI|NIE|NIF ?\/ ?CIF|CIF ?\/ ?NIF)\b/ },
  { campo: 'calle', patron: /\b(DIRECCION|DOMICILIO)( FISCAL)?$/ },
  { campo: 'cp', patron: /^(CP|C\.P\.|CODIGO POSTAL)\b/ },
  { campo: 'poblacion', patron: /^(POBLACION|MUNICIPIO|LOCALIDAD|CIUDAD)\b/ },
  { campo: 'provincia', patron: /^PROVINCIA\b/ },
  { campo: 'situacion', patron: /^(SITUACION|ESTADO)( DEL CLIENTE)?$/, lista: true },
  { campo: 'servicios', patron: /^SERVICIOS( CONTRATADOS)?$/, lista: true },
  { campo: 'forma_pago', patron: /^FORMA DE PAGO$/ },
  { campo: 'cuota_referencia', etiqueta: 'Cuota mensual', patron: /^CUOTA MENSUAL$/ },
  // G01b · En el portal de QBO se llaman «Cuota Mensual Laboral» y «… ContaSimple»; las que acaban en «z» no son (Julio, 07/11).
  { campo: 'cuota_referencia', etiqueta: 'Laboral', patron: /^(CUOTA (MENSUAL )?)?LABORAL$/ },
  { campo: 'cuota_referencia', etiqueta: 'ContaSimple', patron: /^(CUOTA (MENSUAL )?)?CONTA ?SIMPLE$/ },
  { campo: 'cuota_referencia', etiqueta: 'Tarifa recurrente', patron: /^TARIFA RECURRENTE$/ },
]

/**
 * G01b · Lo que quiere decir en Sumied una opción de «Situación del Cliente»:
 * ACTIVO, BAJA…, MOROSO y … SOLO RENTA; lo demás (GRAVE DESAPARECIDO, las
 * «Vzla»…), sin clasificar (Julio, 07/11). Es solo la propuesta: la persona
 * lo cambia en «Qué es cada campo» antes de confirmar.
 */
export function situacionDeTexto(texto: string): Situacion {
  const v = sinTildes(texto)
  return /^ACTIV/.test(v) ? 'activo' : /^BAJA/.test(v) ? 'baja' : /^MOROS/.test(v) ? 'moroso' : /RENTA/.test(v) ? 'solo_renta' : 'sin_clasificar'
}

/** Las opciones de una lista → lo que quieren decir en Sumied. */
function opcionesDe(campo: CampoSumied, c: CampoMedido, emisores: { id: string; nombre: string }[]): { opciones: Record<string, string>; textos: Record<string, string>; sinCasar: string[] } {
  const opciones: Record<string, string> = {}
  const textos: Record<string, string> = {}
  const sinCasar: string[] = []
  for (const it of c.items ?? []) {
    const v = sinTildes(it.VALUE)
    let s: string | null = null
    textos[String(it.ID)] = it.VALUE
    if (campo === 'situacion') {
      // G01b · Lo que no encaja (GRAVE DESAPARECIDO, las «Vzla»…) queda «sin clasificar», con su texto (Julio, 07/11).
      s = situacionDeTexto(it.VALUE)
      if (s === 'sin_clasificar') sinCasar.push(it.VALUE)
    } else if (campo === 'servicios') {
      s = /^C$|^CONTA/.test(v) ? 'C' : /^L$|^LABORAL/.test(v) ? 'L' : /^S$/.test(v) ? 'S' : null
    } else if (campo === 'forma_pago') {
      s = it.VALUE.trim()
    }
    if (s) opciones[String(it.ID)] = s
    else sinCasar.push(it.VALUE)
  }
  void emisores
  return { opciones, textos, sinCasar }
}

/**
 * «Forma de pago» de Bitrix24 → la empresa emisora: la empresa cuyo nombre
 * tiene todas las palabras del texto (sin S.L., sin «Nuevo»). «QBO Integrity
 * Nuevo» es QBO INTEGRITY S.L. (Julio, encargo G01). Si casa con ninguna o
 * con más de una, sin emisor: sale como aviso.
 */
export function emisorDeFormaDePago(texto: string, emisores: { id: string; nombre: string }[]): string | null {
  const ruido = new Set(['SL', 'SLU', 'SA', 'NUEVO', 'NUEVA', 'DE', 'LA', 'EL', 'Y'])
  const palabras = (t: string) => sinTildes(t).replace(/[.,]/g, '').split(/[\s-]+/).filter((p) => p && !ruido.has(p))
  const buscadas = palabras(texto)
  if (!buscadas.length) return null
  const casan = emisores.filter((e) => { const tiene = new Set(palabras(e.nombre)); return buscadas.every((p) => tiene.has(p)) })
  return casan.length === 1 ? casan[0].id : null
}

export interface PropuestaDeMapa {
  mapa: MapaBitrix
  /** Qué campo de Bitrix24 es cada uno, para el informe. */
  queEsCadaUno: { campo: string; codigo: string | null; etiquetaEnBitrix: string | null; nota: string | null }[]
  /** Los campos propios (UF_CRM_…) de Bitrix24 que no son ninguno de Sumied. */
  sinUsar: { codigo: string; etiqueta: string }[]
}

export function proponerMapa(nombre: string, medidos: Record<string, CampoMedido>, emisores: { id: string; nombre: string }[]): PropuestaDeMapa {
  const campos: CampoDelMapa[] = [
    { codigo: 'TITLE', campo: 'nombre' },
    { codigo: 'EMAIL', campo: 'correo' },
    { codigo: 'PHONE', campo: 'telefono' },
  ]
  const queEsCadaUno: PropuestaDeMapa['queEsCadaUno'] = [
    { campo: 'nombre', codigo: 'TITLE', etiquetaEnBitrix: 'Nombre de la empresa', nota: null },
    { campo: 'correo', codigo: 'EMAIL', etiquetaEnBitrix: 'Correo', nota: null },
    { campo: 'telefono', codigo: 'PHONE', etiquetaEnBitrix: 'Teléfono', nota: null },
  ]
  const usados = new Set<string>()
  const dudas: DudaDelMapa[] = []
  const formaPagoAEmisor: Record<string, string> = {}
  const propios = Object.entries(medidos).filter(([k]) => k.startsWith('UF_CRM_'))
  for (const q of QUIEN_ES) {
    const nombreCampo = q.etiqueta ?? q.campo
    const candidatos = propios.filter(([, c]) => q.patron.test(etiquetaDe(c)))
    if (candidatos.length !== 1) {
      // Lo estándar de Bitrix24 para la dirección, si no hay uno propio.
      const estandar: Partial<Record<CampoSumied, string>> = { calle: 'ADDRESS', cp: 'ADDRESS_POSTAL_CODE', poblacion: 'ADDRESS_CITY', provincia: 'ADDRESS_PROVINCE' }
      const std = candidatos.length === 0 ? estandar[q.campo] : undefined
      if (std && medidos[std]) {
        campos.push({ codigo: std, campo: q.campo })
        queEsCadaUno.push({ campo: nombreCampo, codigo: std, etiquetaEnBitrix: medidos[std].title ?? std, nota: 'campo estándar de Bitrix24' })
        continue
      }
      campos.push({ codigo: null, campo: q.campo, ...(q.etiqueta ? { etiqueta: q.etiqueta } : {}) })
      dudas.push({ campo: q.campo, ...(q.etiqueta ? { etiqueta: q.etiqueta } : {}), porque: candidatos.length ? 'varios' : 'ninguno',
        candidatos: candidatos.map(([k, c]) => ({ codigo: k, etiqueta: [c.formLabel, c.listLabel, c.title].find((x) => x && x.trim()) ?? k })) })
      queEsCadaUno.push({ campo: nombreCampo, codigo: null, etiquetaEnBitrix: null,
        nota: candidatos.length === 0 ? 'ningún campo de Bitrix24 se llama así' : `dudoso: ${candidatos.map(([k, c]) => `${k} («${etiquetaDe(c)}»)`).join(', ')}` })
      continue
    }
    const [codigo, c] = candidatos[0]
    usados.add(codigo)
    const entrada: CampoDelMapa = { codigo, campo: q.campo, ...(q.etiqueta ? { etiqueta: q.etiqueta } : {}) }
    let nota: string | null = null
    if (c.items?.length) {
      const { opciones, textos, sinCasar } = opcionesDe(q.campo, c, emisores)
      entrada.opciones = opciones
      entrada.textos = textos
      if (sinCasar.length) nota = `opciones sin significado en Sumied: ${sinCasar.join(', ')}`
      if (q.campo === 'forma_pago') {
        const sinEmisor: string[] = []
        for (const texto of Object.values(opciones)) {
          const e = emisorDeFormaDePago(texto, emisores)
          if (e) formaPagoAEmisor[texto] = e
          else sinEmisor.push(texto)
        }
        if (sinEmisor.length) nota = `sin emisor: ${sinEmisor.join(', ')}`
      }
    }
    campos.push(entrada)
    queEsCadaUno.push({ campo: nombreCampo, codigo, etiquetaEnBitrix: [c.formLabel, c.listLabel, c.title].find((x) => x && x.trim()) ?? codigo, nota })
  }
  const sinUsar = propios.filter(([k]) => !usados.has(k)).map(([codigo, c]) => ({ codigo, etiqueta: etiquetaDe(c) || codigo }))
  return { mapa: { nombre, campos, formaPagoAEmisor, dudas }, queEsCadaUno, sinUsar }
}
