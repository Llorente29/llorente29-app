// tests/unit/modules/conta/s02/ficha-recibida.test.ts
//
// La ficha de la recibida completa (encargo «Para D · ficha de la recibida
// completa», tablero 3b): el núcleo puro (documentos/fichaRecibida.ts).
//
// Regla 31: la población son recibidas REALES de Foodint (account_id
// 51ad1792-…, leídas en producción el 23/10 con SELECT): sus líneas, sus
// filas de supplier_invoice_tax si las tienen y la base, el IVA y el total de
// su cabecera. Las cuentas, las de su plan (company_account_link de la empresa
// 658728c0-…): 47200004 / 47200010 / 47200021, 60000000 y 40000007.
//   · COHELDI P26 4.980 (d6913598-…): 127,40 al 4 % y 13,50 + 122,76 al 10 %,
//     sin filas de impuesto. Hoy salía «Tipo de IVA: —».
//   · OLIMPO GOURMET 26/13028 (37060996-…): 4 % y 10 % mezclados en 4 líneas.
//   · EUROPASTRY 24075676 (b4719484-…): un solo tipo.
//   · Orange S11/0177416578 (9a87fa22-…): líneas con 4 decimales; sumadas al
//     céntimo como el asiento dan 1 céntimo más que el PDF.
//   · PORTIER EATS, liquidación (19f53174-…): su IVA en supplier_invoice_tax
//     (9,34), que NO es el de sus líneas por el tipo (9,33): manda la fila.

import { describe, expect, it } from 'vitest'
import { aplicarAsientoAMano, aplicarReparto, lineasYCuotas } from '@/modules/conta/lib/recibidaGuardada'
import type { Propuesta } from '@/modules/conta/lib/libro'
import {
  COMO_SE_GUARDA, ETIQUETAS, SIN_LA_TANDA, aManoDeLoGuardado, asientoAManoParaGuardar, asientoVistaPrevia, borradorDe, cambiosParaLaBase, comprobarAMano, lineasConMasDecimales, recargoPorTipo, contraElPdf, cuadraElGasto, cuentasDeLaPropuesta, deDondeVino, formatoCampo,
  gastosConImporte, historialDe, otroTipo, papelDeLaLectura, partirCambios, rehacerCuota, textoDelGuardado, tiposDeFactura, totalesDe, type BorradorFicha,
  type DatosParaBorrador,
} from '@/modules/conta/documentos/fichaRecibida'

type Real = DatosParaBorrador & { id: string }
const sinMas = { proveedorId: 'p', numero: 'n', fecha: '2026-10-19', vence: null, retencion: null, recargo: null, gasto: '60000000', local: null, formaPago: null, pagada: false }

const COHELDI: Real = {
  ...sinMas, id: 'd6913598-9f52-4d43-8860-eddff2a6d436', numero: 'P26 4.980', local: '38158159-cd71-4056-950b-53425afac1ce',
  tipos: [], lineas: [{ importe: 127.4, iva: 4 }, { importe: 13.5, iva: 10 }, { importe: 122.76, iva: 10 }], base: 263.66, cuota: 18.73,
}
const PDF_COHELDI = { base: 263.66, iva: 18.73, total: 282.39 }
const OLIMPO: Real = {
  ...sinMas, id: '37060996-e406-4046-9a5d-c45bf94a260c', tipos: [],
  lineas: [{ importe: 37.2, iva: 10 }, { importe: 56.88, iva: 10 }, { importe: 211.2, iva: 4 }, { importe: 36.85, iva: 10 }], base: 342.13, cuota: 21.54,
}
const EUROPASTRY: Real = { ...sinMas, id: 'b4719484-4b82-48cc-8cee-0cca6250a30c', tipos: [], lineas: [{ importe: 134.38, iva: 10 }], base: 134.38, cuota: 13.44 }
const ORANGE: Real = {
  ...sinMas, id: '9a87fa22-fbc7-471b-bf1d-a88c856259ea', tipos: [], lineas: [{ importe: 21.4463, iva: 21 }, { importe: 7.438, iva: 21 }, { importe: 0, iva: 21 }], base: 28.8843, cuota: 6.0657,
}
const PORTIER: Real = {
  ...sinMas, id: '19f53174-e4bf-4d5d-9054-3b81922accab', tipos: [{ tipo: 21, base: 44.45, cuota: 9.34, recargo: 0 }],
  lineas: [{ importe: 25.85, iva: 21 }, { importe: 18.6, iva: 21 }], base: 44.45, cuota: 9.34,
}

