// src/modules/kitchen/pages/BrandReconciliationPage.tsx
//
// RECONCILIACIÓN DE MARCAS EXTERNAS — §6 del encargo de Carabanchel (17/08).
//
// Folvy atribuye cada pedido entrante a una marca por una CLAVE DE TEXTO que
// teclea un humano en el back office del integrador. Renombrar una conexión
// cambia esa clave y hoy rompe el mapeo EN SILENCIO: los pedidos siguen
// entrando y dejan de atribuirse, sin un solo error visible. Esta pantalla
// convierte ese silencio en aviso. Ver externalBrandReconService para los
// hallazgos de producción que la motivan.
//
// Tres estados, y los tres piden cosas distintas:
//   SIN MAPEAR   llega y no sabemos de quién es → decide: marca o descartar
//   MAPEADA      llega y se atribuye → nada que hacer... salvo que traiga 0
//                ventas en la ventana, y entonces es un mapeo muerto
//   DESCARTADA   ajena a propósito → visible, con deshacer
//
// Sistema visual v1: chrome monocromo en tinta, estructura antes que color. El
// único color fuerte de Folvy es la salud del margen, y aquí no hay margen —
// así que los estados van con trazo, relleno y peso, no con semáforo.

import { useEffect, useState, useMemo } from 'react'
import { ArrowLeft, Loader2, RotateCcw, EyeOff, AlertTriangle, Link2 } from 'lucide-react'
import {
  listExternalBrandRecon,
  mapExternalBrand,
  ignoreExternalBrand,
  clearExternalBrandDecision,
  type ExternalBrandRow,
  type ReconResult,
} from '@/modules/kitchen/services/externalBrandReconService'
import { listAccountBrands, type AccountBrandLite } from '@/modules/kitchen/services/menuItemService'

interface Props {
  accountId: string
  onBack: () => void
}

const WINDOW_DAYS = 30

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' }).format(new Date(iso))
}

// La forma de la clave delata al integrador y no son intercambiables: hubrise
// manda el nombre visible de la marca, lastapp manda un UUID. Decirlo evita que
// alguien intente "arreglar" un UUID escribiendo un nombre encima.
const SOURCE_LABEL: Record<string, string> = {
  hubrise: 'HubRise',
  lastapp: 'Last.app',
  folvy_pos: 'TPV Folvy',
  folvy_shop: 'Shop',
}

