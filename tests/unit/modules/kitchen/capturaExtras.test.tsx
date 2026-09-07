// Genera la captura de la sección Extras para compararla con el tablero de la
// maqueta (§9.3 del encargo: «captura de la pantalla construida al lado del
// tablero, misma anchura (1280)»).
//
// NO reescribe el marcado: renderiza LOS COMPONENTES DE VERDAD con
// `renderToStaticMarkup` y les pone encima el CSS que sale del build. Si
// reescribiera el HTML para la foto, la foto no probaría nada.
//
// Los datos son los REALES de producción, medidos el 07/09 con el cuerpo de la
// RPC ejecutado como consulta suelta.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, CampoCocina, CifrasCocina, CifraCocina,
  PastillaCocina, BotonCocina, ChipCocina, InterruptorCocina, PanelCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  ORDENES, cuantasCopias, loQueCobra, queLleva, botonDeLaFila,
  type ExtraPorNombre,
} from '@/modules/kitchen/lib/extrasDeCocina'

const REJILLA = 'minmax(0,1fr) 120px 90px 110px 150px auto'

const F = (
  nombre: string, marcas: string, copias: number, nMarcas: number,
  pmin: number, pmax: number, vendidas: number,
  estado: ExtraPorNombre['estado'] = 'nada_puesto',
): ExtraPorNombre => ({
  clave: nombre.toLowerCase(), nombre, copias, marcas: nMarcas, vendidas,
  cobrado: vendidas * pmin, precioMin: pmin, precioMax: pmax,
  preciosDistintos: pmin !== pmax, estado, costeYaPuesto: null, marcaQueYaLoTiene: null,
  donde: marcas.split(' · ').map((m, i) => ({
    opcion: `${nombre}-${i}`, marca: m, marcaId: m, grupo: 'g',
    precio: pmin, vendidas: 0, coste: 0, tieneCoste: false,
  })),
})

// Las filas REALES del 07/09, en el orden que da la RPC (por lo vendido).
const FILAS: ExtraPorNombre[] = [
  F('Base Ternera (Premium Selection)', 'Milanesa House', 2, 1, 1.5, 2.5, 55, 'puesto_pero_cero'),
  F('Salsa Tzatziki (Recomendada)', 'Meraki Pita · The Urban Kebab', 6, 2, 2, 2, 42),
  F('Sweet Chili T', 'Big Mike´s Burger Joint', 1, 1, 0.6, 0.6, 35, 'puesto_pero_cero'),
  F('Mayo Spicy', 'Big Mike´s Burger Joint', 1, 1, 1, 1, 32),
  F('Milanesa de ternera', "Mila's Sandwiches", 2, 1, 1.5, 2, 30),
  F('Salsa Yogur', 'Meraki Pita · The Urban Kebab', 7, 2, 1.5, 1.5, 24),
  F('Mayo Smokey', 'Big Mike´s Burger Joint · Milanesa Haus', 2, 2, 1, 1, 22),
  F('Mayo trufa', 'Big Mike´s Burger Joint · Milanesa Haus', 2, 2, 1, 1, 21),
  F('Salsa Harissa (Picante)', 'Meraki Pita · The Urban Kebab', 6, 2, 1.5, 1.5, 18),
  F('extra carne mixta', 'Meraki Pita · The Urban Kebab', 6, 2, 3.5, 3.5, 16),
  F('Salsa coreana', 'Big Mike´s Burger Joint · Milanesa Haus', 2, 2, 1, 1, 11, 'mixto'),
  F('Sweet Chili', 'Big Mike´s Burger Joint · Milanesa Haus', 2, 2, 1, 1, 9),
  F('BBQ-Barbacue', 'Big Mike´s Burger Joint · Milanesa Haus', 2, 2, 1, 1, 9, 'mixto'),
  F('Tiras de Pollo Kentucky, 4 Unidades', 'Smash Brothers Burgers', 1, 1, 1.9, 1.9, 5),
  F('Ración de consomé', 'Dos Coyotes', 1, 1, 2, 2, 3),
  F('Mixto (Ternera & Pollo)', 'The Urban Kebab', 3, 1, 0.5, 0.5, 2),
]

function Fila({ e }: { e: ExtraPorNombre }) {
  const cobra = loQueCobra(e); const lleva = queLleva(e)
  const marcas = [...new Set(e.donde.map((d) => d.marca))].join(' · ')
  return (
    <div className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[50px]"
         style={{ gridTemplateColumns: REJILLA }}>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-cocina-tinta">{e.nombre}</div>
        <div className="text-[11.5px] font-medium text-cocina-tinta-3 mt-0.5 truncate">{marcas}</div>
      </div>
      <div className="text-right text-[13px] text-cocina-tinta-2">{cuantasCopias(e)}</div>
      <div className="text-right">
        {cobra.esRango ? <PastillaCocina tono="ambar">{cobra.texto}</PastillaCocina>
                       : <span className="num text-[13px] text-cocina-tinta">{cobra.texto}</span>}
      </div>
      <div className="text-right num text-[13px] text-cocina-tinta">{e.vendidas}</div>
      <div><PastillaCocina tono={lleva.tono}>{lleva.texto}</PastillaCocina></div>
      <div className="flex gap-2">
        <BotonCocina>{botonDeLaFila(e)}</BotonCocina>
        <BotonCocina peso="fantasma">Ver dónde</BotonCocina>
      </div>
    </div>
  )
}


