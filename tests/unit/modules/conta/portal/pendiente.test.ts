// tests/unit/modules/conta/portal/pendiente.test.ts
//
// GP · Tarea 4 · Lo del portal en «Lo que tienes que hacer» de la gestoría
// (tarjetasDelPortal) y el nombre del PDF que se sube para firmar. Datos
// inventados (T11).

import { describe, expect, it } from 'vitest'
import { tarjetasDelPortal } from '@/modules/conta/gestoria/portal/pendiente'
import { nombreFichero } from '@/modules/conta/gestoria/portal/datos'

const vacio = { mensajes: [], incidencias: [], solicitudes: [], subidas: [] }

describe('lo del portal en «Lo que tienes que hacer»', () => {
  it('sin nada, ninguna tarjeta', () => {
    expect(tarjetasDelPortal(vacio)).toEqual([])
  })

  it('cada cosa con su número, agrupada por cliente, sin esconder ninguna (regla 7)', () => {
    const t = tarjetasDelPortal({
      mensajes: [{ cliente_id: 'c1', cliente: 'Cliente Uno, S.L.', sin_leer: 2, ultimo: '2026-11-09T10:00:00Z' }, { cliente_id: 'c2', cliente: 'Cliente Dos, S.L.', sin_leer: 1, ultimo: '2026-11-09T11:00:00Z' }],
      incidencias: [{ id: 'i1', cliente_id: 'c1', cliente: 'Cliente Uno, S.L.', tipo: 'cambio_datos', texto: 'x', cuando: '2026-11-09' }],
      solicitudes: [{ id: 's1', cliente_id: 'c1', cliente: 'Cliente Uno, S.L.', tipo: 'alta', nombre: 'Persona Ejemplo', fecha: '2026-12-01', cuando: '2026-11-09', desde_el_portal: true }],
      subidas: [{ id: 'u1', cliente_id: 'c2', cliente: 'Cliente Dos, S.L.', nombre: 'factura.pdf', estado: 'sin_buzon', cuando: '2026-11-09' }],
    })
    expect(t.map((x) => [x.id, x.n])).toEqual([['pide', 2], ['mensajes', 3], ['subidas', 1]])
    expect(t[0].clientes).toEqual([{ id: 'c1', nombre: 'Cliente Uno, S.L.', que: 'Alta de Persona Ejemplo · Quiere cambiar sus datos' }])
    expect(t[1].titulo).toBe('Mensajes sin leer')
    expect(t[2].titulo).toBe('Documento sin llegar al buzón')
  })

  it('el PDF para firmar: sin carpetas, tildes ni raros', () => {
    expect(nombreFichero('C:\\docs\\Contrato de servicios año 2027.pdf')).toBe('Contrato_de_servicios_ano_2027.pdf')
    expect(nombreFichero('../../.oculto.pdf')).toBe('oculto.pdf')
    expect(nombreFichero('')).toBe('documento.pdf')
  })
})
