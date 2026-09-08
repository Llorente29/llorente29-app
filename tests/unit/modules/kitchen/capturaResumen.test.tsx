// La captura del Resumen para ponerla al lado de su tablero (§9.2/§9.3 del
// encargo de Extras: las tres pantallas de B79 pasan al estándar de la maqueta,
// con captura comparada a 1280).
//
// EL TABLERO DEL RESUMEN SE LLAMA `Main.dc.html`, no «Resumen»: en el lienzo
// aprobado es la pantalla principal. Lo digo porque buscarlo por su nombre no lo
// encuentra, y dar por hecho que no existe habría sido construir sin vara.
//
// MISMO MÉTODO QUE EXTRAS: los componentes REALES con el CSS del build, nunca un
// HTML escrito para la foto. Y desde B84 (regla 37) la cabecera también sale de
// `CabeceraCocina`, no escrita aquí: la foto que inventa su cabecera enseña
// selectores que la pantalla no tiene, y eso ya pasó una vez.
//
// DATOS REALES de Foodint, medidos hoy sobre los 30 días: comida 24,1 % ·
// cobertura 88,2 % · 72.777 € vendidos · 17.510 € de comida · own 18,6 % /
// licensed 27,0 % · 3 ventas sin marca (31 €) · y los cinco contadores de
// `kitchen_catalog_gaps` (84/120 extras, 129/551 platos, 314 sin envase, 1 sin
// objetivo, 23/133 ingredientes).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, CampoCocina, CifrasCocina, CifraCocina,
  BotonCocina, InterruptorCocina, PanelCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  eurDeCocina, pintaCosa, lasQueMasPesan, type CosaMedida,
} from '@/modules/kitchen/lib/lasCosasQueArreglar'

import { TablaPorMarca } from '@/modules/kitchen/components/TablaPorMarca'
import { REJILLA_COSAS } from '@/modules/kitchen/lib/rejillasDeCocina'

// ── Las marcas, tal cual las devuelve `food_cost_dashboard` hoy ─────────────
type M = { marca: string; ingreso: number; food: number; cobertura: number; propia: boolean }
const MARCAS: M[] = [
  { marca: 'Milanesa House', ingreso: 7181, food: 18.1, cobertura: 91.1, propia: true },
  { marca: 'Meraki Pita', ingreso: 6590, food: 16.2, cobertura: 96.2, propia: true },
  { marca: 'Lovers Burgers', ingreso: 3437, food: 18.1, cobertura: 100.0, propia: true },
  { marca: "Mila's Sandwiches", ingreso: 2709, food: 19.5, cobertura: 93.9, propia: true },
  { marca: 'Bendito Burrito', ingreso: 2169, food: 23.9, cobertura: 94.4, propia: true },
  { marca: 'Smash Brothers Burgers', ingreso: 1718, food: 21.9, cobertura: 59.4, propia: true },
  { marca: 'Scandal Burgers', ingreso: 1054, food: 18.1, cobertura: 96.2, propia: true },
  { marca: 'Dirty Burger', ingreso: 189, food: 23.0, cobertura: 100.0, propia: true },
  { marca: 'The Urban Kebab', ingreso: 141, food: 21.8, cobertura: 63.6, propia: true },
  { marca: 'Dos Coyotes', ingreso: 14473, food: 27.8, cobertura: 96.1, propia: false },
  { marca: 'Milanesa Haus', ingreso: 10160, food: 26.4, cobertura: 99.8, propia: false },
  { marca: 'Koreans do it better - Fried Chicken', ingreso: 7901, food: 28.1, cobertura: 76.9, propia: false },
  { marca: 'Birria Burrito', ingreso: 6127, food: 27.5, cobertura: 98.2, propia: false },
  { marca: 'Big Mike´s Burger Joint', ingreso: 4130, food: 25.5, cobertura: 88.2, propia: false },
  { marca: 'Ay Mamita Bowls', ingreso: 2378, food: 22.5, cobertura: 60.9, propia: false },
  { marca: 'Chivuos', ingreso: 1692, food: 23.5, cobertura: 52.7, propia: false },
  { marca: 'Deep Pizza', ingreso: 699, food: 33.1, cobertura: 100.0, propia: false },
]

