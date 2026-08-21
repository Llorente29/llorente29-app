// Rutas de publicación por (local, canal) — ENCARGO CODE 21/08 §4.1.
//
// Los datos son los REALES de Foodint (6 filas sembradas el 18/08). El caso que
// motiva el encargo es el primero: Glovo en Alcalá sale por Last, y la rejilla
// dejaba escribir ahí un precio que no se publica en ninguna parte.
import { describe, it, expect } from 'vitest'
import {
  veredicto, esEditable, llegaAPlataforma, type RouteRow,
} from '@/modules/kitchen/services/channelRouteService'

const ALCALA = 'loc-alcala'
const CARABANCHEL = 'loc-carabanchel'
const GLOVO = 'ch-glovo'
const UBER = 'ch-uber'
const JUSTEAT = 'ch-justeat'
const MOSTRADOR = 'ch-mostrador'

// Copia fiel de channel_publish_route en producción (21/08).
const FILAS: RouteRow[] = [
  { locationId: ALCALA, channelId: GLOVO, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
  { locationId: ALCALA, channelId: UBER, route: 'hubrise', effectiveFrom: '2026-08-06', notes: null },
  { locationId: ALCALA, channelId: JUSTEAT, route: 'hubrise', effectiveFrom: '2026-08-13', notes: null },
  { locationId: CARABANCHEL, channelId: GLOVO, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
  { locationId: CARABANCHEL, channelId: UBER, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
  { locationId: CARABANCHEL, channelId: JUSTEAT, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
]
const HOY = '2026-08-21'

describe('veredicto de ruta', () => {
  it('Glovo en Alcalá se gestiona en Last y NO se edita — el caso del encargo', () => {
    const v = veredicto(FILAS, ALCALA, GLOVO, 'delivery', HOY)
    expect(v.kind).toBe('last')
    expect(esEditable(v)).toBe(false)
    expect(llegaAPlataforma(v)).toBe(false)
  })

  it('Uber y Just Eat en Alcalá los publica Folvy y sí se editan', () => {
    for (const ch of [UBER, JUSTEAT]) {
      const v = veredicto(FILAS, ALCALA, ch, 'delivery', HOY)
      expect(v.kind).toBe('folvy')
      expect(esEditable(v)).toBe(true)
      expect(llegaAPlataforma(v)).toBe(true)
    }
  })

  it('EL MISMO canal cambia de veredicto según el local: Uber es Folvy en Alcalá y Last en Carabanchel', () => {
    expect(veredicto(FILAS, ALCALA, UBER, 'delivery', HOY).kind).toBe('folvy')
    expect(veredicto(FILAS, CARABANCHEL, UBER, 'delivery', HOY).kind).toBe('last')
  })

  it('en Carabanchel no publica Folvy en ningún canal de reparto', () => {
    for (const ch of [GLOVO, UBER, JUSTEAT]) {
      expect(llegaAPlataforma(veredicto(FILAS, CARABANCHEL, ch, 'delivery', HOY))).toBe(false)
    }
  })

  it('sin local elegido no se afirma una ruta: la ruta es POR LOCAL', () => {
    // Decir «publica Folvy» de Uber sin saber el local sería mentir la mitad de
    // las veces en esta misma cuenta.
    expect(veredicto(FILAS, null, UBER, 'delivery', HOY).kind).toBe('sin_declarar')
  })

  it('un canal de reparto sin fila queda «sin declarar» y SE PUEDE editar', () => {
    // Folvy Interno y Kitchen Grill no tienen ni una fila. Bloquear por falta de
    // dato dejaría la pantalla inútil en dos cuentas de tres.
    const v = veredicto([], ALCALA, GLOVO, 'delivery', HOY)
    expect(v.kind).toBe('sin_declarar')
    expect(esEditable(v)).toBe(true)
    expect(llegaAPlataforma(v)).toBe(false)
  })

  it('Mostrador no es de reparto: ni ruta ni aviso falso', () => {
    const v = veredicto(FILAS, ALCALA, MOSTRADOR, 'dine_in', HOY)
    expect(v.kind).toBe('interno')
    expect(esEditable(v)).toBe(true)
  })

  it('una ruta que aún no ha entrado en vigor no cuenta', () => {
    // Uber/Alcalá pasó a HubRise el 06/08. El 05/08 todavía no.
    expect(veredicto(FILAS, ALCALA, UBER, 'delivery', '2026-08-05').kind).toBe('sin_declarar')
    expect(veredicto(FILAS, ALCALA, UBER, 'delivery', '2026-08-06').kind).toBe('folvy')
  })

  it('con dos cortes vigentes manda el MÁS RECIENTE, no el primero que venga', () => {
    const conCorte: RouteRow[] = [
      { locationId: ALCALA, channelId: GLOVO, route: 'lastapp', effectiveFrom: '2000-01-01', notes: null },
      { locationId: ALCALA, channelId: GLOVO, route: 'hubrise', effectiveFrom: '2026-08-20', notes: null },
    ]
    expect(veredicto(conCorte, ALCALA, GLOVO, 'delivery', HOY).kind).toBe('folvy')
    expect(veredicto(conCorte, ALCALA, GLOVO, 'delivery', '2026-08-19').kind).toBe('last')
  })

  it('no se cruzan los locales: la fila de Carabanchel no resuelve Alcalá', () => {
    const soloCara = FILAS.filter((r) => r.locationId === CARABANCHEL)
    expect(veredicto(soloCara, ALCALA, UBER, 'delivery', HOY).kind).toBe('sin_declarar')
  })
})
