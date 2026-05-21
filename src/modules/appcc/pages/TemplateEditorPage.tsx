// src/modules/appcc/pages/TemplateEditorPage.tsx
// Editor de plantillas APPCC: crear, editar, añadir/quitar items, configurar rangos y alertas.
// Solo admin. Las plantillas seed (is_seed=true) se pueden clonar pero no editar directamente.
//
// BLOQUE C Fases 2-3 (17/05/2026):
//   - Eliminada prop `onBack` del componente top-level.
//   - El botón "Volver" navega a appcc_dashboard vía useNavigate + pageToRoute.
//   - El `onBack` interno del subcomponente TemplateDetail se conserva: es
//     navegación interna entre la vista de lista y la vista de detalle.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Save, Copy, AlertTriangle,
  ChevronDown, ChevronRight, Pencil, X, Check,
} from 'lucide-react'
import * as templatesService from '@/modules/appcc/services/templatesService'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { pageToRoute } from '@/routes'
import type {
  AppccPlan,
  AppccTemplate,
  AppccTemplateItem,
  AppccTemplateItemOption,
  AppccTemplateWithItems,
  AppccFieldType,
  AppccSeverity,
} from '@/modules/appcc/types'

const FIELD_TYPE_LABELS: Record<AppccFieldType, string> = {
  numeric: 'Numérico',
  boolean: 'Sí / No',
  select: 'Selección',
  text: 'Texto libre',
  date: 'Fecha',
  photo: 'Solo foto',
  signature: 'Firma',
}

const SEVERITY_LABELS: Record<AppccSeverity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
}

