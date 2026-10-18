// tests/unit/modules/conta/i01b/no_inventa.test.ts
//
// I01b · 0240 · El 303 no se inventa lo que no sabe. Con los TOTALES del 3T de
// 2026 de Foodint (regla 31; solo totales, nada que identifique):
//   · el borrador de la gestoría: [27] 9.855,66 · [45] 13.579,10 · [110] 3.796,17 ·
//     [78] 0 · [87] 3.796,17 · [71] −3.723,44 (a compensar);
//   · el diario del periodo: la 477 suma 9.857,47 y la 472, 13.578,25 (los dos
//     asientos de la serie 4 que la gestoría no lleva: +1,81 en la 477 y −0,85
//     en la 472);
//   · el libro de IVA del periodo, vacío en Sumied (aún sin traer de Diez):
//     lo que en producción salía «0,00 € · sin actividad».

import { describe, expect, it } from 'vitest'
import { vistaDeFila, type FilaCalendario } from '@/modules/conta/impuestos/calendario'
import {
  CASILLAS_JUSTIFICANTE, botonPresentar, cuadranCasillas, deDondeSale, fraseCalculo, libroVacio, noSeCalcula, pasos, pideJustificante, pideLa110,
  porQueNoFichero, type Comprobacion, type DeclaracionVer,
} from '@/modules/conta/impuestos/declaracion'

const GESTORIA = { '27': 9855.66, '45': 13579.1, '110': 3796.17, '78': 0, '87': 3796.17, '71': -3723.44 } as const

const comp = (clave: string, resultado: Comprobacion['resultado'], titulo: string, detalle: Record<string, unknown> = {}): Comprobacion =>
  ({ id: clave, clave, resultado, titulo, detalle, aceptada_por: null, aceptada_el: null, motivo: null })

const TITULO_VACIO = 'El libro de IVA de este periodo está vacío, pero el diario tiene IVA: la 477 suma 9.857,47 € y la 472, 13.578,25 €. Sin el libro, Sumied no calcula el 303: tráelo a Libros y vuelve a calcular. Si ya lo presentó tu asesoría, apúntalo con «Ya lo presenté fuera» y las casillas del justificante.'
const TITULO_110 = 'No sé lo que te quedó por compensar de antes: el 303 del 2T/2026 no está presentado en Sumied. Escríbelo en la casilla [110], aunque sea 0 (está en el justificante del 2T/2026, casilla [87], más el resultado si salió a compensar).'

const LIBRO_VACIO = comp('book_vs_303', 'error', TITULO_VACIO, {
  apuntes: 0, emitidas: 0, recibidas: 0,
  no_sabe: [{ motivo: 'libro_vacio', emitidas: 0, recibidas: 0, cuenta_477: 9857.47, cuenta_472: 13578.25, texto: TITULO_VACIO }],
})
const SIN_110 = comp('previous_offset', 'error', TITULO_110, { casilla_110: null, periodo_anterior: '2T/2026', a_mano: false })

/** El 3T de Foodint tal como lo deja la 0240 recalculado sin el libro: sin resultado y sin casillas. */
const tercero = (o: Partial<DeclaracionVer> = {}, r: Partial<NonNullable<DeclaracionVer['declaracion']>> = {}): DeclaracionVer => ({
  hoy: '2026-10-18', ejercicio: 2026, periodo: '3T', desde: '2026-07-01', hasta: '2026-09-30', presenta_303: true, cadencia: 'quarterly',
  presentacion: '2026-10-20', domiciliacion: '2026-10-15', provisional: null, puede_gestionar: true,
  declaracion: {
    id: 'r3', estado: 'draft', estado_texto: 'Borrador', resultado: null, importe: null, pago: null, pago_cuenta: null, pago_cuenta_final: null,
    calculada: '2026-10-18', revisada: null, revisada_por: null, presentada: null, presentada_por: null, por: null, quien_presenta: null,
    csv: null, justificante: null, justificante_pdf: null, liquidacion: null, pago_asiento: null, casado: null, ...r,
  },
  casillas: [],
  comprobaciones: [LIBRO_VACIO, comp('out_of_period', 'ok', 'Ninguna factura de otro periodo.'), comp('mail_invoices_missing', 'ok', 'No falta ninguna.'), SIN_110],
  libros: {},
  anterior: null,
  presentador: { modo: 'company', consentida: false, certificado: { id: 'c', nombre: 'EMPRESA DE PRUEBA SL', caduca: '2027-03-14', estado: 'active', probado: null, prueba: null }, puedo_presentar: true },
  bancos: [],
  registro: [],
  ...o,
})

