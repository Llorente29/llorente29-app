// La captura de Ingeniería de menús para ponerla al lado de `Ingenieria.dc.html`
// (§9.2/§9.3 del encargo de Extras, B83).
//
// MISMO MÉTODO QUE LAS OTRAS DOS, y aquí con más motivo: los componentes REALES
// con el CSS del build, y **todo** lo que dice cada fila —la frase, los botones,
// el rótulo del cuadrante, su explicación— sale de `lib/cartaYMargen`. Ni una
// letra escrita a mano (regla 37: la foto no enseña lo que la pantalla no dice).
//
// Y LA CARTA TAMPOCO SE ESCRIBE AQUÍ: viene de `fixtures/cartaDeMeraki.ts`, la
// misma población con la que se prueba la regla. Los cuadrantes de la foto no
// son «los que yo he colocado», son los que salen de `construyeMatriz` sobre los
// 33 productos que tenía Meraki el 06/09 (regla 31).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CabeceraCocina, CabeceraDeBloque, CampoCocina, CifrasCocina, CifraCocina,
  BotonCocina, ChipCocina, InterruptorCocina, PanelCocina, RotuloDePanel,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  calculaFila, construyeMatriz, esBebida, frasePorCuadrante,
  EXPLICACION_CUADRANTE, parteLaFrase, ROTULO_CUADRANTE, type Cuadrante, type FilaDeCarta,
} from '@/modules/kitchen/lib/cartaYMargen'
import { CARTA_DE_MERAKI } from './fixtures/cartaDeMeraki'
import { REJILLA_INGENIERIA, REJILLA_INGENIERIA_ESTRELLAS } from '@/modules/kitchen/lib/rejillasDeCocina'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'
import { fmtMoney } from '@/lib/format'

const PAGINA = '../../../../src/modules/kitchen/pages/KitchenMenuEngineeringPage.tsx'
const DIAS = 90

// La ventana FIJA con la que se midieron las unidades del fixture. La frase se
// GENERA con la misma función que la pantalla: si algún día el castellano de
// `intervaloDeFechas` cambia, cambia en los dos sitios a la vez (regla 15 de
// Extras: que no haya dos relojes).
const DESDE = new Date(2026, 5, 8)
const HASTA = new Date(2026, 8, 6)

const eurSinSimbolo = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const FILAS = CARTA_DE_MERAKI.map(calculaFila)
const matriz = construyeMatriz(FILAS)
const porCuadrante: Record<Cuadrante, FilaDeCarta[]> = { estrella: [], caballo: [], joya: [], lastre: [] }
for (const f of matriz.platos) {
  const c = matriz.cuadranteDe.get(f.id)
  if (c) porCuadrante[c].push(f)
}
for (const c of Object.keys(porCuadrante) as Cuadrante[]) porCuadrante[c].sort((a, b) => b.uds - a.uds)

const LOS_QUE_PIDEN_DECISION: Cuadrante[] = ['caballo', 'joya', 'lastre']
const ORDEN_DE_LAS_CIFRAS: Cuadrante[] = ['estrella', 'caballo', 'joya', 'lastre']

function pintaFila(f: FilaDeCarta, c: Cuadrante, compacta = false) {
  const { frase, destacado, botones } = frasePorCuadrante(f, c, matriz.mediaSimpleDeMargen ?? 0)
  const [antes, fuerte, despues] = parteLaFrase(frase, destacado)
  return (
    <div key={f.id}
      className={`grid items-center gap-3.5 px-4 border-b border-cocina-linea-suave last:border-b-0 ${
        compacta ? 'py-[5px] min-h-[40px]' : 'py-[7px] min-h-[48px]'}`}
      style={{ gridTemplateColumns: compacta ? REJILLA_INGENIERIA_ESTRELLAS : REJILLA_INGENIERIA }}>
      <div className="text-[13.5px] font-medium text-cocina-tinta">{f.nombre}</div>
      <span className="num text-[13px] text-right text-cocina-tinta whitespace-nowrap">
        {f.uds} <span className="text-[11px] text-cocina-tinta-3">uds</span>
      </span>
      <span className="num text-[13px] text-right font-bold text-cocina-tinta">{fmtMoney(f.margen)}</span>
      <div className="text-[12.5px] text-cocina-tinta-2 leading-[1.4]">
        {antes}<b className="font-semibold text-cocina-tinta">{fuerte}</b>{despues}
      </div>
      <span className="flex gap-2 justify-end">
        {botones.map((b, i) => (
          <BotonCocina key={b.texto} peso={i === 0 && botones.length > 1 ? 'borde' : 'fantasma'}>
            {b.texto}
          </BotonCocina>
        ))}
      </span>
    </div>
  )
}

