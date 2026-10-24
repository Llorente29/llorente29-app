// tests/unit/modules/conta/s01d/altaProveedor.test.ts
//
// S01d · El alta de proveedor desde Contactos y desde «Subir factura»: con qué
// se rellena, qué se comprueba y qué se dice. Regla 31: los NIF son los cinco
// de los proveedores reales de Foodint (los mismos de nif.test.ts), escritos
// como están en la base (con y sin guion) y como los lee el papel (con «ES»).

import { describe, expect, it } from 'vitest'
import {
  avisoNifAlta, fraseAltaEnFactura, fraseAltaProveedor, revisarAlta, textoBotonAlta, valoresInicialesAlta,
} from '@/modules/conta/lib/altaProveedor'
import { cintaDe, ordenPorId } from '@/modules/conta/esqueleto/ordenes'
import type { Contexto } from '@/modules/conta/esqueleto/productos'

const REALES = [
  { name: 'AMIRSA HOSTELERIA, S.L.', taxId: 'B87123790' },
  { name: 'BODEGA DE VALLECAS S.L', taxId: 'B-72646904' },
  { name: 'EUROPASTRY, S.A.', taxId: 'A-58695032' },
  { name: 'MAKRO DISTRIBUCION MAYORISTA SA', taxId: 'A28647451' },
  { name: 'PRODUCTOS LÁCTEOS TGT, S.A.', taxId: 'A-28310761' },
]

describe('valoresInicialesAlta: lo que leyó el papel', () => {
  it.each(REALES)('$name: el NIF leído entra normalizado', ({ name, taxId }) => {
    expect(valoresInicialesAlta(name, taxId)).toEqual({ nombre: name, nif: taxId.replace('-', '') })
  })
  it('un «ES» delante y los espacios del papel se quitan', () => {
    expect(valoresInicialesAlta('  Bodega   de Vallecas ', 'ES B-72646904')).toEqual({ nombre: 'Bodega de Vallecas', nif: 'B72646904' })
  })
  it('un NIF mal leído o de otro país no se pone: el formulario no nace en rojo', () => {
    expect(valoresInicialesAlta('Hermanos Ruiz', 'B87123791').nif).toBe('')
    expect(valoresInicialesAlta('Fornecedor Lda', 'PT501964843').nif).toBe('')
  })
  it('sin nada leído, vacío', () => {
    expect(valoresInicialesAlta(null, null)).toEqual({ nombre: '', nif: '' })
    expect(valoresInicialesAlta(undefined, '   ')).toEqual({ nombre: '', nif: '' })
  })
})

describe('revisarAlta: lo que hay que corregir antes de crear', () => {
  it('sin nombre, lo pide', () => {
    expect(revisarAlta({ nombre: '  ', nif: '' }, []).errores).toEqual({ nombre: 'Pon el nombre con el que lo conocéis.' })
  })
  it('sin NIF vale: se completa en su ficha', () => {
    expect(revisarAlta({ nombre: 'Hermanos Ruiz', nif: '' }, REALES)).toEqual({ errores: {}, nif: null })
  })
  it('un NIF que no pasa el algoritmo, con su motivo y la salida para los de otro país', () => {
    const r = revisarAlta({ nombre: 'Hermanos Ruiz', nif: 'B87123791' }, [])
    expect(r.errores.nif).toMatch(/Si es de otro país, déjalo vacío y ponlo luego en su ficha\.$/)
    expect(avisoNifAlta('B87123791')).toBe(r.errores.nif)
  })
  it.each(REALES)('el NIF de $name, escrito de otra forma, ya lo tiene él', ({ name, taxId }) => {
    const otraForma = ` es${taxId.replace('-', '').toLowerCase()} `
    expect(revisarAlta({ nombre: 'Otro', nif: otraForma }, REALES)).toEqual({ errores: { nif: `Ese NIF ya lo tiene ${name}.` }, nif: taxId.replace('-', '') })
  })
  it('un NIF nuevo y válido se guarda normalizado', () => {
    expect(revisarAlta({ nombre: 'Hermanos Ruiz', nif: 'b-87123790' }, [])).toEqual({ errores: {}, nif: 'B87123790' })
  })
})

describe('lo que se dice (regla 8: con contenido)', () => {
  it('Contactos', () => expect(fraseAltaProveedor(' Hermanos Ruiz ')).toBe('Proveedor Hermanos Ruiz dado de alta. Ya puedes subir sus facturas.'))
  it('Subir factura', () => expect(fraseAltaEnFactura('Hermanos Ruiz')).toBe('Proveedor Hermanos Ruiz dado de alta y elegido para esta factura.'))
  it('el botón de «Subir factura», con lo leído o sin ello', () => {
    expect(textoBotonAlta('EUROPASTRY, S.A.')).toBe('+ Dar de alta «EUROPASTRY, S.A.»')
    expect(textoBotonAlta(null)).toBe('+ Dar de alta un proveedor')
    expect(textoBotonAlta('   ')).toBe('+ Dar de alta un proveedor')
  })
})

describe('la cinta de Contactos', () => {
  const NADA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }
  it('«Nuevo proveedor» abre el alta en la lista (?nuevo=proveedor); «Nuevo cliente» sigue igual', () => {
    expect(ordenPorId('contactos.nuevo-proveedor')?.a).toEqual({ ruta: 'clientes-y-proveedores?nuevo=proveedor' })
    expect(ordenPorId('contactos.nuevo')?.a).toEqual({ ruta: 'clientes-y-proveedores?nuevo=' })
  })
  it.each(['todos', 'clientes', 'proveedores'])('en «%s», las dos', (pestana) => {
    expect(cintaDe('contactos', pestana, NADA).flatMap((g) => g.ordenes.map((o) => o.id))).toEqual(['contactos.nuevo', 'contactos.nuevo-proveedor'])
  })
})
