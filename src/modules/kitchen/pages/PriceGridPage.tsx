// src/modules/kitchen/pages/PriceGridPage.tsx
//
// REJILLA DE PRECIOS — una marca por pantalla, todos sus precios por canal.
// Se audita y se corrige aquí, sin abrir un modal por producto.
//
// ── TRES COSAS QUE GOBIERNAN ESTA PANTALLA ─────────────────────────────────
//
// 1. EL PRECIO ES CON IVA, SIEMPRE. Es lo que paga el cliente. `price` de la
//    RPC ya lo es desde el arreglo del 17/08; no se convierte nada.
//
// 2. EL PRECIO ES POR CANAL; EL MARGEN, POR CANAL × MODALIDAD. menu_item_override
//    tiene channel_id y NO service_type: hay UN precio por canal. Pero el mismo
//    1,90 € en Glovo deja −7,1 % con reparto propio y +63,0 % en recogida. Por
//    eso la vista de PRECIO tiene una columna por canal (pintar el mismo número
//    dos veces sugeriría dos precios que no existen) y la de MARGEN una por
//    canal × modalidad, que es donde está la diferencia que decide una oferta.
//    Al editar UNA celda se enseñan TODAS las modalidades de ese canal por lo
//    mismo: tocar el precio de Glovo mueve a la vez su reparto y su recogida,
//    y pueden ir en direcciones opuestas.
//
// 3. LAS COMBINACIONES IMPOSIBLES NO SE PINTAN. El servidor las marca; aquí se
//    listan aparte con su motivo. La que importa: uber/reparto propio da el
//    mejor margen de la pantalla y no puede ocurrir — Uber siempre reparte Uber.
//
// Sin escandallo ⇒ celda de margen VACÍA. Nunca 0 %: sería mentira.
// El color sólo es dinero (el trío del margen). Heredado/propio se distinguen
// por peso, gris y filete — sistema visual v1, igual que el modal.
//
// ── BLOQUEAR EN LOTE, AVISAR EN UNA CELDA (encargo del 18/08, punto 1) ──────
// En una operación de decenas de celdas, una que caiga por debajo de 0 % se
// BLOQUEA: nadie las mira de una en una y un error se cuela entero. En una
// edición de UNA celda se avisa fuerte y se pide confirmación explícita, pero
// NO se bloquea: un producto gancho a pérdida es una decisión legítima cuando
// se toma mirando ese producto. Bloquearla obligaría a rodear la pantalla, y
// rodear la herramienta es peor que la herramienta.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Table2, AlertTriangle, Undo2, EyeOff, Loader2, Check, X, FlaskConical, Gauge } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { supabase } from '@/lib/supabase'
import type { Brand } from '@/types/multitenancy'
import {
  getBrandPriceGrid, applyPriceOperation, revertPriceOperation, getAccountIsInternal,
  getBrandMenuOrder, agruparPorCarta,
  bandaDe, BANDA_APRIETA_HASTA, redondear, precioObjetivo, pctReal, leerPrecio, expectedPriceBefore,
  cellKey, SERVICE_TYPE_LABEL, ESCALERA_LABEL,
  type PriceGrid, type GridColumn, type GridTimings, type MenuOrder, type Escalera, type BulkOp,
  type OperationEntry, type Banda,
} from '@/modules/kitchen/services/priceGridService'

const eur = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' :
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(v)
const pct = (v: number | null | undefined, dp = 1): string =>
  // eslint-disable-next-line no-restricted-syntax -- el null ya está descartado en la rama de arriba
  v === null || v === undefined ? '' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(dp)} %`
const ms = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('es-ES').format(v)} ms`

const BANDA_CLASE: Record<Banda, string> = {
  pierde:   'text-danger font-semibold',
  aprieta:  'text-warning font-semibold',
  sano:     'text-success font-semibold',
  sin_dato: 'text-tinta-25',
}

interface PreviewRow {
  menuItemId: string; producto: string
  channelId: string; canal: string
  precioAntes: number; precioDespues: number; pctRealAplicado: number | null
  margenAntes: number | null; margenDespues: number | null
  costAvailable: boolean
  bloqueado: boolean          // caería por debajo de 0 %
  avisado: boolean            // entra en "aprieta"
}

/** Lo que se enseña ANTES de guardar una edición de una sola celda. */
interface CellPreview {
  itemId: string; producto: string
  channelId: string; canal: string
  accion: 'set' | 'clear'
  precioAntes: number
  precioDespues: number | null      // null = vuelve a heredado y no se sabe aún
  expectedBefore: number | null
  /** Una entrada por modalidad del canal: es donde el margen diverge. */
  modalidades: Array<{ key: string; label: string; antes: number | null; despues: number | null }>
  costAvailable: boolean
  quedaEnPerdida: boolean
  nota: string | null
}

