import { describe, it, expect } from 'vitest'
import { reconstruyeCierres, frasePorque, type EventoDeMarca } from '@/modules/ventas/home/porqueSemana'

const FIN = new Date('2026-09-02T22:00:00Z')
const CARA = 'c'

function ev(marca: string, accion: 'open' | 'close', cuando: string, loc: string | null = CARA,
            nombre: string | null = 'Foodint Carabanchel'): EventoDeMarca {
  return { marca, accion, cuando, locationId: loc, localNombre: nombre }
}

describe('reconstruyeCierres', () => {
  it('empareja cada cierre con su apertura', () => {
    const c = reconstruyeCierres([
      ev('Meraki Pita', 'close', '2026-08-31T10:00:00Z'),
      ev('Meraki Pita', 'open', '2026-08-31T14:00:00Z'),
    ], FIN)
    expect(c).toHaveLength(1)
    expect(c[0].duracionMs).toBe(4 * 3600_000)
    expect(c[0].hasta).not.toBeNull()
  })

  it('un cierre sin apertura sigue vigente hasta el fin de la ventana', () => {
    const c = reconstruyeCierres([ev('Meraki Pita', 'close', '2026-09-01T06:33:00Z')], FIN)
    expect(c[0].hasta).toBeNull()
    expect(c[0].duracionMs).toBeGreaterThan(24 * 3600_000)
  })

  // Defecto 1 de los tres medidos: 19 de 28 eventos reales venían sin local.
  // Sin local no se reparte ni se supone: se descarta.
  it('un evento SIN local se descarta, no se reparte entre locales', () => {
    expect(reconstruyeCierres([
      ev('Lovers Burgers', 'close', '2026-08-27T18:27:00Z', null, null),
      ev('Lovers Burgers', 'open', '2026-08-28T10:27:00Z', null, null),
    ], FIN)).toEqual([])
  })
})

describe('frasePorque', () => {
  // El caso REAL del 02/09: Meraki Pita cerró el martes en Carabanchel y sigue.
  it('el cierre vigente se enuncia como hecho, con su día y su local', () => {
    const f = frasePorque([ev('Meraki Pita', 'close', '2026-09-01T06:33:00Z')], FIN, true)
    expect(f).toBe('Meraki Pita lleva cerrada en Foodint Carabanchel desde el martes')
  })

  // Defecto 2: el 29/08 hubo cinco cierres en catorce minutos, uno de 32
  // segundos. Alguien probando no es un cierre que explique unas ventas.
  it('un cierre de segundos NO genera frase', () => {
    expect(frasePorque([
      ev('Meraki Pita', 'close', '2026-08-29T09:23:39Z'),
      ev('Meraki Pita', 'open', '2026-08-29T09:24:11Z'),
    ], FIN, true)).toBeNull()
  })

  // Defecto 3: un cierre coincide con una bajada, no la causa. Y desde luego
  // no explica una SUBIDA: ponerlo al lado de un +12 % invitaría a leer una
  // relación que no existe.
  it('si la semana SUBE no se pinta ningún porqué', () => {
    expect(frasePorque([ev('Meraki Pita', 'close', '2026-09-01T06:33:00Z')], FIN, false)).toBeNull()
  })

  it('sin cierros que contar, null y no una frase de relleno', () => {
    expect(frasePorque([], FIN, true)).toBeNull()
  })

  it('cerrada en dos locales a la vez se dice «en los dos locales»', () => {
    const f = frasePorque([
      ev('Meraki Pita', 'close', '2026-09-01T06:33:00Z'),
      ev('Meraki Pita', 'close', '2026-09-01T07:00:00Z', 'a', 'Foodint Alcalá'),
    ], FIN, true)
    expect(f).toBe('Meraki Pita lleva cerrada en los dos locales desde el martes')
  })

  it('gana el cierre MÁS LARGO, no el primero que aparezca', () => {
    const f = frasePorque([
      ev('Corta', 'close', '2026-09-01T06:00:00Z'),
      ev('Corta', 'open', '2026-09-01T09:00:00Z'),
      ev('Larga', 'close', '2026-09-01T06:33:00Z', 'a', 'Foodint Alcalá'),
    ], FIN, true)
    expect(f).toContain('Larga')
  })
})
