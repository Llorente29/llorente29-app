// src/modules/kitchen/pages/KitchenDashboardPage.tsx
//
// «¿Cómo va tu cocina este mes?» — Resumen de Folvy Kitchen.
//
// B79 · lote 4 (06/09/2026). Reescrita entera sobre la maqueta aprobada, con el
// patrón de Casado: una pregunta arriba, una línea de regla, cinco cifras con
// nombre humano, un filtro que es la acción, filas con motivo y botón, y nada más.
//
// LO QUE HABÍA ANTES, para que no se repita. Esta pantalla decía «Food cost medio
// —», «Margen (30 días) 0 €», «sobre 0 de 0 platos con coste» y «Sin datos
// todavía» ×18, sobre una cuenta que en 30 días vendió 73.000 € con el 89 % de
// cobertura de coste. No era una regresión: colgaba de `menu_item_economics`,
// que devolvía cero filas por un INNER JOIN contra `menu_item.channel_id`, vacío
// en toda la base desde siempre. Y encima traía «cifras de ejemplo».
//
// DE DÓNDE SALE AHORA CADA NÚMERO, y por qué de ahí:
//   · La comida sobre ventas, de `food_cost_dashboard` — la MISMA función que
//     usa Ventas, así que las dos pantallas no pueden decir cifras distintas de
//     lo mismo. Y el corte «tuyas / de terceros» viene sumado en SQL
//     (`by_ownership`), no de sumar aquí las filas por marca, que van redondeadas
//     a euros enteros: serían dos varas de medir.
//   · Las cinco cosas que arreglar, de `kitchen_catalog_gaps` — y cada contador
//     LLEGA CON SU DEFINICIÓN escrita desde la base. Esta pantalla no re-define
//     ninguno: los enseña. El número no se separa de su regla.
//
// ESTA PANTALLA NO CALCULA NADA. Los textos y los destinos están en
// `lib/lasCosasQueArreglar.ts`, probados; los números, en la base.
//
// NINGÚN BOTÓN SIN DESTINO (regla de Julio, 06/09): los cinco van a rutas que
// existen hoy en `module.tsx` — Cartas, Casado, Platos, Ajustes e Ingredientes —
// y hay una prueba que lo comprueba contra esa lista.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import { Campo, Cifra } from '@/modules/kitchen/components/PatronDeKitchen'
import {
  getComidaSobreVentas, getLoQueFalta,
  type ComidaSobreVentas, type LoQueFalta, type ComidaPorMarca,
} from '@/modules/kitchen/services/resumenDeCocinaService'
import {
  cuantasResueltas, estaPendiente, pintaCosa,
} from '@/modules/kitchen/lib/lasCosasQueArreglar'
import { guardaPeriodoRecordado, leePeriodoRecordado } from '@/modules/kitchen/lib/recuerdoDeKitchen'
import { intervaloEnCastellano } from '@/modules/ventas/services/textoInforme'
import { fmtInt, fmtPct } from '@/lib/format'

type Dias = 30 | 90 | 365
type QueMarcas = 'todas' | 'tuyas'

const pct = (v: number | null | undefined) => fmtPct(v, 1)
const eurRedondo = (v: number | null | undefined) => (v == null ? '—' : `${fmtInt(v)} €`)

/** Debajo de esta cobertura, la marca se marca en rojo: su cifra no es fiable. */
const COBERTURA_QUE_PREOCUPA = 80

