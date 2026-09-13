// Las capturas a 1280 de los tableros 5 (crear la pregunta) y 3 (ponerla en
// platos), desde los componentes reales y con el CSS del build.
//
// LOS DATOS SON REALES (regla 31). Salen de medir Foodint el 13/09: «Escoge
// una salsa para tu bowl/plato» de Meraki Pita con sus 3 respuestas y su
// etiqueta vieja; los 23 platos y 6 categorías de Dirty Burger. No hay ni un
// nombre inventado, y por eso la foto enseña lo que se va a ver.
//
// Y LA FOTO USA LAS MISMAS PIEZAS QUE LA PANTALLA, comprobado abajo leyendo los
// dos ficheros. Una foto con una cabecera distinta de la de la pantalla hace
// que la comparación valga menos de lo que parece: eso no prueba el diseño,
// prueba que la prueba mide lo que dice medir (regla 38).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina, ChipCocina,
  PastillaCocina, AvisoCocina, InterruptorCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  tituloDelTipo, tituloDelQueLleva, laReglaDeLaPantalla, loQueVeraElCliente,
  precioEnTexto, lineaDelExtra, LOS_QUE_LLEVA, laDeudaDeEstaPregunta,
  elContadorDePlatos, marcarLaCategoria, elCambioEnPlatos, ayudaDeLaCategoria,
  textoDelBotonGuardar,
  laOfertaDeLasIguales, lasQueQuedanFuera, dondeViveLaIgual,
  textoDelBotonDeLasIguales,
  type BorradorDePregunta, type OpcionNueva, type TipoNuevaPregunta,
  type UnaIgual, type UnaQueQuedaFuera,
} from '@/modules/kitchen/lib/crearPreguntaDeCocina'

const LOS_TIPOS: TipoNuevaPregunta[] = ['elige', 'anade', 'quita', 'sugiere']

// ── Los datos, medidos el 13/09 ────────────────────────────────────────────

/** «Escoge una salsa para tu bowl/plato», de Meraki Pita. Etiqueta vieja, 3
 *  respuestas y NINGUNA dice qué lleva: es el caso que estrena el remate. */
const RESPUESTAS: OpcionNueva[] = [
  { extraId: 'o1', nombre: 'Salsa Yogur', precio: 0, queLleva: null,
    yaEstabaDecidido: false, enCuantasPreguntas: 13, queLlevaEnTexto: null },
  { extraId: 'o2', nombre: 'Salsa Tzatziki (Recomendada)', precio: 0, queLleva: 'lleva',
    yaEstabaDecidido: true, enCuantasPreguntas: 11,
    queLlevaEnTexto: '0,2 bote de Salsa Tzatziki 200g' },
  { extraId: 'o3', nombre: 'Salsa Harissa (Picante)', precio: 0, queLleva: null,
    yaEstabaDecidido: false, enCuantasPreguntas: 13, queLlevaEnTexto: null },
]

/** LAS IGUALES DE «Salsa Tzatziki (Recomendada)», medidas el 13/09 en Foodint.
 *  Ese nombre vive en 11 sitios. Quitando el que se está editando quedan 10:
 *  CUATRO sin decidir en marcas propias —y una de ellas en OTRA marca, The
 *  Urban Kebab, que es justo el cruce del que avisó Julio— y SEIS que ya tienen
 *  lo suyo decidido y por eso no se pisan. Ni un nombre inventado. */
