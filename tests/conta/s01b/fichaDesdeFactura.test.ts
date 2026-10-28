// tests/conta/s01b/fichaDesdeFactura.test.ts
//
// S01b · La ficha del proveedor se rellena sola con lo que trae la factura
// (completarFicha, ampliada), el NIF distinto y el IBAN, que nunca entra solo.
// La forma de los datos es la de la lectura de verdad (la única recibida de
// Foodint sin proveedor en «Para revisar» el 28/10: nombre, NIF y una dirección
// de polígono con la provincia entre paréntesis); el nombre, el NIF, la
// dirección y los contactos, inventados (el repositorio es público).

import { describe, expect, it } from 'vitest'
import { apuntarOrigen, completarFicha, deLaFactura, estadoIban, origenDelCampo, partirDireccion } from '../../../src/modules/conta/lib/fichaDesdeDocumento'
import { altaEnFactura, textoAltaDesdeFactura } from '../../../src/modules/conta/lib/proveedorDesdeFactura'
import { camposDeOrigenTocados } from '../../../src/modules/conta/services/proveedorService'

const vacia = { nif: null, nombreFiscal: null, calle: null, codigoPostal: null, ciudad: null }
const PAPEL = { nif: 'B12345674', nombre: 'Suministros del Ejemplo S.L.U.', direccion: 'Pol.I. Inventado, C/ Ejemplo,9, Nave 9, 11160 Barbate (Cádiz)' }
const IBAN_BUENO = 'ES9121000418450200051332'
const OTRO_IBAN_BUENO = 'ES7921000813610123456789'

describe('S01b · qué se rellena y qué no', () => {
  it('un polígono con la provincia entre paréntesis: calle, código postal y ciudad', () => {
    expect(partirDireccion(PAPEL.direccion)).toEqual({ calle: 'Pol.I. Inventado, C/ Ejemplo,9, Nave 9', codigoPostal: '11160', ciudad: 'Barbate' })
  })
  it('a una ficha vacía: todo lo que trae (NIF, nombre fiscal, dirección, correo, teléfono y web)', () => {
    const r = completarFicha(vacia, { ...PAPEL, correo: 'Admin@Ejemplo.es ', telefono: '+34 956 00 00 00', web: 'https://www.ejemplo.es/' })
    expect(r.proponer).toEqual({ taxId: 'B12345674', legalName: 'Suministros del Ejemplo S.L.U.', fiscalStreet: 'Pol.I. Inventado, C/ Ejemplo,9, Nave 9', fiscalPostalCode: '11160', fiscalCity: 'Barbate', website: 'ejemplo.es' })
    expect(r.contacto).toEqual({ correo: 'admin@ejemplo.es', telefono: '+34 956 00 00 00' })
    expect(r.campos).toEqual(['nif', 'nombreFiscal', 'direccion', 'correo', 'telefono', 'web'])
    expect(r.cambiados).toEqual([])
  })
  it('lo que ya tiene y es lo mismo no se toca: el teléfono con o sin +34, el correo en mayúsculas, la web con www', () => {
    const r = completarFicha({ ...vacia, nif: 'B12345674', correos: ['admin@ejemplo.es'], telefonos: ['956000000'], web: 'www.ejemplo.es' },
      { nif: 'B-11807195', nombre: null, direccion: null, correo: 'ADMIN@ejemplo.es', telefono: '+34 956 00 00 00', web: 'http://ejemplo.es' })
    expect(r.proponer).toEqual({})
    expect(r.contacto).toEqual({})
    expect(r.cambiados).toEqual([])
  })
  it('lo que no coincide no se pisa: sale con su pregunta y lo que se guardaría al pulsar', () => {
    const r = completarFicha({ nif: 'B12345674', nombreFiscal: 'Suministros del Ejemplo S.L.U.', calle: 'Calle Antigua 1', codigoPostal: '11160', ciudad: 'Barbate', correos: ['pedidos@ejemplo.es'], web: 'ejemplo.es' },
      { ...PAPEL, correo: 'facturas@ejemplo.es', web: 'otra-web.es' })
    expect(r.proponer).toEqual({})
    expect(r.cambiados.map((c) => c.pregunta)).toEqual([
      'Su dirección ha cambiado: ¿la actualizo?',
      'Esta factura trae otro correo: ¿lo añado a sus contactos?',
      'Su web ha cambiado: ¿la actualizo?',
    ])
    expect(r.cambiados[0].cambios).toEqual({ fiscalStreet: 'Pol.I. Inventado, C/ Ejemplo,9, Nave 9', fiscalPostalCode: '11160', fiscalCity: 'Barbate' })
    expect(r.cambiados[1].contacto).toEqual({ correo: 'facturas@ejemplo.es' })
  })
  it('la misma calle con otras mayúsculas, tildes o comas no es un cambio', () => {
    const r = completarFicha({ ...vacia, calle: 'POL.I. INVENTADO C/ EJEMPLO 9 NAVE 9', codigoPostal: '11160', ciudad: 'Barbate' }, { nif: null, nombre: null, direccion: PAPEL.direccion })
    expect(r.cambiados).toEqual([])
  })
  it('un correo o una web mal escritos no se proponen', () => {
    const r = completarFicha(vacia, { nif: null, nombre: null, direccion: null, correo: 'no es un correo', web: 'nada' })
    expect(r.contacto).toEqual({})
    expect(r.proponer).toEqual({})
  })
})

