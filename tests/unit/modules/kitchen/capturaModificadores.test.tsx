// Genera la captura del tablero 1 de Modificadores para compararla con la
// maqueta (§1 del encargo: «captura a 1280 de cada tablero desde los
// componentes reales, con la cabecera incluida»).
//
// NO reescribe el marcado: renderiza LOS COMPONENTES DE VERDAD con
// `renderToStaticMarkup` y les pone encima el CSS que sale del build. Si
// reescribiera el HTML para la foto, la foto no probaría nada.
//
// Y LA POBLACIÓN ES LA ENTERA, no una selección. La primera versión de esta
// captura pintaba diez filas escogidas por mí y dejó pasar dos cosas: la
// sección de «en ningún plato» salía con su cabecera de 15 y CERO filas
// debajo, y las tres preguntas sin ninguna opción no decían que no salen en
// las plataformas. Con las 65 de Foodint delante, las dos saltaron solas.
// Por eso las filas vienen de `fixtures/preguntasReales.ts` (regla 31).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, CifrasCocina, CifraCocina, PastillaCocina,
  ChipCocina, PanelCocina, RotuloDePanel, FranjaCocina, BotonCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { REJILLA_PREGUNTAS } from '@/modules/kitchen/lib/rejillasDeCocina'
import {
  quePuedeHacerElCliente, queHaceEnElPlato, opcionesEnTexto, platosEnTexto,
  platosPreocupa, pastillas, cuantasActivas, ordena,
  tituloDeLaFranja, detalleDeLaFranja, repartoDeLaFranja, tituloSinPlato, lineaSinPlato,
  subtituloDeMarca, chipDeMasMarcas, elPieDeLaLista, loQueHaceLaFila, MARCAS_A_LA_VISTA,
  type Pregunta, type TonoDePastilla,
} from '@/modules/kitchen/lib/preguntasDeCocina'
import { matchRoutes } from 'react-router-dom'
import { kitchenModule } from '@/modules/kitchen/module'
import {
  MARCAS_REALES, SIN_PLATO_REALES, CIFRAS_REALES, FRANJA_REAL, VENTANA_REAL,
} from './fixtures/preguntasReales'

const TONO: Record<TonoDePastilla, 'rojo' | 'ambar' | 'apagado'> = {
  malo: 'rojo', aviso: 'ambar', apagado: 'apagado',
}

const ACTIVAS = cuantasActivas(MARCAS_REALES, SIN_PLATO_REALES)

function Lupa() {
  return (
    <svg viewBox="0 0 24 24" className="w-[15px] h-[15px] shrink-0 stroke-cocina-tinta-3 fill-none" strokeWidth={1.8}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  )
}

function Cabecera() {
  return (
    <div
      className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
      style={{ gridTemplateColumns: REJILLA_PREGUNTAS }}
    >
      <span>Pregunta</span><span>Qué puede hacer el cliente</span><span>Opciones</span>
      <span>En platos</span><span>Qué le pasa</span><span />
    </div>
  )
}

function Fila({ p, sinRaya }: { p: Pregunta; sinRaya?: boolean }) {
  const chapas = pastillas(p)
  return (
    <button
      type="button"
      title={`${loQueHaceLaFila(p.cedida)} «${p.nombre}»`}
      className={`w-full text-left grid items-center gap-3.5 px-4 py-2.5 min-h-[56px] transition-base hover:bg-cocina-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cocina-acento focus-visible:ring-inset ${sinRaya ? '' : 'border-b border-cocina-linea-suave last:border-b-0'} ${p.activa ? '' : 'opacity-60'}`}
      style={{ gridTemplateColumns: REJILLA_PREGUNTAS }}
    >
      <div className="min-w-0">
        <div className="font-semibold text-[13.5px] text-cocina-tinta">{p.nombre}</div>
        <div className="text-[12px] text-cocina-tinta-3 mt-0.5">{queHaceEnElPlato(p)}</div>
      </div>
      <div className="text-[13px] text-cocina-tinta-2">{quePuedeHacerElCliente(p)}</div>
      <div className="text-[13px] text-cocina-tinta-2 num">{opcionesEnTexto(p)}</div>
      <div className={`text-[13px] num ${platosPreocupa(p) ? 'text-cocina-rojo font-bold' : 'text-cocina-tinta'}`}>
        {platosEnTexto(p)}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {chapas.length === 0
          ? <span className="text-[12px] text-cocina-tinta-3">—</span>
          : chapas.map((c) => <PastillaCocina key={c.texto} tono={TONO[c.tono]}>{c.texto}</PastillaCocina>)}
      </div>
      <div className="text-right text-[12.5px] font-semibold text-cocina-acento">
        {loQueHaceLaFila(p.cedida)}
      </div>
    </button>
  )
}

