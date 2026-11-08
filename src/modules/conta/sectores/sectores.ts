// src/modules/conta/sectores/sectores.ts
//
// G03 · «¿De qué sector es tu negocio?». Cada sector es un paquete que dice
// qué se enciende sobre la misma base, en un solo sitio: ninguna pantalla
// pregunta por un sector con un `if` propio, pregunta aquí.
//
//   · qué enciende (las condiciones `hosteleria` y `gestoria` del menú y de las
//     tarjetas de dentro de las pantallas);
//   · las tarjetas que no son páginas del menú (para el aviso al cambiar);
//   · el catálogo de servicios que viene puesto (el de gestoría; el usuario lo
//     cambia en Tarifa y paquetes);
//   · qué se propone en el alta según la actividad;
//   · sus palabras (nunca «paquete», «flag» ni «feature» delante del cliente).
//
// Va por EMPRESA (company.sector), no por cuenta: un grupo puede tener una
// sociedad de hostelería y otra de gestoría. No es «Clientes del despacho»
// (accounts.tax_advisor_since): ése es otro interruptor y no se toca aquí.
//
// Puro: se prueba sin base ni React.

export type Sector = 'general' | 'hosteleria' | 'gestoria'
export const SECTORES: readonly Sector[] = ['general', 'hosteleria', 'gestoria']

/** Lo que un sector añade a la base. Son las condiciones `solo` del menú. */
export type Enciende = 'hosteleria' | 'gestoria'

/** Un servicio del catálogo de serie. `forma` como en G01: fijo al mes, por empleado o un trabajo suelto. */
export interface ServicioDeSerie {
  clave: string
  nombre: string
  forma: 'fijo_mes' | 'por_empleado' | 'suelto'
}

export interface Paquete {
  id: Sector
  /** Cómo se llama en la pregunta. */
  etiqueta: string
  /** La línea de lo que enciende, debajo de la opción (Diseño del G03). */
  linea: string
  /** En la frase del alta: «Por lo que me cuentas, eres …». */
  enLaFrase: string
  enciende: readonly Enciende[]
  /** Lo que sale dentro de las pantallas y no tiene página propia en el menú (si la tiene, ya la nombra el menú). */
  tarjetas: readonly string[]
  catalogo: readonly ServicioDeSerie[]
}

export const PAQUETES: Record<Sector, Paquete> = {
  general: {
    id: 'general', etiqueta: 'General', linea: 'Lo de siempre: compras, ventas, bancos, impuestos',
    enLaFrase: 'un negocio sin sector propio', enciende: [], tarjetas: [], catalogo: [],
  },
  hosteleria: {
    id: 'hosteleria', etiqueta: 'Hostelería', linea: 'Además: liquidaciones de Glovo, Uber y Just Eat, socios de marca y Catcher',
    enLaFrase: 'un negocio de hostelería', enciende: ['hosteleria'],
    // Solo lo que no tiene página propia en el menú (Julio, 08/11): los socios de marca y el cierre del
    // día ya salen por su página (Contactos › Socios de marca, Ventas › Cierres del día).
    tarjetas: ['Catcher', 'Liquidaciones del mes en Compras'],
    catalogo: [],
  },
  gestoria: {
    id: 'gestoria', etiqueta: 'Gestoría o asesoría', linea: 'Además: clientes y cuotas, tarifas y altas y bajas de trabajadores de tus clientes',
    enLaFrase: 'una gestoría', enciende: ['gestoria'],
    tarjetas: ['Tarifa y paquetes', 'CRM y GoCardless en Ajustes › Cobros'],
    // Las claves de los dos primeros son las de G01 (conta-gocardless-leer/conversion.ts).
    catalogo: [
      { clave: 'gestoria_mensual', nombre: 'Gestoría mensual', forma: 'fijo_mes' },
      { clave: 'gestion_laboral', nombre: 'Gestión laboral por empleado', forma: 'por_empleado' },
      { clave: 'renta', nombre: 'Declaración de la renta', forma: 'suelto' },
      { clave: 'altas', nombre: 'Altas', forma: 'suelto' },
      { clave: 'regularizaciones', nombre: 'Regularizaciones', forma: 'suelto' },
    ],
  },
}

export const esSector = (x: unknown): x is Sector => typeof x === 'string' && (SECTORES as readonly string[]).includes(x)

/** ¿Este sector enciende esto? */
export const enciende = (sector: Sector, que: Enciende): boolean => PAQUETES[sector].enciende.includes(que)

/**
 * El sector de una fila de `company` (leída con «*»).
 *
 * Con la columna `sector`, manda ella. Mientras la columna no esté en la base
 * (antes de la tanda del G03), sale lo de hoy, con las mismas dos marcas que
 * se leían: `is_hospitality` da hostelería, y una cuenta de asesoría
 * (`conta_despacho_soy`) da gestoría. Así el front se puede publicar antes o
 * después de la base y nadie ve nada distinto.
 */
export function sectorDeFila(fila: Record<string, unknown> | null, cuentaAsesoria: boolean): Sector {
  if (fila && 'sector' in fila && esSector(fila.sector)) return fila.sector
  if (fila?.is_hospitality === true) return 'hosteleria'
  return cuentaAsesoria ? 'gestoria' : 'general'
}

// ── Lo que se propone en el alta ────────────────────────────────────────────

