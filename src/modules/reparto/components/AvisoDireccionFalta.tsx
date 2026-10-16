// src/modules/reparto/components/AvisoDireccionFalta.tsx
//
// R03 · «Falta la dirección de este pedido» (Julio, 16/10). Para quien está
// cocinando, en la tablet y en el ordenador: ROJO y CON SONIDO hasta que
// alguien actúe. Una frase, el número del pedido en la plataforma para
// buscarlo en su portal, una casilla grande para pegar la dirección y
// «Mandar a Catcher».
//
// Sale de public.pedidos_sin_direccion: pedidos de reparto propio vivos sin
// dirección (ni de la plataforma ni pegada). Desaparece cuando se pega la
// dirección o el pedido acaba. No hay «Enterado»: un pedido sin dirección no
// se pospone, se arregla (como ClosureAnomalyAlarm).
//
// Se monta junto a KdsAlarmOverlay en las cuatro pantallas (tablet, cocina-tv,
// Pedidos y Cocina del ordenador). En la tablet va abajo y la de reparto
// arriba, para que no se tapen si coinciden.
//
// Lo que dice al pegar sale de lib/direccionFalta.ts (regla 8: con contenido).
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, MapPin, Send } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import { playAlarmSound } from '@/modules/kds/kdsUtils'
import {
  enlaceAlMapa, estadoDeSalida, mandadoACatcher, nombreDelPortal, numeroParaElPortal, siguientePaso,
  type PedidoSinDireccion,
} from '../lib/direccionFalta'
import { fijarDireccion, mandarACatcher, pedidosSinDireccion } from '../services/direccionFaltaService'

const POLL_MS = 10_000
const IDLE_MS = 60_000
const IDLE_AFTER = 30
const SOUND_MS = 4_000
const RESULTADO_MS = 30_000

export interface AvisoDireccionFaltaProps {
  /** Local (sesión). En la tablet va null: la base lo saca del token. */
  locationId: string | null
  token?: string | null
  /** 'fixed' (tablet y cocina-tv, flota abajo) | 'inline' (ordenador, bajo el menú). */
  variant?: 'fixed' | 'inline'
}

interface Resultado { texto: string; error: boolean; hasta: number; pedido: PedidoSinDireccion }

