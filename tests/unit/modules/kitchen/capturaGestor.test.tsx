// Las capturas a 1280 de las dos piezas que faltaban del gestor: mirar un
// plato desde dentro, y buscar por lo que las cosas LLEVAN.
//
// LOS DATOS SON REALES (regla 31), y de DOS medidas, una por pantalla:
//   · `kitchen_preguntas_de_un_plato` sobre «Kebab Combo Duo» (The Urban
//     Kebab), 13/09 20:1x. Es el plato con más preguntas de Foodint.
//   · `kitchen_buscar('…','harissa',12)`, 13/09 20:2x, ya con la corrección
//     que agrupa las respuestas por nombre.
//
// Las dos traen dentro algo que yo no había escrito y los datos sí:
//   1. «Kebab Combo Duo» tiene DOS preguntas OBLIGATORIAS con CERO respuestas
//      activas. No es una pregunta fea: es un plato que el cliente no puede
//      terminar de pedir.
//   2. «Sin Salsa Harisa» —con la errata, una sola ese— sale buscando
//      «harissa» porque su FICHA es Harissa. Por nombre no aparecería jamás.
//
// Y la foto usa LAS MISMAS PIEZAS que la pantalla, comprobado abajo leyendo
// los dos ficheros: una foto con piezas propias vale menos de lo que parece.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchRoutes } from 'react-router-dom'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina, PastillaCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { kitchenModule } from '@/modules/kitchen/module'
import {
  laReglaDelPlato, deQuienEsLaCarta, respuestasEnTexto, dondeMasEsta,
  loQueHayQueMirar, textoDeQuitar, loQuePasaSiQuitas,
  type ElPlato, type PreguntaDelPlato, type LoQuePreguntaElPlato,
} from '@/modules/kitchen/lib/desdeElPlato'
import { quePuedeHacerElCliente, queHaceEnElPlato } from '@/modules/kitchen/lib/preguntasDeCocina'
import {
  LA_CAJA, laReglaDeLaBusqueda, porQueHaSalido, tituloDeRespuestas,
  tituloDePreguntas, tituloDePlatos, lasCopiasDeUnaRespuesta, loQueNoCabe,
  type LoEncontrado,
} from '@/modules/kitchen/lib/laBusqueda'
import { fmtMoney } from '@/lib/format'

// ── Los datos, de dos medidas ──────────────────────────────────────────────

const PLATO: ElPlato = {
  id: 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70', nombre: 'Kebab Combo Duo',
  precio: 20.5, marca: 'The Urban Kebab',
  marcaId: '5a230c99-1de4-47ca-82fb-65d4af589176',
  cedida: false, activo: true, archivado: false,
}

function P(x: Partial<PreguntaDelPlato>): PreguntaDelPlato {
  return {
    id: '', nombre: '', tipo: 'elige', min: 1, max: 1, obligatoria: true,
    repetible: false, dePago: false, activa: true, posicion: 0,
    respuestas: 0, sinDecidir: 0, otrosPlatos: 0,
    sePuedeQuitar: true, porQueNo: null, ...x,
  }
}

const EL_PLATO: LoQuePreguntaElPlato = {
  plato: PLATO,
  cuantas: 7,
  preguntas: [
    P({ id: 'eebb564c', nombre: '1. Escoge tu primer kebab', respuestas: 0, otrosPlatos: 1, posicion: 0 }),
    P({ id: '8819014c', nombre: '1. Elige el tipo de carne de tu primer Kebab', respuestas: 4, dePago: true, otrosPlatos: 1, posicion: 1 }),
    P({ id: 'e1692b3d', nombre: '1. Escoge la salsa para tu primer kebab', respuestas: 2, max: 3, otrosPlatos: 1, posicion: 2 }),
    P({ id: 'a58d72e7', nombre: '2. Escoge tu segundo kebab', respuestas: 0, otrosPlatos: 0, posicion: 3 }),
    P({ id: 'a6a59e57', nombre: '2. Elige el tipo de carne de tu 2º Kebab', respuestas: 4, dePago: true, otrosPlatos: 0, posicion: 4 }),
    P({ id: 'e4942692', nombre: '2. Escoge la salsa para tu segundo kebab', respuestas: 2, max: 3, otrosPlatos: 0, posicion: 5 }),
    P({ id: '02668c11', nombre: 'Escoge tu entrante favorito', respuestas: 3, sinDecidir: 1, dePago: true, otrosPlatos: 1, posicion: 6 }),
  ],
}

