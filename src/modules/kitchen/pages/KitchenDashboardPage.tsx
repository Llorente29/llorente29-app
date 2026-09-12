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
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useApp } from '@/context/AppContext'
import EstadoDeLaConsulta from '@/modules/kitchen/components/EstadoDeLaConsulta'
import {
  CabeceraCocina, CampoCocina, CifrasCocina, CifraCocina,
  BotonCocina, InterruptorCocina, PanelCocina, AvisoCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  getComidaSobreVentas, getLoQueFalta,
  type ComidaSobreVentas, type LoQueFalta, type ComidaPorMarca,
} from '@/modules/kitchen/services/resumenDeCocinaService'
import {
  cuantasResueltas, estaPendiente, pintaCosa, eurDeCocina, pctEnteroDeCocina,
  loQueNoCambiaConElLocal, lasQueMasPesan,
} from '@/modules/kitchen/lib/lasCosasQueArreglar'
import { listLocations as listLocales } from '@/modules/kitchen/services/availabilityService'
import { guardaPeriodoRecordado, leePeriodoRecordado } from '@/modules/kitchen/lib/recuerdoDeKitchen'
import { intervaloDeFechas } from '@/modules/ventas/services/textoInforme'
import { TablaPorMarca } from '@/modules/kitchen/components/TablaPorMarca'
import { REJILLA_COSAS } from '@/modules/kitchen/lib/rejillasDeCocina'
import { fmtPct } from '@/lib/format'

type Dias = 30 | 90 | 365
type QueMarcas = 'todas' | 'tuyas'

const pct = (v: number | null | undefined) => fmtPct(v, 1)

/** Debajo de esta cobertura, la marca se marca en rojo: su cifra no es fiable. */


/** Las filas de «lo que hay que arreglar»: título · motivo · botón. */

