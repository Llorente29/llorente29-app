// src/modules/kitchen/pages/PriceGridPage.tsx
//
// REJILLA DE PRECIOS — una marca por pantalla, todos sus precios por canal.
//
// ── LA REGLA QUE GOBIERNA LA EDICIÓN (18/08, tarde) ────────────────────────
// NADA SE GUARDA SOLO. Editar celdas acumula CAMBIOS PENDIENTES; escribir en la
// base ocurre en un único sitio: el botón Guardar de la barra de abajo, que
// siempre está ahí.
//
// Por qué se rehizo: la versión anterior intentaba guardar cada celda por su
// cuenta y no tenía regla para el gesto más frecuente de todos —salir de la
// celda pulsando en otro sitio—, así que cada camino hacía una cosa distinta.
// Julio, en producción: «antes salió un guardar, ahora no, y si te sales de la
// celda no lo guarda». Con este modelo el gesto ambiguo desaparece porque no
// hay nada que decidir al salir de una celda: se queda pendiente, como todo.
//
// Salvo Esc, TODO lo que se teclea se queda como pendiente. Nunca se pierde lo
// escrito, y nunca se escribe sin pasar por Guardar.
//
// La operación en lote alimenta LA MISMA lista de pendientes. Un solo camino de
// guardado, un solo botón, una sola operación reversible. Tener dos caminos era
// justamente lo que producía «a veces sale un guardar y a veces no».
//
// ── TRES COSAS QUE NO CAMBIAN ──────────────────────────────────────────────
//
// 1. EL PRECIO ES CON IVA, SIEMPRE. Es lo que paga el cliente.
//
// 2. EL PRECIO ES POR CANAL; EL MARGEN, POR CANAL × MODALIDAD. Hay UN precio por
//    canal, pero el mismo 1,90 € en Glovo deja −7,1 % con reparto propio y
//    +63,0 % en recogida. Por eso la vista de precio tiene una columna por canal
//    y la de margen una por canal × modalidad.
//
// 3. LAS COMBINACIONES IMPOSIBLES NO SE PINTAN. El servidor las marca; aquí se
//    listan aparte con su motivo.
//
// Sin escandallo ⇒ celda de margen VACÍA. Nunca 0 %: sería mentira.
//
// ── UNA SOLA PREGUNTA: ¿DÓNDE? (21/08) ─────────────────────────────────────
// Julio subió tres precios de Meraki Pita y no pudo decir qué había hecho. No
// era suyo el fallo: la pantalla le hacía tomar CINCO decisiones que nunca
// enunciaba —precio base o de canal, cuenta o local, si el canal llega a algún
// sitio, que cambiar no es publicar, y con qué alcance se publica—. Para una
// tarea que él describe en una frase.
//
// Ahora se pregunta UNA cosa, en su idioma: «¿de qué carta?» y «¿dónde?». De
// ahí sale todo lo demás y no se vuelve a preguntar:
//
//   · DÓNDE se escribe.  Elegir «Foodint Alcalá» escribe en Alcalá; elegir
//     «los 2 locales» escribe el precio de la marca. Una sola variable manda
//     sobre la escritura, el texto de la barra y el alcance de publicar, así
//     que no pueden discrepar.
//
//   · SI ESE CANAL LLEGA.  La ruta es POR LOCAL (Uber sale por HubRise en
//     Alcalá y por Last en Carabanchel) y hasta hoy la pantalla no la miraba:
//     dejaba teclear el precio de Glovo en Alcalá, que se gestiona en Last, sin
//     decir que ese número no se publica en ningún sitio. Ahora cada columna lo
//     dice y la celda que no llega no se edita (channelRouteService).
//
//   · PUBLICAR.  Guardar y publicar dejan de ser dos actos que hay que conocer:
//     al guardar, la pantalla dice qué canales llegan, cuáles no y por qué, y
//     ofrece el botón. Publica EXACTAMENTE el mismo sitio que enseña arriba.
//
// Las palabras «ámbito» y «override» no aparecen en pantalla. Son nuestras, no
// del que pone precios.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Table2, AlertTriangle, Undo2, EyeOff, Loader2, Check, X, FlaskConical, Gauge, Pencil,
  UploadCloud, Lock,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { supabase } from '@/lib/supabase'
import { fmtMoney, fmtNumEs, fmtPct } from '@/lib/format'
import type { Brand } from '@/types/multitenancy'
import {
  getBrandPriceGrid, applyPriceOperation, revertPriceOperation, getAccountIsInternal,
  getBrandMenuOrder, agruparPorCarta,
  bandaDe, BANDA_APRIETA_HASTA, redondear, precioObjetivo, pctReal, leerPrecio, expectedPriceBefore,
  cellKey, SERVICE_TYPE_LABEL, ESCALERA_LABEL,
  type PriceGrid, type GridColumn, type GridTimings, type MenuOrder, type Escalera, type BulkOp,
  type OperationEntry, type Banda,
} from '@/modules/kitchen/services/priceGridService'
import {
  listChannelRoutes, veredicto, esEditable, llegaAPlataforma, ROUTE_LABEL, ROUTE_NOTA,
  type RouteRow, type RouteVerdict,
} from '@/modules/kitchen/services/channelRouteService'
import { publishBrandCatalog, type PublishResult } from '@/modules/kitchen/services/catalogPublishService'

