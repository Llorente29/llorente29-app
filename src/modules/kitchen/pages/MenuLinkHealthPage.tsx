// src/modules/kitchen/pages/MenuLinkHealthPage.tsx
//
// BARRIDO del enlace ítem↔escandallo — de TODA la cuenta, cualquier marca.
// El problema que resuelve: "Escandallo OK" salía de menu_item.needs_review
// (= "tocado, hay coste"), no de si el enlace es el correcto. Un ítem podía
// pedir prestado el escandallo de OTRO plato y quedar en verde sin que nadie
// lo viera. Esta pantalla persigue hasta cero los enlaces sin aprobar u
// obviamente rotos, ordenados por severidad — no por nombre.
//
// Molde: WarehouseReliabilityPage.tsx (misma familia de barridos: cabecera
// con el número que nadie ve + lista de tareas con UNA acción cada una).
// Aquí la "acción" es saltar al ítem (la ficha de producto ya tiene los
// botones Asignar/Cambiar/Quitar/Aprobar — no se duplican aquí).

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, CircleDashed, Loader2, RefreshCw, Search } from 'lucide-react'
import {
  getMenuItemLinkHealth,
  LINK_STATUS_META,
  type MenuItemLinkHealthRow,
} from '@/modules/kitchen/services/menuLinkService'

interface Props {
  accountId: string
  onBack: () => void
  onJumpToItem: (menuItemId: string) => void
}

function fmtEur(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

const TONE_CLASSES: Record<'red' | 'neutral' | 'green', { badge: string; icon: typeof AlertTriangle }> = {
  red: { badge: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
  neutral: { badge: 'bg-gray-100 text-gray-600 border-gray-200', icon: CircleDashed },
  green: { badge: 'bg-green-50 text-green-800 border-green-200', icon: Check },
}

export default function MenuLinkHealthPage({ accountId, onBack, onJumpToItem }: Props) {
  const [rows, setRows] = useState<MenuItemLinkHealthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(true)
  const [search, setSearch] = useState('')

  function load() {
    setLoading(true)
    setError(null)
    getMenuItemLinkHealth(accountId)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar la salud de los escandallos.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!accountId) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const rotos = useMemo(() => rows.filter((r) => r.status.startsWith('roto_')), [rows])
  const sinAprobar = useMemo(() => rows.filter((r) => r.status === 'sin_aprobar'), [rows])
  const aprobados = useMemo(() => rows.filter((r) => r.status === 'aprobado'), [rows])

  const filtered = useMemo(() => {
    let out = onlyProblems ? rows.filter((r) => r.status !== 'aprobado') : rows
    const q = search.trim().toLowerCase()
    if (q !== '') {
      out = out.filter((r) =>
        r.itemName.toLowerCase().includes(q) ||
        (r.brandName ?? '').toLowerCase().includes(q) ||
        (r.recipeName ?? '').toLowerCase().includes(q))
    }
    // Ya viene ordenado por severidad desde la RPC — el filtro conserva el orden.
    return out
  }, [rows, onlyProblems, search])

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={15} /> Volver
      </button>

      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Salud de escandallos</h1>
        <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
          El sello verde solo sale cuando oficina aprueba el enlace — no en cuanto un ítem tiene coste.
          Aquí aparece cualquier cuenta, en cualquier marca.
        </p>
        <div className="flex items-center gap-4 mt-3 text-sm flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
            <AlertTriangle size={14} /> {rotos.length} roto{rotos.length !== 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-gray-600">
            <CircleDashed size={14} /> {sinAprobar.length} sin aprobar
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-green-700">
            <Check size={14} /> {aprobados.length} aprobado{aprobados.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300" />
            Solo problemas
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar ítem, marca o escandallo…"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white w-64" />
          </div>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm p-6">
          <Loader2 size={16} className="animate-spin" /> Revisando escandallos…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
          <div className="text-3xl mb-2">🟢</div>
          <p className="text-emerald-900 font-medium">
            {onlyProblems ? 'Nada pendiente de revisar.' : 'No hay ítems que coincidan.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const meta = LINK_STATUS_META[r.status]
            const tone = TONE_CLASSES[meta.tone]
            const Icon = tone.icon
            return (
              <div key={r.menuItemId} className="rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 truncate">{r.itemName}</div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {r.brandName ?? '—'}
                    {r.recipeName ? ` · ${r.recipeName} (${fmtEur(r.cost)})` : ''}
                    {r.sharedWith > 1 ? ` · compartido con ${r.sharedWith - 1}` : ''}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border shrink-0 ${tone.badge}`} title={meta.reason}>
                  <Icon size={11} /> {meta.label}
                </span>
                <button
                  onClick={() => onJumpToItem(r.menuItemId)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shrink-0"
                >
                  Ir al ítem
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
