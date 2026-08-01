// src/modules/kitchen/pages/WarehouseReliabilityPage.tsx
//
// FIABILIDAD DEL ALMACÉN — una cola de trabajo, no un informe.
//
// El problema que resuelve: casi la mitad de lo que se vende no descuenta
// ingredientes, así que el food cost se calcula sobre la mitad de la realidad.
// Nadie veía ese número y nadie sabía qué hacer con él.
//
// Principios (encargo de Julio, 26/07):
//   · UNA acción principal grande por fila. Nada de tablas mudas.
//   · Persiste hasta corregirlo DE VERDAD: un producto no sale de la lista al
//     pulsar un botón, sale cuando una venta NUEVA suya ya descuenta bien. Si
//     vuelve a fallar, reaparece marcado como recaída.
//   · Ordenado por € de impacto, no alfabético.
//   · Agrupado por producto: resolver una vez arregla todas sus ventas futuras.
//   · UN carril a la vez: A tapa a B y B tapa a C, así que hasta que A no está
//     limpio no se enseña B. No abrumar con tres problemas mezclados.
//   · Lenguaje humano. Aquí no existe "menu_item_id null".

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Check, ChefHat, Clock, Euro, Loader2, RefreshCw, Search, X,
} from 'lucide-react'
import { fmtInt, fmtMoney } from '@/lib/format'
import KitchenItemDetailPage from '@/modules/kitchen/pages/KitchenItemDetailPage'
import {
  useReliabilityQueue, useInvalidateReliabilityQueue, mapProductToDish, recostProduct,
  getReliability, suggestMatch, createDishFromUnmapped, resolveUnmapped,
  type QueueItem, type Carril, type MatchSuggestion, type SalesReliability,
} from '@/modules/kitchen/services/warehouseReliabilityService'

interface Props {
  accountId: string
  locationId?: string | null
  actorName?: string | null
  onBack: () => void
}

const DAYS = 7

const CARRIL_INFO: Record<Carril, { titulo: string; explica: string }> = {
  A: {
    titulo: 'Ventas que no conectan con tu carta',
    explica: 'Estos productos se venden, pero no están conectados a ningún plato. Sin esa conexión no sabemos qué ingredientes gastan, así que no descuentan nada del almacén.',
  },
  B: {
    titulo: 'Platos sin receta',
    explica: 'Estos platos sí están conectados, pero no tienen ingredientes definidos. Hasta que no digas de qué están hechos, sus ventas no pueden descontar nada.',
  },
  C: {
    titulo: 'Ingredientes sin precio',
    explica: 'Estos ingredientes sí salen del almacén, pero no sabemos lo que cuestan. El stock baja bien; lo que no se puede calcular es el dinero.',
  },
}

function fiabilidadTono(pct: number | null): { color: string; icono: string } {
  if (pct == null) return { color: 'text-gray-500', icono: '⚪' }
  if (pct >= 95) return { color: 'text-emerald-600', icono: '🟢' }
  if (pct >= 80) return { color: 'text-amber-600', icono: '🟡' }
  return { color: 'text-red-600', icono: '🔴' }
}

