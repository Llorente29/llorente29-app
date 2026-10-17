// src/modules/reparto/components/AvisoDireccionFalta.tsx
//
// R03 · El aviso ROJO Y CON SONIDO de reparto propio, solo para lo que de
// verdad necesita a alguien (Julio, 16/10, tras ver las capturas):
//   · un pedido sin dirección completa que NO ha podido salir a Catcher, con
//     el motivo (los que salen —la mayoría— no avisan: la tarjeta lo dice);
//   · un Uber con señales mezcladas (calle, punto, cargo): «Decide quién
//     reparte este pedido», y no sale a Catcher hasta que alguien decida.
// Sin casilla para pegar la dirección ni espera: en la cocina nadie va a
// buscarla al portal, y esperar es lo que provoca las cancelaciones. Completar
// la dirección es de la oficina o el encargado, en la tarjeta o en Despacho.
//
// Sale de public.pedidos_sin_direccion (no_ha_salido, decidir). Se monta
// junto a KdsAlarmOverlay en las cuatro pantallas (tablet, cocina-tv, Pedidos
// y Cocina del ordenador). Va EN SU SITIO, encima de los pedidos, nunca
// flotando: flotando abajo tapaba el «Listo» de las tarjetas (Julio, 17/10).
// El aviso dice qué hacer: llamar al cliente (su teléfono, con «Llamar») y
// completar la dirección; nada de despachar a mano.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Phone } from 'lucide-react'
import { runPollingLoop, type RetryLoopHandle } from '@/lib/retryBackoff'
import { playAlarmSound } from '@/modules/kds/kdsUtils'
import {
  DECIDIDO_UBER, enlaceTel, motivoDelFallo, nombreDelPortal, siguientePaso, telefonoDelCliente, type PedidoSinDireccion,
} from '../lib/direccionFalta'
import { decidirQuienReparte, mandarACatcher, pedidosSinDireccion } from '../services/direccionFaltaService'
import CompletarDireccion from './CompletarDireccion'

const POLL_MS = 10_000
const IDLE_MS = 60_000
const IDLE_AFTER = 30
const SOUND_MS = 4_000
const RESULTADO_MS = 30_000

export interface AvisoDireccionFaltaProps {
  /** Local (sesión). En la tablet va null: la base lo saca del token. */
  locationId: string | null
  token?: string | null
}

interface Resultado { texto: string; error: boolean; hasta: number; pedido: PedidoSinDireccion }

