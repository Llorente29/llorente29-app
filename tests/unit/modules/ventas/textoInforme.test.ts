import { describe, it, expect } from 'vitest'
import {
  intervaloEnCastellano, intervaloDeFechas, fechaParaIntervalo,
} from '@/modules/ventas/services/textoInforme'

// B82 (06/09/2026). INCIDENTE EN PRODUCCIÓN: las tres pantallas nuevas de Kitchen
// caían al error boundary con «RangeError: Invalid time value» nada más pintar.
//
// La causa, exacta: `intervaloEnCastellano` lee `YYYY-MM-DD HH:MM` —con ESPACIO—
// y las tres le pasaban `date.toISOString()`, que lleva «T». Entonces
// `'2026-09-06T18:01:02.123Z'.split('-')` da `['2026','09','06T18:01:02.123Z']`,
// el día sale NaN, y `Date.UTC(2026, 8, NaN)` es NaN → `new Date(NaN)` →
// `.toISOString()` LANZA.
//
// Y por qué no lo cazaron 805 pruebas: NINGUNA pintaba una cabecera. No fue cosa
// del navegador — en Node lanza igual. Era código sin probar, sin más.

const ISO_QUE_REVENTO = '2026-09-06T18:01:02.123Z'

describe('la cadena exacta que tumbó las tres pantallas', () => {
  it('un ISO con «T» ya NO lanza: devuelve null', () => {
    expect(() => intervaloEnCastellano(ISO_QUE_REVENTO, ISO_QUE_REVENTO)).not.toThrow()
    expect(intervaloEnCastellano(ISO_QUE_REVENTO, ISO_QUE_REVENTO)).toBeNull()
  })

  it('y con la ventana real de 30 días en ISO, tampoco', () => {
    const hasta = new Date('2026-09-06T18:01:02.123Z')
    const desde = new Date(hasta.getTime() - 30 * 24 * 3600 * 1000)
    expect(() => intervaloEnCastellano(desde.toISOString(), hasta.toISOString())).not.toThrow()
  })
})

describe('lo que sí sabe leer sigue leyéndose igual', () => {
  // El límite superior es EXCLUSIVO y así estaba escrito en la docstring: la
  // ventana acaba el 31 a las 00:00, así que el último día que se NOMBRA es el
  // 30. Mi primera versión de esta prueba esperaba «al 31» y estaba mal ella,
  // no la función.
  it('dos días distintos del mismo mes, con el fin exclusivo bien puesto', () => {
    expect(intervaloEnCastellano('2026-08-24 00:00', '2026-08-31 00:00'))
      .toBe('Del 24 al 30 de agosto')
  })
  it('meses distintos', () => {
    expect(intervaloEnCastellano('2026-08-07 00:00', '2026-09-06 00:00'))
      .toBe('Del 7 de agosto al 5 de septiembre')
  })
  it('un solo día, con hora de corte', () => {
    expect(intervaloEnCastellano('2026-09-06 00:00', '2026-09-06 14:30'))
      .toBe('El 6 de septiembre, hasta las 14:30')
  })
})

describe('basura de entrada: null, nunca una excepción', () => {
  for (const malo of ['', 'ayer', '2026-13-01 00:00', '2026/09/06 10:00', 'null']) {
    it(`«${malo}» devuelve null sin lanzar`, () => {
      expect(() => intervaloEnCastellano(malo, '2026-09-06 00:00')).not.toThrow()
      expect(intervaloEnCastellano(malo, '2026-09-06 00:00')).toBeNull()
    })
  }
})

describe('fechaParaIntervalo · el formato que esta función sí sabe leer', () => {
  it('formatea en hora LOCAL, con espacio y ceros a la izquierda', () => {
    // Se construye con componentes locales para que la prueba no dependa del huso.
    const d = new Date(2026, 8, 6, 9, 5)   // 6 de septiembre, 09:05 local
    expect(fechaParaIntervalo(d)).toBe('2026-09-06 09:05')
  })
  it('una fecha inválida da null, no una cadena rota', () => {
    expect(fechaParaIntervalo(new Date(NaN))).toBeNull()
  })
})

describe('intervaloDeFechas · el camino que usan ahora las tres pantallas', () => {
  it('la ventana de 30 días del Resumen sale en castellano', () => {
    const hasta = new Date(2026, 8, 6, 20, 1)
    const desde = new Date(hasta.getTime() - 30 * 24 * 3600 * 1000)
    const texto = intervaloDeFechas(desde, hasta)
    expect(texto).not.toBeNull()
    expect(texto).toContain('agosto')
    expect(texto).toContain('septiembre')
  })

  it('la de 90 días de Ingeniería, igual', () => {
    const hasta = new Date(2026, 8, 6, 20, 1)
    const desde = new Date(hasta.getTime() - 90 * 24 * 3600 * 1000)
    expect(intervaloDeFechas(desde, hasta)).not.toBeNull()
  })

  // El caso que de verdad importa: si el periodo guardado se corrompe y las
  // cuentas dan NaN, la pantalla tiene que PINTARSE, no caerse.
  it('con una fecha inválida devuelve null en vez de tumbar el render', () => {
    const hasta = new Date(2026, 8, 6, 20, 1)
    expect(() => intervaloDeFechas(new Date(NaN), hasta)).not.toThrow()
    expect(intervaloDeFechas(new Date(NaN), hasta)).toBeNull()
    expect(intervaloDeFechas(new Date(hasta.getTime() - NaN), hasta)).toBeNull()
  })
})
