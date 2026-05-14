// src/components/NotificationBell.tsx
// Campana con dropdown de notificaciones para el trabajador.
// Muestra badge con número de no leídas, lista al pulsar, marca como leída al click.

import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Wallet,
  CheckCircle2,
  XCircle,
  Calendar,
  RefreshCw,
  Megaphone,
  Inbox,
  type LucideIcon,
} from 'lucide-react'
import {
  fetchNotifications,
  countUnread,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  type EmployeeNotification,
  type NotificationType,
} from '../services/notificationsService'

interface Props {
  employeeId: string
}

const ICONS: Record<NotificationType, LucideIcon> = {
  period_closed: Wallet,
  vacation_approved: CheckCircle2,
  vacation_rejected: XCircle,
  schedule_published: Calendar,
  shift_swap_request: RefreshCw,
  generic: Megaphone,
}

export default function NotificationBell({ employeeId }: Props) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<EmployeeNotification[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Cargar contador inicial y refrescar cada minuto
  useEffect(() => {
    if (!employeeId) return
    let cancel = false
    async function tick() {
      const c = await countUnread(employeeId)
      if (!cancel) setUnread(c)
    }
    tick()
    const interval = setInterval(tick, 60_000)
    return () => { cancel = true; clearInterval(interval) }
  }, [employeeId])

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function openAndLoad() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setLoading(true)
    const list = await fetchNotifications(employeeId, { limit: 20 })
    setItems(list)
    setLoading(false)
  }

  async function handleClickItem(n: EmployeeNotification) {
    if (!n.read) {
      await markAsRead(n.id)
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
      setUnread(c => Math.max(0, c - 1))
    }
  }

  async function handleMarkAllRead() {
    await markAllAsRead(employeeId)
    setItems(prev => prev.map(x => ({ ...x, read: true })))
    setUnread(0)
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const wasUnread = items.find(n => n.id === id)?.read === false
    await deleteNotification(id)
    setItems(prev => prev.filter(x => x.id !== id))
    if (wasUnread) setUnread(c => Math.max(0, c - 1))
  }

  function timeAgo(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seconds < 60) return 'ahora'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `hace ${minutes} min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `hace ${hours} h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `hace ${days} d`
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botón campana */}
      <button
        onClick={openAndLoad}
        className="relative w-10 h-10 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
      >
        <Bell size={20} className="text-accent" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-text-on-accent text-[10px] font-bold flex items-center justify-center border-2 border-card"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-card rounded-xl shadow-xl border border-border-default z-50 overflow-hidden"
          style={{ maxHeight: '70vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-accent">
            <div className="text-text-on-accent font-semibold text-sm">Notificaciones</div>
            {unread > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] text-text-on-accent/80 hover:text-text-on-accent underline"
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 44px)' }}>
            {loading ? (
              <div className="p-6 text-center text-sm text-text-secondary">Cargando...</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center">
                <div className="flex justify-center mb-2">
                  <Inbox size={28} className="text-text-secondary" />
                </div>
                <div className="text-sm text-text-secondary">Sin notificaciones</div>
              </div>
            ) : (
              items.map(n => {
                const ItemIcon = ICONS[n.type] || Megaphone
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClickItem(n)}
                    className={`w-full text-left px-3 py-2.5 border-b border-border-default last:border-0 hover:bg-accent-bg flex gap-2.5 transition-base group ${
                      !n.read ? 'bg-accent-bg/50' : ''
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      <ItemIcon size={20} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className={`text-sm leading-tight ${!n.read ? 'font-semibold text-text-primary' : 'text-text-primary'}`}>
                          {n.title}
                        </div>
                        {!n.read && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0 mt-1.5 bg-accent"
                            aria-label="No leída"
                          />
                        )}
                      </div>
                      <div className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                        {n.body}
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="text-[10px] text-text-secondary">{timeAgo(n.createdAt)}</div>
                        <span
                          onClick={e => handleDelete(n.id, e)}
                          className="text-[10px] text-text-secondary hover:text-danger opacity-0 group-hover:opacity-100 transition-base cursor-pointer"
                        >
                          Borrar
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
