// src/modules/kds/components/ClosureAnomalyAlarm.tsx
//
// CAP. B · PATA 3 — ESCALADA a alarma, mismo patrón visual/estructural que
// KdsAlarmOverlay (banner rojo fijo, no se puede ignorar) — pero SOLO salta
// para cierres de marca ANÓMALOS: indefinidos hace >24h, o con resume_at ya
// vencido. Un cierre correcto con hora futura NUNCA dispara esto — para eso
// está ClosuresChip (discreto).
//
// availability-watchdog ya detecta esto mismo por email a operaciones cada
// 15 min; esto es la MISMA condición pero en pantalla, para que quien está
// delante lo vea y actúe ya (con Reabrir directo), no solo quien lee el
// correo. No hay "Enterado" (a diferencia de la alarma de reparto): la
// única forma de que desaparezca es que el cierre deje de ser anómalo
// (se reabre, o se le pone una hora) — no se puede posponer un olvido.
//
// POR LOCAL desde el 31/08/2026 — `locationId` es obligatorio.
// Esta alarma INTERRUMPE, y la regla 7 dice que lo que interrumpe SÍ filtra.
//
// 01/09: y filtra DEL TODO. La primera versión dejaba los olvidos de otros
// locales debajo, en un bloque gris y sin botón, como «información». Julio lo
// corrigió: esta pantalla la usa quien está cocinando, y lo del otro local no
// es información, es ruido que compite con lo suyo. Con un local seleccionado,
// Pedidos enseña SOLO ese local.
//
// En CONSOLIDADO no se pierde nada: `partirPorLocal(filas, null)` mete todo en
// `aqui`, así que la vista que se abre a propósito para verlo todo lo sigue
// viendo todo. La regla es: una pantalla de servicio enseña lo del local que
// la mira, y nada más.
//
// Reabrir va en DOS PASOS y con el local en la frase («Reabrir Meraki Pita en
// Foodint Carabanchel»): el 31/08 este botón, mudo respecto al local, era el
// camino para reabrir el local equivocado en pleno servicio.
//
// Poll cada 30 s (no es tan urgente como un reparto fallido en curso).
//
// fix/sondeo-adaptativo-resto (13/08, Encargo B-bis): anomalous_brand_closures
// era una de las tres RPC que se escaparon del encargo B — sondeaba a 30s
// fijos, ~4/min entre las dos tablets del pase. Es un vigía de anomalías, no
// un dato de servicio (availability-watchdog ya avisa por email cada 15 min):
// sin cambios ~5 min (10 ciclos a 30s) el intervalo sube hasta 2 min. Con el
// local sin actividad real 60 min, baja al suelo general de 5 min (B2).

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Unlock, Loader2, CheckCircle2, CalendarOff } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import {
  getAnomalousBrandClosuresByScope, setBrandStatus, setBrandStatusByToken,
  declararCierreDeliberado,
  type AnomalousBrandClosure,
} from '../services/kdsService'
import { filaId, textoReabrir } from '../lib/closureScope'

const POLL_MS = 30_000
const IDLE_MS = 120_000
const IDLE_AFTER = 10

interface Props {
  accountId?: string | null
  token?: string | null
  /**
   * Local seleccionado. OBLIGATORIO y sin default: hasta el 31/08/2026 esta
   * alarma miraba la cuenta entera, así que un olvido de Carabanchel hacía
   * sonar (y ofrecía reabrir) en Alcalá. null se escribe a mano y significa
   * que no hay local con el que contrastar (tablet: el token ya acota).
   */
  locationId: string | null
  variant?: 'fixed' | 'inline'
}

function fechaCorta(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?'
}

function horaCorta(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '?'
}

