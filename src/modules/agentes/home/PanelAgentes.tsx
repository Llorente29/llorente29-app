// src/modules/agentes/home/PanelAgentes.tsx
//
// PANEL «MIS AGENTES», debajo del mosaico.
//
// ── EL INTERRUPTOR SOLO SALE SI EL AGENTE YA LEE LA PAUSA ──────────────────
// `cron.job` no tiene cuenta: hay tres cuentas compartiendo un planificador.
// Apagar el cron apagaría el agente para todas, así que la pausa vive en
// `agent_pause` y cada agente la consulta. Un agente que TODAVÍA no la consulta
// no enseña interruptor: dice «todavía no se puede pausar desde aquí», que es
// verdad y no es un botón muerto. Misma regla que el «Escanear» de la tablet.
//
// ── LA FILA DICE QUE ESTÁ APAGADO Y DESDE CUÁNDO ───────────────────────────
// No un interruptor gris y ya. Un agente parado sin autor es el estado del que
// nadie se hace responsable: es exactamente lo que hoy le pasa a
// `last-catalog-watchdog`, apagado sin rastro de quién ni cuándo.

import { useCallback, useMemo, useState } from 'react'
import { Bot, Check, AlertTriangle } from 'lucide-react'
import { useDatoDeTarjeta } from '@/shell/home/cards/useDatoDeTarjeta'
import { leeAgentes, pausaAgente, consecuenciaDeApagar, type EstadoAgente } from './agentesService'

const UMBRAL_MIN = 5

