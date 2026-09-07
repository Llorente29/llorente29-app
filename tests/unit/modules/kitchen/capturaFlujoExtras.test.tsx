// Los TRES pasos del flujo de Extras, para ponerlos al lado de `Flujo.dc.html`
// (§13.3 del encargo). Mismo método que `capturaExtras`: los componentes REALES
// con el CSS que sale del build, no un HTML escrito para la foto.
//
// LOS DATOS SON LOS DE PRODUCCIÓN, medidos el 07/09 (regla 31), y en dos sitios
// no coinciden con el tablero — el tablero es el que se hizo a mano:
//  · Yogur griego cuesta 0,00659 €/g, así que 40 g son 0,26 €, no los 0,18 €
//    del tablero. Va el real: es el número que va a ver Julio al probarlo.
//  · «Tiras de Pollo Kentucky (4 uds)» son TRES copias —Dirty Burger 6,50 €,
//    Mila's 1,90 €, Scandal Burgers 1,90 €, ninguna vendida en la ventana— y no
//    incluye la de Smash Brothers, que se llama «, 4 Unidades» y es otro nombre.
//    El tablero usa la normalización de la maqueta, que las funde; la buena es
//    la del RECON (§8), que no. Con las tres reales la puerta enseña lo mismo
//    que el tablero: dos marcadas a 1,90 € y la de 6,50 € fuera, con su motivo.
//
// La confirmación se pinta con `AvisoCocina`, la misma pieza que usa la página
// después de guardar: no una caja verde escrita aquí.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PasoDeLoQueLleva, PuertaDeCopias } from '@/modules/kitchen/components/FlujoDeExtra'
import { AvisoCocina } from '@/modules/kitchen/components/PatronDeKitchen'
import {
  confirmacion, frasedeLoQueLleva, copiasPreseleccionadas, cuantasCopiasEnElTitulo, soloCopias,
  type ExtraPorNombre, type CopiaDelExtra, type CosaQueLleva,
} from '@/modules/kitchen/lib/extrasDeCocina'
import type { CatalogPick } from '@/modules/kitchen/lib/catalogPick'
import type { UnidadPick } from '@/modules/kitchen/lib/impactoResuelto'

// ── Las fichas y la unidad, tal cual están en Foodint ───────────────────────
const GRAMO: UnidadPick = {
  id: '8fc3baae-04cc-4b2c-83cc-7fa0181e74e4', abreviatura: 'g', dimension: 'mass', factorABase: 1,
}
const YOGUR: CatalogPick = {
  id: '30a41a6f-17f0-46d5-9b29-1f1ca8fe54d0', name: 'Yogur griego', type: 'raw',
  kind: 'ingrediente', selectable: true, costeUnitario: 0.00659, baseUnitId: GRAMO.id,
}

// ── Salsa Yogur: 7 copias, Meraki Pita (3) y The Urban Kebab (4), 1,50 € ────
const copia = (o: Partial<CopiaDelExtra>): CopiaDelExtra => ({
  opcion: '', marca: '', marcaId: null, grupo: 'Algun extra en tu pita?',
  precio: 1.5, vendidas: 0, coste: 0, tieneCoste: false, ...o,
})
const SALSA_YOGUR: ExtraPorNombre = {
  clave: 'salsa yogur', nombre: 'Salsa Yogur', copias: 7, marcas: 2,
  vendidas: 23, cobrado: 34.5, precioMin: 1.5, precioMax: 1.5,
  preciosDistintos: false, estado: 'nada_puesto', costeYaPuesto: null, marcaQueYaLoTiene: null,
  donde: [
    copia({ opcion: '0e4624ba', marca: 'Meraki Pita', grupo: '¿Le añadimos salsa?', vendidas: 4 }),
    copia({ opcion: '7e27ec81', marca: 'Meraki Pita' }),
    copia({ opcion: '01b09b0c', marca: 'Meraki Pita', grupo: 'Te apetece un extra?', vendidas: 1 }),
    copia({ opcion: '49781d95', marca: 'The Urban Kebab', vendidas: 18 }),
    copia({ opcion: 'a91d9493', marca: 'The Urban Kebab' }),
    copia({ opcion: 'b43e5327', marca: 'The Urban Kebab' }),
    copia({ opcion: 'fef94329', marca: 'The Urban Kebab' }),
  ],
}

