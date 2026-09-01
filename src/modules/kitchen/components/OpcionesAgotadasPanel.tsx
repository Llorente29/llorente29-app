// src/modules/kitchen/components/OpcionesAgotadasPanel.tsx
//
// EL 86 DE LAS OPCIONES DE MODIFICADOR, DESDE LA PANTALLA.
//
// El 01/09 Alcalá se quedó sin milanesa de ternera. Los nueve productos se
// marcaron y las dos opciones de modificador siguieron vendiéndose — que es la
// RUTA NORMAL del cliente. Entró comida que no existía mientras la pantalla
// decía que estaba resuelto.
//
// Esto existe porque un 86 que solo se puede hacer con SQL no es un 86: a las
// nueve de la noche, en pleno servicio, no hay nadie escribiendo consultas.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, RefreshCw, X, Search, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  searchModifierOptions, listSoldOutOptions, setModifierOptionAvailability,
  type ModifierOptionRow, type SoldOutOptionRow,
} from '../services/availabilityService'

interface Props {
  accountId: string
  /** null = todos los locales. Agotar exige uno: un 86 sin local es global. */
  locationId: string | null
  locationName: string
}

/** "2 filas" no se enseña por curiosidad: ver una sola tarjeta cuando el
 *  catálogo tiene cuatro hace pensar que se ha agotado la mitad. */
function sufijoFilas(n: number): string {
  return n > 1 ? ` · cubre ${n} filas del catálogo` : ''
}

