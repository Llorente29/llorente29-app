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
  /** Lo que sale dentro de las pantallas y no es una página del menú. */
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
    tarjetas: ['Socios de marca en Liquidaciones', 'Catcher', 'Liquidaciones del mes en Compras', 'Cierre del día en Ajustes'],
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
 * Por los códigos elegidos a mano. CNAE-2025 69.20 (contabilidad, teneduría,
 * auditoría y asesoría fiscal) e IAE 1_842 (servicios financieros y
 * contables). Pendiente de que Julio confirme los códigos (hechos del negocio).
 */
export function esGestoriaPorCodigos(iae: string | null, cnae: string | null): boolean {
  const i = /^1_(\d+)/.exec(iae ?? '')?.[1] ?? ''
  const c = (cnae ?? '').replace(/\D/g, '')
  return /^842/.test(i) || /^6920/.test(c)
}

/**
 * El sector que se propone en el alta. Hostelería gana a gestoría si salen las
 * dos (es lo de hoy: lo que daba de comer era hostelería). La persona lo
 * confirma o lo cambia.
 */
export function sectorPropuesto(a: { hosteleria: boolean; grupos: readonly string[]; codigos: readonly { iae: string | null; cnae: string | null }[] }): Sector {
  if (a.hosteleria) return 'hosteleria'
  if (a.grupos.some((g) => GRUPOS_GESTORIA.has(g)) || a.codigos.some((c) => esGestoriaPorCodigos(c.iae, c.cnae))) return 'gestoria'
  return 'general'
}

/** Lo que el contexto del menú recibe de la empresa: su sector y lo que enciende. Sin empresa, nada. */
export function loQueEnciendeLaEmpresa(fila: Record<string, unknown> | null, cuentaAsesoria: boolean): { sector: Sector | null; hosteleria: boolean; gestoria: boolean } {
  if (!fila) return { sector: null, hosteleria: false, gestoria: false }
  const sector = sectorDeFila(fila, cuentaAsesoria)
  return { sector, hosteleria: enciende(sector, 'hosteleria'), gestoria: enciende(sector, 'gestoria') }
}
