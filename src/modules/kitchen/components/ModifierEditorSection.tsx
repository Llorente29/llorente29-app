// src/modules/kitchen/components/ModifierEditorSection.tsx
//
// Mitad "asignación" de la pestaña "Modificadores" de la ficha unificada de
// plato (CatalogFichaPage). Extraído MECÁNICAMENTE de
// CatalogProductDetailPage.tsx (función local `ModifierEditorSection`, antes
// en la sección S4 "Modificadores" — junto con el helper `kitchenPreview`,
// que vivía justo encima). Ver plan
// C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md, Fase 3.
// Regla de oro: unificar no pierde nada — "mover, no inventar".
//
// menu_item-scoped: gestiona QUÉ grupos de modificadores tiene asignados un
// producto (crear/asignar/quitar grupo, editar nombre/tipo/obligatorio/máximo,
// opciones con "Defecto"/precio) y el preview "Así lo ve cocina" (reutiliza
// childVisual — la MISMA función que pinta el ticket real — para que el
// preview no pueda mentir). Convive en la misma pestaña con ModifierImpactsTab
// (recipe_item-scoped, impacto en COSTE de cada opción — NO se toca aquí).
//
// La pregunta "¿existe producto?" NO la decide este componente: la resuelve
// el padre (CatalogFichaPage) con su propio `item`/`activeMenuItemId` ya
// cargado, y solo monta este componente cuando hay producto anclado — mismo
// patrón que evitó el bug de "dos fuentes que se contradicen" cazado por
// Julio en la Fase 2 (cabecera vs. "Coste en vivo").
//
// onGroupsChanged: callback opcional que el padre usa para refrescar
// ModifierImpactsTab (remount por key/tick) cuando cambia QUÉ grupos tiene el
// producto — crear grupo nuevo, asignar uno existente, o quitar un grupo. NO
// se llama al editar nombre/tipo/opciones/precio de un grupo ya asignado (eso
// no cambia el conjunto de grupos, solo sus detalles).

import { useEffect, useState } from 'react'
import { Plus, Sparkles, Trash2, X } from 'lucide-react'
import {
  getProductModifierGroupsEditable,
  createGroupForProduct, updateGroup, unassignGroupFromProduct, assignExistingGroup,
  addModifierOption, updateModifierOption, deleteModifierOption,
  listAssignableGroups,
  type ModifierGroupDetail, type ModifierOptionDetail, type ExistingGroup,
} from '@/modules/kitchen/services/modifierEditService'
import {
  listOptionsWithImpacts, confirmImpact, rejectImpact, requestAIProposals,
  type OptionWithImpact,
} from '@/modules/kitchen/services/modifierImpactService'
import { childVisual } from '@/modules/orders/services/ordersFeedService'
import ConfirmDialog from '@/components/ConfirmDialog'

/**
 * Cómo se verá una opción de modificador en el TICKET DE COCINA.
 * Espejo fiel de modifierLines() del ticketRenderer: reutiliza childVisual (la
 * MISMA función que pinta el ticket real) → el preview no puede mentir.
 * Construye el OrderFeedChild mínimo que childVisual necesita (line_type + group_type
 * + name); el resto de campos no influye en el tono.
 */
function kitchenPreview(optName: string, groupType: string): { text: string; tone: string } {
  const child = {
    line_id: '', name: optName, qty: 1, line_type: 'modifier',
    group_type: groupType as never, menu_item_id: null, family: null,
    family_color: null, menu_category: null, customer_note: null,
  }
  const v = childVisual(child)
  const prefix = v.tone === 'remove' ? 'SIN ' : v.tone === 'add' ? '+ ' : ''
  const cleanName = optName.replace(/^\s*(sin|no|quitar|without|sans)\s+/i, '')
  return { text: prefix + (v.tone === 'remove' ? cleanName : optName), tone: v.tone }
}

