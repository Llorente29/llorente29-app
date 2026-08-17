// src/modules/kitchen/components/FichaTab.tsx
//
// Pestaña "Ficha" de la ficha unificada de plato (CatalogFichaPage). Reúne,
// de CatalogProductDetailPage.tsx:
//   - Gestión COMPLETA de la foto pública (menu_item.photo_url — subir/
//     cambiar/eliminar con confirmación inline + lightbox propio,
//     menuPhotoService.ts), movida tal cual desde la zona HERO de la ficha
//     vieja (líneas ~1145-1185 los handlers, ~1271-1276 y ~1303-1377 el
//     JSX). La cabecera de CatalogFichaPage.tsx solo tiene una copia de SOLO
//     VISTA de esta misma foto (con fallback a la de cocina) — la gestión
//     completa vive aquí.
//   - S8 "Notas internas" (id="s-notas", líneas ~1864-1879).
//   - S9 "Packaging delivery" (id="s-packaging", líneas ~1881-1909).
//   - S11 "Avanzado" (id="s-avanzado", líneas ~1924-1964) — SIN "External ID
//     (Last.app)" (dead, decisión ya tomada: siempre "—", nunca conectado a
//     ningún campo real).
//   - Descripción del producto (item.description) — en la ficha vieja solo se
//     editaba desde el modo edición de la tarjeta de identidad; esa edición
//     de cabecera no existe todavía en CatalogFichaPage.tsx (Fase 1 no la
//     implementó), así que aquí se añade un campo de edición con el mismo
//     patrón saveField que notas/packaging/kitchen name.
//   - `target_food_cost_pct` EDITABLE (única pieza de lógica nueva permitida
//     en esta fase, decisión ya tomada por Julio) — antes de solo lectura
//     (mostrado en Economía), ahora con un input editable aquí, mismo patrón
//     saveField.
// Ver plan C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md, Fase 4.
// Regla de oro: unificar no pierde nada — "mover, no inventar" (salvo las dos
// excepciones de arriba, explícitamente aprobadas).
//
// menu_item-scoped. `item` YA viene cargado por el padre (CatalogFichaPage) —
// este componente NUNCA hace su propio getMenuItemById. Toda mutación llama
// a onItemChanged() (→ refreshItem() del padre) tras guardar; el nuevo `item`
// baja por prop. EconomiaTab's "Target FC: Dentro/Fuera del objetivo" lee el
// MISMO item.targetFoodCostPct que se edita aquí — comparten el mismo `item`
// por prop, así que no hay ventana en la que uno muestre el valor viejo tras
// editar el otro (se resuelve solo, por construcción).

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ImagePlus, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { updateMenuItem } from '@/modules/kitchen/services/menuItemService'
import { uploadMenuPhoto, deleteMenuPhoto } from '@/modules/kitchen/services/menuPhotoService'
import { streamMessage } from '@/modules/folvy-ai/services/folvyAIService'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { MenuItem, MenuItemUpdate } from '@/types/kitchen'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}

function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={src} alt="" className="max-w-full max-h-full rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-colors">
        <X size={20} />
      </button>
    </div>
  )
}

interface FichaTabProps {
  item: MenuItem
  accountId: string
  onItemChanged: () => void
}

