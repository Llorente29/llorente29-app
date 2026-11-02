// tests/unit/modules/conta/laboral/volcado.test.ts
//
// N1 · PR 1 (01/11/2026) · Lo que dice la pantalla al pasar las filas de
// Cegid a las fichas (regla 8): con números, sin esconder a nadie (regla 7), y
// lo que cobra que no cuadra, con las dos cifras y la diferencia (respuesta 2).
// Nombres inventados.
import { describe, expect, it } from 'vitest'
import { lineaNoCuadra, resumenVolcado, type ResultadoVolcado } from '@/modules/conta/laboral/importar/volcado'

const base: ResultadoVolcado = {
  personas: 19, nuevasDeBaja: 11, yaEstaban: 8, contratos: 31, trabajadoresEnCegid: 19, contratosEnCegid: 31,
  avisos: 0, errores: 0, centrosSinConfirmar: [], noCuadra: [], mensajes: [],
}

describe('resumenVolcado', () => {
  it('todo dentro: el caso del encargo, 19 personas y 31 contratos', () => {
    expect(resumenVolcado(base)).toBe('19 personas y 31 contratos al día desde Cegid (8 ya estaban en el equipo · 11 entran como bajas). Sin avisos.')
  })
  it('si alguien no entra, lo dice con cuántas y manda a los avisos', () => {
    const r = resumenVolcado({ ...base, personas: 17, nuevasDeBaja: 9, avisos: 2 })
    expect(r).toBe('17 personas y 31 contratos al día desde Cegid (8 ya estaban en el equipo · 9 entran como bajas). De las 19 de Cegid, 2 no han entrado: abajo, el porqué.')
  })
  it('en singular y sin nadie nuevo', () => {
    expect(resumenVolcado({ ...base, personas: 1, yaEstaban: 1, nuevasDeBaja: 0, contratos: 1, trabajadoresEnCegid: 1, avisos: 1 }))
      .toBe('1 persona y 1 contrato al día desde Cegid (1 ya estaba en el equipo). Mira los avisos de abajo.')
  })
  it('con punto de miles', () => {
    expect(resumenVolcado({ ...base, personas: 1200, yaEstaban: 1200, nuevasDeBaja: 0, contratos: 1500, trabajadoresEnCegid: 1200 }))
      .toContain('1.200 personas y 1.500 contratos')
  })
})

describe('lineaNoCuadra', () => {
  it('las dos cifras y la diferencia, con su signo', () => {
    // Intl pone un espacio duro antes de «€»: se compara con los espacios normalizados.
    const l = lineaNoCuadra({ persona: 'Persona Inventada Uno', cegid: 1400, conceptos: 1350 }).replace(/\s/g, ' ')
    expect(l).toContain('Persona Inventada Uno')
    expect(l).toContain('1.400,00 €')
    expect(l).toContain('1.350,00 €')
    expect(l).toMatch(/Diferencia: -50,00 €\.$/)
    expect(lineaNoCuadra({ persona: 'X', cegid: 1000, conceptos: 1050.5 }).replace(/\s/g, ' ')).toMatch(/Diferencia: \+50,50 €\.$/)
  })
})

describe('«Sin centro en Cegid» (N1 · respuesta 3)', () => {
  it('la fila de las que no traen centro se llama así en pantalla; las demás, por su centro', async () => {
    const { SIN_CENTRO, nombreDelCentro } = await import('@/modules/conta/laboral/importar/volcado')
    expect(nombreDelCentro(SIN_CENTRO)).toBe('Sin centro en Cegid')
    expect(nombreDelCentro('Centro Inventado')).toBe('Centro Inventado')
  })
})
