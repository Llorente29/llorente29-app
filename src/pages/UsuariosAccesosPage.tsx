// src/pages/UsuariosAccesosPage.tsx
// Panel de administración de usuarios y roles. SOLO PARA ADMIN.

import { useState, useEffect } from 'react'
import { Users, RefreshCw, ShieldCheck, Briefcase, User, Ban, MapPin, AlertTriangle, Lock, Check, ChevronRight } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { usePermissions } from '@/modules/multitenancy/hooks/usePermissions'
import { Button, Card, Badge, Modal, Label, Select, Alert } from '../components/ui'
import {
  listUsers,
  changeUserRole,
  setManagerLocations,
  setUserActive,
  type UserListItem,
} from '../services/userManagementService'
import { type UserProfileRole as UserRole } from '@/types/multitenancy'
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

const ROLE_ICONS: Record<UserRole, typeof ShieldCheck> = {
  admin: ShieldCheck,
  manager: Briefcase,
  worker: User,
}

export default function UsuariosAccesosPage() {
  const { locations, authUserId, accountsLoading, activeAccountId } = useApp()
  const { isFullAccess } = usePermissions()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null)
  const [filter, setFilter] = useState<'all' | 'admin' | 'manager' | 'worker' | 'inactive'>('all')

  // BLOQUE B-6a (17/05/2026): migrado de getCurrentProfile() a hooks.
  //   - Gate de admin: usePermissions().isFullAccess (scope cuenta activa).
  //   - Identificación del propio user: useApp().authUserId.
  //   - Sin query Supabase adicional: el AppContext ya tiene todo cargado.
  //
  // BLOQUE B-6c (17/05/2026): listUsers ahora filtra por cuenta activa.
  //   - Sin activeAccountId → vaciamos la lista (estamos cargando).
  //   - Al cambiar de cuenta → re-disparar reload.

  // Cargar lista de usuarios de la cuenta activa.
  async function reload(accountId: string | null) {
    if (!accountId) {
      setUsers([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await listUsers(accountId)
      setUsers(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload(activeAccountId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

  // Mientras se resuelve la cuenta activa (auth + accounts + userProfile),
  // mostramos cargando para no flashear "Acceso denegado".
  if (accountsLoading) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Card className="p-6 text-center text-sm text-text-secondary">Cargando...</Card>
      </div>
    )
  }

  // Si NO tiene acceso pleno (admin global o admin de cuenta), denegar acceso.
  if (!isFullAccess) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Card className="p-6 text-center">
          <div className="flex justify-center mb-3">
            <Ban size={40} className="text-danger" strokeWidth={2} />
          </div>
          <p className="font-bold text-text-primary mb-2">Acceso denegado</p>
          <p className="text-sm text-text-secondary">
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
          <h1 className="font-display text-2xl text-accent inline-flex items-center gap-2">
            <Users size={24} /> Usuarios y Accesos
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {stats.total} usuarios activos · {stats.inactive} inactivos
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => reload(activeAccountId)}>
          <span className="inline-flex items-center gap-1.5"><RefreshCw size={14} /> Recargar</span>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-text-secondary inline-flex items-center gap-1"><ShieldCheck size={12} /> Admins</p>
          <p className="text-2xl font-bold text-text-primary">{stats.admins}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-text-secondary inline-flex items-center gap-1"><Briefcase size={12} /> Encargados</p>
          <p className="text-2xl font-bold text-text-primary">{stats.managers}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-text-secondary inline-flex items-center gap-1"><User size={12} /> Trabajadores</p>
          <p className="text-2xl font-bold text-text-primary">{stats.workers}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-text-secondary inline-flex items-center gap-1"><Ban size={12} /> Inactivos</p>
          <p className="text-2xl font-bold text-text-primary">{stats.inactive}</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1 bg-accent-bg rounded-lg p-1 w-fit flex-wrap">
        {(['all', 'admin', 'manager', 'worker', 'inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-base ${
              filter === f
                ? 'bg-card shadow text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {f === 'all' ? 'Activos' :
             f === 'admin' ? <><ShieldCheck size={12} /> Admins</> :
             f === 'manager' ? <><Briefcase size={12} /> Encargados</> :
             f === 'worker' ? <><User size={12} /> Trabajadores</> :
             <><Ban size={12} /> Inactivos</>}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && <Alert type="error">{error}</Alert>}

      {/* Lista de usuarios */}
      {loading ? (
        <Card className="p-6 text-center text-sm text-text-secondary">Cargando usuarios...</Card>
      ) : filteredUsers.length === 0 ? (
        <Card className="p-6 text-center text-sm text-text-secondary">
          No hay usuarios en este filtro
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map(u => {
            const isCurrentUser = u.userId === authUserId
            const RoleIcon = ROLE_ICONS[u.role]
            return (
              <Card
                key={u.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-base ${!u.active ? 'opacity-60' : ''}`}
                onClick={() => setEditingUser(u)}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar / icon */}
                  <div className="w-10 h-10 rounded-full bg-accent-bg flex items-center justify-center text-accent">
                    <RoleIcon size={20} />
                  </div>

                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-text-primary truncate">
                        {u.displayName || u.employeeName || '(Sin nombre)'}
                      </p>
                      {isCurrentUser && (
                        <Badge color="gray">Yo</Badge>
                      )}
                      <Badge color={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                      {!u.active && <Badge color="gray"><span className="inline-flex items-center gap-1"><Ban size={10} /> Inactivo</span></Badge>}
                    </div>
                    <p className="text-xs text-text-secondary truncate">{u.email || '—'}</p>
                    {u.role === 'manager' && (
                      <p className="text-xs text-text-secondary mt-0.5 inline-flex items-center gap-1">
                        <MapPin size={11} /> {u.managedLocationIds.length} {u.managedLocationIds.length === 1 ? 'local' : 'locales'} asignados
                      </p>
                    )}
                    {!u.employeeId && u.role !== 'admin' && (
                      <p className="text-xs text-warning mt-0.5 inline-flex items-center gap-1">
                        <AlertTriangle size={11} /> Sin empleado vinculado
                      </p>
                    )}
                  </div>

                  <ChevronRight size={16} className="text-text-secondary" />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de edición */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          isCurrentUser={editingUser.userId === authUserId}
          locations={locations}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null)
            reload(activeAccountId)
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
        <Card className="p-3 bg-page">
          <p className="text-xs text-text-secondary">Email</p>
          <p className="text-sm font-medium text-text-primary">{user.email || '—'}</p>
          {user.employeeName && (
            <>
              <p className="text-xs text-text-secondary mt-2">Empleado vinculado</p>
              <p className="text-sm font-medium text-text-primary">{user.employeeName}</p>
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
            <option value="worker">Trabajador</option>
            <option value="manager">Encargado</option>
            {role === 'admin' && <option value="admin">Admin</option>}
          </Select>
          {role === 'manager' && (
            <p className="text-[11px] text-text-secondary mt-1">
              El encargado gestionará los locales que selecciones abajo.
            </p>
          )}
          {role === 'worker' && (
            <p className="text-[11px] text-text-secondary mt-1">
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
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-default hover:border-accent cursor-pointer text-sm text-text-primary transition-base"
                >
                  <input
                    type="checkbox"
                    checked={managedLocs.includes(l.id)}
                    onChange={() => toggleLoc(l.id)}
                    className="accent-accent"
                  />
                  <span>{l.name}</span>
                </label>
              ))}
            </div>
            {managedLocs.length === 0 && (
              <p className="text-[11px] text-warning mt-1 inline-flex items-center gap-1">
                <AlertTriangle size={11} /> Un encargado sin locales asignados no podrá ver datos.
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
              className="w-full mt-1 px-3 py-2 rounded-lg border border-border-default hover:border-accent text-sm text-left flex items-center justify-between text-text-primary transition-base"
            >
              <span className="inline-flex items-center gap-1.5"><Lock size={14} className="text-accent" /> Configurar permisos individuales</span>
              <ChevronRight size={16} className="text-text-secondary" />
            </button>
            <p className="text-[11px] text-text-secondary mt-1">
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
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-base ${
                  active
                    ? 'bg-success-bg border-success/30 text-success'
                    : 'bg-card border-border-default text-text-secondary'
                }`}
              >
                <Check size={14} /> Activa
              </button>
              <button
                onClick={() => setActive(false)}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-base ${
                  !active
                    ? 'bg-danger-bg border-danger/30 text-danger'
                    : 'bg-card border-border-default text-text-secondary'
                }`}
              >
                <Ban size={14} /> Inactiva
              </button>
            </div>
            <p className="text-[11px] text-text-secondary mt-1">
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