const HARISSA: LoEncontrado = {
  texto: 'harissa', corto: false, tope: 12,
  cuantas: { fichas: 2, preguntas: 18, respuestas: 18, respuestasDistintas: 2, platos: 34 },
  fichas: [
    { id: '9d5cc2d5', nombre: 'Pasta Harissa' },
    { id: '8dc46a08', nombre: 'Salsa Mayo Harissa' },
  ],
  respuestas: [
    { id: 'r1', nombre: 'Salsa Harissa (Picante)', copias: 13, preguntas: 13, marcas: 2,
      marca: 'Meraki Pita', algunaActiva: true, todasActivas: true,
      ficha: 'Salsa Mayo Harissa', porque: 'las_dos' },
    { id: 'r2', nombre: 'Sin Salsa Harisa', copias: 5, preguntas: 5, marcas: 2,
      marca: 'Meraki Pita', algunaActiva: true, todasActivas: true,
      ficha: 'Salsa Mayo Harissa', porque: 'lleva_eso' },
  ],
  preguntas: [
    { id: 'p1', nombre: 'Escoge una salsa para tu pita', marca: 'Meraki Pita',
      cedida: true, activa: true, respuestas: 8, porque: 'lleva_eso', cuantasRespuestasSalen: 2 },
    { id: 'p2', nombre: 'Quieres quitar aguna salsa de tu kebab?', marca: 'The Urban Kebab',
      cedida: false, activa: true, respuestas: 5, porque: 'lleva_eso', cuantasRespuestasSalen: 1 },
  ],
  platos: [
    { id: 'm1', nombre: 'Kebab de Pollo Gyros 🌯', marca: 'Meraki Pita', cedida: true,
      porque: 'su_pregunta_lleva_eso', cuantasPreguntasSalen: 3 },
    { id: 'm2', nombre: 'Patatas Clásicas Meraki', marca: 'Meraki Pita', cedida: true,
      porque: 'su_pregunta_lleva_eso', cuantasPreguntasSalen: 1 },
  ],
}

/**
 * La raya. Las guardas de abajo se leen a sí mismas si se mira el fichero
 * entero —sus comentarios llevan el patrón que buscan— y un detector que se
 * detecta a sí mismo no detecta nada.
 */
const RAYA_DE_LAS_GUARDAS = '// ── Las guardas'

function soloLosComponentes(): string {
  const entero = readFileSync(resolve(__dirname, './capturaGestor.test.tsx'), 'utf8')
  const corte = entero.indexOf(RAYA_DE_LAS_GUARDAS)
  if (corte < 0) throw new Error('no encuentro la raya de las guardas')
  return entero.slice(0, corte)
}

const TONO = { rojo: 'rojo', ambar: 'ambar', apagado: 'apagado' } as const