function Bloque({ nombre, cedida, filas }: { nombre: string; cedida: boolean; filas: Pregunta[] }) {
  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2">
        <span className="text-[14px] font-bold text-cocina-tinta">{nombre}</span>
        <span className="text-[12px] text-cocina-tinta-3">{subtituloDeMarca(cedida)}</span>
      </div>
      {filas.map((p) => <Fila key={p.id} p={p} />)}
    </div>
  )
}

// ── La foto y la pantalla tienen que usar las MISMAS piezas ────────────────
// Lo aprendió Extras: una foto con una cabecera distinta de la de la pantalla
// hace que la comparación valga menos de lo que parece. Esto no prueba el
// diseño; prueba que la prueba del diseño mide lo que dice medir.
describe('la captura y la pantalla usan las mismas piezas', () => {
  const piezas = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/<(Cabecera|Cifras|Cifra|Pastilla|Boton|Chip|Panel|RotuloDePanel|Franja)Cocina\b/g)]
      .map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()

  it('las mismas, y ninguna de casualidad', () => {
    const enLaFoto = piezas('./capturaModificadores.test.tsx')
    const enLaPagina = piezas('../../../../src/modules/kitchen/pages/KitchenModificadoresPage.tsx')
    expect(enLaPagina.length).toBeGreaterThan(0)
    expect(enLaFoto).toEqual(enLaPagina)
  })
})

// ── La foto enseña la población entera ─────────────────────────────────────
// Sin esto, una captura recortada vuelve a colar: la cabecera diría 65 y
// debajo habría diez. La cuenta de filas pintadas tiene que dar 65.
describe('la foto es de las 65, no de una selección', () => {
  it('las mismas que dice la cabecera', () => {
    const enMarcas = MARCAS_REALES.reduce((a, m) => a + m.preguntas.length, 0)
    expect(enMarcas + SIN_PLATO_REALES.length).toBe(CIFRAS_REALES.preguntas)
    expect(MARCAS_REALES).toHaveLength(14)
    expect(ACTIVAS).toBe(56)
  })

  it('y lleva dentro los casos que la maqueta dibuja', () => {
    const todas = [...MARCAS_REALES.flatMap((m) => m.preguntas), ...SIN_PLATO_REALES]
    expect(todas.filter((p) => p.accion === 'juntar')).toHaveLength(10)
    expect(todas.filter((p) => p.accion === 'revisar')).toHaveLength(2)
    expect(todas.filter((p) => !p.activa)).toHaveLength(9)
    expect(todas.filter((p) => p.cedida)).toHaveLength(11)
    // Las que se quedan sin opciones ACTIVAS son nueve, y las nueve están
    // apagadas: ninguna pregunta viva se queda muda.
    expect(todas.filter((p) => p.opciones === 0)).toHaveLength(9)
    expect(todas.filter((p) => p.opciones === 0 && p.activa)).toHaveLength(0)
    expect(todas.filter((p) => p.opcionesRetiradas > 0)).toHaveLength(10)
  })
})