interface ModifierEditorSectionProps {
  accountId: string
  brandId: string | null
  menuItemId: string
  recipeItemId: string | null
  /** Se llama tras crear/asignar/quitar un grupo (no tras editar detalles de
   * uno ya asignado) — el padre lo usa para refrescar ModifierImpactsTab. */
  onGroupsChanged?: () => void
}

export default function ModifierEditorSection({
  accountId, brandId, menuItemId, recipeItemId, onGroupsChanged,
}: ModifierEditorSectionProps) {
  const [groups, setGroups] = useState<ModifierGroupDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // edición inline nombre de grupo / opción
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [editingOpt, setEditingOpt] = useState<string | null>(null)
  const [optNameDraft, setOptNameDraft] = useState('')
  // asignar grupo existente
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignable, setAssignable] = useState<ExistingGroup[]>([])
  // impactos de coste por opción (capa C): optionId -> impacto
  const [impacts, setImpacts] = useState<Map<string, OptionWithImpact>>(new Map())
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  // Fase 6, B5: confirmación antes de borrar (antes disparaba al instante).
  const [confirmRemoveGroup, setConfirmRemoveGroup] = useState<ModifierGroupDetail | null>(null)
  const [confirmRemoveOpt, setConfirmRemoveOpt] = useState<{ id: string; name: string } | null>(null)

  function loadImpacts() {
    listOptionsWithImpacts(menuItemId)
      .then((opts) => setImpacts(new Map(opts.map((o) => [o.optionId, o]))))
      .catch(() => {})
  }

  function reload() {
    return getProductModifierGroupsEditable(accountId, menuItemId)
      .then((g) => { setGroups(g); loadImpacts() })
      .catch((e) => setErr(String(e.message ?? e)))
  }

  useEffect(() => {
    setLoading(true)
    getProductModifierGroupsEditable(accountId, menuItemId)
      .then((g) => { setGroups(g); loadImpacts() })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }, [accountId, menuItemId])

  // `notifyGroupsChanged`: solo las mutaciones que cambian QUÉ grupos tiene el
  // producto (crear/asignar/quitar) avisan al padre — editar detalles de un
  // grupo ya asignado no cambia el conjunto, así que no dispara el tick.
  function wrap(fn: () => Promise<unknown>, opts?: { notifyGroupsChanged?: boolean }) {
    setBusy(true); setErr(null)
    fn()
      .then(reload)
      .then(() => { if (opts?.notifyGroupsChanged) onGroupsChanged?.() })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false))
  }

  // ── Coste del modificador (capa C): IA propone / humano confirma ──
  function askAI() {
    if (!recipeItemId) { setErr('El producto no tiene escandallo; la IA necesita la receta para proponer el coste.'); return }
    setAiBusy(true); setAiMsg(null); setErr(null)
    requestAIProposals(accountId, recipeItemId)
      .then((r) => {
        setAiMsg(`IA: ${r.propuestos} propuestas en ${r.procesados} opciones (${r.sin_propuesta} sin propuesta).`)
        loadImpacts()
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setAiBusy(false))
  }
  function confirmOptImpact(impactId: string) {
    setBusy(true); setErr(null)
    confirmImpact(impactId, 'Confirmado en ficha').then(loadImpacts).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false))
  }
  function rejectOptImpact(impactId: string) {
    setBusy(true); setErr(null)
    rejectImpact(impactId).then(loadImpacts).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false))
  }

  // ── Grupos ──
  function addGroup() {
    if (!brandId) { setErr('El producto no tiene marca; no se puede crear el grupo.'); return }
    wrap(() => createGroupForProduct(accountId, brandId, menuItemId, 'Nuevo grupo', 'choice', 0, 1), { notifyGroupsChanged: true })
  }
  function startRenameGroup(g: ModifierGroupDetail) { setEditingGroup(g.id); setGroupNameDraft(g.name) }
  function saveRenameGroup(groupId: string) {
    const name = groupNameDraft.trim(); setEditingGroup(null)
    if (!name) return
    wrap(() => updateGroup(accountId, groupId, { name }))
  }
  function setGroupType(g: ModifierGroupDetail, t: string) { wrap(() => updateGroup(accountId, g.id, { groupType: t })) }
  function setGroupRequired(g: ModifierGroupDetail, required: boolean) {
    wrap(() => updateGroup(accountId, g.id, { minSelections: required ? Math.max(1, g.minSelections) : 0 }))
  }
  function setGroupMax(g: ModifierGroupDetail, max: number) {
    const m = Math.max(1, max)
    wrap(() => updateGroup(accountId, g.id, { maxSelections: m, minSelections: Math.min(g.minSelections, m) }))
  }
  function doRemoveGroup() {
    if (!confirmRemoveGroup) return
    const id = confirmRemoveGroup.id
    setConfirmRemoveGroup(null)
    wrap(() => unassignGroupFromProduct(accountId, id, menuItemId), { notifyGroupsChanged: true })
  }

  // ── Opciones ──
  function addOpt(groupId: string) { wrap(() => addModifierOption(accountId, groupId, 'Nueva opción', 0, false)) }
  function startRenameOpt(o: ModifierOptionDetail) { setEditingOpt(o.id); setOptNameDraft(o.name) }
  function saveRenameOpt(optId: string) {
    const name = optNameDraft.trim(); setEditingOpt(null)
    if (!name) return
    wrap(() => updateModifierOption(accountId, optId, { name }))
  }
  function setOptPrice(optId: string, raw: string) {
    const v = raw.trim() === '' ? 0 : Number(raw.replace(',', '.'))
    if (Number.isNaN(v)) return
    wrap(() => updateModifierOption(accountId, optId, { priceImpact: v }))
  }
  function toggleOptDefault(o: ModifierOptionDetail) { wrap(() => updateModifierOption(accountId, o.id, { isDefault: !o.isDefault })) }
  function doRemoveOpt() {
    if (!confirmRemoveOpt) return
    const id = confirmRemoveOpt.id
    setConfirmRemoveOpt(null)
    wrap(() => deleteModifierOption(accountId, id))
  }

  // ── Asignar grupo existente ──
  function openAssign() {
    if (!brandId) return
    setAssignOpen(true)
    listAssignableGroups(accountId, brandId, menuItemId).then(setAssignable).catch(() => setAssignable([]))
  }
  function pickAssign(groupId: string) {
    setAssignOpen(false)
    wrap(() => assignExistingGroup(accountId, groupId, menuItemId), { notifyGroupsChanged: true })
  }

  if (loading) return <p className="text-sm text-stone-400">Cargando modificadores…</p>

  return (
    <div className="space-y-3">
      {err && <div className="p-2 rounded-lg bg-red-50 text-red-700 text-xs">{err}</div>}

      {groups.length === 0 && (
        <p className="text-sm text-stone-500">Este producto no tiene modificadores. Crea un grupo o asigna uno existente.</p>
      )}

      {groups.map((g) => {
        const required = g.minSelections >= 1
        return (
          <div key={g.id} className="border border-stone-200 rounded-lg overflow-hidden">
            {/* Cabecera del grupo */}
            <div className="px-3 py-2 bg-stone-50 space-y-2">
              <div className="flex items-center gap-2">
                {editingGroup === g.id ? (
                  <input autoFocus value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    onBlur={() => saveRenameGroup(g.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRenameGroup(g.id); if (e.key === 'Escape') setEditingGroup(null) }}
                    className="flex-1 text-sm font-medium px-2 py-1 border border-stone-300 rounded" />
                ) : (
                  <button onClick={() => startRenameGroup(g)} className="flex-1 text-left text-sm font-medium hover:text-accent" title="Renombrar grupo">
                    {g.name}
                  </button>
                )}
                <button onClick={() => setConfirmRemoveGroup(g)} disabled={busy} className="text-stone-400 hover:text-red-600 p-1" title="Quitar grupo de este producto">
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Aviso de reutilización */}
              {g.usageCount > 1 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Este grupo se usa en {g.usageCount} productos. Los cambios afectan a todos.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <select value={g.groupType} disabled={busy} onChange={(e) => setGroupType(g, e.target.value)}
                  className="text-[11px] px-1.5 py-1 border border-stone-300 rounded bg-white">
                  <option value="choice">Elegir</option>
                  <option value="extras">Extras</option>
                  <option value="removal">Quitar</option>
                  <option value="size">Tamaño</option>
                </select>
                <label className="flex items-center gap-1 text-[11px] text-stone-600 cursor-pointer">
                  <input type="checkbox" checked={required} disabled={busy} onChange={(e) => setGroupRequired(g, e.target.checked)} />
                  Obligatorio
                </label>
                <label className="flex items-center gap-1 text-[11px] text-stone-600">
                  Elige hasta
                  <input type="number" min={1} value={g.maxSelections} disabled={busy}
                    onChange={(e) => setGroupMax(g, Number(e.target.value))}
                    className="w-12 px-1 py-0.5 border border-stone-300 rounded text-center" />
                </label>
              </div>
            </div>

            {/* Previsualización de cocina (capa D): cómo se verá en el ticket */}
            {g.options.length > 0 && (
              <div className="mx-3 mt-2 rounded-md bg-zinc-900 px-3 py-2 font-mono text-[12px] leading-relaxed">
                <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1">Así lo ve cocina</div>
                {g.options.map((o) => {
                  const kp = kitchenPreview(o.name, g.groupType)
                  const color = kp.tone === 'remove' ? 'text-red-400 font-bold'
                    : kp.tone === 'add' ? 'text-amber-300'
                    : 'text-zinc-300'
                  return <div key={o.id} className={`pl-3 ${color}`}>{kp.text}</div>
                })}
              </div>
            )}

            {/* Opciones */}
            <div className="px-3 py-2 space-y-1.5">
              {g.options.length === 0 && <p className="text-xs text-stone-400">Sin opciones.</p>}
              {g.options.map((o) => {
                const oi = impacts.get(o.id)
                const imp = oi?.impact ?? null
                return (
                <div key={o.id} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm">
                  {editingOpt === o.id ? (
                    <input autoFocus value={optNameDraft}
                      onChange={(e) => setOptNameDraft(e.target.value)}
                      onBlur={() => saveRenameOpt(o.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRenameOpt(o.id); if (e.key === 'Escape') setEditingOpt(null) }}
                      className="flex-1 px-2 py-0.5 border border-stone-300 rounded" />
                  ) : (
                    <button onClick={() => startRenameOpt(o)} className="flex-1 text-left truncate hover:text-accent" title="Renombrar opción">
                      {o.name}
                    </button>
                  )}
                  <label className="flex items-center gap-1 text-[11px] text-stone-500" title="Opción por defecto">
                    <input type="checkbox" checked={o.isDefault} disabled={busy} onChange={() => toggleOptDefault(o)} />
                    Defecto
                  </label>
                  <div className="flex items-center gap-0.5 text-[11px] text-stone-500" title="Suplemento de precio (€)">
                    <span>+€</span>
                    <input type="text" defaultValue={o.priceImpact ? String(o.priceImpact) : ''} placeholder="0" disabled={busy}
                      onBlur={(e) => setOptPrice(o.id, e.target.value)}
                      className="w-14 px-1 py-0.5 border border-stone-200 rounded text-right" />
                  </div>
                  <button onClick={() => setConfirmRemoveOpt({ id: o.id, name: o.name })} disabled={busy} className="text-stone-300 hover:text-red-600 p-0.5" title="Quitar opción">
                    <X size={13} />
                  </button>
                  </div>

                  {/* Estado de coste del modificador (capa C: IA propone / humano confirma) */}
                  <div className="flex items-center gap-2 pl-1 text-[11px]">
                    {imp === null && (
                      <span className="text-stone-400">Coste sin definir</span>
                    )}
                    {imp && imp.status === 'proposed' && (
                      <>
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <Sparkles size={11} /> IA propone
                          {imp.confidence != null && <span className="text-amber-500">({Math.round(imp.confidence * 100)}%)</span>}
                          {imp.rationale && <span className="text-stone-400 truncate max-w-[180px]" title={imp.rationale}>· {imp.rationale}</span>}
                        </span>
                        <button onClick={() => confirmOptImpact(imp.id)} disabled={busy}
                          className="text-green-700 hover:underline font-medium">Confirmar</button>
                        <button onClick={() => rejectOptImpact(imp.id)} disabled={busy}
                          className="text-stone-400 hover:text-red-600">Rechazar</button>
                      </>
                    )}
                    {imp && imp.status === 'confirmed' && (
                      <span className="inline-flex items-center gap-1 text-green-700" title={imp.rationale ?? undefined}>
                        Coste confirmado
                        {imp.confirmedByName && <span className="text-stone-400">· {imp.confirmedByName}</span>}
                      </span>
                    )}
                  </div>
                </div>
                )
              })}
              <button onClick={() => addOpt(g.id)} disabled={busy}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline mt-1">
                <Plus size={12} /> Añadir opción
              </button>
            </div>
          </div>
        )
      })}

      {/* Acciones: crear grupo / asignar existente */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={addGroup} disabled={busy || !brandId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-50">
          <Plus size={13} /> Nuevo grupo
        </button>
        <button onClick={openAssign} disabled={busy || !brandId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-50">
          Asignar grupo existente
        </button>
        {groups.length > 0 && (
          <button onClick={askAI} disabled={aiBusy || busy || !recipeItemId}
            title={!recipeItemId ? 'El producto necesita escandallo para que la IA proponga el coste' : 'La IA propone el impacto en coste de las opciones sin definir'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
            <Sparkles size={13} /> {aiBusy ? 'Pidiendo a la IA…' : 'Pedir coste con IA'}
          </button>
        )}
      </div>

      {aiMsg && <div className="p-2 rounded-lg bg-amber-50 text-amber-800 text-xs">{aiMsg}</div>}

      {/* Picker de grupos existentes */}
      {assignOpen && (
        <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 text-xs space-y-1.5">
          <p className="text-stone-600 mb-1">Grupos de la marca para reutilizar:</p>
          {assignable.length === 0 ? (
            <p className="text-stone-400">No hay otros grupos disponibles.</p>
          ) : (
            <div className="max-h-52 overflow-y-auto divide-y divide-stone-100">
              {assignable.map((g) => (
                <button key={g.id} onClick={() => pickAssign(g.id)} disabled={busy}
                  className="flex items-center justify-between w-full px-2 py-1.5 hover:bg-white text-left">
                  <span className="truncate">{g.name}</span>
                  <span className="text-stone-400 ml-2 shrink-0">{g.optionCount} opc · en {g.usageCount} prod.</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setAssignOpen(false)} className="text-stone-500 underline">Cerrar</button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemoveGroup !== null}
        title="Quitar grupo"
        message={confirmRemoveGroup ? `¿Quitar el grupo «${confirmRemoveGroup.name}» de este producto? Se perderán sus opciones para este producto.` : ''}
        tone="danger"
        confirmLabel="Quitar"
        busy={busy}
        onConfirm={doRemoveGroup}
        onCancel={() => setConfirmRemoveGroup(null)}
      />
      <ConfirmDialog
        open={confirmRemoveOpt !== null}
        title="Quitar opción"
        message={confirmRemoveOpt ? `¿Quitar la opción «${confirmRemoveOpt.name}»?` : ''}
        tone="danger"
        confirmLabel="Quitar"
        busy={busy}
        onConfirm={doRemoveOpt}
        onCancel={() => setConfirmRemoveOpt(null)}
      />
    </div>
  )
}