describe('sin el libro de IVA no hay resultado, y se dice', () => {
  it('«No se puede calcular todavía» con los dos porqués, en vez de 0,00 € sin actividad', () => {
    expect(noSeCalcula(tercero())).toEqual({ titulo: 'No se puede calcular todavía', porque: [TITULO_VACIO, TITULO_110] })
    expect(libroVacio(tercero())).toBe(true)
    expect(deDondeSale(tercero())).toEqual([])
  })
  it('«Calcular» no sale hecho: es lo que toca', () => {
    expect(pasos(tercero()).map((p) => `${p.texto}:${p.estado}`).slice(0, 2)).toEqual(['Calcular:ahora', 'Revisar:luego'])
  })
  it('el botón de presentar dice que falta el libro y qué hacer mientras', () => {
    expect(botonPresentar(tercero(), null)).toEqual({
      activo: false, texto: 'Presentar',
      porque: 'Sin el libro de IVA del periodo, Sumied no lo calcula: tráelo a Libros y vuelve a calcular. Si ya lo presentó tu asesoría, apúntalo con «Ya lo presenté fuera» y las casillas del justificante.',
    })
  })
  it('el fichero oficial no sale, y dice por qué', () => {
    expect(porQueNoFichero(tercero())).toBe('El fichero oficial sale cuando no quede nada en rojo en «Lo que ha comprobado Sumied».')
  })
  it('«Ya lo presenté fuera» pide las seis casillas del justificante', () => {
    expect(pideJustificante(tercero())).toBe(true)
    expect([...CASILLAS_JUSTIFICANTE]).toEqual(['27', '45', '110', '78', '87', '71'])
  })
  it('lo que dice el botón de calcular cuando no hay resultado', () => {
    expect(fraseCalculo({ apuntes: 0, resultado: null, importe: null, sabido: false }))
      .toBe('Calculado con 0 apuntes del libro de IVA, pero todavía no se puede saber el resultado: mira por qué en «Lo que ha comprobado Sumied».')
    expect(fraseCalculo({ apuntes: 2287, resultado: 'to_offset', importe: 3723.44, sabido: true }, 'Vuelto a calcular'))
      .toBe('Vuelto a calcular con 2287 apuntes del libro de IVA: 3.723,44 € a compensar.')
  })
})

describe('la [110] no se da por 0', () => {
  it('se pide en error, no como aviso que se pueda dar por bueno', () => {
    expect(pideLa110(SIN_110)).toBe(true)
    expect(pideLa110(comp('previous_offset', 'ok', 'Lo escribió una persona: 3.796,17 €.'))).toBe(false)
  })
  it('con el libro ya traído, el botón pide la [110] y nada más', () => {
    const d = tercero({ comprobaciones: [comp('book_vs_303', 'ok', 'Las 2287 facturas…'), comp('ledger_477_472', 'ok', '…'), SIN_110] }, { resultado: 'to_offset', importe: 3723.44 })
    expect(botonPresentar(d, null).porque).toBe('Falta lo que te quedaba por compensar de antes: escríbelo en la casilla [110], en «Lo que ha comprobado Sumied», aunque sea 0.')
  })
})

describe('las casillas del justificante cuadran como en el modelo', () => {
  it('las de la gestoría del 3T cuadran: 9.855,66 − 13.579,10 − 0 = −3.723,44 y 3.796,17 − 0 = 3.796,17', () => {
    expect(cuadranCasillas(GESTORIA)).toBeNull()
  })
  it('una que falta, se dice cuál', () => {
    expect(cuadranCasillas({ ...GESTORIA, '87': null })).toBe('Faltan [87]: están en el justificante (si una sale en blanco, escribe 0).')
  })
  it('el resultado del DIARIO (−3.720,78) no pasa por el de la gestoría: no cuadra con sus [27] y [45]', () => {
    expect(cuadranCasillas({ ...GESTORIA, '71': -3720.78 }))
      .toBe('No cuadran: [27] − [45] − [78] da −3.723,44 €, y la [71] dice −3.720,78 €. Mira el justificante otra vez.')
  })
  it('la [87] tiene que ser [110] − [78], y las de compensar no son negativas', () => {
    expect(cuadranCasillas({ ...GESTORIA, '87': 0 })).toBe('No cuadran: [110] − [78] da 3.796,17 €, y la [87] dice 0,00 €. Mira el justificante otra vez.')
    expect(cuadranCasillas({ ...GESTORIA, '110': -3796.17 })).toBe('La [110] no puede ser negativa: son cuotas a compensar.')
  })
})

describe('un aviso sin mirar tampoco deja bajar el fichero', () => {
  it('con un aviso abierto, lo dice; dado por bueno, sale', () => {
    const aviso = comp('ledger_477_472', 'warning', 'El diario no dice lo mismo que el 303: la 477 suma 9.857,47 € frente a 9.855,66 €…')
    const d = tercero({ comprobaciones: [comp('book_vs_303', 'ok', '…'), aviso, comp('previous_offset', 'ok', '…')] }, { resultado: 'to_offset', importe: 3723.44 })
    expect(porQueNoFichero(d)).toBe('El fichero oficial sale cuando des por bueno el aviso de «Lo que ha comprobado Sumied».')
    const aceptado = tercero({ comprobaciones: [comp('book_vs_303', 'ok', '…'), { ...aviso, aceptada_el: '2026-10-18', aceptada_por: 'Julio', motivo: 'los dos asientos de la serie 4' }, comp('previous_offset', 'ok', '…')] },
      { resultado: 'to_offset', importe: 3723.44 })
    expect(porQueNoFichero(aceptado)).toBeNull()
  })
})

describe('en el calendario, «No se puede calcular» en vez de una cifra', () => {
  it('el chip lo dice y la acción lleva al porqué', () => {
    const f: FilaCalendario = {
      obligacion: 'o', modelo: '303', nombre: 'IVA', cadencia: 'quarterly', ejercicio: 2026, periodo: '3T', presentacion: '2026-10-20', domiciliacion: '2026-10-15',
      provisional: null, atrasado: false, domicilia: false, cuenta_final: null, se_calcula: true,
      declaracion: { id: 'r3', estado: 'draft', estado_texto: 'Borrador', resultado: null, importe: null, anterior: null, no_hace_falta: null,
        presentada: null, por: null, errores: 2, avisos: 0, aviso: TITULO_VACIO, cuadra: false },
    } as FilaCalendario
    const v = vistaDeFila(f)
    expect(v.chip).toEqual({ tono: 'falta', texto: 'No se puede calcular' })
    expect([v.aviso, v.textoAccion, v.ambar]).toEqual([TITULO_VACIO, 'Ver el aviso', true])
  })
})