export default function KitchenDashboardPage() {
  const { activeAccountId } = useActiveAccount()
  const navigate = useNavigate()

  const [dias, setDias] = useState<Dias>(leePeriodoRecordado('resumen', 30) as Dias)
  // «Todas» por defecto, decisión de Julio: la comida de las marcas de terceros
  // sale del almacén de Foodint y a su coste. «Sólo tuyas» es un filtro, nunca
  // una puerta.
  const [queMarcas, setQueMarcas] = useState<QueMarcas>('todas')
  const [soloPendiente, setSoloPendiente] = useState(true)

  const [comida, setComida] = useState<ComidaSobreVentas | null>(null)
  const [falta, setFalta] = useState<LoQueFalta | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // La ventana la fija la carga y se guarda con los datos, no se recalcula al
  // pintar: así las fechas de la cabecera son EXACTAMENTE las que se consultaron,
  // aunque la pestaña lleve horas abierta.
  const [ventana, setVentana] = useState<{ desde: Date; hasta: Date } | null>(null)

  const peticion = useRef(0)
  useEffect(() => {
    if (!activeAccountId) return
    const mia = ++peticion.current
    const hasta = new Date()
    const desde = new Date(hasta.getTime() - dias * 24 * 3600 * 1000)
    // Fuera del cuerpo síncrono del efecto: tocarlo dentro encadena renders.
    Promise.resolve().then(() => {
      if (mia !== peticion.current) return
      setCargando(true)
      setError(null)
    })
    Promise.all([
      getComidaSobreVentas({ accountId: activeAccountId, desde, hasta }),
      getLoQueFalta(activeAccountId),
    ])
      .then(([c, f]) => {
        if (mia !== peticion.current) return
        setComida(c)
        setFalta(f)
        setVentana({ desde, hasta })
        setCargando(false)
      })
      .catch((e: unknown) => {
        if (mia !== peticion.current) return
        // Un fallo se enseña, no se disfraza de vacío.
        setError(e instanceof Error ? e.message : 'Error cargando el resumen')
        setCargando(false)
      })
  }, [activeAccountId, dias])

  // ── La cifra grande y su partición ───────────────────────────────────────
  const propias = comida?.porTipo.find((t) => t.tipo === 'own') ?? null
  const cedidas = comida?.porTipo.find((t) => t.tipo === 'licensed') ?? null
  const sinMarca = comida?.porTipo.find((t) => t.tipo === 'sin_marca') ?? null

  // Con «Sólo tuyas» la cifra grande es la de las propias, no una media nueva:
  // sale del mismo `by_ownership`, con el mismo numerador y denominador.
  const cifraGrande = queMarcas === 'tuyas' ? (propias?.foodCostPct ?? null) : (comida?.foodCostPct ?? null)
  const comidaEur = queMarcas === 'tuyas' ? (propias?.foodCost ?? null) : (comida?.foodCost ?? null)
  const vendidoEur = queMarcas === 'tuyas' ? (propias?.vendidoConCoste ?? null) : (comida?.ingresoConCoste ?? null)

  const marcasVisibles: ComidaPorMarca[] = useMemo(() => {
    const todas = comida?.porMarca ?? []
    const filtradas = queMarcas === 'tuyas' ? todas.filter((m) => m.ownershipType === 'own') : todas
    // Las tuyas primero y las de terceros después; dentro, por lo vendido.
    return [...filtradas].sort((a, b) => {
      const pa = a.ownershipType === 'own' ? 0 : 1
      const pb = b.ownershipType === 'own' ? 0 : 1
      if (pa !== pb) return pa - pb
      return b.ingreso - a.ingreso
    })
  }, [comida, queMarcas])

  // ── Las cinco cosas ──────────────────────────────────────────────────────
  const cosas = falta?.cosas ?? []
  const cosasVisibles = soloPendiente ? cosas.filter(estaPendiente) : cosas
  const resueltas = cuantasResueltas(cosas)

  // Contadores de catálogo para las cifras de arriba, sacados de las cosas para
  // no volver a preguntar lo mismo por otro camino.
  const cosaExtras = cosas.find((c) => c.clave === 'extras_que_cobran_sin_coste')
  const cosaSinFicha = cosas.find((c) => c.clave === 'platos_en_carta_sin_coste')
  const cosaIngredientes = cosas.find((c) => c.clave === 'ingredientes_sin_precio')

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* 1 · LA PREGUNTA, y debajo una sola línea con la regla y las fechas. */}
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">¿Cómo va tu cocina este mes?</h1>
        <p className="mt-1.5 text-sm text-text-secondary max-w-4xl">
          Comida = ingredientes y envase de lo que has vendido · ventas = precio de carta
          sin IVA{ventana ? ` · ${intervaloEnCastellano(ventana.desde.toISOString(), ventana.hasta.toISOString())}` : ''}.{' '}
          <span className="text-text-tertiary">
            El margen después de Glovo, Uber y Just Eat llega cuando el catálogo tenga canal.
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Campo label="Periodo">
          <select
            value={String(dias)}
            onChange={(e) => { const d = Number(e.target.value) as Dias; setDias(d); guardaPeriodoRecordado('resumen', d) }}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary"
          >
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="365">Último año</option>
          </select>
        </Campo>
        <Campo label="Marcas">
          <select
            value={queMarcas}
            onChange={(e) => setQueMarcas(e.target.value as QueMarcas)}
            className="px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary"
          >
            <option value="todas">Todas</option>
            <option value="tuyas">Sólo tuyas</option>
          </select>
        </Campo>
      </div>

      {cargando || error || !comida || !falta ? (
        <EstadoDeLaConsulta
          cargando={cargando}
          textoCargando="Sumando lo vendido y repasando el catálogo…"
          error={error}
          queSePregunto="el resumen de la cocina"
          matiz="Si hay ventas en el periodo, es que ninguna ha llegado hasta aquí."
        />
      ) : (
        <>
          {/* 2 · CINCO CIFRAS con nombre de persona. Ni una más. */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            <Cifra
              titulo={queMarcas === 'tuyas' ? 'Comida sobre ventas · sólo tuyas' : 'Comida sobre ventas · todas las marcas'}
              valor={pct(cifraGrande)}
              pie={
                (queMarcas === 'todas' && propias && cedidas
                  ? `tuyas ${pct(propias.foodCostPct)} · de terceros ${pct(cedidas.foodCostPct)} · `
                  : '') +
                `${eurRedondo(comidaEur)} de comida sobre ${eurRedondo(vendidoEur)} vendidos` +
                // Las ventas sin marca existen y no se tiran en silencio (regla 7).
                (queMarcas === 'todas' && sinMarca && sinMarca.unidades > 0
                  ? ` · ${sinMarca.unidades} ${sinMarca.unidades === 1 ? 'venta' : 'ventas'} sin marca (${eurRedondo(sinMarca.vendido)}) van dentro`
                  : '')
              }
            />
            <Cifra
              titulo="Ventas con coste conocido"
              valor={pct(comida.coberturaDineroPct)}
              pie={comida.coberturaDineroPct != null
                ? `el ${pct(100 - comida.coberturaDineroPct)} restante se vende sin saber lo que cuesta`
                : 'no ha llegado ninguna venta que medir'}
            />
            <Cifra
              titulo="Platos con coste"
              valor={cosaSinFicha ? `${(cosaSinFicha.de ?? 0) - cosaSinFicha.n} de ${cosaSinFicha.de ?? 0}` : '—'}
              pie={cosaSinFicha && cosaSinFicha.n > 0
                ? `${cosaSinFicha.n} se venden sin saber lo que cuestan`
                : 'todos los de la carta tienen ficha con coste'}
              alerta={(cosaSinFicha?.n ?? 0) > 0}
            />
            <Cifra
              titulo="Extras que cobran sin coste"
              valor={cosaExtras ? `${cosaExtras.n} de ${cosaExtras.de ?? 0}` : '—'}
              pie={cosaExtras && (cosaExtras.venden ?? 0) > 0
                ? `${cosaExtras.venden} se han vendido y no descuentan comida`
                : 'entran por caja y no descuentan comida'}
              alerta={(cosaExtras?.n ?? 0) > 0}
            />
            <Cifra
              titulo="Ingredientes sin precio"
              valor={cosaIngredientes ? String(cosaIngredientes.n) : '—'}
              pie={cosaIngredientes
                ? `de ${cosaIngredientes.de ?? 0} en uso${cosaIngredientes.usadosEnLineasDeReceta === 0 ? ' · todavía no están en ninguna receta' : ''}`
                : '—'}
              alerta={(cosaIngredientes?.n ?? 0) > 0}
            />
          </div>

          {/* 3 · EL FILTRO ES LA ACCIÓN. */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="inline-flex items-center gap-1.5 text-text-secondary cursor-pointer">
              <input type="checkbox" checked={soloPendiente} onChange={(e) => setSoloPendiente(e.target.checked)} />
              Sólo lo que hay que arreglar
            </label>
            {/* El filtro decide el ORDEN y la ETIQUETA, nunca la EXISTENCIA: si
                deja algo fuera, lo dice (regla 7). */}
            {soloPendiente && resueltas > 0 && (
              <span className="text-text-tertiary">
                · {resueltas} {resueltas === 1 ? 'ya está resuelta' : 'ya están resueltas'} y no se listan aquí
              </span>
            )}
          </div>

          {/* 4 · LAS FILAS: lo que hay que arreglar, y luego cada marca. */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-2">
              {soloPendiente ? 'Sólo lo que hay que arreglar' : 'Las cinco cosas del catálogo'}
              <span className="ml-2 text-[11px] font-normal text-text-secondary">
                ordenadas por lo que más pesa en la cifra de arriba
              </span>
            </h2>

            {cosasVisibles.length === 0 ? (
              <div className="p-4 rounded-lg bg-success-bg text-success border border-success/20 text-sm">
                Nada pendiente en el catálogo: los cinco contadores están a cero.
              </div>
            ) : (
              <div className="space-y-2">
                {cosasVisibles.map((c) => {
                  const p = pintaCosa(c, comida.envaseEur)
                  return (
                    <div key={c.clave}
                      className="bg-card border border-border-default rounded-lg p-3 flex items-start gap-3 flex-wrap">
                      <div className="flex-1 min-w-[16rem]">
                        <p className="text-sm font-medium text-text-primary">
                          {estaPendiente(c) ? p.titulo : `${p.titulo} — resuelto`}
                        </p>
                        <p className="text-[12px] text-text-secondary mt-0.5 leading-snug">{p.motivo}</p>
                        {c.peores.length > 0 && (
                          <p className="text-[11px] text-text-tertiary mt-1">
                            Las que más:{' '}
                            {c.peores.slice(0, 3).map((x) => `${x.marca} ${x.n} de ${x.de}`).join(' · ')}
                            {c.peores.length > 3 && ` · y ${c.peores.length - 3} marcas más`}
                          </p>
                        )}
                        {/* La definición con la que se contó, tal y como la da la
                            base. No se reescribe aquí: el número no se separa de
                            su regla. */}
                        {c.definicion && (
                          <p className="text-[11px] text-text-tertiary mt-1 italic">{c.definicion}</p>
                        )}
                      </div>
                      {estaPendiente(c) && (
                        <button
                          type="button"
                          onClick={() => navigate(`/kitchen/${p.destino}`)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-accent bg-accent text-white hover:opacity-90 transition-base shrink-0"
                        >
                          {p.boton}
                          <ChevronRight size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-medium text-text-primary mb-2">
              Por marca · comida sobre ventas
              <span className="ml-2 text-[11px] font-normal text-text-secondary">
                tuyas primero · de terceros después
              </span>
            </h2>
            <div className="bg-card border border-border-default rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-default">
                    <th className="text-left font-medium px-3 py-2">Marca</th>
                    <th className="text-right font-medium px-3 py-2">Vendido</th>
                    <th className="text-right font-medium px-3 py-2">Comida</th>
                    <th className="text-right font-medium px-3 py-2">Coste conocido</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {marcasVisibles.map((m) => {
                    const flojo = m.coberturaPct != null && m.coberturaPct < COBERTURA_QUE_PREOCUPA
                    return (
                      <tr key={m.brandId ?? m.marca} className="border-b border-border-default last:border-0">
                        <td className="px-3 py-2 text-text-primary">
                          {m.marca}
                          {m.ownershipType !== 'own' && (
                            <span className="ml-1.5 text-[10px] text-text-secondary">de terceros</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-primary">{eurRedondo(m.ingreso)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-primary">{pct(m.foodCostPct)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${flojo ? 'text-danger' : 'text-text-secondary'}`}>
                          {pct(m.coberturaPct)}{flojo ? ' · falta coste' : ''}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => navigate('/kitchen/rentabilidad')}
                            className="text-[12px] text-accent hover:underline">
                            Ver platos
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {queMarcas === 'todas' && cedidas && propias && comida.ingresoTotal > 0 && (
              <p className="text-[12px] text-text-secondary mt-2 max-w-4xl">
                Las de terceros son el {pct(100 * cedidas.vendido / (comida.ingresoTotal || 1))} de lo vendido
                y su comida cuesta el {pct(cedidas.foodCostPct)}: la cifra de arriba es sobre todo suya.
                Con «Marcas: sólo tuyas» pasa a {pct(propias.foodCostPct)}. Su carta la manda el TPV.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
