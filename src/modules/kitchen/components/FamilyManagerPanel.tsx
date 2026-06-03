// src/modules/kitchen/components/FamilyManagerPanel.tsx
//
// Gestor de familias de INGREDIENTE (paso G3). Panel modal. CRUD completo:
// crear familia raíz / subfamilia, renombrar, categoría contable, archivar (con
// reasignación de ingredientes), reordenar (flechas ↑↓). 2 niveles (AECOC/Apicbase).
//
// Cada negocio modela su propia taxonomía: por eso es CRUD completo, no fijo.

import { useEffect, useState, useCallback } from 'react'
import {
  X, Plus, Pencil, Archive, ChevronUp, ChevronDown, Check, FolderTree, CornerDownRight,
} from 'lucide-react'
import {
  listFamilyTree,
  createIngredientFamily,
  updateIngredientFamily,
  archiveIngredientFamily,
  reorderFamilies,
  type FamilyNode,
} from '@/modules/kitchen/services/ingredientFamilyService'

export default function FamilyManagerPanel({
  accountId,
  onClose,
  onChanged,
}: {
  accountId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [tree, setTree] = useState<FamilyNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)            // ¿se cambió algo? (refrescar al cerrar)
  const [busy, setBusy] = useState(false)

  // Estado de edición inline / alta.
  const [newRootName, setNewRootName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAccounting, setEditAccounting] = useState('')
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null)
  const [childName, setChildName] = useState('')
  // Archivar: familia a archivar + destino de reasignación.
  const [archiving, setArchiving] = useState<FamilyNode | null>(null)
  const [reassignTo, setReassignTo] = useState<string>('__none__')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setTree(await listFamilyTree(accountId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando familias')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { load() }, [load])

  function close() {
    if (dirty) onChanged()
    else onClose()
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); setDirty(true); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  // Lista plana de raíces (para el desplegable de reasignación al archivar).
  const allRoots = tree

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="family-mgr-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={close}
    >
      <div
        className="bg-card w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <FolderTree size={18} className="text-accent" />
            <h3 id="family-mgr-title" className="text-base font-medium text-text-primary">Gestionar familias</h3>
          </div>
          <button type="button" aria-label="Cerrar" onClick={close}
            className="text-text-secondary hover:text-text-primary transition-base">
            <X size={18} />
          </button>
        </div>

        {/* Alta de familia raíz */}
        <div className="px-4 py-3 border-b border-border-default bg-page flex items-center gap-2">
          <input
            type="text" value={newRootName} onChange={e => setNewRootName(e.target.value)}
            placeholder="Nueva familia (p. ej. Especias)"
            className="flex-1 px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            onKeyDown={e => { if (e.key === 'Enter' && newRootName.trim()) {
              run(async () => { await createIngredientFamily({ accountId, name: newRootName }); setNewRootName('') })
            }}}
          />
          <button type="button" disabled={busy || !newRootName.trim()}
            onClick={() => run(async () => { await createIngredientFamily({ accountId, name: newRootName }); setNewRootName('') })}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            <Plus size={15} /> Añadir
          </button>
        </div>

        {/* Cuerpo: árbol */}
        <div className="px-4 py-3 overflow-y-auto">
          {loading && <p className="py-8 text-center text-sm text-text-secondary">Cargando…</p>}
          {!loading && error && (
            <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm mb-2">{error}</div>
          )}
          {!loading && !error && tree.length === 0 && (
            <p className="py-8 text-center text-sm text-text-secondary">No hay familias todavía. Crea la primera arriba.</p>
          )}

          {!loading && tree.map((root, i) => (
            <div key={root.id} className="mb-1.5">
              <FamilyRow
                node={root} depth={0} busy={busy}
                isFirst={i === 0} isLast={i === tree.length - 1}
                editingId={editingId} editName={editName} editAccounting={editAccounting}
                onEditStart={() => { setEditingId(root.id); setEditName(root.name); setEditAccounting(root.accountingCategory ?? '') }}
                onEditName={setEditName} onEditAccounting={setEditAccounting}
                onEditSave={() => run(async () => {
                  await updateIngredientFamily(root.id, { name: editName, accountingCategory: editAccounting || null })
                  setEditingId(null)
                })}
                onEditCancel={() => setEditingId(null)}
                onAddChild={() => { setAddingChildTo(root.id); setChildName('') }}
                onArchive={() => { setArchiving(root); setReassignTo('__none__') }}
                onMoveUp={() => run(async () => {
                  const prev = tree[i - 1]
                  await reorderFamilies([{ id: root.id, position: prev.position ?? i - 1 }, { id: prev.id, position: root.position ?? i }])
                })}
                onMoveDown={() => run(async () => {
                  const next = tree[i + 1]
                  await reorderFamilies([{ id: root.id, position: next.position ?? i + 1 }, { id: next.id, position: root.position ?? i }])
                })}
              />

              {/* Alta de subfamilia bajo esta raíz */}
              {addingChildTo === root.id && (
                <div className="flex items-center gap-2 pl-7 py-1.5">
                  <CornerDownRight size={14} className="text-text-secondary shrink-0" />
                  <input
                    type="text" value={childName} onChange={e => setChildName(e.target.value)} autoFocus
                    placeholder="Nueva subfamilia"
                    className="flex-1 px-2.5 py-1.5 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    onKeyDown={e => { if (e.key === 'Enter' && childName.trim()) {
                      run(async () => { await createIngredientFamily({ accountId, name: childName, parentFamilyId: root.id }); setAddingChildTo(null) })
                    } else if (e.key === 'Escape') { setAddingChildTo(null) }}}
                  />
                  <button type="button" disabled={busy || !childName.trim()}
                    onClick={() => run(async () => { await createIngredientFamily({ accountId, name: childName, parentFamilyId: root.id }); setAddingChildTo(null) })}
                    className="px-2.5 py-1.5 rounded-md text-sm bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                    <Check size={15} />
                  </button>
                  <button type="button" onClick={() => setAddingChildTo(null)}
                    className="px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary">✕</button>
                </div>
              )}

              {/* Subfamilias */}
              {root.children.map((child, j) => (
                <FamilyRow
                  key={child.id} node={child} depth={1} busy={busy}
                  isFirst={j === 0} isLast={j === root.children.length - 1}
                  editingId={editingId} editName={editName} editAccounting={editAccounting}
                  onEditStart={() => { setEditingId(child.id); setEditName(child.name); setEditAccounting(child.accountingCategory ?? '') }}
                  onEditName={setEditName} onEditAccounting={setEditAccounting}
                  onEditSave={() => run(async () => {
                    await updateIngredientFamily(child.id, { name: editName, accountingCategory: editAccounting || null })
                    setEditingId(null)
                  })}
                  onEditCancel={() => setEditingId(null)}
                  onArchive={() => { setArchiving(child); setReassignTo('__none__') }}
                  onMoveUp={() => run(async () => {
                    const prev = root.children[j - 1]
                    await reorderFamilies([{ id: child.id, position: prev.position ?? j - 1 }, { id: prev.id, position: child.position ?? j }])
                  })}
                  onMoveDown={() => run(async () => {
                    const next = root.children[j + 1]
                    await reorderFamilies([{ id: child.id, position: next.position ?? j + 1 }, { id: next.id, position: child.position ?? j }])
                  })}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Pie */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button type="button" onClick={close}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base">
            {dirty ? 'Cerrar y refrescar' : 'Cerrar'}
          </button>
        </div>
      </div>

      {/* Sub-modal: archivar con reasignación */}
      {archiving && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setArchiving(null)}>
          <div className="bg-card max-w-md w-full rounded-xl shadow-xl p-4" onClick={e => e.stopPropagation()}>
            <h4 className="text-base font-medium text-text-primary mb-2">Archivar “{archiving.name}”</h4>
            <p className="text-sm text-text-secondary mb-3">
              {archiving.itemCount > 0
                ? `Esta familia tiene ${archiving.itemCount} ingrediente${archiving.itemCount === 1 ? '' : 's'}. ¿A dónde los movemos?`
                : 'Esta familia no tiene ingredientes asignados.'}
              {archiving.children.length > 0 && ' Sus subfamilias también se archivarán.'}
            </p>
            {archiving.itemCount > 0 && (
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                className="w-full mb-3 px-2.5 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
                <option value="__none__">Dejar sin clasificar</option>
                {allRoots.filter(r => r.id !== archiving.id).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setArchiving(null)}
                className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page">Cancelar</button>
              <button type="button" disabled={busy}
                onClick={() => {
                  const dest = reassignTo === '__none__' ? null : reassignTo
                  const fam = archiving
                  setArchiving(null)
                  run(async () => { await archiveIngredientFamily(accountId, fam.id, dest) })
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-danger text-white hover:opacity-90 disabled:opacity-50 transition-base">
                <Archive size={15} /> Archivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Una fila de familia (raíz o subfamilia) ──
function FamilyRow({
  node, depth, busy, isFirst, isLast,
  editingId, editName, editAccounting,
  onEditStart, onEditName, onEditAccounting, onEditSave, onEditCancel,
  onAddChild, onArchive, onMoveUp, onMoveDown,
}: {
  node: FamilyNode; depth: number; busy: boolean; isFirst: boolean; isLast: boolean
  editingId: string | null; editName: string; editAccounting: string
  onEditStart: () => void; onEditName: (v: string) => void; onEditAccounting: (v: string) => void
  onEditSave: () => void; onEditCancel: () => void
  onAddChild?: () => void; onArchive: () => void; onMoveUp: () => void; onMoveDown: () => void
}) {
  const editing = editingId === node.id
  return (
    <div className={`flex items-center gap-2 py-1.5 rounded-md ${depth > 0 ? 'pl-7' : ''} ${editing ? 'bg-accent-bg' : 'hover:bg-page'}`}>
      {depth > 0 && <CornerDownRight size={14} className="text-text-secondary shrink-0" />}

      {editing ? (
        <div className="flex-1 flex items-center gap-2 flex-wrap">
          <input type="text" value={editName} onChange={e => onEditName(e.target.value)} autoFocus
            className="flex-1 min-w-[8rem] px-2 py-1 text-sm border border-border-default rounded bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            onKeyDown={e => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel() }} />
          <input type="text" value={editAccounting} onChange={e => onEditAccounting(e.target.value)}
            placeholder="Cat. contable (opcional)"
            className="w-44 px-2 py-1 text-sm border border-border-default rounded bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          <button type="button" disabled={busy} onClick={onEditSave}
            className="px-2 py-1 rounded bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"><Check size={14} /></button>
          <button type="button" onClick={onEditCancel} className="px-2 py-1 text-text-secondary hover:text-text-primary">✕</button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm text-text-primary">
            {node.name}
            {node.itemCount > 0 && <span className="text-text-secondary"> ({node.itemCount})</span>}
            {node.accountingCategory && (
              <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-page border border-border-default text-text-secondary">{node.accountingCategory}</span>
            )}
          </span>
          {/* Reordenar */}
          <button type="button" disabled={busy || isFirst} onClick={onMoveUp}
            className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30" aria-label="Subir"><ChevronUp size={15} /></button>
          <button type="button" disabled={busy || isLast} onClick={onMoveDown}
            className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30" aria-label="Bajar"><ChevronDown size={15} /></button>
          {/* + subfamilia (solo raíz) */}
          {depth === 0 && onAddChild && (
            <button type="button" disabled={busy} onClick={onAddChild}
              className="p-1 text-text-secondary hover:text-accent disabled:opacity-30" aria-label="Añadir subfamilia" title="Añadir subfamilia"><Plus size={15} /></button>
          )}
          <button type="button" disabled={busy} onClick={onEditStart}
            className="p-1 text-text-secondary hover:text-accent disabled:opacity-30" aria-label="Editar"><Pencil size={14} /></button>
          <button type="button" disabled={busy} onClick={onArchive}
            className="p-1 text-text-secondary hover:text-danger disabled:opacity-30" aria-label="Archivar"><Archive size={14} /></button>
        </>
      )}
    </div>
  )
}
