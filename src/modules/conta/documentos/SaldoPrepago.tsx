// src/modules/conta/documentos/SaldoPrepago.tsx
//
// E05 · El saldo prepago de Catcher (la 40700001 «Saldo prepago Catcher»): lo
// que hay en la contabilidad, en palabras («Has recargado X € · se han pagado
// Y € · te quedan Z €», y aparte lo que de esos pagos aún no está validado) y
// la casilla para escribir el saldo que enseña el portal. Al comprobar, dice
// si coincide y cuánto no (regla 8: confirma con contenido o falla en pantalla).
// Lo enseñan la quincena (LoteCatcherPage) y la ficha de Catcher.

import { useState } from 'react'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos, diaMes } from '@/modules/conta/lib/formato'
import { importe } from '@/modules/conta/lib/catcherQuincena'
import { comprobarSaldoPortal, saldoPrepago, SALDO_PREPAGO } from '@/modules/conta/services/catcherService'

export function SaldoPrepago({ companyId, quien }: { companyId: string; quien: string | null }) {
  const [vuelta, setVuelta] = useState(0)
  const saldo = useLeer(() => saldoPrepago(companyId), `${companyId}:${vuelta}`)
  const [escrito, setEscrito] = useState('')
  const [comprobando, setComprobando] = useState(false)
  const [hecho, setHecho] = useState<{ coincide: boolean; texto: string } | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const s = saldo.datos

  async function comprobar() {
    // La misma lectura que los importes del Excel: «1.062,25», «1062.25» o «1062,25».
    const n = /^-?[\d.,\s€]+$/.test(escrito.trim()) ? importe(escrito) : null
    setHecho(null); setFallo(null)
    if (n == null) { setFallo('Escribe el saldo como lo ves en el portal, por ejemplo 312,40.'); return }
    setComprobando(true)
    try {
      setHecho(await comprobarSaldoPortal(companyId, n, quien))
      setVuelta((v) => v + 1)
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setComprobando(false) }
  }

  return (
    <section className="cx-tarjeta cxk-saldo" aria-labelledby="cxk-saldo-titulo">
      <h3 id="cxk-saldo-titulo">{s?.nombre ?? SALDO_PREPAGO.nombre} · {SALDO_PREPAGO.cuenta}</h3>
      {saldo.error && <div className="cx-error" role="alert">{saldo.error}</div>}
      {s && !s.existe && <p className="cxr-apoyo">{s.texto}</p>}
      {s && s.existe && (
        <>
          {/* Retoque 2 (Julio, 15/10): en palabras, y lo sin validar aparte. */}
          <p className="cxk-saldo-frase" data-prueba="saldo-frase">
            Has recargado <strong>{eurosExactos(s.recargas ?? 0)}</strong> · se han pagado <strong>{eurosExactos(s.pagos ?? 0)}</strong> · te quedan <strong>{eurosExactos(s.saldo ?? 0)}</strong>
          </p>
          {Math.round((s.pagosSinValidar ?? 0) * 100) !== 0 && (
            <p className="cxr-apoyo" data-prueba="saldo-sin-validar">De esos pagos, {eurosExactos(s.pagosSinValidar ?? 0)} aún sin validar.</p>
          )}
          {s.ultimaComprobacion && (
            <p className="cxr-apoyo">
              La última vez ({diaMes(s.ultimaComprobacion.cuando.slice(0, 10))}{s.ultimaComprobacion.quien ? `, ${s.ultimaComprobacion.quien}` : ''}), el portal decía {eurosExactos(Number(s.ultimaComprobacion.portal))}: {s.ultimaComprobacion.coincide ? 'coincidía' : 'no coincidía'}.
            </p>
          )}
          <form className="cxk-saldo-form" onSubmit={(e) => { e.preventDefault(); void comprobar() }}>
            <label className="cxk-campo">
              <span>Saldo que ves en el portal de Catcher</span>
              <input className="cx-input" inputMode="decimal" value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder="0,00" data-prueba="saldo-portal" />
            </label>
            <button type="submit" className="cx-boton-sec" disabled={comprobando || !escrito.trim()}>{comprobando ? 'Comprobando…' : 'Comprobar'}</button>
          </form>
        </>
      )}
      <div role="status" aria-live="polite">
        {hecho && <div className={`cx-tarjeta cxr-hecho${hecho.coincide ? '' : ' cxk-no-coincide'}`}><strong>{hecho.texto}</strong></div>}
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </section>
  )
}
