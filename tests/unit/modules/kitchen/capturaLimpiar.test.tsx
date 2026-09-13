// Las capturas a 1280 de la mitad que limpia: la entrada de dos montones y la
// ficha de una respuesta.
//
// LOS DATOS SON REALES (regla 31), Y DE UNA SOLA MEDIDA. Salen de una única
// llamada a `kitchen_para_trabajar` sobre Foodint el 13/09 a las 19:0x.
//
// ── POR QUÉ SE INSISTE EN «UNA SOLA MEDIDA» (13/09 18:50) ─────────────────
// La versión anterior de esta foto decía «56 se pueden tocar» sobre 66 sin
// decidir. Julio lo midió: eran 49 propias + 17 cedidas. El 56 no salía de
// ninguna consulta — LO ESCRIBÍ YO A MANO en el fixture, en el fichero cuya
// cabecera dice «los datos son reales». Es la regla 31 incumplida en la propia
// prueba que la predica: medí `respuestas` y `nombres`, y el tercero lo puse a
// ojo. La RPC estaba bien; la foto no.
//
// Y la ficha se contradecía en el mismo pintado: un aviso que decía «Resuelta
// en 7 sitios» junto a tres filas marcadas «sin decidir». Las dos mitades
// inventadas: ese aviso NO lo puede producir esa pantalla —su única
// confirmación viene de retirar— y en producción las 11 filas vivas de «Salsa
// Harissa (Picante)» están decididas.
//
// De ahí las tres guardas de abajo, que son las que faltaban:
//   · la cabecera CUADRA consigo misma (39 + 17 = 56; 32 + 54 + 30 = 116);
//   · la ficha no se contradice: si ninguna fila está sin decidir, no puede
//     haber ni una pastilla que lo diga;
//   · ningún aviso escrito a mano: lo que se pinta sale de una función de la
//     lib, que es lo único que la pantalla sabe decir.
//
// Y LA FOTO USA LAS MISMAS PIEZAS QUE LA PANTALLA, comprobado abajo leyendo los
// dos ficheros: una foto con una cabecera distinta de la de la pantalla hace
// que la comparación valga menos de lo que parece (regla 38).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchRoutes } from 'react-router-dom'
import {
  CabeceraCocina, PanelCocina, RotuloDePanel, BotonCocina,
  PastillaCocina, CifrasCocina, CifraCocina, AvisoCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { kitchenModule } from '@/modules/kitchen/module'
import {
  tituloDeLoQueFalta, tituloDeLoQueSobra, porDondeEmpezarLoQueFalta,
  elDesgloseDeLoQueSobra, rotuloDeLasDecididasHacePoco, ROTULO_DE_LAS_CEDIDAS,
  loQueLlevaSinVenderse, loDeLosPedidosAnulados, cuandoSeDecidio,
  laLineaDeDondeEsta, laLineaDeCuantoSePide, loQuePasaSiRetiras,
  textoDelBotonDeRetirar, elAvisoDeQueSeVende, laConfirmacionDeRetirar,
  cuantasDeAhiSiguenSinDecidir,
  type UnNombreSinDecidir, type UnaQueNadiePide, type DondeVive,
} from '@/modules/kitchen/lib/loQueSobraYLoQueFalta'

// ── Los datos, medidos el 13/09 a las 17:5x ────────────────────────────────

const DIAS = 30
/** Una sola llamada, 13/09 19:0x. Los tres de cada bloque SUMAN — ver guardas. */
const FALTA = { respuestas: 56, alcanzables: 39, nombres: 43 }
const FALTA_CEDIDAS = 17          // 39 + 17 = 56
const SOBRA = {
  respuestas: 116, candidatas: 32, alcanzables: 86,
  decididasHacePoco: 54, cedidas: 30, preguntas: 36, conPedidoAnulado: 7,
  filas: [] as UnaQueNadiePide[], dias: DIAS,
}

const FALTAN: UnNombreSinDecidir[] = [
  { nombre: 'Doble Scandal Cheeseburger', cuantas: 2, alcanzables: 2,
    marcas: ['Scandal Burgers'], entrarPor: 'df852b1d' },
  { nombre: 'Doble Scandal Macabra', cuantas: 2, alcanzables: 2,
    marcas: ['Scandal Burgers'], entrarPor: '4baaf4d3' },
  { nombre: 'Doble Scandal Trufada', cuantas: 2, alcanzables: 2,
    marcas: ['Scandal Burgers'], entrarPor: '82fd2c25' },
]

const f = (x: Partial<UnaQueNadiePide>): UnaQueNadiePide => ({
  id: 'x', nombre: '', pregunta: '', preguntaId: 'g', marca: '', cedida: false,
  precio: 0, pedidosAnulados: 0, ultimaVenta: null, diasSinVenderse: null,
  decidida: false, decididaAt: null, decididaReciente: false, ...x,
})

/** Las candidatas de verdad: propias, sin ventas y sin tocar en un mes. */
const CANDIDATAS: UnaQueNadiePide[] = [
  f({ id: 'de31c57f', nombre: 'Bocadillo Clásico', marca: "Mila's Sandwiches",
      pregunta: 'Elige tu segundo bocadillo' }),
  f({ id: '7ab0d492', nombre: 'Tiras de Pollo Kentucky (4 uds)', precio: 1.9,
      marca: "Mila's Sandwiches", pregunta: 'Escoge tu entrante' }),
]

/** 🔴 LAS QUE BAJAN. «Carnitas (Cerdo)» la decidió Julio a las 18:00:09 — si
 *  estuviera arriba, la pantalla de limpiar ofrecería deshacer lo recién
 *  hecho. Y «Pollo» trae además un pedido ANULADO, que es el caso del 0 que no
 *  va solo. */
const HACE_POCO: UnaQueNadiePide[] = [
  f({ id: '75a0134b', nombre: 'Carnitas (Cerdo)', precio: 0.5,
      marca: 'Bendito Burrito', pregunta: 'Elige la proteína.',
      decidida: true, decididaAt: '2026-09-13T16:00:09Z', decididaReciente: true }),
  f({ id: 'e9dc1f58', nombre: 'Pollo', precio: 0.5, pedidosAnulados: 1,
      marca: 'Bendito Burrito', pregunta: 'Elige la proteína.',
      decidida: true, decididaAt: '2026-09-13T16:00:09Z', decididaReciente: true }),
]

const CEDIDAS: UnaQueNadiePide[] = [
  f({ id: '975886de', nombre: 'Cebolla Salteada (40g)', precio: 1, cedida: true,
      marca: 'Big Mike´s Burger Joint', pregunta: 'Extras (burger)' }),
]

/**
 * La ficha: «Salsa Harissa (Picante)», tal y como está a las 19:0x. Las ONCE
 * filas vivas, con sus platos de verdad, y LAS ONCE DECIDIDAS — que es lo que
 * la foto anterior se inventó al pintar tres «sin decidir» que no existen.
 */
const SITIOS: DondeVive[] = [
  { id: '86545579', pregunta: 'Escoge una salsa para tu pita', preguntaId: 'g1',
    marca: 'Meraki Pita', cedida: false, activa: true, esEsta: true, platos: 12, decidida: true },
  { id: '80c6d895', pregunta: '¿Le añadimos salsa?', preguntaId: 'g2',
    marca: 'Meraki Pita', cedida: false, activa: true, esEsta: false, platos: 1, decidida: true },
  { id: 'a702ed6a', pregunta: 'Escoge una salsa para tu bowl/plato', preguntaId: 'g3',
    marca: 'Meraki Pita', cedida: false, activa: true, esEsta: false, platos: 7, decidida: true },
  { id: '4104d1a2', pregunta: 'Escoge una salsa para tu pita', preguntaId: 'g4',
    marca: 'Meraki Pita', cedida: false, activa: true, esEsta: false, platos: 2, decidida: true },
  { id: '1cef0b0d', pregunta: 'Te apetece un extra?', preguntaId: 'g5',
    marca: 'Meraki Pita', cedida: false, activa: true, esEsta: false, platos: 1, decidida: true },
  { id: 'fd265738', pregunta: '1. Escoge la salsa para tu primer kebab', preguntaId: 'g6',
    marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false, platos: 2, decidida: true },
  { id: 'cd8fffe3', pregunta: '2. Escoge la salsa para tu segundo kebab', preguntaId: 'g7',
    marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false, platos: 1, decidida: true },
  { id: '3c5da882', pregunta: 'Escoge una salsa para tu bowl/plato', preguntaId: 'g8',
    marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false, platos: 7, decidida: true },
  { id: '2c88007c', pregunta: 'Algun extra en tu pita?', preguntaId: 'g9',
    marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false, platos: 1, decidida: true },
  { id: 'ad38d1a2', pregunta: 'Algun extra en tu pita?', preguntaId: 'g10',
    marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false, platos: 1, decidida: true },
  { id: 'fcef308f', pregunta: 'Algun extra en tu pita?', preguntaId: 'g11',
    marca: 'The Urban Kebab', cedida: false, activa: true, esEsta: false, platos: 1, decidida: true },
]
/** Ventas de 30 días de la fila que se está mirando. Medidas: 4. */
const VENTAS = { dias: DIAS, ventas: 4, anuladas: 0 }
const LO_QUE_SE_RETIRA = {
  nombre: 'Salsa Harissa (Picante)', preguntas: SITIOS.length,
  platos: SITIOS.reduce((a, s) => a + s.platos, 0),
  ventas: VENTAS.ventas, dias: DIAS, cedida: false, marca: 'Meraki Pita',
}
const AHORA = new Date('2026-09-13T19:00:00Z')

/**
 * El texto de ESTE fichero hasta la raya de las guardas: los componentes de la
 * foto y nada más. Las guardas de abajo se leen a sí mismas si se mira el
 * fichero entero —sus comentarios llevan el patrón que buscan— y un detector
 * que se detecta a sí mismo no detecta nada. Se cortaba por la primera palabra
 * «describe», pero esa palabra sale antes en este mismo comentario: la raya es
 * un corte que no se mueve.
 */
const RAYA_DE_LAS_GUARDAS = '// \u2500\u2500 Las guardas'

function soloLosComponentes(): string {
  const entero = readFileSync(resolve(__dirname, './capturaLimpiar.test.tsx'), 'utf8')
  const corte = entero.indexOf(RAYA_DE_LAS_GUARDAS)
  if (corte < 0) throw new Error('no encuentro la raya de las guardas')
  return entero.slice(0, corte)
}

// ── Las piezas de fila, copiadas de la pantalla ────────────────────────────

function FilaQueFalta({ x }: { x: UnNombreSinDecidir }) {
  return (
    <button type="button"
      className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-cocina-linea-suave last:border-b-0 transition-base hover:bg-cocina-superficie-2">
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-[13.5px] text-cocina-tinta">{x.nombre}</span>
        <span className="block text-[12px] text-cocina-tinta-3 mt-0.5">{x.marcas.join(' · ')}</span>
      </span>
      {x.cuantas > 1 && <PastillaCocina tono="ambar">en {x.cuantas} preguntas</PastillaCocina>}
      <span className="shrink-0 text-[12.5px] font-semibold text-cocina-acento">Abrir</span>
    </button>
  )
}

function FilaQueSobra({ x }: { x: UnaQueNadiePide }) {
  const anulados = loDeLosPedidosAnulados(x)
  const decidida = cuandoSeDecidio(x, AHORA)
  return (
    <button type="button"
      className={`w-full text-left flex items-start gap-3 px-4 py-2.5 border-b border-cocina-linea-suave last:border-b-0 transition-base hover:bg-cocina-superficie-2 ${x.cedida ? 'opacity-70' : ''}`}>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-[13.5px] text-cocina-tinta">{x.nombre}</span>
        <span className="block text-[12px] text-cocina-tinta-3 mt-0.5">{x.marca} · {x.pregunta}</span>
        <span className="block text-[11.5px] text-cocina-tinta-3 mt-1">
          {loQueLlevaSinVenderse(x)}
          {anulados && <span className="ml-1.5 text-cocina-ambar">· {anulados}</span>}
        </span>
        {decidida && x.decididaReciente && (
          <span className="block text-[11.5px] text-cocina-acento-ink mt-0.5">{decidida}</span>
        )}
      </span>
      <span className="shrink-0 text-[12.5px] font-semibold text-cocina-acento">
        {x.cedida ? 'Ver' : 'Abrir'}
      </span>
    </button>
  )
}

// ── Los dos cuerpos ────────────────────────────────────────────────────────

function LosDosMontones() {
  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta="Qué hay que trabajar"
          regla={
            <>
              Dos montones y nada más. Uno es la calidad del dato —qué se descuenta
              del almacén— y el otro es la carta —qué ocupa sitio sin venderse—. El
              día que los dos estén a cero, el gestor ha hecho su trabajo.
            </>
          }
        >
          <BotonCocina peso="fantasma">Ver las preguntas</BotonCocina>
          <BotonCocina peso="relleno">+ Crear una pregunta</BotonCocina>
        </CabeceraCocina>

        <div className="mt-4">
          <CifrasCocina>
            <CifraCocina titulo="Le falta decir qué lleva" valor={String(FALTA.respuestas)}
              tono="aviso" pie={`${FALTA.nombres} nombres distintos · ${FALTA.alcanzables} se pueden tocar`} />
            <CifraCocina titulo="No lo pide nadie" valor={String(SOBRA.candidatas)}
              sufijo={`de ${SOBRA.respuestas}`} tono="aviso"
              pie={`sin una sola venta en ${DIAS} días`} />
          </CifrasCocina>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
          <PanelCocina>
            <RotuloDePanel derecha={`${FALTA.alcanzables} se pueden tocar`}>
              {tituloDeLoQueFalta(FALTA.respuestas)}
            </RotuloDePanel>
            <p className="px-4 pb-2.5 text-[12px] text-cocina-tinta-3 leading-[1.5]">
              {porDondeEmpezarLoQueFalta(FALTAN)}
            </p>
            <div>{FALTAN.map((x) => <FilaQueFalta key={x.nombre} x={x} />)}</div>
          </PanelCocina>

          <PanelCocina>
            <RotuloDePanel derecha={`en ${SOBRA.preguntas} preguntas`}>
              {tituloDeLoQueSobra(SOBRA.candidatas)}
            </RotuloDePanel>
            <p className="px-4 pb-2.5 text-[12px] text-cocina-tinta-3 leading-[1.5]">
              {elDesgloseDeLoQueSobra(SOBRA)}
            </p>
            <div>
              {CANDIDATAS.map((x) => <FilaQueSobra key={x.id} x={x} />)}
              <div className="px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2 text-[12px] font-bold text-cocina-tinta-3">
                {rotuloDeLasDecididasHacePoco(SOBRA.decididasHacePoco, DIAS)}
              </div>
              {HACE_POCO.map((x) => <FilaQueSobra key={x.id} x={x} />)}
              <div className="px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2 text-[12px] font-bold text-cocina-tinta-3">
                {ROTULO_DE_LAS_CEDIDAS} — {SOBRA.cedidas}
              </div>
              {CEDIDAS.map((x) => <FilaQueSobra key={x.id} x={x} />)}
            </div>
          </PanelCocina>
        </div>
      </div>
    </div>
  )
}

