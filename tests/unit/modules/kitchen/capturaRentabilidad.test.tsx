// La captura de Rentabilidad para ponerla al lado de `Rentabilidad.dc.html`
// (§9.2/§9.3 del encargo de Extras).
//
// Mismo método que las otras dos: los componentes REALES con el CSS del build, y
// los textos de fila salen de `lib/cartaYMargen`, no escritos aquí (regla 37 —
// la foto no enseña lo que la pantalla no dice).
//
// DATOS: Meraki Pita a 90 días. Los precios y los costes son los de HOY, medidos
// contra producción; las unidades vendidas son las que Julio verificó en
// producción el 06/09 (§3.17: 33 · 27 · 6 · 8,04 € · 11,81 € · 90 de 2.061).
// Dos varas y las dos escritas: los costes se mueven con las compras y las uds
// con la ventana móvil, así que la foto no promete que cuadren al céntimo con
// la pantalla de mañana — promete que son de la carta de verdad.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, CabeceraDeBloque, CampoCocina, CifrasCocina, CifraCocina,
  BotonCocina, ChipCocina, InterruptorCocina, PanelCocina, PastillaCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { eurDeCocina } from '@/modules/kitchen/lib/lasCosasQueArreglar'
import { etiquetasDeFila, motivoSinCoste, type ProductoDeCarta } from '@/modules/kitchen/lib/cartaYMargen'

const REJILLA_CARTA = 'minmax(0,1fr) 105px 80px 95px 110px 75px auto'
const REJILLA_SIN_COSTE = 'minmax(0,1fr) 120px 110px 90px auto'

