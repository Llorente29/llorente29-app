import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Cifra, Campo } from '@/modules/kitchen/components/PatronDeKitchen'

// EL CONTRATO DE PÍXEL DEL PATRÓN, ESCRITO.
//
// Mismo trato que `KpiCard`: al sacar la cifra y el campo de dentro de
// Rentabilidad a un componente compartido, las tres pantallas tienen que quedar
// igual. Si algo cambia de aspecto es un fallo del refactor, no una mejora.
//
// Estas cadenas son EXACTAMENTE las que tenía Rentabilidad antes de extraerlas.
// No se retocan «para limpiarlas»: son el contrato.

describe('Cifra · el marcado del patrón no cambia', () => {
  it('las clases exactas del envoltorio, el título, el número y el pie', () => {
    const html = renderToStaticMarkup(
      <Cifra titulo="Platos en carta" valor="33" pie="27 con coste · 6 sin coste" />,
    )
    expect(html).toContain('class="bg-card border border-border-default rounded-lg p-3"')
    expect(html).toContain('class="text-[11px] text-text-secondary"')
    expect(html).toContain('class="text-2xl font-semibold mt-0.5 text-text-primary"')
    expect(html).toContain('class="text-[11px] text-text-secondary mt-1 leading-snug"')
    expect(html).toContain('Platos en carta')
    expect(html).toContain('33')
    expect(html).toContain('27 con coste · 6 sin coste')
  })

  it('con alerta el número va en rojo, y sólo el número', () => {
    const html = renderToStaticMarkup(
      <Cifra titulo="Vendidos sin saber el coste" valor="89" pie="de 2.053" alerta />,
    )
    expect(html).toContain('class="text-2xl font-semibold mt-0.5 text-danger"')
    // El título y el pie NO se tiñen: la alerta es del dato, no de la tarjeta.
    expect(html).not.toContain('text-danger">Vendidos')
  })

  it('sin alerta no aparece el rojo por ninguna parte', () => {
    const html = renderToStaticMarkup(<Cifra titulo="x" valor="1" pie="y" />)
    expect(html).not.toContain('text-danger')
  })

  // Una cifra sin pie no cumple el patrón: es un número sin dueño. El tipo lo
  // exige, y aquí queda escrito que el hueco se pinta igualmente si llega vacío.
  it('el nodo del pie existe aunque el texto esté vacío', () => {
    const html = renderToStaticMarkup(<Cifra titulo="x" valor="1" pie="" />)
    expect(html).toContain('class="text-[11px] text-text-secondary mt-1 leading-snug"')
  })
})

describe('Campo · el marcado del patrón no cambia', () => {
  it('etiqueta pequeña en mayúsculas y el control debajo', () => {
    const html = renderToStaticMarkup(
      <Campo label="Marca"><select /></Campo>,
    )
    expect(html).toContain('class="flex flex-col gap-1"')
    expect(html).toContain('class="text-[11px] uppercase tracking-wide text-text-secondary"')
    expect(html).toContain('Marca')
    expect(html).toContain('<select')
  })
})