// Formato: SIEMPRE dos decimales y símbolo al mostrar (fmtMoney), y coma sin
// símbolo al sembrar un campo editable (fmtNumEs). Los dos salen de
// src/lib/format.ts, que es el único sitio donde vive el formateo numérico.
// Antes se sembraba con String(precio) y salía «15,9» al lado de «15,90 €»:
// dos formatos en la misma pantalla, y el crudo era justo el del campo que se
// edita. El propio comentario de fmtNumEs describe ese fallo.
const eur = (v: number | null | undefined): string => (v === null || v === undefined ? '' : fmtMoney(v))
const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '' : fmtPct(v))
const ms = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('es-ES').format(v)} ms`

const BANDA_CLASE: Record<Banda, string> = {
  pierde:   'text-danger font-semibold',
  aprieta:  'text-warning font-semibold',
  sano:     'text-success font-semibold',
  sin_dato: 'text-tinta-25',
}

/**
 * Un cambio tecleado y aceptado, TODAVÍA SIN ESCRIBIR. Lleva dentro todo lo que
 * hará falta para construir la entrada de la operación, incluido
 * `expectedBefore`: si la carta cambia por debajo entre teclear y guardar, el
 * servidor aborta la operación entera y enseña el conflicto.
 */
interface Pendiente {
  itemId: string
  channelId: string
  accion: 'set' | 'clear'
  precio: number | null        // set → número; clear → null (vuelve a heredado)
  precioAntes: number
  expectedBefore: number | null
}

const pKey = (itemId: string, channelId: string): string => `${itemId}::${channelId}`

/** Fila de la previsualización: lo que se enseña antes de escribir. */
interface PreviewRow {
  menuItemId: string; producto: string
  channelId: string; canal: string
  accion: 'set' | 'clear'
  precioAntes: number; precioDespues: number | null; pctRealAplicado: number | null
  /** Una entrada por modalidad del canal: es donde el margen diverge. */
  modalidades: Array<{ key: string; label: string; antes: number | null; despues: number | null }>
  costAvailable: boolean
  enPerdida: boolean
  avisado: boolean
}

export default function PriceGridPage() {
  const { activeAccountId } = useActiveAccount()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([])
  // null = el precio de la marca, el mismo en todos sus locales.
  // Un id = ese local. Es LA variable: manda sobre lo que se escribe, sobre lo
  // que dice la barra de guardado y sobre a dónde publica el botón.
  const [locationId, setLocationId] = useState<string | null>(null)
  const [cuentaInterna, setCuentaInterna] = useState(false)
  const [rutas, setRutas] = useState<RouteRow[]>([])
  // Publicar, desde aquí mismo (§4.3): cambiar y publicar dejan de ser dos
  // actos que el usuario tiene que conocer por su cuenta.
  const [trasGuardar, setTrasGuardar] = useState<{ celdas: number; canales: string[] } | null>(null)
  const [publicando, setPublicando] = useState(false)
  const [resultadoPublicar, setResultadoPublicar] = useState<PublishResult | null>(null)

  const [grid, setGrid] = useState<PriceGrid | null>(null)
  const [orden, setOrden] = useState<MenuOrder | null>(null)
  const [cargadoPara, setCargadoPara] = useState<string | null>(null)
  const [timings, setTimings] = useState<GridTimings | null>(null)
  const [pintarMs, setPintarMs] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [verTiempos, setVerTiempos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [vista, setVista] = useState<'precio' | 'margen'>('precio')
  const [filtroCat, setFiltroCat] = useState<string>('todas')

  // ── LO ÚNICO QUE ESCRIBE: la lista de pendientes ───
  const [pendientes, setPendientes] = useState<Map<string, Pendiente>>(new Map())
  // `semilla` = lo que el campo tenía al abrirse. Esc lo devuelve al input ANTES
  // de cerrar, así que si el navegador dispara onBlur al desmontar, lo que se
  // acepta es el valor original: un no-op. Así no hace falta un indicador de
  // "estoy escapando" que el onBlur tenga que consultar — y aceptar al salir
  // pasa a leer SIEMPRE el DOM, que es la única fuente que no va con retraso.
  const [edit, setEdit] = useState<{ itemId: string; channelId: string; valor: string; semilla: string } | null>(null)

  // selección para la operación en lote
  const [selProductos, setSelProductos] = useState<Set<string>>(new Set())
  const [selCanales, setSelCanales] = useState<Set<string>>(new Set())
  const [opKind, setOpKind] = useState<BulkOp['kind']>('pct')
  const [opValor, setOpValor] = useState<string>('10')
  const [escalera, setEscalera] = useState<Escalera>('decena')
  const [excluirCombos, setExcluirCombos] = useState(true)
  const [excluirSinEscandallo, setExcluirSinEscandallo] = useState(false)

  // previsualización / guardado
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [asumoPerdida, setAsumoPerdida] = useState(false)
  const [ultimaOperacion, setUltimaOperacion] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const hayPendientes = pendientes.size > 0

  // El nombre del SITIO, como lo diría el usuario. Nunca «ámbito».
  const dondeNombre = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : (locations.length === 1 ? (locations[0]?.name ?? 'el local') : `los ${locations.length} locales`)

  // ── Salir con pendientes AVISA ───
  // Dos puertas, porque son dos salidas distintas.
  //
  // NO se usa useBlocker de react-router: esta app monta <BrowserRouter> y no un
  // data router, y ahí useBlocker LANZA. Habría matado la pantalla entera en el
  // primer render con un cambio pendiente. En su lugar, un escuchador en fase de
  // captura sobre los enlaces, que no obliga a tocar el armazón de la app.
  const navigate = useNavigate()
  const [salidaPendiente, setSalidaPendiente] = useState<string | null>(null)

  useEffect(() => {
    if (!hayPendientes) return
    // 1) Recargado, cierre de pestaña y —esto importa aquí— el set()+reload con
    //    el que la OTA aplica un bundle nuevo sin preguntar. Sin esta puerta, un
    //    despliegue en una ventana tranquila se llevaría por delante los cambios
    //    sin escribir.
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    // 2) Navegación dentro de la app: se intercepta el clic en cualquier enlace
    //    que lleve a otra ruta, antes de que react-router lo procese.
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return
      const destino = (ev.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!destino || destino.target === '_blank') return
      const href = destino.getAttribute('href')
      if (!href || href.startsWith('#')) return
      let url: URL
      try { url = new URL(destino.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return
      ev.preventDefault(); ev.stopPropagation()
      setSalidaPendiente(url.pathname + url.search)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [hayPendientes])

  // ── carga de marcas, locales y bandera de cuenta interna ───
  useEffect(() => {
    if (!activeAccountId) return
    listBrands({ accountId: activeAccountId })
      .then((bs) => { setBrands(bs); setBrandId((prev) => prev ?? bs[0]?.id ?? null) })
      .catch((e) => setError(String(e)))
    // El error NO se traga: si esta consulta falla, el desplegable de ámbito se
    // queda con «toda la cuenta» como única opción y sería imposible escribir en
    // un local sin que nadie entendiera por qué.
    // SÓLO LOCALES ABIERTOS. Foodint tiene tres y «Plaza Castilla» está
    // inactivo (active=false) aunque Meraki Pita siga marcada como disponible
    // ahí. Sin este filtro el desplegable ofrecería un local cerrado y el texto
    // diría «los 3 locales» cuando son 2 — y ese número es el que el usuario
    // lee antes de escribir. Un local cerrado no tiene precios que poner.
    supabase?.from('locations').select('id, name').eq('account_id', activeAccountId)
      .eq('active', true).order('name')
      .then(({ data, error: e }) => {
        if (e) setError(`No se han podido cargar los locales: ${e.message}. Sólo se puede poner el mismo precio para todos.`)
        setLocations((data ?? []) as Array<{ id: string; name: string }>)
      })
    getAccountIsInternal(activeAccountId).then(setCuentaInterna).catch(() => setCuentaInterna(false))
    // Las rutas de publicación. Si fallan se degrada a «sin declarar», que deja
    // escribir y avisa: perder la pantalla de precios por no poder leer una
    // tabla declarativa sería peor que el problema que resuelve.
    listChannelRoutes(activeAccountId).then(setRutas).catch(() => setRutas([]))
  }, [activeAccountId])

  // ── carga de la rejilla ───
  const claveCarga = `${brandId ?? ''}::${locationId ?? ''}::${reloadKey}`
  const loading = brandId !== null && cargadoPara !== claveCarga

  useEffect(() => {
    if (!brandId) return
    let vivo = true
    const t0 = performance.now()
    const clave = `${brandId}::${locationId ?? ''}::${reloadKey}`

    getBrandMenuOrder(brandId)
      .then((o) => { if (vivo) setOrden(o) })
      .catch(() => { if (vivo) setOrden(null) })

    getBrandPriceGrid(brandId, locationId)
      .then(({ grid: g, timings: t }) => {
        if (!vivo) return
        setError(null); setPreview(null); setEdit(null)
        const tEstado = performance.now()
        setGrid(g); setTimings(t)
        setTotalMs(Math.round(tEstado - t0))
        setCargadoPara(clave)
        requestAnimationFrame(() => { if (vivo) setPintarMs(Math.round(performance.now() - tEstado)) })
      })
      .catch((e) => {
        if (!vivo) return
        setError(e instanceof Error ? e.message : String(e))
        setCargadoPara(clave)
      })
    return () => { vivo = false }
  }, [brandId, locationId, reloadKey])

  // ── columnas y bloques de carta ───
  // Cada canal lleva pegado SI LLEGA A ALGÚN SITIO desde este local. Va aquí y
  // no en la celda para que el encabezado, la celda, la operación en lote y la
  // frase de guardado lean todos el mismo veredicto: si se calculara en cada
  // sitio, podrían discrepar, que es de donde salen estos problemas.
  const canales = useMemo(() => {
    if (!grid) return [] as Array<{ channelId: string; channelName: string; channelType: string | null; cols: GridColumn[]; ruta: RouteVerdict; editable: boolean }>
    const m = new Map<string, { channelId: string; channelName: string; channelType: string | null; cols: GridColumn[] }>()
    for (const c of grid.columns) {
      const e = m.get(c.channelId)
      if (e) e.cols.push(c)
      else m.set(c.channelId, { channelId: c.channelId, channelName: c.channelName, channelType: c.channelType, cols: [c] })
    }
    return Array.from(m.values()).map((c) => {
      const ruta = veredicto(rutas, locationId, c.channelId, c.channelType)
      return { ...c, ruta, editable: esEditable(ruta) }
    })
  }, [grid, rutas, locationId])

  /** Los canales de esta pantalla que SÍ llegarían a una plataforma al publicar. */
  const canalesQuePublican = useMemo(
    () => canales.filter((c) => llegaAPlataforma(c.ruta)), [canales])
  /** Los que NO, con su motivo — para poder decirlo, no para esconderlo. */
  const canalesQueNo = useMemo(
    () => canales.filter((c) => c.ruta.kind === 'last' || c.ruta.kind === 'ninguna'), [canales])

  const todasLasSecciones = useMemo(
    () => (grid ? agruparPorCarta(grid.products, orden) : []), [grid, orden])

  const categorias = useMemo(
    () => todasLasSecciones.map((sec) => ({ id: sec.categoryId ?? 'sin', name: sec.categoryName })),
    [todasLasSecciones])

  const secciones = useMemo(() => {
    if (filtroCat === 'todas') return todasLasSecciones
    if (filtroCat === 'sin') return todasLasSecciones.filter((sec) => sec.categoryId === null)
    return todasLasSecciones.filter((sec) => sec.categoryId === filtroCat)
  }, [todasLasSecciones, filtroCat])

  const productosVisibles = useMemo(
    () => secciones.flatMap((sec) => sec.products), [secciones])

  const stats = useMemo(() => {
    if (!grid) return null
    let propios = 0, enPerdida = 0, sinEscandallo = 0
    for (const p of grid.products) {
      let tieneCoste = false
      for (const c of grid.columns) {
        const cell = grid.cells.get(cellKey(p.menuItemId, c.key))
        if (!cell) continue
        if (cell.costAvailable) tieneCoste = true
        if (cell.priceSource === 'override' && c.serviceType !== 'pickup') propios++
        if (cell.netMarginPct !== null && cell.netMarginPct < 0) enPerdida++
      }
      if (!tieneCoste) sinEscandallo++
    }
    return { propios, enPerdida, sinEscandallo, total: grid.products.length }
  }, [grid])

  // ══ EDICIÓN: acumular pendientes, nunca escribir ═══════════════════════════

  /** Precio efectivo de una celda AHORA: el pendiente si lo hay, si no el de la base. */
  const precioMostrado = useCallback((itemId: string, channelId: string, basePrecio: number, precioBase: number | null): number | null => {
    const p = pendientes.get(pKey(itemId, channelId))
    if (!p) return basePrecio
    if (p.accion === 'clear') return precioBase
    return p.precio
  }, [pendientes])

  function abrirCelda(itemId: string, channelId: string, precioActual: number) {
    setAviso(null)
    // Puerta cerrada de verdad, no sólo en el pintado: si el canal no lleva el
    // precio a ninguna parte, no se abre el campo. Ofrecer el teclado para un
    // número que no se publica es el botón que no cumple.
    const ch = canales.find((c) => c.channelId === channelId)
    if (ch && !ch.editable) return
    const p = pendientes.get(pKey(itemId, channelId))
    const semilla = p ? (p.accion === 'clear' ? '' : fmtNumEs(p.precio)) : fmtNumEs(precioActual)
    setEdit({ itemId, channelId, valor: semilla, semilla })
  }

  /**
   * Acepta lo tecleado COMO PENDIENTE. Es lo que hacen Enter, Tab y salir de la
   * celda: un solo camino, para que el mismo gesto haga siempre lo mismo.
   * Devuelve false sólo si lo tecleado no es un precio, y entonces deja la celda
   * abierta para corregirlo en vez de tragarse el error.
   */
  const aceptarEdicion = useCallback((valor: string, itemId: string, channelId: string): boolean => {
    if (!grid) return true
    const ch = canales.find((c) => c.channelId === channelId)
    if (!ch) { setEdit(null); return true }
    const ref = grid.cells.get(cellKey(itemId, ch.cols[0].key))
    if (!ref) { setEdit(null); return true }

    const leido = leerPrecio(valor)
    if (Number.isNaN(leido)) {
      setAviso('Eso no es un precio. Escribe un número, por ejemplo 15,90. Se acepta coma o punto.')
      return false
    }

    const k = pKey(itemId, channelId)
    const esOverrideAqui = ref.priceSource === 'override' && (locationId ? ref.isLocationOverride : true)

    setPendientes((prev) => {
      const n = new Map(prev)
      if (leido === null) {
        // Campo vacío = volver a heredado. Si no hay override EN ESTE ÁMBITO no
        // hay nada que borrar: se quita el pendiente y no se inventa una entrada
        // que el servidor resolvería como 0 escrituras.
        if (esOverrideAqui) {
          n.set(k, {
            itemId, channelId, accion: 'clear',
            precio: null, precioAntes: ref.price, expectedBefore: expectedPriceBefore(ref),
          })
        } else n.delete(k)
        return n
      }
      // Volver al precio que ya tenía = no hay cambio que guardar.
      if (Math.abs(leido - ref.price) < 0.005) n.delete(k)
      else n.set(k, {
        itemId, channelId, accion: 'set',
        precio: leido, precioAntes: ref.price, expectedBefore: expectedPriceBefore(ref),
      })
      return n
    })
    setEdit(null)
    return true
  }, [grid, canales, locationId])

  /** Enter baja; Tab va a la derecha. Los dos aceptan antes de moverse. */
  function mover(dir: 'abajo' | 'derecha') {
    if (!edit || !grid) return
    const itemId = edit.itemId, channelId = edit.channelId
    if (!aceptarEdicion(edit.valor, itemId, channelId)) return
    if (dir === 'derecha') {
      const i = canales.findIndex((c) => c.channelId === channelId)
      const sig = canales[i + 1]
      if (!sig) return
      const celda = grid.cells.get(cellKey(itemId, sig.cols[0].key))
      const pend = pendientes.get(pKey(itemId, sig.channelId))
      const v = pend ? (pend.accion === 'clear' ? '' : fmtNumEs(pend.precio)) : fmtNumEs(celda?.price ?? 0)
      setEdit({ itemId, channelId: sig.channelId, valor: v, semilla: v })
      return
    }
    const j = productosVisibles.findIndex((p) => p.menuItemId === itemId)
    const sigProd = productosVisibles[j + 1]
    if (!sigProd) return
    const ch = canales.find((c) => c.channelId === channelId)
    const celda = ch ? grid.cells.get(cellKey(sigProd.menuItemId, ch.cols[0].key)) : undefined
    const pend = pendientes.get(pKey(sigProd.menuItemId, channelId))
    const v = pend ? (pend.accion === 'clear' ? '' : fmtNumEs(pend.precio)) : fmtNumEs(celda?.price ?? 0)
    setEdit({ itemId: sigProd.menuItemId, channelId, valor: v, semilla: v })
  }

  function descartarTodo() {
    setPendientes(new Map()); setEdit(null); setPreview(null); setAviso(null)
  }

  // ══ OPERACIÓN EN LOTE → LA MISMA LISTA DE PENDIENTES ═══════════════════════
  // No guarda: deja los cambios pendientes igual que teclear una celda. Un solo
  // camino de guardado para las dos formas de editar.
  function aplicarLote() {
    if (!grid) return
    setAviso(null)
    const op: BulkOp =
      opKind === 'base' ? { kind: 'base' } : { kind: opKind, value: Number(opValor.replace(',', '.')) }
    if (op.kind !== 'base' && !Number.isFinite(op.value)) { setAviso('El valor de la operación no es un número.'); return }

    const nuevos = new Map(pendientes)
    let n = 0
    for (const p of productosVisibles) {
      if (!selProductos.has(p.menuItemId)) continue
      if (excluirCombos && p.productType === 'combo') continue
      for (const ch of canales) {
        if (!selCanales.has(ch.channelId)) continue
        // Mismo veredicto que la celda suelta: la operación en lote no es una
        // puerta de atrás para escribir donde no llega.
        if (!ch.editable) continue
        const ref = grid.cells.get(cellKey(p.menuItemId, ch.cols[0].key))
        if (!ref) continue
        if (excluirSinEscandallo && !ref.costAvailable) continue
        const k = pKey(p.menuItemId, ch.channelId)
        if (op.kind === 'base') {
          const esOverrideAqui = ref.priceSource === 'override' && (locationId ? ref.isLocationOverride : true)
          if (!esOverrideAqui) continue
          nuevos.set(k, { itemId: p.menuItemId, channelId: ch.channelId, accion: 'clear',
            precio: null, precioAntes: ref.price, expectedBefore: expectedPriceBefore(ref) })
          n++
          continue
        }
        const bruto = precioObjetivo(ref.price, op)
        if (bruto === null) continue
        const fin = redondear(bruto, ref.price, escalera)
        if (Math.abs(fin - ref.price) < 0.005) { nuevos.delete(k); continue }
        nuevos.set(k, { itemId: p.menuItemId, channelId: ch.channelId, accion: 'set',
          precio: fin, precioAntes: ref.price, expectedBefore: expectedPriceBefore(ref) })
        n++
      }
    }
    if (n === 0) { setAviso('La operación no cambia ninguna celda de las seleccionadas.'); return }
    setPendientes(nuevos)
    setSelProductos(new Set())
    setAviso(`${n} celda(s) añadidas a los cambios pendientes. Nada se ha guardado todavía.`)
  }

  // ══ PREVISUALIZAR Y GUARDAR — el único camino que escribe ═══════════════════

  async function construirPreview() {
    if (!grid || !brandId || pendientes.size === 0) return
    setAviso(null); setAsumoPerdida(false)

    // El margen NUNCA se recalcula aquí: se le pide al servidor con p_overrides.
    const overrides: Record<string, Record<string, number>> = {}
    for (const p of pendientes.values()) {
      let precio: number | null = null
      if (p.accion === 'set') precio = p.precio
      else if (!locationId) {
        // Volver a heredado en ámbito CUENTA acaba en el precio base, que se
        // conoce. En ámbito local acaba en el precio de marca, que esta rejilla
        // no trae: no se inventa ni el precio ni el margen.
        precio = grid.products.find((x) => x.menuItemId === p.itemId)?.basePrice ?? null
      }
      if (precio === null) continue
      overrides[p.itemId] = { ...(overrides[p.itemId] ?? {}), [p.channelId]: precio }
    }

    setPreviewing(true)
    try {
      const { grid: conPreview } = await getBrandPriceGrid(brandId, locationId, overrides)
      const filas: PreviewRow[] = []
      for (const p of pendientes.values()) {
        const prod = grid.products.find((x) => x.menuItemId === p.itemId)
        const ch = canales.find((c) => c.channelId === p.channelId)
        if (!prod || !ch) continue
        const precioDespues = p.accion === 'clear'
          ? (locationId ? null : (prod.basePrice ?? null))
          : p.precio
        const modalidades = ch.cols.map((c) => ({
          key: c.key,
          label: c.serviceType ? SERVICE_TYPE_LABEL[c.serviceType] ?? c.serviceType : 'Mostrador',
          antes: grid.cells.get(cellKey(p.itemId, c.key))?.netMarginPct ?? null,
          despues: precioDespues === null ? null : (conPreview.cells.get(cellKey(p.itemId, c.key))?.netMarginPct ?? null),
        }))
        const ref = grid.cells.get(cellKey(p.itemId, ch.cols[0].key))
        const costAvailable = ref?.costAvailable === true
        filas.push({
          menuItemId: p.itemId, producto: prod.name,
          channelId: p.channelId, canal: ch.channelName,
          accion: p.accion,
          precioAntes: p.precioAntes, precioDespues,
          pctRealAplicado: precioDespues === null ? null : pctReal(p.precioAntes, precioDespues),
          modalidades, costAvailable,
          // Sin escandallo NO hay pérdida que avisar: no se sabe.
          enPerdida: costAvailable && modalidades.some((m) => m.despues !== null && m.despues < 0),
          avisado: costAvailable && modalidades.some((m) => m.despues !== null && m.despues >= 0 && m.despues < BANDA_APRIETA_HASTA),
        })
      }
      filas.sort((a, b) => (a.enPerdida === b.enPerdida ? a.producto.localeCompare(b.producto, 'es') : a.enPerdida ? -1 : 1))
      setPreview(filas)
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setPreviewing(false) }
  }

  const enPerdida = preview?.filter((r) => r.enPerdida).length ?? 0
  const puedeGuardar = preview !== null && (enPerdida === 0 || asumoPerdida)

  async function guardar() {
    if (!preview || !activeAccountId || !puedeGuardar) return
    setSaving(true); setAviso(null)
    try {
      const entries: OperationEntry[] = Array.from(pendientes.values()).map((p) => ({
        menu_item_id: p.itemId,
        channel_id: p.channelId,
        // EL ÁMBITO. Sale del mismo estado que se enseña en la barra y en la
        // previsualización, así que lo que se ve y lo que se escribe no pueden
        // discrepar.
        location_id: locationId,
        action: p.accion,
        ...(p.accion === 'clear' ? {} : { price: p.precio as number }),
        expected_price_before: p.expectedBefore,
      }))
      const opId = await applyPriceOperation({
        accountId: activeAccountId,
        scope: {
          marca: brands.find((b) => b.id === brandId)?.name ?? brandId,
          ambito: dondeNombre,
          ambito_location_id: locationId,
          canales: Array.from(new Set(preview.map((r) => r.canal))),
          productos: Array.from(new Set(preview.map((r) => r.producto))).length,
          celdas: entries.length,
          origen: 'rejilla de precios',
        },
        entries,
        note: `Rejilla · ${entries.length} celda(s) · ${dondeNombre}`,
      })
      setUltimaOperacion(opId)
      const canalesTocados = Array.from(new Set(preview.map((r) => r.canal)))
      setPendientes(new Map()); setPreview(null); setAsumoPerdida(false)
      setReloadKey((k) => k + 1)
      // §4.3 — cambiar y publicar dejan de ser dos actos que hay que conocer.
      // La pantalla dice qué falta y lo ofrece, con las dos salidas explícitas.
      setTrasGuardar({ celdas: entries.length, canales: canalesTocados })
      setResultadoPublicar(null)
    } catch (e) {
      // Conflictos: se ENSEÑAN, no se esconden.
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  /**
   * §4.4 — publica EXACTAMENTE el sitio que enseña la pantalla. Sale de la misma
   * `locationId` que gobierna la escritura, así que lo que se mira y lo que se
   * escribe no pueden discrepar. El 21/08 discreparon: el ensayo corrió con
   * scope=single(Alcalá) y la publicación con scope=all — y no salió del botón
   * de publicar, sino de «Conectar a delivery», que se comía el local. Está
   * arreglado en hubrise-brand-connect; esta pantalla no lo repite.
   */
  async function publicarAhora() {
    if (!brandId || publicando) return
    setPublicando(true); setAviso(null)
    try {
      setResultadoPublicar(await publishBrandCatalog(brandId, locationId))
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setPublicando(false) }
  }

  async function deshacer() {
    if (!ultimaOperacion) return
    setSaving(true); setAviso(null)
    try {
      await revertPriceOperation(ultimaOperacion)
      setUltimaOperacion(null); setReloadKey((k) => k + 1)
      setAviso('Operación deshecha: los precios han vuelto a como estaban.')
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  /** Los cambios pendientes son DE ESE SITIO: cambiar de carta o de local los invalida. */
  function cambiarContexto(fn: () => void) {
    if (hayPendientes && !window.confirm(
      `Tienes ${pendientes.size} cambio(s) sin guardar en ${dondeNombre}. Si cambias de carta o de local se descartan. ¿Seguir?`)) return
    setPendientes(new Map()); setEdit(null); setPreview(null); setTrasGuardar(null)
    fn()
  }

  // ══ RENDER ═════════════════════════════════════════════════════════════════
  const nCols = vista === 'precio' ? canales.length : (grid?.columns.length ?? 0)

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-28">
      <div className="flex items-start gap-3 mb-1">
        <Table2 className="w-5 h-5 mt-1 text-tinta-70" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Precios de la carta</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-3xl">
            Elige <b>la carta</b> y <b>dónde</b>, y cambia los precios. Son los que paga el cliente,{' '}
            <b>con IVA</b>. Nada se guarda hasta que pulsas Guardar; al guardar te digo{' '}
            <b>a qué plataformas llega</b> y te ofrezco publicarlo.
          </p>
        </div>
      </div>

      {cuentaInterna && (
        <div className="mt-4 border-l-4 border-tinta bg-lavado border border-linea-fuerte rounded-lg p-3 flex items-start gap-2.5">
          <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-tinta-70" />
          <div className="text-sm">
            <b className="uppercase tracking-wide text-xs">Cuenta interna de pruebas</b>
            <div className="text-text-secondary mt-0.5">
              Los datos no son de un cliente. Puede faltar configuración —por ejemplo, política de reparto por
              canal—, así que una rejilla vacía o con pocas columnas aquí <b>no significa que la pantalla falle</b>.
            </div>
          </div>
        </div>
      )}

      {/* selectores */}
      <div className="mt-5 flex flex-wrap items-center gap-3 bg-card border border-border-default rounded-xl p-3">
        <label className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45">Carta</label>
        <select className="border border-linea-fuerte rounded-lg px-3 py-1.5 text-sm font-semibold bg-white"
          value={brandId ?? ''}
          onChange={(e) => { const v = e.target.value; cambiarContexto(() => { setBrandId(v); setSelProductos(new Set()) }) }}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {/* LA ÚNICA PREGUNTA. De aquí sale dónde se escribe, qué dice cada
            columna y a dónde publica el botón. No se vuelve a preguntar. */}
        <label className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45 ml-2">Dónde</label>
        <select className="border border-linea-fuerte rounded-lg px-3 py-1.5 text-sm font-semibold bg-white"
          value={locationId ?? ''}
          onChange={(e) => { const v = e.target.value || null; cambiarContexto(() => setLocationId(v)) }}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          {locations.length > 1 && <option value="">Los {locations.length} locales, el mismo precio</option>}
        </select>

        <div className="flex rounded-lg overflow-hidden border border-linea-fuerte ml-auto">
          {(['precio', 'margen'] as const).map((v) => (
            <button key={v} onClick={() => { setVista(v); setEdit(null) }}
              className={`px-3 py-1.5 text-xs font-semibold ${vista === v ? 'bg-tinta text-white' : 'bg-white text-tinta-45'}`}>
              {v === 'precio' ? 'Precio' : 'Margen neto'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando la marca entera…
        </div>
      )}
      {error && (
        <div className="mt-4 border border-danger/40 bg-danger-bg/40 rounded-lg p-3 text-sm">{error}</div>
      )}

      {grid && stats && (
        <>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-px bg-border-default border border-border-default rounded-xl overflow-hidden">
            <Stat k="Productos" v={String(stats.total)} n={`${grid.columns.length} columnas reales`} />
            <Stat k="Con precio propio" v={String(stats.propios)} n="celdas con precio fijado para ese canal" />
            <Stat k="En pérdida" v={String(stats.enPerdida)} n="celdas con margen neto negativo" danger={stats.enPerdida > 0} />
            <Stat k="Sin escandallo" v={String(stats.sinEscandallo)} n="su margen no se puede calcular: celdas vacías" />
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-tinta-45">
            <Gauge className="w-3.5 h-3.5" />
            <span>Carga <b className="tabular-nums text-tinta">{ms(totalMs)}</b></span>
            <span className="text-tinta-25">·</span>
            <span>llamada {ms(timings?.rpcMs)}</span>
            <span className="text-tinta-25">·</span>
            <span>transformar {ms(timings?.shapeMs)}</span>
            <span className="text-tinta-25">·</span>
            <span>pintar {ms(pintarMs)}</span>
            <button onClick={() => setVerTiempos((v) => !v)} className="underline underline-offset-2 hover:text-tinta">
              {verTiempos ? 'ocultar detalle' : 'ver detalle'}
            </button>
          </div>
          {verTiempos && timings && (
            <div className="mt-2 border border-linea-fuerte rounded-lg bg-lavado p-3 text-[11px] text-tinta-70 leading-relaxed max-w-4xl">
              <table className="tabular-nums">
                <tbody>
                  <tr><td className="pr-4 py-0.5">Llamada completa a <code>brand_price_grid</code></td><td className="font-semibold text-right">{ms(timings.rpcMs)}</td></tr>
                  <tr><td className="pr-4 py-0.5 pl-3">· hasta el primer byte (servidor + latencia)</td><td className="text-right">{ms(timings.ttfbMs)}</td></tr>
                  <tr><td className="pr-4 py-0.5 pl-3">· descarga del cuerpo</td><td className="text-right">{ms(timings.downloadMs)}</td></tr>
                  <tr><td className="pr-4 py-0.5">Filas crudas → rejilla (hilo principal)</td><td className="font-semibold text-right">{ms(timings.shapeMs)}</td></tr>
                  <tr><td className="pr-4 py-0.5">Pintar la tabla</td><td className="font-semibold text-right">{ms(pintarMs)}</td></tr>
                  <tr><td className="pr-4 py-0.5">Filas recibidas</td><td className="text-right">{timings.rows}</td></tr>
                  <tr><td className="pr-4 py-0.5">Tamaño del cuerpo JSON</td><td className="text-right">{timings.bytes === null ? '—' : `${Math.round(timings.bytes / 1024)} KB`}</td></tr>
                </tbody>
              </table>
              <p className="mt-2">
                Los dos renglones con sangría salen de la Resource Timing API y sólo hay número si el servidor
                manda <code>Timing-Allow-Origin</code>. Supabase, siendo otro origen, hoy no lo manda: por eso
                aparecen vacíos. <b>Un hueco es un dato; un cero sería mentira.</b>
              </p>
            </div>
          )}

          {grid.excluded.length > 0 && (
            <div className="mt-3 border border-border-default rounded-lg bg-card p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-tinta-70">
                <EyeOff className="w-3.5 h-3.5" />
                {grid.excluded.length} combinación(es) de canal y modalidad no se pintan
              </div>
              <ul className="mt-2 space-y-1">
                {grid.excluded.map((x, i) => (
                  <li key={i} className="text-xs text-text-secondary">
                    <b className="text-tinta">{x.channelName}
                      {x.serviceType ? ` · ${SERVICE_TYPE_LABEL[x.serviceType] ?? x.serviceType}` : ''}</b>
                    {' — '}{x.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* panel de operación en lote — AÑADE pendientes, no guarda */}
          <div className="mt-4 bg-card border border-border-default rounded-xl p-3 flex flex-wrap items-end gap-3">
            <Campo label="Categoría">
              <select className="border border-linea-fuerte rounded-lg px-2 py-1.5 text-sm bg-white"
                value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
                <option value="todas">Todas</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Campo>
            <Campo label="Canales">
              <div className="flex flex-wrap gap-1">
                {canales.map((c) => (
                  <button key={c.channelId}
                    onClick={() => setSelCanales((s) => {
                      const n = new Set(s)
                      if (n.has(c.channelId)) n.delete(c.channelId); else n.add(c.channelId)
                      return n
                    })}
                    className={`px-2 py-1 rounded-md text-xs font-semibold border ${selCanales.has(c.channelId)
                      ? 'bg-tinta text-white border-tinta' : 'bg-white text-tinta-70 border-linea-fuerte'}`}>
                    {c.channelName}
                  </button>
                ))}
              </div>
            </Campo>
            <Campo label="Operación">
              <div className="flex gap-1">
                <select className="border border-linea-fuerte rounded-lg px-2 py-1.5 text-sm bg-white"
                  value={opKind} onChange={(e) => setOpKind(e.target.value as BulkOp['kind'])}>
                  <option value="pct">% sobre el precio</option>
                  <option value="eur">€ por plato</option>
                  <option value="set">Fijar a</option>
                  <option value="base">Poner el precio base</option>
                </select>
                {opKind !== 'base' && (
                  <input className="border border-linea-fuerte rounded-lg px-2 py-1.5 text-sm w-24 tabular-nums"
                    value={opValor} onChange={(e) => setOpValor(e.target.value)} inputMode="decimal" />
                )}
              </div>
            </Campo>
            <Campo label="Redondeo">
              <select className="border border-linea-fuerte rounded-lg px-2 py-1.5 text-sm bg-white"
                value={escalera} onChange={(e) => setEscalera(e.target.value as Escalera)}>
                {(Object.keys(ESCALERA_LABEL) as Escalera[]).map((k) =>
                  <option key={k} value={k}>{ESCALERA_LABEL[k]}</option>)}
              </select>
            </Campo>
            <Campo label="Excluir">
              <div className="flex gap-3 text-xs text-tinta-70">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={excluirCombos} onChange={(e) => setExcluirCombos(e.target.checked)} /> Combos
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={excluirSinEscandallo} onChange={(e) => setExcluirSinEscandallo(e.target.checked)} /> Sin escandallo
                </label>
              </div>
            </Campo>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-tinta-45">{selProductos.size} producto(s) · {selCanales.size} canal(es)</span>
              <button onClick={aplicarLote} disabled={selProductos.size === 0 || selCanales.size === 0}
                className="px-3 py-2 rounded-lg border-2 border-tinta text-tinta text-sm font-semibold disabled:opacity-40">
                Añadir a pendientes
              </button>
            </div>
          </div>

          {aviso && (
            <pre className="mt-3 whitespace-pre-wrap border border-linea-fuerte rounded-lg bg-lavado p-3 text-xs text-tinta-70">{aviso}</pre>
          )}

          {vista === 'precio' && (
            <div className="mt-3 text-[11px] text-tinta-45">
              Pulsa cualquier precio para cambiarlo. <b>Enter</b> acepta y baja · <b>Tab</b> acepta y va a la derecha ·{' '}
              <b>salir de la celda</b> acepta también · <b>Esc</b> descarta esa edición. Para{' '}
              <b>volver al precio base</b>, deja el campo vacío. Las columnas con candado no se tocan desde{' '}
              aquí: ese precio no saldría de Folvy. Nada se escribe hasta pulsar <b>Guardar</b>.
            </div>
          )}

          {/* rejilla */}
          <div className="mt-2 bg-card border border-border-default rounded-xl overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left px-3 py-2.5 w-8">
                    <input type="checkbox"
                      checked={productosVisibles.length > 0 && productosVisibles.every((p) => selProductos.has(p.menuItemId))}
                      onChange={(e) => setSelProductos(e.target.checked
                        ? new Set(productosVisibles.map((p) => p.menuItemId)) : new Set())} />
                  </th>
                  <th className="text-left px-2 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-tinta-45">Producto</th>
                  <th className="text-right px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-tinta-45">Base</th>
                  {vista === 'precio'
                    ? canales.map((c) => (
                        // §4.1 — DEBAJO DEL NOMBRE, SI LLEGA. Es el dato que
                        // faltaba: la ruta es por local y hasta hoy no se miraba.
                        <th key={c.channelId} className="text-right px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-tinta-45 whitespace-nowrap align-top">
                          {c.channelName}
                          <span className={`block normal-case tracking-normal font-medium mt-0.5 ${
                            c.ruta.kind === 'folvy' ? 'text-success'
                              : c.ruta.kind === 'interno' ? 'text-tinta-25'
                              : 'text-warning'}`}>
                            {ROUTE_LABEL[c.ruta.kind]}
                          </span>
                          {ROUTE_NOTA[c.ruta.kind] && (
                            <span className="block normal-case tracking-normal font-normal text-tinta-25">
                              {ROUTE_NOTA[c.ruta.kind]}
                            </span>
                          )}
                        </th>))
                    : grid.columns.map((c) => (
                        <th key={c.key} className="text-right px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-tinta-45 whitespace-nowrap">
                          {c.channelName}<br />
                          <span className="text-tinta-25 normal-case tracking-normal">
                            {c.serviceType ? SERVICE_TYPE_LABEL[c.serviceType] ?? c.serviceType : 'Mostrador'}
                          </span>
                        </th>))}
                </tr>
              </thead>
              <tbody>
                {secciones.map((sec) => (
                  <Fragment key={sec.categoryId ?? 'sin-categoria'}>
                    <tr className="bg-lavado border-y border-linea-fuerte">
                      <td colSpan={3 + nCols} className="px-3 py-1.5">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[11px] uppercase tracking-wider font-semibold text-tinta-70">{sec.categoryName}</span>
                          <span className="text-[10px] text-tinta-45">{sec.products.length} producto(s)</span>
                          {sec.categoryId === null && (
                            <span className="text-[10px] text-tinta-45">
                              · sin categoría en la carta: ninguna selección por categoría los alcanza
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {sec.products.map((p) => (
                      <tr key={p.menuItemId} className="border-b border-border-default/60 hover:bg-lavado/40">
                        <td className="px-3 py-2 align-top">
                          <input type="checkbox" checked={selProductos.has(p.menuItemId)}
                            onChange={() => setSelProductos((s) => {
                              const n = new Set(s)
                              if (n.has(p.menuItemId)) n.delete(p.menuItemId); else n.add(p.menuItemId)
                              return n
                            })} />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="text-sm font-semibold leading-tight">{p.name}</div>
                          <div className="text-[11px] text-tinta-45 mt-0.5">
                            {p.categoryName ?? 'Sin categoría'}
                            {p.productType === 'combo' && ' · combo'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right align-top tabular-nums text-sm font-semibold">{eur(p.basePrice)}</td>

                        {vista === 'precio'
                          ? canales.map((c) => {
                              const cell = grid.cells.get(cellKey(p.menuItemId, c.cols[0].key))
                              if (!cell) return <td key={c.channelId} className="px-3 py-2" />
                              // §4.1 — si Folvy no lo controla, la UI degrada en
                              // vez de ofrecer un botón que no cumple. Se enseña
                              // el precio que hay (es un dato) pero no se teclea.
                              if (!c.editable) {
                                return (
                                  <td key={c.channelId} className="px-3 py-2 text-right align-top bg-lavado/60">
                                    <div className="tabular-nums text-sm text-tinta-25">{eur(cell.price)}</div>
                                    <div className="text-[10px] text-tinta-45 mt-0.5 flex items-center justify-end gap-1">
                                      <Lock className="w-2.5 h-2.5" />
                                      {c.ruta.kind === 'last' ? 'en Last' : 'no se publica'}
                                    </div>
                                  </td>
                                )
                              }
                              const editando = edit?.itemId === p.menuItemId && edit?.channelId === c.channelId
                              if (editando) {
                                return (
                                  <td key={c.channelId} className="px-2 py-2 text-right align-top">
                                    <input
                                      autoFocus
                                      value={edit.valor}
                                      inputMode="decimal"
                                      aria-label={`Precio de ${p.name} en ${c.channelName}`}
                                      onChange={(e) => setEdit({ ...edit, valor: e.target.value })}
                                      // Salir de la celda ACEPTA, igual que Enter. Es el gesto más
                                      // frecuente de todos y antes no tenía regla, que es de donde
                                      // salía «si te sales de la celda no lo guarda». Lee el DOM y
                                      // no el estado: el estado puede ir un render por detrás.
                                      onBlur={(e) => { aceptarEdicion(e.target.value, p.menuItemId, c.channelId) }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); mover('abajo') }
                                        else if (e.key === 'Tab') { e.preventDefault(); mover('derecha') }
                                        else if (e.key === 'Escape') {
                                          // Devolver la semilla al campo deja esa celda como estaba
                                          // y hace inocuo el onBlur del desmontaje. Los demás
                                          // pendientes no se tocan.
                                          e.preventDefault()
                                          e.currentTarget.value = edit.semilla
                                          setEdit(null); setAviso(null)
                                        }
                                      }}
                                      className="w-24 border-2 border-tinta rounded-md px-2 py-1 text-sm text-right tabular-nums font-semibold"
                                    />
                                    <div className="text-[10px] text-tinta-45 mt-0.5">con IVA · vacío = el precio base</div>
                                  </td>
                                )
                              }
                              const pend = pendientes.get(pKey(p.menuItemId, c.channelId))
                              const propio = cell.priceSource === 'override'
                              const mostrado = precioMostrado(p.menuItemId, c.channelId, cell.price, p.basePrice)
                              return (
                                <td key={c.channelId} className="px-3 py-2 text-right align-top relative">
                                  {propio && !pend && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-tinta rounded" />}
                                  <button
                                    type="button"
                                    onClick={() => abrirCelda(p.menuItemId, c.channelId, cell.price)}
                                    title="Pulsa para cambiar el precio"
                                    className={`w-full text-right rounded px-1 -mx-1 focus:outline-none focus:ring-2 focus:ring-tinta/40 ${
                                      pend ? 'border-2 border-dashed border-tinta bg-tinta/5 py-0.5' : 'hover:bg-tinta/5'}`}>
                                    <div className={`tabular-nums text-sm ${
                                      pend ? 'font-bold text-tinta' : propio ? 'font-semibold text-tinta' : 'font-normal text-tinta-25'}`}>
                                      {pend?.accion === 'clear' ? 'el base' : eur(mostrado)}
                                    </div>
                                    {pend ? (
                                      <>
                                        <div className="text-[10px] mt-0.5 font-bold uppercase tracking-wide text-tinta flex items-center justify-end gap-1">
                                          <Pencil className="w-2.5 h-2.5" /> pendiente
                                        </div>
                                        <div className="text-[10px] text-tinta-45 line-through tabular-nums">{eur(pend.precioAntes)}</div>
                                      </>
                                    ) : (
                                      <div className={`text-[10px] mt-0.5 ${propio ? 'text-tinta font-semibold uppercase tracking-wide' : 'text-tinta-25'}`}>
                                        {propio
                                          ? (cell.isLocationOverride ? `sólo en ${dondeNombre}` : 'precio de la carta')
                                          : 'igual que el base'}
                                      </div>
                                    )}
                                  </button>
                                </td>)
                            })
                          : grid.columns.map((c) => {
                              const cell = grid.cells.get(cellKey(p.menuItemId, c.key))
                              if (!cell) return <td key={c.key} className="px-3 py-2" />
                              const b = bandaDe(cell.netMarginPct)
                              return (
                                <td key={c.key} className="px-3 py-2 text-right align-top">
                                  <div className={`tabular-nums text-sm ${BANDA_CLASE[b]}`}>
                                    {b === 'sin_dato' ? '' : pct(cell.netMarginPct)}
                                  </div>
                                  <div className="text-[10px] text-tinta-25 mt-0.5">
                                    {b === 'sin_dato' ? 'sin escandallo' : eur(cell.price)}
                                  </div>
                                </td>)
                            })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-[11px] text-tinta-45 leading-relaxed max-w-4xl">
            El precio es <b>uno por canal</b>: en Glovo, el mismo importe deja un margen muy distinto con reparto
            propio que en recogida, y por eso el margen se abre por modalidad y el precio no.
            Las celdas de margen vacías son productos <b>sin escandallo</b> — un 0 % ahí sería mentira.
            Bandas: <b>pierde</b> por debajo de 0 %, <b>aprieta</b> hasta {BANDA_APRIETA_HASTA} %, <b>sano</b> por encima.
          </div>
        </>
      )}

      {/* ── BARRA DE GUARDADO — SIEMPRE presente mientras hay rejilla ──────────
          Nunca aparece y desaparece según la celda: con 0 cambios sigue ahí,
          con los botones apagados. Que un botón de guardar vaya y venga fue
          justo lo que hizo el sistema impredecible. */}
      {grid && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-linea-fuerte bg-card/95 backdrop-blur px-4 py-2.5">
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center gap-3">
            <div className="text-sm">
              <b className={hayPendientes ? 'text-tinta' : 'text-tinta-45'}>
                {hayPendientes ? `${pendientes.size} cambio(s) pendiente(s)` : 'Sin cambios pendientes'}
              </b>
              {/* DÓNDE, donde se mira antes de escribir. */}
              <span className="text-text-secondary"> · se guardarán en <b className="text-tinta">{dondeNombre}</b></span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {ultimaOperacion && (
                <button onClick={deshacer} disabled={saving}
                  className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold flex items-center gap-1.5">
                  <Undo2 className="w-3.5 h-3.5" /> Deshacer lo guardado
                </button>
              )}
              <button onClick={descartarTodo} disabled={!hayPendientes}
                className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold disabled:opacity-40">
                Descartar
              </button>
              <button onClick={construirPreview} disabled={!hayPendientes || previewing}
                className="px-4 py-2 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-40">
                {previewing ? 'Calculando…' : `Guardar${hayPendientes ? ` ${pendientes.size}` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── §4.3 · CAMBIAR Y PUBLICAR SON UN SOLO BOTÓN ───────────────────────
          Nadie tiene que saber que existen dos actos. Al guardar, la pantalla
          dice qué falta, a qué canales llega y a cuáles no —con el motivo— y
          ofrece las dos salidas. El botón publica EL MISMO sitio que la
          pantalla enseña arriba: sale de la misma `locationId`. */}
      {trasGuardar && (
        <div className="fixed inset-0 bg-tinta/40 flex items-center justify-center p-4 z-[55]" onClick={() => setTrasGuardar(null)}>
          <div className="bg-card rounded-xl max-w-lg w-full p-4" onClick={(e) => e.stopPropagation()}>
            {!resultadoPublicar ? (
              <>
                <div className="font-semibold flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  {trasGuardar.celdas} precio{trasGuardar.celdas === 1 ? '' : 's'} cambiado{trasGuardar.celdas === 1 ? '' : 's'} en{' '}
                  {brands.find((b) => b.id === brandId)?.name ?? ''} · {dondeNombre}
                </div>
                <div className="text-sm text-text-secondary mt-2 space-y-1">
                  {canalesQuePublican.length > 0 ? (
                    <p>
                      Se publicarán en{' '}
                      <b className="text-tinta">{canalesQuePublican.map((c) => c.channelName).join(' y ')}</b>.
                    </p>
                  ) : (
                    <p>De aquí <b className="text-tinta">no sale nada a ninguna plataforma</b>.</p>
                  )}
                  {canalesQueNo.map((c) => (
                    <p key={c.channelId}>
                      <b className="text-tinta">{c.channelName} no</b>:{' '}
                      {c.ruta.kind === 'last' ? 'se gestiona en Last.' : 'no se publica desde Folvy.'}
                    </p>
                  ))}
                  {ultimaOperacion && (
                    <p className="text-xs text-tinta-45 pt-1">
                      Guardado como una sola operación ({ultimaOperacion.slice(0, 8)}): se puede deshacer entera.
                    </p>
                  )}
                </div>
                <div className="mt-4 flex justify-end gap-2 flex-wrap">
                  <button onClick={() => setTrasGuardar(null)}
                    className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold">
                    Dejarlo guardado sin publicar
                  </button>
                  <button onClick={publicarAhora} disabled={publicando || canalesQuePublican.length === 0}
                    title={canalesQuePublican.length === 0 ? 'Ningún canal de este local publica desde Folvy' : `Publica en ${dondeNombre}`}
                    className="px-4 py-2 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
                    {publicando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {publicando ? 'Publicando…' : 'Publicar ahora'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold flex items-center gap-2">
                  {resultadoPublicar.ok
                    ? <><Check className="w-4 h-4 text-success" /> Publicado en {dondeNombre}</>
                    : <><AlertTriangle className="w-4 h-4 text-danger" /> No se pudo publicar</>}
                </div>
                {resultadoPublicar.error && (
                  <p className="text-sm text-danger mt-2">{resultadoPublicar.error}</p>
                )}
                <ul className="text-sm text-text-secondary mt-2 space-y-1">
                  {resultadoPublicar.targets.map((t, i) => (
                    <li key={i}>
                      {t.connection_name || '(sin nombre)'} — <b className={t.status === 'ok' ? 'text-success' : 'text-danger'}>{t.status}</b>
                      {t.error_text ? `: ${t.error_text}` : ''}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => { setTrasGuardar(null); setResultadoPublicar(null) }}
                    className="px-3 py-2 rounded-lg bg-tinta text-white text-sm font-semibold">Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* aviso de salida con pendientes */}
      {salidaPendiente !== null && (
        <div className="fixed inset-0 bg-tinta/40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-card rounded-xl max-w-md w-full p-4">
            <div className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" /> Tienes {pendientes.size} cambio(s) sin guardar
            </div>
            <p className="text-sm text-text-secondary mt-2">
              Son cambios de precio en <b>{dondeNombre}</b> que todavía no se han escrito. Si sales ahora se pierden.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { const d = salidaPendiente; setPendientes(new Map()); setSalidaPendiente(null); navigate(d) }}
                className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold">
                Salir y perderlos
              </button>
              <button onClick={() => setSalidaPendiente(null)} className="px-3 py-2 rounded-lg bg-tinta text-white text-sm font-semibold">
                Quedarme
              </button>
            </div>
          </div>
        </div>
      )}

      {/* previsualización */}
      {preview && (
        <div className="fixed inset-0 bg-tinta/40 flex items-center justify-center p-4 z-50" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-xl max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border-default flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold">
                  Vas a guardar {preview.length} cambio(s) en <span className="underline decoration-2">{dondeNombre}</span>
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  El margen se abre por modalidad: el mismo precio puede mejorar la recogida y hundir el reparto.
                  El porcentaje es el <b>real tras redondear</b>.
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="p-1"><X className="w-4 h-4" /></button>
            </div>

            {enPerdida > 0 && (
              <label className="mx-4 mt-3 border border-danger/50 bg-danger-bg/50 rounded-lg p-3 text-sm flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={asumoPerdida} onChange={(e) => setAsumoPerdida(e.target.checked)} />
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                  <span>
                    <b>{enPerdida} celda(s) quedarían por debajo de 0 % de margen.</b> Puede ser lo que quieres —un
                    producto gancho— pero no puede pasar por descuido: marca la casilla para poder guardar.
                  </span>
                </span>
              </label>
            )}

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-tinta-45">
                    <th className="text-left py-2">Producto</th><th className="text-left">Canal</th>
                    <th className="text-right">Precio</th><th className="text-right">% real</th>
                    <th className="text-left pl-4">Margen por modalidad</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-border-default/60 align-top">
                      <td className="py-2 pr-2">{r.producto}</td>
                      <td className="pr-2 text-tinta-70">{r.canal}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        <span className="text-tinta-45">{eur(r.precioAntes)}</span> →{' '}
                        <b>{r.accion === 'clear'
                          ? (r.precioDespues === null ? 'el precio base' : `${eur(r.precioDespues)} (el base)`)
                          : eur(r.precioDespues)}</b>
                      </td>
                      <td className="text-right tabular-nums">{r.pctRealAplicado === null ? '' : pct(r.pctRealAplicado)}</td>
                      <td className="pl-4">
                        {!r.costAvailable ? <span className="text-tinta-25 text-xs">sin escandallo</span> : (
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                            {r.modalidades.map((m) => (
                              <span key={m.key} className="text-xs whitespace-nowrap">
                                <span className="text-tinta-45">{m.label}: </span>
                                <span className="tabular-nums text-tinta-45">{pct(m.antes)}</span>
                                {' → '}
                                <b className={`tabular-nums ${BANDA_CLASE[bandaDe(m.despues)]}`}>
                                  {m.despues === null ? '—' : pct(m.despues)}
                                </b>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-border-default flex items-center justify-between gap-2">
              <div className="text-xs text-text-secondary">
                Se escribe <b>una sola operación</b> con {preview.length} entrada(s): se puede deshacer entera.
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPreview(null)} className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold">Cancelar</button>
                <button onClick={guardar} disabled={saving || !puedeGuardar}
                  className="px-4 py-2 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> {saving ? 'Guardando…' : `Guardar en ${dondeNombre}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ k, v, n, danger }: { k: string; v: string; n: string; danger?: boolean }) {
  return (
    <div className="bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45">{k}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${danger ? 'text-danger' : ''}`}>{v}</div>
      <div className="text-[11px] text-tinta-45 mt-0.5 leading-snug">{n}</div>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45 mb-1">{label}</div>
      {children}
    </div>
  )
}
