// tests/conta/n1/nifDeLaFicha.test.ts
//
// N1 · El NIF de la ficha del proveedor, desde la factura y antes de validar.
// El caso real (medido el 23/10 en solo lectura, Foodint): CARREFOUR
// 2026FBFN01634861 del 06/08, aprobada y sin asiento; su ficha sin NIF; la
// factura sin lectura propia ni recepción, y la lectura de su imagen (sesión
// 80806aa3, 06/08) con supplier_tax_id vacío, el nombre «CENTROS COMERC.
// CARREFOUR S.A.» y la dirección de Alcobendas. El NIF válido de las pruebas
// es el de AMIRSA que ya usa tests/unit/modules/conta/nif.test.ts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completarFicha } from '../../../src/modules/conta/lib/fichaDesdeDocumento'
import { cambiosDelNif, faltaEnElNif, nifPropuesto, textoGuardado } from '../../../src/modules/conta/lib/nifDeLaFicha'
import { validarNifEs } from '../../../src/modules/conta/lib/nif'

const CARREFOUR = { nif: null, nombre: 'CENTROS COMERC. CARREFOUR S.A.', direccion: 'Avda. Transición Española 36, 28108 ALCOBENDAS, MADRID' }
const fichaCarrefour = { nif: null, nombreFiscal: 'CARREFOUR', calle: null, codigoPostal: null, ciudad: null }
const AMIRSA = 'B87123790'

describe('N1 · por qué no se rellenaba: el NIF solo se guardaba al validar, y sin NIF no hay asiento', () => {
  it('sin NIF en la ficha no hay propuesta: «le falta el NIF: ponlo en su ficha»', () => {
    const s = readFileSync('src/modules/conta/lib/asientosPropuestos.ts', 'utf8')
    expect(s).toContain("if (!f.tieneNif && !f.ivaNoDeducible) return { propuesta: null, sinPropuesta: `A ${f.proveedor} le falta el NIF")
  })
  it('y el documento de CARREFOUR no trae NIF: no hay nada que proponer, hay que escribirlo', () => {
    expect(completarFicha(fichaCarrefour, CARREFOUR).proponer.taxId).toBeUndefined()
    expect(nifPropuesto(CARREFOUR.nif)).toBe('')
  })
})

describe('N1 · el NIF que se propone, si vale y qué se guarda', () => {
  it('el del documento, normalizado, si es válido', () => {
    expect(validarNifEs(AMIRSA).ok).toBe(true)
    expect(nifPropuesto(' b-87123790 ')).toBe(AMIRSA)
  })
  it('uno leído mal no se propone: se escribe', () => {
    expect(nifPropuesto('B87123791')).toBe('')
  })
  it('lo escrito se comprueba antes de guardar, y el porqué va en palabras', () => {
    expect(faltaEnElNif('')).toBe('Escribe el NIF.')
    expect(faltaEnElNif('B8712379')).toBe('Un NIF español tiene 9 caracteres.')
    expect(faltaEnElNif('B87123791')).toMatch(/carácter de control/)
    expect(faltaEnElNif(AMIRSA)).toBeNull()
  })
  it('se guarda como un NIF español comprobado, como en «Datos fiscales»; la clase de entidad solo si no la tiene', () => {
    const c = cambiosDelNif('b87123790', null, '2026-10-24T00:00:00.000Z')
    expect(c).toEqual({ taxId: AMIRSA, taxIdType: 'nif_es', taxIdCheckedAt: '2026-10-24T00:00:00.000Z', taxIdVerifiedAt: '2026-10-24T00:00:00.000Z', taxIdCheckStatus: 'valid', countryCode: 'ES', entityKind: 'company' })
    expect(cambiosDelNif(AMIRSA, 'company').entityKind).toBeUndefined()
  })
  it('y dice lo que ha hecho, con el nombre y el NIF (regla 8)', () => {
    expect(textoGuardado('CARREFOUR', 'b87123790')).toBe('Guardado: CARREFOUR ya tiene el NIF B87123790 en su ficha. Vuelvo a preparar el asiento.')
  })
})

describe('N1 · en la ficha de la recibida', () => {
  const pagina = readFileSync('src/modules/conta/documentos/RevisarFacturaPage.tsx', 'utf8')
  it('el bloque sale cuando su ficha no tiene NIF y no está validada, y al guardar vuelve a preparar el asiento', () => {
    expect(pagina).toContain('!soloLectura && !fac.asiento && fac.proveedor?.id && fichaProv.datos?.id === fac.proveedor.id && !fichaProv.datos.taxId && (')
    expect(pagina).toContain('alGuardar={(t) => { setNifGuardado({ id: invoiceId, texto: t }); setVuelta((v) => v + 1) }}')
    expect(pagina).toContain('data-prueba="nif-guardado"')
  })
  it('el NIF ya no espera «al validar» en la nota del documento: lo guarda el bloque (el resto, sí, al validar)', () => {
    expect(pagina).toContain("if (c.proponer.taxId) { delete c.proponer.taxId; c.frases = c.frases.filter((f) => !f.startsWith('el NIF ')); c.campos = c.campos.filter((x) => x !== 'nif') }")
    // La frase que se quita es la que escribe completarFicha.
    expect(completarFicha({ ...fichaCarrefour }, { ...CARREFOUR, nif: AMIRSA }).frases[0]).toBe(`el NIF ${AMIRSA}`)
  })
})
