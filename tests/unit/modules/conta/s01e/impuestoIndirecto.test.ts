import { describe, expect, it } from 'vitest'
import { conImpuesto, impuestoDelTerritorio, palabrasDelTerritorio, palabrasImpuesto } from '@/modules/conta/lib/impuestoIndirecto'
import { TERRITORIOS } from '@/modules/conta/empresa/datosEmpresa'
import { TIPOS_ASIENTO } from '@/modules/conta/lib/tipoAsiento'
import { lineasIva } from '@/modules/conta/lib/inicio'
import { texto } from '@/modules/conta/textos/textos'
import { eurosExactos } from '@/modules/conta/lib/formato'

describe('S01e · el impuesto según dónde está la empresa (IVA, IGIC, IPSI)', () => {
  it('cada territorio del alta tiene su impuesto; sin territorio, IVA', () => {
    // Los territorios de verdad (los de «Dónde está tu empresa»), no inventados.
    const por = Object.fromEntries(Object.keys(TERRITORIOS).map((t) => [t, impuestoDelTerritorio(t)]))
    expect(por).toEqual({ peninsula_baleares: 'iva', canarias: 'igic', ceuta_melilla: 'ipsi' })
    expect(impuestoDelTerritorio(null)).toBe('iva')
    expect(impuestoDelTerritorio(undefined)).toBe('iva')
  })

  it('las palabras de Libros › Registro y del Inicio', () => {
    const iva = palabrasImpuesto('iva')
    expect([iva.nombre, iva.libros, iva.repercutido, iva.soportado, iva.columnaTipo, iva.ley]).toEqual(['IVA', 'Libros registro de IVA', 'IVA repercutido', 'IVA soportado', '% IVA', 'LIVA'])
    const igic = palabrasDelTerritorio('canarias')
    expect([igic.nombre, igic.libros, igic.repercutido, igic.soportado, igic.columnaTipo, igic.ley]).toEqual(['IGIC', 'Libros registro de IGIC', 'IGIC repercutido', 'IGIC soportado', '% IGIC', null])
    expect(palabrasDelTerritorio('ceuta_melilla').libros).toBe('Libros registro de IPSI')
  })

  it('el formato AEAT es el del IVA: con IGIC o IPSI se dice en pantalla, no se esconde', () => {
    expect(palabrasImpuesto('iva').formatoAeatAplica).toBe(true)
    expect(palabrasImpuesto('iva').avisoFormatoAeat).toBeNull()
    const igic = palabrasImpuesto('igic')
    expect(igic.formatoAeatAplica).toBe(false)
    expect(igic.avisoFormatoAeat).toContain('Agencia Tributaria Canaria')
    expect(igic.avisoFormatoAeat).toContain('El fichero sale igual')
    expect(igic.avisoLey).toContain('IGIC')
    expect(palabrasImpuesto('ipsi').avisoFormatoAeat).toContain('Ceuta o Melilla')
  })

  it('la ayuda de la nueva expedida, con el texto real: «IGIC repercutido (477)»', () => {
    const ayuda = TIPOS_ASIENTO.expedida.ayuda
    expect(ayuda).toContain('el IVA repercutido (477)')
    expect(conImpuesto(ayuda, palabrasImpuesto('igic'))).toContain('el IGIC repercutido (477)')
    expect(conImpuesto(ayuda, palabrasImpuesto('igic'))).not.toMatch(/\bIVA\b/)
    expect(conImpuesto(ayuda, palabrasImpuesto('iva'))).toBe(ayuda)
  })

  it('solo cambia la palabra suelta: LIVA y RIVA son leyes del IVA y no se tocan', () => {
    expect(conImpuesto('IVA soportado (art. 108 LIVA; art. 65 RIVA). El IVA, al final: IVA', palabrasImpuesto('igic')))
      .toBe('IGIC soportado (art. 108 LIVA; art. 65 RIVA). El IGIC, al final: IGIC')
  })

  it('Inicio: la tarjeta y sus tres líneas dicen IGIC en Canarias', () => {
    expect(texto('inicio.iva', 'medio', { impuesto: 'IGIC' })).toBe('IGIC del trimestre')
    expect(texto('inicio.iva', 'sin_experiencia', { impuesto: 'IVA' })).toBe('IVA de este trimestre')
    expect(texto('inicio.iva', 'experto', { impuesto: 'IGIC' })).toBe('IGIC (477 − 472)')
    expect(lineasIva(8.99, 5, eurosExactos, 'IGIC').map((l) => l.etiqueta)).toEqual(['IGIC de tus ventas', 'IGIC de tus compras', 'A pagar'])
    // Sin decir el impuesto, lo de siempre.
    expect(lineasIva(8.99, 5, eurosExactos).map((l) => l.etiqueta)).toEqual(['IVA de tus ventas', 'IVA de tus compras', 'A pagar'])
  })
})