function haceCuanto(iso: string | null): string {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

const TEXTO_ESTADO: Record<string, string> = {
  ok: 'Trabajando', con_fallos: 'Con fallos', sin_datos: 'Sin datos', pausado: 'Apagado',
}

export default function PanelAgentes({ accountId }: { accountId: string | null }) {
  const [confirmando, setConfirmando] = useState<EstadoAgente | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(
    () => (accountId ? leeAgentes(accountId) : Promise.resolve([] as EstadoAgente[])),
    [accountId],
  )
  const { datos, cargando, error, sello, recargar } = useDatoDeTarjeta(cargar, [accountId], UMBRAL_MIN)
  const agentes = useMemo(() => datos ?? [], [datos])

  async function alterna(a: EstadoAgente, pausar: boolean) {
    if (!accountId) {
      setFallo('No se ha podido cambiar: no hay cuenta activa.')
      return
    }
    setGuardando(true); setFallo(null); setAviso(null)
    try {
      const r = await pausaAgente(accountId, a.agent_key, pausar)
      // Se dice QUÉ ha pasado, no «hecho». Y se recarga para pintar lo que hay
      // en la base, no lo que creíamos que iba a pasar.
      setAviso(r.pausado
        ? `${a.nombre} apagado para esta cuenta. Los demás clientes no se ven afectados.`
        : `${a.nombre} encendido otra vez. Volverá a trabajar en su próxima pasada.`)
      recargar()
    } catch (e) {
      setFallo(e instanceof Error ? `No se ha podido cambiar: ${e.message}` : 'No se ha podido cambiar.')
    } finally {
      setGuardando(false); setConfirmando(null)
    }
  }

  const sinComprobar = error != null && datos == null

  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Bot size={17} /> Mis agentes
      </h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '2px 0 10px' }}>
        Trabajan solos. Aquí se ve qué hizo cada uno, cuándo, y se apagan con un interruptor.
      </p>

      {aviso && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-success)', margin: '0 0 8px' }}>
          <Check size={13} style={{ display: 'inline', marginRight: 4 }} />{aviso}
        </p>
      )}
      {(fallo || error) && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', margin: '0 0 8px' }}>
          {fallo ?? (sinComprobar ? `No se ha podido comprobar: ${error}` : `No se ha podido actualizar: ${error}`)}
        </p>
      )}

      {sinComprobar ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          Sin dato: no se ha podido leer el estado de los agentes. No significa que estén parados;
          significa que no se sabe.
        </p>
      ) : (
        <div style={{
          border: '0.5px solid var(--color-border-default)', borderRadius: 'var(--radius-xl)',
          overflow: 'hidden', background: 'var(--color-bg-card)',
        }}>
          {cargando && agentes.length === 0 ? (
            <p style={{ padding: '0.9rem 1rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0 }}>
              Cargando…
            </p>
          ) : agentes.map((a, i) => (
            <div key={a.agent_key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '0.75rem 1rem',
              borderTop: i === 0 ? 'none' : '0.5px solid var(--color-border-default)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
                  {a.nombre}
                  <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: 6 }}>
                    · {a.cadencia}
                  </span>
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  {a.que_hace}
                </p>
                {/* Guardias agrega, y dice si alguno está apagado. Es el aviso
                    que hoy no existe: `last-catalog-watchdog` lleva parado sin
                    que ninguna pantalla lo diga. */}
                {a.jobs_apagados > 0 && (
                  <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                    <AlertTriangle size={12} style={{ display: 'inline', marginRight: 3 }} />
                    {a.jobs_apagados} de {a.jobs_totales} apagado{a.jobs_apagados === 1 ? '' : 's'} en el planificador
                  </p>
                )}
                {a.pausado && (
                  <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--color-terracota)' }}>
                    Apagado {a.paused_at ? haceCuanto(a.paused_at) : ''}
                    {a.paused_by ? ` por ${a.paused_by}` : ' (sin rastro de quién)'}
                  </p>
                )}
              </div>

              <div style={{ textAlign: 'right', minWidth: 108 }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  {haceCuanto(a.ultima_vez)}
                </p>
                <p style={{
                  margin: '2px 0 0', fontSize: '0.75rem', fontWeight: 600,
                  color: a.pausado ? 'var(--color-terracota)'
                    : a.estado === 'con_fallos' ? 'var(--color-danger)'
                    : a.estado === 'sin_datos' ? 'var(--color-text-secondary)'
                    : 'var(--color-success)',
                }}>
                  {TEXTO_ESTADO[a.estado] ?? a.estado}
                  {a.fallos_24h > 0 && ` · ${a.fallos_24h} fallo${a.fallos_24h === 1 ? '' : 's'}`}
                </p>
              </div>

              <div style={{ minWidth: 132, textAlign: 'right' }}>
                {a.se_puede_pausar ? (
                  <button type="button" disabled={guardando}
                    onClick={() => (a.pausado ? void alterna(a, false) : setConfirmando(a))}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold border border-border-default bg-card hover:bg-page disabled:opacity-50">
                    {a.pausado ? 'Encender' : 'Apagar'}
                  </button>
                ) : (
                  // Ni interruptor gris ni botón muerto: la verdad.
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)' }}>
                    todavía no se puede pausar desde aquí
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {sello && (
        <p style={{
          fontSize: '0.6875rem', margin: '6px 0 0',
          color: sello.caducado ? 'var(--color-terracota)' : 'var(--color-text-secondary)',
        }}>
          {sello.texto}
        </p>
      )}

      {/* La confirmación lleva LA CONSECUENCIA dentro, no un «¿seguro?». */}
      {confirmando && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setConfirmando(null)}>
          <div className="max-w-sm w-full rounded-xl bg-card p-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-text-primary">{consecuenciaDeApagar(confirmando)}</p>
            <p className="text-[12.5px] text-text-secondary mt-1.5">
              Se puede volver a encender desde aquí en cualquier momento.
            </p>
            <div className="flex gap-2 justify-end mt-3">
              <button type="button" onClick={() => setConfirmando(null)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold border border-border-default">
                Déjalo encendido
              </button>
              <button type="button" disabled={guardando}
                onClick={() => void alterna(confirmando, true)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-text-on-accent disabled:opacity-50">
                Apagar {confirmando.nombre}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
