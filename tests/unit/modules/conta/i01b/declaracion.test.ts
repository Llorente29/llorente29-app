// tests/unit/modules/conta/i01b/declaracion.test.ts
//
// I01b · P2 · El núcleo del IVA de un periodo. Las cifras del 2T de 2026 de
// Foodint son las del 303 que presentó (casillas [06], [27], [29], [45], [71]
// del justificante; regla 31), y el 1T, el anterior, también. El certificado y
// la cuenta son de mentira.

import { describe, expect, it } from 'vitest'
import {
  botonPresentar, comparacion, deDondeSale, lineaPlazos, pasos, sePuedeDomiciliar, siguientePaso, textoConfirmar, textoPago, tituloIva,
  vistaComprobacion, type Comprobacion, type DeclaracionVer, type Puerta,
} from '@/modules/conta/impuestos/declaracion'

const CERRADA: Puerta = { abierta: false, entorno: 'cerrada', mensaje: 'Todavía no se presenta desde Sumied: la conexión con Hacienda no está abierta. No se ha enviado nada.' }
const DOBLE: Puerta = { abierta: true, entorno: 'doble', mensaje: 'Estás en pruebas.' }
const ok = (clave: string): Comprobacion => ({ id: clave, clave, resultado: 'ok', titulo: clave, detalle: {}, aceptada_por: null, aceptada_el: null, motivo: null })

// El 2T de 2026 de Foodint: [06] 17.293,63 · [27] 17.293,63 · [29] 16.646,35 · [45] 16.646,35 · [71] 647,28 a pagar
// (con [110] 4.443,45 y [78] 647,28 compensados, el [71] presentado fue 0; aquí, el caso sin compensar, a pagar).
const base = (o: Partial<DeclaracionVer> = {}, r: Partial<NonNullable<DeclaracionVer['declaracion']>> = {}): DeclaracionVer => ({
  hoy: '2026-07-10', ejercicio: 2026, periodo: '2T', desde: '2026-04-01', hasta: '2026-06-30', presenta_303: true, cadencia: 'quarterly',
  presentacion: '2026-07-20', domiciliacion: '2026-07-15', provisional: null, puede_gestionar: true,
  declaracion: {
    id: 'r', estado: 'draft', estado_texto: 'Borrador', resultado: 'to_pay', importe: 647.28, pago: null, pago_cuenta: null, pago_cuenta_final: null,
    calculada: '2026-07-01', revisada: null, revisada_por: null, presentada: null, presentada_por: null, por: null, quien_presenta: null,
    csv: null, justificante: null, justificante_pdf: null, liquidacion: null, pago_asiento: null, casado: null, ...r,
  },
  casillas: [
    { casilla: '04', valor: 172936.3, texto: null, origen: 'calculated', motivo: null },
    { casilla: '06', valor: 17293.63, texto: null, origen: 'calculated', motivo: null },
    { casilla: '27', valor: 17293.63, texto: null, origen: 'calculated', motivo: null },
    { casilla: '29', valor: 16646.35, texto: null, origen: 'calculated', motivo: null },
    { casilla: '45', valor: 16646.35, texto: null, origen: 'calculated', motivo: null },
    { casilla: '71', valor: 647.28, texto: null, origen: 'calculated', motivo: null },
  ],
  comprobaciones: [ok('book_vs_303'), ok('ledger_477_472')],
  libros: { issued: 214, received: 180, investment: 6 },
  // El 1T de 2026 de Foodint: [27] 15.878,78 · [45] 18.012,96 · [71] −2.134,18 (a compensar).
  anterior: { ejercicio: 2026, periodo: '1T', estado: 'filed', resultado: 'to_offset', importe: 2134.18, c27: 15878.78, c45: 18012.96 },
  presentador: { modo: 'company', consentida: false, certificado: { id: 'c', nombre: 'EMPRESA DE PRUEBA SL', caduca: '2027-03-14', estado: 'active', probado: null, prueba: null }, puedo_presentar: true },
  bancos: [{ id: 'b', nombre: 'Banco de prueba', final: '4821' }],
  registro: [],
  ...o,
})

describe('títulos y plazos', () => {
  it('los tres niveles; el sitio no cambia', () => {
    expect([tituloIva(base(), 'sin_experiencia'), tituloIva(base(), 'medio'), tituloIva(base(), 'experto')])
      .toEqual(['IVA del 2.º trimestre (modelo 303)', 'IVA del 2.º trimestre', '303 · 2T 2026'])
  })
  it('las dos fechas, según se domicilie', () => {
    expect(lineaPlazos(base())).toBe('modelo 303 · hasta el 20/07 (domiciliado, el 15/07)')
    expect(lineaPlazos(base({}, { pago: 'direct_debit', pago_cuenta_final: '4821' }))).toBe('modelo 303 · domiciliado: hasta el 15/07 (sin domiciliar, el 20/07)')
  })
})

describe('los pasos en fila', () => {
  it('borrador: Calculado hecho, Revisar ahora', () => {
    expect(pasos(base()).map((p) => `${p.texto}:${p.estado}`)).toEqual(['Calculado:hecho', 'Revisar:ahora', 'Presentar:luego', 'Contabilizar:luego', 'Pagar:luego'])
  })
  it('contabilizado y a compensar: el último paso es «A compensar»', () => {
    expect(pasos(base({}, { estado: 'offset', resultado: 'to_offset' })).map((p) => p.texto)).toEqual(['Calculado', 'Revisado', 'Presentado', 'Contabilizado', 'A compensar'])
  })
})