const CUENTAS_FOODINT = new Map([['47200004', 'IVA soportado 4 %'], ['47200010', 'IVA soportado 10 %'], ['47200021', 'IVA soportado 21 %'], ['60000000', 'Compras de mercaderías'], ['40000007', 'Proveedores · COHELDI, S.L.']])
const nombre = (c: string) => CUENTAS_FOODINT.get(c) ?? 'Cuenta'
/** La propuesta de la COHELDI tal como la arma facturaProveedor (lib/asientosPropuestos) con su plan. */
const PROPUESTA_COHELDI = [
  { cuenta: '60000000', debe: 263.66, haber: 0 },
  { cuenta: '47200004', debe: 5.1, haber: 0, iva: { tipo: 4 } },
  { cuenta: '47200010', debe: 13.63, haber: 0, iva: { tipo: 10 } },
  { cuenta: '40000007', debe: 0, haber: 282.39 },
]

describe('los importes por tipo de IVA, de lo guardado', () => {
  it('COHELDI: el 4 % y el 10 % salen de sus líneas (no tiene filas de impuesto): ya no «Tipo de IVA: —»', () => {
    expect(tiposDeFactura(COHELDI)).toEqual([{ tipo: 4, base: 127.4, cuota: 5.1 }, { tipo: 10, base: 136.26, cuota: 13.63 }])
  })
  it('OLIMPO: cuatro líneas, dos tipos', () => {
    expect(tiposDeFactura(OLIMPO)).toEqual([{ tipo: 4, base: 211.2, cuota: 8.45 }, { tipo: 10, base: 130.93, cuota: 13.09 }])
  })
  it('PORTIER: manda supplier_invoice_tax (9,34), no la base de sus líneas por el tipo (9,33)', () => {
    expect(tiposDeFactura(PORTIER)).toEqual([{ tipo: 21, base: 44.45, cuota: 9.34 }])
    expect(tiposDeFactura({ ...PORTIER, tipos: [] })[0].cuota).toBe(9.33)
  })
  it('sin líneas con IVA: un tipo con la cabecera, y el tipo solo si sale exacto', () => {
    expect(tiposDeFactura({ tipos: [], lineas: [], base: 134.38, cuota: 13.44 })).toEqual([{ tipo: 10, base: 134.38, cuota: 13.44 }])
    expect(tiposDeFactura({ tipos: [], lineas: [], base: 263.66, cuota: 18.73 })).toEqual([{ tipo: null, base: 263.66, cuota: 18.73 }])
  })
})

