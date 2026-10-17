// src/modules/reparto/components/CompletarDireccion.tsx
//
// R03 · «Completar dirección» (Julio, 16/10): un botón pequeño para la oficina
// o el encargado, en la tarjeta de cada pedido «Sin dirección completa», en la
// lista de Despacho y en el aviso rojo. No es obligatorio y no retrasa nada.
//
// Al guardar, la dirección queda en el pedido con la marca de quién la
// escribió (fijar_direccion_entrega), se reimprime el ticket de la bolsa con
// ella y queda UNA línea (Julio, 17/10): «Dirección completada por <nombre> ·
// ticket reimpreso», con «Reimprimir» y, si Catcher ya ha asignado
// repartidor, su nombre con «Llamar» para dictársela (la API de Catcher no
// deja cambiar un pedido creado). Sin bloque que repita la dirección.
// Lo que dice sale de lib/direccionFalta.ts (regla 8: con contenido).
import { useState } from 'react'
import { Check, Phone, Printer } from 'lucide-react'
import { reprintOrder } from '@/modules/orders/services/ordersFeedService'
import {
  enlaceTel, lineaDeCompletada, repartidor, siguientePaso, type Reimpresion,
} from '../lib/direccionFalta'
import { fijarDireccion, mandarACatcher } from '../services/direccionFaltaService'
import '@/modules/conta/estilo/tokens.css'
import '../reparto.css'

export interface CompletarDireccionProps {
  saleId: string
  /** Token del dispositivo (tablet) o null (sesión). */
  token?: string | null
  /** Si ya está completada (al volver a cargar): quién, para la misma línea. */
  completada?: { por: string | null } | null
  /** El repartidor que ya conoce el pedido, si lo hay. */
  riderName?: string | null
  riderPhone?: string | null
  /** Tras guardar: refrescar lo de alrededor. Recibe la línea que se ha dicho (y si fue un fallo). */
  onGuardada?: (resumen: string, fallo: boolean) => void
}

interface Hecho {
  por: string | null
  ticket: Reimpresion
  /** Algo más que decir (no ha salido, local a mano…). */
  nota?: string
  error?: boolean
  llamar?: { nombre: string; telefono: string } | null
}

async function reimprimir(saleId: string, token: string | null): Promise<Reimpresion> {
  try {
    return { trabajos: await reprintOrder(saleId, token, 'bag') }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'sin motivo' }
  }
}

export default function CompletarDireccion(
  { saleId, token = null, completada = null, riderName = null, riderPhone = null, onGuardada }: CompletarDireccionProps,
) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [reimprimiendo, setReimprimiendo] = useState(false)
  const [hecho, setHecho] = useState<Hecho | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    if (guardando) return
    setGuardando(true); setError(null)
    try {
      const r = await fijarDireccion(saleId, texto, token)
      const paso = siguientePaso(r)
      let nota: string | undefined
      let fallo = false
      if (paso.tipo === 'mandar') {
        try {
          await mandarACatcher(saleId)
          nota = 'Mandado a Catcher con ella.'
        } catch (e) {
          nota = `No ha salido a Catcher: ${e instanceof Error ? e.message : 'Catcher no lo ha cogido'}.`
          fallo = true
        }
      } else if (paso.texto) {
        nota = paso.texto
      }
      const ticket = await reimprimir(saleId, token)
      setHecho({ por: r.por ?? null, ticket, nota, error: fallo, llamar: paso.tipo === 'mensaje' ? paso.llamar ?? null : null })
      setAbierto(false); setTexto('')
      onGuardada?.([lineaDeCompletada(r.por ?? null, ticket), nota].filter(Boolean).join('. '), fallo)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar la dirección.')
    } finally {
      setGuardando(false)
    }
  }

  async function otraVez() {
    if (reimprimiendo) return
    setReimprimiendo(true)
    const ticket = await reimprimir(saleId, token)
    setHecho(prev => ({ ...(prev ?? { por: completada?.por ?? null }), ticket }))
    setReimprimiendo(false)
  }

  const mostrar: Hecho | null = hecho ?? (completada ? { por: completada.por, ticket: null } : null)
  const llamar = mostrar?.llamar ?? repartidor(riderName, riderPhone)

  return (
    <div className="cx-colores" data-testid="completar-direccion" onClick={e => e.stopPropagation()}>
      {!abierto && !mostrar && (
        <button type="button" className="cx-cd-boton" onClick={() => setAbierto(true)}>
          Completar dirección
        </button>
      )}
      {abierto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label>
            <span className="sr-only">Dirección completa</span>
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              placeholder="Calle, número, piso y portal"
              className="cx-cd-casilla"
              data-testid="completar-direccion-casilla"
              autoFocus
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="cx-cd-boton cx-cd-boton-pri"
              onClick={() => void guardar()} disabled={guardando || texto.trim().length === 0}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="cx-cd-boton"
              onClick={() => { setAbierto(false); setTexto('') }} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite">
        {error && <p className="cx-cd-error" data-testid="completar-direccion-error">{error}</p>}
        {mostrar && (
          <div className="cx-cd-hecho" data-testid="completar-direccion-resultado">
            <span className="cx-cd-hecho-texto">
              <Check size={14} strokeWidth={3} /> {lineaDeCompletada(mostrar.por, mostrar.ticket)}
            </span>
            <button type="button" className="cx-cd-boton" onClick={() => void otraVez()} disabled={reimprimiendo}
              data-testid="completar-direccion-reimprimir">
              <Printer size={13} /> {reimprimiendo ? 'Reimprimiendo…' : 'Reimprimir'}
            </button>
            {llamar && (
              <a href={enlaceTel(llamar.telefono)} className="cx-cd-boton cx-cd-boton-pri" data-testid="completar-direccion-llamar">
                <Phone size={13} /> {llamar.nombre} · Llamar
              </a>
            )}
            {mostrar.nota && (
              <span className={mostrar.error ? 'cx-cd-error' : 'cx-cd-nota'} data-testid="completar-direccion-nota">{mostrar.nota}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