export default function BrandReconciliationPage({ accountId, onBack }: Props) {
  const [data, setData] = useState<ReconResult | null>(null)
  const [brands, setBrands] = useState<AccountBrandLite[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Recarga por contador en vez de llamar a una función de carga desde el
  // efecto: así el setState solo ocurre en callbacks de la promesa, nunca
  // síncrono en el cuerpo del efecto (react-hooks/set-state-in-effect).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      listExternalBrandRecon(accountId, WINDOW_DAYS),
      listAccountBrands(accountId),
    ])
      .then(([recon, bs]) => {
        if (cancelled) return
        setError(null)
        setData(recon)
        setBrands(bs)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando la reconciliación')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, reloadKey])

  const brandName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of brands) m[b.id] = b.name
    return m
  }, [brands])

  const groups = useMemo(() => {
    const rows = data?.rows ?? []
    return {
      unmapped: rows.filter((r) => r.status === 'unmapped'),
      // Mapeada y sin una sola venta en la ventana = el mapeo no casa con nada.
      dead: rows.filter((r) => r.status === 'mapped' && r.salesInWindow === 0),
      mapped: rows.filter((r) => r.status === 'mapped' && r.salesInWindow > 0),
      ignored: rows.filter((r) => r.status === 'ignored'),
    }
  }, [data])

  function rowKey(r: ExternalBrandRow): string {
    return `${r.source} ${r.externalLocationId} ${r.externalBrandId}`
  }

  async function run(r: ExternalBrandRow, fn: () => Promise<void>) {
    setBusyKey(rowKey(r))
    setError(null)
    try {
      await fn()
      setReloadKey((k) => k + 1)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error guardando la decisión')
    } finally {
      setBusyKey(null)
    }
  }

  function base(r: ExternalBrandRow) {
    return {
      accountId,
      source: r.source,
      externalLocationId: r.externalLocationId,
      externalBrandId: r.externalBrandId,
    }
  }

  function KeyCell({ r }: { r: ExternalBrandRow }) {
    return (
      <div className="min-w-0">
        {/* La clave, tal cual llega. En mono y sin recortar: un espacio de más o
            un acento distinto es exactamente lo que rompe el mapeo. */}
        <div className="font-mono text-[13px] text-tinta break-all">{r.externalBrandId}</div>
        <div className="text-[11px] text-tinta-45 mt-0.5">
          {SOURCE_LABEL[r.source] ?? r.source}
          {r.externalLocationId ? <> · <span className="font-mono">{r.externalLocationId}</span></> : null}
        </div>
      </div>
    )
  }

  function SalesCell({ r }: { r: ExternalBrandRow }) {
    return (
      <div className="text-right shrink-0 w-[104px]">
        <div className="font-mono tabular-nums text-[14px] font-semibold text-tinta">{r.salesInWindow}</div>
        <div className="text-[10.5px] text-tinta-45">
          {r.salesInWindow > 0 ? <>{fmtDate(r.firstSeen)}–{fmtDate(r.lastSeen)}</> : 'sin ventas'}
        </div>
      </div>
    )
  }

  function BrandPicker({ r }: { r: ExternalBrandRow }) {
    return (
      <select
        defaultValue=""
        disabled={busyKey === rowKey(r)}
        onChange={(e) => {
          const brandId = e.target.value
          if (!brandId) return
          void run(r, () => mapExternalBrand({ ...base(r), brandId }))
        }}
        className="px-2.5 py-1.5 text-[13px] rounded-lg bg-card border border-linea-fuerte text-tinta focus:outline-none focus:ring-2 focus:ring-tinta/15 disabled:opacity-50"
      >
        <option value="">Atribuir a…</option>
        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    )
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-tinta-45">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando reconciliación…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <button type="button" onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] text-tinta-70 hover:text-tinta mb-4">
        <ArrowLeft className="w-4 h-4" /> Volver
      </button>

      <h1 className="font-display text-[20px] font-semibold text-tinta tracking-[-0.02em]">
        Marcas que llegan de fuera
      </h1>
      <p className="text-[13px] text-tinta-45 mt-1 max-w-2xl">
        Cada pedido entrante trae el nombre de su marca escrito por el integrador. Si ese
        nombre cambia —al renombrar una conexión, o por un dedazo— el pedido deja de
        atribuirse y hoy no avisa nadie. Esta pantalla es ese aviso.
      </p>
      <p className="text-[11px] text-tinta-45 mt-2">
        Ventana: últimos {data?.windowDays ?? WINDOW_DAYS} días · {data?.salesScanned ?? 0} ventas leídas
        {data?.truncated && (
          <span className="text-warning font-medium"> · techo de lectura alcanzado, el recuento se queda corto</span>
        )}
      </p>

      {error && (
        <div className="mt-4 p-2.5 rounded-lg bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>
      )}

      {/* ── SIN MAPEAR — lo único que exige acción ── */}
      <section className="mt-6">
        <h2 className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45 mb-2">
          Sin mapear {groups.unmapped.length > 0 && `· ${groups.unmapped.length}`}
        </h2>
        {groups.unmapped.length === 0 ? (
          <p className="text-[13px] text-tinta-45 py-3">
            Nada pendiente. Todo lo que ha llegado en la ventana está atribuido o descartado.
          </p>
        ) : (
          <div className="border border-linea-fuerte rounded-lg overflow-hidden">
            {groups.unmapped.map((r) => (
              <div key={rowKey(r)}
                className="flex items-center gap-3 px-4 py-3 border-b border-border-default last:border-0 border-l-[3px] border-l-tinta bg-[#FAFBFB]">
                <KeyCell r={r} />
                <div className="flex-1" />
                <SalesCell r={r} />
                <div className="flex items-center gap-2 shrink-0">
                  <BrandPicker r={r} />
                  <button type="button" disabled={busyKey === rowKey(r)}
                    onClick={() => void run(r, () => ignoreExternalBrand(base(r)))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] border border-linea-fuerte bg-card text-tinta-70 text-[11.5px] font-semibold hover:bg-lavado disabled:opacity-40">
                    {busyKey === rowKey(r) ? <Loader2 className="w-3 h-3 animate-spin" /> : <EyeOff className="w-3 h-3" />}
                    No es mía
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── MAPEOS MUERTOS — mapeada pero sin una sola venta ──
          Es el hallazgo que sacó esta pantalla adelante: en Alcalá hay 3 filas
          con el nombre compuesto del bridge que no han casado nunca. */}
      {groups.dead.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Mapeadas que no casan con nada · {groups.dead.length}
          </h2>
          <p className="text-[12px] text-tinta-45 mb-2 max-w-2xl">
            Tienen marca asignada pero no ha entrado ni un pedido con esa clave en la ventana.
            O la conexión se renombró, o la clave nunca fue la buena.
          </p>
          <div className="border border-linea-fuerte rounded-lg overflow-hidden">
            {groups.dead.map((r) => (
              <div key={rowKey(r)}
                className="flex items-center gap-3 px-4 py-3 border-b border-border-default last:border-0 border-l-[3px] border-l-transparent">
                <KeyCell r={r} />
                <div className="flex-1" />
                <span className="text-[12px] text-tinta-70 shrink-0">
                  → {r.brandId ? (brandName[r.brandId] ?? '—') : '—'}
                </span>
                <SalesCell r={r} />
                <button type="button" disabled={busyKey === rowKey(r)}
                  onClick={() => void run(r, () => clearExternalBrandDecision(base(r)))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] border border-tinta bg-card text-tinta text-[11.5px] font-semibold hover:bg-lavado disabled:opacity-40 shrink-0">
                  {busyKey === rowKey(r) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── MAPEADAS Y VIVAS ── */}
      {groups.mapped.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45 mb-2 flex items-center gap-1.5">
            <Link2 className="w-3 h-3" /> Atribuidas · {groups.mapped.length}
          </h2>
          <div className="border border-border-default rounded-lg overflow-hidden">
            {groups.mapped.map((r) => (
              <div key={rowKey(r)}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-border-default last:border-0">
                <KeyCell r={r} />
                <div className="flex-1" />
                <span className="text-[12px] text-tinta-70 shrink-0">
                  → {r.brandId ? (brandName[r.brandId] ?? '—') : '—'}
                </span>
                <SalesCell r={r} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── DESCARTADAS ── */}
      {groups.ignored.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45 mb-2">
            Descartadas · {groups.ignored.length}
          </h2>
          <div className="border border-border-default rounded-lg overflow-hidden opacity-70">
            {groups.ignored.map((r) => (
              <div key={rowKey(r)}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-border-default last:border-0">
                <KeyCell r={r} />
                <div className="flex-1" />
                <SalesCell r={r} />
                <button type="button" disabled={busyKey === rowKey(r)}
                  onClick={() => void run(r, () => clearExternalBrandDecision(base(r)))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] border border-linea-fuerte bg-card text-tinta-70 text-[11.5px] font-semibold hover:bg-lavado disabled:opacity-40 shrink-0">
                  {busyKey === rowKey(r) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Deshacer
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