// ── 🔴 SE PUEDE ABRIR UNA PREGUNTA ─────────────────────────────────────────
//
// LO QUE PASÓ (13/09 11:30, y con la pantalla ya publicada). Julio: «pinchar en
// la pregunta no está funcionando». Era exacto y era literal: la fila era un
// `div` sin manejador y la última columna estaba VACÍA a propósito, por un
// comentario del 12/09 que decía «cuando existan los tableros 2, 4 y 5,
// aparece» (regla 35, no se pinta un botón sin destino). El tablero 5 se
// publicó a las 10:16 y nadie retiró el vacío: 65 preguntas y ni una forma de
// abrir ninguna.
//
// La regla 35 tiene una segunda mitad que no estaba escrita en ninguna parte, y
// aquí queda: **el día que el destino existe, el botón es obligatorio**. Un
// «todavía no» sin fecha se convierte solo en un «nunca», porque quien publica
// el destino no es el mismo que escribió el hueco.
//
// Estas dos pruebas habrían cazado el fallo enteras: la primera cuenta cuántas
// filas se pueden activar (antes: CERO), la segunda comprueba que el sitio al
// que llevan EXISTE de verdad entre las rutas que monta el Shell.
describe('🔴 cada pregunta de la lista se puede abrir', () => {
  const todas = [...MARCAS_REALES.flatMap((m) => m.preguntas), ...SIN_PLATO_REALES]

  it('ni una sola fila inerte: las 65 se pueden activar con ratón y con teclado', () => {
    const html = renderToStaticMarkup(<>{todas.map((p) => <Fila key={p.id} p={p} />)}</>)
    // `button` y no `div onClick`: el teclado, el foco y el lector de pantalla
    // salen gratis. Contar los `<button` es contar las filas activables.
    const activables = [...html.matchAll(/<button\b/g)].length
    expect(activables, 'filas que se pueden pinchar').toBe(todas.length)
    expect(activables).toBe(65)
  })

  it('y cada una DICE que se puede, con la palabra que le toca', () => {
    // Una fila que se puede pinchar pero no lo dice es una promesa que solo
    // conoce quien escribió el código.
    const propia = renderToStaticMarkup(<Fila p={todas.find((p) => !p.cedida)!} />)
    const cedida = renderToStaticMarkup(<Fila p={todas.find((p) => p.cedida)!} />)
    expect(propia).toContain('Abrir')
    // La cedida TAMBIÉN se abre —se ve entera y no se toca—, y por eso la
    // palabra cambia: prometer «Abrir» y no dejar escribir sería peor.
    expect(cedida).toContain('Ver')
    expect(loQueHaceLaFila(false)).toBe('Abrir')
    expect(loQueHaceLaFila(true)).toBe('Ver')
  })

  it('🔴 y LA PÁGINA DE VERDAD también, no sólo la foto', () => {
    // Las dos guardas de arriba miran la `Fila` de ESTE fichero, que es una
    // copia. Si mañana alguien vuelve a dejar inerte la de la página y no toca
    // la foto, aquéllas seguirían verdes mientras la pantalla se rompe otra
    // vez — que es EXACTAMENTE la forma del fallo de hoy. Así que esta lee el
    // fichero de la página.
    const pagina = readFileSync(
      resolve(__dirname, '../../../../src/modules/kitchen/pages/KitchenModificadoresPage.tsx'), 'utf8')
    const fila = pagina.slice(pagina.indexOf('function Fila('))
    const cuerpo = fila.slice(0, fila.indexOf('\nfunction '))
    expect(cuerpo, 'la fila de la página no es un <button>').toContain('<button')
    expect(cuerpo, 'la fila de la página no llama a onAbrir').toContain('onAbrir(p.id)')
    expect(cuerpo, 'la fila de la página no dice lo que hace').toContain('loQueHaceLaFila')
    // Y que el destino se construya con el literal que la ruta espera.
    expect(pagina).toContain('`/kitchen/preguntas/${id}`')
  })

  it('y el sitio al que lleva EXISTE entre las rutas que monta el Shell', () => {
    // Montadas igual que en Shell.tsx:235, no de memoria.
    const montadas = kitchenModule.routes.map((r) => ({
      path: `${kitchenModule.basePath}/${r.path ?? ''}`.replace(/\/+$/, ''),
    }))
    // El destino real de la fila, el mismo literal que usa la página.
    for (const p of [todas[0], todas[todas.length - 1]]) {
      const destino = `/kitchen/preguntas/${p.id}`
      const casa = matchRoutes(montadas, destino)
      expect(casa, `${destino} no casa con ninguna ruta montada`).not.toBeNull()
      expect(casa![casa!.length - 1].route.path).toBe('kitchen/preguntas/:preguntaId')
    }
    // Y los otros dos destinos del flujo, que se rompen igual de callados.
    expect(matchRoutes(montadas, '/kitchen/preguntas/nueva')).not.toBeNull()
    expect(matchRoutes(montadas, '/kitchen/preguntas/abc/platos')).not.toBeNull()
  })
})

