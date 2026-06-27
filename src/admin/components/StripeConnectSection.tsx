// src/admin/components/StripeConnectSection.tsx
//
// Sección "Cobros (Stripe)" dentro de la ficha de cliente del panel admin.
// Permite: conectar la cuenta Stripe del restaurante (onboarding hospedado de
// Stripe), ver su estado real, y fijar la comisión del Shop SIN SQL.
//
// El restaurante es el comerciante de registro (direct charge): el dinero del
// pedido entra en SU cuenta; Folvy cobra su comisión vía application_fee.

import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Loader2, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Percent } from 'lucide-react'
import {
  getStripeState, startStripeOnboarding, refreshStripeState, setShopFeeBps,
  type StripeState,
} from '@/admin/services/stripeConnectService'

type Feedback = { kind: 'ok' | 'error'; msg: string } | null

export default function StripeConnectSection({ accountId }: { accountId: string }) {
  const [state, setState] = useState<StripeState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Comisión en % (lo que ve el admin); en BBDD se guarda en bps.
  const [feePct, setFeePct] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getStripeState(accountId)
      setState(s)
      setFeePct((s.feeBps / 100).toString())
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error cargando Stripe.' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void reload() }, [reload])

  // Si volvemos del onboarding (?stripe=return), refrescamos el estado real.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const flag = params.get('stripe')
    if (flag === 'return' || flag === 'refresh') {
      void doRefresh()
      // limpiar el query para no re-disparar
      const url = new URL(window.location.href)
      url.searchParams.delete('stripe')
      window.history.replaceState({}, '', url.toString())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doConnect() {
    setBusy('connect'); setFeedback(null)
    try {
      const r = await startStripeOnboarding(accountId)
      if (!r.ok || !r.url) { setFeedback({ kind: 'error', msg: r.error ?? 'No se pudo iniciar el onboarding.' }); return }
      // Abrir el onboarding hospedado de Stripe.
      window.location.href = r.url
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error al conectar con Stripe.' })
    } finally {
      setBusy(null)
    }
  }

  async function doRefresh() {
    setBusy('refresh'); setFeedback(null)
    try {
      const r = await refreshStripeState(accountId)
      if (!r.ok) { setFeedback({ kind: 'error', msg: r.error ?? 'No se pudo actualizar.' }); return }
      await reload()
      setFeedback({ kind: 'ok', msg: r.chargesEnabled ? 'Cuenta verificada: ya puede cobrar.' : 'Onboarding aún incompleto en Stripe.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error al actualizar.' })
    } finally {
      setBusy(null)
    }
  }

  async function doSaveFee() {
    const pct = parseFloat(feePct.replace(',', '.'))
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setFeedback({ kind: 'error', msg: 'La comisión debe estar entre 0 y 100 %.' }); return
    }
    setBusy('fee'); setFeedback(null)
    try {
      await setShopFeeBps(accountId, Math.round(pct * 100))
      await reload()
      setFeedback({ kind: 'ok', msg: `Comisión guardada: ${pct} % de cada pedido del Shop.` })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo guardar la comisión.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-base font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
        Cobros (Stripe)
      </h2>
      <p className="text-xs text-text-secondary mb-3">
        Conecta la cuenta de Stripe del restaurante para cobrar los pedidos del Shop. El restaurante recibe el
        dinero en su cuenta; Folvy cobra su comisión por pedido automáticamente.
      </p>

      {feedback && (
        <div className={`rounded-lg p-3 mb-3 text-sm border ${feedback.kind === 'ok'
          ? 'bg-success-bg text-success border-success/20'
          : 'bg-danger-bg text-danger border-danger/20'}`}>
          {feedback.msg}
        </div>
      )}

      {loading || !state ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Estado de la conexión */}
          <div className="rounded-lg border border-border-default bg-card p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <CreditCard size={20} className="text-text-secondary" />
                <div>
                  <StatusBadge state={state} />
                  {state.stripeAccountId && (
                    <div className="text-[10px] text-text-tertiary font-mono mt-1">{state.stripeAccountId}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!state.chargesEnabled && (
                  <button type="button" onClick={doConnect} disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                    {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                    {state.connected ? 'Continuar onboarding' : 'Conectar con Stripe'}
                  </button>
                )}
                {state.connected && (
                  <button type="button" onClick={doRefresh} disabled={busy !== null}
                    title="Actualizar estado desde Stripe"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border-default text-text-secondary hover:bg-page disabled:opacity-50 transition-base">
                    {busy === 'refresh' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Actualizar
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Comisión del Shop */}
          <div className="rounded-lg border border-border-default bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Percent size={16} className="text-text-secondary" />
              <span className="text-sm font-medium text-text-primary">Comisión de Folvy por pedido</span>
            </div>
            <p className="text-xs text-text-secondary mb-3">
              Porcentaje que Folvy cobra de cada pedido del Shop de este cliente. Se descuenta automáticamente
              en el cobro (application fee). 0 % = sin comisión.
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <label className="block">
                <span className="text-[11px] text-text-secondary">Comisión (%)</span>
                <input type="number" min="0" max="100" step="0.1" value={feePct}
                  onChange={e => setFeePct(e.target.value)}
                  className="mt-0.5 w-28 px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
              </label>
              <button type="button" onClick={doSaveFee} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                {busy === 'fee' ? <Loader2 size={14} className="animate-spin" /> : null}
                Guardar comisión
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function StatusBadge({ state }: { state: StripeState }) {
  if (state.chargesEnabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <CheckCircle2 size={16} /> Conectada y operativa
      </span>
    )
  }
  if (state.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: '#8A6516' }}>
        <AlertTriangle size={16} /> Onboarding incompleto
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary">
      <AlertTriangle size={16} /> No conectada
    </span>
  )
}