export default function WarehouseReliabilityPage({
  accountId, locationId, actorName, onBack,
}: Props) {
  // La ficha del artículo se abre DENTRO de la cola (mismo patrón que
  // KitchenItemsPage): así "Añadir ingredientes" lleva al sitio de verdad y al
  // volver se recarga la lista para comprobar si el fallo ya desapareció.
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [rel, setRel] = useState<SalesReliability | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(15)

  // React Query para caché inteligente (5 min fresco + 10 min en RAM)
  const { data: items = [], isLoading, error: queryError } = useReliabilityQueue(accountId, locationId, DAYS)
  const invalidateQueue = useInvalidateReliabilityQueue()

  // Si hay error en React Query, mostrar mensaje de error
  useEffect(() => {
    if (queryError) {
      setErrorMsg(queryError instanceof Error ? queryError.message : 'No se pudo cargar.')
    } else {
      setErrorMsg(null)
    }
  }, [queryError])

  // Cargar fiabilidad (usa su propia lógica)
  useEffect(() => {
    let vivo = true
    const cargar = async () => {
      try {
        const r = await getReliability(accountId).catch(() => null)
        if (vivo) setRel(r)
      } catch (e) {
        // Silenciar errores en fiabilidad para no bloquear
      }
    }
    void cargar()
    return () => { vivo = false }
  }, [accountId])

  // Botón "Actualizar" invalida caché y fuerza refetch
  const handleRefresh = () => {
    invalidateQueue(accountId, locationId, DAYS)
  }

  // UN carril a la vez: se enseña el primero que aún tenga trabajo.
  const porCarril = useMemo(() => ({
    A: items.filter(i => i.carril === 'A'),
    B: items.filter(i => i.carril === 'B'),
    C: items.filter(i => i.carril === 'C'),
  }), [items])

  const carrilActivo: Carril | null =
    porCarril.A.length > 0 ? 'A' : porCarril.B.length > 0 ? 'B' : porCarril.C.length > 0 ? 'C' : null

  const listaActiva = carrilActivo ? porCarril[carrilActivo] : []
  const euroEnJuego = listaActiva.reduce((s, i) => s + i.eur, 0)
  const tono = fiabilidadTono(rel?.reliabilityPct ?? null)

  if (openItemId) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <KitchenItemDetailPage
          itemId={openItemId}
          onBack={() => { setOpenItemId(null); handleRefresh() }}
        />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={15} /> Volver
      </button>

      {/* ── Cabecera: el número que hoy nadie ve ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-gray-900">Fiabilidad de tu almacén</h1>
          <span className={`text-3xl font-bold tabular-nums ${tono.color}`}>
            {rel?.reliabilityPct == null ? '—' : `${Math.round(rel.reliabilityPct)}%`}
          </span>
          <span className="text-lg">{tono.icono}</span>
        </div>
        <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
          {rel?.reliabilityPct == null
            ? 'Aún no hay ventas suficientes para medirlo.'
            : rel.reliabilityPct >= 95
              ? 'Casi todo lo que vendes descuenta sus ingredientes. Así el food cost es real.'
              : `De cada 100 € que vendes, ${Math.round(100 - rel.reliabilityPct)} € no descuentan ingredientes. El coste de tus platos se calcula sobre el resto.`}
        </p>
        {listaActiva.length > 0 && (
          <p className="text-sm text-gray-900 mt-2 font-medium">
            Arregla estos {fmtInt(listaActiva.length)} {listaActiva.length === 1 ? 'caso' : 'casos'} y dejarás de perder de vista {fmtMoney(euroEnJuego)} por semana.
          </p>
        )}
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-start gap-2">
          <Check size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{flash}</span>
          <button onClick={() => setFlash(null)} className="text-emerald-700 hover:text-emerald-900"><X size={14} /></button>
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">Últimos {DAYS} días{locationId ? ' · este local' : ' · todos los locales'}</span>
        <button onClick={handleRefresh} disabled={isLoading} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm p-6">
          <Loader2 size={16} className="animate-spin" /> Revisando tus ventas…
        </div>
      ) : carrilActivo == null ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
          <div className="text-3xl mb-2">🟢</div>
          <p className="text-emerald-900 font-medium">Todo lo que vendes descuenta ingredientes.</p>
          <p className="text-sm text-emerald-800 mt-1">
            No hay nada pendiente en los últimos {DAYS} días. Si aparece un producto nuevo sin conectar, volverá a salir aquí solo.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900">{CARRIL_INFO[carrilActivo].titulo}</h2>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">{CARRIL_INFO[carrilActivo].explica}</p>
            {carrilActivo !== 'A' && (
              <p className="text-xs text-gray-500 mt-1.5">
                Lo primero (ventas sin conectar) ya está resuelto. Ahora toca esto.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {listaActiva.slice(0, pageSize).map(item => (
              <QueueCard
                key={`${item.carril}-${item.productName}`}
                item={item}
                accountId={accountId}
                actorName={actorName ?? null}
                onOpenRecipe={setOpenItemId}
                onDone={(msg) => { setFlash(msg); handleRefresh() }}
                onError={setErrorMsg}
              />
            ))}
          </div>

          {pageSize < listaActiva.length && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setPageSize(p => p + 15)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cargar más ({listaActiva.length - pageSize} restantes)
              </button>
            </div>
          )}

          {(carrilActivo === 'A' && (porCarril.B.length > 0 || porCarril.C.length > 0)) && (
            <p className="text-xs text-gray-500 mt-5 text-center">
              Después de esto quedan {fmtInt(porCarril.B.length + porCarril.C.length)} casos más, de otro tipo. Aparecerán aquí cuando termines con estos.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Una tarea = una tarjeta con UNA acción principal
// ─────────────────────────────────────────────────────────────────────────────

function QueueCard({
  item, accountId, actorName, onOpenRecipe, onDone, onError,
}: {
  item: QueueItem
  accountId: string
  actorName: string | null
  onOpenRecipe?: (recipeItemId: string) => void
  onDone: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [sug, setSug] = useState<MatchSuggestion[] | null>(null)
  const [cargandoSug, setCargandoSug] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [verOtros, setVerOtros] = useState(false)
  const [confirmarIgnorar, setConfirmarIgnorar] = useState(false)
  const [recost, setRecost] = useState<{ ventas: number } | null>(null)
  // "Crear plato nuevo" encontró uno ya muy parecido: preguntar antes de duplicar.
  const [duplicado, setDuplicado] = useState<{ recipeItemId: string; nombre: string; similitud: number } | null>(null)

  // La sugerencia solo se pide en el carril A, que es donde hay que elegir plato.
  useEffect(() => {
    if (item.carril !== 'A' || sug !== null || cargandoSug) return
    const pedir = async () => {
      setCargandoSug(true)
      try {
        setSug(await suggestMatch(accountId, item.productName, 5))
      } catch {
        setSug([])   // sin sugerencia se sigue pudiendo crear el plato a mano
      } finally {
        setCargandoSug(false)
      }
    }
    void pedir()
  }, [item.carril, item.productName, accountId, sug, cargandoSug])

  const mejor = sug && sug.length > 0 ? sug[0] : null
  const otros = sug ? sug.slice(1) : []

  async function casar(recipeItemId: string, nombrePlato: string) {
    setBusy(recipeItemId)
    try {
      const r = await mapProductToDish(accountId, item.productName, recipeItemId, actorName)
      onDone(
        r.lineasPendientes > 0
          ? `«${item.productName}» ya está conectado a «${nombrePlato}». A partir de ahora descontará solo. Las ${fmtInt(r.lineasPendientes)} ventas anteriores siguen sin descontar: puedes recuperarlas con "Recalcular ventas pasadas".`
          : `«${item.productName}» ya está conectado a «${nombrePlato}». A partir de ahora descontará solo.`,
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo conectar el producto.')
    } finally {
      setBusy(null)
    }
  }

  async function crearPlato(forzar = false) {
    setBusy('crear')
    try {
      const r = await createDishFromUnmapped(accountId, item.productName, forzar)
      if (!r.creado && r.candidato) {
        setDuplicado(r.candidato)
        return
      }
      onDone(`Plato «${item.productName}» creado. Ahora dile de qué ingredientes está hecho.`)
      if (r.recipeItemId && onOpenRecipe) onOpenRecipe(r.recipeItemId)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear el plato.')
    } finally {
      setBusy(null)
    }
  }

  async function ignorar() {
    setBusy('ignorar')
    try {
      await resolveUnmapped(accountId, item.productName, 'ignore')
      onDone(`«${item.productName}» ya no se contará como fallo. Puedes revertirlo desde "Casado de ventas por marca".`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo ignorar.')
    } finally {
      setBusy(null); setConfirmarIgnorar(false)
    }
  }

  async function pedirPreviewRecost() {
    setBusy('recost-preview')
    try {
      const r = await recostProduct(accountId, item.productName, 30, true)
      setRecost({ ventas: r.ventasAfectadas })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo calcular el impacto.')
    } finally {
      setBusy(null)
    }
  }

  async function aplicarRecost() {
    setBusy('recost-aplicar')
    try {
      const r = await recostProduct(accountId, item.productName, 30, false)
      onDone(`Recalculadas ${fmtInt(r.ventasAfectadas)} ventas pasadas: ${fmtInt(r.movimientos)} movimientos de almacén regenerados.`)
      setRecost(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo recalcular.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`rounded-xl border bg-white p-4 ${item.estado === 'recaido' ? 'border-amber-300' : 'border-gray-200'}`}>
      {/* Cabecera de la tarea */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 break-words">{item.productName}</div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><Euro size={12} />{fmtMoney(item.eur)}</span>
            <span>{fmtInt(item.ventas)} {item.carril === 'C' ? 'salidas' : 'ventas'}</span>
            {item.carril === 'C' && item.enRecetas != null && <span>en {fmtInt(item.enRecetas)} recetas</span>}
          </div>
        </div>
        <EstadoChip item={item} />
      </div>

      {/* Carril A: elegir plato */}
      {item.carril === 'A' && (
        <div className="mt-3">
          {duplicado ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                Esto se parece mucho a <span className="font-medium">«{duplicado.nombre}»</span>, que ya tienes
                ({Math.round(duplicado.similitud * 100)}% parecido). ¿Es el mismo plato?
              </p>
              <div className="flex flex-wrap gap-2 mt-2.5">
                <button
                  onClick={() => { void casar(duplicado.recipeItemId, duplicado.nombre).then(() => setDuplicado(null)) }}
                  disabled={busy != null}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy === duplicado.recipeItemId ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Sí, casar con «{duplicado.nombre}»
                </button>
                <button onClick={() => { setDuplicado(null); void crearPlato(true) }} disabled={busy != null}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 text-sm text-amber-900 hover:bg-amber-100">
                  {busy === 'crear' ? <Loader2 size={14} className="animate-spin" /> : <ChefHat size={14} />}
                  No, crear uno nuevo igualmente
                </button>
              </div>
            </div>
          ) : (
            <>
              {cargandoSug && (
                <div className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Buscando a qué plato se parece…</div>
              )}

              {mejor && (
                <>
                  <div className="text-sm text-gray-700">
                    Folvy cree que es: <span className="font-medium text-gray-900">{mejor.name}</span>{' '}
                    <span className="text-xs text-gray-500">({Math.round(mejor.confidence * 100)}% seguro)</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <button
                      onClick={() => casar(mejor.recipeItemId, mejor.name)}
                      disabled={busy != null}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy === mejor.recipeItemId ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      Sí, es este plato
                    </button>
                    {otros.length > 0 && (
                      <button onClick={() => setVerOtros(v => !v)} disabled={busy != null}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                        <Search size={14} /> Es otro…
                      </button>
                    )}
                    <button onClick={() => crearPlato()} disabled={busy != null}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                      {busy === 'crear' ? <Loader2 size={14} className="animate-spin" /> : <ChefHat size={14} />}
                      Crear plato nuevo
                    </button>
                  </div>
                </>
              )}

              {sug !== null && sug.length === 0 && !cargandoSug && (
                <div className="text-sm text-gray-700">
                  No se parece a ningún plato de tu carta.
                  <div className="mt-2">
                    <button onClick={() => crearPlato()} disabled={busy != null}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                      {busy === 'crear' ? <Loader2 size={15} className="animate-spin" /> : <ChefHat size={15} />}
                      Crear plato nuevo
                    </button>
                  </div>
                </div>
              )}

              {verOtros && otros.length > 0 && (
                <div className="mt-2.5 rounded-lg border border-gray-200 divide-y">
                  {otros.map(o => (
                    <button key={o.recipeItemId} onClick={() => casar(o.recipeItemId, o.name)} disabled={busy != null}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2">
                      <span className="text-gray-900">{o.name}</span>
                      <span className="text-xs text-gray-500">{Math.round(o.confidence * 100)}%</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Salida honesta para lo que no gasta stock */}
              <div className="mt-2.5">
                {!confirmarIgnorar ? (
                  <button onClick={() => setConfirmarIgnorar(true)} disabled={busy != null}
                    className="text-xs text-gray-500 hover:text-gray-800 underline">
                    No lleva stock (bebida, extra…) → no contarlo
                  </button>
                ) : (
                  <div className="text-xs text-gray-700 flex items-center gap-2 flex-wrap">
                    <span>¿Seguro? Dejará de aparecer aquí y no descontará nada.</span>
                    <button onClick={ignorar} disabled={busy != null}
                      className="px-2.5 py-1 rounded-md bg-gray-900 text-white">Sí, no contarlo</button>
                    <button onClick={() => setConfirmarIgnorar(false)} className="px-2 py-1 text-gray-600">Cancelar</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Carril B: falta el escandallo */}
      {item.carril === 'B' && (
        <div className="mt-3">
          <p className="text-sm text-gray-700">Este plato no tiene ingredientes definidos, así que sus ventas no descuentan nada.</p>
          <button
            onClick={() => item.recipeItemId && onOpenRecipe?.(item.recipeItemId)}
            disabled={!item.recipeItemId || !onOpenRecipe}
            className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            <ChefHat size={15} /> Añadir ingredientes
          </button>
        </div>
      )}

      {/* Carril C: falta el precio del ingrediente */}
      {item.carril === 'C' && (
        <div className="mt-3">
          <p className="text-sm text-gray-700">Sale del almacén, pero no sabemos lo que cuesta. Ponle precio en su ficha o recíbelo con un albarán.</p>
          <button
            onClick={() => item.recipeItemId && onOpenRecipe?.(item.recipeItemId)}
            disabled={!item.recipeItemId || !onOpenRecipe}
            className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            <Euro size={15} /> Poner precio
          </button>
        </div>
      )}

      {/* Re-costeo del pasado: SIEMPRE explícito y con impacto a la vista */}
      {item.carril === 'A' && item.estado !== 'pendiente' && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {recost == null ? (
            <button onClick={pedirPreviewRecost} disabled={busy != null}
              className="text-xs text-gray-500 hover:text-gray-800 underline">
              {busy === 'recost-preview' ? 'Calculando…' : 'Recalcular ventas pasadas de este producto…'}
            </button>
          ) : (
            <div className="text-xs text-gray-700 space-y-1.5">
              <p>
                Esto recalculará <b>{fmtInt(recost.ventas)} ventas</b> de los últimos 30 días y regenerará sus movimientos de almacén.
                Tu stock contado dejará de cuadrar con el teórico hasta el próximo inventario.
              </p>
              <div className="flex gap-2">
                <button onClick={aplicarRecost} disabled={busy != null}
                  className="px-2.5 py-1 rounded-md bg-gray-900 text-white">
                  {busy === 'recost-aplicar' ? 'Recalculando…' : 'Sí, recalcular'}
                </button>
                <button onClick={() => setRecost(null)} className="px-2 py-1 text-gray-600">Ahora no</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** El estado NO lo decide un botón: lo decide si ya ha habido una venta nueva. */
function EstadoChip({ item }: { item: QueueItem }) {
  if (item.estado === 'esperando_confirmacion') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
        <Clock size={11} /> Arreglado · esperando la próxima venta
      </span>
    )
  }
  if (item.estado === 'recaido') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-300 shrink-0">
        <AlertTriangle size={11} /> Se arregló y ha vuelto a fallar
      </span>
    )
  }
  return null
}