// ── Tiras de Pollo Kentucky (4 uds): 3 copias, dos a 1,90 € y una a 6,50 € ──
const TIRAS: ExtraPorNombre = {
  clave: 'tiras de pollo kentucky (4 uds)', nombre: 'Tiras de Pollo Kentucky (4 uds)',
  copias: 3, marcas: 3, vendidas: 0, cobrado: 0, precioMin: 1.9, precioMax: 6.5,
  preciosDistintos: true, estado: 'nada_puesto', costeYaPuesto: null, marcaQueYaLoTiene: null,
  donde: [
    copia({ opcion: '241bedd8', marca: 'Scandal Burgers', grupo: 'Escoge tu entrante', precio: 1.9 }),
    copia({ opcion: '7ab0d492', marca: "Mila's Sandwiches", grupo: 'Escoge tu entrante', precio: 1.9 }),
    copia({ opcion: '268fcb6a', marca: 'Dirty Burger', grupo: '¿Quieres añadir un entrante?.', precio: 6.5 }),
  ],
}

// «La Triple» se cobra como extra Y existe como plato con su escandallo hecho
// (4,0018 €). Es uno de los OCHO casos reales del 07/09; el tablero enseña la
// fila con «Salsa Yogur», que no tiene plato, así que aquí va con el extra que
// de verdad la dispara.
const LA_TRIPLE_PLATO: CatalogPick = {
  id: 'd1f1a4f0-0000-4000-8000-000000000001', name: 'La Triple', type: 'dish',
  // El coste real tiene 40 decimales en la base; aquí va recortado a lo que un
  // double aguanta sin perder precisión — el que se pinta es «4,00 €» igual.
  kind: 'plato', selectable: true, costeUnitario: 4.00176804475978, baseUnitId: null,
}
const LA_TRIPLE: ExtraPorNombre = {
  clave: 'la triple', nombre: 'La Triple', copias: 1, marcas: 1,
  vendidas: 0, cobrado: 0, precioMin: 5, precioMax: 5,
  preciosDistintos: false, estado: 'nada_puesto', costeYaPuesto: null, marcaQueYaLoTiene: null,
  donde: [copia({ opcion: 'la-triple', marca: 'Smash Brothers Burgers', grupo: 'Escoge tu hamburguesa', precio: 5 })],
}

const LLEVA: CosaQueLleva[] = [{
  ficha: YOGUR.id, nombreFicha: YOGUR.name, tipo: 'ingrediente',
  cantidad: 40, unidad: GRAMO.id, nombreUnidad: 'g',
}]
const COSTE = 40 * 0.00659   // 0,2636 € → 0,26 € en pantalla

const nada = () => {}

