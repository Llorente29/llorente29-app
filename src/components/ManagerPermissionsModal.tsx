// src/components/ManagerPermissionsModal.tsx
// Modal para configurar permisos individuales de un manager.
// Solo accesible para admin.

import { useState, useEffect } from 'react'
import {
  LayoutDashboard, User, Activity, Clock, MonitorSmartphone, Inbox, Armchair,
  RefreshCw, Calendar, ClipboardList, FileText, Wallet, DollarSign, Settings2,
  CheckSquare, Repeat, FilePlus2, AlertTriangle, Search, History,
  FlaskConical, BarChart3, Brain, Bike, Package, MapPin, Bell,
  type LucideIcon,
} from 'lucide-react'
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
  Icon: LucideIcon
  section: string
  sensitive?: boolean
}

const PERMISSION_ITEMS: PermissionItem[] = [
  // Principales
  { key: 'show_dashboard',            label: 'Dashboard',           Icon: LayoutDashboard, section: 'Principal' },
  { key: 'show_staff',                label: 'Personal',            Icon: User, section: 'Principal' },
  { key: 'show_ahora_mismo',          label: 'Ahora mismo',         Icon: Activity, section: 'Principal' },

  // Personal y horarios
  { key: 'show_fichajes_global',      label: 'Control Horario',     Icon: Clock, section: 'Personal' },
  { key: 'show_kiosko_fichaje',       label: 'Kiosko Fichaje',      Icon: MonitorSmartphone, section: 'Personal' },
  { key: 'show_solicitudes_pendientes', label: 'Solicitudes',       Icon: Inbox, section: 'Personal' },
  { key: 'show_turnos_abiertos',      label: 'Turnos abiertos',     Icon: Armchair, section: 'Personal' },
  { key: 'show_cambios_pendientes',   label: 'Cambios de turno',    Icon: RefreshCw, section: 'Personal' },
  { key: 'show_calendario',           label: 'Calendario',          Icon: Calendar, section: 'Personal' },
  { key: 'show_plantilla_turnos',     label: 'Plantilla turnos',    Icon: ClipboardList, section: 'Personal' },
  { key: 'show_informes_personal',    label: 'Informes Gestoría',   Icon: FileText, section: 'Personal', sensitive: true },
  { key: 'show_bolsa_horas',          label: 'Bolsa de horas',      Icon: Wallet, section: 'Personal' },
  { key: 'show_salaries',             label: 'Ver salarios',        Icon: DollarSign, section: 'Personal', sensitive: true },
  { key: 'can_manage_employees',      label: 'Crear / dar de baja / eliminar empleados', Icon: Settings2, section: 'Personal', sensitive: true },

  // Operaciones
  { key: 'show_tasks',                label: 'Tareas',              Icon: CheckSquare, section: 'Operaciones' },
  { key: 'show_scheduled',            label: 'Programadas',         Icon: Repeat, section: 'Operaciones' },
  { key: 'show_templates',            label: 'Plantillas',          Icon: FilePlus2, section: 'Operaciones', sensitive: true },
  { key: 'show_incidents',            label: 'Incidencias',         Icon: AlertTriangle, section: 'Operaciones' },
  { key: 'show_audits',               label: 'Auditorías',          Icon: Search, section: 'Operaciones' },
  { key: 'show_history',              label: 'Historial',           Icon: History, section: 'Operaciones' },

  // Inventario y análisis
  { key: 'show_tspoon',               label: 'Fichas Técnicas',     Icon: FlaskConical, section: 'Inventario' },
  { key: 'show_ventas_analisis',      label: 'Análisis de Ventas',  Icon: BarChart3, section: 'Inventario' },
  { key: 'show_prediccion_personal',  label: 'Predicción Personal', Icon: Brain, section: 'Inventario' },
  { key: 'show_zonas_pedido',         label: 'Zonas de Pedido',     Icon: Bike, section: 'Inventario', sensitive: true },
  { key: 'show_inventory',            label: 'Inventario',          Icon: Package, section: 'Inventario' },

  // Configuración
  { key: 'show_locations',            label: 'Locales',             Icon: MapPin, section: 'Configuración', sensitive: true },
  { key: 'show_tspoon_settings',      label: 'Avisos',              Icon: Bell, section: 'Configuración', sensitive: true },
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
        <p className="text-sm text-text-secondary inline-flex items-center gap-1.5">
          Marca las pantallas que el encargado podrá ver. Las sensibles están marcadas con
          <AlertTriangle size={12} className="text-warning" />.
        </p>

        {loading ? (
          <Card className="p-6 text-center text-sm text-text-secondary">Cargando permisos...</Card>
        ) : !perms ? (
          <Alert type="error">No se han podido cargar los permisos</Alert>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-page rounded-lg">
              <p className="text-sm font-medium">
                {enabledCount} de {PERMISSION_ITEMS.length} pantallas habilitadas
              </p>
              <button
                onClick={handleReset}
                disabled={saving}
                className="text-xs text-text-secondary underline hover:text-text-primary"
              >
                Restaurar por defecto
              </button>
            </div>

            {SECTIONS.map(section => {
              const items = PERMISSION_ITEMS.filter(i => i.section === section)
              const allOn = items.every(i => perms[i.key])
              const allOff = items.every(i => !perms[i.key])

              return (
                <div key={section} className="border border-border-default rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-page px-3 py-2 border-b">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{section}</p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setSection(section, true)}
                        disabled={allOn}
                        className="text-[10px] px-2 py-0.5 rounded border border-border-default hover:bg-card disabled:opacity-30"
                      >
                        Todos
                      </button>
                      <button
                        onClick={() => setSection(section, false)}
                        disabled={allOff}
                        className="text-[10px] px-2 py-0.5 rounded border border-border-default hover:bg-card disabled:opacity-30"
                      >
                        Ninguno
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-border-default">
                    {items.map(item => {
                      const ItemIcon = item.Icon
                      return (
                        <label
                          key={item.key}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-page cursor-pointer text-sm text-text-primary transition-base"
                        >
                          <input
                            type="checkbox"
                            checked={perms[item.key]}
                            onChange={() => toggle(item.key)}
                            className="w-4 h-4 rounded accent-accent"
                          />
                          <ItemIcon size={16} className="text-accent shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {item.sensitive && (
                            <AlertTriangle size={12} className="text-warning" />
                          )}
                        </label>
                      )
                    })}
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