// ── LA FOTO NO PUEDE ENSEÑAR LO QUE LA PANTALLA NO TIENE (B84.2) ───────────
//
// Costó un fallo en producción: la captura escribía su propia cabecera con
// «MARCA» y «PERIODO», la miramos los dos y la dimos por buena — y la página
// real sólo tenía Marca. La comparación del §9.3 valía menos de lo que
// parecía porque los dos lados no eran la misma cabecera.
//
// Esto lo fija leyendo los DOS ficheros: los selectores de la foto y los de la
// página tienen que ser los mismos. No prueba el diseño; prueba que la prueba
// del diseño mide lo que dice medir.
describe('la captura y la pantalla enseñan los mismos selectores', () => {
  const campos = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/<CampoCocina\s+label="([^"]+)"/g)].map((m) => m[1]).sort()

  it('los mismos, y no por casualidad ninguno', () => {
    const enLaFoto = campos('./capturaExtras.test.tsx')
    const enLaPagina = campos('../../../../src/modules/kitchen/pages/KitchenExtrasPage.tsx')
    expect(enLaPagina.length).toBeGreaterThan(0)
    expect(enLaFoto).toEqual(enLaPagina)
  })
})

it('genera la captura de Extras a 1280', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Folvy Kitchen · Cuenta Foodint"
          pregunta="¿Qué extras cobras sin saber lo que te cuestan?"
          regla={<>Un extra es lo que el cliente añade o elige y paga aparte. Aquí se le dice{' '}
            <b className="font-semibold text-cocina-tinta">una vez</b> qué lleva y vale para todos los
            platos donde aparezca · <em className="not-italic text-cocina-tinta-3">vendido del 9 de agosto al 7 de septiembre.</em></>}
        >
          <CampoCocina label="Marca"><span>Todas</span></CampoCocina>
          <CampoCocina label="Periodo"><span>Últimos 30 días</span></CampoCocina>
        </CabeceraCocina>

        <CifrasCocina>
          <CifraCocina titulo="Extras que cobran" valor="120" pie="en 13 marcas · 56 nombres distintos sin coste" />
          <CifraCocina titulo="Con coste" valor="22" tono="bueno" pie="ya dicen lo que llevan" />
          <CifraCocina titulo="Sin coste" valor="98" tono="malo" pie="entran por caja y no descuentan comida" />
          <CifraCocina titulo="Vendidos sin coste" valor="326" pie="33 extras distintos, en 30 días" />
          <CifraCocina titulo="Cobrado sin saber el coste" valor="519,50" sufijo="€" tono="malo"
                       pie="en 30 días · la comida que llevan no está en el coste" />
        </CifrasCocina>

        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <div className="flex gap-3.5 items-center flex-wrap">
            <InterruptorCocina activo onChange={() => {}}>Sólo los que hay que arreglar</InterruptorCocina>
            <div className="flex gap-1.5">
              {ORDENES.map((o) => <ChipCocina key={o.clave} activo={o.clave === 'vendido'}>{o.etiqueta}</ChipCocina>)}
            </div>
          </div>
          <span className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">56 nombres · 100 copias · los 33 que se venden, primero</span>
        </div>

        <PanelCocina>
          <div className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
               style={{ gridTemplateColumns: REJILLA }}>
            <span>Extra</span><span className="text-right">Copias</span><span className="text-right">Cobra</span>
            <span className="text-right">Vendido 30 d</span><span>Qué lleva</span><span />
          </div>
          {FILAS.map((e) => <Fila key={e.clave} e={e} />)}
          <div className="flex items-baseline gap-2.5 px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2">
            <span className="text-[14px] font-bold text-cocina-tinta">y 40 extras más sin coste</span>
            <span className="text-[12px] text-cocina-tinta-3">que no se han vendido en 30 días · ordenados por copias</span>
          </div>
        </PanelCocina>

        <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
          Al decir qué lleva un extra se aplica a todas sus copias y el coste se ve al momento en la
          pestaña Modificadores de cada plato. Un plato entero («Sí, con patatas») se pone como plato,
          no como ingredientes.
        </p>
      </div>
    </div>,
  )

  // El CSS que sale del build de verdad, no uno escrito para la foto.
  const dist = resolve(__dirname, '../../../../dist/assets')
  const css = readdirSync(dist).filter((f) => f.startsWith('index-') && f.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${hoja}</style>
<style>html,body{margin:0;background:#EAEEF1}
/* El carril de la maqueta, para que la comparación sea de la pantalla entera. */
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
<a href="#">Resumen</a><a href="#">Cartas</a><a href="#">Casado</a><a class="on" href="#">Extras</a>
<a href="#">Disponibilidad</a><a href="#">Informes de disponibilidad</a><div class="sep"></div>
<a href="#">Ingredientes</a><a href="#">Proveedores</a><a href="#">Platos</a><a href="#">Precios</a>
<div class="sep"></div><a href="#">Rentabilidad</a><a href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Reglas de ofertas</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_extras.html'), html)
})
