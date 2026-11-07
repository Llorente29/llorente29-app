// tests/unit/modules/conta/g03/sectores.test.ts
//
// G03 · El paquete de cada sector (sectores/sectores.ts) y el aviso al
// cambiar (sectores/cambio.ts).

import { describe, expect, it } from 'vitest'
import { PAQUETES, SECTORES, enciende, esGestoriaPorCodigos, loQueEnciendeLaEmpresa, sectorDeFila, sectorPropuesto } from '@/modules/conta/sectores/sectores'
import { cambioDeSector, fraseDelCambio, loQueSaleCon, paginasQueEnciende } from '@/modules/conta/sectores/cambio'
import { PRODUCTOS, cumple } from '@/modules/conta/esqueleto/productos'

describe('el paquete de cada sector', () => {
  it('tres sectores, cada uno con su línea del Diseño', () => {
    expect(SECTORES).toEqual(['general', 'hosteleria', 'gestoria'])
    expect(PAQUETES.general.linea).toBe('Lo de siempre: compras, ventas, bancos, impuestos')
    expect(PAQUETES.hosteleria.linea).toBe('Además: liquidaciones de Glovo, Uber y Just Eat, socios de marca y Catcher')
    expect(PAQUETES.gestoria.linea).toBe('Además: clientes y cuotas, tarifas y altas y bajas de trabajadores de tus clientes')
  })

  it('el sector no se llama «paquete», «flag» ni «feature» delante del cliente', () => {
    // Las tarjetas son nombres de pantallas que ya existen («Tarifa y paquetes», de G01): no hablan del sector.
    const textos = Object.values(PAQUETES).flatMap((p) => [p.etiqueta, p.linea, p.enLaFrase, ...p.catalogo.map((s) => s.nombre)])
    for (const t of textos) expect(t).not.toMatch(/paquete|flag|feature/i)
  })

  it('cada sector enciende solo lo suyo', () => {
    expect(enciende('general', 'hosteleria')).toBe(false)
    expect(enciende('general', 'gestoria')).toBe(false)
    expect(enciende('hosteleria', 'hosteleria')).toBe(true)
    expect(enciende('hosteleria', 'gestoria')).toBe(false)
    expect(enciende('gestoria', 'gestoria')).toBe(true)
    expect(enciende('gestoria', 'hosteleria')).toBe(false)
  })

  it('el catálogo de gestoría viene puesto, con las claves de G01 en los dos primeros', () => {
    expect(PAQUETES.gestoria.catalogo.map((s) => s.clave)).toEqual(['gestoria_mensual', 'gestion_laboral', 'renta', 'altas', 'regularizaciones'])
    expect(PAQUETES.gestoria.catalogo.find((s) => s.clave === 'gestion_laboral')?.forma).toBe('por_empleado')
    expect(PAQUETES.general.catalogo).toEqual([])
    expect(PAQUETES.hosteleria.catalogo).toEqual([])
  })
})

describe('el sector de una empresa', () => {
  it('con la columna, manda ella (aunque is_hospitality diga otra cosa o la cuenta sea asesoría)', () => {
    expect(sectorDeFila({ sector: 'gestoria', is_hospitality: true }, false)).toBe('gestoria')
    expect(sectorDeFila({ sector: 'general', is_hospitality: false }, true)).toBe('general')
    expect(sectorDeFila({ sector: 'hosteleria' }, true)).toBe('hosteleria')
  })

  it('sin la columna, lo de hoy: is_hospitality, y si no, la cuenta de asesoría', () => {
    expect(sectorDeFila({ is_hospitality: true }, true)).toBe('hosteleria')
    expect(sectorDeFila({ is_hospitality: false }, true)).toBe('gestoria')
    expect(sectorDeFila({ is_hospitality: null }, false)).toBe('general')
    expect(sectorDeFila({ is_hospitality: false }, false)).toBe('general')
  })

  it('un valor que no es un sector no vale: se cae a lo de hoy', () => {
    expect(sectorDeFila({ sector: 'agencia_viajes', is_hospitality: true }, false)).toBe('hosteleria')
  })

  it('sin empresa, nada', () => {
    expect(loQueEnciendeLaEmpresa(null, true)).toEqual({ sector: null, hosteleria: false, gestoria: false })
  })
})

describe('el menú pregunta al paquete', () => {
  it('Clientes y cuotas sale con el sector Gestoría, no con «la cuenta es asesoría»', () => {
    const t = PRODUCTOS.find((p) => p.id === 'facturacion')!.pestanas.find((x) => x.id === 'clientesCuotas')!
    expect(t.solo).toBe('gestoria')
    const base = { hosteleria: false, diez: false, interruptores: new Set<string>() }
    expect(cumple(t.solo, { ...base, asesoria: true, gestoria: false })).toBe(false)
    expect(cumple(t.solo, { ...base, asesoria: false, gestoria: true })).toBe(true)
  })

  it('Clientes del despacho se queda con la cuenta de asesoría', () => {
    expect(PRODUCTOS.find((p) => p.id === 'despacho')!.solo).toBe('asesoria')
  })
})

describe('el aviso al cambiar de sector', () => {
  it('las páginas de cada sector salen del menú, no de otra lista', () => {
    expect(paginasQueEnciende('hosteleria')).toEqual(['Cierres del día', 'Repartidores', 'Plataformas', 'Socios de marca'])
    expect(paginasQueEnciende('gestoria')).toEqual(['Clientes y cuotas'])
  })

  it('general no añade nada', () => {
    expect(loQueSaleCon('general')).toEqual([])
  })

  it('de hostelería a gestoría: qué sale, qué deja de salir y que no se borra nada', () => {
    const c = cambioDeSector('hosteleria', 'gestoria')
    expect(c.saldra).toEqual(['Clientes y cuotas', 'Tarifa y paquetes', 'CRM y GoCardless en Ajustes › Cobros'])
    expect(c.dejaraDeSalir).toContain('Cierres del día')
    expect(c.dejaraDeSalir).toContain('Socios de marca')
    expect(fraseDelCambio(c)).toMatch(/^Saldrá: Clientes y cuotas, .*\. Dejará de salir: Cierres del día, .*\. No se borra nada\.$/)
  })

  it('al mismo sector, nada cambia y se dice', () => {
    expect(fraseDelCambio(cambioDeSector('gestoria', 'gestoria'))).toBe('No cambia lo que sale. No se borra nada.')
  })
})

describe('lo que se propone en el alta', () => {
  it('hostelería gana; si no, gestoría por grupo o por código; si no, general', () => {
    expect(sectorPropuesto({ hosteleria: true, grupos: ['gestoria'], codigos: [] })).toBe('hosteleria')
    expect(sectorPropuesto({ hosteleria: false, grupos: ['gestoria'], codigos: [] })).toBe('gestoria')
    expect(sectorPropuesto({ hosteleria: false, grupos: [], codigos: [{ iae: null, cnae: '69.20' }] })).toBe('gestoria')
    expect(sectorPropuesto({ hosteleria: false, grupos: [], codigos: [{ iae: '1_842', cnae: null }] })).toBe('gestoria')
    expect(sectorPropuesto({ hosteleria: false, grupos: ['panaderia'], codigos: [{ iae: '1_644', cnae: '10.71' }] })).toBe('general')
  })

  it('el código de abogados (69.10) no es gestoría', () => {
    expect(esGestoriaPorCodigos(null, '69.10')).toBe(false)
  })
})
