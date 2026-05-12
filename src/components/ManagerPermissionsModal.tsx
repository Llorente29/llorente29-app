// src/components/ManagerPermissionsModal.tsx
// Modal para configurar permisos individuales de un manager.
// Solo accesible para admin.

import { useState, useEffect } from 'react'
import { Modal, Button, Card, Alert } from './ui'
import {
  getManagerPermissions,
  saveManagerPermissions,
  resetManagerPermissions,
  type ManagerPermissions,
} from '../services/managerPermissionsService'

interface Props {
  userProfileId: string
  userName: string
  onClose: () => void
  onSaved?: () => void
}

interface PermissionItem {
  key: keyof Omit<ManagerPermissions, 'user_profile_id'>
  label: string
  icon: string
  section: string
  sensitive?: boolean
}

const PERMISSION_ITEMS: PermissionItem[] = [
  // Principales
  { key: 'show_dashboard',            label: 'Dashboard',           icon: '⊞', section: 'Principal' },
  { key: 'show_staff',                label: 'Personal',            icon: '👤', section: 'Principal' },
  { key: 'show_ahora_mismo',          label: 'Ahora mismo',         icon: '🟢', section: 'Principal' },

  // Personal y horarios
  { key: 'show_fichajes_global',      label: 'Control Horario',     icon: '⏰', section: 'Personal' },
  { key: 'show_kiosko_fichaje',       label: 'Kiosko Fichaje',      icon: '🕐', section: 'Personal' },
  { key: 'show_solicitudes_pendientes', label: 'Solicitudes',       icon: '📨', section: 'Personal' },
  { key: 'show_turnos_abiertos',      label: 'Turnos abiertos',     icon: '🪑', section: 'Personal' },
  { key: 'show_cambios_pendientes',   label: 'Cambios de turno',    icon: '🔄', section: 'Personal' },
  { key: 'show_calendario',           label: 'Calendario',          icon: '📅', section: 'Personal' },
  { key: 'show_plantilla_turnos',     label: 'Plantilla turnos',    icon: '🗂️', section: 'Personal' },
  { key: 'show_informes_personal',    label: 'Informes Gestoría',   icon: '📄', section: 'Personal', sensitive: true },
  { key: 'show_bolsa_horas',          label: 'Bolsa de horas',      icon: '💰', section: 'Personal' },
  { key: 'show_salaries',             label: 'Ver salarios',        icon: '💵', section: 'Personal', sensitive: true },

  // Operaciones
  { key: 'show_tasks',                label: 'Tareas',              icon: '✅', section: 'Operaciones' },
  { key: 'show_scheduled',            label: 'Programadas',         icon: '🔁', section: 'Operaciones' },
  { key: 'show_templates',            label: 'Plantillas',          icon: '📋', section: 'Operaciones', sensitive: true },
  { key: 'show_incidents',            label: 'Incidencias',         icon: '⚠️', section: 'Operaciones' },
  { key: 'show_audits',               label: 'Auditorías',          icon: '🔍', section: 'Operaciones' },
  { key: 'show_history',              label: 'Historial',           icon: '📜', section: 'Operaciones' },

  // Inventario y análisis
  { key: 'show_tspoon',               label: 'Fichas Técnicas',     icon: '🧪', section: 'Inventario' },
  { key: 'show_ventas_analisis',      label: 'Análisis de Ventas',  icon: '📊', section: 'Inventario' },
  { key: 'show_prediccion_personal',  label: 'Predicción Personal', icon: '🔮', section: 'Inventario' },
  { key: 'show_zonas_pedido',         label: 'Zonas de Pedido',     icon: '🛵', section: 'Inventario', sensitive: true },
  { key: 'show_inventory',            label: 'Inventario',          icon: '📦', section: 'Inventario' },

  // Configuración
  { key: 'show_locations',            label: 'Locales',             icon: '📍', section: 'Configuración', sensitive: true },
  { key: 'show_tspoon_settings',      label: 'Avisos',              icon: '🔔', section: 'Configuración', sensitive: true },
]

const SECTIONS = ['Principal', 'Personal', 'Operaciones', 'Inventario', 'Configuración']

export default function ManagerPermissionsModal({ userProfileId, userName, onClose, onSaved }: Props) {
  const [perms, setPerms] = useState<ManagerPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getManagerPermissions(userProfileId).then(p => {
      setPerms(p)
      setLoading(false)
    })
  }, [userProfileId])

  function toggle(key: keyof Omit<ManagerPermissions, 'user_profile_id'>) {
    if (!perms) return
    setPerms({ ...perms, [key]: !perms[key] })
  }

  function setSection(section: string, value: boolean) {
    if (!perms) return
    const updates: Partial<ManagerPermissions> = {}
    PERMISSION_ITEMS
      .filter(i => i.section === section)
      .forEach(i => { updates[i.key] = value })
    setPerms({ ...perms, ...updates })
  }

  async function handleSave() {
    if (!perms) return
    setSaving(true)
    setError(null)
    const result = await saveManagerPermissions(perms)
    setSaving(false)
    if (!result.ok) {
      setError(result.error || 'Error al guardar')
      return
    }
    onSaved?.()
    onClose()
  }

  async function handleReset() {
    if (!confirm('¿Restaurar permisos por defecto para este encargado?')) return
    setSaving(true)
    const result = await resetManagerPermissions(userProfileId)
    setSaving(false)
    if (!result.ok) {
      setError(result.error || 'Error al restaurar')
      return
    }
    const reloaded = await getManagerPermissions(userProfileId)
    setPerms(reloaded)
  }

  const enabledCount = perms
    ? PERMISSION_ITEMS.filter(i => perms[i.key]).length
    : 0

  return (
    <Modal open onClose={onClose} title={`Permisos de ${userName}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Marca las pantallas que el encargado podrá ver. Las opciones sensibles están marcadas con ⚠️.
        </p>

        {loading ? (
          <Card className="p-6 text-center text-sm text-gray-500">Cargando permisos...</Card>
        ) : !perms ? (
          <Alert type="error">No se han podido cargar los permisos</Alert>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium">
                {enabledCount} de {PERMISSION_ITEMS.length} pantallas habilitadas
              </p>
              <button
                onClick={handleReset}
                disabled={saving}
                className="text-xs text-gray-500 underline hover:text-gray-700"
              >
                Restaurar por defecto
              </button>
            </div>

            {SECTIONS.map(section => {
              const items = PERMISSION_ITEMS.filter(i => i.section === section)
              const allOn = items.every(i => perms[i.key])
              const allOff = items.every(i => !perms[i.key])

              return (
                <div key={section} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">{section}</p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setSection(section, true)}
                        disabled={allOn}
                        className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-white disabled:opacity-30"
                      >
                        Todos
                      </button>
                      <button
                        onClick={() => setSection(section, false)}
                        disabled={allOff}
                        className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-white disabled:opacity-30"
                      >
                        Ninguno
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {items.map(item => (
                      <label
                        key={item.key}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={perms[item.key]}
                          onChange={() => toggle(item.key)}
                          className="w-4 h-4 rounded accent-[#7C1A1A]"
                        />
                        <span className="text-base leading-none">{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        {item.sensitive && (
                          <span className="text-[10px] text-amber-600" title="Acceso sensible">⚠️</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {error && <Alert type="error">{error}</Alert>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !perms}>
            {saving ? 'Guardando...' : 'Guardar permisos'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
