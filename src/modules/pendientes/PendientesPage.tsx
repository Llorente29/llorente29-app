// src/modules/pendientes/PendientesPage.tsx
//
// ENCARGO CODE (14/08) Pantalla de PENDIENTES, Fase 1 (Almacén y Recepción).
// AHORA (ámbar) → ESTA SEMANA (neutro) → SALUD (solo números). Una línea
// por causa, nunca por caso — "2 albaranes a medio registrar" es una línea.
//
// Contraste (B.6): nunca text-warning/bg-warning-bg ni border-border-default
// para texto — mismo patrón que ReceiptOfficeReview (text-text-primary
// sobre el fondo de color).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, MapPin, AlertTriangle, Inbox } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { usePendingBoard } from './hooks/usePendingBoard'
import {
  pendingKindMeta,
  postponePending,
  dismissPending,
  DISMISS_REASONS,
  type PendingItem,
  type PendingPreset,
  type DismissReason,
} from './pendientesService'

const LAST_NONEMPTY_KEY = 'folvy_pendientes_last_nonempty'

const PRESET_LABEL: Record<PendingPreset, string> = {
  manana: 'Mañana',
  semana: 'La semana que viene',
  mes: 'El mes que viene',
}

export default function PendientesPage() {
  const { activeAccountId } = useApp()
  const navigate = useNavigate()
  const { items, loading, error, refetch } = usePendingBoard()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [reasonModalKey, setReasonModalKey] = useState<string | null>(null)

  const ahora = items.filter(i => i.layer === 'ahora')
  const semana = items.filter(i => i.layer === 'semana')
  const salud = items.filter(i => i.layer === 'salud')
  const isEmptyActionable = !loading && ahora.length === 0 && semana.length === 0

  // Client-side, no hay tabla de historial: recuerda en este navegador la
  // última vez que el tablero no estuvo vacío. Deliberadamente simple — no
  // es verdad de servidor, es memoria local para que el vacío no sea mudo.
  const [lastNonEmpty, setLastNonEmpty] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_NONEMPTY_KEY) } catch { return null }
  })
  useEffect(() => {
    if (!loading && (ahora.length > 0 || semana.length > 0)) {
      const now = new Date().toISOString()
      try { localStorage.setItem(LAST_NONEMPTY_KEY, now) } catch { /* noop */ }
      setLastNonEmpty(now)
    }
  }, [loading, ahora.length, semana.length])

  function lineKey(i: PendingItem): string {
    return `${i.pendingKind}::${i.locationId}`
  }

  async function handlePostpone(item: PendingItem, preset: PendingPreset) {
    if (!activeAccountId) return
    setOpenMenuKey(null)
    setBusyKey(lineKey(item))
    try {
      await postponePending(activeAccountId, item.pendingKind, item.locationId, preset)
      refetch()
    } finally {
      setBusyKey(null)
    }
  }

  async function handleDismiss(item: PendingItem, reason: DismissReason) {
    if (!activeAccountId) return
    setReasonModalKey(null)
    setBusyKey(lineKey(item))
    try {
      await dismissPending(activeAccountId, item.pendingKind, item.locationId, reason)
      refetch()
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-display font-semibold tracking-tight text-text-primary">Pendientes</h1>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-text-primary">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-text-secondary">Cargando…</div>
      )}

      {isEmptyActionable && (
        <div className="rounded-lg border border-border-default bg-card px-5 py-6 text-center">
          <div className="text-sm font-medium text-text-primary">No tienes nada pendiente en Almacén.</div>
          {lastNonEmpty && (
            <div className="text-xs text-text-secondary mt-1">
              Última vez con pendientes: {new Date(lastNonEmpty).toLocaleString('es-ES')}
            </div>
          )}
        </div>
      )}

      {ahora.length > 0 && (
        <Section title="AHORA" tone="ahora">
          {ahora.map(item => (
            <PendingLine
              key={lineKey(item)}
              item={item}
              busy={busyKey === lineKey(item)}
              menuOpen={openMenuKey === lineKey(item)}
              onToggleMenu={() => setOpenMenuKey(openMenuKey === lineKey(item) ? null : lineKey(item))}
              onGo={() => navigate(pendingKindMeta(item.pendingKind).destination(item.locationId))}
              onPostpone={preset => handlePostpone(item, preset)}
              onAskDismiss={() => { setOpenMenuKey(null); setReasonModalKey(lineKey(item)) }}
            />
          ))}
        </Section>
      )}

      {semana.length > 0 && (
        <Section title="ESTA SEMANA" tone="semana">
          {semana.map(item => (
            <PendingLine
              key={lineKey(item)}
              item={item}
              busy={busyKey === lineKey(item)}
              menuOpen={openMenuKey === lineKey(item)}
              onToggleMenu={() => setOpenMenuKey(openMenuKey === lineKey(item) ? null : lineKey(item))}
              onGo={() => navigate(pendingKindMeta(item.pendingKind).destination(item.locationId))}
              onPostpone={preset => handlePostpone(item, preset)}
              onAskDismiss={() => { setOpenMenuKey(null); setReasonModalKey(lineKey(item)) }}
            />
          ))}
        </Section>
      )}

      {salud.length > 0 && (
        <Section title="SALUD" tone="salud">
          {salud.map(item => (
            <div key={lineKey(item)} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle size={16} className="text-text-secondary shrink-0" />
                <span className="text-sm text-text-primary truncate">{pendingKindMeta(item.pendingKind).text(item.items)}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-text-secondary shrink-0">
                <MapPin size={13} />{item.locationName}
              </span>
            </div>
          ))}
        </Section>
      )}

      {reasonModalKey && (
        <DismissReasonModal
          onCancel={() => setReasonModalKey(null)}
          onPick={reason => {
            const item = items.find(i => lineKey(i) === reasonModalKey)
            if (item) handleDismiss(item, reason)
          }}
        />
      )}
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone: 'ahora' | 'semana' | 'salud'; children: React.ReactNode }) {
  const headerClass =
    tone === 'ahora' ? 'text-warning' : tone === 'semana' ? 'text-text-secondary' : 'text-text-secondary'
  return (
    <div className="space-y-2">
      <h2 className={`text-xs font-semibold uppercase tracking-wide ${headerClass}`}>{title}</h2>
      <div className="rounded-lg border border-border-default bg-card divide-y divide-border-default">
        {children}
      </div>
    </div>
  )
}

