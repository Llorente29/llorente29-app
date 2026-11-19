// tests/unit/modules/conta/q06/panelDocumento.test.tsx
//
// Q06 · El panel del documento de la K04 lo usan ya cuatro pantallas del
// núcleo, y tres sesiones le han añadido algo: la K04 (la ficha de la
// recibida: la zona de soltar y «Guardarla sin documento»), la R (Bancos, #732:
// «Qué es» primero y «Falta el justificante»), el asiento (#732) y el listado
// (Q06: «Abrir el asiento» arriba a la derecha y su texto sin documento). Se
// pinta con lo que le pasa cada una y se mira que cada una sigue teniendo lo
// suyo, y que lo de una no aparece en las otras.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/conta/documentos/PapelPdf', () => ({ PapelPdf: ({ titulo }: { titulo: string }) => <div data-pdf={titulo} /> }))
const { PanelDocumento } = await import('@/modules/conta/nucleo/ficha/PanelDocumento')

const pestanas = (html: string) => [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])

describe('Q06 · el panel del documento, con lo de la K04, lo de R y lo del listado', () => {
  it('la K04 (la recibida): El documento primero, la zona de soltar y «Guardarla sin documento»; sin nada del listado', () => {
    const h = renderToStaticMarkup(<PanelDocumento documento={null} otra={{ nombre: 'El mayor del proveedor', contenido: null }} alElegir={() => {}} acepta="application/pdf"
      sinDocumento={{ marcado: false, motivo: '', poner: () => {} }} />)
    expect(pestanas(h)).toEqual(['El documento', 'El mayor del proveedor'])
    expect(h).toContain('Arrastra aquí el PDF o una foto')
    expect(h).toContain('Guardarla sin documento')
    expect(h).not.toContain('kf-panel-accion')
  })
  it('R (Bancos): «Qué es» primero y abierta, y «Falta el justificante»', () => {
    const h = renderToStaticMarkup(<PanelDocumento otraPrimero documento={null} otra={{ nombre: 'Qué es', contenido: <p>lo de Bancos</p> }} alElegir={() => {}}
      tituloSoltar="Falta el justificante" textoSoltar="Arrastra aquí la foto o el PDF del ticket, o pulsa para elegirlo." />)
    expect(pestanas(h)).toEqual(['Qué es', 'El documento'])
    expect(h).toContain('lo de Bancos')
    expect(h).not.toContain('kf-panel-accion')
  })
  it('el asiento: su PDF y «El mayor de la cuenta»', () => {
    const h = renderToStaticMarkup(<PanelDocumento documento={{ url: 'x', foto: false, titulo: 'A-0001.pdf' }} otra={{ nombre: 'El mayor de la cuenta', contenido: null }} />)
    expect(pestanas(h)).toEqual(['El documento', 'El mayor de la cuenta'])
    expect(h).toContain('data-pdf="A-0001.pdf"')
  })
  it('el listado (Q06): «Abrir el asiento» arriba a la derecha y su texto sin documento, sin zona de soltar', () => {
    const h = renderToStaticMarkup(<PanelDocumento documento={null} otra={{ nombre: 'Qué mirar · 3', contenido: null }}
      accion={<button type="button">Abrir el asiento</button>} sinDocumentoTexto="Este movimiento no tiene documento." />)
    expect(pestanas(h)).toEqual(['El documento', 'Qué mirar · 3'])
    expect(h).toMatch(/kf-panel-accion"><button[^>]*>Abrir el asiento</)
    expect(h).toContain('Este movimiento no tiene documento.')
    expect(h).not.toContain('Arrastra aquí')
    expect(h).not.toContain('Guardarla sin documento')
  })
  it('sin el texto del listado, el de siempre de la K04', () => {
    expect(renderToStaticMarkup(<PanelDocumento documento={null} otra={{ nombre: 'Otra', contenido: null }} />)).toContain('Esta factura no tiene documento.')
  })
})
