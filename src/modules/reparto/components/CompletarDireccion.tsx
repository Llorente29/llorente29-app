// src/modules/reparto/components/CompletarDireccion.tsx
//
// R03 · «Completar dirección» (Julio, 16/10): un botón pequeño para la oficina
// o el encargado, en la tarjeta de cada pedido «Sin dirección completa» y en
// la lista de Despacho. No es obligatorio y no retrasa nada: el pedido ya
// salió a Catcher con el punto del mapa.
//
// Al guardar, la dirección queda en el pedido con la marca de quién la
// escribió (fijar_direccion_entrega) y el ticket se puede reimprimir con ella.
// Si Catcher ya lo tiene —casi siempre— su API no deja cambiarlo: si hay
// repartidor, su nombre y «Llamar» para dictársela. Lo que dice sale de
// lib/direccionFalta.ts (regla 8: con contenido).
import { useState } from 'react'
import { Phone } from 'lucide-react'
import { mandadoACatcher, siguientePaso, type SiguientePaso } from '../lib/direccionFalta'
import { fijarDireccion, mandarACatcher } from '../services/direccionFaltaService'
import '@/modules/conta/estilo/tokens.css'
import '../reparto.css'

export interface CompletarDireccionProps {
  saleId: string
  /** Token del dispositivo (tablet) o null (sesión). */
  token?: string | null
  /** Tras guardar: refrescar lo de alrededor. */
  onGuardada?: () => void
}

type Hecho = Extract<SiguientePaso, { tipo: 'mensaje' }> & { error?: boolean }

export default function CompletarDireccion({ saleId, token = null, onGuardada }: CompletarDireccionProps) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<Hecho | null>(null)

  async function guardar() {
    if (guardando) return
    setGuardando(true); setHecho(null)
    try {
      const r = await fijarDireccion(saleId, texto, token)
      const paso = siguientePaso(r)
      if (paso.tipo === 'mandar') {
        try {
          await mandarACatcher(saleId)
          setHecho({ tipo: 'mensaje', texto: mandadoACatcher(r.direccion) })
        } catch (e) {
          setHecho({ tipo: 'mensaje', texto: `Guardada: «${r.direccion}». ${e instanceof Error ? e.message : 'Catcher no lo ha cogido.'} Despáchalo a mano desde el pedido.`, error: true })
        }
      } else {
        setHecho(paso)
      }
      setAbierto(false); setTexto('')
      onGuardada?.()
    } catch (e) {
      setHecho({ tipo: 'mensaje', texto: e instanceof Error ? e.message : 'No se ha podido guardar la dirección.', error: true })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="cx-colores" data-testid="completar-direccion" onClick={e => e.stopPropagation()}>
      {!abierto && !hecho && (
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
        {hecho && (
          <div className={hecho.error ? 'cx-et-error' : 'cx-et-resultado'} style={{ marginTop: 6 }} data-testid="completar-direccion-resultado">
            {hecho.texto}
            {hecho.llamar && (
              <a href={`tel:${hecho.llamar.telefono.replace(/\s+/g, '')}`} className="cx-cd-boton cx-cd-boton-pri"
                style={{ marginLeft: 8 }} data-testid="completar-direccion-llamar">
                <Phone size={13} /> Llamar a {hecho.llamar.nombre}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
