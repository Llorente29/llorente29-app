// src/modules/kitchen/components/TablasDeRentabilidad.tsx
//
// Las dos tablas de Rentabilidad, sacadas de la página para que la CAPTURA pueda
// usar las de verdad.
//
// POR QUÉ SE SACAN, y es la lección de B84.2 por tercera vez. La foto que se pone
// al lado de la maqueta tenía copiado a mano el marcado de estas filas. Copiado a
// mano quiere decir que el día que la pantalla cambia una clase, la foto sigue
// enseñando la de antes — y la comparación con el tablero pasa a medir una
// pantalla que no existe. Ya pasó con los motivos de las cinco cosas del Resumen
// y con su cabecera de bloque; aquí se corta de raíz: la foto **importa esto**.
//
// Viven en `components/` y no en la página por el `react-refresh` de la casa:
// exportar de un fichero de página lo que no es la página añade avisos de lint
// (§3.19, cinco de golpe). Un fichero de componentes no tiene ese problema.
//
// AQUÍ NO SE CALCULA NADA. Margen, porcentaje, etiquetas y motivos vienen de
// `lib/cartaYMargen`, probados contra los 33 productos reales de Meraki.

import { BotonCocina, CabeceraDeBloque, PanelCocina, PastillaCocina } from '@/modules/kitchen/components/PatronDeKitchen'
import { etiquetasDeFila, motivoSinCoste, type FilaDeCarta } from '@/modules/kitchen/lib/cartaYMargen'
import { REJILLA_CARTA, REJILLA_SIN_COSTE } from '@/modules/kitchen/lib/rejillasDeCocina'
import { fmtMoney, fmtPct } from '@/lib/format'

// Los formateadores del proyecto, que ya son null-safe: un coste ausente sale
// «—», nunca 0 (regla del módulo, y la lección de meez).
const eur = (v: number | null | undefined) => fmtMoney(v)
const pct = (v: number | null | undefined) => fmtPct(v, 1)
/** El número sin el símbolo: debajo del precio ya se dice que son euros. */
const eurSinSimbolo = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })


export function TablaDeCarta({
  filas, recetaPorItem, abrir, margenPropio, objetivoPct,
}: {
  filas: FilaDeCarta[]
  recetaPorItem: Map<string, string | null>
  abrir: (recipeItemId: string | null, menuItemId: string, tab: string) => void
  /** false = marca de terceros: el margen no es de Foodint y no se pinta. */
  margenPropio: boolean
  /** El objetivo de comida de la cuenta. null = no hay vara: no se juzga. */
  objetivoPct: number | null
}) {
  return (
    <PanelCocina>
      <div
        className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
        style={{ gridTemplateColumns: REJILLA_CARTA }}
      >
        <span>Plato</span>
        <span className="text-right">Precio de carta</span>
        <span className="text-right">Coste</span>
        <span className="text-right">Margen</span>
        <span className="text-right">Coste sobre precio sin IVA</span>
        <span className="text-right">Vendidos</span>
        <span />
      </div>
      {filas.map((f) => {
        const etiquetas = etiquetasDeFila(f, objetivoPct)
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
              <span className="block text-[11px] text-cocina-tinta-3">{eurSinSimbolo(f.precioNeto)} sin IVA</span>
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">{eur(f.coste)}</span>
            {/* El margen es el número de la pregunta: en tinta y en negrita. */}
            <span className="num text-[13px] text-right font-semibold text-cocina-tinta">
              {margenPropio ? eur(f.margen) : '—'}
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">
              {margenPropio ? pct(f.costeSobrePrecio) : '—'}
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">{f.uds}</span>
            <span className="text-right">
              <BotonCocina peso="fantasma"
                onClick={() => abrir(recetaPorItem.get(f.id) ?? null, f.id, 'escandallo')}>
                Abrir
              </BotonCocina>
            </span>
          </div>
        )
      })}
    </PanelCocina>
  )
}

/**
 * Los que no tienen coste. Un plato sin coste no es un plato con coste cero: se
 * dice POR QUÉ no se sabe y el botón lleva a donde se arregla (regla de la casa,
 * 06/09 — ningún botón sin destino que exista hoy).
 */
export function BloqueSinCoste({
  filas, udsSinCoste, dias, recetaPorItem, abrir,
}: {
  filas: FilaDeCarta[]
  udsSinCoste: number
  dias: number
  recetaPorItem: Map<string, string | null>
  abrir: (recipeItemId: string | null, menuItemId: string, tab: string) => void
}) {
  return (
    <PanelCocina>
      {/* B83 · la pieza del patrón, no una copia: en la maqueta esto es `.qh`
          —14 px al lado de su explicación— y yo lo tenía escrito con el marcado
          de `.panel-h`, que es otra cosa. */}
      <CabeceraDeBloque
        nombre={`Sin coste · ${filas.length}`}
        detalle={`se han vendido ${udsSinCoste} veces en ${dias} días sin saber lo que cuestan`}
      />
      {filas.map((f) => {
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
              <span className="block text-[11px] text-cocina-tinta-3">{eurSinSimbolo(f.precioNeto)} sin IVA</span>
            </span>
            <span className="text-right">
              <PastillaCocina tono="ambar">sin coste</PastillaCocina>
            </span>
            <span className="num text-[13px] text-right text-cocina-tinta">{f.uds}</span>
            <span className="text-right">
              <BotonCocina peso="borde"
                onClick={() => abrir(recetaPorItem.get(f.id) ?? null, f.id, m.destino)}>
                {m.boton}
              </BotonCocina>
            </span>
          </div>
        )
      })}
    </PanelCocina>
  )
}
