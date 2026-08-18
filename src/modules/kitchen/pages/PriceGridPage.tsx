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
//
// 3. LAS COMBINACIONES IMPOSIBLES NO SE PINTAN. El servidor las marca; aquí se
//    listan aparte con su motivo. La que importa: uber/reparto propio da el
//    mejor margen de la pantalla y no puede ocurrir — Uber siempre reparte Uber.
//
// Sin escandallo ⇒ celda de margen VACÍA. Nunca 0 %: sería mentira.
// El color sólo es dinero (el trío del margen). Heredado/propio se distinguen
// por peso, gris y filete — sistema visual v1, igual que el modal.

import { useEffect, useMemo, useState } from 'react'
import { Table2, AlertTriangle, Undo2, EyeOff, Loader2, Check, X } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrands } from '@/modules/multitenancy/services/brandsService'
import { supabase } from '@/lib/supabase'
import type { Brand } from '@/types/multitenancy'
import {
  getBrandPriceGrid, applyPriceOperation, revertPriceOperation,
  bandaDe, BANDA_APRIETA_HASTA, redondear, precioObjetivo, pctReal,
  cellKey, SERVICE_TYPE_LABEL, ESCALERA_LABEL,
  type PriceGrid, type GridColumn, type Escalera, type BulkOp, type OperationEntry, type Banda,
} from '@/modules/kitchen/services/priceGridService'

const eur = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' :
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(v)
const pct = (v: number | null | undefined, dp = 1): string =>
  // eslint-disable-next-line no-restricted-syntax -- el null ya está descartado en la rama de arriba
  v === null || v === undefined ? '' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(dp)} %`

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

export default function PriceGridPage() {
  const { activeAccountId } = useActiveAccount()

  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([])
  const [locationId, setLocationId] = useState<string | null>(null)   // null = ámbito cuenta

  const [grid, setGrid] = useState<PriceGrid | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [vista, setVista] = useState<'precio' | 'margen'>('precio')

  // selección
  const [selProductos, setSelProductos] = useState<Set<string>>(new Set())
  const [selCanales, setSelCanales] = useState<Set<string>>(new Set())
  const [filtroCat, setFiltroCat] = useState<string>('todas')   // 'todas' | 'sin' | categoryId

  // operación
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

  // ── carga de marcas y locales ───
  useEffect(() => {
    if (!activeAccountId) return
    listBrands({ accountId: activeAccountId })
      .then((bs) => { setBrands(bs); setBrandId((prev) => prev ?? bs[0]?.id ?? null) })
      .catch((e) => setError(String(e)))
    supabase?.from('locations').select('id, name').eq('account_id', activeAccountId).order('name')
      .then(({ data }) => setLocations((data ?? []) as Array<{ id: string; name: string }>))
  }, [activeAccountId])

  // ── carga de la rejilla: UNA sola llamada ───
  useEffect(() => {
    if (!brandId) return
    let vivo = true
    const t0 = performance.now()
    getBrandPriceGrid(brandId, locationId)
      .then((g) => {
        if (!vivo) return
        setError(null); setPreview(null)
        setGrid(g); setLoadMs(Math.round(performance.now() - t0))
      })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (vivo) setLoading(false) })
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

  const categorias = useMemo(() => {
    if (!grid) return [] as Array<{ id: string; name: string }>
    const m = new Map<string, string>()
    let haySin = false
    for (const p of grid.products) {
      if (p.categoryId) m.set(p.categoryId, p.categoryName ?? '(sin nombre)')
      else haySin = true
    }
    const out = Array.from(m.entries()).map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    // Los productos sin categoría NO los alcanza ninguna selección por
    // categoría. Tienen que poder verse, o se quedan fuera de todo en silencio.
    if (haySin) out.push({ id: 'sin', name: 'Sin categoría' })
    return out
  }, [grid])

  const productosVisibles = useMemo(() => {
    if (!grid) return []
    if (filtroCat === 'todas') return grid.products
    if (filtroCat === 'sin') return grid.products.filter((p) => !p.categoryId)
    return grid.products.filter((p) => p.categoryId === filtroCat)
  }, [grid, filtroCat])

  // ── titulares ───
  const stats = useMemo(() => {
    if (!grid) return null
    let propios = 0, enPerdida = 0, sinEscandallo = 0
    const productosSinCoste = new Set<string>()
    for (const p of grid.products) {
      let tieneCoste = false
      for (const c of grid.columns) {
        const cell = grid.cells.get(cellKey(p.menuItemId, c.key))
        if (!cell) continue
        if (cell.costAvailable) tieneCoste = true
        if (cell.priceSource === 'override' && c.serviceType !== 'pickup') propios++
        if (cell.netMarginPct !== null && cell.netMarginPct < 0) enPerdida++
      }
      if (!tieneCoste) { sinEscandallo++; productosSinCoste.add(p.menuItemId) }
    }
    return { propios, enPerdida, sinEscandallo, total: grid.products.length }
  }, [grid])

  // ── construir la previsualización ───
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
      const conPreview = await getBrandPriceGrid(brandId, locationId, overrides)
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

  // ── guardar ───
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
          expected_price_before: ref.priceSource === 'base' && !ref.isLocationOverride ? null : ref.price,
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

  // ── render ───
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

      {/* selectores */}
      <div className="mt-5 flex flex-wrap items-center gap-3 bg-card border border-border-default rounded-xl p-3">
        <label className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45">Marca</label>
        <select className="border border-linea-fuerte rounded-lg px-3 py-1.5 text-sm font-semibold bg-white"
          value={brandId ?? ''} onChange={(e) => { setBrandId(e.target.value); setSelProductos(new Set()) }}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <label className="text-[10px] uppercase tracking-wider font-semibold text-tinta-45 ml-2">Ámbito</label>
        <select className="border border-linea-fuerte rounded-lg px-3 py-1.5 text-sm font-semibold bg-white"
          value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value || null)}>
          <option value="">Toda la cuenta (precio de marca)</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <div className="flex rounded-lg overflow-hidden border border-linea-fuerte ml-auto">
          {(['precio', 'margen'] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)}
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
            <Stat k="Productos" v={String(stats.total)} n={`${grid.columns.length} columnas reales · ${loadMs ?? '—'} ms`} />
            <Stat k="Con precio propio" v={String(stats.propios)} n="celdas con precio fijado para ese canal" />
            <Stat k="En pérdida" v={String(stats.enPerdida)} n="celdas con margen neto negativo" danger={stats.enPerdida > 0} />
            <Stat k="Sin escandallo" v={String(stats.sinEscandallo)} n="su margen no se puede calcular: celdas vacías" />
          </div>

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

          {/* panel de operación */}
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

          {/* rejilla */}
          <div className="mt-4 bg-card border border-border-default rounded-xl overflow-x-auto">
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
                {productosVisibles.map((p) => (
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
                          const propio = cell.priceSource === 'override'
                          const desvio = p.basePrice ? ((cell.price - p.basePrice) / p.basePrice) * 100 : null
                          return (
                            <td key={c.channelId} className="px-3 py-2 text-right align-top relative">
                              {propio && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-tinta rounded" />}
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

      {/* previsualización */}
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
                  hasta quitarlas de la selección o cambiar la operación.</div>
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