export default function OpcionesAgotadasPanel({ accountId, locationId, locationName }: Props) {
  const [rows, setRows] = useState<SoldOutOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Confirmación CON CONTENIDO, no un visto (regla 8): dice qué se agotó, dónde
  // y si de verdad salió al canal.
  const [flash, setFlash] = useState<null | { ok: boolean; texto: string }>(null)
  const [showAgotar, setShowAgotar] = useState(false)

  // Sin `setLoading(true)` aquí: pondría estado de forma síncrona dentro del
  // efecto. El reinicio al cambiar de local lo hace React remontando el panel
  // (`key={locationId}` en la página), que además deja el estado limpio en vez
  // de arrastrar el del local anterior.
  const reload = useCallback(async () => {
    try {
      setRows(await listSoldOutOptions(locationId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando las opciones agotadas')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [locationId])

  // El linter marca esto como «setState síncrono en un efecto» y no lo es:
  // `reload` es async y su primera instrucción es el `await` de la consulta, así
  // que ningún setState ocurre en el tick del efecto. La regla no rastrea dentro
  // de la función. Se silencia con el motivo escrito, no a secas.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 9000)
    return () => clearTimeout(t)
  }, [flash])

  async function cambiar(optionId: string, disponible: boolean, etiqueta: string) {
    setBusy(optionId); setError(null)
    try {
      const r = await setModifierOptionAvailability(optionId, disponible, locationId)
      const donde = locationId ? locationName : 'todos los locales'
      const verbo = disponible ? 'Reactivada' : 'Agotada'
      if (r.dispatched) {
        setFlash({ ok: true, texto: `${verbo} «${r.label || etiqueta}» en ${donde} · enviado al canal` })
      } else {
        // NO se pinta en verde. La fila está escrita pero el canal no se ha
        // enterado: sigue vendiéndose. Es el fallo silencioso de siempre.
        setFlash({
          ok: false,
          texto: `${verbo} «${r.label || etiqueta}» en ${donde}, PERO NO ha salido al canal`
               + `${r.warning ? ` (${r.warning})` : ''}. Sigue vendiéndose en las plataformas: avisa antes de darlo por hecho.`,
        })
      }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cambiar la opción')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-base font-medium text-stone-800">
            Opciones agotadas en {locationName}
          </h2>
          <p className="text-[13px] text-stone-500 mt-0.5">
            Las que el cliente elige dentro de un producto. Se agotan por local, igual que los productos.
          </p>
        </div>
        <button
          onClick={() => setShowAgotar(true)}
          disabled={!locationId}
          title={locationId ? undefined : 'Elige un local: una opción se agota en un local, no en todos a la vez'}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover disabled:opacity-40"
        >
          <Plus size={18} /> Agotar opción
        </button>
      </div>

      {flash && (
        <div className={`mb-3 rounded-lg p-3 text-[13px] flex items-start gap-2 ${
          flash.ok
            ? 'border border-success/30 bg-success-bg text-success'
            : 'border border-danger/40 bg-danger-bg text-danger font-medium'
        }`}>
          {flash.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{flash.texto}</span>
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-bg p-3 text-[13px] text-danger">{error}</div>
      )}

      {loading ? (
        <div className="py-8 text-center text-stone-400"><Loader2 size={20} className="animate-spin inline" /></div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-stone-400 text-sm">
          No hay opciones agotadas en {locationName}.
        </div>
      ) : (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {rows.map((r) => (
            <div key={`${r.externalId}-${r.locationId ?? 'all'}`} className="bg-white border border-stone-200 rounded-lg px-3 py-2.5 flex flex-col">
              <p className="text-[13px] font-medium text-stone-800 leading-tight" title={r.name}>{r.name}</p>
              <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2" title={r.groupName}>{r.groupName}</p>
              {r.filas > 1 && (
                <p className="text-[11px] text-stone-400 mt-0.5"
                   title="El catálogo repite esta opción; agotarla las cubre todas de una vez.">
                  cubre {r.filas} filas del catálogo
                </p>
              )}
              {!locationId && r.locationName && (
                <p className="text-[11px] text-stone-400 truncate">{r.locationName}</p>
              )}
              <p className="text-[11px] mt-0.5 mb-2">
                {r.availableUntil
                  ? <span className="text-warning">hasta {new Date(r.availableUntil).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  : <span className="text-stone-400">indefinido</span>}
              </p>
              <button
                onClick={() => void cambiar(r.optionId, true, r.name)}
                disabled={busy === r.optionId}
                className="mt-auto w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-success text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40"
              >
                {busy === r.optionId ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Reactivar
              </button>
            </div>
          ))}
        </div>
      )}

      {showAgotar && (
        <AgotarOpcionModal
          accountId={accountId}
          locationName={locationName}
          busyId={busy}
          onAgotar={async (o) => { await cambiar(o.optionId, false, o.name); setShowAgotar(false) }}
          onClose={() => setShowAgotar(false)}
        />
      )}
    </section>
  )
}

function AgotarOpcionModal({ accountId, locationName, busyId, onAgotar, onClose }: {
  accountId: string
  locationName: string
  busyId: string | null
  onAgotar: (o: ModifierOptionRow) => Promise<void>
  onClose: () => void
}) {
  const [term, setTerm] = useState('')
  const [res, setRes] = useState<ModifierOptionRow[]>([])
  const [cargando, setCargando] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    const t = setTimeout(async () => {
      setCargando(true)
      try {
        const r = await searchModifierOptions(accountId, term)
        if (!cancel) { setRes(r); setErr(null) }
      } catch (e) {
        if (!cancel) { setErr(e instanceof Error ? e.message : 'Error buscando'); setRes([]) }
      } finally {
        if (!cancel) setCargando(false)
      }
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [accountId, term])

  const vacio = useMemo(() => !cargando && res.length === 0, [cargando, res])

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div>
            <h3 className="text-base font-medium text-stone-800">Agotar una opción</h3>
            <p className="text-[12px] text-stone-500">en {locationName}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={18} /></button>
        </div>

        <div className="p-4 pb-2">
          <div className="relative">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar opción (milanesa, salsa…)"
              className="w-full pl-8 pr-3 py-2 border border-stone-300 rounded-lg text-sm"
            />
          </div>
          {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {cargando ? (
            <div className="py-8 text-center text-stone-400"><Loader2 size={18} className="animate-spin inline" /></div>
          ) : vacio ? (
            <p className="py-8 text-center text-stone-400 text-sm">
              {term ? 'Ninguna opción con ese nombre.' : 'Escribe para buscar.'}
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {res.map((o) => (
                <li key={o.externalId} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-stone-800 truncate" title={o.name}>{o.name}</p>
                    <p className="text-[11px] text-stone-500 truncate" title={o.groupName}>
                      {o.groupName}{sufijoFilas(o.filas)}
                    </p>
                  </div>
                  <button
                    onClick={() => void onAgotar(o)}
                    disabled={busyId === o.optionId}
                    className="shrink-0 px-3 py-1.5 rounded-md bg-danger text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40"
                  >
                    {busyId === o.optionId ? <Loader2 size={13} className="animate-spin" /> : 'Agotar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