export default function KitchenDashboardPage() {
  const { activeAccountId } = useActiveAccount()
  const { activeAccount } = useApp()
  const nombreDeLaCuenta = activeAccount?.name ?? null
  const navigate = useNavigate()

  const [dias, setDias] = useState<Dias>(leePeriodoRecordado('resumen', 30) as Dias)
  // «Todas» por defecto, decisión de Julio: la comida de las marcas de terceros
  // sale del almacén de Foodint y a su coste. «Sólo tuyas» es un filtro, nunca
  // una puerta.
  const [queMarcas, setQueMarcas] = useState<QueMarcas>('todas')
  // ── B83 · EL LOCAL (decisión de Julio, 07/09) ────────────────────────────
  // Lo pide el tablero y la consulta de ventas lo acepta, así que se cablea de
  // verdad. Medido antes de construirlo: Alcalá 46.192 € · Carabanchel 26.629 €
  // · Todos 72.821 € — suman exacto, así que el filtro filtra y no adorna.
  const [local, setLocal] = useState<string>('')      // '' = todos
  const [locales, setLocales] = useState<Array<{ id: string; name: string }>>([])
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
    let vigente = true
    void listLocales(activeAccountId)
      .then((ls) => { if (vigente) setLocales(ls) })
      // Sin locales el selector no se pinta y la pantalla sigue: un filtro que
      // no se ha podido cargar no puede tumbar el resumen entero.
      .catch(() => { if (vigente) setLocales([]) })
    return () => { vigente = false }
  }, [activeAccountId])

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
      getComidaSobreVentas({ accountId: activeAccountId, desde, hasta, locationId: local || null }),
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
  }, [activeAccountId, dias, local])

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
  // ── LO QUE NO CAMBIA AL ELEGIR LOCAL, Y LO DICE (condición de Julio) ──────
  //
  // `kitchen_catalog_gaps` cuenta CATÁLOGO, y el catálogo es de la cuenta: no
  // acepta local y no cambiaría aunque lo aceptase. Sin decirlo, elegir Alcalá
  // y ver el mismo «422 de 551» se lee como un filtro roto — y quien lo lea así
  // dejará de fiarse también de las cifras que sí han cambiado.
  const deTodaLaCuenta = loQueNoCambiaConElLocal(local)

  const cosaExtras = cosas.find((c) => c.clave === 'extras_que_cobran_sin_coste')
  const cosaSinFicha = cosas.find((c) => c.clave === 'platos_en_carta_sin_coste')
  const cosaIngredientes = cosas.find((c) => c.clave === 'ingredientes_sin_precio')

  return (
    // B83 · AL ESTÁNDAR DE LA MAQUETA (§9.2 del encargo de Extras). Esta pantalla
    // nació con el patrón de Casado pero con los colores y espaciados de la app
    // vieja; el tablero es `Main.dc.html`. Lo que cambia es CÓMO se ve, no qué
    // dice: mismos números, mismos textos, mismos destinos.
    <div className="cocina min-h-full">
      <div className="cocina-pagina">

        <CabeceraCocina
          migaja={`Folvy Kitchen${nombreDeLaCuenta ? ` · ${nombreDeLaCuenta}` : ''}`}
          pregunta="¿Cómo va tu cocina este mes?"
          regla={
            <>
              Comida = ingredientes y envase de lo que has vendido · ventas = precio de carta
              sin IVA
              {ventana && <> · <em className="not-italic text-cocina-tinta-3">
                {intervaloDeFechas(ventana.desde, ventana.hasta, { minuscula: true }) ?? 'periodo sin fechas'}
              </em></>}.{' '}
              <span className="text-cocina-tinta-3">
                El margen después de Glovo, Uber y Just Eat llega cuando el catálogo tenga canal.
              </span>
            </>
          }
        >
          <CampoCocina label="Periodo">
            <select
              value={String(dias)}
              onChange={(e) => { const d = Number(e.target.value) as Dias; setDias(d); guardaPeriodoRecordado('resumen', d) }}
              className="text-[13px] font-medium text-cocina-tinta"
            >
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="365">Último año</option>
            </select>
          </CampoCocina>
          {/* Sólo si hay más de uno: un selector con una sola opción es un
              control que no hace nada. */}
          {locales.length > 1 && (
            <CampoCocina label="Local">
              <select
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                className="text-[13px] font-medium text-cocina-tinta"
              >
                <option value="">Todos</option>
                {locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </CampoCocina>
          )}
          <CampoCocina label="Marcas">
            <select
              value={queMarcas}
              onChange={(e) => setQueMarcas(e.target.value as QueMarcas)}
              className="text-[13px] font-medium text-cocina-tinta"
            >
              <option value="todas">Todas</option>
              <option value="tuyas">Sólo tuyas</option>
            </select>
          </CampoCocina>
        </CabeceraCocina>

        {cargando || error || !comida || !falta ? (
          <EstadoDeLaConsulta
            cargando={cargando}
            textoCargando="Sumando lo vendido y repasando el catálogo…"
            error={error}
            hayFilas={!!comida && !!falta}
            queSePregunto="el resumen de la cocina"
            matiz="Si hay ventas en el periodo, es que ninguna ha llegado hasta aquí."
          />
        ) : (
          <>
            {/* 2 · CINCO CIFRAS con nombre de persona. Ni una más. */}
            <CifrasCocina>
              <CifraCocina
                titulo={queMarcas === 'tuyas' ? 'Comida sobre ventas · sólo tuyas' : 'Comida sobre ventas · todas las marcas'}
                valor={pct(cifraGrande).replace(' %', '')}
                sufijo="%"
                pie={
                  (queMarcas === 'todas' && propias && cedidas
                    ? `tuyas ${pct(propias.foodCostPct)} · de terceros ${pct(cedidas.foodCostPct)} · `
                    : '') +
                  // B83.1: los euros de comida son lo que hace tangible el
                  // porcentaje. Un «24,1 %» solo no dice cuánto dinero es.
                  `${eurDeCocina(comidaEur)} de comida sobre ${eurDeCocina(vendidoEur)} vendidos` +
                  // Las ventas sin marca existen y no se tiran en silencio
                  // (regla 7), pero van detrás: son el matiz, no el dato.
                  (queMarcas === 'todas' && sinMarca && sinMarca.unidades > 0
                    ? ` · ${sinMarca.unidades} ${sinMarca.unidades === 1 ? 'venta' : 'ventas'} sin marca (${eurDeCocina(sinMarca.vendido)}) van dentro`
                    : '')
                }
              />
              <CifraCocina
                titulo="Ventas con coste conocido"
                // B83.2 · una sola regla para los dos sitios: la COBERTURA va
                // entera aquí y en la tabla de abajo; el porcentaje de comida
                // sobre ventas, con un decimal. Dos varas para el mismo tipo de
                // número es lo que hace que alguien compare mal.
                valor={pctEnteroDeCocina(comida.coberturaDineroPct).replace(' %', '')}
                sufijo="%"
                pie={comida.coberturaDineroPct != null
                  ? `el ${pctEnteroDeCocina(100 - comida.coberturaDineroPct)} restante se vende sin saber lo que cuesta`
                  : 'no ha llegado ninguna venta que medir'}
              />
              <CifraCocina
                titulo="Platos con coste"
                valor={cosaSinFicha ? String((cosaSinFicha.de ?? 0) - cosaSinFicha.n) : '—'}
                sufijo={cosaSinFicha ? `de ${cosaSinFicha.de ?? 0}` : undefined}
                pie={(cosaSinFicha && cosaSinFicha.n > 0
                  ? `${cosaSinFicha.n} se venden sin saber lo que cuestan`
                  : 'todos los de la carta tienen ficha con coste') + deTodaLaCuenta}
                tono={(cosaSinFicha?.n ?? 0) > 0 ? 'malo' : undefined}
              />
              <CifraCocina
                titulo="Extras que cobran sin coste"
                valor={cosaExtras ? String(cosaExtras.n) : '—'}
                sufijo={cosaExtras ? `de ${cosaExtras.de ?? 0}` : undefined}
                pie={(cosaExtras && (cosaExtras.venden ?? 0) > 0
                  ? `${cosaExtras.venden} se han vendido y no descuentan comida`
                  : 'entran por caja y no descuentan comida') + deTodaLaCuenta}
                tono={(cosaExtras?.n ?? 0) > 0 ? 'malo' : undefined}
              />
              <CifraCocina
                titulo="Ingredientes sin precio"
                valor={cosaIngredientes ? String(cosaIngredientes.n) : '—'}
                sufijo={cosaIngredientes ? `de ${cosaIngredientes.de ?? 0}` : undefined}
                pie={cosaIngredientes
                  ? `en uso${cosaIngredientes.usadosEnLineasDeReceta === 0 ? ' · todavía no están en ninguna receta' : ''}${deTodaLaCuenta}`
                  : '—'}
                tono={(cosaIngredientes?.n ?? 0) > 0 ? 'malo' : undefined}
              />
            </CifrasCocina>

            {/* 3 · EL FILTRO ES LA ACCIÓN, y a su derecha lo que se está viendo. */}
            <div className="flex justify-between items-center gap-3 mt-1 flex-wrap">
              <InterruptorCocina activo={soloPendiente} onChange={setSoloPendiente}>
                Sólo lo que hay que arreglar
              </InterruptorCocina>
              <span className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
                {cosasVisibles.length} {cosasVisibles.length === 1 ? 'cosa' : 'cosas'} · ordenadas por lo que más pesa en el {pct(cifraGrande)}
                {/* Las cinco son de catálogo: tampoco cambian con el local. */}
                {local && ' · de toda la cuenta'}
                {/* El filtro decide el ORDEN y la ETIQUETA, nunca la EXISTENCIA:
                    si deja algo fuera, lo dice (regla 7). */}
                {soloPendiente && resueltas > 0 && (
                  <> · {resueltas} {resueltas === 1 ? 'ya está resuelta' : 'ya están resueltas'} y no se listan aquí</>
                )}
              </span>
            </div>

            {/* 4 · LAS FILAS: lo que hay que arreglar. */}
            {cosasVisibles.length === 0 ? (
              <AvisoCocina>Nada pendiente en el catálogo: los cinco contadores están a cero.</AvisoCocina>
            ) : (
              <PanelCocina>
                {cosasVisibles.map((c) => {
                  const p = pintaCosa(c, comida.envaseEur, cifraGrande)
                  return (
                    <div key={c.clave}
                      className="grid items-start gap-3.5 px-4 py-3 border-b border-cocina-linea-suave last:border-b-0"
                      style={{ gridTemplateColumns: REJILLA_COSAS }}>
                      {/* El TÍTULO en su propia columna, como el tablero: así los
                          cinco se leen en vertical de un vistazo, sin buscar
                          dónde empieza cada uno dentro de un párrafo. */}
                      <div className="text-[13.5px] font-semibold text-cocina-tinta">
                        {estaPendiente(c) ? p.titulo : `${p.titulo} — resuelto`}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12.5px] text-cocina-tinta-2 leading-[1.45]">{p.motivo}</div>
                        {c.peores.length > 0 && (
                          <div className="text-[12.5px] text-cocina-tinta-2 leading-[1.45] mt-0.5">
                            Las que más:{' '}
                            <b className="font-semibold text-cocina-tinta">{lasQueMasPesan(c.peores)}</b>
                          </div>
                        )}
                        {/* La definición con la que se contó, tal y como la da la
                            base. No se reescribe aquí: el número no se separa de
                            su regla. En cursiva NO (B83): se lee como una nota al
                            pie, y es la regla del número. */}
                        {c.definicion && (
                          <div className="text-[11.5px] text-cocina-tinta-3 mt-1">{c.definicion}</div>
                        )}
                      </div>
                      {estaPendiente(c) && (
                        <div className="shrink-0">
                          <BotonCocina onClick={() => navigate(`/kitchen/${p.destino}`)}>{p.boton}</BotonCocina>
                        </div>
                      )}
                    </div>
                  )
                })}
              </PanelCocina>
            )}

            {/* 5 · POR MARCA. */}
            <TablaPorMarca marcas={marcasVisibles}
              verPlatos={() => navigate('/kitchen/rentabilidad')} />

            {queMarcas === 'todas' && cedidas && propias && comida.ingresoTotal > 0 && (
              <p className="text-[11.5px] text-cocina-tinta-3 leading-[1.5]">
                Las de terceros son el {pct(100 * cedidas.vendido / (comida.ingresoTotal || 1))} de lo vendido
                y su comida cuesta el {pct(cedidas.foodCostPct)}: la cifra de arriba es sobre todo suya.
                Con «Marcas: sólo tuyas» pasa a {pct(propias.foodCostPct)}. Su carta la manda el TPV.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
