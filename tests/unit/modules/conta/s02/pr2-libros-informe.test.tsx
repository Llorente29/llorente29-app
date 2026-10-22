// tests/unit/modules/conta/s02/pr2-libros-informe.test.tsx
//
// S02 · PR 2 · Lo que la plantilla INFORME aprendió para los estados de
// Libros (balance, PyG, ECPN), pintado con el componente de verdad:
//   · cada cuenta lleva a su Mayor;
//   · la columna del año anterior va en gris (data-apagada);
//   · «Detallado» abre todas las líneas sin botón;
//   · la cifra del lado contrario va en ámbar, y la nota y la marca salen;
//   · lo de antes (la muestra del patrón) se pinta igual: oficial, cambio y
//     el botón de desplegar.

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ComprobacionInforme, TablaInforme, type LineaInforme } from '@/modules/conta/diseno/plantillas'

const pintar = (n: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{n}</MemoryRouter>)

const LINEAS: LineaInforme[] = [
  {
    id: 'ACT.A', calle: 'A) Activo no corriente', nivel: 1, titulo: 'PGC, modelo abreviado', valores: ['10.000,00 €', '8.000,00 €'],
    cuentas: [{ nombre: 'Maquinaria', codigo: '21300000', a: '/conta/mayor/21300000', valores: ['10.000,00 €', '8.000,00 €'] }],
  },
  {
    id: 'ACT.B.III', calle: 'III. Deudores comerciales', nivel: 2, aviso: true, valores: ['-120,00 €', '—'], nota: 'Los clientes a los que debes dinero van al pasivo.',
    cuentas: [{ nombre: 'Clientes', codigo: '43000000', a: '/conta/mayor/43000000', aviso: true, valores: ['-120,00 €', '0,00 €'], extra: <a href="/m">colocada por defecto · Completar</a> }],
  },
  { id: 'ACT.TOTAL', calle: 'Total activo', total: true, valores: ['9.880,00 €', '8.000,00 €'] },
]

describe('TablaInforme en los estados', () => {
  const columnas = ['30/09/2026', { titulo: '2025', apagada: true }] as const
  it('cerrada: un botón por línea con cuentas, con su nombre; el total no se despliega', () => {
    const h = pintar(<TablaInforme etiqueta="Activo" concepto="Partida" columnas={columnas} lineas={LINEAS} />)
    expect(h).toContain('aria-label="Ver las cuentas de «A) Activo no corriente»"')
    expect(h).not.toContain('Ver las cuentas de «Total activo»')
    expect(h).not.toContain('21300000')
    expect(h).toContain('>Partida</th>')
  })
  it('«Detallado»: todas las cuentas a la vista, sin botón, y cada una lleva a su Mayor', () => {
    const h = pintar(<TablaInforme etiqueta="Activo" columnas={columnas} lineas={LINEAS} todasAbiertas />)
    expect(h).not.toContain('s-informe-desplegar')
    expect(h).toContain('href="/conta/mayor/21300000"')
    expect(h).toContain('href="/conta/mayor/43000000"')
    expect(h).toContain('colocada por defecto · Completar')
  })
  it('el año anterior en gris, la cifra del lado contrario en ámbar, la nota debajo, el nivel y la cita al pasar', () => {
    const h = pintar(<TablaInforme etiqueta="Activo" columnas={columnas} lineas={LINEAS} todasAbiertas />)
    expect(h).toMatch(/<th scope="col" class="s-lista-cifra" data-apagada="">2025<\/th>/)
    expect((h.match(/data-apagada=""/g) ?? []).length).toBe(1 + 3 + 2) // la cabecera, las tres líneas y las dos cuentas
    expect(h).toMatch(/data-aviso="">-120,00 €<\/td>/)
    expect(h).toContain('class="s-informe-nota"')
    expect(h).toContain('data-nivel="2"')
    expect(h).toContain('title="PGC, modelo abreviado"')
  })
  it('lo de la muestra se pinta igual: oficial al lado de la calle, y la columna del cambio', () => {
    const h = pintar(<TablaInforme etiqueta="Muestra" columnas={['2026', '2025']} lineas={[{ id: 'v', calle: 'Ventas', oficial: '1. Importe neto de la cifra de negocios', valores: ['1,00', '2,00'], cambio: '-50 %' }]} />)
    expect(h).toContain('<span class="s-informe-oficial"> · 1. Importe neto de la cifra de negocios</span>')
    expect(h).toContain('-50 %')
    expect(h).toContain('>Concepto</th>')
  })
  it('sin nombre oficial no se pinta « · » suelto', () => {
    expect(pintar(<TablaInforme etiqueta="x" columnas={['a']} lineas={[{ id: '1', calle: 'Solo calle', valores: ['1'] }]} />)).not.toContain('s-informe-oficial')
  })
})

describe('ComprobacionInforme', () => {
  it('es un estado con su nombre, y lo que no cuadra va marcado (regla 7)', () => {
    const si = renderToStaticMarkup(<ComprobacionInforme cuadra etiqueta="Cuadre del balance">Cuadra.</ComprobacionInforme>)
    const no = renderToStaticMarkup(<ComprobacionInforme cuadra={false}>No cuadra por 3,00 €.</ComprobacionInforme>)
    expect(si).toContain('role="status"')
    expect(si).toContain('aria-label="Cuadre del balance"')
    expect(si).toContain('data-cuadra="si"')
    expect(no).toContain('data-cuadra="no"')
    expect(no).toContain('No cuadra por 3,00 €.')
  })
})
