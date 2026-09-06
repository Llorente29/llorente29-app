// src/modules/ventas/services/reportSalesService.ts
//
// El generador de informes, lado cliente. Llama a `report_sales` y devuelve lo
// que la pantalla necesita YA MASTICADO, incluido lo que hay que ESCRIBIR junto
// a cada cifra.
//
// ── ESTA CAPA NO CALCULA NINGUNA CIFRA DE DINERO ──────────────────────────
// Ni una suma, ni un porcentaje de venta. Todo eso lo hace la RPC, y por eso el
// correo y la pantalla van a cuadrar: una sola verdad, en SQL. Lo único que se
// calcula aquí son los DELTAS entre las dos ventanas que la propia RPC devuelve.
//
// ── LO QUE ESTA CAPA SI HACE, Y ES LA MITAD DEL ENCARGO ────────────────────
// Las dos ventanas se calculan aquí con `periodoInforme.ts` y se le PASAN a la
// RPC. No las deduce el SQL: `p_from − (p_to − p_from)` desalinea una hora la
// semana del cambio de hora, y para «este mes» ni siquiera da el mes anterior.
// La frontera vuelve a comprobar que duran lo mismo y aborta si no — esto no es
// la única defensa, es la primera.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import { diaNatural } from '@/lib/fechas'
import type { PeriodoResuelto } from './periodoInforme'

/** Un eje del informe. Se combinan libremente. */
export type EjeInforme = 'local' | 'marca' | 'propiedad' | 'canal' | 'servicio' | 'dia'

export interface FiltrosInforme {
  locationIds?: string[] | null
  brandIds?: string[] | null
  /** 'own' | 'licensed'. Se lee de `brand.ownership_type`, nunca del nombre. */
  ownership?: string | null
  channelIds?: string[] | null
  serviceTypes?: string[] | null
}

/** Una fila del informe. `dims` lleva solo los ejes pedidos. */
export interface FilaInformeVentas {
  dims: Record<string, string>
  pedidos: number
  bruto: number
  descuentos: number
  neto: number
  ticket_medio: number
  coste: number | null
  pedidos_costeados: number
  neto_costeado: number | null
  pedidos_sin_hueco: number
  neto_sin_hueco: number | null
  pedidos_mod_sin_impacto: number
}

export interface VentanaMedida {
  desde: string
  hasta: string
  horas: number
}

export interface NivelDeCobertura {
  pedidos: number
  neto: number | null
  pct_pedidos: number | null
  pct_importe: number | null
  regla: string
}

export interface MetaInforme {
  zona: string
  ventana_actual: VentanaMedida
  ventana_espejo: VentanaMedida
  ejes: EjeInforme[]
  filtros: Record<string, unknown>
  regla: string
  cobertura_coste: {
    pedidos: number
    neto: number | null
    con_coste: NivelDeCobertura
    sin_hueco_de_modificador: NivelDeCobertura & {
      pedidos_con_modificador_cobrado_sin_impacto: number
    }
    /** El sesgo de B73. Es TEXTO a propósito: un sesgo no tiene porcentaje. */
    sesgo_no_medido: string
  }
}

export interface InformeVentas {
  meta: MetaInforme
  filas: FilaInformeVentas[]
  espejo: FilaInformeVentas[]
  dias: { actual: FilaInformeVentas[]; espejo: FilaInformeVentas[] }
}

