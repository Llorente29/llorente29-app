// src/components/ManagerPermissionsModal.tsx
// Modal para configurar permisos individuales de un manager.
// Solo accesible para admin.
//
// BLOQUE B-7 (16/05/2026): migrado al service nuevo de multitenancy.
//   - Shape camelCase (showDashboard, userProfileId, etc.)
//   - 30 booleanos (incluye showAppccToday/showAppccIncidents que ahora
//     aparecen como toggles en la UI; antes existían en BBDD pero la UI
//     no los exponía).
//   - Convención de errores: try/catch en lugar de { ok, error }.

import { useState, useEffect } from 'react'
import {
  LayoutDashboard, User, Activity, Clock, MonitorSmartphone, Inbox, Armchair,
  RefreshCw, Calendar, ClipboardList, FileText, Wallet, DollarSign, Settings2,
  Leaf, AlertTriangle,
  FlaskConical, BarChart3, Brain, Bike, Package, MapPin, Bell,
  type LucideIcon,
} from 'lucide-react'
import { Modal, Button, Card, Alert } from './ui'
import {
  getPermissionsOrDefaults,
  savePermissions,
  resetPermissions,
} from '@/modules/multitenancy/services/managerPermissionsService'
import type { ManagerPermissions } from '@/types/multitenancy'

interface Props {
  userProfileId: string
  userName: string
  onClose: () => void
  onSaved?: () => void
}

/**
 * Subset de claves de ManagerPermissions que son booleanos editables.
 * Excluye campos meta (userProfileId, createdAt, updatedAt).
 */
type PermissionKey = Exclude<keyof ManagerPermissions, 'userProfileId' | 'createdAt' | 'updatedAt'>

interface PermissionItem {
  key: PermissionKey
  label: string
  Icon: LucideIcon
  section: string
  sensitive?: boolean
}

const PERMISSION_ITEMS: PermissionItem[] = [
  // Principales
  { key: 'showDashboard',             label: 'Dashboard',           Icon: LayoutDashboard, section: 'Principal' },
  { key: 'showStaff',                 label: 'Personal',            Icon: User, section: 'Principal' },
  { key: 'showAhoraMismo',            label: 'Ahora mismo',         Icon: Activity, section: 'Principal' },

  // Personal y horarios
  { key: 'showFichajesGlobal',        label: 'Control Horario',     Icon: Clock, section: 'Personal' },
  { key: 'showKioskoFichaje',         label: 'Kiosko Fichaje',      Icon: MonitorSmartphone, section: 'Personal' },
  { key: 'showSolicitudesPendientes', label: 'Solicitudes',         Icon: Inbox, section: 'Personal' },
  { key: 'showTurnosAbiertos',        label: 'Turnos abiertos',     Icon: Armchair, section: 'Personal' },
  { key: 'showCambiosPendientes',     label: 'Cambios de turno',    Icon: RefreshCw, section: 'Personal' },
  { key: 'showCalendario',            label: 'Calendario',          Icon: Calendar, section: 'Personal' },
  { key: 'showPlantillaTurnos',       label: 'Plantilla turnos',    Icon: ClipboardList, section: 'Personal' },
  { key: 'showInformesPersonal',      label: 'Informes Gestoría',   Icon: FileText, section: 'Personal', sensitive: true },
  { key: 'showBolsaHoras',            label: 'Bolsa de horas',      Icon: Wallet, section: 'Personal' },
  { key: 'showSalaries',              label: 'Ver salarios',        Icon: DollarSign, section: 'Personal', sensitive: true },
  { key: 'canManageEmployees',        label: 'Crear / dar de baja / eliminar empleados', Icon: Settings2, section: 'Personal', sensitive: true },

  // APPCC (NUEVOS - antes ocultos en UI a pesar de existir en BBDD)
  { key: 'showAppccToday',            label: 'APPCC: Hoy',          Icon: Leaf, section: 'APPCC' },
  { key: 'showAppccIncidents',        label: 'APPCC: Incidencias',  Icon: AlertTriangle, section: 'APPCC' },

  // Inventario y análisis
  { key: 'showTspoon',                label: 'Fichas Técnicas',     Icon: FlaskConical, section: 'Inventario' },
  { key: 'showVentasAnalisis',        label: 'Análisis de Ventas',  Icon: BarChart3, section: 'Inventario' },
  { key: 'showPrediccionPersonal',    label: 'Predicción Personal', Icon: Brain, section: 'Inventario' },
  { key: 'showZonasPedido',           label: 'Zonas de Pedido',     Icon: Bike, section: 'Inventario', sensitive: true },
  { key: 'showInventory',             label: 'Inventario',          Icon: Package, section: 'Inventario' },

  // Configuración
  { key: 'showLocations',             label: 'Locales',             Icon: MapPin, section: 'Configuración', sensitive: true },
  { key: 'showTspoonSettings',        label: 'Avisos',              Icon: Bell, section: 'Configuración', sensitive: true },
]

const SECTIONS = ['Principal', 'Personal', 'APPCC', 'Inventario', 'Configuración']

export default function ManagerPermissionsModal({ userProfileId, userName, onClose, onSaved }: Props) {
  const [perms, setPerms] = useState<ManagerPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPermissionsOrDefaults(userProfileId).then(p => {
      if (!cancelled) {
        setPerms(p)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [userProfileId])

  function toggle(key: PermissionKey) {
    if (!perms) return
    setPerms({ ...perms, [key]: !perms[key] })
  }

  function setSection(section: string, value: boolean) {
    if (!perms) return
    const updates: Partial<ManagerPermissions> = {}
    PERMISSION_ITEMS
      .filter(i => i.section === section)
      .forEach(i => { (updates as Record<string, unknown>)[i.key] = value })
    setPerms({ ...perms, ...updates })
  }

  async function handleSave() {
    if (!perms) return
    setSaving(true)
    setError(null)
    try {
      // El nuevo service espera Omit<ManagerPermissions, 'createdAt' | 'updatedAt'>.
      // Quitamos las meta antes de mandar.
      const { createdAt: _c, updatedAt: _u, ...payload } = perms
      void _c; void _u
      await savePermissions(payload)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!confirm('¿Restaurar permisos por defecto para este encargado?')) return
    setSaving(true)
    setError(null)
    try {
      const reloaded = await resetPermissions(userProfileId)
      setPerms(reloaded)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al restaurar')
    } finally {
      setSaving(false)
    }
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
                            checked={!!perms[item.key]}
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