export default function TemplateEditorPage() {
  // BLOQUE B-5b (17/05/2026): migrado de const local ACCOUNT_ID_FOLVY a
  // useActiveAccount(). Usado tanto en onClone (handler) como pasado al
  // subcomponente CreateTemplateModal a través de su propio hook.
  const { activeAccount, requireActiveAccountId } = useActiveAccount()
  const navigate = useNavigate()
  const slug = activeAccount?.slug ?? 'folvy'

  const [plans, setPlans] = useState<AppccPlan[]>([])
  const [templates, setTemplates] = useState<AppccTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [pls, tpls] = await Promise.all([
      templatesService.listPlans(),
      templatesService.listTemplates(),
    ])
    setPlans(pls)
    setTemplates(tpls)
    setLoading(false)
  }

  function handleBackToDashboard() {
    navigate(pageToRoute('appcc_dashboard', slug))
  }

  // Agrupar plantillas por plan
  const grouped = useMemo(() => {
    const map = new Map<string, AppccTemplate[]>()
    for (const t of templates) {
      if (!map.has(t.plan_id)) map.set(t.plan_id, [])
      map.get(t.plan_id)!.push(t)
    }
    return map
  }, [templates])

  if (selectedTemplateId) {
    return (
      <TemplateDetail
        templateId={selectedTemplateId}
        onBack={() => { setSelectedTemplateId(null); loadAll() }}
      />
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={handleBackToDashboard} className="text-text-secondary hover:text-text-primary transition-base">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-display text-text-primary">Plantillas APPCC</h1>
            <p className="text-sm text-text-secondary">{templates.length} plantillas activas</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-base"
        >
          <Plus size={16} /> Nueva plantilla
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-secondary text-center py-12">Cargando plantillas...</p>
      ) : (
        <div className="space-y-4">
          {plans.map(plan => {
            const planTemplates = grouped.get(plan.id) ?? []
            if (planTemplates.length === 0) return null
            return (
              <PlanSection
                key={plan.id}
                plan={plan}
                templates={planTemplates}
                onSelect={id => setSelectedTemplateId(id)}
                onClone={async (tpl) => {
                  const cloned = await templatesService.createTemplate({
                    accountId: requireActiveAccountId(),
                    planId: tpl.plan_id,
                    code: tpl.code + '_copia',
                    name: tpl.name + ' (copia)',
                    description: tpl.description ?? undefined,
                    estimatedMinutes: tpl.estimated_minutes ?? undefined,
                  })
                  // Clonar items
                  const full = await templatesService.getTemplateWithItems(tpl.id)
                  if (full) {
                    for (const item of full.items) {
                      await templatesService.createItem({
                        templateId: cloned.id,
                        code: item.code,
                        label: item.label,
                        helpText: item.help_text ?? undefined,
                        fieldType: item.field_type,
                        isRequired: item.is_required,
                        displayOrder: item.display_order,
                        numericMin: item.numeric_min,
                        numericMax: item.numeric_max,
                        numericUnit: item.numeric_unit,
                        expectedBoolean: item.expected_boolean,
                        createsIncidentOnFail: item.creates_incident_on_fail,
                        incidentSeverity: item.incident_severity,
                      })
                    }
                  }
                  await loadAll()
                  setSelectedTemplateId(cloned.id)
                }}
                onDelete={async (id) => {
                  if (!confirm('¿Desactivar esta plantilla? No se borrarán los registros históricos.')) return
                  await templatesService.deleteTemplate(id)
                  await loadAll()
                }}
              />
            )
          })}
        </div>
      )}

      {showCreateForm && (
        <CreateTemplateModal
          plans={plans}
          onClose={() => setShowCreateForm(false)}
          onCreated={async (tpl) => {
            setShowCreateForm(false)
            await loadAll()
            setSelectedTemplateId(tpl.id)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Sección de un plan con sus plantillas
// ============================================================

function PlanSection({
  plan, templates, onSelect, onClone, onDelete,
}: {
  plan: AppccPlan
  templates: AppccTemplate[]
  onSelect: (id: string) => void
  onClone: (tpl: AppccTemplate) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-page hover:bg-accent-bg transition-base text-left"
      >
        <div>
          <p className="font-semibold text-text-primary text-sm">{plan.name}</p>
          <p className="text-xs text-text-secondary">{templates.length} plantilla{templates.length !== 1 ? 's' : ''}</p>
        </div>
        {open ? <ChevronDown size={16} className="text-text-secondary" /> : <ChevronRight size={16} className="text-text-secondary" />}
      </button>
      {open && (
        <div className="divide-y divide-border-default">
          {templates.map(tpl => (
            <div key={tpl.id} className="flex items-center gap-3 px-4 py-3 hover:bg-page transition-base">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(tpl.id)}>
                <p className="font-medium text-text-primary text-sm">{tpl.name}</p>
                <p className="text-xs text-text-secondary">
                  {tpl.code}
                  {tpl.is_seed && <span className="ml-2 text-accent font-medium">Predefinida</span>}
                  {tpl.estimated_minutes && <span className="ml-2">~{tpl.estimated_minutes} min</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onSelect(tpl.id)} className="p-1.5 rounded hover:bg-accent-bg text-text-secondary hover:text-accent transition-base" title="Editar">
                  <Pencil size={14} />
                </button>
                <button onClick={() => onClone(tpl)} className="p-1.5 rounded hover:bg-accent-bg text-text-secondary hover:text-accent transition-base" title="Clonar">
                  <Copy size={14} />
                </button>
                {!tpl.is_seed && (
                  <button onClick={() => onDelete(tpl.id)} className="p-1.5 rounded hover:bg-danger-bg text-text-secondary hover:text-danger transition-base" title="Desactivar">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Modal crear plantilla nueva
// ============================================================

function CreateTemplateModal({
  plans, onClose, onCreated,
}: {
  plans: AppccPlan[]
  onClose: () => void
  onCreated: (tpl: AppccTemplate) => void
}) {
  // BLOQUE B-5b: hook propio (subcomponente).
  const { requireActiveAccountId } = useActiveAccount()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim() || !code.trim()) return
    setSaving(true)
    try {
      const tpl = await templatesService.createTemplate({
        accountId: requireActiveAccountId(),
        planId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
        estimatedMinutes: minutes ? Number(minutes) : undefined,
      })
      onCreated(tpl)
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'desconocido'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl max-w-md w-full p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-text-primary">Nueva plantilla</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Plan APPCC</label>
          <select value={planId} onChange={e => setPlanId(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Código</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="TEMP_CUSTOM" className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Minutos est.</label>
            <input type="number" value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="5" className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Nombre</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Control de temperaturas personalizado" className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Descripción (opcional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary resize-none" />
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-border-default text-sm text-text-primary hover:bg-page transition-base">Cancelar</button>
          <button onClick={handleCreate} disabled={saving || !name.trim() || !code.trim()} className="flex-1 px-4 py-2.5 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50">
            {saving ? 'Creando...' : 'Crear plantilla'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Detalle de plantilla: editar metadata + gestionar items
// ============================================================

function TemplateDetail({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const [template, setTemplate] = useState<AppccTemplateWithItems | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [descValue, setDescValue] = useState('')
  const [minutesValue, setMinutesValue] = useState('')
  const [addingItem, setAddingItem] = useState(false)

  async function load() {
    setLoading(true)
    const t = await templatesService.getTemplateWithItems(templateId)
    setTemplate(t)
    if (t) {
      setNameValue(t.name)
      setDescValue(t.description ?? '')
      setMinutesValue(t.estimated_minutes?.toString() ?? '')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [templateId])

  async function handleSaveMeta() {
    if (!template) return
    setSaving(true)
    await templatesService.updateTemplate(templateId, {
      name: nameValue.trim(),
      description: descValue.trim() || null,
      estimatedMinutes: minutesValue ? Number(minutesValue) : null,
    })
    setEditingName(false)
    await load()
    setSaving(false)
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm('¿Eliminar este campo? Se perderán los datos históricos asociados.')) return
    await templatesService.deleteItem(itemId)
    await load()
  }

  if (loading) {
    return <div className="p-8 text-center text-text-secondary">Cargando plantilla...</div>
  }
  if (!template) {
    return <div className="p-8 text-center text-danger">Plantilla no encontrada</div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <button onClick={onBack} className="text-text-secondary hover:text-text-primary transition-base mt-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          {editingName ? (
            <div className="space-y-2">
              <input value={nameValue} onChange={e => setNameValue(e.target.value)} className="w-full text-2xl font-display border border-border-default rounded-lg px-3 py-2 bg-card text-text-primary" />
              <textarea value={descValue} onChange={e => setDescValue(e.target.value)} rows={2} placeholder="Descripción..." className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary resize-none" />
              <input type="number" value={minutesValue} onChange={e => setMinutesValue(e.target.value)} placeholder="Minutos estimados" className="w-32 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
              <div className="flex gap-2">
                <button onClick={handleSaveMeta} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-base">
                  <Save size={14} /> Guardar
                </button>
                <button onClick={() => setEditingName(false)} className="px-3 py-1.5 rounded-lg border border-border-default text-sm text-text-primary hover:bg-page transition-base">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-display text-text-primary">{template.name}</h1>
                <button onClick={() => setEditingName(true)} className="text-text-secondary hover:text-accent transition-base">
                  <Pencil size={14} />
                </button>
              </div>
              <p className="text-sm text-text-secondary mt-1">
                {template.plan.name} · {template.code}
                {template.is_seed && <span className="ml-2 text-accent font-medium">Predefinida</span>}
                {template.estimated_minutes && <span className="ml-2">~{template.estimated_minutes} min</span>}
              </p>
              {template.description && <p className="text-sm text-text-secondary mt-1">{template.description}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-text-primary">Campos ({template.items.length})</h2>
        <button
          onClick={() => setAddingItem(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:bg-accent-hover transition-base"
        >
          <Plus size={14} /> Añadir campo
        </button>
      </div>

      <div className="space-y-2">
        {template.items.map((item, idx) => (
          <ItemRow
            key={item.id}
            item={item}
            index={idx}
            onDelete={() => handleDeleteItem(item.id)}
            onUpdated={load}
          />
        ))}
      </div>

      {template.items.length === 0 && (
        <div className="border-2 border-dashed border-border-default rounded-lg p-8 text-center text-text-secondary">
          <p className="font-medium">Sin campos todavía</p>
          <p className="text-xs mt-1">Pulsa "Añadir campo" para empezar a construir el checklist</p>
        </div>
      )}

      {addingItem && (
        <AddItemModal
          templateId={templateId}
          nextOrder={template.items.length + 1}
          onClose={() => setAddingItem(false)}
          onCreated={() => { setAddingItem(false); load() }}
        />
      )}
    </div>
  )
}

// ============================================================
// Fila de un item con edición inline
// ============================================================

function ItemRow({ item, index, onDelete, onUpdated }: {
  item: AppccTemplateItem & { options?: AppccTemplateItemOption[] }
  index: number
  onDelete: () => void
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(item.label)
  const [helpText, setHelpText] = useState(item.help_text ?? '')
  const [fieldType, setFieldType] = useState(item.field_type)
  const [isRequired, setIsRequired] = useState(item.is_required)
  const [numMin, setNumMin] = useState(item.numeric_min?.toString() ?? '')
  const [numMax, setNumMax] = useState(item.numeric_max?.toString() ?? '')
  const [numUnit, setNumUnit] = useState(item.numeric_unit ?? '')
  const [expectedBool, setExpectedBool] = useState(item.expected_boolean)
  const [createsIncident, setCreatesIncident] = useState(item.creates_incident_on_fail)
  const [severity, setSeverity] = useState(item.incident_severity ?? 'medium')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await templatesService.updateItem(item.id, {
      label: label.trim(),
      helpText: helpText.trim() || null,
      fieldType,
      isRequired,
      numericMin: numMin ? Number(numMin) : null,
      numericMax: numMax ? Number(numMax) : null,
      numericUnit: numUnit.trim() || null,
      expectedBoolean: fieldType === 'boolean' ? expectedBool : null,
      createsIncidentOnFail: createsIncident,
      incidentSeverity: createsIncident ? severity : null,
    })
    setEditing(false)
    setSaving(false)
    onUpdated()
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-card border border-border-default rounded-lg hover:border-accent/30 transition-base">
        <span className="text-xs text-text-secondary font-mono w-6 shrink-0">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-text-primary text-sm">{item.label}</p>
          <p className="text-xs text-text-secondary">
            {FIELD_TYPE_LABELS[item.field_type]}
            {item.is_required && ' · Obligatorio'}
            {item.numeric_min !== null && item.numeric_max !== null && ` · ${item.numeric_min}–${item.numeric_max} ${item.numeric_unit ?? ''}`}
            {item.creates_incident_on_fail && <span className="text-warning"> · Genera incidencia ({SEVERITY_LABELS[item.incident_severity ?? 'medium']})</span>}
          </p>
        </div>
        <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-accent-bg text-text-secondary hover:text-accent transition-base" title="Editar">
          <Pencil size={14} />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-danger-bg text-text-secondary hover:text-danger transition-base" title="Eliminar">
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 bg-card border-2 border-accent rounded-lg space-y-3">
      <div>
        <label className="block text-xs text-text-secondary mb-1">Etiqueta</label>
        <input value={label} onChange={e => setLabel(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">Texto de ayuda (opcional)</label>
        <input value={helpText} onChange={e => setHelpText(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-secondary mb-1">Tipo de campo</label>
          <select value={fieldType} onChange={e => setFieldType(e.target.value as AppccFieldType)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
            {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-3 pb-1">
          <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)} className="accent-accent" />
            Obligatorio
          </label>
        </div>
      </div>

      {fieldType === 'numeric' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Mínimo</label>
            <input type="number" step="any" value={numMin} onChange={e => setNumMin(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Máximo</label>
            <input type="number" step="any" value={numMax} onChange={e => setNumMax(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Unidad</label>
            <input value={numUnit} onChange={e => setNumUnit(e.target.value)} placeholder="°C, %, kg..." className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
          </div>
        </div>
      )}

      {fieldType === 'boolean' && (
        <div>
          <label className="block text-xs text-text-secondary mb-1">Respuesta esperada (si difiere, genera incidencia)</label>
          <select value={expectedBool === null ? '' : expectedBool ? 'true' : 'false'} onChange={e => setExpectedBool(e.target.value === '' ? null : e.target.value === 'true')} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
            <option value="">Sin expectativa</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </div>
      )}

      <div className="border-t border-border-default pt-3">
        <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={createsIncident} onChange={e => setCreatesIncident(e.target.checked)} className="accent-accent" />
          <AlertTriangle size={14} className="text-warning" /> Genera incidencia automática si falla
        </label>
        {createsIncident && (
          <div className="mt-2">
            <label className="block text-xs text-text-secondary mb-1">Severidad de la incidencia</label>
            <select value={severity} onChange={e => setSeverity(e.target.value as AppccSeverity)} className="w-48 border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
              {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={saving || !label.trim()} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50">
          <Check size={14} /> {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-border-default text-sm text-text-primary hover:bg-page transition-base">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Modal añadir campo nuevo
// ============================================================

function AddItemModal({ templateId, nextOrder, onClose, onCreated }: {
  templateId: string
  nextOrder: number
  onClose: () => void
  onCreated: () => void
}) {
  const [label, setLabel] = useState('')
  const [code, setCode] = useState('')
  const [fieldType, setFieldType] = useState<AppccFieldType>('numeric')
  const [isRequired, setIsRequired] = useState(true)
  const [numMin, setNumMin] = useState('')
  const [numMax, setNumMax] = useState('')
  const [numUnit, setNumUnit] = useState('')
  const [createsIncident, setCreatesIncident] = useState(true)
  const [severity, setSeverity] = useState<AppccSeverity>('medium')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!label.trim() || !code.trim()) return
    setSaving(true)
    try {
      await templatesService.createItem({
        templateId,
        code: code.trim().toLowerCase(),
        label: label.trim(),
        fieldType,
        isRequired,
        displayOrder: nextOrder,
        numericMin: numMin ? Number(numMin) : null,
        numericMax: numMax ? Number(numMax) : null,
        numericUnit: numUnit.trim() || null,
        createsIncidentOnFail: createsIncident,
        incidentSeverity: createsIncident ? severity : null,
      })
      onCreated()
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'desconocido'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl max-w-md w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-text-primary">Nuevo campo</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Código</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="temp_custom" className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Tipo</label>
            <select value={fieldType} onChange={e => setFieldType(e.target.value as AppccFieldType)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
              {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Etiqueta</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Cámara 1 - Carnes" className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
        </div>

        {fieldType === 'numeric' && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Mín</label>
              <input type="number" step="any" value={numMin} onChange={e => setNumMin(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Máx</label>
              <input type="number" step="any" value={numMax} onChange={e => setNumMax(e.target.value)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Unidad</label>
              <input value={numUnit} onChange={e => setNumUnit(e.target.value)} placeholder="°C" className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)} className="accent-accent" />
            Obligatorio
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={createsIncident} onChange={e => setCreatesIncident(e.target.checked)} className="accent-accent" />
            <AlertTriangle size={12} className="text-warning" /> Genera incidencia
          </label>
        </div>

        {createsIncident && (
          <div>
            <label className="block text-xs text-text-secondary mb-1">Severidad</label>
            <select value={severity} onChange={e => setSeverity(e.target.value as AppccSeverity)} className="w-full border border-border-default rounded-lg px-3 py-2 text-sm bg-card text-text-primary">
              {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-border-default text-sm text-text-primary hover:bg-page transition-base">Cancelar</button>
          <button onClick={handleCreate} disabled={saving || !label.trim() || !code.trim()} className="flex-1 px-4 py-2.5 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50">
            {saving ? 'Creando...' : 'Añadir campo'}
          </button>
        </div>
      </div>
    </div>
  )
}
