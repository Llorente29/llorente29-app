// G05 · Lo común de las pruebas de los núcleos del cobro: un catálogo y un
// cliente inventados (T11): «Gestoría mensual» 96,80 € (80 € + 21 % de IVA,
// el ejemplo de flujo_recibos_qbo.md) y «Gestión laboral» 24,20 € por trabajador.
import type { Asignacion, Catalogo, Precio, Trabajador } from '../../../../../../supabase/functions/_shared/tarifa/precio'

export const E = 'empresa-1'
export const C = 'cliente-1'
export const GESTORIA = { tipo: 'servicio', servicioId: 'gestoria' } as const
export const LABORAL = { tipo: 'servicio', servicioId: 'laboral' } as const

export const precio = (id: string, objetivo: Precio['objetivo'], cent: number, porTrabajador = false, desde = '2026-01', hasta: string | null = null): Precio => ({
  id, empresaId: E, objetivo, clienteId: null, desde, hasta,
  forma: porTrabajador ? { tipo: 'por_trabajador', importeCent: cent } : { tipo: 'fijo', periodo: 'mes', importeCent: cent },
})

export const catalogo = (precios: Precio[] = [precio('pg', GESTORIA, 9680), precio('pl', LABORAL, 2420, true)]): Catalogo => ({
  servicios: [{ id: 'gestoria', empresaId: E, nombre: 'Gestoría mensual' }, { id: 'laboral', empresaId: E, nombre: 'Gestión laboral' }],
  niveles: [], paquetes: [], precios, ajustes: { mitadDeMes: 'mes_entero' },
})

export const trabajador = (nombre: string, desde = '2026-01', hasta: string | null = null, altaEl: string | null = null): Trabajador => ({ nombre, desde, hasta, altaEl })

export const asignaciones = (laborales: Trabajador[] = [trabajador('Persona Prueba 1'), trabajador('Persona Prueba 2')]): Asignacion[] => [
  { id: 'a-gestoria', clienteId: C, empresaId: E, objetivo: GESTORIA, desde: '2026-01', hasta: null },
  { id: 'a-laboral', clienteId: C, empresaId: E, objetivo: LABORAL, desde: '2026-01', hasta: null, trabajadores: laborales },
]