describe('base, IVA y total contra el PDF', () => {
  it('COHELDI: «Igual que el PDF» (263,66 + 18,73 = 282,39)', () => {
    const t = totalesDe(borradorDe(COHELDI))
    expect([t.base, t.iva, t.total]).toEqual([263.66, 18.73, 282.39])
    expect(contraElPdf(t, PDF_COHELDI)).toEqual({ igual: true, texto: 'Igual que el PDF' })
  })
  it('OLIMPO y EUROPASTRY cuadran al céntimo', () => {
    expect(contraElPdf(totalesDe(borradorDe(OLIMPO)), { base: 342.13, iva: 21.54, total: 363.67 }).igual).toBe(true)
    expect(contraElPdf(totalesDe(borradorDe(EUROPASTRY)), { base: 134.38, iva: 13.44, total: 147.82 }).igual).toBe(true)
  })
  it('Orange: sus líneas al céntimo dan 34,96 y el PDF dice 34,95: «1 céntimo de redondeo» (sus líneas traen 4 decimales), en ámbar pero igual', () => {
    expect(lineasConMasDecimales(ORANGE.lineas)).toBe(true)
    expect(lineasConMasDecimales(COHELDI.lineas)).toBe(false)
    const c = contraElPdf(totalesDe(borradorDe(ORANGE)), { base: 28.8843, iva: 6.0657, total: 34.95 }, 'pdf', { masDecimales: true })
    expect(c).toMatchObject({ igual: true, redondeo: true })
    expect(c.texto).toMatch(/^1 céntimo de redondeo: sus líneas traen más de dos decimales \(el PDF dice 34,95\s€\)$/)
    // Sin líneas de más decimales, el mismo céntimo es una diferencia de verdad.
    const sin = contraElPdf(totalesDe(borradorDe(ORANGE)), { base: 28.8843, iva: 6.0657, total: 34.95 })
    expect(sin.igual).toBe(false)
    expect(sin.texto).toMatch(/^0,01\s€ más que el PDF \(34,95\s€\)$/)
    // Dos céntimos ya no son redondeo.
    expect(contraElPdf(totalesDe(borradorDe(ORANGE)), { base: 28.8843, iva: 6.0657, total: 34.94 }, 'pdf', { masDecimales: true }).igual).toBe(false)
  })
  it('cambiar un importe rehace la cuota y el total, y lo dice contra el PDF', () => {
    const b = borradorDe(COHELDI)
    const iva = [rehacerCuota({ ...b.iva[0], base: '130,00' }), b.iva[1]]
    expect(iva[0].cuota).toBe('5,20')
    const c = contraElPdf(totalesDe({ ...b, iva }), PDF_COHELDI)
    expect(c.igual).toBe(false)
    expect(c.texto).toMatch(/^2,70\s€ más que el PDF/)
  })
  it('lo que no es un importe se dice', () => {
    const b = borradorDe(COHELDI)
    expect(contraElPdf(totalesDe({ ...b, iva: [{ ...b.iva[0], base: '12,345' }, b.iva[1]] }), PDF_COHELDI).texto).toBe('No sé sumar: la base del 4 % no es un importe.')
  })
  it('«+ Otro tipo de IVA» propone el primero que no está; retención resta', () => {
    expect(otroTipo(borradorDe(COHELDI).iva).tipo).toBe('21')
    const t = totalesDe({ ...borradorDe(EUROPASTRY), retencion: { tipo: '15', importe: '20,16' } })
    expect(t.total).toBe(127.66)
  })
})

describe('el gasto', () => {
  it('una línea se lleva toda la base; al repartir, la vacía se lleva lo que falte', () => {
    expect(gastosConImporte([{ cuenta: '60000000', local: 'a', importe: '' }], 263.66)).toEqual([{ cuenta: '60000000', local: 'a', importe: 263.66, restoAutomatico: true }])
    const dos = [{ cuenta: '60000000', local: 'a', importe: '200,00' }, { cuenta: '60000000', local: 'b', importe: '' }]
    expect(gastosConImporte(dos, 263.66).map((g) => g.importe)).toEqual([200, 63.66])
    expect(cuadraElGasto(dos, 263.66)).toBeNull()
    expect(cuadraElGasto([{ cuenta: '60000000', local: '', importe: '200,00' }, { cuenta: '60000000', local: '', importe: '50,00' }], 263.66)).toMatch(/^Faltan 13,66\s€ por repartir\.$/)
    expect(cuadraElGasto([{ cuenta: '', local: '', importe: '' }], 263.66)).toBe('Falta la cuenta de gasto.')
  })
})

