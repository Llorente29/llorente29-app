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
import { eurEntero } from '@/lib/dinero'
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
    ? dias[encima].futuro
      ? `${etiquetaCorta(dias[encima].ymd)} · todavía no ha llegado`
      : `${etiquetaCorta(dias[encima].ymd)} · ${eurEntero(dias[encima].total)}`
        + (dias[encima].enCurso ? ' · en curso' : '')
    : null

  return (
    <TarjetaInicio
      titulo="Ventas por día · últimas dos semanas"
      icono={BarChart3}
      cargando={cargando && datos == null}
      error={error}
      hayDato={datos != null}
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
              // Un día que aún no ha llegado NO TIENE BARRA — ni siquiera de
              // altura cero. Un hueco a ras de suelo en una gráfica de ventas se
              // lee como «ese día no se vendió», que es afirmar la ausencia de
              // algo que todavía no ha pasado: la regla 7 en versión gráfica.
              // El eje SÍ se conserva, para que las dos semanas sigan alineadas.
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
                  aria-label={d.futuro
                    ? `${etiquetaCorta(d.ymd)}: todavía no ha llegado`
                    : `${etiquetaCorta(d.ymd)}: ${eurEntero(d.total)}, ${d.pedidos} pedidos${
                        d.enCurso ? ', día en curso' : ''}`}
                  style={{
                    flex: 1, height: '100%', padding: 0, border: 0, background: 'none',
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                    cursor: 'pointer', position: 'relative',
                  }}
                >
                  {!d.futuro && (esPico || encima === i) ? (
                    <span style={{
                      fontSize: '0.625rem', color: 'var(--color-text-secondary)',
                      marginBottom: 2, whiteSpace: 'nowrap',
                    }}>
                      {eurEntero(d.total)}
                    </span>
                  ) : null}
                  {d.futuro ? null : <span style={{
                    display: 'block', height: alto,
                    borderRadius: '4px 4px 0 0',
                    // UN SOLO TONO, la tinta de la casa, y la diferencia en la
                    // OPACIDAD. `--color-accent` es #15171A: a opacidad plena
                    // las barras del finde salían negras, que es un color que
                    // en un panel se lee como «error» o como «otra serie».
                    // 0,62 y 0,30 mantienen la misma familia y se distinguen.
                    background: d.enCurso ? 'var(--color-text-secondary)' : 'var(--color-accent)',
                    opacity: d.enCurso ? 0.35 : (d.esFinde ? 0.62 : 0.3),
                    outline: encima === i ? '2px solid var(--color-bg-card)' : undefined,
                  }} />}
                </button>
              )
            })}
          </div>
          {/* El eje: `L M X J V S D` dos veces, recesivo. */}
          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
            {dias.map(d => (
              <span key={`e-${d.ymd}`} style={{
                flex: 1, textAlign: 'center', fontSize: '0.625rem',
                color: 'var(--color-text-secondary)',
                // El día que no ha llegado conserva su letra —el eje tiene que
                // seguir cuadrando— pero apagada: la columna está vacía porque
                // aún no toca, no porque no se vendiera.
                opacity: d.futuro ? 0.25 : (d.esFinde ? 1 : 0.6),
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