// ── LAS CINCO COSAS, TAL CUAL LAS DEVUELVE `kitchen_catalog_gaps` HOY ──────
//
// Y los textos NO se escriben aquí: se piden a `pintaCosa`, que es la que los
// escribe en la pantalla. La primera versión de esta captura los tecleaba a
// mano y por eso pintó una consecuencia que la pantalla no decía — el mismo
// fallo de B84.2 (la foto inventando su cabecera) una fila más abajo. La regla
// 37 vale para todo lo que la foto enseña, no sólo para los selectores.
const COSAS: CosaMedida[] = [
  { clave: 'extras_que_cobran_sin_coste', orden: 1, n: 83, de: 120, venden: 25,
    definicion: 'Un extra que el cliente paga aparte y que, sumado lo que lleva, sigue valiendo 0 €.',
    porQueAqui: '', accion: 'Ponerles coste',
    peores: [
      { brandId: 'b1', marca: 'The Urban Kebab', n: 18, de: 27 },
      { brandId: 'b2', marca: 'Scandal Burgers', n: 16, de: 17 },
      { brandId: 'b3', marca: 'Big Mike´s Burger Joint', n: 12, de: 14 },
      { brandId: 'b4', marca: 'Milanesa Haus', n: 8, de: 8 },
    ] },
  { clave: 'platos_en_carta_sin_coste', orden: 2, n: 129, de: 551, sinFicha: 128, conFichaSinCoste: 1,
    definicion: 'Un plato de la carta del que Folvy no sabe lo que cuesta: o no tiene ficha, o la tiene sin cerrar.',
    porQueAqui: '', accion: 'Casar o crear la ficha',
    peores: [
      { brandId: 'c1', marca: 'Chivuos', n: 17, de: 45 },
      { brandId: 'c2', marca: 'Big Mike´s Burger Joint', n: 14, de: 49 },
      { brandId: 'c3', marca: 'The Urban Kebab', n: 12, de: 29 },
      { brandId: 'c4', marca: 'Dos Coyotes', n: 11, de: 45 },
    ] },
  { clave: 'platos_en_carta_sin_envase', orden: 3, n: 314, de: 551,
    definicion: 'Un plato cuya ficha tiene el envase a cero, así que su coste está incompleto.',
    porQueAqui: '', accion: 'Poner envase',
    peores: [
      { brandId: 'd1', marca: 'Big Mike´s Burger Joint', n: 29, de: 49 },
      { brandId: 'd2', marca: 'Chivuos', n: 27, de: 45 },
      { brandId: 'd3', marca: 'Koreans do it better - Fried Chicken', n: 26, de: 40 },
    ] },
  { clave: 'sin_objetivo_de_comida', orden: 4, n: 1, de: 1, platosConObjetivoPropio: 13,
    definicion: 'La cuenta no tiene un objetivo de comida sobre ventas al que comparar.',
    porQueAqui: '', accion: 'Poner objetivo', peores: [] },
  { clave: 'ingredientes_sin_precio', orden: 5, n: 23, de: 133, usadosEnLineasDeReceta: 0,
    definicion: 'Un ingrediente en uso al que no se le ha puesto ningún precio.',
    porQueAqui: '', accion: 'Poner precios', peores: [] },
]

// Los mismos números que la cifra grande, para que la consecuencia de la fila
// de envases diga el porcentaje que se está viendo y no otro.
const COMIDA_PCT = 24.1
const ENVASE_EUR = 2702


// ── La foto no puede enseñar lo que la pantalla no tiene (regla 37) ─────────
describe('la captura del Resumen y la pantalla enseñan los mismos selectores', () => {
  const campos = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/<CampoCocina\s+label="([^"]+)"/g)].map((m) => m[1]).sort()

  it('los mismos, y no por casualidad ninguno', () => {
    const enLaPagina = campos('../../../../src/modules/kitchen/pages/KitchenDashboardPage.tsx')
    expect(enLaPagina.length).toBeGreaterThan(0)
    expect(campos('./capturaResumen.test.tsx')).toEqual(enLaPagina)
  })
})