function sb() {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/** Ejecuta un informe. Las dos ventanas salen de `resuelvePeriodo`. */
export async function ejecutaInforme(input: {
  accountId: string
  periodo: PeriodoResuelto
  ejes: EjeInforme[]
  filtros?: FiltrosInforme
}): Promise<InformeVentas> {
  const f = input.filtros ?? {}
  // La RPC aún no está en `database.ts` (deuda conocida: los tipos van por
  // detrás del esquema). Se castea la llamada con el MISMO patrón que ya usa
  // `salesDashboardService.ts`, incluido llamarla como member-access de
  // `supabase!` para no perder el `this` del cliente.
  const { data, error } = await (
    sb().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )('report_sales', {
    p_account:       input.accountId,
    p_from:          input.periodo.actual.desde.toISOString(),
    p_to:            input.periodo.actual.hasta.toISOString(),
    p_prev_from:     input.periodo.espejo.desde.toISOString(),
    p_prev_to:       input.periodo.espejo.hasta.toISOString(),
    p_ejes:          input.ejes,
    p_location_ids:  f.locationIds ?? null,
    p_brand_ids:     f.brandIds ?? null,
    p_ownership:     f.ownership ?? null,
    p_channel_ids:   f.channelIds ?? null,
    p_service_types: f.serviceTypes ?? null,
    p_calendario:    input.periodo.calendario,
  })

  // La frontera lanza excepción cuando las ventanas no son comparables, y ese
  // mensaje YA dice qué pasa («las ventanas no duran lo mismo (X vs Y)»). Se
  // deja pasar tal cual en vez de taparlo con un «no se pudo cargar»: regla 8,
  // el fallo lleva contenido.
  if (error) throw new Error(`No se ha podido ejecutar el informe: ${error.message}`)
  return data as unknown as InformeVentas
}

// ── Los deltas: lo ÚNICO que se calcula fuera de SQL ────────────────────────

export interface FilaConDelta extends FilaInformeVentas {
  espejo: FilaInformeVentas | null
  deltaNeto: number | null
  deltaNetoPct: number | null
  deltaPedidos: number | null
}

/** Clave estable de una fila por sus ejes, para casarla con su espejo. */
export function claveDeFila(dims: Record<string, string>): string {
  return Object.keys(dims).sort().map((k) => `${k}=${dims[k]}`).join('|')
}

/**
 * Cruza cada fila con la suya del espejo.
 *
 * Una fila que existe en el espejo y NO en el actual se devuelve igualmente,
 * con el actual a cero: un local que vendía y ha dejado de vender es la fila
 * más importante del informe, y un `join` normal la haría desaparecer (regla 7).
 */
export function cruzaConEspejo(
  filas: FilaInformeVentas[], espejo: FilaInformeVentas[],
): FilaConDelta[] {
  const porClave = new Map(espejo.map((e) => [claveDeFila(e.dims), e]))
  const salida: FilaConDelta[] = filas.map((f) => {
    const e = porClave.get(claveDeFila(f.dims)) ?? null
    porClave.delete(claveDeFila(f.dims))
    return conDelta(f, e)
  })
  for (const e of porClave.values()) salida.push(conDelta(vacia(e.dims), e))
  return salida.sort((a, b) => b.neto - a.neto)
}

function conDelta(f: FilaInformeVentas, e: FilaInformeVentas | null): FilaConDelta {
  const deltaNeto = e ? f.neto - e.neto : null
  return {
    ...f,
    espejo: e,
    deltaNeto,
    // Sin base no hay porcentaje: de 0 a 100 € no es «+∞ %», es «no había nada
    // con qué comparar». Se devuelve null y la pantalla lo dice con palabras.
    deltaNetoPct: e && e.neto !== 0 ? ((f.neto - e.neto) / Math.abs(e.neto)) * 100 : null,
    deltaPedidos: e ? f.pedidos - e.pedidos : null,
  }
}

function vacia(dims: Record<string, string>): FilaInformeVentas {
  return {
    dims, pedidos: 0, bruto: 0, descuentos: 0, neto: 0, ticket_medio: 0,
    coste: null, pedidos_costeados: 0, neto_costeado: null,
    pedidos_sin_hueco: 0, neto_sin_hueco: null, pedidos_mod_sin_impacto: 0,
  }
}

/**
 * LA GUARDA DE B78: una fila cuyas `dims` no lleven las claves de los ejes
 * pedidos NO SE PINTA.
 *
 * El 06/09 la tabla enseñó dos filas que no eran de su consulta. Una se
 * reprodujo al céntimo: `{canal: "Uber"}` con 96 pedidos y 2.017,41 € era la
 * respuesta de OTRA pregunta —eje canal, Alcalá, propias, semana en curso—
 * pintada bajo un informe de `marca × propiedad`.
 *
 * Esta guarda no depende de saber cómo llegó ahí: una fila que no trae los ejes
 * que se preguntaron no es de esta pregunta, y no se enseña. Por construcción,
 * no por acordarse de vaciar el estado.
 *
 * Y NO FILTRA EN SILENCIO: devuelve lo descartado para que la pantalla lo diga.
 * Un filtro callado nos habría dejado sin saber nunca de dónde salían esas
 * filas — que es justo lo que hay que evitar mientras la causa siga abierta.
 */
export function filtraPorEjes<T extends { dims: Record<string, string> }>(
  filas: T[], ejes: EjeInforme[],
): { visibles: T[]; descartadas: T[] } {
  const visibles: T[] = []
  const descartadas: T[] = []
  for (const f of filas) {
    const d = f.dims ?? {}
    // Tiene que traer TODAS las claves pedidas y NINGUNA de más: una fila con
    // un eje extra tampoco es de esta pregunta.
    const traeTodas = ejes.every((e) => typeof d[e] === 'string')
    const sinSobrantes = Object.keys(d).every((k) => (ejes as string[]).includes(k))
    ;(traeTodas && sinSobrantes ? visibles : descartadas).push(f)
  }
  return { visibles, descartadas }
}

/**
 * EL CUADRE VISIBLE. La suma de las filas contra el total.
 *
 * Sin esto, el fallo del 06/09 sólo se veía sumando a mano — y lo hizo Julio.
 * Una pantalla no esconde que algo no cuadra (regla 7 en su forma más literal):
 * si no suma, lo dice, con las dos cifras.
 *
 * El margen de un céntimo es por el redondeo a dos decimales de cada fila.
 */
export function cuadra(
  filas: { neto: number; pedidos: number }[], total: { neto: number; pedidos: number },
): { ok: boolean; sumaNeto: number; sumaPedidos: number } {
  const sumaNeto = Math.round(filas.reduce((a, f) => a + f.neto, 0) * 100) / 100
  const sumaPedidos = filas.reduce((a, f) => a + f.pedidos, 0)
  return {
    ok: Math.abs(sumaNeto - total.neto) <= 0.01 && sumaPedidos === total.pedidos,
    sumaNeto, sumaPedidos,
  }
}

// ── Lo que se descarga ─────────────────────────────────────────────────────

/**
 * Las filas para el CSV/XLSX, con las columnas en el orden del encargo y la
 * cabecera de contexto DENTRO del fichero.
 *
 * El intervalo y la regla van en el propio fichero, no solo en la pantalla: un
 * CSV que alguien abre tres semanas después sin saber qué ventana midió es
 * exactamente el problema que este informe existe para arreglar.
 */
export function filasParaDescarga(
  informe: InformeVentas, filas: FilaConDelta[],
): Record<string, unknown>[] {
  const m = informe.meta
  return filas.map((f) => ({
    ...f.dims,
    pedidos: f.pedidos,
    bruto: f.bruto,
    descuentos: f.descuentos,
    neto: f.neto,
    ticket_medio: f.ticket_medio,
    neto_espejo: f.espejo?.neto ?? '',
    delta_eur: f.deltaNeto ?? '',
    // Redondeo aritmético, no `toFixed`: para una celda de CSV el valor tiene
    // que salir NÚMERO, y `toFixed` da texto que habría que volver a convertir.
    delta_pct: f.deltaNetoPct != null ? Math.round(f.deltaNetoPct * 10) / 10 : '',
    periodo: `${m.ventana_actual.desde} → ${m.ventana_actual.hasta}`,
    espejo: `${m.ventana_espejo.desde} → ${m.ventana_espejo.hasta}`,
    regla: m.regla,
  }))
}

/** «ventas-por-local-2026-09-06» */
export function nombreDelInforme(ejes: EjeInforme[], ahora: Date): string {
  return `ventas-por-${ejes.length ? ejes.join('-') : 'total'}-${diaNatural(ahora)}`
}
