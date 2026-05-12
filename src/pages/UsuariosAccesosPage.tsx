// src/pages/UsuariosAccesosPage.tsx
// Panel de administración de usuarios y roles. SOLO PARA ADMIN.

import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Card, Badge, Modal, Label, Select, Alert } from '../components/ui'
import {
  listUsers,
  changeUserRole,
  setManagerLocations,
  setUserActive,
  type UserListItem,
} from '../services/userManagementService'
import { getCurrentProfile, type UserProfile, type UserRole } from '../services/authService'
import ManagerPermissionsModal from '../components/ManagerPermissionsModal'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Encargado',
  worker: 'Trabajador',
}

const ROLE_COLORS: Record<UserRole, 'red' | 'amber' | 'gray'> = {
  admin: 'red',
  manager: 'amber',
  worker: 'gray',
}

const ROLE_ICONS: Record<UserRole, string> = {
  admin: '👑',
  manager: '👔',
  worker: '👷',
}

export default function UsuariosAccesosPage() {
  const { locations } = useApp()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null)
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null)
  const [filter, setFilter] = useState<'all' | 'admin' | 'manager' | 'worker' | 'inactive'>('all')

  // Cargar profile actual y lista de usuarios
  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [profile, list] = await Promise.all([
        getCurrentProfile(),
        listUsers(),
      ])
      setCurrentProfile(profile)
      setUsers(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // Si NO es admin, denegar acceso
  if (currentProfile && currentProfile.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Card className="p-6 text-center">
          <p className="text-4xl mb-3">🚫</p>
          <p className="font-bold text-gray-900 mb-2">Acceso denegado</p>
          <p className="text-sm text-gray-600">
            Solo los administradores pueden gestionar usuarios y roles.
          </p>
        </Card>
      </div>
    )
  }

  // Filtros
  const filteredUsers = users.filter(u => {
    if (filter === 'inactive') return !u.active
    if (filter === 'all') return u.active
    return u.role === filter && u.active
  })

  const stats = {
    total: users.filter(u => u.active).length,
    admins: users.filter(u => u.active && u.role === 'admin').length,
    managers: users.filter(u => u.active && u.role === 'manager').length,
    workers: users.filter(u => u.active && u.role === 'worker').length,
    inactive: users.filter(u => !u.active).length,
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'Instrument Serif, serif' }}>👥 Usuarios y Accesos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats.total} usuarios activos · {stats.inactive} inactivos
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reload}>
          🔄 Recargar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-gray-500">👑 Admins</p>
          <p className="text-2xl font-bold">{stats.admins}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">👔 Encargados</p>
          <p className="text-2xl font-bold">{stats.managers}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">👷 Trabajadores</p>
          <p className="text-2xl font-bold">{stats.workers}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">🚫 Inactivos</p>
          <p className="text-2xl font-bold">{stats.inactive}</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['all', 'admin', 'manager', 'worker', 'inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              filter === f
                ? 'bg-white shadow text-[#7C1A1A]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {f === 'all' ? 'Activos' :
             f === 'admin' ? '👑 Admins' :
             f === 'manager' ? '👔 Encargados' :
             f === 'worker' ? '👷 Trabajadores' :
             '🚫 Inactivos'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && <Alert type="error">{error}</Alert>}

      {/* Lista de usuarios */}
      {loading ? (
        <Card className="p-6 text-center text-sm text-gray-500">Cargando usuarios...</Card>
      ) : filteredUsers.length === 0 ? (
        <Card className="p-6 text-center text-sm text-gray-500">
          No hay usuarios en este filtro
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map(u => {
            const isCurrentUser = u.userId === currentProfile?.userId
            return (
              <Card
                key={u.id}
                className={`p-4 cursor-pointer hover:shadow-md transition ${!u.active ? 'opacity-60' : ''}`}
                onClick={() => setEditingUser(u)}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar / icon */}
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-xl">
                    {ROLE_ICONS[u.role]}
                  </div>

                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 truncate">
                        {u.displayName || u.employeeName || '(Sin nombre)'}
                      </p>
                      {isCurrentUser && (
                        <Badge color="gray">Yo</Badge>
                      )}
                      <Badge color={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                      {!u.active && <Badge color="gray">🚫 Inactivo</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{u.email || '—'}</p>
                    {u.role === 'manager' && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        📍 {u.managedLocationIds.length} {u.managedLocationIds.length === 1 ? 'local' : 'locales'} asignados
                      </p>
                    )}
                    {!u.employeeId && u.role !== 'admin' && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        ⚠️ Sin empleado vinculado
                      </p>
                    )}
                  </div>

                  <div className="text-gray-400">›</div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de edición */}
      {editingUser && currentProfile && (
        <EditUserModal
          user={editingUser}
          isCurrentUser={editingUser.userId === currentProfile.userId}
          locations={locations}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

// ─── Modal de edición de usuario ──────────────────────────────────────────────

interface EditUserModalProps {
  user: UserListItem
  isCurrentUser: boolean
  locations: ReturnType<typeof useApp>['locations']
  onClose: () => void
  onSaved: () => void
}

function EditUserModal({ user, isCurrentUser, locations, onClose, onSaved }: EditUserModalProps) {
  const [role, setRole] = useState<UserRole>(user.role)
  const [managedLocs, setManagedLocs] = useState<string[]>(user.managedLocationIds)
  const [active, setActive] = useState(user.active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPermissions, setShowPermissions] = useState(false)

  function toggleLoc(locId: string) {
    setManagedLocs(prev =>
      prev.includes(locId) ? prev.filter(x => x !== locId) : [...prev, locId]
    )
  }

  async function handleSave() {
    setError(null)
    setSaving(true)

    // 1) Cambiar rol si cambió
    if (role !== user.role) {
      const r = await changeUserRole(user.id, role, user.role)
      if (!r.ok) {
        setError(r.error || 'Error al cambiar rol')
        setSaving(false)
        return
      }
    }

    // 2) Actualizar manager_locations si es manager
    if (role === 'manager') {
      const r = await setManagerLocations(user.id, managedLocs)
      if (!r.ok) {
        setError(r.error || 'Error al guardar locales')
        setSaving(false)
        return
      }
    }

    // 3) Activar/desactivar si cambió
    if (active !== user.active) {
      const r = await setUserActive(user.id, active, user.role, isCurrentUser)
      if (!r.ok) {
        setError(r.error || 'Error al cambiar estado')
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onSaved()
  }

  // Es admin? bloquear cambios sensibles
  const isAdminUser = user.role === 'admin'

  return (
    <Modal open onClose={onClose} title={user.displayName || user.employeeName || 'Usuario'}>
      <div className="space-y-4">
        {/* Info del usuario */}
        <Card className="p-3 bg-gray-50">
          <p className="text-xs text-gray-500">Email</p>
          <p className="text-sm font-medium">{user.email || '—'}</p>
          {user.employeeName && (
            <>
              <p className="text-xs text-gray-500 mt-2">Empleado vinculado</p>
              <p className="text-sm font-medium">{user.employeeName}</p>
            </>
          )}
        </Card>

        {/* Mensaje si es tu propio usuario */}
        {isCurrentUser && (
          <Alert type="info">
            Este es tu propio usuario. Algunas acciones están bloqueadas por seguridad.
          </Alert>
        )}

        {/* Mensaje si es admin */}
        {isAdminUser && (
          <Alert type="warning">
            Los administradores no se pueden modificar desde aquí por seguridad.
            Para cambiar un admin, otro admin debe hacerlo en la BD.
          </Alert>
        )}

        {/* Rol */}
        <div>
          <Label>Rol</Label>
          <Select
            value={role}
            onChange={e => setRole(e.target.value as UserRole)}
            disabled={isAdminUser}
          >
            <option value="worker">👷 Trabajador</option>
            <option value="manager">👔 Encargado</option>
            {role === 'admin' && <option value="admin">👑 Admin</option>}
          </Select>
          {role === 'manager' && (
            <p className="text-[11px] text-gray-500 mt-1">
              El encargado gestionará los locales que selecciones abajo.
            </p>
          )}
          {role === 'worker' && (
            <p className="text-[11px] text-gray-500 mt-1">
              El trabajador solo verá su información personal (horario, vacaciones, fichajes).
            </p>
          )}
        </div>

        {/* Locales (solo si manager) */}
        {role === 'manager' && (
          <div>
            <Label>Locales que gestiona</Label>
            <div className="space-y-1.5 mt-1">
              {locations.map(l => (
                <label
                  key={l.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-[#7C1A1A] cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={managedLocs.includes(l.id)}
                    onChange={() => toggleLoc(l.id)}
                  />
                  <span>{l.name}</span>
                </label>
              ))}
            </div>
            {managedLocs.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                ⚠️ Un encargado sin locales asignados no podrá ver datos.
              </p>
            )}
          </div>
        )}

        {/* Permisos del manager (botón que abre modal aparte) */}
        {role === 'manager' && user.role === 'manager' && (
          <div>
            <Label>Pantallas que puede ver</Label>
            <button
              onClick={() => setShowPermissions(true)}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 hover:border-[#7C1A1A] text-sm text-left flex items-center justify-between"
            >
              <span>🔐 Configurar permisos individuales</span>
              <span className="text-gray-400">›</span>
            </button>
            <p className="text-[11px] text-gray-500 mt-1">
              Define qué módulos podrá ver este encargado al entrar.
            </p>
          </div>
        )}
        {role === 'manager' && user.role !== 'manager' && (
          <Alert type="info">
            Tras guardar el cambio de rol, vuelve a abrir este usuario para configurar sus permisos.
          </Alert>
        )}

        {/* Activo / Inactivo */}
        {!isAdminUser && !isCurrentUser && (
          <div>
            <Label>Estado de la cuenta</Label>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setActive(true)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                  active
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}
              >
                ✅ Activa
              </button>
              <button
                onClick={() => setActive(false)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                  !active
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}
              >
                🚫 Inactiva
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Si desactivas, el usuario no podrá entrar a la app (su empleado sigue existiendo).
            </p>
          </div>
        )}

        {error && <Alert type="error">{error}</Alert>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || isAdminUser}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </div>

      {/* Modal anidado: permisos del manager */}
      {showPermissions && (
        <ManagerPermissionsModal
          userProfileId={user.id}
          userName={user.displayName || user.employeeName || 'Encargado'}
          onClose={() => setShowPermissions(false)}
        />
      )}
    </Modal>
  )
}
