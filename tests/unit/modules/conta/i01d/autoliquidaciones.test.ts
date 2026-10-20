// tests/unit/modules/conta/i01d/autoliquidaciones.test.ts
//
// I01d · Las autoliquidaciones: cómo se apunta el IVA de un proveedor según su
// ficha (la misma tabla de casos que la prueba de staging de la 0300, que es
// la que manda al validar), lo que la ficha dice en palabras y la propuesta de
// la factura con su 472 y su 477. Proveedores e importes inventados.

import { describe, expect, it } from 'vitest'
import { claseIva, nombrePais, textoClaseIva, textoVies, tipoDeLaClase, type FichaIva } from '@/modules/conta/lib/ivaProveedor'
import { facturaProveedor, type CuentasFactura, type EntradaFactura } from '@/modules/conta/lib/asientosPropuestos'
import { facturaRecibida } from '../../../../../supabase/functions/_shared/diezRecibida'

const ficha = (o: Partial<FichaIva>): FichaIva => ({ pais: 'ES', tipoNif: 'nif_es', nif: 'B00000000', vies: 'valid', regimen: null, ...o })

describe('la clase de IVA de una ficha (como conta_proveedor_iva_clase)', () => {
  const casos: [string, Partial<FichaIva>, string][] = [
    ['España', {}, 'nacional'],
    ['España con inversión del sujeto pasivo', { regimen: 'inversion_sujeto_pasivo' }, 'isp_nacional'],
    ['Francia con NIF-IVA', { pais: 'FR', tipoNif: 'vat_eu', nif: 'FR00123456789' }, 'intracomunitaria'],
    ['Francia, VIES sin contestar', { pais: 'FR', tipoNif: 'vat_eu', nif: 'FR00123456789', vies: 'pending' }, 'intracomunitaria'],
    ['Francia, VIES dice que no', { pais: 'FR', tipoNif: 'vat_eu', nif: 'FR00123456789', vies: 'invalid' }, 'ue_sin_nif_iva'],
    ['Portugal sin NIF', { pais: 'PT', tipoNif: null, nif: null, vies: null }, 'ue_sin_nif_iva'],
    ['Estados Unidos', { pais: 'US', tipoNif: 'foreign', nif: null, vies: null }, 'isp_extranjero'],
    ['Singapur', { pais: 'SG', tipoNif: 'foreign', nif: 'X1', vies: null }, 'isp_extranjero'],
  ]
  for (const [caso, f, clase] of casos) it(caso, () => expect(claseIva(ficha(f))).toBe(clase))
  it('sin país es España; Grecia vale como EL y como GR', () => {
    expect(claseIva(ficha({ pais: null }))).toBe('nacional')
    expect(claseIva(ficha({ pais: 'EL', tipoNif: 'vat_eu', nif: 'EL123456789' }))).toBe('intracomunitaria')
    expect(claseIva(ficha({ pais: 'GR', tipoNif: 'vat_eu', nif: 'EL123456789' }))).toBe('intracomunitaria')
  })
  it('el tipo del catálogo de cada clase', () => {
    expect([tipoDeLaClase('intracomunitaria'), tipoDeLaClase('isp_extranjero'), tipoDeLaClase('isp_nacional'), tipoDeLaClase('nacional'), tipoDeLaClase('ue_sin_nif_iva')])
      .toEqual(['ue_compra', 'isp', 'isp', null, null])
  })
})

describe('lo que dice la ficha, en palabras', () => {
  it('el país', () => {
    expect([nombrePais('FR'), nombrePais('us'), nombrePais('EL'), nombrePais(null)]).toEqual(['Francia', 'Estados Unidos', 'Grecia', 'España'])
  })
  it('su IVA', () => {
    expect(textoClaseIva('intracomunitaria', 'IE').titulo).toBe('Compra en otro país de la UE (Irlanda)')
    expect(textoClaseIva('isp_extranjero', 'SG').titulo).toBe('De fuera de la UE (Singapur)')
    expect(textoClaseIva('ue_sin_nif_iva', 'PT').titulo).toBe('De Portugal, sin NIF-IVA europeo válido')
    expect(textoClaseIva('isp_extranjero', 'US').detalle).toContain('472 y 477 por la misma cuota')
  })
  it('VIES: comprobado, sin comprobar o que no vale', () => {
    expect(textoVies('vat_eu', 'FR00123456789', 'valid', '2026-10-20T09:00:00Z', false)).toBe('Comprobado en VIES el 20/10/2026: el NIF-IVA está dado de alta.')
    expect(textoVies('vat_eu', 'FR00123456789', 'pending', null, false)).toBe('Sin comprobar: VIES no ha contestado. Se vuelve a preguntar al abrir la ficha.')
    expect(textoVies('vat_eu', 'FR00123456789', 'pending', null, true)).toBe('Comprobando en VIES (el registro europeo)…')
    expect(textoVies('vat_eu', 'FR00123456789', 'invalid', null, false)).toContain('no está dado de alta')
    expect(textoVies('nif_es', 'B00000000', 'valid', null, false)).toBeNull()
  })
})

