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

export type Situacion = 'activo' | 'baja' | 'moroso' | 'solo_renta'
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

const SITUACIONES: readonly Situacion[] = ['activo', 'baja', 'moroso', 'solo_renta']

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
    situacion: null, servicios: [], formaPago: null, emisorSegunBitrix: null,
    cuotasReferencia: [], avisos: [],
  }
  for (const c of mapa.campos) {
    if (!c.codigo) continue
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
        const t = opcion(textoDe(crudo))
        if (t && (SITUACIONES as readonly string[]).includes(t)) f.situacion = t as Situacion
        else if (t) f.avisos.push(`Situación «${t}» que el mapa no conoce.`)
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