export default function AvisoDireccionFalta({ locationId, token = null, variant = 'fixed' }: AvisoDireccionFaltaProps) {
  const [pedidos, setPedidos] = useState<PedidoSinDireccion[]>([])
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const pollRef = useRef<RetryLoopHandle | null>(null)
  const activo = Boolean(token || locationId)
  // La cuenta atrás de «sale solo en m:ss» (R03 · 2).
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    if (pedidos.length === 0) return
    const id = window.setInterval(() => setAhora(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [pedidos.length])

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!activo) return false
    const lista = await pedidosSinDireccion(token ? null : locationId, token)
    setPedidos(lista)
    return lista.length > 0
  }, [activo, locationId, token])

  useEffect(() => {
    if (!activo) return
    const h = runPollingLoop({ call: refresh, normalIntervalMs: POLL_MS, idleIntervalMs: IDLE_MS, idleAfter: IDLE_AFTER })
    pollRef.current = h
    return () => { pollRef.current = null; h.cancel() }
  }, [activo, refresh])

  // Sonido en bucle mientras quede alguno sin dirección.
  useEffect(() => {
    if (pedidos.length === 0) return
    playAlarmSound()
    const id = window.setInterval(playAlarmSound, SOUND_MS)
    return () => window.clearInterval(id)
  }, [pedidos.length])

  // Los resultados se quedan un rato a la vista aunque el pedido ya no esté en la lista.
  useEffect(() => {
    if (Object.keys(resultados).length === 0) return
    const id = window.setInterval(() => {
      setResultados(prev => {
        const ahora = Date.now()
        const quedan = Object.fromEntries(Object.entries(prev).filter(([, r]) => r.hasta > ahora))
        return Object.keys(quedan).length === Object.keys(prev).length ? prev : quedan
      })
    }, 2_000)
    return () => window.clearInterval(id)
  }, [resultados])

  async function mandar(p: PedidoSinDireccion) {
    if (enviando) return
    const texto = (textos[p.sale_id] ?? '').trim()
    setEnviando(p.sale_id)
    const poner = (t: string, error: boolean) =>
      setResultados(prev => ({ ...prev, [p.sale_id]: { texto: t, error, hasta: Date.now() + RESULTADO_MS, pedido: p } }))
    try {
      const r = await fijarDireccion(p.sale_id, texto, token)
      const paso = siguientePaso(r)
      if (paso.tipo === 'mandar') {
        try {
          await mandarACatcher(p.sale_id)
          poner(mandadoACatcher(r.direccion), false)
        } catch (e) {
          poner(`Guardada: «${r.direccion}». ${e instanceof Error ? e.message : 'Catcher no lo ha cogido.'} Despáchalo a mano desde el pedido.`, true)
        }
      } else {
        poner(paso.texto, false)
      }
      setTextos(prev => { const n = { ...prev }; delete n[p.sale_id]; return n })
      pollRef.current?.wake()
    } catch (e) {
      // Lo que no se ha guardado se queda en la casilla para volver a intentarlo.
      poner(e instanceof Error ? e.message : 'No se ha podido guardar la dirección.', true)
    } finally {
      setEnviando(null)
    }
  }

  const resueltos = Object.values(resultados).filter(r => !pedidos.some(p => p.sale_id === r.pedido.sale_id))
  if (pedidos.length === 0 && resueltos.length === 0) return null

  const wrapper = variant === 'inline'
    ? 'relative z-30 px-2 sm:px-3 pt-2 sm:pt-3'
    : 'fixed bottom-0 inset-x-0 z-[61] p-2 sm:p-3'

  return (
    <div className={wrapper} data-testid="aviso-direccion-falta">
      <div className="mx-auto max-w-4xl max-h-[70vh] overflow-y-auto rounded-2xl bg-[#C62828] text-white shadow-[0_10px_40px_rgba(198,40,40,0.5)] ring-2 ring-white/30">
        {pedidos.map(p => {
          const numero = numeroParaElPortal(p)
          const mapa = enlaceAlMapa(p.lat, p.lng)
          const r = resultados[p.sale_id]
          const texto = textos[p.sale_id] ?? ''
          return (
            <section key={p.sale_id} className="px-4 py-4 sm:px-5 border-b border-white/20 last:border-b-0"
              data-testid="aviso-direccion-pedido" aria-label={`Falta la dirección del pedido ${p.code ?? ''}`}>
              <h2 className="flex items-center gap-2.5 text-[22px] sm:text-[24px] font-extrabold leading-tight">
                <AlertTriangle size={26} className="shrink-0" /> Falta la dirección de este pedido
              </h2>
              <p className="mt-2 text-[17px] leading-snug">
                <b>{p.code}</b>{p.brand ? ` · ${p.brand}` : ''} · {nombreDelPortal(p.channel)}
              </p>
              {numero && (
                <p className="mt-1 text-[17px] leading-snug">
                  Búscalo en el portal de {nombreDelPortal(p.channel)} con este número:{' '}
                  <span className="font-mono font-extrabold text-[22px] tracking-wide select-all bg-white/15 px-2 py-0.5 rounded"
                    data-testid="aviso-direccion-numero">{numero}</span>
                </p>
              )}
              <p className="mt-1 text-[17px] font-bold" data-testid="aviso-direccion-salida">{estadoDeSalida(p, ahora)}</p>
              {mapa && (
                <a href={mapa} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-[15px] font-bold text-white underline">
                  <MapPin size={16} /> Ver el punto del mapa
                </a>
              )}
              <label className="block mt-3">
                <span className="sr-only">Pega aquí la dirección</span>
                <textarea
                  value={texto}
                  onChange={e => setTextos(prev => ({ ...prev, [p.sale_id]: e.target.value }))}
                  rows={3}
                  placeholder="Pega aquí la dirección: calle, número, piso y portal"
                  className="w-full rounded-xl bg-white text-zinc-900 text-[19px] leading-snug px-4 py-3 placeholder:text-zinc-400 focus:outline-none focus:ring-4 focus:ring-white/60"
                  data-testid="aviso-direccion-casilla"
                />
              </label>
              <button
                type="button"
                onClick={() => void mandar(p)}
                disabled={enviando === p.sale_id || texto.trim().length === 0}
                className="mt-2 w-full sm:w-auto inline-flex items-center justify-center gap-2 h-14 px-6 rounded-xl bg-white text-[#C62828] text-[19px] font-extrabold disabled:opacity-60"
              >
                <Send size={20} /> {enviando === p.sale_id ? 'Mandando…' : 'Mandar a Catcher'}
              </button>
              <div role="status" aria-live="polite">
                {r && (
                  <p className={`mt-2 text-[16px] font-semibold rounded-lg px-3 py-2 ${r.error ? 'bg-black/25' : 'bg-white/20'}`}>{r.texto}</p>
                )}
              </div>
            </section>
          )
        })}
        {resueltos.map(r => (
          <section key={r.pedido.sale_id} className={`px-4 py-3 sm:px-5 border-b border-white/20 last:border-b-0 ${r.error ? 'bg-[#8E1B1B]' : 'bg-[#2E7D32]'}`}
            data-testid="aviso-direccion-resuelto">
            <p className="text-[17px] font-extrabold">{r.pedido.code} · {nombreDelPortal(r.pedido.channel)}</p>
            <p role="status" className="mt-1 text-[16px] font-semibold">{r.texto}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