const IGUALES: UnaIgual[] = [
  { id: 'i1', nombre: 'Salsa Tzatziki (Recomendada)', marca: 'Meraki Pita',
    pregunta: 'Escoge una salsa para tu pita' },
  { id: 'i2', nombre: 'Salsa Tzatziki (Recomendada)', marca: 'Meraki Pita',
    pregunta: 'Escoge una salsa para tu pita' },
  { id: 'i3', nombre: 'Salsa Tzatziki (Recomendada)', marca: 'Meraki Pita',
    pregunta: 'Te apetece un extra?' },
  { id: 'i4', nombre: 'Salsa Tzatziki (Recomendada)', marca: 'The Urban Kebab',
    pregunta: 'Escoge una salsa para tu bowl/plato' },
]
const FUERA: UnaQueQuedaFuera[] = [
  { id: 'f1', marca: 'Meraki Pita',     pregunta: '¿Le añadimos salsa?',     motivo: 'ya_decidida' },
  { id: 'f2', marca: 'Meraki Pita',     pregunta: 'Algun extra en tu pita?', motivo: 'ya_decidida' },
  { id: 'f3', marca: 'The Urban Kebab', pregunta: 'Algun extra en tu pita?', motivo: 'ya_decidida' },
  { id: 'f4', marca: 'The Urban Kebab', pregunta: 'Algun extra en tu pita?', motivo: 'ya_decidida' },
  { id: 'f5', marca: 'The Urban Kebab', pregunta: 'Algun extra en tu pita?', motivo: 'ya_decidida' },
  { id: 'f6', marca: 'The Urban Kebab', pregunta: 'Algun extra en tu pita?', motivo: 'ya_decidida' },
]
/** La oferta arranca con TODAS marcadas y cada fila se desmarca. En la foto va
 *  una desmarcada a propósito: una lista donde no se puede quitar nada no es
 *  una lista, es un aviso disfrazado. */
const MARCADAS_IGUALES = ['i1', 'i2', 'i4']

const BORRADOR: BorradorDePregunta = {
  marcaId: 'cc89c6eb', marcaNombre: 'Meraki Pita', marcaCedida: false,
  nombre: 'Escoge una salsa para tu bowl/plato',
  tipo: 'elige', max: 1, obligatoria: false, repetible: false,
  opciones: RESPUESTAS, platosElegidos: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
}

/** Dirty Burger: 23 platos vivos en 6 categorías. Medido. */
const CATEGORIAS = [
  { id: 'c1', nombre: 'Bebidas', cuantosPlatos: 5 },
  { id: 'c2', nombre: 'Combo Dirty', cuantosPlatos: 2 },
  { id: 'c3', nombre: 'Dirty Burgers', cuantosPlatos: 3 },
  { id: 'c4', nombre: 'Dirty Doble Burgers', cuantosPlatos: 5 },
  { id: 'c5', nombre: 'Entrantes', cuantosPlatos: 4 },
  { id: 'c6', nombre: 'Postres', cuantosPlatos: 4 },
]
const PLATOS = [
  { id: 'p1', nombre: 'Agua Mineral 50 CL', categoria: 'Bebidas', marcado: false, cuantas: 0 },
  { id: 'p2', nombre: 'Coca-Cola Original Lata', categoria: 'Bebidas', marcado: false, cuantas: 0 },
  { id: 'p3', nombre: 'Coca-Cola Zero Lata', categoria: 'Bebidas', marcado: false, cuantas: 0 },
  { id: 'p4', nombre: 'Combo Dirty', categoria: 'Combo Dirty', marcado: true, cuantas: 4 },
  { id: 'p5', nombre: 'Dirty Cheeseburger', categoria: 'Dirty Burgers', marcado: true, cuantas: 6 },
  { id: 'p6', nombre: 'Dirty Doble Bacon', categoria: 'Dirty Doble Burgers', marcado: true, cuantas: 3 },
  { id: 'p7', nombre: 'Cheesecake de Nutella', categoria: 'Postres', marcado: false, cuantas: 0 },
]
const MARCADOS = PLATOS.filter((p) => p.marcado).map((p) => p.id)

// ── Los dos cuerpos ────────────────────────────────────────────────────────

