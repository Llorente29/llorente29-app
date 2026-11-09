// G01 · Tarea 4. Lo que deciden las pantallas de Clientes y cuotas sin pintar.
import { describe, expect, it } from 'vitest'
import {
  CHIPS, comoResolver, queSeVe, contarChips, palabrasDeServicios, sinLinea, textoCobro, empleadosDe, fichaDe, figura, filtrarPorChip, filtrarPorEmisor, leerImporte, letrasDeServicios, mesesDesde, textoDiferencias,
  textoMandato, type ClienteGestoria, type Diferencia,
} from '@/modules/conta/gestoria/vista'
import type { Linea, Tarifa } from '../../../../../supabase/functions/conta-gocardless-leer/comparacion'

const A = 'emisor-a'
const B = 'emisor-b'
const dif = (tipo: Diferencia['tipo'], cliente: string | null, porque = 'porque'): Diferencia => ({ id: `${tipo}-${cliente}`, tipo, porque, clienteId: cliente, emisorId: A, gcClienteId: null })
const fila = (id: string, emisor: string, diferencias: Diferencia[] = []): ClienteGestoria => ({
  id: `${id}|${emisor}`, clienteId: id, nombre: `CLIENTE ${id}`, nif: null, emisorId: emisor, emisor, bitrix: null, formaCobro: 'gocardless', mandato: 'active', cobros: [], diferencias,
})
const linea = (id: string, servicio: string, extra: Partial<Linea> = {}): Linea => ({
  id, emisor: A, servicio, nombreServicio: servicio === 'gestion_laboral' ? 'Gestión laboral' : servicio === 'gestoria_mensual' ? 'Gestoría mensual' : 'Vigilancia',
  detalle: null, empleado: null, importePropioCent: null, periodo: 'mes', desde: '2026-01', hasta: null, suscripcionId: null, ...extra,
})

