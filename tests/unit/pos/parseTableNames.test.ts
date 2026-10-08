// Lo que se escribe en oficina para crear mesas de golpe. Los casos son los
// del encargo (Sala 1-6, Terraza 7-10) y las formas habituales en un local.
import { parseTableNames } from '@/modules/pos/lib/parseTableNames'

describe('parseTableNames', () => {
  it('rango numérico: la Sala del encargo', () => {
    expect(parseTableNames('1-6')).toEqual({ names: ['1', '2', '3', '4', '5', '6'], error: null })
    expect(parseTableNames('7 - 10').names).toEqual(['7', '8', '9', '10'])
  })
  it('rango con prefijo, a los dos lados igual', () => {
    expect(parseTableNames('T1-T3').names).toEqual(['T1', 'T2', 'T3'])
    expect(parseTableNames('Barra 1-Barra 2').names).toEqual(['Barra 1', 'Barra 2'])
  })
  it('lista suelta y mezcla, sin repetidos y en orden', () => {
    expect(parseTableNames('1, 2, Reservado, 2, 3-4').names).toEqual(['1', '2', 'Reservado', '3', '4'])
  })
  it('un nombre con guion que no es un rango se queda tal cual', () => {
    expect(parseTableNames('Mesa-alta').names).toEqual(['Mesa-alta'])
  })
  it('errores que se leen', () => {
    expect(parseTableNames('   ').error).toMatch(/Escribe/)
    expect(parseTableNames('6-1').error).toMatch(/al revés/)
    expect(parseTableNames('1-500').error).toMatch(/demasiadas/)
  })
})
