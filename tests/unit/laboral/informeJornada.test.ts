// L1a · PR 2. El informe para la Inspección: lo que dice, en palabras, de cada
// día y de cada corrección (tablero 5), con un mes como el de la maqueta: un
// fichaje del móvil con su pausa, uno pasada la medianoche, una salida que
// añadió el encargado (y el trabajador no está de acuerdo), una petición
// aprobada, una marca anulada, un día de baja y un festivo.
import { describe, it, expect } from 'vitest'
import { armarInforme, hojaDeCalculo, periodoDelMes, textoOrigen, textoPeriodo, type DatosInforme, type MarcaInforme } from '../../../src/modules/personal/laboral/informeJornada'

const iso = (s: string) => new Date(s).toISOString()
const marca = (id: string, tipo: MarcaInforme['tipo'], hora: string, extra: Partial<MarcaInforme> = {}): MarcaInforme => ({
  id, tipo, hora: iso(hora), declarada: null, llegada: iso(hora), origen: 'movil', local: 'Alcalá',
  distancia_m: 30, dentro_del_radio: true, anulada: false, ...extra,
})

const DATOS: DatosInforme = {
  generado_at: iso('2026-10-28T09:00:00+01:00'),
  periodo: { desde: '2026-10-19', hasta: '2026-10-25' },
  empresa: { nombre: 'Empresa de Prueba, S.L.', cif: 'B00000000' },
  persona: { id: 'p1', nombre: 'Marcos Prueba', dni: '00000000T', puesto: 'Ayudante de cocina', local: 'Alcalá', tipo_contrato: 'Indefinido · tiempo parcial', horas_semana: 30, alta: '2025-03-03' },
  marcas: [
    // Lunes 19: baja (ausencia). Martes 20: festivo sin trabajar.
    // Jueves 22: móvil con pausa.
    marca('a1', 'entrada', '2026-10-22T18:58:00+02:00'),
    marca('a2', 'pausa_inicio', '2026-10-22T21:30:00+02:00'),
    marca('a3', 'pausa_fin', '2026-10-22T21:50:00+02:00'),
    marca('a4', 'salida', '2026-10-23T00:04:00+02:00'),
    // Viernes 23: sin cobertura, y fuera del radio a la salida.
    marca('b1', 'entrada', '2026-10-23T18:55:00+02:00', { declarada: iso('2026-10-23T18:55:00+02:00'), llegada: iso('2026-10-23T19:20:00+02:00') }),
    marca('b2', 'salida', '2026-10-24T01:10:00+02:00', { dentro_del_radio: false, distancia_m: 900 }),
    // Sábado 24: la salida la añadió el encargado; una entrada duplicada anulada.
    marca('c1', 'entrada', '2026-10-24T12:02:00+02:00'),
    marca('c0', 'entrada', '2026-10-24T12:03:00+02:00', { anulada: true }),
    marca('c2', 'salida', '2026-10-24T16:15:00+02:00', { origen: 'manual', local: 'Alcalá', distancia_m: null, dentro_del_radio: null }),
    // Domingo 25: lo antiguo, «kiosko», y una salida que pidió el trabajador.
    marca('d1', 'entrada', '2026-10-25T10:00:00+01:00', { origen: 'kiosko', local: null }),
    marca('d2', 'salida', '2026-10-25T14:00:00+01:00', { origen: 'manual', local: null }),
  ],
  cambios: [
    {
      id: 'x1', marca: 'c2', accion: 'create_manual', cuando: iso('2026-10-26T10:40:00+01:00'), quien: 'Laura', papel: 'manager',
      es_la_persona: false, motivo: 'No fichó la salida', antes: null,
      despues: { type: 'salida', real_datetime: iso('2026-10-24T16:15:00+02:00') },
      conformidad: 'desacuerdo', conformidad_at: iso('2026-10-26T12:00:00+01:00'), conformidad_nota: 'Salí a las 16:45', peticion: null,
    },
    {
      id: 'x2', marca: 'c0', accion: 'void', cuando: iso('2026-10-24T12:10:00+02:00'), quien: 'Laura', papel: 'manager',
      es_la_persona: false, motivo: 'Fichaje duplicado', antes: { type: 'entrada', real_datetime: iso('2026-10-24T12:03:00+02:00') },
      despues: { type: 'entrada', real_datetime: iso('2026-10-24T12:03:00+02:00') },
      conformidad: 'conforme', conformidad_at: iso('2026-10-24T13:00:00+02:00'), conformidad_nota: null, peticion: null,
    },
    {
      id: 'x3', marca: 'd2', accion: 'create_manual', cuando: iso('2026-10-26T10:40:00+01:00'), quien: 'Laura', papel: 'manager',
      es_la_persona: false, motivo: 'Me olvidé', antes: null, despues: { type: 'salida', real_datetime: iso('2026-10-25T14:00:00+01:00') },
      conformidad: null, conformidad_at: null, conformidad_nota: null,
      peticion: { pedida_at: iso('2026-10-26T10:12:00+01:00'), motivo: 'me olvidé', tipo: 'add' },
    },
  ],
  firmas: [],
  ausencias: [{ desde: '2026-10-19', hasta: '2026-10-19', tipo: 'ausente' }],
  festivos: [{ dia: '2026-10-20', nombre: 'Fiesta de la prueba' }],
}