function LaFicha() {
  return (
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Cocina · Preguntas de la carta"
          pregunta="Salsa Harissa (Picante)"
          regla="Meraki Pita · Escoge una salsa para tu pita"
        >
          <BotonCocina peso="fantasma">Volver a los dos montones</BotonCocina>
          <BotonCocina peso="fantasma">Abrir la pregunta</BotonCocina>
        </CabeceraCocina>

        <div className="mt-4 flex flex-col gap-4">
          {/* EL AVISO SALE DE LA LIB, NO DE MI CABEZA. La versión anterior de
              esta foto llevaba aquí un «Resuelta en 7 sitios» escrito a mano —
              un mensaje que esta pantalla NO puede producir, porque su única
              confirmación viene de retirar. La guarda de abajo lo impide. */}
          <AvisoCocina>
            {laConfirmacionDeRetirar({
              respuestas: 1, preguntas: 0, pregunta: null, encendido: true })}
          </AvisoCocina>

          <PanelCocina>
            <RotuloDePanel derecha="no cobra">Qué lleva</RotuloDePanel>
            <div className="px-4 pb-4">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[15px] font-semibold text-cocina-tinta">
                  Lleva 20 Salsa Harissa
                </span>
                <span className="text-[11.5px] text-cocina-tinta-3">
                  Lo dijo Oficina el 13/09 18:32
                </span>
              </div>
            </div>
          </PanelCocina>

          <PanelCocina>
            <RotuloDePanel derecha={
              cuantasDeAhiSiguenSinDecidir(SITIOS) > 0
                ? `${cuantasDeAhiSiguenSinDecidir(SITIOS)} sin decidir` : 'todas decididas'
            }>{laLineaDeDondeEsta(SITIOS)}</RotuloDePanel>
            <div>
              {SITIOS.map((s) => (
                <button key={s.id} type="button"
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-cocina-linea-suave last:border-b-0 transition-base hover:bg-cocina-superficie-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-cocina-tinta">
                      {s.pregunta}
                      {s.esEsta && <span className="ml-1.5 text-cocina-tinta-3">· ésta</span>}
                    </span>
                    <span className="block text-[11.5px] text-cocina-tinta-3 mt-0.5">
                      {s.marca} · {s.platos === 1 ? '1 plato' : `${s.platos} platos`}
                    </span>
                  </span>
                  {!s.decidida && <PastillaCocina tono="ambar">sin decidir</PastillaCocina>}
                  <span className="shrink-0 text-[12.5px] font-semibold text-cocina-acento">Abrir</span>
                </button>
              ))}
            </div>
          </PanelCocina>

          <PanelCocina>
            <RotuloDePanel>Cuánto se pide</RotuloDePanel>
            <div className="px-4 pb-4">
              <span className="text-[13.5px] text-cocina-tinta underline decoration-cocina-linea underline-offset-4">
                {laLineaDeCuantoSePide(VENTAS)}
                <span className="ml-1.5 text-[12px] text-cocina-acento">ver cuáles</span>
              </span>
            </div>
          </PanelCocina>

          <PanelCocina>
            <RotuloDePanel>Retirar de la carta</RotuloDePanel>
            <div className="px-4 pb-4 flex flex-col gap-2.5">
              <p className="text-[13px] text-cocina-tinta leading-[1.55]">
                {loQuePasaSiRetiras(LO_QUE_SE_RETIRA)}
              </p>
              {/* Si se vende, se dice MÁS FUERTE. Ésta se pidió 4 veces este
                  mes: retirarla no se impide, pero no puede costar lo mismo. */}
              <p className="text-[13px] font-semibold text-cocina-ambar leading-[1.5]">
                {elAvisoDeQueSeVende(LO_QUE_SE_RETIRA)}
              </p>
              <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
                Se retira, no se borra: queda con quién y cuándo, se sigue viendo aquí y se
                puede volver a encender. Borrarla se llevaría por delante el historial de
                todo lo que se vendió con ella.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <BotonCocina peso="borde">{textoDelBotonDeRetirar(1)}</BotonCocina>
              </div>
            </div>
          </PanelCocina>
        </div>
      </div>
    </div>
  )
}

