// src/modules/appcc/audits/AuditTemplateEditorPage.tsx
// Editor de plantillas de auditoría: CRUD de plantillas, secciones e ítems.
//
// Layout master-detail:
//   - Lista lateral con las plantillas existentes + botón "Nueva"
//   - Panel principal: edición de plantilla seleccionada (datos + secciones + ítems)
//
// En mobile, la lista lateral se pliega y solo se muestra el panel activo.

import { useEffect, useState } from 'react'
import {
  FolderOpen, Plus, Trash2, Copy, Edit3, Save, X,
  ChevronDown, ChevronUp, AlertTriangle, ClipboardCheck,
  ArrowLeft, Loader2, Eye, EyeOff,
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import * as auditsService from './auditsService'
import type {
  AuditTemplate,
  AuditTemplateWithItems,
  AuditSection,
  AuditItem,
  AuditScoringType,
  AuditItemSeverity,
  AuditRecurrence,
} from './types'
import { RECURRENCE_LABEL } from './types'

const SCORING_LABEL: Record<AuditScoringType, string> = {
  binary: 'Sí / No',
  scale_0_5: 'Escala 0-5',
  na_allowed: 'Sí / No / N/A',
}

const SEVERITY_LABEL: Record<AuditItemSeverity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
}

export default function AuditTemplateEditorPage() {
  const { isAdmin } = useApp()

  const [templates, setTemplates] = useState<AuditTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditTemplateWithItems | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  // En mobile: 'list' o 'detail'
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  // ---------- Carga ----------
  async function reloadList() {
    setLoadingList(true)
    try {
      const data = await auditsService.listTemplates()
      setTemplates(data)
      // Si el seleccionado ya no está, seleccionar la primera
      if (selectedId && !data.find(t => t.id === selectedId)) {
        setSelectedId(data[0]?.id ?? null)
      } else if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingList(false)
    }
  }

  async function reloadDetail() {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setLoadingDetail(true)
    try {
      const d = await auditsService.getTemplateWithItems(selectedId)
      setDetail(d)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => { void reloadList() }, [])
  useEffect(() => { void reloadDetail() }, [selectedId])

  function onSelectTemplate(id: string) {
    setSelectedId(id)
    setMobileView('detail')
  }

  // ---------- Render ----------
  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <AlertTriangle size={32} className="mx-auto mb-3 opacity-50" />
        <p>Solo administradores pueden editar plantillas de auditoría.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display text-text-primary flex items-center gap-2">
            <FolderOpen size={26} className="text-accent" />
            Plantillas de auditoría
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Define el cuestionario, scoring y reglas de cada tipo de auditoría
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg text-danger rounded-md p-3 text-sm">{error}</div>
      )}

      {/* LAYOUT MASTER-DETAIL */}
      <div className="grid lg:grid-cols-[280px_1fr] gap-4 min-h-[calc(100vh-220px)]">
        {/* === LISTA LATERAL === */}
        <aside
          className={`bg-card rounded-lg border border-border-default p-3 space-y-2 ${
            mobileView === 'list' ? 'block' : 'hidden lg:block'
          }`}
        >
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base min-h-touch"
          >
            <Plus size={14} /> Nueva plantilla
          </button>

          <div className="mt-3 space-y-1">
            {loadingList ? (
              <div className="text-center text-text-secondary text-xs py-4">Cargando…</div>
            ) : templates.length === 0 ? (
              <div className="text-center text-text-secondary text-xs py-4 italic">
                Sin plantillas
              </div>
            ) : (
              templates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTemplate(t.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-base ${
                    selectedId === t.id
                      ? 'bg-accent-bg text-accent border border-accent/30'
                      : 'hover:bg-page border border-transparent'
                  }`}
                >
                  <div className="font-medium text-sm truncate">{t.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-text-secondary mt-0.5 flex items-center gap-2">
                    <span>{RECURRENCE_LABEL[t.recurrence]}</span>
                    {t.is_seed && (
                      <span className="px-1.5 py-0.5 bg-page rounded text-[9px]">Seed</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* === PANEL EDICIÓN === */}
        <main className={`${mobileView === 'detail' ? 'block' : 'hidden lg:block'}`}>
          {/* Botón volver en mobile */}
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className="lg:hidden mb-3 text-accent text-sm inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeft size={14} /> Ver lista
          </button>

          {loadingDetail ? (
            <div className="text-center text-text-secondary py-12">
              <Loader2 size={20} className="animate-spin mx-auto mb-2" />
              Cargando plantilla…
            </div>
          ) : !detail ? (
            <div className="text-center text-text-secondary py-12 bg-card rounded-lg border border-border-default">
              <FolderOpen size={48} className="mx-auto mb-3 opacity-30" />
              <p>Selecciona una plantilla para editarla</p>
            </div>
          ) : (
            <TemplateEditor
              template={detail}
              onTemplateChanged={() => { void reloadDetail(); void reloadList() }}
              onTemplateDeleted={() => {
                setSelectedId(null)
                void reloadList()
                setMobileView('list')
              }}
            />
          )}
        </main>
      </div>

      {showNew && (
        <NewTemplateModal
          onClose={() => setShowNew(false)}
          onCreated={(tplId) => {
            setShowNew(false)
            setSelectedId(tplId)
            void reloadList()
            setMobileView('detail')
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// EDITOR DE UNA PLANTILLA
// ============================================================

function TemplateEditor({
  template, onTemplateChanged, onTemplateDeleted,
}: {
  template: AuditTemplateWithItems
  onTemplateChanged: () => void
  onTemplateDeleted: () => void
}) {
  const { requireActiveAccountId } = useActiveAccount()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [recurrence, setRecurrence] = useState<AuditRecurrence>(template.recurrence)
  const [passScore, setPassScore] = useState<number>(template.pass_score)
  const [saving, setSaving] = useState(false)
  const [addingSection, setAddingSection] = useState(false)

  useEffect(() => {
    setName(template.name)
    setDescription(template.description ?? '')
    setRecurrence(template.recurrence)
    setPassScore(template.pass_score)
    setEditing(false)
  }, [template.id])

  async function saveHeader() {
    setSaving(true)
    try {
      await auditsService.updateTemplate(template.id, {
        name: name.trim(),
        description: description.trim() || null,
        recurrence,
        pass_score: passScore,
      })
      setEditing(false)
      onTemplateChanged()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteTpl() {
    if (template.is_seed) {
      alert('Las plantillas seed no se pueden borrar (solo desactivar).')
      return
    }
    if (!window.confirm('¿Borrar esta plantilla? Las auditorías ya creadas no se ven afectadas.')) return
    try {
      await auditsService.deleteTemplate(template.id)
      onTemplateDeleted()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function cloneTpl() {
    const newName = window.prompt('Nombre de la copia:', `${template.name} (copia)`)
    if (!newName?.trim()) return
    const newCode = window.prompt('Código:', `${template.code}_COPY`)
    if (!newCode?.trim()) return
    try {
      const accountId = requireActiveAccountId()
      await auditsService.cloneTemplate(template.id, accountId, newName.trim(), newCode.trim())
      onTemplateChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function toggleActive() {
    try {
      await auditsService.updateTemplate(template.id, { is_active: !template.is_active })
      onTemplateChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      {/* ========== CABECERA ========== */}
      <div className="bg-card rounded-lg border border-border-default p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-text-secondary mb-1">
              Código: {template.code}
              {template.is_seed && (
                <span className="ml-2 px-1.5 py-0.5 bg-page rounded text-[9px]">Seed (no borrable)</span>
              )}
            </div>
            {editing ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full text-lg font-semibold border-b border-accent bg-transparent px-1 py-1 focus:outline-none"
              />
            ) : (
              <h2 className="text-lg font-semibold text-text-primary">{template.name}</h2>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {!editing && (
              <>
                <IconBtn onClick={() => setEditing(true)} Icon={Edit3} label="Editar" />
                <IconBtn onClick={cloneTpl} Icon={Copy} label="Duplicar" />
                <IconBtn onClick={toggleActive} Icon={template.is_active ? Eye : EyeOff}
                  label={template.is_active ? 'Activa' : 'Inactiva'}
                  tone={template.is_active ? 'success' : 'neutral'} />
                {!template.is_seed && (
                  <IconBtn onClick={deleteTpl} Icon={Trash2} label="Borrar" tone="danger" />
                )}
              </>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                Descripción
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                  Recurrencia
                </label>
                <select
                  value={recurrence}
                  onChange={e => setRecurrence(e.target.value as AuditRecurrence)}
                  className="w-full px-3 py-2 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
                >
                  {(['monthly', 'quarterly', 'yearly', 'on_demand'] as const).map(r => (
                    <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                  Umbral aprobado (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passScore}
                  onChange={e => setPassScore(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                  className="w-full px-3 py-2 border border-border-default rounded-md bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="px-3 py-2 bg-card border border-border-default text-text-secondary rounded-md text-sm font-medium hover:bg-page transition-base"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveHeader}
                disabled={saving || !name.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover transition-base disabled:opacity-50"
              >
                <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {template.description && (
              <p className="text-sm text-text-secondary mb-3">{template.description}</p>
            )}
            <div className="flex gap-3 flex-wrap text-xs">
              <Badge>{RECURRENCE_LABEL[template.recurrence]}</Badge>
              <Badge>Umbral aprobado: {template.pass_score}%</Badge>
              <Badge>{template.sections.length} secciones</Badge>
              <Badge>
                {template.sections.reduce((a, s) => a + s.items.length, 0)} ítems
              </Badge>
            </div>
          </>
        )}
      </div>

      {/* ========== SECCIONES ========== */}
      <div className="space-y-2">
        {template.sections.map(section => (
          <SectionEditor
            key={section.id}
            section={section}
            onChanged={onTemplateChanged}
          />
        ))}

        {addingSection ? (
          <NewSectionForm
            templateId={template.id}
            nextOrder={(template.sections[template.sections.length - 1]?.display_order ?? 0) + 1}
            onCreated={() => { setAddingSection(false); onTemplateChanged() }}
            onCancel={() => setAddingSection(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border-default rounded-md text-text-secondary text-sm font-medium hover:bg-card transition-base"
          >
            <Plus size={14} /> Nueva sección
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// SECCIÓN
// ============================================================

function SectionEditor({
  section, onChanged,
}: {
  section: AuditSection & { items: AuditItem[] }
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(section.name)
  const [description, setDescription] = useState(section.description ?? '')
  const [weight, setWeight] = useState(section.weight)
  const [addingItem, setAddingItem] = useState(false)

  async function saveSection() {
    try {
      await auditsService.updateSection(section.id, {
        name: name.trim(),
        description: description.trim() || null,
        weight,
      })
      setEditing(false)
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function deleteSection() {
    if (!window.confirm(`¿Borrar la sección "${section.name}" y sus ${section.items.length} ítems?`)) return
    try {
      await auditsService.deleteSection(section.id)
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="bg-card rounded-lg border border-border-default overflow-hidden">
      {/* Cabecera plegable */}
      <div className="bg-page px-3 py-2 border-b border-border-default flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="p-1 hover:bg-card rounded"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-sm font-semibold border-b border-accent bg-transparent px-1 focus:outline-none"
            />
          ) : (
            <div className="text-sm font-semibold text-text-primary">
              {section.code} · {section.name}
            </div>
          )}
          {!editing && section.description && (
            <div className="text-xs text-text-secondary">{section.description}</div>
          )}
        </div>

        <div className="text-xs text-text-secondary shrink-0 inline-flex items-center gap-2">
          <span>Peso × {section.weight}</span>
          <span>·</span>
          <span>{section.items.length} ítems</span>
        </div>

        <div className="flex gap-1 shrink-0">
          {editing ? (
            <>
              <IconBtn onClick={() => setEditing(false)} Icon={X} label="Cancelar" />
              <IconBtn onClick={saveSection} Icon={Save} label="Guardar" tone="success" />
            </>
          ) : (
            <>
              <IconBtn onClick={() => setEditing(true)} Icon={Edit3} label="Editar" />
              <IconBtn onClick={deleteSection} Icon={Trash2} label="Borrar" tone="danger" />
            </>
          )}
        </div>
      </div>

      {/* Cuerpo: ítems */}
      {expanded && (
        <div className="p-3 space-y-2">
          {editing && (
            <div className="bg-page rounded-md p-3 space-y-2 mb-2">
              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                  Descripción
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-1.5 border border-border-default rounded-md bg-card text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                  Peso (1-10)
                </label>
                <input
                  type="number" min={1} max={10}
                  value={weight}
                  onChange={e => setWeight(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="w-20 px-2 py-1 border border-border-default rounded bg-card text-xs"
                />
              </div>
            </div>
          )}

          {section.items.length === 0 && !addingItem ? (
            <div className="text-center text-text-secondary text-xs py-3 italic">
              Sin ítems en esta sección
            </div>
          ) : (
            section.items.map(item => (
              <ItemEditor key={item.id} item={item} onChanged={onChanged} />
            ))
          )}

          {addingItem ? (
            <NewItemForm
              sectionId={section.id}
              nextOrder={(section.items[section.items.length - 1]?.display_order ?? 0) + 1}
              onCreated={() => { setAddingItem(false); onChanged() }}
              onCancel={() => setAddingItem(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingItem(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-border-default rounded-md text-text-secondary text-xs font-medium hover:bg-page transition-base"
            >
              <Plus size={12} /> Añadir ítem
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// ÍTEM
// ============================================================

function ItemEditor({ item, onChanged }: { item: AuditItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [question, setQuestion] = useState(item.question)
  const [helpText, setHelpText] = useState(item.help_text ?? '')
  const [scoringType, setScoringType] = useState<AuditScoringType>(item.scoring_type)
  const [weight, setWeight] = useState(item.weight)
  const [createsInc, setCreatesInc] = useState(item.creates_incident_on_fail)
  const [severity, setSeverity] = useState<AuditItemSeverity>(item.incident_severity ?? 'medium')

  async function save() {
    try {
      await auditsService.updateItem(item.id, {
        question: question.trim(),
        help_text: helpText.trim() || null,
        scoring_type: scoringType,
        weight,
        creates_incident_on_fail: createsInc,
        incident_severity: createsInc ? severity : null,
      })
      setEditing(false)
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function deleteItem() {
    if (!window.confirm('¿Borrar este ítem?')) return
    try {
      await auditsService.deleteItem(item.id)
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (editing) {
    return (
      <div className="bg-page rounded-md p-3 border-2 border-accent space-y-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-text-secondary block mb-1">
            Pregunta
          </label>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            className="w-full px-2 py-1.5 border border-border-default rounded bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-text-secondary block mb-1">
            Ayuda (opcional)
          </label>
          <input
            value={helpText}
            onChange={e => setHelpText(e.target.value)}
            className="w-full px-2 py-1.5 border border-border-default rounded bg-card text-xs focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-secondary block mb-1">
              Tipo
            </label>
            <select
              value={scoringType}
              onChange={e => setScoringType(e.target.value as AuditScoringType)}
              className="w-full px-2 py-1 border border-border-default rounded bg-card text-xs"
            >
              {(['binary', 'na_allowed', 'scale_0_5'] as const).map(s => (
                <option key={s} value={s}>{SCORING_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-secondary block mb-1">
              Peso
            </label>
            <input
              type="number" min={1} max={10}
              value={weight}
              onChange={e => setWeight(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
              className="w-full px-2 py-1 border border-border-default rounded bg-card text-xs"
            />
          </div>
          <label className="flex items-center gap-1 text-xs col-span-2 sm:col-span-1 cursor-pointer mt-4">
            <input
              type="checkbox"
              checked={createsInc}
              onChange={e => setCreatesInc(e.target.checked)}
              className="accent-accent"
            />
            <span>Genera incidencia</span>
          </label>
        </div>
        {createsInc && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-secondary block mb-1">
              Severidad
            </label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as AuditItemSeverity)}
              className="w-full px-2 py-1 border border-border-default rounded bg-card text-xs"
            >
              {(['low', 'medium', 'high', 'critical'] as const).map(s => (
                <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-3 py-1.5 bg-card border border-border-default text-text-secondary rounded text-xs hover:bg-page"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!question.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent text-text-on-accent rounded text-xs disabled:opacity-50"
          >
            <Save size={11} /> Guardar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 p-2 hover:bg-page rounded-md group">
      <span className="shrink-0 text-[10px] font-mono text-text-secondary mt-0.5 min-w-[2rem]">
        {item.code}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{item.question}</div>
        {item.help_text && (
          <div className="text-xs text-text-secondary mt-0.5 italic">{item.help_text}</div>
        )}
        <div className="text-[10px] text-text-secondary mt-1 flex gap-2 flex-wrap">
          <span>{SCORING_LABEL[item.scoring_type]}</span>
          <span>·</span>
          <span>Peso {item.weight}</span>
          {item.creates_incident_on_fail && (
            <>
              <span>·</span>
              <span className="text-warning inline-flex items-center gap-0.5">
                <AlertTriangle size={9} />
                Incidencia {item.incident_severity ? SEVERITY_LABEL[item.incident_severity].toLowerCase() : ''}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconBtn onClick={() => setEditing(true)} Icon={Edit3} label="Editar" size="sm" />
        <IconBtn onClick={deleteItem} Icon={Trash2} label="Borrar" tone="danger" size="sm" />
      </div>
    </div>
  )
}

// ============================================================
// FORMS NUEVOS
// ============================================================

function NewSectionForm({
  templateId, nextOrder, onCreated, onCancel,
}: {
  templateId: string; nextOrder: number; onCreated: () => void; onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!code.trim() || !name.trim()) return
    setBusy(true)
    try {
      await auditsService.createSection({
        templateId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        display_order: nextOrder,
        weight: 1,
      })
      onCreated()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-card border-2 border-accent rounded-md p-3 space-y-2">
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <input
          placeholder="Código"
          value={code}
          onChange={e => setCode(e.target.value)}
          className="px-2 py-1.5 border border-border-default rounded bg-card text-xs uppercase focus:outline-none focus:ring-2 focus:ring-accent"
          autoFocus
        />
        <input
          placeholder="Nombre de la sección"
          value={name}
          onChange={e => setName(e.target.value)}
          className="px-2 py-1.5 border border-border-default rounded bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button" onClick={onCancel} disabled={busy}
          className="px-3 py-1.5 bg-card border border-border-default text-text-secondary rounded text-xs hover:bg-page"
        >Cancelar</button>
        <button
          type="button" onClick={create}
          disabled={busy || !code.trim() || !name.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent text-text-on-accent rounded text-xs disabled:opacity-50"
        >
          <Plus size={11} /> Crear sección
        </button>
      </div>
    </div>
  )
}

function NewItemForm({
  sectionId, nextOrder, onCreated, onCancel,
}: {
  sectionId: string; nextOrder: number; onCreated: () => void; onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [question, setQuestion] = useState('')
  const [scoringType, setScoringType] = useState<AuditScoringType>('binary')
  const [createsInc, setCreatesInc] = useState(false)
  const [severity, setSeverity] = useState<AuditItemSeverity>('medium')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!code.trim() || !question.trim()) return
    setBusy(true)
    try {
      await auditsService.createItem({
        sectionId,
        code: code.trim().toUpperCase(),
        question: question.trim(),
        scoring_type: scoringType,
        weight: 1,
        creates_incident_on_fail: createsInc,
        incident_severity: createsInc ? severity : null,
        display_order: nextOrder,
      })
      onCreated()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-card border-2 border-accent rounded-md p-3 space-y-2">
      <div className="grid grid-cols-[60px_1fr] gap-2">
        <input
          placeholder="Código"
          value={code}
          onChange={e => setCode(e.target.value)}
          className="px-2 py-1.5 border border-border-default rounded bg-card text-xs uppercase focus:outline-none focus:ring-2 focus:ring-accent"
          autoFocus
        />
        <input
          placeholder="Pregunta"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          className="px-2 py-1.5 border border-border-default rounded bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={scoringType}
          onChange={e => setScoringType(e.target.value as AuditScoringType)}
          className="px-2 py-1 border border-border-default rounded bg-card text-xs"
        >
          {(['binary', 'na_allowed', 'scale_0_5'] as const).map(s => (
            <option key={s} value={s}>{SCORING_LABEL[s]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={createsInc}
            onChange={e => setCreatesInc(e.target.checked)}
            className="accent-accent"
          />
          <span>Incidencia al fallar</span>
        </label>
      </div>
      {createsInc && (
        <select
          value={severity}
          onChange={e => setSeverity(e.target.value as AuditItemSeverity)}
          className="w-full px-2 py-1 border border-border-default rounded bg-card text-xs"
        >
          {(['low', 'medium', 'high', 'critical'] as const).map(s => (
            <option key={s} value={s}>Severidad: {SEVERITY_LABEL[s]}</option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button" onClick={onCancel} disabled={busy}
          className="px-3 py-1.5 bg-card border border-border-default text-text-secondary rounded text-xs hover:bg-page"
        >Cancelar</button>
        <button
          type="button" onClick={create}
          disabled={busy || !code.trim() || !question.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent text-text-on-accent rounded text-xs disabled:opacity-50"
        >
          <Plus size={11} /> Crear ítem
        </button>
      </div>
    </div>
  )
}

function NewTemplateModal({
  onClose, onCreated,
}: {
  onClose: () => void; onCreated: (templateId: string) => void
}) {
  const { requireActiveAccountId } = useActiveAccount()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [recurrence, setRecurrence] = useState<AuditRecurrence>('monthly')
  const [passScore, setPassScore] = useState(80)
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!code.trim() || !name.trim()) return
    setBusy(true)
    try {
      const accountId = requireActiveAccountId()
      const tpl = await auditsService.createTemplate({
        accountId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        recurrence,
        pass_score: passScore,
      })
      onCreated(tpl.id)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card w-full sm:max-w-md max-h-[95vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border-default p-4 sm:p-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary inline-flex items-center gap-2">
            <ClipboardCheck size={18} /> Nueva plantilla
          </h2>
          <button onClick={onClose} className="p-1 text-text-secondary">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Código (corto, único)
            </label>
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Ej: AUDIT_PROVEEDORES"
              className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card uppercase text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Nombre
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Auditoría de proveedores"
              className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
              Descripción (opcional)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-border-default rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                Recurrencia
              </label>
              <select
                value={recurrence}
                onChange={e => setRecurrence(e.target.value as AuditRecurrence)}
                className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
              >
                {(['monthly', 'quarterly', 'yearly', 'on_demand'] as const).map(r => (
                  <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">
                Umbral aprobado (%)
              </label>
              <input
                type="number" min={0} max={100}
                value={passScore}
                onChange={e => setPassScore(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                className="w-full px-3 py-2.5 border border-border-default rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border-default p-4 sm:p-5 flex gap-2">
          <button
            type="button" onClick={onClose} disabled={busy}
            className="flex-1 px-4 py-2.5 bg-card border border-border-default text-text-secondary rounded-md text-sm font-medium hover:bg-page transition-base min-h-touch"
          >Cancelar</button>
          <button
            type="button" onClick={create}
            disabled={busy || !code.trim() || !name.trim()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-text-on-accent rounded-md text-sm font-medium hover:bg-accent-hover disabled:opacity-50 min-h-touch"
          >
            <Plus size={14} /> {busy ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// HELPERS
// ============================================================

function IconBtn({
  onClick, Icon, label, tone = 'neutral', size = 'md',
}: {
  onClick: () => void; Icon: typeof Edit3; label: string
  tone?: 'neutral' | 'success' | 'danger'
  size?: 'sm' | 'md'
}) {
  const colors = {
    neutral: 'text-text-secondary hover:bg-page hover:text-text-primary',
    success: 'text-success hover:bg-success-bg',
    danger: 'text-danger hover:bg-danger-bg',
  }[tone]
  const sizes = size === 'sm' ? 'p-1' : 'p-1.5'
  const iconSize = size === 'sm' ? 12 : 14
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`${sizes} rounded transition-base ${colors}`}
    >
      <Icon size={iconSize} />
    </button>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 bg-page text-text-secondary rounded text-xs">
      {children}
    </span>
  )
}