const eur = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`

// ── La carta de Meraki, precios y costes reales de hoy ─────────────────────
type F = { id: string; nombre: string; precio: number; coste: number; uds: number }
const CARTA: F[] = [
  { id: '1', nombre: 'Pita BOWL Ternera: Sabor Tradicional 🥗', precio: 14.90, coste: 1.7338, uds: 15 },
  { id: '2', nombre: 'Pita BOWL Pollo: El Clásico Jugoso 🥗', precio: 14.70, coste: 1.6702, uds: 64 },
  { id: '3', nombre: 'Pita BOWL Mixto: La Experiencia Completa 🥗', precio: 14.80, coste: 2.0362, uds: 68 },
  { id: '4', nombre: 'The Mixed Master: Pita Mixta Gyros 🌯', precio: 13.90, coste: 2.2602, uds: 437 },
  { id: '5', nombre: 'The Beef Legend: Pita de Ternera Gyros 🌯', precio: 13.90, coste: 2.2921, uds: 149 },
  { id: '6', nombre: 'Plato Mixto Gyros: Carne y Patatas 🍟', precio: 12.90, coste: 1.7099, uds: 51 },
  { id: '7', nombre: 'The Golden Chicken: Pita de Pollo Gyros 🌯', precio: 12.90, coste: 2.2250, uds: 208 },
  { id: '8', nombre: 'Plato Pollo Gyros: Pollo y Patatas 🍟', precio: 11.90, coste: 1.6781, uds: 66 },
  { id: '9', nombre: 'The Green Falafel: Pita Artesana 🌿', precio: 11.90, coste: 1.8796, uds: 41 },
  { id: '10', nombre: 'Kebab de Ternera Gyros 🌯', precio: 11.10, coste: 2.3703, uds: 96 },
  { id: '11', nombre: 'Kebab Mixto: Pollo y Ternera 🌯', precio: 10.90, coste: 2.3322, uds: 88 },
  { id: '12', nombre: 'Kebab de Pollo Gyros 🌯', precio: 10.50, coste: 2.2905, uds: 122 },
  { id: '13', nombre: 'The Spanakopita Twist (Greek Spiral) 🌿', precio: 9.90, coste: 1.4206, uds: 9 },
  { id: '14', nombre: 'Kebab de Falafel 🌿', precio: 9.90, coste: 1.7744, uds: 33 },
  { id: '15', nombre: 'Tarta 3 Leches', precio: 7.90, coste: 3.1580, uds: 27 },
  { id: '16', nombre: 'Cheesecake de Nutella', precio: 7.90, coste: 3.1580, uds: 21 },
  { id: '17', nombre: 'Marquesa de Choco-Avellanas', precio: 6.90, coste: 2.5988, uds: 12 },
  { id: '18', nombre: 'Rollitos de Queso Feta (3 unidades)', precio: 6.30, coste: 1.6941, uds: 44 },
  { id: '19', nombre: 'Crispy Falafel & Greek Dip (3 uds) 🌿', precio: 6.50, coste: 1.1222, uds: 38 },
  { id: '20', nombre: 'Patatas Clásicas Meraki', precio: 5.50, coste: 0.8761, uds: 149 },
]
const neto = (f: F) => f.precio / 1.1
const margen = (f: F) => neto(f) - f.coste
const costeSobrePrecio = (f: F) => 100 * f.coste / neto(f)

// Los seis sin coste: 4 menús y 2 sin receta, que es lo que separa `product_type`.
const SIN_COSTE: Array<{ id: string; nombre: string; precio: number; uds: number; tipo: ProductoDeCarta['tipo'] }> = [
  { id: 's1', nombre: 'Menú Pita Mixta + Patatas + Bebida', precio: 17.90, uds: 34, tipo: 'combo' },
  { id: 's2', nombre: 'Menú Kebab de Pollo + Patatas + Bebida', precio: 15.90, uds: 28, tipo: 'combo' },
  { id: 's3', nombre: 'Menú Pita BOWL + Bebida', precio: 16.90, uds: 12, tipo: 'combo' },
  { id: 's4', nombre: 'Menú Falafel + Patatas + Bebida', precio: 14.90, uds: 9, tipo: 'combo' },
  { id: 's5', nombre: 'Salsa Tzatziki (bote 200 g)', precio: 2.50, uds: 5, tipo: 'item' },
  { id: 's6', nombre: 'Pan de pita suelto', precio: 1.20, uds: 2, tipo: 'item' },
]

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
            <em className="not-italic text-cocina-tinta-3">vendido del 9 de junio al 7 de septiembre</em>.{' '}
            <span className="text-cocina-tinta-3">El margen después de la comisión de Glovo, Uber o Just Eat llega cuando el catálogo tenga canal.</span></>}
        >
          <CampoCocina label="Marca"><span>Meraki Pita</span></CampoCocina>
          <CampoCocina label="Periodo"><span>Últimos 90 días</span></CampoCocina>
        </CabeceraCocina>

        <CifrasCocina>
          <CifraCocina titulo="Platos en carta" valor="33" pie="27 con coste · 6 sin coste" />
          <CifraCocina titulo="Margen por unidad vendida" valor="8,04" sufijo="€"
            pie="media de todo lo vendido con coste, bebidas incluidas" />
          <CifraCocina titulo="Margen que han dejado" valor={eurDeCocina(15849)} tono="bueno"
            pie={`en 90 días · ${eurDeCocina(5283)} al mes · sumado plato a plato con el coste exacto`} />
          <CifraCocina titulo="Mejor plato" valor="11,81" sufijo="€"
            pie="Pita BOWL Ternera · 12,8 % de coste" />
          <CifraCocina titulo="Vendidos sin saber el coste" valor="90" tono="malo"
            pie="de 2.061 · son los 6 platos sin coste" />
        </CifrasCocina>

        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <div className="flex gap-1.5">
            <ChipCocina activo>Por margen</ChipCocina>
            <ChipCocina>Por lo vendido</ChipCocina>
            <ChipCocina>Por coste</ChipCocina>
          </div>
          <InterruptorCocina activo={false} onChange={() => {}}>Sólo los que no tienen coste</InterruptorCocina>
        </div>

        <PanelCocina>
          <div className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
               style={{ gridTemplateColumns: REJILLA_CARTA }}>
            <span>Plato</span><span className="text-right">Precio de carta</span>
            <span className="text-right">Coste</span><span className="text-right">Margen</span>
            <span className="text-right">Coste sobre precio sin IVA</span>
            <span className="text-right">Vendidos</span><span />
          </div>
          {CARTA.map((f) => {
            const etiquetas = etiquetasDeFila({
              id: f.id, nombre: f.nombre, tipo: 'item', categoria: null,
              precio: f.precio, ivaPct: 10, coste: f.coste, uds: f.uds,
            } as never)
            return (
              <div key={f.id}
                className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[50px]"
                style={{ gridTemplateColumns: REJILLA_CARTA }}>
                <div className="min-w-0 flex items-center gap-1.5">
                  <span className="text-[13.5px] font-semibold text-cocina-tinta truncate">{f.nombre}</span>
                  {etiquetas.map((e) => <PastillaCocina key={e} tono="ambar">{e}</PastillaCocina>)}
                </div>
                <span className="num text-[13px] text-right text-cocina-tinta whitespace-nowrap">
                  {eur(f.precio)}
                  <span className="block text-[11px] text-cocina-tinta-3">{eur(neto(f)).replace(' €','')} sin IVA</span>
                </span>
                <span className="num text-[13px] text-right text-cocina-tinta">{eur(f.coste)}</span>
                <span className="num text-[13px] text-right font-semibold text-cocina-tinta">{eur(margen(f))}</span>
                <span className="num text-[13px] text-right text-cocina-tinta">{pct(costeSobrePrecio(f))}</span>
                <span className="num text-[13px] text-right text-cocina-tinta">{f.uds}</span>
                <span className="text-right"><BotonCocina peso="fantasma">Abrir</BotonCocina></span>
              </div>
            )
          })}
        </PanelCocina>

        <PanelCocina>
          <CabeceraDeBloque nombre="Sin coste · 6"
            detalle="se han vendido 90 veces en 90 días sin saber lo que cuestan" />
          {SIN_COSTE.map((f) => {
            const m = motivoSinCoste(f.tipo)
            return (
              <div key={f.id}
                className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[50px]"
                style={{ gridTemplateColumns: REJILLA_SIN_COSTE }}>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-cocina-tinta truncate">{f.nombre}</div>
                  <div className="text-[11.5px] text-cocina-tinta-3 mt-0.5">{m.motivo}</div>
                </div>
                <span className="num text-[13px] text-right text-cocina-tinta whitespace-nowrap">
                  {eur(f.precio)}
                  <span className="block text-[11px] text-cocina-tinta-3">{eur(f.precio / 1.1).replace(' €','')} sin IVA</span>
                </span>
                <span className="text-right"><PastillaCocina tono="ambar">sin coste</PastillaCocina></span>
                <span className="num text-[13px] text-right text-cocina-tinta">{f.uds}</span>
                <span className="text-right"><BotonCocina peso="borde">{m.boton}</BotonCocina></span>
              </div>
            )
          })}
        </PanelCocina>

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