describe('el asiento, como vista previa', () => {
  const cuentas = cuentasDeLaPropuesta(PROPUESTA_COHELDI, nombre)
  it('las cuentas salen de la propuesta: la 400 del proveedor y la 472 de cada tipo', () => {
    expect(cuentas.proveedor).toEqual({ codigo: '40000007', nombre: 'Proveedores · COHELDI, S.L.' })
    expect([...cuentas.iva.entries()]).toEqual([[4, { codigo: '47200004', nombre: 'IVA soportado 4 %' }], [10, { codigo: '47200010', nombre: 'IVA soportado 10 %' }]])
  })
  it('COHELDI sin cambios: el mismo asiento que la propuesta, debe arriba y haber debajo, y cuadra', () => {
    const a = asientoVistaPrevia(borradorDe(COHELDI), cuentas, nombre, () => 'Foodint Alcalá')
    expect(a.lineas.map((l) => [l.codigo, l.debe, l.haber])).toEqual([['60000000', 263.66, null], ['47200004', 5.1, null], ['47200010', 13.63, null], ['40000007', null, 282.39]])
    expect(PROPUESTA_COHELDI.map((l) => [l.cuenta, l.debe || null, l.haber || null])).toEqual(a.lineas.map((l) => [l.codigo, l.debe, l.haber]))
    expect(a.cuadra).toBe(true)
    expect(a.faltan).toEqual([])
    expect(a.lineas[0].local).toBe('Foodint Alcalá')
  })
  it('cambiar un importe rehace el asiento al momento, y sigue cuadrando', () => {
    const b = borradorDe(COHELDI)
    const a = asientoVistaPrevia({ ...b, iva: [rehacerCuota({ ...b.iva[0], base: '130,00' }), b.iva[1]] }, cuentas, nombre, () => null)
    expect(a.lineas.map((l) => [l.codigo, l.debe ?? l.haber])).toEqual([['60000000', 266.26], ['47200004', 5.2], ['47200010', 13.63], ['40000007', 285.09]])
    expect(a.cuadra).toBe(true)
  })
  it('un tipo sin su 472 sale sin código y lo dice; una cuenta cambiada a mano se marca', () => {
    const b = borradorDe(COHELDI)
    const a = asientoVistaPrevia({ ...b, iva: [...b.iva, { base: '10,00', tipo: '5', cuota: '0,50' }] }, cuentas, nombre, () => null)
    expect(a.faltan).toEqual(['la cuenta del IVA soportado al 5 %'])
    const m = asientoVistaPrevia({ ...b, aMano: { '60000000': '62900000' } }, cuentas, nombre, () => null)
    expect(m.lineas[0]).toMatchObject({ codigo: '62900000', aMano: true })
  })
  it('con retención: la 4751 al haber y el proveedor cobra el neto', () => {
    const b = { ...borradorDe(EUROPASTRY), retencion: { tipo: '15', importe: '20,16' } }
    const c = { proveedor: { codigo: '40000001', nombre: 'Proveedor' }, iva: new Map([[10, { codigo: '47200010', nombre: 'IVA soportado 10 %' }]]), retencion: { codigo: '47510000', nombre: 'Retenciones' } }
    const a = asientoVistaPrevia(b, c, nombre, () => null)
    expect(a.lineas.map((l) => [l.codigo, l.debe ?? -(l.haber ?? 0)])).toEqual([['60000000', 134.38], ['47200010', 13.44], ['47510000', -20.16], ['40000001', -127.66]])
    expect(a.cuadra).toBe(true)
  })
})