/** Grupos del alta que son gestoría (los añade el G03 a actividades.ts en la tarea 4). */
const GRUPOS_GESTORIA = new Set(['gestoria'])

/**
 * Los códigos que proponen Gestoría, comprobados el 07/11/2026 contra los
 * catálogos de la base (iae_heading: tarifas del IAE, RDL 1175/1990;
 * cnae_code: CNAE-2025, RD 10/2025). En iae_heading el código lleva su
 * sección delante («1_842», «2_722»).
 *   · Seguros: IAE 1_842 (servicios financieros y contables), 1_8497
 *     (servicios de gestión administrativa; solo ese epígrafe del grupo 849,
 *     que es también mensajería o seguridad: Julio, 07/11), 2_722
 *     (gestores administrativos), 2_726 (graduados sociales), 2_741
 *     (economistas); CNAE 69.20 (contabilidad, teneduría, auditoría y
 *     asesoría fiscal).
 *   · Proponen, pero preguntan (Julio, 07/11): CNAE 69.10 (actividades
 *     jurídicas) y 70.20 (consultoría de gestión empresarial; la 70.22 de la
 *     CNAE-2009 no existe en la CNAE-2025).
 */
/** Grupos (tres cifras) o epígrafes (cuatro): vale el código o lo que cuelga de él. */
const IAE_GESTORIA = ['1_842', '1_8497', '2_722', '2_726', '2_741']
const CNAE_GESTORIA = new Set(['6920'])
const CNAE_GESTORIA_DUDA = new Set(['6910', '7020'])

const esIaeGestoria = (iae: string | null): boolean => !!iae && IAE_GESTORIA.some((c) => iae === c || (iae.startsWith(c) && /^\d+$/.test(iae.slice(c.length))))
const claseCnae = (cnae: string | null): string => (cnae ?? '').replace(/\D/g, '').slice(0, 4)

/** ¿Estos códigos proponen Gestoría? `duda`: la propone, pero la pregunta va abierta. */
export function gestoriaPorCodigos(iae: string | null, cnae: string | null): 'si' | 'duda' | 'no' {
  if (esIaeGestoria(iae) || CNAE_GESTORIA.has(claseCnae(cnae))) return 'si'
  return CNAE_GESTORIA_DUDA.has(claseCnae(cnae)) ? 'duda' : 'no'
}

export interface Propuesta {
  sector: Sector
  /** Se propone, pero sin darlo por hecho: «¿Eres una gestoría o asesoría?» en vez de «eres una gestoría. ¿Es así?». */
  duda: boolean
  /** G03 · No hay nada en qué apoyarse (ni actividad ni palabras): la pregunta va sin propuesta dicha. */
  sinPista?: boolean
}

/**
 * El sector que se propone en el alta. Solo se propone: la persona lo
 * confirma o lo cambia. Hostelería gana si sale (es lo de hoy); después,
 * gestoría segura, gestoría con duda y, si no, general.
 */
export function sectorPropuesto(a: { hosteleria: boolean; grupos: readonly string[]; codigos: readonly { iae: string | null; cnae: string | null }[] }): Propuesta {
  if (a.hosteleria) return { sector: 'hosteleria', duda: false }
  const porCodigo = a.codigos.map((c) => gestoriaPorCodigos(c.iae, c.cnae))
  if (a.grupos.some((g) => GRUPOS_GESTORIA.has(g)) || porCodigo.includes('si')) return { sector: 'gestoria', duda: false }
  if (porCodigo.includes('duda')) return { sector: 'gestoria', duda: true }
  return { sector: 'general', duda: false }
}

/** Lo que el contexto del menú recibe de la empresa: su sector y lo que enciende. Sin empresa, nada. */
export function loQueEnciendeLaEmpresa(fila: Record<string, unknown> | null, cuentaAsesoria: boolean): { sector: Sector | null; hosteleria: boolean; gestoria: boolean } {
  if (!fila) return { sector: null, hosteleria: false, gestoria: false }
  const sector = sectorDeFila(fila, cuentaAsesoria)
  return { sector, hosteleria: enciende(sector, 'hosteleria'), gestoria: enciende(sector, 'gestoria') }
}

// ── Sus palabras ────────────────────────────────────────────────────────────

/** «Gestoría o asesoría» → «gestoría o asesoría», para dentro de una frase. */
export const enMinuscula = (s: Sector): string => PAQUETES[s].etiqueta.charAt(0).toLowerCase() + PAQUETES[s].etiqueta.slice(1)

/** La pregunta del alta, con la propuesta ya dicha (Diseño del G03): «Por lo que me cuentas, eres una gestoría. ¿Es así?». */
export function preguntaDelSector(p: Propuesta): string {
  if (p.sinPista) return '¿De qué sector es tu negocio?'
  if (p.duda) return 'Por lo que me cuentas, puede que seas una gestoría o una asesoría. ¿Lo eres?'
  if (p.sector === 'general') return 'Por lo que me cuentas, tu negocio no es de hostelería ni una gestoría. ¿Es así?'
  return `Por lo que me cuentas, eres ${PAQUETES[p.sector].enLaFrase}. ¿Es así?`
}

/** Las opciones de la pregunta, con la propuesta la primera (va marcada). */
export function opcionesDelSector(propuesto: Sector): { valor: Sector; texto: string }[] {
  return [propuesto, ...SECTORES.filter((s) => s !== propuesto)].map((s) => ({ valor: s, texto: PAQUETES[s].etiqueta }))
}