export default function PriceGridPage() {
  const { activeAccountId } = useActiveAccount()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([])
  const [locationId, setLocationId] = useState<string | null>(null)   // null = ámbito cuenta
  const [cuentaInterna, setCuentaInterna] = useState(false)

  const [grid, setGrid] = useState<PriceGrid | null>(null)
  const [orden, setOrden] = useState<MenuOrder | null>(null)
  // `loading` es DERIVADO, no un estado aparte: llamar a setState en el cuerpo
  // de un efecto encadena renders (react-hooks/set-state-in-effect). Comparar
  // "lo que se pidió" con "lo que hay cargado" dice lo mismo y además es más
  // honesto: la rejilla se ve gris en cuanto cambias de marca, no cuando
  // responde la red.
  const [cargadoPara, setCargadoPara] = useState<string | null>(null)
  const [timings, setTimings] = useState<GridTimings | null>(null)
  const [pintarMs, setPintarMs] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [verTiempos, setVerTiempos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [vista, setVista] = useState<'precio' | 'margen'>('precio')

  // selección
  const [selProductos, setSelProductos] = useState<Set<string>>(new Set())
  const [selCanales, setSelCanales] = useState<Set<string>>(new Set())
  const [filtroCat, setFiltroCat] = useState<string>('todas')   // 'todas' | 'sin' | categoryId

  // operación en lote
  const [opKind, setOpKind] = useState<BulkOp['kind']>('pct')
  const [opValor, setOpValor] = useState<string>('10')
  const [escalera, setEscalera] = useState<Escalera>('decena')
  const [excluirCombos, setExcluirCombos] = useState(true)
  const [excluirSinEscandallo, setExcluirSinEscandallo] = useState(false)

  // previsualización / guardado
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ultimaOperacion, setUltimaOperacion] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // edición directa de una celda (encargo del 18/08, punto 1)
  const [edit, setEdit] = useState<{ itemId: string; channelId: string; valor: string } | null>(null)
  const [cellPrev, setCellPrev] = useState<CellPreview | null>(null)
  const [cellBusy, setCellBusy] = useState(false)
  const [asumoPerdida, setAsumoPerdida] = useState(false)
  // Tab guarda y sigue: aquí queda apuntada la celda a la que saltar después.
  // Estado y no ref: un ref leído desde algo alcanzable en render es
  // exactamente lo que prohíbe react-hooks/refs, y aquí no hace falta.
  const [saltoTrasGuardar, setSaltoTrasGuardar] = useState<{ itemId: string; channelId: string } | null>(null)

  // ── carga de marcas, locales y bandera de cuenta interna ───
  useEffect(() => {
    if (!activeAccountId) return
    listBrands({ accountId: activeAccountId })
      .then((bs) => { setBrands(bs); setBrandId((prev) => prev ?? bs[0]?.id ?? null) })
      .catch((e) => setError(String(e)))
    supabase?.from('locations').select('id, name').eq('account_id', activeAccountId).order('name')
      .then(({ data }) => setLocations((data ?? []) as Array<{ id: string; name: string }>))
    getAccountIsInternal(activeAccountId).then(setCuentaInterna).catch(() => setCuentaInterna(false))
  }, [activeAccountId])

  // ── carga de la rejilla ───
  // La rejilla entera en UNA llamada; el orden de carta va EN PARALELO, así que
  // no suma a la espera (dos consultas de ids + position, ~240 filas en total).
  const claveCarga = `${brandId ?? ''}::${locationId ?? ''}::${reloadKey}`
  const loading = brandId !== null && cargadoPara !== claveCarga

  useEffect(() => {
    if (!brandId) return
    let vivo = true
    const t0 = performance.now()
    const clave = `${brandId}::${locationId ?? ''}::${reloadKey}`

    // El orden es COSMÉTICO: si falla, la rejilla se pinta igual (alfabética).
    // Nunca puede tumbar la pantalla.
    getBrandMenuOrder(brandId)
      .then((o) => { if (vivo) setOrden(o) })
      .catch(() => { if (vivo) setOrden(null) })

    getBrandPriceGrid(brandId, locationId)
      .then(({ grid: g, timings: t }) => {
        if (!vivo) return
        setError(null); setPreview(null); setEdit(null); setCellPrev(null)
        const tEstado = performance.now()
        setGrid(g); setTimings(t)
        setTotalMs(Math.round(tEstado - t0))
        setCargadoPara(clave)
        // Lo que tarda React en pintar 27 × N celdas se mide DESPUÉS del pintado,
        // no antes: es la única parte del desglose que no se puede cronometrar
        // desde dentro del `then`.
        requestAnimationFrame(() => {
          if (vivo) setPintarMs(Math.round(performance.now() - tEstado))
        })
      })
      .catch((e) => {
        if (!vivo) return
        setError(e instanceof Error ? e.message : String(e))
        setCargadoPara(clave)
      })
    return () => { vivo = false }
  }, [brandId, locationId, reloadKey])

  // ── columnas ───
  // Precio: una por CANAL (hay un precio por canal, no por modalidad).
  // Margen: una por canal × modalidad (es donde divergen).
  const canales = useMemo(() => {
    if (!grid) return [] as Array<{ channelId: string; channelName: string; cols: GridColumn[] }>
    const m = new Map<string, { channelId: string; channelName: string; cols: GridColumn[] }>()
    for (const c of grid.columns) {
      const e = m.get(c.channelId)
      if (e) e.cols.push(c)
      else m.set(c.channelId, { channelId: c.channelId, channelName: c.channelName, cols: [c] })
    }
    return Array.from(m.values())
  }, [grid])

  // ── bloques de carta (punto 1-bis) ───
  // La marca se lee en el orden en que la ve el cliente, agrupada por
  // categoría. El desplegable «Categoría» sale de los MISMOS bloques: elegir
  // "Entrantes" deja de ser a ciegas porque ese bloque se ve en la tabla.
  const todasLasSecciones = useMemo(
    () => (grid ? agruparPorCarta(grid.products, orden) : []),
    [grid, orden])

  const categorias = useMemo(
    () => todasLasSecciones.map((sec) => ({ id: sec.categoryId ?? 'sin', name: sec.categoryName })),
    [todasLasSecciones])

  const secciones = useMemo(() => {
    if (filtroCat === 'todas') return todasLasSecciones
    if (filtroCat === 'sin') return todasLasSecciones.filter((sec) => sec.categoryId === null)
    return todasLasSecciones.filter((sec) => sec.categoryId === filtroCat)
  }, [todasLasSecciones, filtroCat])

  // Plana, para la selección en lote y los contadores: es la misma lista.
  const productosVisibles = useMemo(
    () => secciones.flatMap((sec) => sec.products), [secciones])

  // ── titulares ───
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

  // ══ EDICIÓN DIRECTA DE UNA CELDA ═══════════════════════════════════════════

  const cancelarEdicion = useCallback(() => {
    // Esc no escribe NADA: ni override, ni operación, ni historial.
    setEdit(null); setCellPrev(null); setAsumoPerdida(false); setAviso(null)
    setSaltoTrasGuardar(null)
  }, [])

  function abrirCelda(itemId: string, channelId: string, precioActual: number) {
    setCellPrev(null); setAsumoPerdida(false); setAviso(null)
    // El campo nace con el precio EFECTIVO que la celda enseñaba, con IVA.
    setEdit({ itemId, channelId, valor: precioActual.toString().replace('.', ',') })
  }

  /**
   * Enter (o Tab con el valor cambiado): pide al SERVIDOR los márgenes de todas
   * las modalidades del canal con el precio nuevo. No se calcula nada aquí.
   */
  async function previsualizarCelda() {
    if (!edit || !grid || !brandId) return
    const prod = grid.products.find((p) => p.menuItemId === edit.itemId)
    const ch = canales.find((c) => c.channelId === edit.channelId)
    if (!prod || !ch) return
    const ref = grid.cells.get(cellKey(edit.itemId, ch.cols[0].key))
    if (!ref) return

    const leido = leerPrecio(edit.valor)
    if (Number.isNaN(leido)) { setAviso('Eso no es un precio. Escribe un número, por ejemplo 9,90.'); return }

    const esOverrideAqui = ref.priceSource === 'override' && (locationId ? ref.isLocationOverride : true)

    // ── vaciar = volver a heredado ───
    if (leido === null) {
      if (!esOverrideAqui) {
        setAviso(locationId
          ? 'Esta celda ya hereda: no hay precio propio DE ESTE LOCAL que borrar.'
          : 'Esta celda ya hereda del precio base: no hay nada que borrar.')
        return
      }
      setCellPrev({
        itemId: edit.itemId, producto: prod.name,
        channelId: edit.channelId, canal: ch.channelName,
        accion: 'clear',
        precioAntes: ref.price,
        // En ámbito CUENTA el precio al que vuelve es el base, y se conoce.
        // En ámbito LOCAL vuelve al precio de marca, que esta rejilla no trae:
        // no se inventa un número ni un margen.
        precioDespues: locationId ? null : (prod.basePrice ?? null),
        expectedBefore: expectedPriceBefore(ref),
        modalidades: [],
        costAvailable: ref.costAvailable,
        quedaEnPerdida: false,
        nota: locationId
          ? 'Vuelve al precio de marca. El margen se recalcula al guardar.'
          : 'Vuelve al precio base de la carta.',
      })
      return
    }

    if (Math.abs(leido - ref.price) < 0.005) { setAviso('Ese ya es el precio de la celda.'); return }

    setCellBusy(true); setAviso(null)
    try {
      // El margen NUNCA se recalcula aquí: se le pide al servidor con p_overrides.
      const { grid: conPreview } = await getBrandPriceGrid(
        brandId, locationId, { [edit.itemId]: { [edit.channelId]: leido } })

      const modalidades = ch.cols.map((c) => {
        const antes = grid.cells.get(cellKey(edit.itemId, c.key))
        const desp = conPreview.cells.get(cellKey(edit.itemId, c.key))
        return {
          key: c.key,
          label: c.serviceType ? SERVICE_TYPE_LABEL[c.serviceType] ?? c.serviceType : 'Mostrador',
          antes: antes?.netMarginPct ?? null,
          despues: desp?.netMarginPct ?? null,
        }
      })
      setCellPrev({
        itemId: edit.itemId, producto: prod.name,
        channelId: edit.channelId, canal: ch.channelName,
        accion: 'set',
        precioAntes: ref.price, precioDespues: leido,
        expectedBefore: expectedPriceBefore(ref),
        modalidades,
        costAvailable: ref.costAvailable,
        // Sin escandallo NO hay pérdida que avisar: no se sabe.
        quedaEnPerdida: ref.costAvailable && modalidades.some((m) => m.despues !== null && m.despues < 0),
        nota: null,
      })
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setCellBusy(false) }
  }

  /** Guarda la celda por apply_price_operation, con UNA entrada. Reversible. */
  async function guardarCelda() {
    if (!cellPrev || !activeAccountId) return
    if (cellPrev.quedaEnPerdida && !asumoPerdida) return
    setCellBusy(true); setAviso(null)
    try {
      const entry: OperationEntry = {
        menu_item_id: cellPrev.itemId,
        channel_id: cellPrev.channelId,
        location_id: locationId,
        action: cellPrev.accion,
        ...(cellPrev.accion === 'clear' ? {} : { price: cellPrev.precioDespues as number }),
        // Si la carta cambió por debajo entre abrir la celda y guardar, el RPC
        // aborta y el conflicto se ENSEÑA. No se pisa el trabajo de nadie.
        expected_price_before: cellPrev.expectedBefore,
      }
      const opId = await applyPriceOperation({
        accountId: activeAccountId,
        scope: {
          marca: brands.find((b) => b.id === brandId)?.name ?? brandId,
          ambito: locationId ? (locations.find((l) => l.id === locationId)?.name ?? locationId) : 'cuenta',
          canales: [cellPrev.canal],
          producto: cellPrev.producto,
          operacion: cellPrev.accion === 'clear'
            ? 'volver a heredado'
            : `fijar a ${cellPrev.precioDespues} €`,
          origen: 'edición directa',
        },
        entries: [entry],
        note: `Edición directa · ${cellPrev.producto} · ${cellPrev.canal}`,
      })
      setUltimaOperacion(opId)
      const salto = saltoTrasGuardar
      setEdit(null); setCellPrev(null); setAsumoPerdida(false)
      setSaltoTrasGuardar(null)
      setReloadKey((k) => k + 1)
      setAviso(`Guardado. Operación ${opId.slice(0, 8)} — se puede deshacer.`)
      if (salto) setEdit({ itemId: salto.itemId, channelId: salto.channelId, valor: '' })
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setCellBusy(false) }
  }

  /**
   * Tab: nunca se sale de una celda con un cambio sin confirmar.
   *  - valor intacto  -> salta a la siguiente celda editable de la fila.
   *  - valor cambiado -> se comporta como Enter y, tras guardar, salta.
   */
  function tabular(e: React.KeyboardEvent) {
    if (!edit || !grid) return
    const ref = grid.cells.get(cellKey(edit.itemId, canales.find((c) => c.channelId === edit.channelId)?.cols[0].key ?? ''))
    const i = canales.findIndex((c) => c.channelId === edit.channelId)
    const sig = canales[i + 1] ?? null
    const leido = leerPrecio(edit.valor)
    const intacto = ref !== undefined && leido !== null && !Number.isNaN(leido) && Math.abs(leido - ref.price) < 0.005

    e.preventDefault()
    if (intacto) {
      if (!sig) { cancelarEdicion(); return }
      const celdaSig = grid.cells.get(cellKey(edit.itemId, sig.cols[0].key))
      setCellPrev(null); setAsumoPerdida(false)
      setEdit({ itemId: edit.itemId, channelId: sig.channelId, valor: (celdaSig?.price ?? 0).toString().replace('.', ',') })
      return
    }
    setSaltoTrasGuardar(sig ? { itemId: edit.itemId, channelId: sig.channelId } : null)
    void previsualizarCelda()
  }

  // ══ OPERACIÓN EN LOTE ══════════════════════════════════════════════════════

  async function construirPreview() {
    if (!grid || !brandId) return
    setAviso(null)
    const op: BulkOp =
      opKind === 'base' ? { kind: 'base' } : { kind: opKind, value: Number(opValor.replace(',', '.')) }
    if (op.kind !== 'base' && !Number.isFinite(op.value)) { setAviso('El valor de la operación no es un número.'); return }

    const objetivo = new Map<string, number | null>()   // `${itemId}::${channelId}` -> precio o null(=volver a base)
    const overrides: Record<string, Record<string, number>> = {}

    for (const p of productosVisibles) {
      if (!selProductos.has(p.menuItemId)) continue
      if (excluirCombos && p.productType === 'combo') continue
      for (const ch of canales) {
        if (!selCanales.has(ch.channelId)) continue
        const ref = grid.cells.get(cellKey(p.menuItemId, ch.cols[0].key))
        if (!ref) continue
        if (excluirSinEscandallo && !ref.costAvailable) continue
        const bruto = precioObjetivo(ref.price, op)
        if (bruto === null) { objetivo.set(`${p.menuItemId}::${ch.channelId}`, null); continue }
        const fin = redondear(bruto, ref.price, escalera)
        objetivo.set(`${p.menuItemId}::${ch.channelId}`, fin)
        overrides[p.menuItemId] = { ...(overrides[p.menuItemId] ?? {}), [ch.channelId]: fin }
      }
    }
    if (objetivo.size === 0) { setAviso('No hay ninguna celda seleccionada.'); return }

    setPreviewing(true)
    try {
      // El margen NUNCA se recalcula aquí: se le pide al servidor con p_overrides.
      const { grid: conPreview } = await getBrandPriceGrid(brandId, locationId, overrides)
      const filas: PreviewRow[] = []
      for (const [k, precioFin] of objetivo.entries()) {
        const [itemId, chId] = k.split('::')
        const prod = grid.products.find((p) => p.menuItemId === itemId)
        const ch = canales.find((c) => c.channelId === chId)
        if (!prod || !ch) continue
        // Se evalúa en la modalidad de REPARTO permitida (la que decide la oferta);
        // si el canal no tiene reparto, en la que haya.
        const colRef = ch.cols.find((c) => c.serviceType === 'own_delivery' || c.serviceType === 'platform_delivery') ?? ch.cols[0]
        const antes = grid.cells.get(cellKey(itemId, colRef.key))
        const despues = conPreview.cells.get(cellKey(itemId, colRef.key))
        if (!antes) continue
        const precioDespues = precioFin === null ? (prod.basePrice ?? antes.price) : precioFin
        const mDespues = despues?.netMarginPct ?? null
        filas.push({
          menuItemId: itemId, producto: prod.name,
          channelId: chId, canal: ch.channelName,
          precioAntes: antes.price, precioDespues,
          pctRealAplicado: pctReal(antes.price, precioDespues),
          margenAntes: antes.netMarginPct, margenDespues: mDespues,
          costAvailable: antes.costAvailable,
          bloqueado: antes.costAvailable && mDespues !== null && mDespues < 0,
          avisado: antes.costAvailable && mDespues !== null && mDespues >= 0 && mDespues < BANDA_APRIETA_HASTA,
        })
      }
      // lo que más empeora, arriba
      filas.sort((a, b) => {
        const da = (a.margenDespues ?? 999) - (a.margenAntes ?? 999)
        const db = (b.margenDespues ?? 999) - (b.margenAntes ?? 999)
        return da - db
      })
      setPreview(filas)
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setPreviewing(false) }
  }

  const bloqueados = preview?.filter((r) => r.bloqueado).length ?? 0

  async function guardar() {
    if (!preview || !grid || !activeAccountId) return
    if (bloqueados > 0) return
    setSaving(true); setAviso(null)
    try {
      const entries: OperationEntry[] = preview.map((r) => {
        const ch = canales.find((c) => c.channelId === r.channelId)!
        const ref = grid.cells.get(cellKey(r.menuItemId, ch.cols[0].key))!
        const volverABase = opKind === 'base'
        return {
          menu_item_id: r.menuItemId,
          channel_id: r.channelId,
          location_id: locationId,
          action: volverABase ? 'clear' : 'set',
          ...(volverABase ? {} : { price: r.precioDespues }),
          // Lo que la previsualización tenía delante. Si al guardar la realidad
          // no coincide, el RPC aborta entero y dice cuáles.
          expected_price_before: expectedPriceBefore(ref),
        }
      })
      const opId = await applyPriceOperation({
        accountId: activeAccountId,
        scope: {
          marca: brands.find((b) => b.id === brandId)?.name ?? brandId,
          ambito: locationId ? (locations.find((l) => l.id === locationId)?.name ?? locationId) : 'cuenta',
          canales: Array.from(selCanales).map((id) => canales.find((c) => c.channelId === id)?.channelName ?? id),
          categoria: filtroCat,
          operacion: opKind === 'base' ? 'volver a precio base'
            : `${opKind === 'pct' ? `${opValor} %` : opKind === 'eur' ? `${opValor} €` : `fijar a ${opValor} €`}`,
          redondeo: ESCALERA_LABEL[escalera],
          productos: preview.length,
          origen: 'operación en lote',
        },
        entries,
        note: `Rejilla de precios · ${preview.length} celdas`,
      })
      setUltimaOperacion(opId)
      setPreview(null); setSelProductos(new Set())
      setReloadKey((k) => k + 1)
      setAviso(`Guardado. Operación ${opId.slice(0, 8)} — se puede deshacer entera.`)
    } catch (e) {
      // Conflictos: se ENSEÑAN, no se esconden.
      setAviso(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
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

  // ══ RENDER ═════════════════════════════════════════════════════════════════
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start gap-3 mb-1">
        <Table2 className="w-5 h-5 mt-1 text-tinta-70" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Precios de la carta</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-3xl">
            Todos los precios de una marca por canal, para auditarlos de un vistazo y corregirlos sin abrir
            un producto detrás de otro. <b>Los precios son los que paga el cliente, con IVA.</b> Guardar cambia
            el precio en Folvy; <b>no publica nada en Glovo, Uber ni Just Eat</b>.
          </p>
        </div>
      </div>

      {/* ── Aviso de cuenta interna ──────────────────────────────────────────
          Permanente y con forma propia (icono + filete grueso + rótulo), no
          sólo color: el sistema visual v1 reserva el color para el dinero.
          El 18/08 esta pantalla, abierta en Folvy Interno, no pintó ningún
          canal —correctamente, porque allí no hay política de reparto— y se
          leyó como un fallo. Este aviso existe para que eso no vuelva a pasar. */}
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
        <label className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45">Marca</label>
        <select className="border border-linea-fuerte rounded-lg px-3 py-1.5 text-sm font-semibold bg-white"
          value={brandId ?? ''} onChange={(e) => { setBrandId(e.target.value); setSelProductos(new Set()); cancelarEdicion() }}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <label className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45 ml-2">Ámbito</label>
        <select className="border border-linea-fuerte rounded-lg px-3 py-1.5 text-sm font-semibold bg-white"
          value={locationId ?? ''} onChange={(e) => { setLocationId(e.target.value || null); cancelarEdicion() }}>
          <option value="">Toda la cuenta (precio de marca)</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <div className="flex rounded-lg overflow-hidden border border-linea-fuerte ml-auto">
          {(['precio', 'margen'] as const).map((v) => (
            <button key={v} onClick={() => { setVista(v); cancelarEdicion() }}
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
          {/* titulares */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-px bg-border-default border border-border-default rounded-xl overflow-hidden">
            <Stat k="Productos" v={String(stats.total)} n={`${grid.columns.length} columnas reales`} />
            <Stat k="Con precio propio" v={String(stats.propios)} n="celdas con precio fijado para ese canal" />
            <Stat k="En pérdida" v={String(stats.enPerdida)} n="celdas con margen neto negativo" danger={stats.enPerdida > 0} />
            <Stat k="Sin escandallo" v={String(stats.sinEscandallo)} n="su margen no se puede calcular: celdas vacías" />
          </div>

          {/* ── Desglose de tiempos (encargo del 18/08, punto 2) ──────────────
              Primero medir, luego optimizar. Aquí NO se ha optimizado nada
              todavía: sólo se enseña dónde se va el tiempo, con los huecos
              declarados como huecos. */}
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
              <p className="mt-1.5">
                Medido aparte en el servidor: la misma llamada tarda <b>487 ms</b> como superusuario y{' '}
                <b>3.774 ms</b> como <code>authenticated</code>. <code>brand_price_grid</code> es{' '}
                <code>security invoker</code>, así que el usuario real paga las políticas de RLS y el{' '}
                <code>explain analyze</code> hecho como superusuario no las veía.
              </p>
            </div>
          )}

          {/* combinaciones que NO se pintan */}
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

          {/* panel de operación en lote */}
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
                  <option value="base">Volver a precio base</option>
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
              <button onClick={construirPreview} disabled={previewing || selProductos.size === 0 || selCanales.size === 0}
                className="px-3 py-2 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-40">
                {previewing ? 'Calculando…' : 'Previsualizar'}
              </button>
              {ultimaOperacion && (
                <button onClick={deshacer} disabled={saving}
                  className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold flex items-center gap-1.5">
                  <Undo2 className="w-3.5 h-3.5" /> Deshacer
                </button>
              )}
            </div>
          </div>

          {aviso && (
            <pre className="mt-3 whitespace-pre-wrap border border-linea-fuerte rounded-lg bg-lavado p-3 text-xs text-tinta-70">{aviso}</pre>
          )}

          {vista === 'precio' && (
            <div className="mt-3 text-[11px] text-tinta-45">
              Pulsa cualquier precio para cambiarlo. <b>Enter</b> confirma · <b>Esc</b> cancela ·{' '}
              <b>Tab</b> pasa a la siguiente celda. Para <b>volver a heredado</b>, deja el campo vacío y pulsa Enter.
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
                        <th key={c.channelId} className="text-right px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-tinta-45 whitespace-nowrap">
                          {c.channelName}
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
                    {/* Cabecera de bloque de carta. Los precios se leen y se
                        corrigen por bloques, no por alfabeto. */}
                    <tr className="bg-lavado border-y border-linea-fuerte">
                      <td colSpan={3 + (vista === 'precio' ? canales.length : grid.columns.length)} className="px-3 py-1.5">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[11px] uppercase tracking-wider font-semibold text-tinta-70">
                            {sec.categoryName}
                          </span>
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
                      <Fragment key={p.menuItemId}>
                    <tr className="border-b border-border-default/60 hover:bg-lavado/40">
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
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.preventDefault(); void previsualizarCelda() }
                                      else if (e.key === 'Escape') { e.preventDefault(); cancelarEdicion() }
                                      else if (e.key === 'Tab') { tabular(e) }
                                    }}
                                    className="w-24 border-2 border-tinta rounded-md px-2 py-1 text-sm text-right tabular-nums font-semibold"
                                  />
                                  <div className="text-[10px] text-tinta-45 mt-0.5">con IVA · vacío = heredar</div>
                                </td>
                              )
                            }
                            const propio = cell.priceSource === 'override'
                            const desvio = p.basePrice ? ((cell.price - p.basePrice) / p.basePrice) * 100 : null
                            return (
                              <td key={c.channelId} className="px-3 py-2 text-right align-top relative">
                                {propio && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-tinta rounded" />}
                                <button
                                  type="button"
                                  onClick={() => abrirCelda(p.menuItemId, c.channelId, cell.price)}
                                  title="Pulsa para cambiar el precio"
                                  className="w-full text-right rounded px-1 -mx-1 hover:bg-tinta/5 focus:outline-none focus:ring-2 focus:ring-tinta/40">
                                  <div className={`tabular-nums text-sm ${propio ? 'font-semibold text-tinta' : 'font-normal text-tinta-25'}`}>
                                    {eur(cell.price)}
                                  </div>
                                  <div className={`text-[10px] mt-0.5 ${propio ? 'text-tinta font-semibold uppercase tracking-wide' : 'text-tinta-25'}`}>
                                    {propio ? (cell.isLocationOverride ? 'propio del local' : 'propio') : 'hereda'}
                                  </div>
                                  {propio && desvio !== null && Math.abs(desvio) >= 0.5 && (
                                    <div className={`text-[10px] tabular-nums mt-0.5 font-semibold ${desvio < -10 ? 'text-danger' : desvio < 0 ? 'text-warning' : 'text-success'}`}>
                                      {/* eslint-disable-next-line no-restricted-syntax -- desvio es local y ya está comprobado no-null */}
                                      {desvio > 0 ? '+' : '−'}{Math.abs(desvio).toFixed(0)} %
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
                                {/* Sin escandallo: HUECO. Nunca 0 %. */}
                                <div className={`tabular-nums text-sm ${BANDA_CLASE[b]}`}>
                                  {b === 'sin_dato' ? '' : pct(cell.netMarginPct)}
                                </div>
                                <div className="text-[10px] text-tinta-25 mt-0.5">
                                  {b === 'sin_dato' ? 'sin escandallo' : eur(cell.price)}
                                </div>
                              </td>)
                          })}
                    </tr>

                    {/* ── Confirmación de la celda, EN LA PROPIA FILA ─────────
                        El margen se abre por modalidad porque ahí está lo que
                        decide: el mismo precio de Glovo puede mejorar la
                        recogida y hundir el reparto propio. */}
                    {cellPrev && cellPrev.itemId === p.menuItemId && (
                      <tr className="border-b-2 border-tinta bg-lavado">
                        <td />
                        <td colSpan={2 + (vista === 'precio' ? canales.length : grid.columns.length)} className="px-2 py-3">
                          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
                            <div>
                              <div className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45">
                                {cellPrev.canal} · precio
                              </div>
                              <div className="text-sm tabular-nums mt-1">
                                <span className="text-tinta-45">{eur(cellPrev.precioAntes)}</span>
                                {' → '}
                                <b>{cellPrev.accion === 'clear'
                                  ? (cellPrev.precioDespues === null ? 'hereda' : `${eur(cellPrev.precioDespues)} (hereda)`)
                                  : eur(cellPrev.precioDespues)}</b>
                              </div>
                              {cellPrev.nota && <div className="text-[11px] text-tinta-45 mt-1 max-w-xs">{cellPrev.nota}</div>}
                            </div>

                            {cellPrev.modalidades.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45">
                                  Margen neto por modalidad
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                                  {cellPrev.modalidades.map((m) => (
                                    <div key={m.key} className="text-sm">
                                      <span className="text-[11px] text-tinta-45">{m.label}: </span>
                                      {!cellPrev.costAvailable ? (
                                        // Sin escandallo: HUECO, y se deja guardar igual.
                                        <span className="text-tinta-25 text-[11px]">sin escandallo</span>
                                      ) : (
                                        <span className="tabular-nums">
                                          <span className="text-tinta-45">{pct(m.antes)}</span>
                                          {' → '}
                                          <b className={BANDA_CLASE[bandaDe(m.despues)]}>{pct(m.despues)}</b>
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Avisa fuerte, NO bloquea: la decisión es de quien mira el producto. */}
                          {cellPrev.quedaEnPerdida && (
                            <label className="mt-3 flex items-start gap-2 border border-danger/50 bg-danger-bg/50 rounded-lg p-2.5 text-sm cursor-pointer">
                              <input type="checkbox" className="mt-0.5" checked={asumoPerdida}
                                onChange={(e) => setAsumoPerdida(e.target.checked)} />
                              <span className="flex items-start gap-1.5">
                                <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                                <span>
                                  <b>Este precio deja el producto en pérdida</b> en al menos una modalidad de{' '}
                                  {cellPrev.canal}. Puede ser lo que quieres —un gancho— pero tienes que decirlo:
                                  marca la casilla para poder guardar.
                                </span>
                              </span>
                            </label>
                          )}

                          <div className="mt-3 flex items-center gap-2">
                            <button onClick={() => void guardarCelda()}
                              disabled={cellBusy || (cellPrev.quedaEnPerdida && !asumoPerdida)}
                              className="px-3 py-1.5 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
                              <Check className="w-3.5 h-3.5" /> {cellBusy ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button onClick={cancelarEdicion}
                              className="px-3 py-1.5 rounded-lg border border-linea-fuerte text-sm font-semibold">
                              Cancelar
                            </button>
                            <span className="text-[11px] text-tinta-45">
                              Se guarda como una operación: se puede deshacer entera.
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                      </Fragment>
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

      {/* previsualización del LOTE */}
      {preview && (
        <div className="fixed inset-0 bg-tinta/40 flex items-center justify-center p-4 z-50" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-xl max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border-default flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold">Antes de guardar · {preview.length} celda(s)</div>
                <div className="text-xs text-text-secondary mt-1">
                  Ordenado por lo que más empeora. El porcentaje es el <b>real tras redondear</b>, no el que se pidió.
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="p-1"><X className="w-4 h-4" /></button>
            </div>

            {bloqueados > 0 && (
              <div className="mx-4 mt-3 border border-danger/50 bg-danger-bg/50 rounded-lg p-3 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                <div><b>{bloqueados} celda(s) caerían por debajo de 0 % de margen.</b> No se puede guardar
                  hasta quitarlas de la selección o cambiar la operación. En una operación de muchas celdas
                  nadie las mira de una en una; si quieres un producto a pérdida a propósito, edítalo solo.</div>
              </div>
            )}

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-tinta-45">
                    <th className="text-left py-2">Producto</th><th className="text-left">Canal</th>
                    <th className="text-right">Precio</th><th className="text-right">% real</th>
                    <th className="text-right">Margen</th><th className="text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-border-default/60">
                      <td className="py-2 pr-2">{r.producto}</td>
                      <td className="pr-2 text-tinta-70">{r.canal}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        <span className="text-tinta-45">{eur(r.precioAntes)}</span> → <b>{eur(r.precioDespues)}</b>
                      </td>
                      <td className="text-right tabular-nums">{r.pctRealAplicado === null ? '' : pct(r.pctRealAplicado, 2)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {!r.costAvailable ? <span className="text-tinta-25">no se puede saber</span> : (
                          <>
                            <span className="text-tinta-45">{pct(r.margenAntes)}</span> →{' '}
                            <b className={BANDA_CLASE[bandaDe(r.margenDespues)]}>{pct(r.margenDespues)}</b>
                          </>
                        )}
                      </td>
                      <td className="text-right pl-2">
                        {r.bloqueado ? <span className="text-[10px] font-semibold uppercase text-danger">bloqueado</span>
                          : r.avisado ? <span className="text-[10px] font-semibold uppercase text-warning">aprieta</span>
                          : !r.costAvailable ? <span className="text-[10px] text-tinta-25">sin dato</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-border-default flex items-center justify-end gap-2">
              <button onClick={() => setPreview(null)} className="px-3 py-2 rounded-lg border border-linea-fuerte text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={saving || bloqueados > 0}
                className="px-4 py-2 rounded-lg bg-tinta text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
                <Check className="w-4 h-4" /> {saving ? 'Guardando…' : 'Guardar en Folvy'}
              </button>
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