function PendingLine({
  item, busy, menuOpen, onToggleMenu, onGo, onPostpone, onAskDismiss,
}: {
  item: PendingItem
  busy: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onGo: () => void
  onPostpone: (preset: PendingPreset) => void
  onAskDismiss: () => void
}) {
  const meta = useMemo(() => pendingKindMeta(item.pendingKind), [item.pendingKind])
  const isAhora = item.layer === 'ahora'
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3.5 ${isAhora ? 'bg-warning-bg' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">{meta.text(item.items)}</div>
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary mt-0.5">
          <MapPin size={12} />{item.locationName}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={onGo}
          className="px-3 py-2 rounded-md text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-base"
          style={{ minHeight: 44 }}
        >
          {meta.buttonText(item.items)}
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="Más opciones"
            disabled={busy}
            onClick={onToggleMenu}
            className="p-2 rounded-md text-text-secondary hover:bg-page disabled:opacity-50"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 rounded-lg overflow-hidden bg-card border border-border-default shadow-lg z-20"
              style={{ top: 44, minWidth: 200 }}
            >
              <div className="px-3 py-1.5 text-xs text-text-secondary">Posponer</div>
              {(['manana', 'semana', 'mes'] as PendingPreset[]).map(preset => (
                <button
                  key={preset}
                  type="button"
                  role="menuitem"
                  onClick={() => onPostpone(preset)}
                  className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-page"
                >
                  {PRESET_LABEL[preset]}
                </button>
              ))}
              <div className="border-t border-border-default" />
              <button
                type="button"
                role="menuitem"
                onClick={onAskDismiss}
                className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-page"
              >
                Descartar…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DismissReasonModal({ onCancel, onPick }: { onCancel: () => void; onPick: (reason: DismissReason) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="bg-card border border-border-default rounded-lg p-5 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Inbox size={18} className="text-text-secondary" />
          <h3 className="text-sm font-semibold text-text-primary">¿Por qué se descarta?</h3>
        </div>
        <div className="space-y-2">
          {DISMISS_REASONS.map(reason => (
            <button
              key={reason}
              type="button"
              onClick={() => onPick(reason)}
              className="w-full text-left px-3 py-2.5 rounded-md text-sm text-text-primary border border-border-default hover:bg-page transition-base"
              style={{ minHeight: 44 }}
            >
              {reason}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-page"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
