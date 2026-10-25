// C12 (24/10) · Traspasar el mes a Diez: lo que dice la pantalla. Las frases
// del mes en cada estado, lo que falta (en palabras de la calle, sin «cola» ni
// «envío»), el resumen por tipo, el cuadre y el informe descargable.
import { describe, expect, it } from 'vitest'
import { cuantasFaltan, fraseDelCuadre, fraseDelMes, informe, mesTerminado, porTipo, primerDiaSiguiente, queFalta, type Revision, type Traspaso } from '@/modules/conta/lib/traspaso'

const euros = (x: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x)} €`
const rev = (o: Partial<Revision> = {}): Revision => ({
  mes: '2026-10-01', faltan: [], van: 120, por_tipo: [{ tipo: 'ventas', n: 85 }, { tipo: 'banco', n: 25 }, { tipo: 'anulacion', n: 2 }, { tipo: 'recibidas', n: 8 }],
  por_cuenta: [], ya_en_diez: 201, no_viajan: 4, traspaso: null, mes_cerrado: false, modo: 'mensual', conectado: true, ...o,
})
const tr = (o: Partial<Traspaso> = {}): Traspaso => ({
  id: 't1', mes: '2026-10-01', estado: 'terminado', confirmado_por_nombre: 'Julio', confirmado_en: '2026-11-02T09:00:00Z',
  faltaba: [], van: 120, llegaron: 120, no_llegaron: 0, detalle: [], cuadre: { cuadra: true, cuentas: 40, diferencias: [], solo_en_diez: [] }, cuadra: true,
  mes_cerrado: true, cierre_motivo: null, terminado_en: '2026-11-02T09:05:00Z', ...o,
})
const NOVIEMBRE = '2026-11-02'

describe('fraseDelMes', () => {
  it('listo para traspasar', () => expect(fraseDelMes(rev(), NOVIEMBRE)).toBe('Octubre está listo para traspasar.'))
  it('faltan cosas: se suman (tres asientos son tres cosas)', () => {
    expect(fraseDelMes(rev({ faltan: [{ codigo: 'asientos', n: 2 }, { codigo: 'recibidas_sin_pdf', n: 1 }] }), NOVIEMBRE)).toBe('Faltan 3 cosas antes de traspasar octubre.')
    expect(fraseDelMes(rev({ faltan: [{ codigo: 'asientos', n: 1 }] }), NOVIEMBRE)).toBe('Falta 1 cosa antes de traspasar octubre.')
  })
  it('el mes en curso aún no se traspasa', () => expect(fraseDelMes(rev(), '2026-10-24')).toBe('Octubre aún no ha terminado: se traspasa a partir del 1 de noviembre.'))
  it('nada que traspasar', () => expect(fraseDelMes(rev({ van: 0 }), NOVIEMBRE)).toBe('Octubre no tiene nada por traspasar a Diez.'))
  it('traspasándose, terminado y cerrado, terminado sin cerrar, con fallos', () => {
    expect(fraseDelMes(rev({ traspaso: tr({ estado: 'traspasando', llegaron: 30, mes_cerrado: false }) }), NOVIEMBRE)).toBe('Octubre se está traspasando a Diez: van 30 de 120.')
    expect(fraseDelMes(rev({ traspaso: tr(), mes_cerrado: true }), NOVIEMBRE)).toBe('Octubre está traspasado a Diez y cerrado.')
    expect(fraseDelMes(rev({ traspaso: tr({ mes_cerrado: false, cuadra: false, cierre_motivo: 'No se cierra el mes: Diez no cuadra con Sumied.' }) }), NOVIEMBRE))
      .toBe('Octubre está traspasado a Diez, pero sin cerrar: Diez no cuadra con Sumied.')
    expect(fraseDelMes(rev({ traspaso: tr({ estado: 'con_fallos', no_llegaron: 2 }) }), NOVIEMBRE)).toBe('Octubre se traspasó, pero 2 asientos no han llegado a Diez.')
    expect(fraseDelMes(rev({ traspaso: tr({ estado: 'con_fallos', no_llegaron: 1 }) }), NOVIEMBRE)).toBe('Octubre se traspasó, pero 1 asiento no ha llegado a Diez.')
  })
  it('diciembre: el siguiente es enero', () => expect(primerDiaSiguiente('2026-12-01')).toBe('1 de enero'))
  it('mesTerminado mira el mes, no el día', () => {
    expect(mesTerminado('2026-10-01', '2026-10-31')).toBe(false)
    expect(mesTerminado('2026-10-01', '2026-11-01')).toBe(true)
  })
})

describe('queFalta', () => {
  it('cada cosa en una frase, en singular y en plural, y sin ceros', () => {
    expect(queFalta([{ codigo: 'asientos', n: 36 }, { codigo: 'recibidas_sin_pdf', n: 1 }, { codigo: 'cierres_en_espera', n: 0 }, { codigo: 'liquidaciones_con_diferencia', n: 2 }]).map((x) => x.texto))
      .toEqual(['36 asientos del mes sin validar', '1 factura recibida sin su PDF', '2 liquidaciones cobradas con diferencia'])
    expect(queFalta([{ codigo: 'cierres_en_espera', n: 1 }])[0].texto).toBe('1 pedido cerrado sin cobrar espera que decidas qué hacer')
  })
  it('ninguna frase habla de cola, envío ni nada de dentro', () => {
    const todo = queFalta([{ codigo: 'asientos', n: 2 }, { codigo: 'recibidas_sin_pdf', n: 2 }, { codigo: 'cierres_en_espera', n: 2 }, { codigo: 'liquidaciones_con_diferencia', n: 2 }]).map((x) => x.texto).join(' ')
      + fraseDelMes(rev(), NOVIEMBRE) + porTipo(rev().por_tipo).map((x) => x.nombre).join(' ')
    expect(todo).not.toMatch(/cola|env[ií]o|external|pendiente/i)
  })
  it('cuantasFaltan suma', () => expect(cuantasFaltan([{ codigo: 'asientos', n: 2 }, { codigo: 'x', n: 3 }])).toBe(5))
})

describe('porTipo', () => {
  it('en el orden de siempre, con su nombre, sin los vacíos', () => {
    expect(porTipo([...rev().por_tipo, { tipo: 'manuales', n: 0 }])).toEqual([
      { tipo: 'ventas', nombre: 'Ventas', n: 85 }, { tipo: 'recibidas', nombre: 'Facturas recibidas', n: 8 },
      { tipo: 'banco', nombre: 'Banco', n: 25 }, { tipo: 'anulacion', nombre: 'Anulaciones de lo que ya estaba en Diez', n: 2 },
    ])
  })
})

describe('fraseDelCuadre', () => {
  it('cuadra, no cuadra una, varias, y sin poder comprobar', () => {
    expect(fraseDelCuadre(tr().cuadre, true, euros)).toBe('Cuadra: 40 cuentas tienen en Diez lo mismo que en Sumied.')
    const una = { cuadra: false, cuentas: 40, solo_en_diez: [], diferencias: [{ cuenta: '43000002', nombre: 'Clientes Uber', sumied: { debe: 110, haber: 0 }, diez: { debe: 60, haber: 0 }, falta_debe: 50, falta_haber: 0 }] }
    expect(fraseDelCuadre(una, false, euros)).toBe('No cuadra la 43000002 (Clientes Uber): Diez tiene 50,00 € menos en el debe.')
    const dos = { ...una, diferencias: [...una.diferencias, { ...una.diferencias[0], cuenta: '70000002', falta_debe: 0, falta_haber: -5 }] }
    expect(fraseDelCuadre(dos, false, euros)).toBe('No cuadran 2 cuentas; la primera, la 43000002: Diez tiene 50,00 € menos en el debe.')
    expect(fraseDelCuadre({ error: 'Diez no contesta' }, null, euros)).toBe('No se ha podido comprobar con Diez: Diez no contesta.')
    expect(fraseDelCuadre(null, null, euros)).toBe('Aún no se ha comprobado con Diez.')
  })
})

describe('informe', () => {
  it('dice quién, cuándo, cuántos, el resultado, lo que faltaba y lo que no llegó', () => {
    const t = tr({ estado: 'con_fallos', llegaron: 118, no_llegaron: 2, mes_cerrado: false, cuadra: false, cierre_motivo: 'No se cierra el mes: 2 no han llegado a Diez.',
      faltaba: [{ codigo: 'asientos', n: 3 }], resumen: { por_tipo: [{ tipo: 'ventas', n: 85 }] },
      detalle: [{ entry_id: 'e1', numero: 1901, motivo: 'Diez dice; «no»' }],
      cuadre: { cuadra: false, diferencias: [{ cuenta: '43000002', nombre: 'Clientes', sumied: { debe: 110, haber: 0 }, diez: { debe: 60, haber: 0 }, falta_debe: 50, falta_haber: 0 }], solo_en_diez: [{ cuenta: '62900000', debe: 25, haber: 0 }] } })
    const csv = informe(rev(), t)
    expect(csv).toContain('Traspaso a Diez;octubre de 2026')
    expect(csv).toContain('Confirmado por;Julio')
    expect(csv).toContain('Estado;Con fallos')
    expect(csv).toContain('Han llegado;118')
    expect(csv).toContain('No han llegado;2')
    expect(csv).toContain('Cuadre con Diez;No cuadra')
    expect(csv).toContain('3 asientos del mes sin validar')
    expect(csv).toContain('Ventas;85')
    expect(csv).toContain('e1;1901;"Diez dice; «no»"')
    expect(csv).toContain('43000002;Clientes;110,00;0,00;60,00;0,00')
    expect(csv).toContain('62900000;;25,00;0,00')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