describe('G01 · Clientes y cuotas: lo que se decide sin pintar', () => {
  it('cada chip cuenta clientes (no diferencias) y filtra los suyos; fase 1, sin el de Laboral', () => {
    const filas = [fila('1', A, [dif('totales_distintos', '1'), dif('totales_distintos', '1')]), fila('2', A, [dif('falla_a_menudo', '2'), dif('totales_distintos', '2')]), fila('3', B)]
    const n = contarChips(filas)
    expect(n.totales).toBe(2)
    expect(n.fallan).toBe(1)
    expect(n['sin-cobro']).toBe(0)
    expect(CHIPS.map((c) => c.etiqueta)).toEqual([
      'En tu CRM sin cobro en GoCardless', 'En GoCardless sin ficha en tu CRM', 'Tu CRM y GoCardless no coinciden en el emisor',
      'Suscripción sin convertir en tarifa', 'Sumied y GoCardless no dan el mismo total', 'Mandato pendiente de firma', 'Fallan a menudo (3 o más en 6 meses)',
      // G01b · De la lectura del CRM.
      'Fichas repetidas en tu CRM', 'NIF de tu CRM que no se usa', 'Fichas de tu CRM sin guardar',
      // G01c · Los contactos.
      'Contacto con solo una negociación', 'Contacto con empresa y con datos de cliente',
      // G01c · PR B.
      'Ya no es cliente en tu CRM',
      // G05 · nº 33: los códigos del programa anterior.
      'Falta su código de cliente'])
    expect(filtrarPorChip(filas, 'fallan').map((f) => f.clienteId)).toEqual(['2'])
    expect(filtrarPorChip(filas, null)).toHaveLength(3)
    expect(filtrarPorEmisor(filas, B).map((f) => f.clienteId)).toEqual(['3'])
    expect(filtrarPorEmisor(filas, null)).toHaveLength(3)
  })

  it('las letras, la figura, los empleados y el mandato en palabras de oficina', () => {
    expect(letrasDeServicios([linea('a', 'gestion_laboral'), linea('b', 'vigilancia'), linea('c', 'gestoria_mensual')])).toEqual(['C', 'L', 'S'])
    expect([figura('B00000001'), figura('00000001R'), figura('X0000000T'), figura(null)]).toEqual(['Sociedad', 'Autónomo', 'Autónomo', null])
    expect(empleadosDe([linea('a', 'gestion_laboral', { empleado: 'EMPLEADA UNO' }), linea('b', 'gestion_laboral', { empleado: 'EMPLEADO DOS', hasta: '2026-10' })], '2026-11')).toBe(1)
    expect(textoMandato('pending_customer_approval').texto).toBe('Por firmar')
    expect([textoCobro('paid_out').texto, textoCobro('submitted').texto, textoCobro('charged_back').texto, textoCobro('failed').texto]).toEqual(['Cobrado', 'Pendiente', 'Devuelto', 'Devuelto'])
    expect(palabrasDeServicios([linea('a', 'gestion_laboral'), linea('c', 'gestoria_mensual')])).toBe('Contabilidad, Laboral')
    expect(comoResolver(dif('totales_distintos', '1'))).toEqual(['linea_o_baja', 'revisada'])
    expect(comoResolver(dif('gocardless_sin_ficha', null))).toEqual(['enlazar', 'revisada'])
    expect(comoResolver(dif('falla_a_menudo', '1'))).toEqual(['revisada'])
    expect(sinLinea([{ id: 'SB1', emisor: A, nombre: 'x', alMesCent: 1 }, { id: 'SB9', emisor: A, nombre: 'y', alMesCent: 1 }], [linea('g', 'gestoria_mensual', { suscripcionId: 'SB1' })], A).map((x) => x.id)).toEqual(['SB9'])
    expect(textoMandato(null).texto).toBe('Sin mandato')
    expect(textoDiferencias([])).toBe('Ninguna')
    expect(textoDiferencias([dif('mandato_por_firmar', '1')])).toBe('Mandato pendiente de firma')
  })

  it('la ficha: cada empleado con su tarifa, el total y la diferencia con GoCardless en palabras', () => {
    const tarifas: Tarifa[] = [
      { emisor: A, servicio: 'gestion_laboral', clienteId: null, importeCent: 2420, periodo: 'mes', desde: '2026-01', hasta: null },
      { emisor: A, servicio: 'gestoria_mensual', clienteId: '1', importeCent: 6050, periodo: 'mes', desde: '2026-01', hasta: null },
    ]
    const lineas = [linea('g', 'gestoria_mensual', { suscripcionId: 'SB1' }), linea('l1', 'gestion_laboral', { empleado: 'EMPLEADA UNO', suscripcionId: 'SB2' }), linea('l2', 'gestion_laboral', { empleado: 'EMPLEADO DOS' })]
    const f = fichaDe('1', A, '2026-11', lineas, tarifas, [{ id: 'SB1', emisor: A, nombre: 'GESTORIA MENSUAL', alMesCent: 6050 }, { id: 'SB2', emisor: A, nombre: 'GESTION LABORAL EMPLEADA UNO', alMesCent: 2420 }])
    const laboral = f.servicios.find((s) => s.servicio === 'gestion_laboral')!
    expect(laboral.tarifa).toBe('24,20 € al mes · tarifa general')
    expect(laboral.filas).toEqual([{ lineaId: 'l1', texto: 'EMPLEADA UNO', importe: '24,20 €' }, { lineaId: 'l2', texto: 'EMPLEADO DOS', importe: '24,20 €' }])
    expect(laboral.total).toBe('48,40 €')
    // El fijo, una sola fila: sin repetir la línea.
    const fijo = f.servicios.find((s) => s.servicio === 'gestoria_mensual')!
    expect([fijo.tarifa, fijo.filas, fijo.total]).toEqual(['60,50 € al mes · tarifa propia', [], '60,50 €'])
    expect(f.comparacion.sumiedCent).toBe(10890)
    expect(f.diferencia[0]).toBe('Sumied 108,90 € y GoCardless 84,70 € al mes: Sumied 24,20 € más.')
    const cuadra = fichaDe('1', A, '2026-11', lineas.slice(0, 2), tarifas, [{ id: 'SB1', emisor: A, nombre: 'x', alMesCent: 6050 }, { id: 'SB2', emisor: A, nombre: 'y', alMesCent: 2420 }])
    expect(cuadra.diferencia).toEqual(['Cuadra con GoCardless: 84,70 € al mes en los dos.'])
  })

  it('se adapta a lo conectado: sin GoCardless no sale lo suyo; sin Bitrix24, tampoco lo que los cruza', () => {
    const todo = queSeVe({ gocardless: new Set([A, B]), bitrix: true }, null, [A, B])
    expect([todo.gocardless, todo.bitrix, todo.chips.length, todo.sinGocardless]).toEqual([true, true, 14, []])
    const soloGc = queSeVe({ gocardless: new Set([A]), bitrix: false }, null, [A, B])
    expect([soloGc.gocardless, soloGc.bitrix, soloGc.chips, soloGc.sinGocardless]).toEqual([true, false, ['sin-convertir', 'totales', 'por-firmar', 'fallan', 'sin-codigo'], [B]])
    const deB = queSeVe({ gocardless: new Set([A]), bitrix: true }, B, [A, B])
    // G01b · Lo del CRM solo pide el CRM (G01c: también los dos de los contactos).
    expect([deB.gocardless, deB.bitrix, deB.chips]).toEqual([false, true, ['repetidas', 'sin-nif', 'no-guardada', 'contacto-negociacion', 'contacto-con-datos', 'ya-no-es-cliente']])
    expect(queSeVe({ gocardless: new Set(), bitrix: false }, null, [A, B]).chips).toEqual([])
  })

  it('las tarifas: los meses que se eligen y el importe con coma', () => {
    expect(mesesDesde('2026-11', 3)).toEqual([
      { valor: '2026-11-01', texto: 'noviembre de 2026' }, { valor: '2026-12-01', texto: 'diciembre de 2026' }, { valor: '2027-01-01', texto: 'enero de 2027' }])
    expect([leerImporte('24,20'), leerImporte('1.234,5'), leerImporte('24.20'), leerImporte('veinte'), leerImporte('-3')]).toEqual([24.2, 1234.5, 24.2, null, null])
  })
})