// ── Las guardas ────────────────────────────────────────────────────────────

describe('la foto y la pantalla usan las mismas piezas', () => {
  const piezas = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/<(Cabecera|Cifras|Cifra|Pastilla|Boton|Chip|Panel|RotuloDePanel|Franja|Aviso|Interruptor)Cocina\b/g)]
      .map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()

  it.each([
    ['la entrada', '../../../../src/modules/kitchen/pages/KitchenLimpiarPage.tsx'],
    ['la ficha',   '../../../../src/modules/kitchen/pages/KitchenRespuestaPage.tsx'],
  ])('%s', (_n, ruta) => {
    const foto = piezas('./capturaLimpiar.test.tsx')
    const pagina = piezas(ruta)
    expect(pagina.length).toBeGreaterThan(0)
    for (const p of pagina) expect(foto).toContain(p)
  })
})

describe('🔴 los números de la foto salen de UNA medida y CUADRAN', () => {
  // Lo que faltaba el 13/09: la foto decía «56 se pueden tocar» sobre 66 sin
  // decidir, y el 56 lo escribí yo a mano. 56 + 17 cedidas = 73, no 66: si esta
  // suma hubiera existido, habría saltado en el momento.
  it('lo que falta: propias + cedidas = el total', () => {
    expect(FALTA.alcanzables + FALTA_CEDIDAS).toBe(FALTA.respuestas)
    expect(FALTA.nombres).toBeLessThanOrEqual(FALTA.respuestas)
  })

  it('lo que sobra: candidatas + decididas hace poco + cedidas = el total', () => {
    expect(SOBRA.candidatas + SOBRA.decididasHacePoco + SOBRA.cedidas)
      .toBe(SOBRA.respuestas)
    // Y «alcanzables» son las propias: el total menos las cedidas.
    expect(SOBRA.alcanzables).toBe(SOBRA.respuestas - SOBRA.cedidas)
  })

  it('y las filas pintadas caben dentro de sus recuentos', () => {
    expect(CANDIDATAS.length).toBeLessThanOrEqual(SOBRA.candidatas)
    expect(HACE_POCO.length).toBeLessThanOrEqual(SOBRA.decididasHacePoco)
    expect(CEDIDAS.length).toBeLessThanOrEqual(SOBRA.cedidas)
    expect(FALTAN.length).toBeLessThanOrEqual(FALTA.nombres)
    // Las que se pintan como candidatas TIENEN que serlo de verdad.
    for (const c of CANDIDATAS) {
      expect(c.cedida, c.nombre).toBe(false)
      expect(c.decididaReciente, c.nombre).toBe(false)
    }
    for (const h of HACE_POCO) expect(h.decididaReciente, h.nombre).toBe(true)
    for (const c of CEDIDAS) expect(c.cedida, c.nombre).toBe(true)
  })
})

