// src/admin/pages/StaffPage.tsx
//
// Pantalla Staff del Portal de staff: gestión de administradores de plataforma.
// Listar, invitar (email), cambiar rol, ajustar los 11 permisos, suspender/
// reactivar. Solo accesible a admins con manage_admins (lo exigen los RPC; si
// no, la carga falla con mensaje claro).

import { useEffect, useState } from 'react'
import {
  listStaff, inviteAdmin, setRole, setActive, setPermissions,
  ROLES, PERMISSIONS, roleLabel,
  type StaffMember, type InvitePayload,
} from '../services/staffService'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      setStaff(await listStaff())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  async function handleRole(admin: StaffMember, role: string) {
    const res = await setRole(admin.id, role)
    if (!res.ok) { setError(res.error); return }
    flash(`Rol de ${admin.fullName} cambiado a ${roleLabel(role)}.`)
    reload()
  }

  async function handleActive(admin: StaffMember) {
    setError(null)
    const res = await setActive(admin.id, !admin.active)
    if (!res.ok) { setError(res.error); return }
    flash(`${admin.fullName} ${admin.active ? 'suspendido' : 'reactivado'}.`)
    reload()
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-display font-medium" style={{ color: 'var(--color-accent)' }}>Staff</h1>
        <button type="button" onClick={() => setShowInvite(true)}
          className="px-4 py-2 rounded-md text-sm font-medium" style={{ background: 'var(--color-terracota)', color: '#fff' }}>
          Invitar admin
        </button>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Administradores de la plataforma Folvy y sus permisos.
      </p>

      {notice && (
        <div className="rounded-lg p-3 mb-4" style={{ background: '#ECF7EC', border: '1px solid #A8D3A8' }}>
          <p className="text-sm" style={{ color: '#2F6B2F' }}>{notice}</p>
        </div>
      )}
      {error && (
        <div className="rounded-lg p-3 mb-4" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}>
          <p className="text-sm" style={{ color: '#A12626' }}>{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary, #888)' }}>Cargando…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {staff.map(admin => (
            <AdminCard key={admin.id} admin={admin}
              onRole={handleRole} onActive={handleActive}
              onError={setError} onSaved={msg => { flash(msg); reload() }} />
          ))}
        </div>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={(msg) => { setShowInvite(false); flash(msg); reload() }}
          onError={setError}
        />
      )}
    </div>
  )
}

// ─── Tarjeta de un admin ─────────────────────────────────────────────────────

