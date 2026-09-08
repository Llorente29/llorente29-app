// src/modules/kitchen/components/TablaPorMarca.tsx
//
// «Por marca · comida sobre ventas», la tabla del Resumen — sacada de la página
// para que la CAPTURA use la de verdad.
//
// POR QUÉ, y van tres: Julio, 08/09, «la columna coste conocido sigue apagada».
// La PANTALLA ya la tenía en tinta desde B83.4; la que estaba en gris era la
// FOTO, que llevaba su propia copia del marcado. Es el mismo fallo que los
// motivos de las cinco cosas y que la cabecera de bloque: mientras la foto
// copie a mano lo que la pantalla pinta, la comparación con el tablero mide una
// pantalla que no existe, y encima da un veredicto sobre algo ya arreglado
// (regla 30: esconder que algo ya estaba hecho).
//
// La cabecera de columnas y las filas salen de la MISMA constante de rejilla
// (regla 38): con la de botones en `auto` los títulos caían 85 px a la derecha
// de sus cifras. Ver `lib/rejillasDeCocina.ts`.

import { BotonCocina, PanelCocina, PastillaCocina, RotuloDePanel } from '@/modules/kitchen/components/PatronDeKitchen'
import { eurDeCocina, pctEnteroDeCocina } from '@/modules/kitchen/lib/lasCosasQueArreglar'
import { REJILLA_MARCAS } from '@/modules/kitchen/lib/rejillasDeCocina'
import { fmtPct } from '@/lib/format'

/** Por debajo de esto, la cobertura deja de ser un dato y pasa a ser un aviso. */
export const COBERTURA_QUE_PREOCUPA = 80

/** Lo que la tabla necesita de una marca. Menos que `ComidaPorMarca`, a propósito. */
export interface MarcaEnLaTabla {
  brandId?: string | null
  marca: string
  ownershipType: string
  ingreso: number
  foodCostPct: number | null
  coberturaPct: number | null
}

export function TablaPorMarca({
  marcas, verPlatos,
}: {
  marcas: MarcaEnLaTabla[]
  verPlatos: (m: MarcaEnLaTabla) => void
}) {
  return (
    <PanelCocina>
      {/* `.panel-h` de la maqueta: sin fondo gris —el gris es de las cabeceras
          de columna— y las dos mitades en el mismo tono. */}
      <RotuloDePanel derecha="tuyas primero · de terceros después">
        Por marca · comida sobre ventas
      </RotuloDePanel>
      <div
        className="grid gap-3.5 px-4 py-2 text-[10.5px] font-bold tracking-[0.07em] uppercase text-cocina-tinta-3 border-b border-cocina-linea-suave bg-cocina-superficie-2"
        style={{ gridTemplateColumns: REJILLA_MARCAS }}
      >
        <span>Marca</span>
        <span className="text-right">Vendido</span>
        <span className="text-right">Comida</span>
        <span className="text-right">Coste conocido</span>
        <span />
      </div>
      {marcas.map((m) => {
        const flojo = m.coberturaPct != null && m.coberturaPct < COBERTURA_QUE_PREOCUPA
        return (
          <div key={m.brandId ?? m.marca}
            className="grid gap-3.5 items-center px-4 py-[7px] border-b border-cocina-linea-suave last:border-b-0 min-h-[44px]"
            style={{ gridTemplateColumns: REJILLA_MARCAS }}>
            <div className="min-w-0 text-[13.5px] font-semibold text-cocina-tinta truncate">
              {m.marca}
              {m.ownershipType !== 'own' && (
                <span className="ml-1.5 text-[11px] font-medium text-cocina-tinta-3">de terceros</span>
              )}
            </div>
            <span className="num text-[13px] text-right text-cocina-tinta">{eurDeCocina(m.ingreso)}</span>
            <span className="num text-[13px] text-right text-cocina-tinta">{fmtPct(m.foodCostPct, 1)}</span>
            {/* Una cobertura floja es una PASTILLA, como en el tablero, y no
                texto rojo suelto: partido en dos líneas se leía como una nota,
                no como un aviso. */}
            <span className="text-right whitespace-nowrap">
              {flojo
                ? <PastillaCocina tono="rojo">{pctEnteroDeCocina(m.coberturaPct)} · falta coste</PastillaCocina>
                // B83.4 · es el TERCER NÚMERO de la fila, no una nota: en gris
                // se leía como comentario de los otros dos.
                : <span className="num text-[13px] text-cocina-tinta">{pctEnteroDeCocina(m.coberturaPct)}</span>}
            </span>
            <span className="text-right">
              <BotonCocina peso="fantasma" onClick={() => verPlatos(m)}>Ver platos</BotonCocina>
            </span>
          </div>
        )
      })}
    </PanelCocina>
  )
}