describe('la captura del flujo', () => {
  // Que la foto sea de lo que se va a ver, no de un caso que no existe.
  it('los datos del tablero son los de producción', () => {
    expect(SALSA_YOGUR.donde).toHaveLength(SALSA_YOGUR.copias)
    expect(cuantasCopiasEnElTitulo(SALSA_YOGUR)).toBe('7 copias en 2 marcas')
    // La puerta marca las dos de 1,90 € y deja fuera la de 6,50 €.
    const marcadas = copiasPreseleccionadas(TIRAS)
    expect(marcadas).toHaveLength(2)
    expect(marcadas).not.toContain('268fcb6a')
    expect(frasedeLoQueLleva(LLEVA)).toBe('40 g de yogur griego'.replace('yogur griego', 'Yogur griego'))
  })

  it('genera los tres pasos a 1240', () => {
    const caja = (hijos: string) =>
      `<div class="cocina w-[560px] bg-cocina-superficie border border-cocina-linea `
      + `rounded-cocina-md shadow-cocina py-[18px] px-5 flex flex-col gap-3">${hijos}</div>`

    const titulo = (crumb: string, h2: string) =>
      `<div class="flex items-start justify-between gap-3"><div>`
      + `<div class="text-[11px] font-bold tracking-[0.08em] uppercase text-cocina-tinta-3">${crumb}</div>`
      + `<h2 class="text-[17px] font-bold mt-1 text-cocina-tinta">${h2}</h2></div>`
      + `<span class="text-cocina-tinta-3">✕</span></div>`

    const paso1 = caja(
      titulo('Paso 1 · Decir qué lleva',
        `Salsa Yogur · ${cuantasCopiasEnElTitulo(SALSA_YOGUR)} · cobra 1,50 €`)
      + renderToStaticMarkup(
        <PasoDeLoQueLleva
          extra={SALSA_YOGUR}
          elegidas={SALSA_YOGUR.donde.map((d) => d.opcion)}
          cosas={LLEVA}
          catalogo={[YOGUR]}
          unidades={[GRAMO]}
          coste={COSTE}
          completo
          guardando={false}
          onCosas={nada}
          onCancelar={nada}
          onGuardar={nada}
        />,
      ),
    )

    const puerta = caja(
      titulo('Cuando las copias no cobran lo mismo',
        `Tiras de Pollo Kentucky (4 uds) · ${soloCopias(TIRAS)}`)
      + renderToStaticMarkup(
        <PuertaDeCopias
          extra={TIRAS}
          elegidas={copiasPreseleccionadas(TIRAS)}
          onCambiar={nada}
          onCancelar={nada}
          onSeguir={nada}
        />,
      ),
    )

    const alGuardar = caja(
      `<div class="text-[11px] font-bold tracking-[0.08em] uppercase text-cocina-tinta-3">Al guardar</div>`
      + renderToStaticMarkup(
        <AvisoCocina>
          {confirmacion({
            nombre: SALSA_YOGUR.nombre,
            queLleva: frasedeLoQueLleva(LLEVA),
            coste: COSTE,
            copias: SALSA_YOGUR.donde,
            sinCosteDespues: 91,
          })}
        </AvisoCocina>,
      ),
    )

    // El cuarto: el mismo paso 1 cuando el extra YA existe como plato.
    const conPlato = caja(
      titulo('Paso 1 · cuando ya existe como plato',
        `La Triple · ${cuantasCopiasEnElTitulo(LA_TRIPLE)} · cobra 5,00 €`)
      + renderToStaticMarkup(
        <PasoDeLoQueLleva
          extra={LA_TRIPLE}
          elegidas={['la-triple']}
          cosas={[]}
          catalogo={[LA_TRIPLE_PLATO, YOGUR]}
          unidades={[GRAMO]}
          coste={null}
          completo={false}
          guardando={false}
          onCosas={nada}
          onCancelar={nada}
          onGuardar={nada}
        />,
      ),
    )

    const dist = resolve(__dirname, '../../../../dist/assets')
    const css = readdirSync(dist).filter((f) => f.startsWith('index-') && f.endsWith('.css'))[0]
    const hoja = readFileSync(resolve(dist, css), 'utf8')

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${hoja}</style>
<style>html,body{margin:0;background:#EAEEF1}</style></head>
<body>
<div style="display:flex;gap:40px;padding:30px;background:#EAEEF1;width:1240px;align-items:flex-start">${paso1}${puerta}</div>
<div style="display:flex;gap:40px;padding:0 30px 30px;background:#EAEEF1;width:1240px;align-items:flex-start">${alGuardar}${conPlato}</div>
</body></html>`

    writeFileSync(resolve(__dirname, '../../../../dist/captura_flujo_extras.html'), html)
    expect(html).toContain('0,26 €')          // el coste real, no el del tablero
    expect(html).toContain('¿Es un plato entero?')
    expect(html).toContain('4,00 €')          // el escandallo de La Triple, real
    expect(html).toContain('Sin coste quedan 91.')
    expect(html).not.toMatch(/add_item|bundle|confirmed|modifier_option/)
  })
})
