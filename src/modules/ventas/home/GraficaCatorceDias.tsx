// src/modules/ventas/home/GraficaCatorceDias.tsx
//
// TARJETA ANCHA «VENTAS POR DÍA · ÚLTIMAS DOS SEMANAS» (§1.3 de la maqueta).
//
// Sin cifra grande y sin delta: solo la gráfica. Las otras dos tarjetas de
// ventas ya dan cifra y comparación; repetirlas aquí sería decir lo mismo tres
// veces y quitarle sitio a lo único que esta tarjeta sabe hacer, que es
// enseñar la FORMA de la semana.
//
// ── DECISIONES DE DIBUJO, Y POR QUÉ ────────────────────────────────────────
// · UNA serie y UN tono, así que no hay leyenda: el título ya la nombra. Una
//   leyenda de un solo elemento es una fila de ruido.
// · ETIQUETAS SOLO EN LOS DOS PICOS. Un número encima de cada barra convierte
//   la gráfica en una tabla mal maquetada; el resto se lee al pasar por encima.
// · FIN DE SEMANA A OPACIDAD PLENA, el resto atenuado. La distinción no queda
//   solo en el color: el eje de abajo ya dice `L M X J V S D` y el hover dice
//   el nombre del día, así que quien no distinga la opacidad tiene otras dos
//   formas de saberlo.
// · EL DÍA EN CURSO, EN GRIS, y su hover lo dice con palabras: «en curso». Su
//   barra va a medias por definición y compararla con las cerradas es comparar
//   media jornada con jornadas enteras.
// · Barras finas, extremos redondeados de 4 px anclados a la base, y 2 px de
//   hueco entre ellas.

import { useCallback, useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import TarjetaInicio from '@/shell/home/widgets/TarjetaInicio'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import type { HomeCardProps } from '@/shell/types'
import {
  leeVentasPorDia, indicesDeLosPicos, letraDe, etiquetaCorta,
  type DiaDeVentas,
} from './ventasPorDia'

// Media hora: la serie es de días cerrados salvo el último, y ése solo crece.
const UMBRAL_MIN = 30
const ALTO = 96

const eur0 = (n: number) =>
  n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export default function GraficaCatorceDias({ accountId, locationId, drillTo }: HomeCardProps) {
  const [encima, setEncima] = useState<number | null>(null)

  const cargar = useCallback(
    (): Promise<DiaDeVentas[]> =>
      accountId ? leeVentasPorDia(accountId, locationId) : Promise.resolve([]),
    [accountId, locationId],
  )
  const { datos, cargando, error, sello } = useDatoDeTarjeta(
    cargar, [accountId, locationId], UMBRAL_MIN,
  )

  const dias = datos ?? []
  const picos = useMemo(() => new Set(indicesDeLosPicos(dias)), [dias])
  // La escala se calcula con TODAS las barras, la de hoy incluida: si el día en
  // curso se saliera del alto, la gráfica estaría mintiendo sobre su tamaño.
  const maximo = useMemo(() => Math.max(1, ...dias.map(d => d.total)), [dias])

  const detalle = encima != null && dias[encima]
    ? `${etiquetaCorta(dias[encima].ymd)} · ${eur0(dias[encima].total)}`
      + (dias[encima].enCurso ? ' · en curso' : '')
    : null

  return (
    <TarjetaInicio
      titulo="Ventas por día · últimas dos semanas"
      icono={BarChart3}
      cargando={cargando && datos == null}
      error={error}
      sello={sello}
      nota={detalle ?? undefined}
      pie={drillTo
        ? {
            etiqueta: 'Abrir Ventas · comparar periodos →',
            onClick: () => drillTo({
              ruta: '/ventas',
              etiqueta: 'Abrir Ventas · comparar periodos →',
              filtros: dias.length > 0
                ? { desde: dias[0].ymd, hasta: dias[dias.length - 1].ymd }
                : {},
            }),
          }
        : undefined}
    >
      {dias.length === 0 ? null : (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: ALTO }}>
            {dias.map((d, i) => {
              const alto = Math.max(2, Math.round((d.total / maximo) * ALTO))
              const esPico = picos.has(i)
              return (
                <button
                  key={d.ymd}
                  type="button"
                  onMouseEnter={() => setEncima(i)}
                  onMouseLeave={() => setEncima(e => (e === i ? null : e))}
                  onFocus={() => setEncima(i)}
                  onBlur={() => setEncima(e => (e === i ? null : e))}
                  // El lector de pantalla no ve ni la opacidad ni el gris: se le
                  // dice con palabras lo mismo que dice el dibujo.
                  aria-label={`${etiquetaCorta(d.ymd)}: ${eur0(d.total)}, ${d.pedidos} pedidos${
                    d.enCurso ? ', día en curso' : ''}`}
                  style={{
                    flex: 1, height: '100%', padding: 0, border: 0, background: 'none',
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                    cursor: 'pointer', position: 'relative',
                  }}
                >
                  {esPico || encima === i ? (
                    <span style={{
                      fontSize: '0.625rem', color: 'var(--color-text-secondary)',
                      marginBottom: 2, whiteSpace: 'nowrap',
                    }}>
                      {eur0(d.total)}
                    </span>
                  ) : null}
                  <span style={{
                    display: 'block', height: alto,
                    borderRadius: '4px 4px 0 0',
                    background: d.enCurso ? 'var(--color-text-secondary)' : 'var(--color-accent)',
                    opacity: d.enCurso ? 0.45 : (d.esFinde ? 1 : 0.45),
                    outline: encima === i ? '2px solid var(--color-bg-card)' : undefined,
                  }} />
                </button>
              )
            })}
          </div>
          {/* El eje: `L M X J V S D` dos veces, recesivo. */}
          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
            {dias.map(d => (
              <span key={`e-${d.ymd}`} style={{
                flex: 1, textAlign: 'center', fontSize: '0.625rem',
                color: 'var(--color-text-secondary)', opacity: d.esFinde ? 1 : 0.6,
              }}>
                {letraDe(d.diaSemana)}
              </span>
            ))}
          </div>
        </div>
      )}
    </TarjetaInicio>
  )
}