const cuentas: CuentasFactura = {
  proveedor: '41000099',
  ivaSoportado: (p) => ({ cuenta: `472000${p}`, tipoId: `t${p}` }),
  retencion: '47510000',
  autoliquidada: (t) => ({ tipoId: t, porcentaje: 21, soportado: '47200021', repercutido: '47700021' }),
}
const entrada = (o: Partial<EntradaFactura> = {}): EntradaFactura => ({
  id: 'f1', numero: 'INV-1', fecha: '2026-10-05', proveedor: 'Francesa Inventada', terceroId: 'p1', esSocio: false, tieneNif: true, localId: 'l1',
  lineas: [{ base: 100, tipo: null, cuentaGasto: '62900005' }], total: 100, retencion: null,
  autoliquidacion: { tipo: 'ue_compra', porque: 'Francesa Inventada es de Francia y tiene NIF-IVA europeo: su compra es intracomunitaria.' }, ...o,
})

describe('la propuesta de una factura autoliquidada', () => {
  it('intracomunitaria: gasto, 472 con su tipo, 477 por la misma cuota y la base al proveedor', () => {
    const { propuesta: p } = facturaProveedor(entrada(), cuentas)
    expect(p!.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.iva?.tipoId ?? null])).toEqual([
      ['62900005', 100, 0, null], ['47200021', 21, 0, 'ue_compra'], ['47700021', 0, 21, null], ['41000099', 0, 100, null],
    ])
    expect(p!.lineas[1].iva).toMatchObject({ base: 100, libro: 'received', deducible: 'yes' })
    expect(p!.confianza).toBe('seguro')
    expect(p!.razones[0].decision).toBe('Autoliquidación al 21 % (21,00 €)')
  })
  it('fuera de la UE: el tipo de la inversión del sujeto pasivo', () => {
    const { propuesta: p } = facturaProveedor(entrada({ autoliquidacion: { tipo: 'isp', porque: 'x.' }, lineas: [{ base: 18.5, tipo: null, cuentaGasto: '62900005' }], total: 18.5 }), cuentas)
    expect(p!.lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['62900005', 18.5, 0], ['47200021', 3.89, 0], ['47700021', 0, 3.89], ['41000099', 0, 18.5]])
    expect(p!.lineas[1].iva?.tipoId).toBe('isp')
  })
  it('si la factura trae IVA español, contradice la ficha: no se propone y dice por qué', () => {
    const r = facturaProveedor(entrada({ lineas: [{ base: 100, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62900005' }], total: 121 }), cuentas)
    expect(r.propuesta).toBeNull()
    expect(r.sinPropuesta).toContain('Pero su factura trae IVA español (21 %)')
  })
  it('sin la 472 y la 477 en el plan, no se propone', () => {
    const r = facturaProveedor(entrada(), { ...cuentas, autoliquidada: () => null })
    expect(r.sinPropuesta).toContain('Falta en tu plan la 472 o la 477')
  })
  it('un total que no es la base: en duda, y lo dice', () => {
    const { propuesta: p } = facturaProveedor(entrada({ total: 121 }), cuentas)
    expect(p!.confianza).toBe('duda')
    expect(p!.avisos.join(' ')).toContain('el total tendría que ser la base')
  })
  it('sin autoliquidación, como siempre (472 por tipo, sin 477)', () => {
    const { propuesta: p } = facturaProveedor(entrada({ autoliquidacion: null, lineas: [{ base: 100, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62900005' }], total: 121 }), cuentas)
    expect(p!.lineas.map((l) => l.cuenta)).toEqual(['62900005', '47200021', '41000099'])
  })
  it('I01f · a Diez va como intracomunitaria (TipoFactura 7), el total es la base', () => {
    const { propuesta: p } = facturaProveedor(entrada(), cuentas)
    // El tratamiento del tipo lo pone la base (tax_rate.treatment): «ue_compra» es intra_eu.
    const { factura } = facturaRecibida({
      fecha: '2026-10-05', fechaFactura: '2026-10-05', numero: 'INV-1', proveedor: { nombre: 'FRANCESA INVENTADA', nif: 'FR00123456789', pais: 'FR' },
      lineas: p!.lineas.map((l) => ({ cuenta: l.cuenta, debe: l.debe, haber: l.haber, tipoIva: l.iva?.tipo ?? null, baseIva: l.iva?.base ?? null,
        tratamiento: l.iva?.tipoId === 'ue_compra' ? 'intra_eu' : l.iva ? 'taxed' : null })),
    }, { hoy: '2026-10-06' })
    expect([factura.TipoFactura, factura.TotalFactura, factura.CuotaIVA1]).toEqual([7, 100, 21])
  })
})