describe('qué se guarda y con qué (regla 8; contrato de la 0790)', () => {
  it('con la tanda, todo con su función salvo «Pagada» antes de validar; sin ella, solo el proveedor y el vencimiento', () => {
    expect(Object.keys(COMO_SE_GUARDA).sort()).toEqual(Object.keys(ETIQUETAS).sort())
    expect(Object.entries(COMO_SE_GUARDA).filter(([, c]) => 'falta' in c).map(([k]) => k)).toEqual(['estadoPago'])
    expect(new Set(Object.values(COMO_SE_GUARDA).flatMap((c) => ('con' in c ? [c.con] : [])))).toEqual(new Set(['conta_recibida_guardar', 'conta_recibida_papel_poner', 'conta_recibida_sin_papel']))
    expect(Object.entries(SIN_LA_TANDA).filter(([, c]) => 'con' in c).map(([k]) => k).sort()).toEqual(['proveedorId', 'vence'])
  })
  it('partir los cambios y decirlo con contenido', () => {
    const cambios = [{ campo: 'vence', etiqueta: 'Vence' }, { campo: 'iva', etiqueta: 'Importes por tipo de IVA' }, { campo: 'estadoPago', etiqueta: 'Estado del pago' }]
    expect(partirCambios(cambios).noHoy.map((c) => c.campo)).toEqual(['estadoPago'])
    const { noHoy } = partirCambios(cambios, false)
    expect(noHoy.map((c) => c.campo)).toEqual(['iva', 'estadoPago'])
    const t = textoDelGuardado({ hechos: ['Vence: 18/11/2026'], fallos: [], noHoy: noHoy.slice(0, 1) })
    expect(t.tono).toBe('falta')
    expect(t.texto).toMatch(/^Guardado: Vence: 18\/11\/2026\. Importes por tipo de IVA: no se puede guardar todavía — la base aún no tiene la función/)
    expect(textoDelGuardado({ hechos: ['Vence: 18/11/2026'], fallos: [], noHoy: [] })).toEqual({ tono: 'ok', texto: 'Guardado: Vence: 18/11/2026.' })
  })
  it('«Antes: …» se escribe en palabras', () => {
    const f = formatoCampo(() => 'COHELDI, S.L.', () => 'Foodint Alcalá')
    expect(f('vence', '2026-10-19')).toBe('19/10/2026')
    expect(f('iva', borradorDe(COHELDI).iva)).toBe('127,40 al 4 % + 136,26 al 10 %')
    expect(f('gastos', borradorDe(COHELDI).gastos)).toBe('60000000 · Foodint Alcalá')
  })
})