it('genera la captura del Resumen a 1280', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Folvy Kitchen · Cuenta Foodint"
          pregunta="¿Cómo va tu cocina este mes?"
          regla={<>Comida = ingredientes y envase de lo que has vendido · ventas = precio de carta
            sin IVA · <em className="not-italic text-cocina-tinta-3">del 9 de agosto al 7 de septiembre</em>.{' '}
            <span className="text-cocina-tinta-3">El margen después de Glovo, Uber y Just Eat llega cuando el catálogo tenga canal.</span></>}
        >
          <CampoCocina label="Periodo"><span>Últimos 30 días</span></CampoCocina>
          <CampoCocina label="Local"><span>Todos</span></CampoCocina>
          <CampoCocina label="Marcas"><span>Todas</span></CampoCocina>
        </CabeceraCocina>

        <CifrasCocina>
          <CifraCocina titulo="Comida sobre ventas · todas las marcas" valor="24,1" sufijo="%"
            pie={`tuyas 18,6 % · de terceros 27,0 % · ${eurDeCocina(17510)} de comida sobre ${eurDeCocina(72777)} vendidos · 3 ventas sin marca (${eurDeCocina(31)}) van dentro`} />
          <CifraCocina titulo="Ventas con coste conocido" valor="88" sufijo="%"
            pie="el 12 % restante se vende sin saber lo que cuesta" />
          <CifraCocina titulo="Platos con coste" valor="422" sufijo="de 551" tono="malo"
            pie="129 se venden sin saber lo que cuestan" />
          <CifraCocina titulo="Extras que cobran sin coste" valor="83" sufijo="de 120" tono="malo"
            pie="entran por caja y no descuentan comida" />
          <CifraCocina titulo="Ingredientes sin precio" valor="23" sufijo="de 133" tono="malo"
            pie="en uso · todavía no están en ninguna receta" />
        </CifrasCocina>

        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <InterruptorCocina activo onChange={() => {}}>Sólo lo que hay que arreglar</InterruptorCocina>
          <span className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
            5 cosas · ordenadas por lo que más pesa en el 24,1 %
          </span>
        </div>

        <PanelCocina>
          {COSAS.map((c) => {
            const p = pintaCosa(c, ENVASE_EUR, COMIDA_PCT)
            return (
            <div key={c.clave}
              className="grid items-start gap-3.5 px-4 py-3 border-b border-cocina-linea-suave last:border-b-0"
              style={{ gridTemplateColumns: REJILLA_COSAS }}>
              <div className="text-[13.5px] font-semibold text-cocina-tinta">{p.titulo}</div>
              <div className="min-w-0">
                <div className="text-[12.5px] text-cocina-tinta-2 leading-[1.45]">{p.motivo}</div>
                {c.peores.length > 0 && (
                  <div className="text-[12.5px] text-cocina-tinta-2 leading-[1.45] mt-0.5">
                    Las que más: <b className="font-semibold text-cocina-tinta">{lasQueMasPesan(c.peores)}</b>
                  </div>
                )}
                <div className="text-[11.5px] text-cocina-tinta-3 mt-1">{c.definicion}</div>
              </div>
              <div className="shrink-0"><BotonCocina>{p.boton}</BotonCocina></div>
            </div>
            )
          })}
        </PanelCocina>

        {/* El componente de la pantalla, no una copia. Julio, 08/09: vio
            «coste conocido» en gris y la PANTALLA la tenía en tinta desde
            B83.4 — la que mentía era esta foto. */}
        <TablaPorMarca
          marcas={MARCAS.map((m) => ({
            marca: m.marca, ownershipType: m.propia ? 'own' : 'licensed',
            ingreso: m.ingreso, foodCostPct: m.food, coberturaPct: m.cobertura,
          }))}
          verPlatos={() => {}} />

        <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
          Las de terceros son el 67 % de lo vendido y su comida cuesta el 27,0 %: la cifra de arriba
          es sobre todo suya. Con «Marcas: sólo tuyas» pasa a 18,6 %. Su carta la manda el TPV.
        </p>
      </div>
    </div>,
  )

  const dist = resolve(__dirname, '../../../../dist/assets')
  const css = readFileSync(
    resolve(dist, readdirSync(dist).filter((f) => f.startsWith('index-') && f.endsWith('.css'))[0]), 'utf8')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
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
<a class="on" href="#">Resumen</a><a href="#">Cartas</a><a href="#">Casado</a><a href="#">Extras</a>
<a href="#">Disponibilidad</a><a href="#">Informes de disponibilidad</a><div class="sep"></div>
<a href="#">Ingredientes</a><a href="#">Proveedores</a><a href="#">Platos</a><a href="#">Precios</a>
<div class="sep"></div><a href="#">Rentabilidad</a><a href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Reglas de ofertas</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_resumen.html'), html)
  expect(cuerpo).toContain('¿Cómo va tu cocina este mes?')
  // Se mide el MARCADO, no el fichero: el CSS del build lleva compiladas todas
  // las clases de la app, así que buscarlas en `html` da positivo siempre. Es el
  // mismo error de medir sobre el sitio equivocado que ya se pagó hoy.
  expect(cuerpo).not.toMatch(/text-text-primary|border-border-default|bg-card/)
})