// ── La foto no enseña lo que la pantalla no tiene (regla 37) ───────────────
describe('la captura de Ingeniería y la pantalla enseñan lo mismo', () => {
  const fuente = (ruta: string) => readFileSync(resolve(__dirname, ruta), 'utf8')
  const campos = (ruta: string) =>
    [...fuente(ruta).matchAll(/<CampoCocina\s+label="([^"]+)"/g)].map((m) => m[1]).sort()

  it('los mismos selectores, y no por casualidad ninguno', () => {
    const enLaPagina = campos(PAGINA)
    expect(enLaPagina.length).toBeGreaterThan(0)
    expect(campos('./capturaIngenieria.test.tsx')).toEqual(enLaPagina)
  })

  // Aquí NO hay Local, y es a propósito: `menu_item_units_sold(p_brand_id,
  // p_from, p_to)` no lo acepta (medido en la base). Un control que no filtra es
  // peor que su ausencia (regla 35).
  it('no hay selector de Local, porque la consulta no lo acepta', () => {
    expect(campos(PAGINA)).not.toContain('Local')
  })

  // La rejilla ya no se puede desincronizar: las dos IMPORTAN la misma constante
  // de `lib/rejillasDeCocina.ts`. Lo que se comprueba aquí es justo eso — que
  // ninguna de las dos se escriba la suya — y `columnasCuadradas.test.ts` vigila
  // que la constante no vuelva a terminar en `auto` (regla 38).
  it('las dos importan la rejilla del mismo sitio, ninguna se escribe la suya', () => {
    for (const f of [fuente(PAGINA), fuente('./capturaIngenieria.test.tsx')]) {
      expect(f).toContain("from '@/modules/kitchen/lib/rejillasDeCocina'")
      expect(f).not.toMatch(/const REJILLA_INGENIERIA\s*=/)
    }
  })
})

describe('los cuadrantes de la foto salen de la regla, no de mi mano', () => {
  it('4 estrellas · 2 caballos · 5 joyas · 8 lastres sobre 19 platos', () => {
    expect(matriz.platos).toHaveLength(19)
    expect(matriz.conteo).toEqual({ estrella: 4, caballo: 2, joya: 5, lastre: 8 })
    expect(matriz.mediaSimpleDeMargen).toBeCloseTo(7.98, 2)
    expect(Math.round(matriz.mediaSimpleDeUnidades as number)).toBe(94)
  })
})