function AdminCard({ admin, onRole, onActive, onError, onSaved }: {
  admin: StaffMember
  onRole: (a: StaffMember, role: string) => void
  onActive: (a: StaffMember) => void
  onError: (msg: string) => void
  onSaved: (msg: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Estado local editable de los 11 flags (indexado por columna platform_can_*).
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PERMISSIONS.map(p => [p.col, admin[p.listKey] as boolean])))
  const [saving, setSaving] = useState(false)

  const dirty = PERMISSIONS.some(p => flags[p.col] !== (admin[p.listKey] as boolean))

  async function savePerms() {
    setSaving(true)
    onError('')
    const res = await setPermissions(admin.id, flags)
    setSaving(false)
    if (!res.ok) { onError(res.error); return }
    onSaved(`Permisos de ${admin.fullName} actualizados.`)
  }

  return (
    <div className="rounded-lg" style={{ border: '1px solid var(--color-border, #e5e5e5)', background: 'var(--color-bg-surface, #fff)' }}>
      <div className="flex items-center gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{admin.fullName}</span>
            {!admin.active && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#FDECEC', color: '#A12626' }}>suspendido</span>}
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary, #999)' }}>
            {admin.email ?? '—'} · último acceso {formatDate(admin.lastLoginAt)}
          </div>
        </div>

        <select value={admin.role} onChange={e => onRole(admin, e.target.value)}
          className="px-3 py-1.5 rounded-md text-sm bg-white" style={{ border: '1px solid var(--color-border, #ccc)' }}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <button type="button" onClick={() => onActive(admin)}
          className="px-3 py-1.5 rounded-md text-sm"
          style={{ border: '1px solid var(--color-border, #ccc)', color: admin.active ? '#A12626' : '#2F6B2F' }}>
          {admin.active ? 'Suspender' : 'Reactivar'}
        </button>

        <button type="button" onClick={() => setExpanded(e => !e)}
          className="px-3 py-1.5 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)', color: 'var(--color-accent)' }}>
          {expanded ? 'Cerrar' : 'Permisos'}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--color-border, #eee)' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-3">
            {PERMISSIONS.map(p => (
              <label key={p.col} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                <input type="checkbox" checked={flags[p.col]} onChange={e => setFlags(f => ({ ...f, [p.col]: e.target.checked }))} />
                {p.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button type="button" onClick={savePerms} disabled={!dirty || saving}
              className="px-4 py-1.5 rounded-md text-sm font-medium"
              style={{ background: 'var(--color-terracota)', color: '#fff', opacity: (!dirty || saving) ? 0.5 : 1 }}>
              {saving ? 'Guardando…' : 'Guardar permisos'}
            </button>
            {dirty && <span className="text-xs" style={{ color: 'var(--color-text-secondary, #888)' }}>Cambios sin guardar</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modal de invitación ─────────────────────────────────────────────────────

function InviteModal({ onClose, onInvited, onError }: {
  onClose: () => void
  onInvited: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [form, setForm] = useState<InvitePayload>({ email: '', fullName: '', role: 'admin' })
  const [sending, setSending] = useState(false)

  async function submit() {
    if (!form.email.includes('@')) { onError('Email no válido.'); return }
    if (form.fullName.trim().length < 2) { onError('Nombre obligatorio.'); return }
    setSending(true)
    onError('')
    const res = await inviteAdmin({ ...form, fullName: form.fullName.trim() })
    setSending(false)
    if (!res.ok) { onError(res.error); return }
    const d = res.data
    const msg = d.is_new_user
      ? (d.welcome_sent ? `Admin invitado. Email de bienvenida enviado a ${form.email}.` : `Admin creado, pero el email de bienvenida no se pudo enviar (reintenta o revisa el log).`)
      : `Usuario existente promovido a admin (${roleLabel(form.role)}).`
    onInvited(msg)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="rounded-lg p-6 w-full max-w-md mx-4" style={{ background: 'var(--color-bg-surface, #fff)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-display font-medium mb-4" style={{ color: 'var(--color-accent)' }}>Invitar administrador</h2>

        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>Email</label>
        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          placeholder="persona@folvy.app" className="w-full px-3 py-2 rounded-md text-sm mb-3" style={{ border: '1px solid var(--color-border, #ccc)' }} />

        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>Nombre</label>
        <input type="text" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
          placeholder="Nombre y apellidos" className="w-full px-3 py-2 rounded-md text-sm mb-3" style={{ border: '1px solid var(--color-border, #ccc)' }} />

        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>Rol</label>
        <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          className="w-full px-3 py-2 rounded-md text-sm mb-2 bg-white" style={{ border: '1px solid var(--color-border, #ccc)' }}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <p className="text-xs mb-5" style={{ color: 'var(--color-text-secondary, #888)' }}>
          El rol siembra los permisos por defecto. Se ajustan después uno a uno. Si el email ya tiene cuenta, se promociona sin reenviar acceso.
        </p>

        <div className="flex items-center gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm" style={{ border: '1px solid var(--color-border, #ccc)', color: 'var(--color-text-secondary, #555)' }}>
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={sending}
            className="px-4 py-2 rounded-md text-sm font-medium" style={{ background: 'var(--color-terracota)', color: '#fff', opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Invitando…' : 'Invitar'}
          </button>
        </div>
      </div>
    </div>
  )
}