describe('p_cambios para conta_recibida_guardar (contrato final: una clave de más es un error 22023)', () => {
  const CLAVES = ['proveedor', 'numero', 'fecha', 'local', 'vence', 'forma_pago', 'iva', 'retencion', 'gasto', 'asiento_a_mano']
  const cuentas = cuentasDeLaPropuesta(PROPUESTA_COHELDI, nombre)
  it('solo lo cambiado, y solo claves del contrato', () => {
    const b = { ...borradorDe(COHELDI), vence: '2026-11-18', formaPago: 'transfer' }
    expect(cambiosParaLaBase(b, ['vence', 'formaPago'])).toEqual({ vence: '2026-11-18', forma_pago: 'transfer' })
    const todo = cambiosParaLaBase({ ...b, aMano: { '60000000': '62900000' } }, Object.keys(ETIQUETAS), { previa: asientoVistaPrevia(b, cuentas, nombre, () => null).lineas, comun: '' })
    for (const k of Object.keys(todo)) expect(CLAVES).toContain(k)
  })
  it('COHELDI: el IVA por tipo, sin recargo; el gasto con su local; el asiento a mano cuadrando', () => {
    const b = borradorDe(COHELDI)
    expect(cambiosParaLaBase(b, ['iva'])).toEqual({ iva: [{ tipo: 4, base: 127.4, cuota: 5.1 }, { tipo: 10, base: 136.26, cuota: 13.63 }] })
    expect(cambiosParaLaBase(b, ['gastos'])).toEqual({ gasto: [{ cuenta: '60000000', local: COHELDI.local, comun: false, importe: 263.66 }], local: COHELDI.local })
    const reparto = { ...b, gastos: [{ cuenta: '60000000', local: 'alcala', importe: '200,00' }, { cuenta: '62900000', local: '', importe: '' }] }
    expect(cambiosParaLaBase(reparto, ['gastos'])).toEqual({ gasto: [{ cuenta: '60000000', local: 'alcala', comun: false, importe: 200 }, { cuenta: '62900000', local: null, comun: true, importe: 63.66 }], local: null })
    const aMano = { ...b, aMano: { '60000000': '62900000' } }
    const x = cambiosParaLaBase(aMano, ['aMano'], { previa: asientoVistaPrevia(aMano, cuentas, nombre, () => null).lineas }).asiento_a_mano as { cuenta: string; debe: number; haber: number }[]
    expect(x.map((l) => l.cuenta)).toEqual(['62900000', '47200004', '47200010', '40000007'])
    expect(x.reduce((t, l) => t + Math.round(l.debe * 100) - Math.round(l.haber * 100), 0)).toBe(0)
    expect(cambiosParaLaBase(b, ['aMano'], { previa: [] })).toEqual({ asiento_a_mano: null })
  })
  it('el asiento a mano guardado vuelve a la ficha como «cuenta propuesta → elegida»', () => {
    const b = borradorDe(COHELDI)
    const previa = asientoVistaPrevia(b, cuentas, nombre, () => null).lineas
    const guardado = asientoAManoParaGuardar({ ...b, aMano: { '60000000': '62900000' } }, asientoVistaPrevia({ ...b, aMano: { '60000000': '62900000' } }, cuentas, nombre, () => null).lineas)
    expect(aManoDeLoGuardado(guardado, previa)).toEqual({ '60000000': '62900000' })
    expect(aManoDeLoGuardado(null, previa)).toEqual({})
  })
  it('la retención, con su tipo_id si es la de siempre; el recargo por tipo, cuadrando con lo escrito', () => {
    const b = { ...borradorDe(EUROPASTRY), retencion: { tipo: '15', importe: '20,16' } }
    expect(cambiosParaLaBase(b, ['retencion'], { retencionTipoId: 'r15' })).toEqual({ retencion: { tipo: 15, tipo_id: 'r15', base: 134.38, importe: 20.16 } })
    expect(recargoPorTipo(borradorDe(COHELDI).iva, { tipo: '', importe: '2,55' })).toEqual([{ tipo: 0.5, importe: 0.64 }, { tipo: 1.4, importe: 1.91 }])
    expect(recargoPorTipo(borradorDe(COHELDI).iva, { tipo: '', importe: '2,56' }).map((x) => x.importe)).toEqual([0.64, 1.92])
    const conRec = cambiosParaLaBase({ ...borradorDe(COHELDI), recargo: { tipo: '', importe: '2,55' } }, ['recargo']).iva as Record<string, unknown>[]
    expect(conRec[0]).toEqual({ tipo: 4, base: 127.4, cuota: 5.1, recargo_tipo: 0.5, recargo: 0.64 })
  })
})

describe('de dónde vino, sin inventar', () => {
  const coheldi = {
    fuente: 'ocr', canal: null,
    recepcion: { fecha: '2026-10-19', local: 'Foodint Alcalá', quien: 'Natacha del Valle Rondón ', cuando: '2026-10-19T11:27:40.096952+00:00' },
    lectura: { cuando: '2026-10-21T14:47:59.096853+00:00', archivo: '00-VR26102011251.pdf' },
    creada: { cuando: '2026-10-21T14:48:17.772811+00:00', quien: 'Julio' },
  }
  it('COHELDI: entró con la recepción del 19/10 en Foodint Alcalá, leída de su PDF', () => {
    expect(deDondeVino(coheldi)).toBe('Entró con la recepción del 19/10 en Foodint Alcalá · leída de su PDF')
  })
  it('«Escrita a mano» solo si lo es', () => {
    expect(deDondeVino({ ...coheldi, fuente: 'manual', recepcion: null, lectura: null })).toBe('Escrita a mano el 21/10 por Julio')
    expect(deDondeVino(coheldi)).not.toMatch(/mano/)
  })
  it('lo que cambió una persona (supplier_invoice_change), en palabras', () => {
    const h = historialDe({ ...coheldi, marca: 'Sumied', aprobada: null, venceCambiado: null, pagos: [], asiento: null, descartada: null,
      cambios: [{ cuando: '2026-10-23T09:00:00+00:00', quien: 'Julio', que: 'guardar', campos: ['vence', 'iva'] }, { cuando: '2026-10-23T09:01:00+00:00', quien: 'Julio', que: 'papel', campos: [] }] })
    expect(h.slice(-2).map((x) => x.texto)).toEqual(['Cambió el vencimiento, los importes por tipo de IVA (Julio)', 'Puso el PDF (Julio)'])
  })
  it('el historial, de los sellos que hay, en orden', () => {
    const h = historialDe({ ...coheldi, marca: 'Sumied', aprobada: null, venceCambiado: null, pagos: [], asiento: null, descartada: null })
    expect(h.map((x) => x.texto)).toEqual(['Recepción en Foodint Alcalá (Natacha del Valle Rondón)', 'Sumied leyó «00-VR26102011251.pdf»', 'Se dio de alta la factura (Julio)'])
  })
  it('el PDF de su lectura (goods_receipt_ai_session.input_files de la COHELDI)', () => {
    expect(papelDeLaLectura([{ path: '51ad1792-6629-4ef7-833a-b57b09a86710/ca708afa-3dfc-428b-baa0-bcc822875d23/00-VR26102011251.pdf', bucket: 'receipt-uploads' }]))
      .toBe('51ad1792-6629-4ef7-833a-b57b09a86710/ca708afa-3dfc-428b-baa0-bcc822875d23/00-VR26102011251.pdf')
    expect(papelDeLaLectura([{ path: 'x.pdf', bucket: 'otro' }])).toBeNull()
    expect(papelDeLaLectura(null)).toBeNull()
  })
})

