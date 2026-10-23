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
import {
  COMO_SE_GUARDA, ETIQUETAS, asientoVistaPrevia, borradorDe, comprobarAMano, contraElPdf, cuadraElGasto, cuentasDeLaPropuesta, deDondeVino, formatoCampo,
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
  it('Orange: sus líneas al céntimo dan 34,96 y el PDF dice 34,95: la diferencia, no «igual»', () => {
    const c = contraElPdf(totalesDe(borradorDe(ORANGE)), { base: 28.8843, iva: 6.0657, total: 34.95 })
    expect(c.igual).toBe(false)
    expect(c.texto).toMatch(/^0,01\s€ más que el PDF \(34,95\s€\)$/)
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

describe('qué se guarda hoy y qué no (regla 8)', () => {
  it('cada campo del borrador dice cómo se guarda o qué falta', () => {
    expect(Object.keys(COMO_SE_GUARDA).sort()).toEqual(Object.keys(ETIQUETAS).sort())
    expect(Object.entries(COMO_SE_GUARDA).filter(([, c]) => 'con' in c).map(([k]) => k).sort()).toEqual(['proveedorId', 'vence'])
  })
  it('partir los cambios y decirlo con contenido', () => {
    const { hoy, noHoy } = partirCambios([{ campo: 'vence', etiqueta: 'Vence' }, { campo: 'iva', etiqueta: 'Importes por tipo de IVA' }])
    expect(hoy.map((c) => c.campo)).toEqual(['vence'])
    expect(noHoy.map((c) => c.campo)).toEqual(['iva'])
    const t = textoDelGuardado({ hechos: ['Vence: 18/11/2026'], fallos: [], noHoy })
    expect(t.tono).toBe('falta')
    expect(t.texto).toMatch(/^Guardado: Vence: 18\/11\/2026\. Importes por tipo de IVA: no se puede guardar todavía — supplier_invoice_tax solo se lee/)
    expect(textoDelGuardado({ hechos: ['Vence: 18/11/2026'], fallos: [], noHoy: [] })).toEqual({ tono: 'ok', texto: 'Guardado: Vence: 18/11/2026.' })
  })
  it('«Antes: …» se escribe en palabras', () => {
    const f = formatoCampo(() => 'COHELDI, S.L.', () => 'Foodint Alcalá')
    expect(f('vence', '2026-10-19')).toBe('19/10/2026')
    expect(f('iva', borradorDe(COHELDI).iva)).toBe('127,40 al 4 % + 136,26 al 10 %')
    expect(f('gastos', borradorDe(COHELDI).gastos)).toBe('60000000 · Foodint Alcalá')
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