export default function FichaTab({ item, accountId, onItemChanged }: FichaTabProps) {
  // ── Foto pública (menu_item.photo_url) ──
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoConfirmDelete, setPhotoConfirmDelete] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  async function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    setPhotoError(null)
    const prevUrl = item.photoUrl
    try {
      const url = await uploadMenuPhoto(accountId, item.id, file)
      await updateMenuItem(item.id, { photoUrl: url })
      // Limpia la foto anterior del bucket para no dejar huérfanas (best-effort).
      if (prevUrl && prevUrl !== url) {
        try { await deleteMenuPhoto(prevUrl) } catch { /* no bloquea el cambio */ }
      }
      onItemChanged()
    } catch (err: unknown) {
      console.error('FichaTab: subida de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo subir la foto.')
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onPhotoDelete() {
    if (!item.photoUrl) return
    setPhotoDeleting(true)
    setPhotoError(null)
    const url = item.photoUrl
    try {
      await updateMenuItem(item.id, { photoUrl: null })
      // Borra el objeto del bucket (best-effort: si falla, el item ya no lo referencia).
      try { await deleteMenuPhoto(url) } catch { /* no bloquea */ }
      onItemChanged()
    } catch (err: unknown) {
      console.error('FichaTab: borrado de foto falló', err)
      setPhotoError(err instanceof Error ? err.message : 'No se pudo eliminar la foto.')
    } finally {
      setPhotoDeleting(false)
      setPhotoConfirmDelete(false)
    }
  }

  // ── A1: "Mejorar descripción con IA" (cableado real, Fase 6) — reutiliza
  // streamMessage con el mismo patrón que suggestWasteAI de
  // RecipeEscandalloTab (surface:'background', sin history). El resultado
  // rellena descriptionVal como SUGERENCIA editable: nunca se auto-guarda,
  // el usuario sigue pulsando "Guardar descripción".
  const [aiDescBusy, setAiDescBusy] = useState(false)
  const [aiDescError, setAiDescError] = useState<string | null>(null)

  function improveDescriptionAI() {
    if (aiDescBusy) return
    setAiDescError(null)
    setAiDescBusy(true)
    let acc = ''
    streamMessage(
      {
        accountId,
        surface: 'background',
        message:
          `Escribe una descripción de venta breve (1-2 frases, en español, sin ` +
          `comillas) para el plato "${item.name}"` +
          (item.category ? `, de la categoría "${item.category}"` : '') +
          (descriptionVal.trim() ? `. Descripción actual a mejorar: "${descriptionVal.trim()}"` : '') +
          `. Responde SOLO con el texto de la descripción, sin explicaciones ni texto adicional.`,
        history: [],
      },
      (evt) => {
        if (evt.type === 'text') {
          acc += evt.content
        } else if (evt.type === 'done' || evt.type === 'partial_end') {
          let text = acc.trim()
          if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
            text = text.slice(1, -1).trim()
          }
          if (text) {
            setDescriptionVal(text)
          } else {
            setAiDescError('La IA no devolvió una descripción. Escríbela a mano.')
            window.setTimeout(() => setAiDescError(null), 4000)
          }
          setAiDescBusy(false)
        } else if (evt.type === 'error') {
          setAiDescError('No se pudo consultar a la IA. Escribe la descripción a mano.')
          window.setTimeout(() => setAiDescError(null), 4000)
          setAiDescBusy(false)
        }
      },
    ).catch(() => {
      setAiDescError('No se pudo consultar a la IA. Escribe la descripción a mano.')
      window.setTimeout(() => setAiDescError(null), 4000)
      setAiDescBusy(false)
    })
  }

  // ── Edición inline (identidad, descripción, notas, packaging, avanzado, target FC) ──
  // Nombre y precio: EDICIÓN QUE FALTABA (hallazgo en revisión, no del agente
  // de la Fase 4) — la Fase 1 nunca implementó el modo "Editar" de la
  // identidad que sí tenía CatalogProductDetailPage.tsx (nombre/precio/
  // descripción juntos), y ninguna revisión posterior lo tocó al no rozar la
  // cabecera. Se recupera aquí con el mismo patrón saveField del resto de
  // campos de esta pestaña, y la MISMA validación que tenía el original.
  const [nameVal, setNameVal] = useState('')
  const [priceVal, setPriceVal] = useState('')
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [descriptionVal, setDescriptionVal] = useState('')
  const [notesVal, setNotesVal] = useState('')
  const [packDesc, setPackDesc] = useState('')
  const [packCost, setPackCost] = useState('')
  const [kitchenNameVal, setKitchenNameVal] = useState('')
  const [shortNameVal, setShortNameVal] = useState('')
  const [targetFcVal, setTargetFcVal] = useState('')
  const [fieldSaving, setFieldSaving] = useState<string | null>(null)

  useEffect(() => {
    setNameVal(item.name)
    setPriceVal(String(item.price ?? ''))
    setDescriptionVal(item.description ?? '')
    setNotesVal(item.notesInternal ?? '')
    setPackDesc(item.packagingDescription ?? '')
    setPackCost(item.packagingCost != null ? String(item.packagingCost) : '')
    setKitchenNameVal(item.kitchenName ?? '')
    setShortNameVal(item.shortName ?? '')
    setTargetFcVal(item.targetFoodCostPct != null ? String(item.targetFoodCostPct) : '')
  }, [
    item.id, item.name, item.price, item.description, item.notesInternal,
    item.packagingDescription, item.packagingCost, item.kitchenName,
    item.shortName, item.targetFoodCostPct,
  ])

  // Nombre + precio, con la MISMA validación que tenía save() en el original.
  async function saveIdentity() {
    const trimmed = nameVal.trim()
    if (trimmed === '') { setIdentityError('El nombre es obligatorio.'); return }
    const priceNum = Number(priceVal.replace(',', '.'))
    if (!Number.isFinite(priceNum) || priceNum < 0) { setIdentityError('El precio no es válido.'); return }
    setIdentityError(null)
    setFieldSaving('identity')
    try {
      await updateMenuItem(item.id, { name: trimmed, price: priceNum })
      onItemChanged()
    } catch (err: unknown) {
      setIdentityError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setFieldSaving(null)
    }
  }

  async function saveField(key: string, patch: MenuItemUpdate) {
    setFieldSaving(key)
    try {
      await updateMenuItem(item.id, patch)
      onItemChanged()
    } catch (err: unknown) {
      console.error('FichaTab: guardado de campo falló', err)
    } finally {
      setFieldSaving(null)
    }
  }

  // Descripción: gap cazado en el checklist de la Fase 7 (fila 29) — en el
  // original, nombre+precio+descripción se guardaban juntos con un único
  // saveError VISIBLE; al desacoplar la descripción a su propio campo quedó
  // usando el saveField genérico (silencioso, solo console.error, igual que
  // notas/packaging). Se le da su propio error visible, sin tocar el patrón
  // silencioso del resto de campos (ese sí es fiel al original).
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  async function saveDescription() {
    setDescriptionError(null)
    setFieldSaving('desc')
    try {
      await updateMenuItem(item.id, { description: descriptionVal.trim() === '' ? null : descriptionVal.trim() })
      onItemChanged()
    } catch (err: unknown) {
      setDescriptionError(err instanceof Error ? err.message : 'No se pudo guardar la descripción.')
    } finally {
      setFieldSaving(null)
    }
  }

  return (
    <div className="space-y-8">
      {lightboxOpen && item.photoUrl && (
        <PhotoLightbox src={item.photoUrl} onClose={() => setLightboxOpen(false)} />
      )}

      {/* Fase 6, B3: antes confirmación inline (photoConfirmDelete Sí/Cancelar). */}
      <ConfirmDialog
        open={photoConfirmDelete}
        title="Eliminar foto"
        message="¿Eliminar la foto del producto?"
        tone="danger"
        confirmLabel="Eliminar"
        busy={photoDeleting}
        onConfirm={onPhotoDelete}
        onCancel={() => setPhotoConfirmDelete(false)}
      />

      {/* Foto pública del producto */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">Foto del producto</h3>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />
        {photoError && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs flex items-center justify-between gap-3">
            <span>{photoError}</span>
            <button onClick={() => setPhotoError(null)} className="text-red-500 hover:text-red-700 shrink-0" aria-label="Cerrar aviso">
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={() => (item.photoUrl ? setLightboxOpen(true) : fileInputRef.current?.click())}
            disabled={photoUploading}
            className="relative w-40 h-32 rounded-lg overflow-hidden border border-stone-200 bg-gradient-to-br from-[#D4B896] via-[#B89B78] to-[#8B7355] flex items-center justify-center shrink-0 disabled:opacity-60"
            aria-label={item.photoUrl ? 'Ver foto del producto' : 'Añadir foto del producto'}
          >
            {photoUploading ? (
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            ) : item.photoUrl ? (
              <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <Camera size={28} className="text-white/70" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={photoUploading || photoDeleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-200 text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors"
              >
                {photoUploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                {photoUploading ? 'Subiendo…' : item.photoUrl ? 'Cambiar' : 'Añadir foto'}
              </button>
              {item.photoUrl && (
                <button
                  onClick={() => setPhotoConfirmDelete(true)}
                  disabled={photoUploading || photoDeleting}
                  aria-label="Eliminar foto"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {photoDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {photoDeleting ? 'Eliminando…' : 'Eliminar'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Identidad: nombre y precio base del producto de venta (menu_item) —
          recuperado en revisión, ver nota arriba. Distinto del nombre PROPIO
          del escandallo (recipe_item.name), editable desde la pestaña
          Escandallo. */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">Identidad</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Nombre</label>
            <input
              type="text" value={nameVal} onChange={(e) => setNameVal(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Precio base (€ IVA incluido)</label>
            <input
              type="text" inputMode="decimal" value={priceVal} onChange={(e) => setPriceVal(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
        </div>
        {identityError && <p className="text-xs text-red-600 mt-2">{identityError}</p>}
        {(nameVal !== item.name || priceVal !== String(item.price ?? '')) && (
          <button
            onClick={saveIdentity}
            disabled={fieldSaving === 'identity'}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {fieldSaving === 'identity' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar
          </button>
        )}
      </div>

      {/* Descripción del producto */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">Descripción</h3>
          {/* A1: cableado real (Fase 6) — sugiere texto, nunca auto-guarda. */}
          <button
            type="button"
            onClick={improveDescriptionAI}
            disabled={aiDescBusy}
            title="Pide a la IA una sugerencia de descripción — la puedes editar antes de guardar"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
          >
            {aiDescBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {aiDescBusy ? 'Pensando…' : 'Mejorar descripción con IA'}
          </button>
        </div>
        {aiDescError && <p className="text-xs text-red-600 mb-2">{aiDescError}</p>}
        <textarea
          value={descriptionVal}
          onChange={(e) => setDescriptionVal(e.target.value)}
          rows={3}
          placeholder="Descripción visible en carta…"
          className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
        {descriptionError && <p className="text-xs text-red-600 mt-2">{descriptionError}</p>}
        {descriptionVal !== (item.description ?? '') && (
          <button
            onClick={saveDescription}
            disabled={fieldSaving === 'desc'}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {fieldSaving === 'desc' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar descripción
          </button>
        )}
      </div>

      {/* Notas internas (S8) */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">Notas internas</h3>
        <textarea
          value={notesVal}
          onChange={(e) => setNotesVal(e.target.value)}
          rows={3}
          placeholder="Notas del equipo (no visibles al cliente)…"
          className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
        {notesVal !== (item.notesInternal ?? '') && (
          <button
            onClick={() => saveField('notes', { notesInternal: notesVal.trim() === '' ? null : notesVal })}
            disabled={fieldSaving === 'notes'}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {fieldSaving === 'notes' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar nota
          </button>
        )}
        <p className="text-[11px] text-stone-400 mt-2">
          {item.createdByName ? `Creado por ${item.createdByName} · ` : ''}Actualizado {fmtDate(item.updatedAt)}
        </p>
      </div>

      {/* Envases para reparto (S9) */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">Envases para reparto</h3>
        {!item.packagingDescription && item.packagingCost == null && (
          <p className="text-sm text-stone-500 mb-3">Sin información de envases.</p>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Descripción del envase</label>
            <textarea
              value={packDesc}
              onChange={(e) => setPackDesc(e.target.value)}
              rows={2}
              placeholder="Envase, bolsa, tapa…"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Coste de envases (€/unidad)</label>
            <input
              type="text" inputMode="decimal" value={packCost} onChange={(e) => setPackCost(e.target.value)}
              className="w-40 px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
          {(packDesc !== (item.packagingDescription ?? '') || packCost !== (item.packagingCost != null ? String(item.packagingCost) : '')) && (
            <button
              onClick={() => saveField('pack', {
                packagingDescription: packDesc.trim() === '' ? null : packDesc,
                packagingCost: packCost.trim() === '' ? null : Number(packCost.replace(',', '.')),
              })}
              disabled={fieldSaving === 'pack'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {fieldSaving === 'pack' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Guardar envases
            </button>
          )}
        </div>
      </div>

      {/* Objetivo de food cost (target_food_cost_pct) — EDITABLE, única pieza
          de lógica nueva permitida en esta fase. La comparación "Dentro/Fuera
          del objetivo" sigue viviendo en Economía.
          "Food cost" se queda en inglés a propósito (decisión de Julio,
          auditoría externa) -- término estándar del sector, no spanglish
          descuidado. Ver EconomiaTab.tsx para la nota completa. */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">Objetivo de food cost</h3>
        <label className="block text-xs font-medium text-stone-500 mb-1.5">Objetivo de food cost (%)</label>
        <input
          type="text" inputMode="decimal" value={targetFcVal} onChange={(e) => setTargetFcVal(e.target.value)}
          placeholder="Sin definir"
          className="w-32 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
        {targetFcVal !== (item.targetFoodCostPct != null ? String(item.targetFoodCostPct) : '') && (
          <button
            onClick={() => saveField('tfc', {
              targetFoodCostPct: targetFcVal.trim() === '' ? null : Number(targetFcVal.replace(',', '.')),
            })}
            disabled={fieldSaving === 'tfc'}
            className="mt-1.5 ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {fieldSaving === 'tfc' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar
          </button>
        )}
        <p className="text-[11px] text-stone-400 mt-1.5">La comparación "Dentro/Fuera del objetivo" se ve en la pestaña Economía.</p>
      </div>

      {/* Avanzado (S11) — SIN "External ID" (dead, decisión ya tomada) */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">Avanzado</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Nombre de cocina (kitchen name)</label>
            <input
              type="text" value={kitchenNameVal} onChange={(e) => setKitchenNameVal(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            {kitchenNameVal !== (item.kitchenName ?? '') && (
              <button
                onClick={() => saveField('kn', { kitchenName: kitchenNameVal.trim() === '' ? null : kitchenNameVal })}
                disabled={fieldSaving === 'kn'}
                className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {fieldSaving === 'kn' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Nombre corto (short name)</label>
            <input
              type="text" value={shortNameVal} onChange={(e) => setShortNameVal(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            {shortNameVal !== (item.shortName ?? '') && (
              <button
                onClick={() => saveField('sn', { shortName: shortNameVal.trim() === '' ? null : shortNameVal })}
                disabled={fieldSaving === 'sn'}
                className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {fieldSaving === 'sn' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar
              </button>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-stone-500 mb-1.5">Código interno</div>
            <div className="font-mono text-sm text-stone-600">{item.id.slice(0, 8)}</div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-stone-200 text-[11px] text-stone-400 flex flex-wrap gap-x-6 gap-y-1">
          <span>Creado: {fmtDate(item.createdAt)}</span>
          <span>Actualizado: {fmtDate(item.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}
