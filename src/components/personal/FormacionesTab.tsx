// src/components/personal/FormacionesTab.tsx
// Pestaña de formaciones del empleado: lista, alta, edición, alertas de caducidad.

import { useState, useEffect, useMemo } from 'react'
import { Card, Button, Input, Select, Label, Textarea } from '../ui'
import type { Employee } from '../../types'
import type { Formation, FormationType } from '../../types/personal'
import { FORMATION_CATALOG } from '../../types/personal'
import {
  fetchFormations,
  createFormation,
  updateFormation,
  deleteFormation,
  getFormationStatus,
} from '../../services/formationsService'

interface Props {
  employee: Employee
}

export default function FormacionesTab({ employee }: Props) {
  const [formations, setFormations] = useState<Formation[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Formation | null>(null)

  async function load() {
    setLoading(true)
    const result = await fetchFormations(employee.id)
    setFormations(result)
    setLoading(false)
  }

  useEffect(() => { load() }, [employee.id])

  // Estadísticas: cuántas obligatorias tiene cubiertas
  const obligatoryStats = useMemo(() => {
    const obligatoryTypes = FORMATION_CATALOG.filter(c => c.mandatory).map(c => c.id)
    const covered = obligatoryTypes.filter(type => {
      const f = formations.find(x => x.type === type)
      if (!f) return false
      const status = getFormationStatus(f)
      return status.status !== 'caducada'
    })
    return { covered: covered.length, total: obligatoryTypes.length }
  }, [formations])

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta formación?')) return
    await deleteFormation(id)
    await load()
  }

  return (
    <div className="space-y-4">
      {/* Resumen de cumplimiento legal */}
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-700">📊 Cumplimiento legal</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Formaciones obligatorias cubiertas y vigentes
            </p>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold ${
              obligatoryStats.covered === obligatoryStats.total ? 'text-emerald-600' :
              obligatoryStats.covered >= obligatoryStats.total / 2 ? 'text-amber-600' :
              'text-red-600'
            }`}>
              {obligatoryStats.covered}/{obligatoryStats.total}
            </p>
            <p className="text-[10px] text-gray-500 uppercase">Obligatorias</p>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {formations.length} formación{formations.length !== 1 ? 'es' : ''}
        </p>
        <Button size="sm" onClick={() => { setEditing(null); setShowModal(true) }}>
          + Añadir formación
        </Button>
      </div>

      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
      ) : formations.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-3xl mb-2">🎓</p>
          <p className="text-sm text-gray-700">Sin formaciones registradas</p>
          <p className="text-[11px] text-gray-500 mt-2">
            Recuerda registrar al menos las 5 obligatorias por ley:<br />
            Manipulador de alimentos, PRL, APPCC, Alérgenos, Igualdad.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {formations.map(f => {
            const status = getFormationStatus(f)
            const catalog = FORMATION_CATALOG.find(c => c.id === f.type)
            return (
              <Card key={f.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="text-2xl shrink-0">{catalog?.icon || '📚'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-gray-900 text-sm">{f.name}</p>
                      {catalog?.mandatory && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium border border-red-200">
                          OBLIGATORIA
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        status.color === 'red' ? 'bg-red-50 text-red-700 border border-red-200' :
                        status.color === 'orange' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                        status.color === 'yellow' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                        status.color === 'green' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}>
                        {status.status === 'caducada' ? '⛔' :
                         status.status === 'caduca_urgente' ? '🔴' :
                         status.status === 'caduca_critico' ? '🟠' :
                         status.status === 'caduca_pronto' ? '🟡' :
                         status.status === 'vigente' ? '✅' : '∞'}
                        {' '}{status.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">
                      Emitida: {new Date(f.issueDate + 'T00:00:00').toLocaleDateString('es-ES')}
                      {f.expiryDate && (
                        <> · Caduca: {new Date(f.expiryDate + 'T00:00:00').toLocaleDateString('es-ES')}</>
                      )}
                      {f.issuer && <> · {f.issuer}</>}
                    </p>
                    {f.notes && <p className="text-[11px] text-gray-500 italic mt-1">"{f.notes}"</p>}
                    {f.documentUrl && (
                      <a
                        href={f.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 hover:underline mt-1 inline-block"
                      >
                        📎 Ver documento
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => { setEditing(f); setShowModal(true) }}
                      className="text-xs px-3 py-1 rounded text-gray-600 hover:bg-gray-100"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="text-xs px-3 py-1 rounded text-gray-400 hover:text-red-600"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {showModal && (
        <FormationModal
          employeeId={employee.id}
          formation={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={async () => { setShowModal(false); setEditing(null); await load() }}
        />
      )}
    </div>
  )
}

/* =====================================================
   MODAL DE EDICIÓN / ALTA
   ===================================================== */

function FormationModal({
  employeeId,
  formation,
  onClose,
  onSaved,
}: {
  employeeId: string
  formation: Formation | null
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<FormationType>(formation?.type || 'manipulador_alimentos')
  const [name, setName] = useState(formation?.name || '')
  const [issuer, setIssuer] = useState(formation?.issuer || '')
  const [issueDate, setIssueDate] = useState(formation?.issueDate || new Date().toISOString().slice(0, 10))
  const [expiryDate, setExpiryDate] = useState(formation?.expiryDate || '')
  const [documentUrl, setDocumentUrl] = useState(formation?.documentUrl || '')
  const [notes, setNotes] = useState(formation?.notes || '')
  const [saving, setSaving] = useState(false)

  const catalog = FORMATION_CATALOG.find(c => c.id === type)

  // Auto-rellenar nombre cuando cambia el tipo y NO es 'otro'
  function handleTypeChange(newType: FormationType) {
    setType(newType)
    const cat = FORMATION_CATALOG.find(c => c.id === newType)
    if (cat && newType !== 'otro') {
      setName(cat.label)
    }
    // Auto-calcular caducidad si hay recommendedExpiryYears y el campo está vacío o ya viene del template
    if (cat?.recommendedExpiryYears && issueDate) {
      const issued = new Date(issueDate + 'T00:00:00')
      const exp = new Date(issued)
      exp.setFullYear(exp.getFullYear() + cat.recommendedExpiryYears)
      setExpiryDate(exp.toISOString().slice(0, 10))
    }
  }

  async function handleSave() {
    if (!name.trim() || !issueDate) return
    setSaving(true)
    if (formation) {
      await updateFormation(formation.id, {
        type, name, issuer, issueDate,
        expiryDate: expiryDate || undefined,
        documentUrl: documentUrl || undefined,
        notes,
      })
    } else {
      await createFormation(employeeId, {
        type, name,
        issuer: issuer || undefined,
        issueDate,
        expiryDate: expiryDate || undefined,
        documentUrl: documentUrl || undefined,
        notes: notes || undefined,
      })
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b" style={{ backgroundColor: '#7C1A1A', color: 'white' }}>
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              {formation ? '✏️ Editar formación' : '🎓 Nueva formación'}
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-lg">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <Label>Tipo de formación</Label>
            <Select className="mt-1" value={type} onChange={e => handleTypeChange(e.target.value as FormationType)}>
              {FORMATION_CATALOG.map(c => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label} {c.mandatory ? '(obligatoria)' : ''}
                </option>
              ))}
            </Select>
            {catalog && (
              <p className="text-[11px] text-gray-500 mt-1">{catalog.description}</p>
            )}
          </div>

          <div>
            <Label>Nombre / título del curso</Label>
            <Input
              className="mt-1"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={catalog?.label || 'Título de la formación'}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha de emisión *</Label>
              <Input className="mt-1" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </div>
            <div>
              <Label>Fecha de caducidad</Label>
              <Input className="mt-1" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
              {catalog?.recommendedExpiryYears && (
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Recomendado: {catalog.recommendedExpiryYears} {catalog.recommendedExpiryYears === 1 ? 'año' : 'años'}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Entidad emisora</Label>
            <Input
              className="mt-1"
              value={issuer}
              onChange={e => setIssuer(e.target.value)}
              placeholder="Ej: Cámara de Comercio Madrid, FormAcción, etc."
            />
          </div>

          <div>
            <Label>URL del certificado (opcional)</Label>
            <Input
              className="mt-1"
              type="url"
              value={documentUrl}
              onChange={e => setDocumentUrl(e.target.value)}
              placeholder="https://..."
            />
            <p className="text-[10px] text-gray-500 mt-0.5">
              Para subir el PDF, hazlo en la pestaña Documentos y pega aquí el enlace.
            </p>
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observaciones, número de horas, modalidad..."
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !issueDate}>
            {saving ? 'Guardando...' : (formation ? 'Guardar cambios' : 'Añadir formación')}
          </Button>
        </div>
      </div>
    </div>
  )
}