describe('la a mano, con la misma ficha', () => {
  const vacia = (): BorradorFicha => ({ ...borradorDe({ ...sinMas, proveedorId: null, numero: null, gasto: null, tipos: [], lineas: [], base: null, cuota: null }), iva: [{ base: '', tipo: '21', cuota: '' }] })
  it('sin base ni local no guarda, con los textos de siempre', () => {
    const c = comprobarAMano({ ...vacia(), proveedorId: 'p', numero: 'A-1' }, [21, 10, 4, 0], '2026-10-23', true, 'comun')
    expect(c.datos).toBeNull()
    expect(c.errores.importes).toEqual(['Escribe la base imponible.'])
    expect(c.errores.local).toBe('Elige el local de la factura, o «Común» si es de todos.')
  })
  it('la COHELDI escrita a mano: dos líneas, sus cuotas y su total; «Común» es null', () => {
    const b: BorradorFicha = { ...vacia(), proveedorId: 'p', numero: 'P26 4.980', iva: [{ base: '127,40', tipo: '4', cuota: '' }, { base: '136,26', tipo: '10', cuota: '' }], gastos: [{ cuenta: '', local: 'comun', importe: '' }] }
    const c = comprobarAMano(b, [21, 10, 4, 0], '2026-10-23', true, 'comun')
    expect(c.datos).toMatchObject({ lineas: [{ base: 127.4, tipo: 4, cuota: 5.1 }, { base: 136.26, tipo: 10, cuota: 13.63 }], base: 263.66, cuota: 18.73, total: 282.39, localId: null, cuentaGasto: null })
  })
  it('dos líneas con el mismo tipo: que se sumen', () => {
    const b: BorradorFicha = { ...vacia(), proveedorId: 'p', numero: 'X', iva: [{ base: '13,50', tipo: '10', cuota: '' }, { base: '122,76', tipo: '10', cuota: '' }] }
    expect(comprobarAMano(b, [21, 10, 4, 0], '2026-10-23', false, 'comun').errores.importes).toEqual(['Hay dos líneas con el mismo tipo de IVA: súmalas en una.'])
  })
})

// ── Lo que hace la propuesta con lo guardado (lib/recibidaGuardada) ──────────

