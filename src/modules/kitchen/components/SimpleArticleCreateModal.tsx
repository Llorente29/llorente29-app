// src/modules/kitchen/components/SimpleArticleCreateModal.tsx
//
// Alta mínima de un ENVASE (packaging) o una HERRAMIENTA (tool). A diferencia
// del ingrediente, NO hay master/catálogo del que adoptar: se teclea nombre +
// unidad base y se crea. Anti-duplicado de UX: mientras escribes, si ya existe
// un artículo parecido del mismo tipo, se ofrece abrirlo en vez de duplicar.
//
// El envase nace con IVA 'no_alimentario' (21%) por defecto (lo asigna el
// servicio createPackagingItem); la herramienta no lleva IVA. Coste/proveedor se
// completan luego en la ficha. Imita el estilo de IngredientCreateModal.

import { useMemo, useState } from 'react'
import { X, Plus } from 'lucide-react'
import {
  createPackagingItem,
  createRecipeItem,
} from '@/modules/kitchen/services/recipeItemService'
import type { RecipeItem, KitchenUnit } from '@/types/kitchen'

const INPUT_CLS =
  'w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50'

interface Props {
  accountId: string
  articleType: 'packaging' | 'tool'
  units: KitchenUnit[]
  existingItems: RecipeItem[] // artículos del tipo activo, para anti-duplicado
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: (item: RecipeItem) => void
  onOpenExisting: (itemId: string) => void
}

export default function SimpleArticleCreateModal({
  accountId,
  articleType,
  units,
  existingItems,
  actorId,
  actorName,
  onClose,
  onCreated,
  onOpenExisting,
}: Props) {
  const noun = articleType === 'tool' ? 'herramienta' : 'envase'
  const title = articleType === 'tool' ? 'Nueva herramienta' : 'Nuevo envase'

  const [name, setName] = useState('')
  // Unidad base por defecto: la de abreviatura 'ud' (un envase/herramienta se
  // cuenta por unidades); si no existe, la primera disponible.
  const [baseUnitId, setBaseUnitId] = useState<string>(() => {
    const ud = units.find((u) => u.abbreviation.trim().toLowerCase() === 'ud')
    return ud ? ud.id : (units[0]?.id ?? '')
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Coincidencias por nombre (ilike) dentro del tipo activo → ofrecer abrir.
  const matches = useMemo(() => {
    const q = name.trim().toLowerCase()
    if (q === '') return []
    return existingItems
      .filter((it) => it.name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [existingItems, name])

  // Coincidencia EXACTA: no tiene sentido ofrecer "crear" si ya existe igual.
  const exactExisting = useMemo(
    () => existingItems.find((it) => it.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null,
    [existingItems, name],
  )

  async function handleCreate() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('El nombre es obligatorio.')
      return
    }
    if (!baseUnitId) {
      setError('Elige una unidad base.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created =
        articleType === 'packaging'
          ? await createPackagingItem({
              accountId,
              name: trimmed,
              baseUnitId,
              createdBy: actorId,
              createdByName: actorName,
            })
          : await createRecipeItem({
              accountId,
              type: 'tool',
              name: trimmed,
              baseUnitId,
              createdBy: actorId,
              createdByName: actorName,
            })
      onCreated(created)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setSaving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !saving) onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="simple-article-create-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="simple-article-create-title" className="text-base font-medium text-text-primary">
            {title}
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={saving}
            className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nombre</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder={articleType === 'tool' ? 'Ej: Pinza de servicio' : 'Ej: Caja kraft 780 ml'}
              className={INPUT_CLS}
            />

            {/* Anti-duplicado: si ya hay artículos parecidos, ofrecer abrirlos */}
            {matches.length > 0 && (
              <div className="mt-2 rounded-md border border-border-default bg-card overflow-hidden">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-text-secondary bg-page border-b border-border-default">
                  Ya tienes artículos parecidos · pulsa para abrir
                </div>
                {matches.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    disabled={saving}
                    onClick={() => onOpenExisting(it.id)}
                    className="w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-accent-bg transition-base border-b border-border-default last:border-0 disabled:opacity-60"
                  >
                    <span className="text-sm text-text-primary truncate">{it.name}</span>
                    <span className="text-[11px] text-accent shrink-0">Abrir</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Unidad base</label>
            <select
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
              disabled={saving || units.length === 0}
              className={`${INPUT_CLS} cursor-pointer`}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.abbreviation})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-text-secondary mt-1">
              El coste y el proveedor se completan luego en la ficha.
              {articleType === 'packaging' && ' El envase nace con IVA 21% (no alimentario).'}
            </p>
          </div>

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || name.trim() === '' || !baseUnitId || !!exactExisting}
            title={exactExisting ? 'Ya existe un artículo con ese nombre; ábrelo arriba' : undefined}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
          >
            <Plus size={15} />
            {saving
              ? 'Creando…'
              : name.trim() !== ''
                ? `Crear «${name.trim()}» como ${noun}`
                : `Crear ${noun}`}
          </button>
        </div>
      </div>
    </div>
  )
}