describe('el resultado y de dónde sale', () => {
  it('la comparación con el 1T, con los números de Foodint', () => {
    expect(comparacion(base())).toBe('1.er trimestre: 2.134,18 € a compensar · +2.781,46 € (+130,3 %), porque el IVA de tus ventas ha subido un 9 % y el de tus compras ha bajado un 8 %')
  })
  it('sin el anterior calculado aquí, se dice', () => {
    expect(comparacion(base({ anterior: null }))).toBe('Del periodo anterior no hay nada calculado aquí con que compararlo.')
  })
  it('lo cobrado (con su tramo y su libro), lo pagado y el resultado', () => {
    const l = deDondeSale(base())
    expect(l.map((x) => [x.titulo, x.detalle, x.apuntes, x.importe])).toEqual([
      ['IVA que has cobrado en tus ventas', '10 %: base 172.936,30 €', 214, 17293.63],
      ['IVA que has pagado en tus compras y gastos', 'gastos corrientes 16.646,35 €', 186, -16646.35],
      ['A pagar', '', null, 647.28],
    ])
  })
})

describe('lo comprobado', () => {
  it('un aviso sin dar por bueno se puede aceptar; aceptado, dice quién y por qué', () => {
    const c: Comprobacion = { ...ok('out_of_period'), resultado: 'warning', titulo: '1 factura de un proveedor con fecha del 30/09 llegó el 03/10' }
    expect(vistaComprobacion(c)).toMatchObject({ marca: '!', sePuedeAceptar: true, aceptada: null })
    expect(vistaComprobacion({ ...c, aceptada_por: 'Julio', aceptada_el: '2026-10-09T10:00:00Z', motivo: 'va en este trimestre' }))
      .toMatchObject({ sePuedeAceptar: false, aceptada: 'Julio la dio por buena el 09/10: va en este trimestre' })
  })
})

describe('el botón de presentar: nunca calla por qué no presenta', () => {
  it('con la puerta cerrada, dice por qué y qué hacer mientras', () => {
    const b = botonPresentar(base(), CERRADA)
    expect(b.activo).toBe(false)
    expect(b.texto).toBe('Presentar 647,28 €')
    expect(b.porque).toContain('la conexión con Hacienda no está abierta')
    expect(b.porque).toContain('Ya lo presenté fuera')
  })
  it('cada cosa que lo impide, con su frase', () => {
    expect(botonPresentar(base({ declaracion: null }), DOBLE).porque).toBe('Primero hay que calcularlo con tus libros.')
    expect(botonPresentar(base({ comprobaciones: [{ ...ok('book_vs_303'), resultado: 'error' }] }), DOBLE).porque).toContain('Sumied todavía no sabe declarar')
    expect(botonPresentar(base({ comprobaciones: [{ ...ok('out_of_period'), resultado: 'warning' }] }), DOBLE).porque).toContain('el aviso')
    expect(botonPresentar(base({ presentador: { ...base().presentador, certificado: null } }), DOBLE).porque).toContain('Certificados y accesos')
    expect(botonPresentar(base({ presentador: { ...base().presentador, puedo_presentar: false } }), DOBLE).porque).toContain('No tienes permiso')
    expect(botonPresentar(base({ puede_gestionar: false }), DOBLE).activo).toBe(false)
    expect(botonPresentar(base(), null).porque).toBe('Comprobando la conexión con Hacienda…')
  })
  it('con la puerta de pruebas abierta, se puede, y dice que es de pruebas', () => {
    expect(botonPresentar(base(), DOBLE)).toEqual({ activo: true, texto: 'Presentar 647,28 €', porque: 'Estás en pruebas.' })
  })
  it('presentado, no se vuelve a presentar', () => {
    expect(botonPresentar(base({}, { estado: 'filed', por: 'outside' }), DOBLE)).toMatchObject({ activo: false, texto: 'Presentado fuera' })
  })
})

describe('el pago y la confirmación', () => {
  it('domiciliar se puede hasta el 15/07; el 16, ya no', () => {
    expect(sePuedeDomiciliar(base())).toBe(true)
    expect(sePuedeDomiciliar(base({ hoy: '2026-07-16' }))).toBe(false)
  })
  it('la frase del pago y la de la confirmación (enviar supone aceptar los datos)', () => {
    expect(textoPago(base({}, { pago: 'direct_debit', pago_cuenta_final: '4821' }))).toBe('Domiciliado en la cuenta ···· 4821. Hacienda lo carga el 20/07 y Sumied lo casa con el banco.')
    expect(textoConfirmar(base())).toBe('Vas a presentar a Hacienda el IVA del 2.º trimestre de 2026: 647,28 € a pagar. Sin domiciliar: lo pagas tú hasta el 20/07. Al enviarlo aceptas estos datos como tuyos.')
  })
  it('después de presentar: contabilizar, casar el cargo, o nada', () => {
    expect(siguientePaso(base({}, { estado: 'filed' }))).toBe('contabilizar')
    expect(siguientePaso(base({}, { estado: 'booked' }))).toBe('casar')
    expect(siguientePaso(base({}, { estado: 'paid' }))).toBe('nada')
  })
})