// El pie ya no puede prometer un paso siguiente que ya ha llegado.
describe('el pie no promete lo que ya está hecho', () => {
  it('no dice «en el siguiente paso»', () => {
    expect(elPieDeLaLista()).not.toContain('siguiente paso')
  })
})

it('genera la captura del tablero 1 a 1280', () => {
  const sinPlato = ordena(SIN_PLATO_REALES)
  const opcionesSinPlato = sinPlato.reduce((a, p) => a + p.opciones, 0)
  const chips = MARCAS_REALES.slice(0, MARCAS_A_LA_VISTA)

  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Kitchen · Modificadores"
          pregunta="¿Qué puede elegir, añadir o quitar el cliente en cada plato?"
          regla={
            <>
              Una pregunta es lo que se le pregunta al cliente en un plato («¿Con patatas?»,
              «Elige tu salsa»). Sus opciones son las respuestas, con su precio y lo que
              llevan. Una misma pregunta se pone en todos los platos donde toca.
            </>
          }
        >
          {/* El botón que el tablero 1 estrena hoy: ya tiene destino (regla 35). */}
          <BotonCocina peso="relleno">+ Crear una pregunta</BotonCocina>
        </CabeceraCocina>
        <FranjaCocina
          tono="malo"
          titulo={tituloDeLaFranja(FRANJA_REAL, VENTANA_REAL)}
          detalle={
            <>
              {detalleDeLaFranja(FRANJA_REAL)}
              {' '}
              <span className="text-cocina-tinta-3">{repartoDeLaFranja(FRANJA_REAL)}</span>
            </>
          }
        />
        <CifrasCocina>
          <CifraCocina titulo="Preguntas" valor={String(CIFRAS_REALES.preguntas)}
            pie={`${ACTIVAS} activas · ${CIFRAS_REALES.opcionesActivas} opciones que se venden`} />
          <CifraCocina titulo="Platos con alguna pregunta" valor={String(CIFRAS_REALES.platosConPregunta)}
            sufijo={`de ${CIFRAS_REALES.platosActivos}`} pie="platos activos de todas las marcas" />
          <CifraCocina titulo="Repetidas" valor={String(CIFRAS_REALES.repetidasPreguntas)} tono="aviso"
            pie={`${CIFRAS_REALES.repetidasNombres} nombres que se repiten dentro de su marca`} />
          <CifraCocina titulo="Extras distintos" valor={String(CIFRAS_REALES.extrasDistintos)} tono="aviso"
            pie={`detrás de las ${CIFRAS_REALES.opcionesDecididasActivas} opciones que ya lo tienen decidido`} />
          <CifraCocina titulo="Opciones sin decidir qué llevan" valor={String(CIFRAS_REALES.opcionesSinDecidirActivas)}
            sufijo={`de ${CIFRAS_REALES.opcionesActivas}`} tono="malo"
            pie={`${CIFRAS_REALES.opcionesSinDecidirCobranActivas} cobran y en Folvy no cuestan nada · ${CIFRAS_REALES.opciones} opciones entre todas, ${CIFRAS_REALES.opciones - CIFRAS_REALES.opcionesActivas} retiradas`} />
        </CifrasCocina>
        <div className="flex justify-between items-center gap-3">
          <div className="flex gap-1.5 flex-wrap">
            <ChipCocina activo>Todas las marcas</ChipCocina>
            {chips.map((m) => <ChipCocina key={m.id}>{m.nombre}</ChipCocina>)}
            <ChipCocina>{chipDeMasMarcas(MARCAS_REALES.length - chips.length)}</ChipCocina>
          </div>
          <div className="flex items-center gap-2 h-[34px] w-[280px] px-[11px] border border-cocina-linea bg-cocina-superficie rounded-cocina">
            <Lupa />
            <input readOnly value="" placeholder="Buscar pregunta"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-cocina-tinta placeholder:text-cocina-tinta-3" />
          </div>
        </div>
        <PanelCocina>
          <RotuloDePanel derecha="Primero las que piden algo">
            {`Preguntas · ${CIFRAS_REALES.preguntas} en total · ${ACTIVAS} activas`}
          </RotuloDePanel>
          <Cabecera />
          {MARCAS_REALES.map((m) => (
            <Bloque key={m.id} nombre={m.nombre} cedida={m.cedida} filas={ordena(m.preguntas)} />
          ))}
        </PanelCocina>
        <PanelCocina>
          <RotuloDePanel derecha="Su plato se retiró">
            {tituloSinPlato(sinPlato.length, opcionesSinPlato)}
          </RotuloDePanel>
          <Cabecera />
          {sinPlato.map((p) => (
            <div key={p.id} className="border-b border-cocina-linea-suave last:border-b-0">
              <Fila p={p} sinRaya />
              <div className="px-4 pb-2.5 -mt-1.5 text-[11.5px] text-cocina-tinta-3">{lineaSinPlato(p)}</div>
            </div>
          ))}
        </PanelCocina>
        <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">{elPieDeLaLista()}</p>
      </div>
    </div>,
  )

  const dist = resolve(__dirname, '../../../../dist/assets')
  const css = readdirSync(dist).filter((f) => f.startsWith('index-') && f.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
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
<a class="on" href="#">Preguntas de la carta</a>
<a href="#">Disponibilidad</a><a href="#">Informes de disponibilidad</a><div class="sep"></div>
<a href="#">Ingredientes</a><a href="#">Proveedores</a><a href="#">Platos</a><a href="#">Precios</a>
<div class="sep"></div><a href="#">Rentabilidad</a><a href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Reglas de ofertas</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_modificadores.html'), html)

  // Los cuatro casos que la maqueta dibuja tienen que estar EN LA FOTO, no
  // sólo en los datos: si un texto se rompe al pintarlo, esto lo caza.
  expect(html).toContain('Mismo nombre, reglas distintas')
  expect(html).toContain('Copiada 4 veces')
  expect(html).toContain('Se cambia en Last')
  expect(html).toContain('Apagada')
  expect(html).toContain('3 retiradas')
  expect(html).toContain(chipDeMasMarcas(9))
  // ABRIR SÍ, Y LOS OTROS DOS TODAVÍA NO (13/09).
  //
  // Esta prueba decía «NINGÚN botón: los tres destinos llegan con los tableros
  // 2, 4 y 5». Era correcta el 12/09 y dejó de serlo a las 10:16 del 13/09,
  // cuando se publicó el tablero 5 — pero nadie la cambió, así que la pantalla
  // salió sin manera de abrir una pregunta y la prueba lo bendijo. Al arreglar
  // la fila, esta línea saltó: la regla vieja cazando el cambio. Hace bien, y
  // por eso se corrige en vez de borrarla.
  //
  // «Juntar» y «Revisar» siguen prohibidos, y eso NO es papeleo: son los
  // tableros 2 y 4, que aún no existen. El día que existan, esta prueba tiene
  // que volver a saltar.
  expect(html).toContain('Abrir')
  expect(html).not.toContain('>Juntar<')
  expect(html).not.toContain('>Revisar<')
  // Y el rojo, sólo donde hay algo que hacer.
  expect(html).not.toContain('Sin opciones: no sale')
})
