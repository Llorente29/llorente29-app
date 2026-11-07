// tests/unit/modules/conta/g03/sectores.test.ts
//
// G03 · El paquete de cada sector (sectores/sectores.ts) y el aviso al
// cambiar (sectores/cambio.ts).

import { describe, expect, it } from 'vitest'
import { PAQUETES, SECTORES, enciende, gestoriaPorCodigos, loQueEnciendeLaEmpresa, sectorDeFila, sectorPropuesto } from '@/modules/conta/sectores/sectores'
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
  const p = (codigos: { iae: string | null; cnae: string | null }[], grupos: string[] = [], hosteleria = false) => sectorPropuesto({ hosteleria, grupos, codigos })

  it('hostelería gana; un grupo de gestoría propone gestoría; sin nada, general', () => {
    expect(p([], ['gestoria'], true)).toEqual({ sector: 'hosteleria', duda: false })
    expect(p([], ['gestoria'])).toEqual({ sector: 'gestoria', duda: false })
    expect(p([{ iae: '1_644', cnae: '10.71' }], ['panaderia'])).toEqual({ sector: 'general', duda: false })
  })

  // Los códigos, tal como están en iae_heading y cnae_code (medido el 07/11/2026).
  it.each([
    ['1_842', 'servicios financieros y contables'], ['2_722', 'gestores administrativos'],
    ['2_726', 'graduados sociales'], ['2_741', 'economistas'],
  ])('IAE %s (%s) propone gestoría', (iae) => {
    expect(p([{ iae, cnae: null }])).toEqual({ sector: 'gestoria', duda: false })
  })

  it('un epígrafe que cuelga de un grupo cuenta como su grupo', () => {
    expect(gestoriaPorCodigos('2_7221', null)).toBe('si')
  })

  it('CNAE 69.20 propone gestoría; 69.10 y 70.20, con duda', () => {
    expect(p([{ iae: null, cnae: '69.20' }])).toEqual({ sector: 'gestoria', duda: false })
    expect(p([{ iae: null, cnae: '6910' }])).toEqual({ sector: 'gestoria', duda: true })
    expect(p([{ iae: null, cnae: '70.20' }])).toEqual({ sector: 'gestoria', duda: true })
  })

  it('un código seguro gana a uno con duda', () => {
    expect(p([{ iae: null, cnae: '6910' }, { iae: '2_722', cnae: null }])).toEqual({ sector: 'gestoria', duda: false })
  })

  it('lo de al lado no es gestoría: abogados por el IAE (2_731), administradores de fincas (2_723), sedes centrales (70.10)', () => {
    expect(gestoriaPorCodigos('2_731', null)).toBe('no')
    expect(gestoriaPorCodigos('2_723', null)).toBe('no')
    expect(gestoriaPorCodigos(null, '70.10')).toBe('no')
  })

  it('la sección cuenta: el 722 de la sección 1 no es el de gestores administrativos', () => {
    expect(gestoriaPorCodigos('1_722', null)).toBe('no')
  })
})