it('genera la captura de Ingeniería a 1280', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">
      <div className="cocina-pagina">
        <CabeceraCocina
          migaja="Folvy Kitchen · Cuenta Foodint"
          pregunta="¿Qué platos vender más y cuáles quitar?"
          regla={
            <>
              Cada plato se compara con la media de la marca en dos cosas:{' '}
              <b className="font-semibold text-cocina-tinta">cuánto se vende</b> y{' '}
              <b className="font-semibold text-cocina-tinta">cuánto deja</b> (precio sin IVA − coste) ·{' '}
              <em className="not-italic text-cocina-tinta-3">
                {intervaloDeFechas(DESDE, HASTA, { minuscula: true })}, todos los canales
              </em>.{' '}
              <span className="text-cocina-tinta-3">
                Entran los {matriz.platos.length} platos con coste y ventas; las bebidas van aparte.
              </span>
            </>
          }
        >
          <CampoCocina label="Marca"><span>Meraki Pita</span></CampoCocina>
          <CampoCocina label="Periodo"><span>Últimos 90 días</span></CampoCocina>
        </CabeceraCocina>

        <CifrasCocina>
          {ORDEN_DE_LAS_CIFRAS.map((c) => (
            <CifraCocina key={c} titulo={ROTULO_CUADRANTE[c]} valor={String(matriz.conteo[c])}
              pie={EXPLICACION_CUADRANTE[c]}
              tono={c === 'lastre' ? 'malo' : c === 'estrella' ? 'bueno' : undefined} />
          ))}
          <CifraCocina
            titulo={`La media de los ${matriz.platos.length} platos`}
            valor={eurSinSimbolo(matriz.mediaSimpleDeMargen)}
            sufijo="€"
            pie={`cada plato cuenta uno, se venda lo que se venda · y ${
              Math.round(matriz.mediaSimpleDeUnidades as number)} vendidos`}
          />
        </CifrasCocina>

        <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
          <div className="flex items-center gap-3.5 flex-wrap">
            <div className="flex gap-1.5">
              <ChipCocina activo>Platos</ChipCocina>
              <ChipCocina>Bebidas</ChipCocina>
            </div>
            <InterruptorCocina activo onChange={() => {}}>Sólo los que piden una decisión</InterruptorCocina>
          </div>
          <span className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
            Caballos, joyas y lastres · las estrellas se quedan como están
          </span>
        </div>

        <PanelCocina>
          {LOS_QUE_PIDEN_DECISION.map((c) => (
            <div key={c}>
              <CabeceraDeBloque
                nombre={`${ROTULO_CUADRANTE[c]} · ${porCuadrante[c].length}`}
                detalle={
                  c === 'caballo' ? `se venden mucho pero dejan menos que la media (${fmtMoney(matriz.mediaSimpleDeMargen)})`
                    : c === 'joya' ? `dejan más que la media pero se venden menos de ${Math.round(matriz.mediaSimpleDeUnidades ?? 0)} en ${DIAS} días`
                      : 'por debajo de la media en las dos cosas'
                }
              />
              {porCuadrante[c].map((f) => pintaFila(f, c))}
            </div>
          ))}
        </PanelCocina>

        {/* Las estrellas se pintan con el interruptor puesto porque la maqueta
            las enseña: es el retrato completo de la carta. En la pantalla sólo
            salen al apagarlo, y ahí exactamente igual. */}
        <PanelCocina>
          <RotuloDePanel>
            {ROTULO_CUADRANTE.estrella} · {porCuadrante.estrella.length} · se quedan como están
          </RotuloDePanel>
          {porCuadrante.estrella.map((f) => pintaFila(f, 'estrella', true))}
        </PanelCocina>

        <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
          {`Las ${FILAS.filter((f) => esBebida(f.categoria)).length} bebidas se comparan entre ellas en su pestaña. ` +
            `Los ${FILAS.filter((f) => f.margen == null).length} platos sin coste y los ${
              FILAS.filter((f) => f.margen != null && f.uds === 0 && !esBebida(f.categoria)).length
            } sin ventas en el periodo no entran: están en Rentabilidad con su motivo.`}
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
<div class="sep"></div><a href="#">Rentabilidad</a><a class="on" href="#">Ingeniería de menús</a>
<div class="sep"></div><a href="#">Ofertas del agente</a><a href="#">Reglas de ofertas</a><a href="#">Ajustes</a>
</nav><div class="cuerpo">${cuerpo}</div></div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_ingenieria.html'), html)
  expect(cuerpo).toContain('¿Qué platos vender más y cuáles quitar?')
  expect(cuerpo).not.toMatch(/text-text-primary|border-border-default|bg-card/)
})