const AHORA = new Date('2026-10-28T09:00:00+01:00')

describe('el informe del tablero 5', () => {
  const inf = armarInforme(DATOS, AHORA)
  const fila = (dia: string) => inf.filas.find(f => f.dia === dia)!

  it('constan todos los días, también los que no se trabajó, y dicen por qué', () => {
    expect(inf.filas.map(f => f.dia)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(fila('2026-10-19').sinJornada).toBe('Ausente')
    expect(fila('2026-10-20').sinJornada).toBe('Festivo · Fiesta de la prueba')
    expect(fila('2026-10-21').sinJornada).toBe('Libre')
  })

  it('un día con pausa: entrada, pausa, salida pasada la medianoche y el total', () => {
    const t = fila('2026-10-22').tramos[0]
    expect([t.entrada, t.pausas, t.salida, t.total]).toEqual(['18:58', '21:30–21:50', '00:04 (del 23)', '4 h 46'])
    expect(fila('2026-10-22').registro).toEqual(['Fichado desde el móvil en Alcalá'])
  })

  it('sin cobertura y fuera del radio: las dos horas y la distancia, en palabras', () => {
    expect(fila('2026-10-23').registro).toEqual([
      'Fichado desde el móvil en Alcalá · sin cobertura: hora del móvil 18:55, llegó a las 19:20',
      'Fichado desde el móvil en Alcalá · fuera del radio, a 900 m',
    ])
  })

  it('la salida que añadió el encargado: quién, cuándo, por qué y que el trabajador no está de acuerdo', () => {
    const f = fila('2026-10-24')
    expect(f.corregido).toBe(true)
    expect(f.enDesacuerdo).toBe(true)
    expect(f.registro).toContain('Salida añadida después (16:15) · el 26/10/2026 a las 10:40 por Laura (encargado) · motivo: «No fichó la salida» · EL TRABAJADOR NO ESTÁ DE ACUERDO (26/10/2026 a las 12:00): «Salí a las 16:45»')
    expect(f.registro).toContain('Entrada de las 12:03 anulada después · el 24/10/2026 a las 12:10 por Laura (encargado) · motivo: «Fichaje duplicado» · el trabajador está de acuerdo (24/10/2026 a las 13:00)')
    // La anulada no cuenta: 12:02 → 16:15.
    expect(f.tramos.map(t => t.total)).toEqual(['4 h 13'])
  })

  it('lo antiguo de Foodint, con su texto; y la petición aprobada, con quién la pidió', () => {
    const f = fila('2026-10-25')
    expect(f.registro[0]).toBe('Portal antiguo, sin ubicación: no se sabe si desde el móvil o la tablet')
    expect(f.registro).toContain('Salida añadida después (14:00) · la pidió el trabajador el 26/10/2026 a las 10:12 («me olvidé»), aprobada por Laura (encargado) el 26/10/2026 a las 10:40')
  })

  it('los totales de la semana, frente a las 30 h del contrato', () => {
    // 4 h 46 + 6 h 15 + 4 h 13 + 4 h 00 = 19 h 14.
    expect(inf.totales.total).toBe('19 h 14')
    expect(inf.totales.ordinarias).toBe('19 h 14')
    expect(inf.totales.extra).toBe('0')
    expect(inf.totales.corregidas).toBe('3 de 11')
  })

  it('sin firma, lo dice; y la ley, con el año hasta el que se guarda', () => {
    expect(inf.firma).toBe('Octubre de 2026: sin firmar por el trabajador.')
    expect(inf.ley).toMatch(/^Se guarda hasta octubre de 2030 \(Estatuto de los Trabajadores, art\. 34\.9\)\./)
  })

  it('sin códigos: ni ids ni nombres de columnas en lo que se lee', () => {
    const todo = JSON.stringify(inf.filas.map(f => f.registro))
    expect(todo).not.toMatch(/\b(a1|c2|x1|create_manual|void|manager|movil|kiosko)\b/)
  })
})

describe('el origen corregido (0732: «kiosko» que era el móvil)', () => {
  // La marca a1 venía como «kiosko» y tuvo GPS: la corrección de datos la pasó
  // a «movil» y dejó su fila «edit» en el rastro, que solo cambia el origen.
  const corregida = armarInforme({
    ...DATOS,
    marcas: DATOS.marcas.map(m => m.id === 'a1'
      ? { ...m, origen_corregido: { antes: 'kiosko', cuando: iso('2026-10-29T09:30:00+01:00'), motivo: 'Origen corregido: …' } }
      : m),
    cambios: [...DATOS.cambios, {
      id: 'x9', marca: 'a1', accion: 'edit', cuando: iso('2026-10-29T09:30:00+01:00'), quien: 'Corrección de datos (Folvy)', papel: null,
      es_la_persona: false, motivo: 'Origen corregido: …',
      antes: { type: 'entrada', real_datetime: iso('2026-10-22T18:58:00+02:00') },
      despues: { type: 'entrada', real_datetime: iso('2026-10-22T18:58:00+02:00') },
      conformidad: null, conformidad_at: null, conformidad_nota: null, peticion: null, solo_origen: true,
    }],
  }, AHORA)
  const dia = corregida.filas.find(f => f.dia === '2026-10-22')!

  it('se dice en la marca, con la fecha y de qué venía', () => {
    expect(dia.registro).toContain('Fichado desde el móvil en Alcalá · origen corregido el 29/10/2026 a las 09:30 (figuraba como «quiosco del portal antiguo»; la marca tuvo ubicación del móvil)')
  })
  it('no cuenta como corregida ni sale como «cambiada después»', () => {
    expect(dia.corregido).toBe(false)
    expect(dia.registro.join(' ')).not.toMatch(/cambiada después/)
    expect(corregida.totales.corregidas).toBe('3 de 11')
  })
  it('sin códigos', () => {
    expect(JSON.stringify(dia.registro)).not.toMatch(/\b(a1|x9|movil|kiosko|edit)\b/)
  })
})

describe('la firma en el informe', () => {
  it('firmada y vigente; o firmada y corregida después', () => {
    const vigente = armarInforme({ ...DATOS, firmas: [{ mes: '2026-10-01', firmado_at: iso('2026-11-02T09:12:00+01:00'), invalidada_at: null, invalidada_motivo: null, vigente: true }] }, AHORA)
    expect(vigente.firma).toBe('Octubre de 2026: firmado por el trabajador desde su portal el 02/11/2026 a las 09:12.')
    const corregida = armarInforme({ ...DATOS, firmas: [{ mes: '2026-10-01', firmado_at: iso('2026-11-02T09:12:00+01:00'), invalidada_at: iso('2026-11-03T10:00:00+01:00'), invalidada_motivo: 'x', vigente: false }] }, AHORA)
    expect(corregida.firma).toMatch(/pero se corrigió un fichaje después: falta que vuelva a firmar\.$/)
  })
})

describe('la hoja de cálculo', () => {
  it('con «;», BOM para Excel, una fila por tramo y los totales', () => {
    const csv = hojaDeCalculo(armarInforme(DATOS, AHORA))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Fecha;Día;Entrada;Pausas;Salida;Horas;Cómo se registró')
    expect(csv).toContain('22/10/2026;Jue 22;18:58;21:30–21:50;00:04 (del 23);4 h 46;Fichado desde el móvil en Alcalá')
    expect(csv).toContain('Total;19 h 14')
  })
})

describe('el periodo', () => {
  it('un mes entero se nombra; el mes en curso llega hasta hoy', () => {
    expect(textoPeriodo('2026-10-01', '2026-10-31')).toBe('octubre de 2026')
    expect(textoPeriodo('2026-10-01', '2026-10-15')).toBe('del 01/10/2026 al 15/10/2026')
    expect(periodoDelMes('2026-10', '2026-10-28')).toEqual({ desde: '2026-10-01', hasta: '2026-10-28' })
    expect(periodoDelMes('2026-09', '2026-10-28')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  })
  it('el origen de una tablet y el de una marca sin origen', () => {
    expect(textoOrigen({ ...DATOS.marcas[0], origen: 'tablet' })).toBe('Fichado en la tablet del local en Alcalá')
    expect(textoOrigen({ ...DATOS.marcas[0], origen: null })).toBe('Sin origen guardado')
  })
})