export default function AvisoDireccionFalta({ locationId, token = null }: AvisoDireccionFaltaProps) {
  const [pedidos, setPedidos] = useState<PedidoSinDireccion[]>([])
  const [enviando, setEnviando] = useState<string | null>(null)
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const pollRef = useRef<RetryLoopHandle | null>(null)
  const activo = Boolean(token || locationId)

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!activo) return false
    const lista = (await pedidosSinDireccion(token ? null : locationId, token)).filter(p => p.no_ha_salido || p.decidir)
    setPedidos(lista)
    return lista.length > 0
  }, [activo, locationId, token])

  useEffect(() => {
    if (!activo) return
    const h = runPollingLoop({ call: refresh, normalIntervalMs: POLL_MS, idleIntervalMs: IDLE_MS, idleAfter: IDLE_AFTER })
    pollRef.current = h
    return () => { pollRef.current = null; h.cancel() }
  }, [activo, refresh])

  // Sonido en bucle mientras quede alguno.
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

  // Lo hecho se queda un rato a la vista aunque el pedido ya no esté en la lista (regla 8).
  const anotar = (p: PedidoSinDireccion, t: string, error: boolean) =>
    setResultados(prev => ({ ...prev, [p.sale_id]: { texto: t, error, hasta: Date.now() + RESULTADO_MS, pedido: p } }))

  async function decidir(p: PedidoSinDireccion, quien: 'nosotros' | 'uber') {
    if (enviando) return
    setEnviando(p.sale_id)
    const poner = (t: string, error: boolean) => anotar(p, t, error)
    try {
      const r = await decidirQuienReparte(p.sale_id, quien, token)
      if (quien === 'uber') {
        poner(DECIDIDO_UBER, false)
      } else {
        if (siguientePaso({ ...r, ya_en_catcher: false }).tipo === 'mandar') {
          try {
            await mandarACatcher(p.sale_id)
            poner('Hecho: lo repartimos nosotros. Mandado a Catcher.', false)
          } catch (e) {
            poner(`Lo repartimos nosotros, pero no ha salido a Catcher: ${e instanceof Error ? e.message : 'Catcher no lo ha cogido'}.`, true)
          }
        } else if (r.dispatch_mode && r.dispatch_mode !== 'auto') {
          poner('Hecho: lo repartimos nosotros.', false)
        } else {
          poner(`Hecho: lo repartimos nosotros, pero no sale: ${r.reason ?? 'sin motivo'}.`, true)
        }
      }
      pollRef.current?.wake()
    } catch (e) {
      poner(e instanceof Error ? e.message : 'No se ha podido guardar.', true)
    } finally {
      setEnviando(null)
    }
  }

  const resueltos = Object.values(resultados).filter(r => !pedidos.some(p => p.sale_id === r.pedido.sale_id))
  if (pedidos.length === 0 && resueltos.length === 0) return null

  return (
    <div className="relative z-30 shrink-0 px-2 sm:px-3 pt-2 sm:pt-3" data-testid="aviso-direccion-falta">
      <div className="mx-auto max-w-4xl max-h-[45vh] overflow-y-auto rounded-2xl bg-[#C62828] text-white shadow-[0_10px_40px_rgba(198,40,40,0.5)] ring-2 ring-white/30">
        {pedidos.map(p => {
          const r = resultados[p.sale_id]
          const quien = <p className="mt-2 text-[17px] leading-snug"><b>{p.code}</b>{p.brand ? ` · ${p.brand}` : ''} · {nombreDelPortal(p.channel)}</p>
          if (p.decidir) return (
            <section key={p.sale_id} className="px-4 py-4 sm:px-5 border-b border-white/20 last:border-b-0"
              data-testid="aviso-decidir-pedido" aria-label={`Decide quién reparte el pedido ${p.code ?? ''}`}>
              <h2 className="flex items-center gap-2.5 text-[22px] sm:text-[24px] font-extrabold leading-tight">
                <AlertTriangle size={26} className="shrink-0" /> Decide quién reparte este pedido
              </h2>
              {quien}
              <p className="mt-1 text-[16px] leading-snug">
                {nombreDelPortal(p.channel)} ha mandado solo parte de la entrega (la calle, el punto o el cargo de envío): no se sabe si lo reparte {nombreDelPortal(p.channel)} o nosotros. No sale a Catcher hasta que lo decidas.
              </p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={() => void decidir(p, 'nosotros')} disabled={enviando === p.sale_id}
                  className="h-14 px-6 rounded-xl bg-white text-[#C62828] text-[19px] font-extrabold disabled:opacity-60">
                  Lo repartimos nosotros
                </button>
                <button type="button" onClick={() => void decidir(p, 'uber')} disabled={enviando === p.sale_id}
                  className="h-14 px-6 rounded-xl bg-white/20 text-white text-[19px] font-extrabold disabled:opacity-60">
                  Lo reparte {nombreDelPortal(p.channel)}
                </button>
              </div>
              <div role="status" aria-live="polite">
                {r && <p className={`mt-2 text-[16px] font-semibold rounded-lg px-3 py-2 ${r.error ? 'bg-black/25' : 'bg-white/20'}`}>{r.texto}</p>}
              </div>
            </section>
          )
          return (
            <section key={p.sale_id} className="px-4 py-4 sm:px-5 border-b border-white/20 last:border-b-0"
              data-testid="aviso-no-ha-salido" aria-label={`El pedido ${p.code ?? ''} no ha salido a Catcher`}>
              <h2 className="flex items-center gap-2.5 text-[22px] sm:text-[24px] font-extrabold leading-tight">
                <AlertTriangle size={26} className="shrink-0" /> Este pedido no ha salido a Catcher
              </h2>
              {quien}
              <p className="mt-1 text-[17px] font-bold" data-testid="aviso-motivo">{motivoDelFallo(p.dispatch_error)}</p>
              <p className="mt-1 text-[16px] leading-snug">Llama al cliente y completa la dirección.</p>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                {p.customer_phone && (
                  <a href={enlaceTel(p.customer_phone)} data-testid="aviso-llamar-cliente"
                    className="h-12 px-5 rounded-xl bg-white text-[#C62828] text-[18px] font-extrabold inline-flex items-center gap-2 no-underline">
                    <Phone size={18} /> {telefonoDelCliente(p.customer_phone, p.customer_phone_code)} · Llamar
                  </a>
                )}
                <div className="rounded-xl bg-white p-2">
                  <CompletarDireccion saleId={p.sale_id} token={token} riderName={p.rider_name} riderPhone={p.rider_phone}
                    onGuardada={(resumen, fallo) => { anotar(p, resumen, fallo); pollRef.current?.wake() }} />
                </div>
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
