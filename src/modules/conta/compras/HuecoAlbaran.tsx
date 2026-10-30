// src/modules/conta/compras/HuecoAlbaran.tsx
//
// S01c · Un albarán que no cuadra: sus líneas leídas no suman su base. El
// aviso en ámbar con la cifra y las dos salidas (encargo §4 y respuesta de
// Julio al paso 0):
//   · «Añadir la línea que falta»: artículo, cantidad e importe, con el papel
//     delante. Entra al almacén como al recibir (compras_recepcion_linea_anadir).
//   · «Decir por qué falta»: queda marcado para la oficina con su motivo
//     (compras_hueco_recepcion).
// Cada botón dice lo que ha hecho, con su cifra (regla 8).

import { useState } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { anadirLineaRecepcion, apuntarHueco, buscarArticulos } from '@/modules/conta/services/comprasService'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const numero = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }

export function HuecoAlbaran({ recepcion, falta, alHacer }: { recepcion: string; falta: number; alHacer: (frase: string, queda: number) => void }) {
  const { accountId } = useCuentaConta()
  const [modo, setModo] = useState<'nada' | 'linea' | 'motivo'>('nada')
  const [q, setQ] = useState('')
  const [opciones, setOpciones] = useState<{ id: string; nombre: string }[]>([])
  const [articulo, setArticulo] = useState<{ id: string; nombre: string } | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [importe, setImporte] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const nCant = numero(cantidad)
  const nImp = numero(importe)
  const lineaVale = !!articulo && nCant > 0 && nImp > 0

  return (
    <div className="cx-aviso cxc-hueco" role="note" data-prueba="hueco">
      <p style={{ margin: 0 }}><strong>Faltan {eurosExactos(falta)} de líneas sin leer:</strong> añádelas o di por qué.</p>
      {modo === 'nada' && (
        <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="cx-boton-sec" onClick={() => setModo('linea')}>Añadir la línea que falta</button>
          <button type="button" className="cx-boton-sec" onClick={() => setModo('motivo')}>Decir por qué falta</button>
        </div>
      )}
      {modo === 'linea' && (
        <form className="cxc-hueco-form" onSubmit={async (e) => {
          e.preventDefault()
          if (!lineaVale || !articulo) return
          setOcupado(true); setFallo(null)
          try { const r = await anadirLineaRecepcion(recepcion, articulo.id, nCant, nImp, null); alHacer(r.mensaje, r.queda); setModo('nada'); setArticulo(null); setCantidad(''); setImporte('') }
          catch (x) { setFallo(`No se ha añadido: ${msg(x)}`) } finally { setOcupado(false) }
        }}>
          <label className="cx-campo">
            <span>Artículo</span>
            <input className="cx-input" value={articulo ? articulo.nombre : q} placeholder="Escribe parte del nombre"
              onChange={async (e) => {
                setArticulo(null); setQ(e.target.value)
                try { setOpciones(accountId ? await buscarArticulos(accountId, e.target.value) : []) } catch (x) { setFallo(msg(x)) }
              }} />
          </label>
          {!articulo && opciones.length > 0 && (
            <ul className="cxc-hueco-opciones" role="listbox" aria-label="Artículos">
              {opciones.map((o) => <li key={o.id}><button type="button" role="option" aria-selected={false} onClick={() => { setArticulo(o); setOpciones([]) }}>{o.nombre}</button></li>)}
            </ul>
          )}
          <label className="cx-campo"><span>Cantidad (en la unidad del artículo)</span><input className="cx-input cx-cifra" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></label>
          <label className="cx-campo"><span>Importe de la línea, sin IVA (€)</span><input className="cx-input cx-cifra" inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} /></label>
          <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="cx-boton" disabled={!lineaVale || ocupado}>{ocupado ? 'Añadiendo…' : 'Añadir y meter al almacén'}</button>
            <button type="button" className="cx-boton-sec" onClick={() => setModo('nada')}>Cancelar</button>
          </div>
        </form>
      )}
      {modo === 'motivo' && (
        <form className="cxc-hueco-form" onSubmit={async (e) => {
          e.preventDefault()
          if (!motivo.trim()) return
          setOcupado(true); setFallo(null)
          try { alHacer(await apuntarHueco(recepcion, motivo.trim()), 0); setModo('nada'); setMotivo('') }
          catch (x) { setFallo(`No se ha apuntado: ${msg(x)}`) } finally { setOcupado(false) }
        }}>
          <label className="cx-campo"><span>Por qué faltan</span><input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: una caja vino sin precio" /></label>
          <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="cx-boton" disabled={!motivo.trim() || ocupado}>{ocupado ? 'Apuntando…' : 'Apuntar y marcar para la oficina'}</button>
            <button type="button" className="cx-boton-sec" onClick={() => setModo('nada')}>Cancelar</button>
          </div>
        </form>
      )}
      {fallo && <p className="cx-error" role="alert">{fallo}</p>}
    </div>
  )
}
