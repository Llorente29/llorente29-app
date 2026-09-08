// La captura de Rentabilidad para ponerla al lado de `Rentabilidad.dc.html`
// (§9.2/§9.3 del encargo de Extras).
//
// LA FOTO USA LOS COMPONENTES DE VERDAD, no una copia de su marcado. Antes esto
// llevaba las filas escritas a mano aquí, y por eso pudo pasar lo del 08/09:
// Julio vio «coste conocido» en gris y la columna llevaba arreglada desde
// B83.4 — en la pantalla. La que estaba mal era la foto (regla 30: esconder que
// algo ya estaba hecho). `TablaDeCarta` y `BloqueSinCoste` viven en
// `components/` justamente para que aquí no haya nada que copiar.
//
// Y LOS DATOS SON LOS DE VERDAD, los 33 productos de `fixtures/cartaDeMeraki.ts`
// —los mismos con los que se prueba la regla— con su precio, su IVA, su
// `computed_cost` y sus unidades vendidas en la ventana FIJA
// `[2026-06-08 00:00+02, 2026-09-06 00:00+02)` de la cuenta Foodint (regla 9).
// Antes veinte filas mezclaban unidades verificadas con unidades puestas a ojo
// para rellenar; lo declaré y ya no hace falta: el fixture las tiene reales.
//
// EL ORDEN TAMBIÉN SALE DE LA REGLA (§3.21.1). Julio, 08/09: «con Por margen
// marcado la captura enseña 4,02 · 4,02 · 3,67 · 4,03 · 4,79 · 4,12: no está
// ordenada». No lo estaba porque la foto no pasaba por la ordenación de nadie.
// Ahora llama a `ordenaLaCarta`, la misma función que la pantalla.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, CampoCocina, CifrasCocina, CifraCocina, ChipCocina, InterruptorCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { BloqueSinCoste, TablaDeCarta } from '@/modules/kitchen/components/TablasDeRentabilidad'
import { enteroDeCocina, eurDeCocina } from '@/modules/kitchen/lib/lasCosasQueArreglar'
import {
  calculaFila, cifrasDeRentabilidad, losSinCoste, ordenaLaCarta,
} from '@/modules/kitchen/lib/cartaYMargen'
import { CARTA_DE_MERAKI } from './fixtures/cartaDeMeraki'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'

const DIAS = 90
// La ventana FIJA con la que se midieron las unidades del fixture.
const DESDE = new Date(2026, 5, 8)
const HASTA = new Date(2026, 8, 6)

// HOY FOODINT NO TIENE OBJETIVO DE COMIDA (`kitchen_settings.target_food_cost_pct`
// a NULL), así que no sale ni una pastilla «caro de hacer» — y el Resumen lo dice
// en su cuarta fila. Las dos pantallas cuentan la misma historia (§3.21.2).
const OBJETIVO_DE_LA_CUENTA: number | null = null

const FILAS = CARTA_DE_MERAKI.map(calculaFila)
const cifras = cifrasDeRentabilidad(FILAS, DIAS)
// La MISMA función que la pantalla, con el mismo orden que enseña el chip.
const conCoste = ordenaLaCarta(FILAS, 'margen')
const sinCoste = losSinCoste(FILAS)