function Tablero5() {
  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta="Editar la pregunta"
          regla={laReglaDeLaPantalla(BORRADOR)}
        >
          <BotonCocina peso="fantasma">Volver a la lista</BotonCocina>
        </CabeceraCocina>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
          <div className="flex flex-col gap-4">
            <PanelCocina>
              <RotuloDePanel>¿Qué le preguntas al cliente?</RotuloDePanel>
              <div className="px-4 pb-4">
                <div className="w-full h-12 px-3.5 flex items-center text-[18px] font-semibold text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina">
                  {BORRADOR.nombre}
                </div>
                <p className="text-[11.5px] text-cocina-tinta-3 mt-2">
                  Es la frase literal que verá quien pide, en Glovo, en Uber y en la web.
                </p>
              </div>
            </PanelCocina>

            <PanelCocina>
              <RotuloDePanel>¿Cómo se responde?</RotuloDePanel>
              <div className="px-4 pb-4 flex flex-col gap-3.5">
                <div className="flex flex-wrap gap-2">
                  {LOS_TIPOS.map((t) => (
                    <ChipCocina key={t} activo={t === BORRADOR.tipo}>{tituloDelTipo(t)}</ChipCocina>
                  ))}
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                  <InterruptorCocina activo={false} onChange={() => {}}>
                    ¿Tiene que elegir por fuerza?
                  </InterruptorCocina>
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-cocina-tinta">
                    ¿Cuántas puede elegir?
                    <span className="w-16 h-9 flex items-center justify-center bg-cocina-superficie border border-cocina-linea rounded-cocina">1</span>
                  </span>
                  <InterruptorCocina activo={false} onChange={() => {}}>
                    ¿Puede repetir la misma?
                  </InterruptorCocina>
                </div>
              </div>
            </PanelCocina>

            <PanelCocina>
              <RotuloDePanel>
                Las respuestas que puede elegir
                <span className="ml-2 font-normal text-cocina-tinta-3">3 respuestas</span>
              </RotuloDePanel>

              <div className="mx-4 mb-3 rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-ambar-bg text-cocina-ambar border border-cocina-ambar/35">
                <b>{laDeudaDeEstaPregunta(RESPUESTAS)}</b>
                <div className="mt-1 text-cocina-tinta-2">
                  No hace falta para guardar: puedes dejarlas como están y volver otro
                  día. Pero mientras no lo digan, esas respuestas se venden sin
                  descontar nada del almacén.
                </div>
              </div>

              <div className="px-4 pb-4 flex flex-col gap-2.5">
                {RESPUESTAS.map((r) => (
                  <div key={r.nombre} className="rounded-cocina border border-cocina-linea bg-cocina-superficie p-3 flex flex-col gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 min-w-0 h-9 px-3 flex items-center text-[13.5px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina">
                        {r.nombre}
                      </div>
                      <span className="flex items-center gap-1.5 text-[12px] text-cocina-tinta-3 shrink-0">
                        suma
                        <span className="w-20 h-9 px-2 flex items-center justify-end text-[13.5px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina">
                          {precioEnTexto(r.precio) === 'No cobra' ? '0,00' : precioEnTexto(r.precio)}
                        </span>
                        <span className="text-cocina-tinta-2">€</span>
                      </span>
                      <span className="shrink-0 w-9 h-9 rounded-cocina border border-cocina-linea text-cocina-tinta-3 flex items-center justify-center">✕</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-cocina-tinta-3">Qué lleva</span>
                      {LOS_QUE_LLEVA.map((q) => (
                        <ChipCocina key={q} activo={r.queLleva === q}>{tituloDelQueLleva(q)}</ChipCocina>
                      ))}
                    </div>
                    {r.queLleva !== null && r.queLleva !== 'no_lleva_nada' && r.queLleva !== 'es_un_plato' && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex-1 min-w-[220px] h-9 px-3 flex items-center text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina">
                          {r.queLlevaEnTexto}
                        </div>
                        <span className="flex items-center gap-1.5 text-[12px] text-cocina-tinta-3">
                          cantidad
                          <span className="w-20 h-9 px-2 flex items-center justify-end text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina">0,2</span>
                        </span>
                      </div>
                    )}
                    {/* LA OFERTA, en la fila que acaba de decidirse y sin abrir
                        nada encima: la decisión y su alcance se leen del tirón. */}
                    {r.extraId === 'o2' && (
                      <div className="rounded-cocina border border-cocina-acento/40 bg-cocina-acento-bg px-3 py-2.5 flex flex-col gap-2">
                        <div className="text-[12.5px] font-semibold text-cocina-acento-ink">
                          {laOfertaDeLasIguales(IGUALES)}
                        </div>
                        <div className="flex flex-col gap-1">
                          {IGUALES.map((i) => {
                            const marcada = MARCADAS_IGUALES.includes(i.id)
                            return (
                              <span key={i.id} className="flex items-center gap-2 text-left text-[12px] text-cocina-tinta">
                                <span className={`shrink-0 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] font-bold ${
                                  marcada ? 'bg-cocina-acento border-cocina-acento text-white'
                                          : 'border-cocina-linea text-transparent bg-cocina-superficie'}`}>✓</span>
                                <span className="truncate">{dondeViveLaIgual(i)}</span>
                              </span>
                            )
                          })}
                        </div>
                        <div className="text-[11px] text-cocina-tinta-3">{lasQueQuedanFuera(FUERA)}</div>
                        <div>
                          <BotonCocina peso="borde">
                            {textoDelBotonDeLasIguales(MARCADAS_IGUALES.length)}
                          </BotonCocina>
                        </div>
                      </div>
                    )}
                    <div className="text-[11.5px] text-cocina-tinta-3">
                      {lineaDelExtra(r, true)}
                      {r.enCuantasPreguntas > 1 && (
                        <span className="ml-1.5">
                          <PastillaCocina tono="apagado">
                            cambiarlo aquí no lo cambia en las otras {r.enCuantasPreguntas - 1}
                          </PastillaCocina>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div><BotonCocina peso="borde">+ Añadir una respuesta</BotonCocina></div>
              </div>
            </PanelCocina>

            <div className="flex items-center gap-3 flex-wrap">
              <BotonCocina peso="relleno">{textoDelBotonGuardar(BORRADOR, true)}</BotonCocina>
            </div>
          </div>

          <div className="sticky top-4">
            <PanelCocina>
              <RotuloDePanel>Lo que verá el cliente</RotuloDePanel>
              <div className="px-4 pb-4">
                <div className="rounded-cocina border border-cocina-linea bg-cocina-superficie-2 p-3.5">
                  <div className="text-[15px] font-bold text-cocina-tinta leading-[1.3]">{BORRADOR.nombre}</div>
                  <div className="mt-1 text-[11.5px] text-cocina-tinta-3">{loQueVeraElCliente(BORRADOR)}</div>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {RESPUESTAS.map((r) => (
                      <div key={r.nombre} className="flex items-center justify-between gap-2 text-[13px] text-cocina-tinta bg-cocina-superficie border border-cocina-linea rounded-cocina px-3 py-2">
                        <span className="truncate">{r.nombre}</span>
                        <span className="shrink-0 text-cocina-tinta-2 text-[12px]">{precioEnTexto(r.precio)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[11.5px] text-cocina-tinta-3 mt-2.5 leading-[1.5]">
                  Todavía no está en Glovo ni en Uber: sale con la próxima publicación de la carta.
                </p>
              </div>
            </PanelCocina>
          </div>
        </div>
      </div>
    </div>
  )
}

function Tablero3() {
  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta="¿En qué platos va «Escoge una salsa para tu bowl/plato»?"
          regla="Dirty Burger · 23 platos en la carta · lo que marques aquí es lo que verá el cliente en cada uno"
        >
          <BotonCocina peso="fantasma">Volver a la pregunta</BotonCocina>
          <BotonCocina peso="fantasma">Ir a la lista</BotonCocina>
        </CabeceraCocina>

        <div className="mt-4 flex flex-col gap-4">
          <AvisoCocina>
            Pregunta guardada. Ahora dile en qué platos va: hasta que esté en alguno,
            no la ve ningún cliente.
          </AvisoCocina>

          <div className="flex items-center justify-between gap-4 flex-wrap rounded-cocina-md border border-cocina-linea bg-cocina-superficie px-4 py-3 shadow-cocina">
            <div>
              <div className="text-[20px] font-bold tracking-[-0.015em] text-cocina-tinta">
                {elContadorDePlatos(MARCADOS.length + 2)}
              </div>
              <div className="text-[12px] text-cocina-tinta-2 mt-0.5">
                {elCambioEnPlatos(MARCADOS, [...MARCADOS, 'p1', 'p3'])}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <BotonCocina peso="relleno">Guardar en estos platos</BotonCocina>
            </div>
          </div>

          <PanelCocina>
            <RotuloDePanel>Por categoría, para no ir uno a uno</RotuloDePanel>
            <div className="px-4 pb-4 flex flex-col gap-2.5">
              <div className="flex flex-wrap gap-2">
                {CATEGORIAS.map((c) => (
                  <ChipCocina key={c.id}>{marcarLaCategoria(c.nombre, c.cuantosPlatos)}</ChipCocina>
                ))}
              </div>
              <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">{ayudaDeLaCategoria()}</p>
            </div>
          </PanelCocina>

          <PanelCocina>
            <RotuloDePanel>
              Los platos de Dirty Burger
              <span className="ml-2 font-normal text-cocina-tinta-3">23 platos</span>
            </RotuloDePanel>
            <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
              <div className="h-9 px-3 w-64 flex items-center text-[13px] text-cocina-tinta-3 bg-cocina-superficie border border-cocina-linea rounded-cocina">
                Buscar un plato…
              </div>
              <ChipCocina activo>Todas</ChipCocina>
              {CATEGORIAS.map((c) => <ChipCocina key={c.id}>{c.nombre}</ChipCocina>)}
            </div>
            <div className="px-4 pb-4 grid grid-cols-2 gap-2">
              {PLATOS.map((p) => (
                <div key={p.id}
                  className={`flex items-center gap-2.5 text-left px-3 py-2.5 rounded-cocina border ${
                    p.marcado ? 'bg-cocina-acento-bg border-cocina-acento' : 'bg-cocina-superficie border-cocina-linea'}`}>
                  <span className={`shrink-0 w-4 h-4 rounded-[4px] border flex items-center justify-center text-[10px] font-bold ${
                    p.marcado ? 'bg-cocina-acento border-cocina-acento text-white' : 'border-cocina-linea text-transparent'}`}>✓</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-cocina-tinta truncate">{p.nombre}</span>
                    <span className="block text-[11px] text-cocina-tinta-3">{p.categoria}</span>
                  </span>
                  {p.cuantas >= 4 && (
                    <PastillaCocina tono={p.cuantas >= 6 ? 'ambar' : 'apagado'}>
                      ya tiene {p.cuantas}
                    </PastillaCocina>
                  )}
                </div>
              ))}
            </div>
          </PanelCocina>

          <p className="text-[12px] text-cocina-tinta-3 leading-[1.5]">
            Al guardar queda <b>pendiente de publicar</b>: sale en Glovo, en Uber y en la
            web con la próxima publicación de la carta, no en el momento.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── La foto y la pantalla usan las MISMAS piezas ───────────────────────────
describe('las capturas y las pantallas usan las mismas piezas', () => {
  const piezas = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/<(Cabecera|Cifras|Cifra|Pastilla|Boton|Chip|Panel|RotuloDePanel|Franja|Aviso|Interruptor)Cocina\b/g)]
      .map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()

  it('el tablero 5', () => {
    const foto = piezas('./capturaPreguntaYPlatos.test.tsx')
    const pagina = piezas('../../../../src/modules/kitchen/pages/KitchenPreguntaPage.tsx')
    expect(pagina.length).toBeGreaterThan(0)
    // La foto lleva las de las DOS pantallas, así que contiene a cada una.
    for (const p of pagina) expect(foto).toContain(p)
  })

  it('el tablero 3', () => {
    const foto = piezas('./capturaPreguntaYPlatos.test.tsx')
    const pagina = piezas('../../../../src/modules/kitchen/pages/KitchenPreguntaPlatosPage.tsx')
    expect(pagina.length).toBeGreaterThan(0)
    for (const p of pagina) expect(foto).toContain(p)
  })
})

// ── Ni una palabra de jerga en ninguna de las dos ──────────────────────────
// El listón del §2: si hay que explicar qué es un «grupo de modificadores», la
// pantalla está mal. Esto lo vigila sobre el HTML PINTADO, no sobre el código.
describe('🔴 nada de jerga en lo que se pinta', () => {
  const PROHIBIDAS = [
    'modifier', 'modificador', 'group_type', 'impact', 'bundle', 'add_item',
    'remove_item', 'replace_item', 'multiply', 'confirmed', 'recipe_item',
    'menu_item', 'account_id', 'uuid', 'null', 'undefined',
  ]
  it.each([['tablero 5', <Tablero5 key="5" />], ['tablero 3', <Tablero3 key="3" />]])(
    '%s', (_n, arbol) => {
      const html = renderToStaticMarkup(arbol as React.ReactElement).toLowerCase()
      // Se mira solo el TEXTO, no las clases: `bg-cocina-...` no es jerga.
      const texto = html.replace(/<[^>]*>/g, ' ')
      for (const mala of PROHIBIDAS) expect(texto, mala).not.toContain(mala)
    })
})

it('genera las dos capturas a 1280', () => {
  const dist = resolve(__dirname, '../../../../dist/assets')
  if (!existsSync(dist)) {
    // Sin build no hay CSS del que hacer la foto. Se dice y no se falla: la
    // prueba de las piezas y la de la jerga sí valen sin build.
    console.warn('[captura] no hay dist/: se salta la foto (npm run build primero)')
    return
  }
  const css = readdirSync(dist).filter((f) => f.startsWith('index-') && f.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const marco = (cuerpo: string, activo: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${hoja}</style>
<style>html,body{margin:0;background:#EAEEF1}
.marco{display:flex;width:1280px;background:#EAEEF1}
.rail{width:196px;flex:0 0 196px;background:#101A21;color:#B3C3CB;padding:18px 0 24px;font-family:Archivo,system-ui;font-size:13px}
.rail .logo{color:#fff;font-weight:700;font-size:15px;padding:0 18px 14px;display:flex;align-items:center;gap:9px}
.rail .logo i{width:18px;height:18px;border-radius:3px;background:#59B6BA;display:inline-block}
.rail a{display:flex;align-items:center;height:36px;padding:0 18px;color:#B3C3CB;text-decoration:none;border-left:3px solid transparent}
.rail a.on{color:#fff;background:#1B262C;border-left-color:#59B6BA;font-weight:600}
.rail .sep{height:1px;background:#223037;margin:8px 18px}
.cuerpo{flex:1 1 auto;min-width:0}</style></head>
<body><div class="marco"><nav class="rail">
<div class="logo"><i></i>Folvy Kitchen</div>
<a href="#">Resumen</a><a href="#">Cartas</a><a href="#">Casado</a><a href="#">Extras</a>
<a class="${activo}" href="#">Preguntas de la carta</a>
<a href="#">Disponibilidad</a><a href="#">Informes de disponibilidad</a><div class="sep"></div>
<a href="#">Ingredientes</a><a href="#">Proveedores</a><a href="#">Platos</a><a href="#">Precios</a>
<div class="sep"></div><a href="#">Rentabilidad</a><a href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Reglas de ofertas</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  const foto5 = marco(renderToStaticMarkup(<Tablero5 />), 'on')
  const foto3 = marco(renderToStaticMarkup(<Tablero3 />), 'on')
  writeFileSync(resolve(__dirname, '../../../../dist/captura_tablero5_pregunta.html'), foto5)
  writeFileSync(resolve(__dirname, '../../../../dist/captura_tablero3_platos.html'), foto3)

  // Lo que la maqueta y el encargo piden, EN LA FOTO y no sólo en los datos.
  expect(foto5).toContain('¿Qué le preguntas al cliente?')
  expect(foto5).toContain('Lo que verá el cliente')
  expect(foto5).toContain('todavía no dicen qué llevan')
  expect(foto5).toContain('próxima publicación')
  expect(foto3).toContain('Estará en 5 platos')
  expect(foto3).toContain('Marcar los 5 de Bebidas')
  expect(foto3).toContain('no es una regla')
  expect(foto3).toContain('pendiente de publicar')
})