function FilaDelPlato({ p }: { p: PreguntaDelPlato }) {
  const avisos = loQueHayQueMirar(p)
  return (
    <div className="px-4 py-3 border-t border-cocina-linea first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-cocina-tinta truncate">{p.nombre}</div>
          <div className="text-[12px] text-cocina-tinta-2 mt-0.5">
            {queHaceEnElPlato(p)} · {quePuedeHacerElCliente(p)}
          </div>
          <div className="text-[12px] text-cocina-tinta-3 mt-0.5">
            {respuestasEnTexto(p)} · {dondeMasEsta(p)}
          </div>
          {avisos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {avisos.map((a) => (
                <PastillaCocina key={a.texto} tono={TONO[a.tono]}>{a.texto}</PastillaCocina>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0">
          <BotonCocina peso="borde" disabled={!p.sePuedeQuitar}>{textoDeQuitar(p)}</BotonCocina>
        </div>
      </div>
    </div>
  )
}

function FilaEncontrada({
  nombre, debajo, motivo,
}: { nombre: string; debajo: string; motivo: string }) {
  return (
    <div className="px-4 py-2.5 border-t border-cocina-linea first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-cocina-tinta truncate">{nombre}</div>
          <div className="text-[12px] text-cocina-tinta-3 mt-0.5">{debajo}</div>
        </div>
        <span className="shrink-0 text-[11.5px] text-cocina-acento font-semibold">{motivo}</span>
      </div>
    </div>
  )
}

function FotoDelPlato() {
  return (
    <div className="cocina" style={{ width: 1280, padding: 24 }}>
      <CabeceraCocina
        migaja="Preguntas de la carta"
        pregunta={EL_PLATO.plato.nombre}
        regla={`${laReglaDelPlato(EL_PLATO)} ${deQuienEsLaCarta(EL_PLATO.plato)}.`}
      >
        <div className="text-[12.5px] text-cocina-tinta-3">{fmtMoney(EL_PLATO.plato.precio)}</div>
      </CabeceraCocina>
      <div className="mt-4">
        <PanelCocina>
          <RotuloDePanel derecha={<>{EL_PLATO.cuantas} en total</>}>
            En el orden en que las ve el cliente
          </RotuloDePanel>
          {EL_PLATO.preguntas.map((p) => <FilaDelPlato key={p.id} p={p} />)}
        </PanelCocina>
      </div>
      <div className="mt-3 text-[12px] text-cocina-tinta-2">
        {loQuePasaSiQuitas(EL_PLATO.preguntas[3], EL_PLATO.plato)}
      </div>
    </div>
  )
}

function FotoDeBuscar() {
  const q = HARISSA.texto
  return (
    <div className="cocina" style={{ width: 1280, padding: 24 }}>
      <CabeceraCocina migaja="Preguntas de la carta" pregunta="Buscar"
        regla={laReglaDeLaBusqueda(HARISSA)} />
      <div className="mt-4">
        <div className="w-full h-[42px] px-3 rounded-cocina border border-cocina-linea bg-cocina-superficie text-[14px] text-cocina-tinta flex items-center">
          {q}
        </div>
        <div className="text-[11.5px] text-cocina-tinta-3 mt-1">{LA_CAJA}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {HARISSA.fichas.map((f) => (
          <PastillaCocina key={f.id} tono="verde">{f.nombre}</PastillaCocina>
        ))}
      </div>
      <div className="mt-4">
        <PanelCocina>
          <RotuloDePanel>{tituloDeRespuestas(HARISSA)}</RotuloDePanel>
          {HARISSA.respuestas.map((x) => (
            <FilaEncontrada key={x.id} nombre={x.nombre}
              debajo={`${lasCopiasDeUnaRespuesta(x)}${x.ficha ? ` · lleva ${x.ficha}` : ''}`}
              motivo={porQueHaSalido(x.porque, q)} />
          ))}
        </PanelCocina>
      </div>
      <div className="mt-4">
        <PanelCocina>
          <RotuloDePanel>{tituloDePreguntas(HARISSA)}</RotuloDePanel>
          {HARISSA.preguntas.map((x) => (
            <FilaEncontrada key={x.id} nombre={x.nombre}
              debajo={`${x.marca}${x.cedida ? ' · cedida' : ''} · ${x.respuestas} respuestas`}
              motivo={porQueHaSalido(x.porque, q)} />
          ))}
          <div className="px-4 py-2.5 border-t border-cocina-linea text-[12px] text-cocina-tinta-3">
            {loQueNoCabe(HARISSA.preguntas.length, HARISSA.cuantas.preguntas)}
          </div>
        </PanelCocina>
      </div>
      <div className="mt-4">
        <PanelCocina>
          <RotuloDePanel>{tituloDePlatos(HARISSA)}</RotuloDePanel>
          {HARISSA.platos.map((x) => (
            <FilaEncontrada key={x.id} nombre={x.nombre}
              debajo={`${x.marca}${x.cedida ? ' · cedida' : ''}`}
              motivo={porQueHaSalido(x.porque, q)} />
          ))}
          <div className="px-4 py-2.5 border-t border-cocina-linea text-[12px] text-cocina-tinta-3">
            {loQueNoCabe(HARISSA.platos.length, HARISSA.cuantas.platos)}
          </div>
        </PanelCocina>
      </div>
    </div>
  )
}

// ── Las guardas ────────────────────────────────────────────────────────────

const HTML_PLATO = renderToStaticMarkup(<FotoDelPlato />)
const HTML_BUSCAR = renderToStaticMarkup(<FotoDeBuscar />)

describe('las dos fotos se pintan', () => {
  it('y se dejan en dist para poder mirarlas', () => {
    expect(HTML_PLATO.length).toBeGreaterThan(1000)
    expect(HTML_BUSCAR.length).toBeGreaterThan(1000)
    const dist = resolve(__dirname, '../../../../dist')
    if (existsSync(dist)) {
      writeFileSync(resolve(dist, 'captura_gestor_plato.html'), HTML_PLATO)
      writeFileSync(resolve(dist, 'captura_gestor_buscar.html'), HTML_BUSCAR)
    }
  })
})

describe('🔴 las fotos cuadran consigo mismas', () => {
  it('el plato: las siete filas son las siete que dice la cabecera', () => {
    expect(EL_PLATO.preguntas).toHaveLength(EL_PLATO.cuantas)
    expect(HTML_PLATO).toContain('7 en total')
    expect(HTML_PLATO).toContain('le hace 7 preguntas')
  })

  it('buscar: 13 + 5 copias son las 18 filas, y son 2 nombres', () => {
    const copias = HARISSA.respuestas.reduce((a, r) => a + r.copias, 0)
    expect(copias).toBe(HARISSA.cuantas.respuestas)
    expect(HARISSA.respuestas).toHaveLength(HARISSA.cuantas.respuestasDistintas)
    expect(HTML_BUSCAR).toContain('2 respuestas')
  })

  it('y el corte se dice en las dos listas cortadas, con el número exacto', () => {
    expect(HTML_BUSCAR).toContain('Hay 16 más')   // 18 preguntas, 2 en la foto
    expect(HTML_BUSCAR).toContain('Hay 32 más')   // 34 platos, 2 en la foto
  })
})

describe('🔴 lo que los datos trajeron y yo no había escrito', () => {
  it('las dos obligatorias sin respuestas se ven en la foto, en rojo', () => {
    expect(HTML_PLATO).toContain('el cliente no puede terminar el pedido')
    const veces = HTML_PLATO.split('el cliente no puede terminar el pedido').length - 1
    expect(veces).toBe(2)
  })

  it('«Sin Salsa Harisa» sale en la foto, y dice que sale por lo que lleva', () => {
    expect(HTML_BUSCAR).toContain('Sin Salsa Harisa')
    expect(HTML_BUSCAR).toContain('Lleva harissa')
    expect(HTML_BUSCAR).toContain('Salsa Mayo Harissa')
  })
})

describe('🔴 ningún aviso escrito a mano en la foto', () => {
  it('todo lo que se pinta sale de una función de la lib', () => {
    // Si aquí aparece un literal, la foto puede enseñar algo que la pantalla
    // no sabe decir — que es como se llega a una captura que miente.
    const codigo = soloLosComponentes()
    expect(codigo).not.toMatch(/<PastillaCocina[^>]*>[^<{]/)
    expect(codigo).not.toMatch(/<BotonCocina[^>]*>[^<{]/)
  })
})

describe('🔴 las pantallas de verdad usan estas mismas piezas', () => {
  const pantalla = (n: string) =>
    readFileSync(resolve(__dirname, `../../../../src/modules/kitchen/pages/${n}`), 'utf8')

  it('la del plato existe, usa las piezas y llama a la lib', () => {
    const p = pantalla('KitchenPlatoPreguntasPage.tsx')
    for (const pieza of ['CabeceraCocina', 'PanelCocina', 'RotuloDePanel', 'BotonCocina', 'PastillaCocina']) {
      expect(p, `la pantalla no usa ${pieza}`).toContain(pieza)
    }
    for (const f of ['loQueHayQueMirar', 'loQuePasaSiQuitas', 'laConfirmacionDeQuitar', 'textoDeQuitar']) {
      expect(p, `la pantalla no llama a ${f}`).toContain(f)
    }
    // El número nuevo lo dice la BASE, no una resta en el navegador.
    expect(p).not.toMatch(/cuantas\s*-\s*1|leQuedan\s*-\s*1/)
  })

  it('la de buscar existe, usa las piezas y dice el motivo de cada fila', () => {
    const p = pantalla('KitchenBuscarPage.tsx')
    for (const pieza of ['CabeceraCocina', 'PanelCocina', 'RotuloDePanel', 'PastillaCocina']) {
      expect(p, `la pantalla no usa ${pieza}`).toContain(pieza)
    }
    expect(p).toContain('porQueHaSalido')
    expect(p).toContain('loQueNoCabe')
  })
})

describe('🔴 las dos rutas existen de verdad', () => {
  const rutas = kitchenModule.routes.map((r) => ({ path: `/kitchen/${r.path}`, element: r.element }))

  it('se llega al plato y a buscar', () => {
    expect(matchRoutes(rutas, '/kitchen/platos/a53c577d-0b8e-4a5c-8d78-bae73c2b8a70')).not.toBeNull()
    expect(matchRoutes(rutas, '/kitchen/buscar')).not.toBeNull()
  })

  it('y buscar está en la barra lateral, que es por donde se entra', () => {
    const ids = kitchenModule.sidebar?.items.map((i) => i.id) ?? []
    expect(ids).toContain('kitchen_buscar')
  })
})

describe('🔴 palabras de la casa: ningún identificador en pantalla', () => {
  it('ni uuids ni nombres de columna en lo que se pinta', () => {
    for (const html of [HTML_PLATO, HTML_BUSCAR]) {
      const texto = html.replace(/<[^>]*>/g, ' ')
      expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
      expect(texto).not.toMatch(/account_id|modifier_group|recipe_item|menu_item|_id\b/)
      expect(texto).not.toMatch(/add_item|remove_item|impact_type|ownership_type/)
      expect(texto).not.toMatch(/undefined|NaN|\[object Object\]/)
    }
  })

  it('y ninguna hora de reloj, que es de qué huso nunca se sabe', () => {
    for (const html of [HTML_PLATO, HTML_BUSCAR]) {
      expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\b\d{1,2}:\d{2}\b/)
    }
  })
})
