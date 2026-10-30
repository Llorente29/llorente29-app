// src/modules/conta/libro/PagoDeModelo.tsx
//
// S01d · Un apunte de la 4751 que no es una retención que nace sino el pago,
// la compensación o la devolución de un modelo: se dice su modelo y su
// periodo («111 · 3T 2026») y con eso valida (respuesta 1 de Julio, 30/10).
// Lo que se pulsa dice lo que ha pasado y lo que queda por pagar (regla 8).

import { useState } from 'react'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { opcionesDePeriodo, queQuedaPorPagar } from '@/modules/conta/lib/pagoDeModelo'
import { marcarPagoDeModelo } from '@/modules/conta/services/diarioService'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PagoDeModelo({ entryId, posicion, cuenta, importe, sale, fecha, alHacer, alCerrar }: {
  entryId: string; posicion: number; cuenta: string
  /** Lo que mueve el apunte; sale = al Debe (paga), si no, devuelve. */
  importe: number; sale: boolean; fecha: string
  alHacer: (frase: string) => void; alCerrar: () => void
}) {
  const anio = Number(fecha.slice(0, 4))
  const [modelo, setModelo] = useState<'111' | '115' | '123'>('111')
  const [ejercicio, setEjercicio] = useState(String(anio))
  const [periodo, setPeriodo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const guardar = async () => {
    setOcupado(true); setFallo(null)
    try {
      const r = await marcarPagoDeModelo(entryId, posicion, modelo, `${ejercicio}-${periodo}`)
      alHacer(`${r.mensaje} ${queQuedaPorPagar(r.pagado, sale ? importe : -importe)}`.trim())
    } catch (e) { setFallo(`No se ha guardado: ${msg(e)}`) } finally { setOcupado(false) }
  }
  return (
    <div className="cxd-pago-modelo" role="group" aria-label={`El apunte ${posicion} (${cuenta}) es el pago de un modelo`}>
      <p className="cx-ayuda" style={{ marginTop: 0 }}>
        {sale ? `Este apunte paga o compensa ${eurosExactos(importe)} de un modelo.` : `Este apunte es una devolución de ${eurosExactos(importe)} de un modelo.`} Di cuál y de qué periodo: no lleva tipo ni base.
      </p>
      <div className="cxd-pago-modelo-campos">
        <label>Modelo
          <select className="cx-input" value={modelo} onChange={(e) => setModelo(e.target.value as '111' | '115' | '123')}>
            <option value="111">111 · retenciones del trabajo y profesionales</option>
            <option value="115">115 · retenciones de alquileres</option>
            <option value="123">123 · retenciones del capital</option>
          </select>
        </label>
        <label>Año
          <select className="cx-input" value={ejercicio} onChange={(e) => setEjercicio(e.target.value)}>
            {[anio - 2, anio - 1, anio].map((a) => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </label>
        <label>Periodo
          <select className="cx-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="">Elige…</option>
            {opcionesDePeriodo().map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
          </select>
        </label>
      </div>
      {fallo && <p className="cx-error" role="alert">{fallo}</p>}
      <div className="cxd-pago-modelo-botones">
        <button type="button" className="cx-boton-sec" onClick={alCerrar} disabled={ocupado}>Cancelar</button>
        <button type="button" className="cx-boton" onClick={guardar} disabled={ocupado || !periodo}>{ocupado ? 'Guardando…' : 'Guardar el modelo y el periodo'}</button>
      </div>
    </div>
  )
}
