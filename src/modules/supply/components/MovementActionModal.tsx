// src/modules/supply/components/MovementActionModal.tsx
//
// AL1 — Modal único para las tres acciones de Movimientos:
//   'entry'    → Entrada directa (suma stock sin albarán; reusa el ajuste)
//   'transfer' → Traspaso entre locales (origen = local actual; destino a elegir)
//   'waste'    → Merma (la que vivía en WasteSection, ahora integrada)
// Comparten ItemPicker + cantidad en base + FormatCalculator + nota.

import { useState } from 'react'
import { X, Loader2, Check, Calculator } from 'lucide-react'
import FormatCalculator from '@/modules/kitchen/components/FormatCalculator'
import ItemPicker, { type PickedItem } from '@/modules/supply/components/ItemPicker'
import type { SupplyLocation } from '@/modules/supply/services/supplierCatalogService'
import { registerWaste, uploadWastePhoto, WASTE_REASONS } from '@/modules/supply/services/wasteService'
import { registerDirectEntry, registerTransfer } from '@/modules/supply/services/movementsService'

export type MovementKind = 'entry' | 'transfer' | 'waste'

const TITLES: Record<MovementKind, string> = {
  entry: 'Entrada directa',
  transfer: 'Traspaso a otro local',
  waste: 'Registrar merma',
}

export default function MovementActionModal({
  kind, accountId, locationId, locations, actorId, actorName, onClose, onDone,
}: {
  kind: MovementKind
  accountId: string
  locationId: string
  locations: SupplyLocation[]
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [picked, setPicked] = useState<PickedItem | null>(null)
  const [qtyStr, setQtyStr] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')          // solo merma
  const [toLocation, setToLocation] = useState('')  // solo traspaso
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qtyNum = qtyStr.trim() === '' ? null : Number(qtyStr.replace(',', '.'))
  const qtyOk = qtyNum !== null && Number.isFinite(qtyNum) && qtyNum > 0
  const destinations = locations.filter(l => l.id !== locationId)
  const canSave =
    !!picked && qtyOk && !saving &&
    (kind !== 'waste' || reason !== '') &&
    (kind !== 'transfer' || toLocation !== '')

  async function submit() {
    if (!picked || qtyNum === null) return
    setSaving(true); setError(null)
    try {
      if (kind === 'entry') {
        await registerDirectEntry({
          accountId, locationId, recipeItemId: picked.recipeItemId,
          qtyBase: qtyNum, notes: notes.trim() || null, actorId, actorName,
        })
        onDone(`Entrada registrada: ${picked.name}.`)
      } else if (kind === 'transfer') {
        await registerTransfer({
          accountId, fromLocation: locationId, toLocation, recipeItemId: picked.recipeItemId,
          qtyBase: qtyNum, notes: notes.trim() || null, actorId, actorName,
        })
        const dest = destinations.find(d => d.id === toLocation)?.name ?? 'otro local'
        onDone(`Traspaso registrado: ${picked.name} → ${dest}.`)
      } else {
        let photoUrl: string | null = null
        if (photoFile) {
          const up = await uploadWastePhoto(photoFile)
          photoUrl = up.url
        }
        await registerWaste({
          accountId, locationId, recipeItemId: picked.recipeItemId,
          reasonCode: reason, qtyBase: qtyNum, photoUrl,
          notes: notes.trim() || null, userId: actorId, userName: actorName,
        })
        onDone(`Merma registrada: ${picked.name}.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el movimiento.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md bg-card rounded-lg border border-border-default shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <span className="font-medium text-text-primary">{TITLES[kind]}</span>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <div className="text-xs text-text-tertiary mb-1.5">Artículo</div>
            <ItemPicker accountId={accountId} value={picked} onChange={setPicked}
              placeholder={kind === 'waste' ? 'Busca el artículo que tiras…' : 'Busca el artículo…'} />
          </div>

          {kind === 'transfer' && (
            <div>
              <div className="text-xs text-text-tertiary mb-1.5">Local destino</div>
              <select value={toLocation} onChange={e => setToLocation(e.target.value)}
                className="w-full px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
                <option value="">— Elige local —</option>
                {destinations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {destinations.length === 0 && <p className="text-[12px] text-text-tertiary mt-1">No hay otros locales para traspasar.</p>}
            </div>
          )}

          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <div className="text-xs text-text-tertiary mb-1.5">Cantidad (unidad base)</div>
              <div className="flex items-center gap-1">
                <input type="text" inputMode="decimal" value={qtyStr} onChange={e => setQtyStr(e.target.value)}
                  placeholder="0" disabled={!picked}
                  className="w-28 px-3 py-2 text-sm text-right border border-border-default rounded-md bg-page text-text-primary disabled:opacity-50" />
                <button type="button" onClick={() => setCalcOpen(true)} disabled={!picked}
                  title="Calculadora de formatos (cuenta por cajas)"
                  className="p-2 rounded-md border border-border-default text-text-secondary hover:text-accent disabled:opacity-50 transition-base">
                  <Calculator size={15} />
                </button>
              </div>
            </div>

            {kind === 'waste' && (
              <label className="block flex-1 min-w-[150px]">
                <span className="text-xs text-text-tertiary">Causa</span>
                <select value={reason} onChange={e => setReason(e.target.value)} disabled={!picked}
                  className="mt-1 w-full px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary disabled:opacity-50">
                  <option value="">— Elige causa —</option>
                  {WASTE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
            )}
          </div>

          {kind === 'waste' && (
            <div>
              <div className="text-xs text-text-tertiary mb-1.5">Foto (opcional)</div>
              <input type="file" accept="image/*" capture="environment"
                onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
                className="text-xs text-text-secondary" />
            </div>
          )}

          <div>
            <div className="text-xs text-text-tertiary mb-1.5">Nota (opcional)</div>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Detalle, lote, quién…" className="w-full px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
          </div>

          {error && <div className="text-[13px] text-danger">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button type="button" onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-md border border-border-default text-text-secondary hover:text-text-primary">Cancelar</button>
          <button type="button" onClick={submit} disabled={!canSave}
            className="text-[13px] px-3 py-1.5 rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Registrar
          </button>
        </div>

        {calcOpen && picked && (
          <FormatCalculator
            itemId={picked.recipeItemId}
            itemName={picked.name}
            baseAbbr={null}
            initialQtyInBase={qtyNum !== null && Number.isFinite(qtyNum) ? qtyNum : null}
            onAccept={(q) => { setQtyStr(String(q)); setCalcOpen(false) }}
            onClose={() => setCalcOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
