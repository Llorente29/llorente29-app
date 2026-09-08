import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Cifra, Campo, CabeceraDeBloque, RotuloDePanel } from '@/modules/kitchen/components/PatronDeKitchen'

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

// ── B83 · las dos cabeceras, que son DOS y no una ──────────────────────────
//
// Había cuatro copias escritas a mano de «la cabecera de dentro del panel», y
// sólo la de Extras estaba bien: Rentabilidad e Ingeniería habían escrito la
// suya con el marcado de `.panel-h` —11 px, versalitas, separadas a los
// extremos— cuando la maqueta ahí pone `.qh`, que es 14 px y con la explicación
// AL LADO. Nadie lo habría visto comparando una pantalla consigo misma.
//
// Aquí quedan las dos fijadas, y la diferencia escrita: `CabeceraDeBloque`
// agrupa filas dentro de un panel; `RotuloDePanel` rotula el panel entero.

describe('CabeceraDeBloque · `.qh` de la maqueta', () => {
  it('el nombre en 14 px y la explicación al lado, no en la otra punta', () => {
    const html = renderToStaticMarkup(
      <CabeceraDeBloque nombre="Lastres · 8" detalle="por debajo de la media en las dos cosas" />,
    )
    expect(html).toContain('class="flex items-baseline gap-2.5 px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2"')
    expect(html).toContain('class="text-[14px] font-bold text-cocina-tinta"')
    expect(html).toContain('class="text-[12px] text-cocina-tinta-3"')
    // `justify-between` es de la OTRA pieza: aquí separaría el nombre de lo que
    // lo explica, que fue exactamente el fallo.
    expect(html).not.toContain('justify-between')
  })

  it('sin detalle no se pinta un hueco vacío', () => {
    const html = renderToStaticMarkup(<CabeceraDeBloque nombre="Lastres · 8" />)
    expect(html).not.toContain('text-cocina-tinta-3')
  })
})

describe('RotuloDePanel · `.panel-h` de la maqueta', () => {
  it('versalitas de 11 px, a los dos extremos y SIN fondo gris', () => {
    const html = renderToStaticMarkup(
      <RotuloDePanel derecha="tuyas primero · de terceros después">
        Por marca · comida sobre ventas
      </RotuloDePanel>,
    )
    expect(html).toContain('class="flex justify-between items-center gap-3 px-4 py-2.5 border-b border-cocina-linea-suave text-[11px] font-bold tracking-[0.09em] uppercase text-cocina-tinta-3"')
    // El fondo gris es de `.qh` y de las cabeceras de columna. `.panel-h` no lo
    // lleva: con él el rótulo pesaba lo mismo que una fila de datos.
    expect(html).not.toContain('bg-cocina-superficie-2')
  })

  // Las dos mitades en el MISMO tono, como la maqueta. La derecha la tenía yo en
  // `text-cocina-tinta-2` diciendo en un comentario «como el tablero», y el
  // tablero no hace eso: era mío.
  it('las dos mitades en el mismo tono', () => {
    const html = renderToStaticMarkup(<RotuloDePanel derecha="B">A</RotuloDePanel>)
    expect(html).not.toContain('text-cocina-tinta-2')
  })
})