describe('🔴 la ficha no se contradice consigo misma', () => {
  // Lo que faltaba: la foto anterior decía «Resuelta en 7 sitios» y debajo
  // pintaba tres «sin decidir». Las dos mitades inventadas.
  it('si ninguna fila está sin decidir, no se pinta ni una pastilla que lo diga', () => {
    const sinDecidir = SITIOS.filter((s) => !s.decidida && !s.cedida).length
    const html = renderToStaticMarkup(<LaFicha />)
    const pastillas = [...html.matchAll(/sin decidir/g)].length
    expect(sinDecidir).toBe(0)
    expect(pastillas, 'dice «sin decidir» sin que lo haya').toBe(0)
    expect(html).toContain('todas decididas')
  })

  it('y el número del rótulo es el de sus propias filas, no uno escrito aparte', () => {
    // Se mira SOLO lo de arriba, donde viven los componentes: de `describe(`
    // para abajo están estas mismas guardas, y sus comentarios contienen el
    // patrón que buscan. Un detector que se detecta a sí mismo no detecta nada.
    const p = soloLosComponentes()
    // El rótulo se calcula; un literal con el número escrito al lado es
    // exactamente cómo se coló la contradicción.
    expect(p).not.toMatch(/derecha="\d+ sin decidir"/)
    expect(p).toContain('cuantasDeAhiSiguenSinDecidir(SITIOS)')
  })

  it('🔴 y ningún aviso escrito a mano: lo que se pinta lo dice la lib', () => {
    // Un aviso seguido de texto suelto es una frase que la pantalla no sabe
    // decir. Detrás de la etiqueta tiene que venir una expresión.
    const p = soloLosComponentes()
    for (const m of p.matchAll(/<AvisoCocina[^>]*>\s*([^\s<{])/g)) {
      throw new Error(`aviso escrito a mano en la captura: empieza por «${m[1]}»`)
    }
    expect(p).toContain('{laConfirmacionDeRetirar({')
  })
})

describe('🔴 cada fila se puede abrir, y su destino existe', () => {
  it('las filas de los dos montones son botones de verdad', () => {
    const html = renderToStaticMarkup(<LosDosMontones />)
    const botones = [...html.matchAll(/<button\b/g)].length
    // 3 que faltan + 2 candidatas + 2 que bajan + 1 cedida + los 2 de cabecera.
    expect(botones).toBe(FALTAN.length + CANDIDATAS.length + HACE_POCO.length
                         + CEDIDAS.length + 2)
    expect(botones).toBe(10)
  })

  it('y LA PÁGINA DE VERDAD también, no sólo la foto', () => {
    // Las guardas de arriba miran las copias de este fichero. Si mañana alguien
    // deja inerte la fila real sin tocar la foto, seguirían verdes mientras la
    // pantalla se rompe — que es la forma exacta del fallo de las 11:30.
    const p = readFileSync(resolve(__dirname,
      '../../../../src/modules/kitchen/pages/KitchenLimpiarPage.tsx'), 'utf8')
    expect(p).toContain('<button')
    expect(p).toContain('onAbrir(f.entrarPor)')
    expect(p).toContain('onAbrir(f.id)')
    expect(p).toContain('`/kitchen/respuestas/${id}`')
  })

  it('el destino existe entre las rutas que monta el Shell', () => {
    const montadas = kitchenModule.routes.map((r) => ({
      path: `${kitchenModule.basePath}/${r.path ?? ''}`.replace(/\/+$/, ''),
    }))
    expect(matchRoutes(montadas, '/kitchen/limpiar')).not.toBeNull()
    const m = matchRoutes(montadas, '/kitchen/respuestas/de31c57f')
    expect(m).not.toBeNull()
    expect(m![m!.length - 1].route.path).toBe('kitchen/respuestas/:respuestaId')
  })
})

describe('🔴 el orden es la defensa, no el cartel', () => {
  it('lo decidido hace poco NO encabeza la lista: va en su grupo, abajo', () => {
    const html = renderToStaticMarkup(<LosDosMontones />)
    const primera = html.indexOf('Bocadillo Clásico')
    const rotulo  = html.indexOf('Decididas en los últimos')
    const carnitas = html.indexOf('Carnitas (Cerdo)')
    const cedidas = html.indexOf(ROTULO_DE_LAS_CEDIDAS)
    expect(primera).toBeGreaterThan(-1)
    expect(primera).toBeLessThan(rotulo)     // candidatas arriba
    expect(rotulo).toBeLessThan(carnitas)    // el rótulo antes de las suyas
    expect(carnitas).toBeLessThan(cedidas)   // y las cedidas al final
  })

  it('pero NO se esconde: «Carnitas» está, y dice cuándo se decidió', () => {
    const html = renderToStaticMarkup(<LosDosMontones />)
    expect(html).toContain('Carnitas (Cerdo)')
    expect(html).toContain('Alguien dijo qué lleva hace 3 horas')
  })

  it('y el 0 no va solo: el pedido anulado se pinta', () => {
    const html = renderToStaticMarkup(<LosDosMontones />)
    expect(html).toContain('se anuló')
    expect(html).toContain('no cuenta como venta')
  })
})

describe('🔴 nada de jerga en lo que se pinta', () => {
  const PROHIBIDAS = [
    'modifier', 'modificador', 'impact', 'bundle', 'add_item', 'remove_item',
    'option', 'confirmed', 'recipe_item', 'menu_item', 'account_id', 'uuid',
    'null', 'undefined', 'is_active', 'deactivated',
  ]
  it.each([['los dos montones', <LosDosMontones key="1" />], ['la ficha', <LaFicha key="2" />]])(
    '%s', (_n, arbol) => {
      const html = renderToStaticMarkup(arbol as React.ReactElement).toLowerCase()
      const texto = html.replace(/<[^>]*>/g, ' ')
      for (const mala of PROHIBIDAS) expect(texto, mala).not.toContain(mala)
    })
})

it('genera las dos capturas a 1280', () => {
  const dist = resolve(__dirname, '../../../../dist/assets')
  if (!existsSync(dist)) {
    console.warn('[captura] no hay dist/: se salta la foto (npm run build primero)')
    return
  }
  const css = readdirSync(dist).filter((x) => x.startsWith('index-') && x.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const marco = (cuerpo: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
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
<a href="#">Preguntas de la carta</a>
<a class="on" href="#">Qué hay que trabajar</a>
<a href="#">Disponibilidad</a><div class="sep"></div>
<a href="#">Ingredientes</a><a href="#">Proveedores</a><a href="#">Platos</a><a href="#">Precios</a>
<div class="sep"></div><a href="#">Rentabilidad</a><a href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_limpiar_montones.html'),
    marco(renderToStaticMarkup(<LosDosMontones />)))
  writeFileSync(resolve(__dirname, '../../../../dist/captura_limpiar_ficha.html'),
    marco(renderToStaticMarkup(<LaFicha />)))
  expect(true).toBe(true)
})