describe('la propuesta lee lo que guarda la ficha', () => {
  const tipoDe = (pct: number) => ({ id: `iva${pct}`, rate: pct })
  const deLineas = (r: Real) => r.lineas.map((l) => ({ base: Number(l.importe), tipo: { id: `iva${l.iva}`, porcentaje: Number(l.iva) }, cuentaGasto: null }))
  it('PORTIER: con filas de impuesto, una línea por tipo con la base de la fila y su cuota (9,34, no 9,33)', () => {
    const x = lineasYCuotas(deLineas(PORTIER), [{ porcentaje: 21, base: 44.45, cuota: 9.34 }], '62300000', tipoDe, false)
    expect(x.lineas).toEqual([{ base: 44.45, tipo: { id: 'iva21', porcentaje: 21 }, cuentaGasto: '62300000' }])
    expect(x.cuotas).toEqual([{ porcentaje: 21, base: 44.45, cuota: 9.34 }])
  })
  it('COHELDI sin filas de impuesto: sus líneas, como siempre; con cuentas propias en las líneas, las líneas y las cuotas de las filas', () => {
    expect(lineasYCuotas(deLineas(COHELDI), [], '60000000', tipoDe, false)).toEqual({ lineas: deLineas(COHELDI), cuotas: undefined })
    expect(lineasYCuotas(deLineas(PORTIER), [{ porcentaje: 21, base: 44.45, cuota: 9.34 }], null, tipoDe, true).lineas).toHaveLength(2)
  })
  const prop = (): Propuesta => ({
    serie: 2, fecha: '2026-10-19', concepto: 'Factura COHELDI, S.L. · P26 4.980', origen: { tipo: 'supplier_invoice', id: COHELDI.id }, confianza: 'seguro', porque: '', razones: [], avisos: [],
    lineas: [
      { cuenta: '60000000', debe: 263.66, haber: 0, localId: 'alcala' },
      { cuenta: '47200004', debe: 5.1, haber: 0, localId: 'alcala', iva: { tipoId: 'iva4', tipo: 4, base: 127.4, libro: 'received' } },
      { cuenta: '47200010', debe: 13.63, haber: 0, localId: 'alcala', iva: { tipoId: 'iva10', tipo: 10, base: 136.26, libro: 'received' } },
      { cuenta: '40000007', debe: 0, haber: 282.39, localId: 'alcala' },
    ],
  })
  it('el gasto repartido manda: cada fila, su línea con su local; si no suma la base, se avisa y no se toca', () => {
    const p = aplicarReparto(prop(), [{ cuenta: '60000000', local: 'alcala', comun: false, importe: 200 }, { cuenta: '62900000', local: null, comun: true, importe: 63.66 }])
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.localId ?? null])).toEqual([['60000000', 200, 'alcala'], ['62900000', 63.66, null], ['47200004', 5.1, 'alcala'], ['47200010', 13.63, 'alcala'], ['40000007', 0, 'alcala']])
    const mal = aplicarReparto(prop(), [{ cuenta: '60000000', local: null, comun: true, importe: 200 }])
    expect(mal.lineas).toEqual(prop().lineas)
    expect(mal.avisos[0]).toMatch(/^El gasto repartido suma 200,00\s€ y la base es 263,66\s€/)
  })
  it('el asiento a mano: sus cuentas e importes por posición, conservando el IVA de cada línea; si no cuadra, no se usa', () => {
    const p = aplicarAsientoAMano(prop(), [{ posicion: 0, cuenta: '62900000', debe: 263.66, haber: 0 }, { posicion: 1, cuenta: '47200004', debe: 5.1, haber: 0 }, { posicion: 2, cuenta: '47200010', debe: 13.63, haber: 0 }, { posicion: 3, cuenta: '40000007', debe: 0, haber: 282.39 }])
    expect(p.lineas.map((l) => l.cuenta)).toEqual(['62900000', '47200004', '47200010', '40000007'])
    expect(p.lineas[1].iva?.tipo).toBe(4)
    expect(p.razones.at(-1)?.decision).toBe('A mano')
    expect(aplicarAsientoAMano(prop(), [{ cuenta: '62900000', debe: 10, haber: 0 }, { cuenta: '40000007', debe: 0, haber: 9 }]).avisos).toEqual(['El asiento guardado a mano no cuadra: no se usa. Vuelve a tocarlo en la ficha.'])
    expect(aplicarAsientoAMano(prop(), null)).toEqual(prop())
  })
})
