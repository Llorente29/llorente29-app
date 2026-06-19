// src/modules/orders/pages/OrdersSettingsPage.tsx
//
// Ajustes de Folvy Orders. Hoy una sola sección: "Auto-aceptación de pedidos".
// Esta zona CRECE (tiempos de preparación, sonidos, vista del ticket, throttling…)
// como en Otter Order Manager / Toast Orders Hub / Deliverect — separada del
// tablero en vivo (el feed, siguiente tramo), pero en el mismo mundo "pedidos".
//
// Auto-aceptación: estándar de los integradores — el pedido entra YA aceptado,
// nadie corre contra el reloj de 10 min de Uber. Baseline ON; aquí se APAGA por
// canal el que no la quiera. La decisión la ejecuta la frontera (webhook), no
// esta pantalla; aquí solo se configura. Nivel MARCA llegará con P-A.

import { useEffect, useState } from 'react'
import { SlidersHorizontal, Zap, Loader2, AlertCircle, Info } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listChannelAcceptance,
  setChannelAutoAccept,
  type ChannelAcceptance,
} from '@/modules/orders/services/orderAcceptanceService'

export default function OrdersSettingsPage() {
  const { activeAccountId } = useActiveAccount()

  const [channels, setChannels] = useState<ChannelAcceptance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listChannelAcceptance(activeAccountId)
      .then(rows => { if (!cancelled) { setChannels(rows); setLoading(false) } })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando los canales')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeAccountId])

  async function toggle(ch: ChannelAcceptance) {
    if (!activeAccountId || savingId) return
    const next = !ch.autoAccept
    // Optimista: refleja el cambio ya; revierte si falla.
    setChannels(prev => prev.map(c =>
      c.channelId === ch.channelId ? { ...c, autoAccept: next, hasExplicitRow: true } : c))
    setSavingId(ch.channelId)
    try {
      await setChannelAutoAccept(activeAccountId, ch.channelId, next)
    } catch (e: unknown) {
      setChannels(prev => prev.map(c =>
        c.channelId === ch.channelId ? { ...c, autoAccept: ch.autoAccept } : c))
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={20} className="text-accent shrink-0" />
        <h1 className="text-xl font-semibold text-text-primary">Ajustes de pedidos</h1>
      </div>

      {/* Sección: Auto-aceptación */}
      <section className="rounded-xl border border-border-default bg-card overflow-hidden">
        <div className="p-4 border-b border-border-default">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-accent shrink-0" />
            <h2 className="text-base font-semibold text-text-primary">Auto-aceptación de pedidos</h2>
          </div>
          <p className="text-sm text-text-secondary mt-1.5">
            Cuando está activada, los pedidos de ese canal se <strong>aceptan solos</strong> al entrar,
            sin esperar a que nadie pulse un botón. Es lo recomendado: evita perder pedidos por el
            límite de tiempo de plataformas como Uber. Desactívala en un canal solo si quieres
            aceptar a mano.
          </p>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-text-secondary p-6">
            <Loader2 className="animate-spin" size={18} /> Cargando canales…
          </div>
        ) : channels.length === 0 ? (
          <div className="p-6 text-sm text-text-secondary">
            Esta cuenta aún no tiene canales de venta configurados. Cuando conectes Glovo, Uber o
            Just Eat, aparecerán aquí para controlar su auto-aceptación.
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {channels.map(ch => {
              const saving = savingId === ch.channelId
              return (
                <li key={ch.channelId} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: ch.color || '#8B8178' }}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">
                    {ch.name}
                  </span>
                  <span className={`text-xs ${ch.autoAccept ? 'text-success' : 'text-text-secondary'}`}>
                    {ch.autoAccept ? 'Automática' : 'Manual'}
                  </span>
                  {/* Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ch.autoAccept}
                    aria-label={`Auto-aceptación de ${ch.name}`}
                    disabled={saving}
                    onClick={() => void toggle(ch)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-base ${
                      ch.autoAccept ? 'bg-accent' : 'bg-border-strong'
                    } ${saving ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-base ${
                        ch.autoAccept ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Aviso de nivel marca (P-A) */}
        {!loading && channels.length > 0 && (
          <div className="px-4 py-3 border-t border-border-default text-xs text-text-secondary flex items-start gap-2">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>
              La auto-aceptación se controla por canal. El ajuste fino por marca llegará cuando se
              habiliten las conexiones por marca.
            </span>
          </div>
        )}
      </section>
    </div>
  )
}