const eurSinSimbolo = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`

// ── La foto no enseña lo que la pantalla no tiene (regla 37) ───────────────
describe('la captura de Rentabilidad y la pantalla enseñan los mismos selectores', () => {
  const campos = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/<CampoCocina\s+label="([^"]+)"/g)].map((m) => m[1]).sort()

  it('los mismos, y no por casualidad ninguno', () => {
    const enLaPagina = campos('../../../../src/modules/kitchen/pages/KitchenProfitabilityPage.tsx')
    expect(enLaPagina.length).toBeGreaterThan(0)
    expect(campos('./capturaRentabilidad.test.tsx')).toEqual(enLaPagina)
  })

  // Y aquí NO hay Local, y es a propósito: `menu_item_economics` y
  // `menu_item_units_sold` no aceptan local (medido en la base). Un selector
  // que no filtra es peor que su ausencia.
  it('no hay selector de Local, porque la consulta no lo acepta', () => {
    expect(campos('../../../../src/modules/kitchen/pages/KitchenProfitabilityPage.tsx')).not.toContain('Local')
  })
})

it('genera la captura de Rentabilidad a 1280', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Folvy Kitchen · Cuenta Foodint"
          pregunta="¿Qué platos te dejan más margen?"
          regla={<>Margen = precio de carta sin IVA − coste del plato (ingredientes y envase) ·{' '}
            <em className="not-italic text-cocina-tinta-3">
              vendido {intervaloDeFechas(DESDE, HASTA, { minuscula: true })}
            </em>.{' '}
            <span className="text-cocina-tinta-3">El margen después de la comisión de Glovo, Uber o Just Eat llega cuando el catálogo tenga canal.</span></>}
        >
          <CampoCocina label="Marca"><span>Meraki Pita</span></CampoCocina>
          <CampoCocina label="Periodo"><span>Últimos 90 días</span></CampoCocina>
        </CabeceraCocina>

        {/* Las cinco cifras las cuenta `cifrasDeRentabilidad`, la misma función
            que la pantalla: aquí no hay ni un número escrito a mano. */}
        <CifrasCocina>
          <CifraCocina titulo="Platos en carta" valor={String(cifras.platosEnCarta)}
            pie={`${cifras.conCoste} con coste · ${cifras.sinCoste} sin coste`} />
          <CifraCocina titulo="Margen por unidad vendida" valor={eurSinSimbolo(cifras.margenPorUnidadVendida)} sufijo="€"
            pie="media de todo lo vendido con coste, bebidas incluidas" />
          <CifraCocina titulo="Margen que han dejado" valor={eurDeCocina(cifras.margenDelPeriodo)} tono="bueno"
            pie={`en ${DIAS} días · ${eurDeCocina(cifras.margenPorMes)} al mes · sumado plato a plato con el coste exacto`} />
          <CifraCocina titulo="Mejor plato" valor={eurSinSimbolo(cifras.mejorPlato?.margen)} sufijo="€"
            pie={cifras.mejorPlato ? `${cifras.mejorPlato.nombre} · ${pct(cifras.mejorPlato.costeSobrePrecio)} de coste` : '—'} />
          <CifraCocina titulo="Vendidos sin saber el coste" valor={enteroDeCocina(cifras.udsSinCoste)} tono="malo"
            pie={`de ${enteroDeCocina(cifras.udsTotales)} · son los ${cifras.sinCoste} platos sin coste`} />
        </CifrasCocina>

        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <div className="flex gap-1.5">
            <ChipCocina activo>Por margen</ChipCocina>
            <ChipCocina>Por lo vendido</ChipCocina>
            <ChipCocina>Por coste</ChipCocina>
          </div>
          <InterruptorCocina activo={false} onChange={() => {}}>Sólo los que no tienen coste</InterruptorCocina>
        </div>

        {/* Los componentes de la pantalla, no una copia de su marcado. */}
        <TablaDeCarta filas={conCoste} recetaPorItem={new Map()} abrir={() => {}}
          margenPropio objetivoPct={OBJETIVO_DE_LA_CUENTA} />

        <BloqueSinCoste filas={sinCoste} udsSinCoste={cifras.udsSinCoste} dias={DIAS}
          recetaPorItem={new Map()} abrir={() => {}} />

        <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
          Precios y costes son los de hoy; lo vendido, lo que dice el TPV en el periodo.
          Meraki Pita es tuya: el margen es tuyo entero.
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
<a href="#">Resumen</a><a href="#">Cartas</a><a href="#">Casado</a><a href="#">Extras</a>
<a href="#">Disponibilidad</a><a href="#">Informes de disponibilidad</a><div class="sep"></div>
<a href="#">Ingredientes</a><a href="#">Proveedores</a><a href="#">Platos</a><a href="#">Precios</a>
<div class="sep"></div><a class="on" href="#">Rentabilidad</a><a href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Reglas de ofertas</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_rentabilidad.html'), html)
  expect(cuerpo).toContain('¿Qué platos te dejan más margen?')
  expect(cuerpo).not.toMatch(/text-text-primary|border-border-default|bg-card/)
})