export default function ClosureAnomalyAlarm({ accountId, token, locationId, variant = 'fixed' }: Props) {
  const [aqui, setAqui] = useState<AnomalousBrandClosure[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  // Fila pendiente de confirmar la reapertura (null = ninguna).
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // Declaración de intención: id en curso, nota escrita, y lo que CONFIRMA el
  // servidor. `declaradoOk` guarda la respuesta real, no la intención.
  const [declararId, setDeclararId] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [declarando, setDeclarando] = useState(false)
  const [declaradoOk, setDeclaradoOk] = useState<{ id: string; at: string } | null>(null)
  const [declararError, setDeclararError] = useState<string | null>(null)
  const pollHandleRef = useRef<RetryLoopHandle | null>(null)

  // NOTA: ya no se traga el fallo (antes sí) — sigue sin romper la pantalla
  // (nada renderiza el rechazo), pero ahora runPollingLoop aplica el backoff
  // de fallo, que antes faltaba en este poll.
  const refresh = useCallback(async (): Promise<boolean> => {
    const scope = await getAnomalousBrandClosuresByScope(accountId ?? null, token, locationId)
    // scope.otrosLocales se descarta A PROPÓSITO: ver cabecera.
    setAqui(scope.aqui)
    return scope.aqui.length > 0
  }, [accountId, token, locationId])

  useEffect(() => {
    const handle = runPollingLoop({
      call: refresh,
      normalIntervalMs: POLL_MS,
      idleIntervalMs: IDLE_MS,
      idleAfter: IDLE_AFTER,
    })
    pollHandleRef.current = handle
    return () => { pollHandleRef.current = null; handle.cancel() }
  }, [refresh])

  /**
   * Reabre la fila `c` — siempre del bloque de ESTE local: las de otros
   * locales no llevan botón. El local va explícito (`c.location_id`), y con
   * token lo pone el dispositivo, que es el mismo que filtró la RPC.
   */
  async function reopen(c: AnomalousBrandClosure) {
    setBusyId(filaId(c)); setConfirmId(null)
    try {
      if (token) await setBrandStatusByToken(token, c.brand_id, 'normal')
      else await setBrandStatus(c.brand_id, 'normal', c.location_id)
      await refresh()
      pollHandleRef.current?.wake()
    } catch {
      /* el poll siguiente reconcilia */
    } finally {
      setBusyId(null)
    }
  }

  async function declarar(c: AnomalousBrandClosure) {
    setDeclarando(true); setDeclararError(null)
    try {
      // Se confirma con lo que devuelve el SERVIDOR, no con lo que se pidió.
      const r = await declararCierreDeliberado(c.closure_id, nota.trim() || null)
      setDeclaradoOk({ id: c.closure_id, at: r.deliberate_at! })
      setDeclararId(null); setNota('')
      void refresh()   // la fila desaparece de la alarma en cuanto se relee
    } catch (e) {
      setDeclararError(e instanceof Error ? e.message : 'No se pudo declarar.')
    } finally {
      setDeclarando(false)
    }
  }

  // ── «Este cierre es a propósito» ─────────────────────────────────────────
  // 01/09: un cierre indefinido A PROPÓSITO alarmaba igual, y esa alarma no se
  // podía quitar. Una alarma roja permanente es invisible, que es lo contrario
  // de una alarma — y por el camino salían 96 correos al día.
  //
  // Declarar NO es descartar: escribe quién lo declara y cuándo (y su motivo si
  // lo escribe), y la fila lo conserva. Por eso el botón dice «es a propósito»
  // y no «ocultar».
  //
  // Solo para los INDEFINIDOS: un cierre CON fecha que ya venció es un descuido
  // lo declare quien lo declare, y ahí el botón no aparece.
  if (aqui.length === 0) return null

  const wrapperCls = variant === 'inline'
    ? 'relative z-25 px-2 sm:px-3 pt-2 sm:pt-3'
    : 'fixed top-0 inset-x-0 z-[58] p-2 sm:p-3'

  return (
    <div className={wrapperCls}>
      {aqui.length > 0 && (
        <div className="mx-auto max-w-4xl rounded-xl bg-[#E0492E] text-white shadow-[0_10px_40px_rgba(224,73,46,0.5)] ring-2 ring-white/30 animate-pulse">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/20">
            <AlertTriangle size={22} className="shrink-0" />
            <span className="font-extrabold text-[15px] tracking-wide uppercase">
              {aqui.length === 1 ? 'Cierre de marca olvidado' : `${aqui.length} cierres de marca olvidados`}
            </span>
          </div>

          <ul className="max-h-[50vh] overflow-y-auto divide-y divide-white/15">
            {aqui.map((c) => (
              <li key={filaId(c)} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-extrabold uppercase tracking-wide bg-white/20 px-2 py-0.5 rounded">
                      {c.kind === 'indefinite' ? 'CERRADA HACE +24H' : 'DEBÍA REABRIR YA'}
                    </span>
                    <span className="font-bold text-[14px]">{c.brand_name}</span>
                    <span className="text-[12px] text-white/80">· {c.location_name}</span>
                  </div>
                  <div className="text-[12.5px] text-white/85 mt-0.5 truncate">
                    {c.kind === 'indefinite'
                      ? `Cerrada desde ${fechaCorta(c.set_at)}, sin fecha de reapertura`
                      : `Debía reabrir a las ${horaCorta(c.resume_at)}`}
                  </div>
                </div>

                {declararId === c.closure_id ? (
                  <div className="shrink-0 flex items-center gap-1.5">
                    <input
                      value={nota}
                      onChange={e => setNota(e.target.value)}
                      placeholder="Motivo (opcional)"
                      className="rounded-lg px-2 py-1.5 text-[13px] text-text-primary w-44"
                    />
                    <button
                      onClick={() => void declarar(c)}
                      disabled={declarando}
                      className="inline-flex items-center gap-1.5 bg-white text-[#E0492E] font-bold rounded-lg px-3 py-2 text-[13px] disabled:opacity-60"
                    >
                      {declarando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      {' '}Guardar
                    </button>
                    <button
                      onClick={() => { setDeclararId(null); setNota(''); setDeclararError(null) }}
                      className="rounded-lg px-3 py-2 text-[13px] font-bold bg-white/20 text-white"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : confirmId === filaId(c) ? (
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-white/90 hidden sm:inline">
                      ¿{textoReabrir(c.brand_name, c.location_name)}?
                    </span>
                    <button
                      onClick={() => void reopen(c)}
                      className="inline-flex items-center gap-1.5 bg-white text-[#E0492E] font-bold rounded-lg px-3 py-2 text-[13px]"
                    >
                      <Unlock size={14} /> Sí, reabrir
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="rounded-lg px-3 py-2 text-[13px] font-bold bg-white/20 text-white"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(filaId(c))}
                    disabled={busyId === filaId(c)}
                    title={textoReabrir(c.brand_name, c.location_name)}
                    className="shrink-0 inline-flex items-center gap-1.5 bg-white text-[#E0492E] font-bold rounded-lg px-3 py-2 text-[13px] disabled:opacity-60"
                  >
                    {busyId === filaId(c) ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
                    {' '}Reabrir en {c.location_name}
                  </button>
                )}

                {/* Solo para los INDEFINIDOS: un cierre con fecha que ya venció
                    es un descuido lo declare quien lo declare. */}
                {c.kind === 'indefinite' && declararId !== c.closure_id && confirmId !== filaId(c) && (
                  <button
                    onClick={() => { setDeclararId(c.closure_id); setNota(''); setDeclararError(null) }}
                    title={`Declarar que ${c.brand_name} está cerrada a propósito en ${c.location_name}`}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-bold bg-white/20 text-white hover:bg-white/30 transition-base"
                  >
                    <CalendarOff size={14} /> Es a propósito
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* REGLA 8: un botón que hace algo importante confirma o falla EN
              PANTALLA, y la confirmación lleva contenido. «Hecho» no dice nada;
              esto dice qué se declaró y a qué hora, con la hora que devolvió el
              SERVIDOR — no la del navegador. */}
          {declaradoOk && (
            <div className="flex items-center gap-2 px-4 py-2 bg-white/15 text-[12.5px] font-semibold border-t border-white/20">
              <CheckCircle2 size={14} className="shrink-0" />
              <span>
                Declarado a propósito a las {horaCorta(declaradoOk.at)}. Este cierre deja de avisar;
                queda escrito quién lo declaró y cuándo.
              </span>
            </div>
          )}
          {declararError && (
            <div className="flex items-center gap-2 px-4 py-2 bg-black/30 text-[12.5px] font-semibold border-t border-white/20">
              <AlertTriangle size={14} className="shrink-0" />
              <span>No se pudo declarar: {declararError} — sigue avisando, que es lo correcto.</span>
            </div>
          )}
        </div>
      )}

      {/* Otros locales: se ven (no se esconde nada), pero ni gritan ni se
          tocan. Quien reabre Carabanchel es Carabanchel. */}
    </div>
  )
}