describe('S01b · el NIF distinto', () => {
  it('su ficha tiene otro NIF: no se pisa, y se dice cuál trae la factura y cuál tiene la ficha', () => {
    const r = completarFicha({ ...vacia, nif: 'B87654321' }, { nif: 'B12345678', nombre: null, direccion: null })
    expect(r.nifDistinto).toEqual({ documento: 'B12345678', ficha: 'B87654321' })
    expect(r.proponer.taxId).toBeUndefined()
  })
  it('sin NIF en la ficha no hay «distinto»: se propone el de la factura', () => {
    const r = completarFicha(vacia, { nif: 'B12345674', nombre: null, direccion: null })
    expect(r.nifDistinto).toBeNull()
    expect(r.proponer.taxId).toBe('B12345674')
  })
})

describe('S01b · el IBAN: vacío, igual, distinto e inválido', () => {
  it('la factura no trae IBAN', () => expect(estadoIban(IBAN_BUENO, null)).toEqual({ estado: 'sin_dato' }))
  it('el mismo, con espacios o sin ellos', () => expect(estadoIban(IBAN_BUENO, 'ES91 2100 0418 4502 0005 1332')).toEqual({ estado: 'igual' }))
  it('ficha sin IBAN y uno válido: se ofrece, formateado', () => {
    expect(estadoIban(null, IBAN_BUENO)).toEqual({ estado: 'nuevo', iban: IBAN_BUENO, formateado: 'ES91 2100 0418 4502 0005 1332' })
  })
  it('ficha sin IBAN y uno que no pasa el módulo 97: no se ofrece', () => {
    const e = estadoIban(null, 'ES9121000418450200051333')
    expect(e.estado).toBe('invalido')
  })
  it('la ficha tiene otro: distinto (el aviso en rojo), y dice si se podría cambiar', () => {
    expect(estadoIban(IBAN_BUENO, OTRO_IBAN_BUENO)).toMatchObject({ estado: 'distinto', valido: true, ficha: 'ES91 2100 0418 4502 0005 1332' })
    expect(estadoIban(IBAN_BUENO, 'ES7921000813610123456780')).toMatchObject({ estado: 'distinto', valido: false })
  })
  it('el IBAN nunca entra solo: ni en lo que se guarda al validar ni en lo que se pregunta', () => {
    for (const ficha of [null, IBAN_BUENO]) {
      const r = completarFicha({ ...vacia, iban: ficha }, { nif: null, nombre: null, direccion: null, iban: OTRO_IBAN_BUENO })
      expect(Object.keys(r.proponer)).not.toContain('iban')
      expect(r.campos).not.toContain('iban')
      expect(r.cambiados.every((c) => !('iban' in c.cambios))).toBe(true)
    }
  })
})

describe('S01b · «de la factura R0672»', () => {
  it('con número y sin él', () => {
    expect(deLaFactura('R0672')).toBe('de la factura R0672')
    expect(deLaFactura(null)).toBe('de una factura')
  })
  it('cada campo apunta su última factura; lo demás se queda', () => {
    const a = apuntarOrigen(null, ['nombreFiscal', 'direccion'], { factura: 'R0672', facturaId: 'f1', fecha: '2026-10-28', quien: 'Julio' })
    const b = apuntarOrigen(a, ['direccion'], { factura: 'R0700', facturaId: 'f2', fecha: '2026-11-02', quien: 'Julio' })
    expect(b.nombreFiscal.factura).toBe('R0672')
    expect(b.direccion.factura).toBe('R0700')
  })
})

describe('S01b · cuándo se ofrece el alta en la factura', () => {
  const proveedores = [{ id: 'p1', nombre: 'Panadería de Prueba', nif: 'B87654321' }]
  it('sin proveedor y con un NIF que no tienes: «Dar de alta a …»', () => {
    expect(altaEnFactura({ proveedorId: '', soloLectura: false, nifLeido: 'B12345674', proveedores })).toEqual({ que: 'alta' })
    expect(textoAltaDesdeFactura('Suministros del Ejemplo  S.L.U. ')).toBe('Dar de alta a Suministros del Ejemplo S.L.U.')
    expect(textoAltaDesdeFactura(null)).toBe('Dar de alta a su proveedor')
  })
  it('el NIF leído ya es de uno tuyo (con guiones o no): elegirlo, no darlo de alta otra vez', () => {
    expect(altaEnFactura({ proveedorId: null, soloLectura: false, nifLeido: 'b-87654321', proveedores })).toEqual({ que: 'es_uno_tuyo', proveedorId: 'p1', nombre: 'Panadería de Prueba' })
  })
  it('con proveedor, o ya validada: nada', () => {
    expect(altaEnFactura({ proveedorId: 'p1', soloLectura: false, nifLeido: 'B12345674', proveedores })).toEqual({ que: 'nada' })
    expect(altaEnFactura({ proveedorId: '', soloLectura: true, nifLeido: 'B12345674', proveedores })).toEqual({ que: 'nada' })
  })
})

describe('S01b · «de la factura R0672» en la ficha', () => {
  it('dice de qué factura sale, quién la guardó y cuándo; sin origen, nada', () => {
    const datos = { direccion: { factura: 'R0672', facturaId: 'f1', fecha: '2026-10-28', quien: 'Julio' } }
    expect(origenDelCampo(datos, 'direccion')).toBe('De la factura R0672, la guardó Julio el 28/10.')
    expect(origenDelCampo(datos, 'web')).toBeNull()
    expect(origenDelCampo(null, 'iban')).toBeNull()
  })
  it('lo que se cambia a mano deja de ser «de la factura»', () => {
    expect(camposDeOrigenTocados({ fiscalCity: 'Cádiz', website: null })).toEqual(['direccion', 'web'])
    expect(camposDeOrigenTocados({ name: 'Otro nombre' })).toEqual([])
    expect(camposDeOrigenTocados({ iban: 'ES91…', legalName: 'X', taxId: 'B1' })).toEqual(['nif', 'nombreFiscal', 'iban'])
  })
})
