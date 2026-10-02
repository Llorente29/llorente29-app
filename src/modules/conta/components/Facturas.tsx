// src/modules/conta/components/Facturas.tsx
//
// Las facturas del proveedor y lo que se hace con ellas en la ficha:
// «Marcar como pagada», «Deshacer» y cambiar el vencimiento (§4.4). Cada
// acción va por su RPC, que escribe la factura y su rastro a la vez.
//
// Confirma con contenido o falla en pantalla (regla 8): «Marcada como
// pagada el 02/10. Ya no le debes esos 1.283,15 €.», no un visto.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Dialogo, Guardado } from '@/modules/conta/components/ui'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { cambiarVencimiento, deshacerPago, marcarPagada, type FacturaDeProveedor } from '@/modules/conta/services/proveedorService'
import { diaMesCorto, eurosExactos, fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '@/modules/conta/types'
import { estadoFactura } from '@/modules/conta/lib/textosFicha'

export function ListaFacturas({ facturas, vacio = 'Aún no hay facturas suyas.' }: { facturas: FacturaDeProveedor[]; vacio?: string }) {
  const [abierta, setAbierta] = useState<FacturaDeProveedor | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  if (facturas.length === 0) return <p className="cf-nota" style={{ margin: 0 }}>{vacio}</p>
  return (
    <>
      <div role="list">
        {facturas.map((f) => {
          const e = estadoFactura(f.status)
          const accionable = f.status === 'aprobada' || f.status === 'pagada'
          const contenido = (
            <>
              <span className="cf-factura-fecha">{f.invoiceDate ? diaMesCorto(f.invoiceDate) : '—'}</span>
              <span>{f.invoiceNumber ?? f.code ?? 'Sin número'}</span>
              <span className="cf-factura-importe">{f.grandTotal !== null ? eurosExactos(f.grandTotal) : '—'}</span>
              <span className={`cf-estado ${e.clase}`}>{e.texto}</span>
            </>
          )
          return accionable ? (
            <button
              key={f.id} type="button" role="listitem" className="cf-factura"
              style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--cf-linea)', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', minHeight: 44 }}
              onClick={() => setAbierta(f)}
              aria-label={`Factura ${f.invoiceNumber ?? ''}, ${e.texto}. Abrir para pagar o cambiar el vencimiento`}
            >
              {contenido}
            </button>
          ) : (
            <div key={f.id} role="listitem" className="cf-factura">{contenido}</div>
          )
        })}
      </div>
      <Guardado texto={aviso} />
      {abierta && <DialogoPago factura={abierta} alCerrar={() => setAbierta(null)} alHecho={(t) => { setAbierta(null); avisar(t) }} />}
    </>
  )
}

function DialogoPago({ factura: f, alCerrar, alHecho }: { factura: FacturaDeProveedor; alCerrar: () => void; alHecho: (texto: string) => void }) {
  const { datos, recargar } = useFicha()
  const [fecha, setFecha] = useState(hoyEnMadrid())
  const [forma, setForma] = useState<PaymentMethod | ''>(datos.ficha.paymentMethod ?? '')
  const [venc, setVenc] = useState(f.dueDate ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importe = f.grandTotal !== null ? eurosExactos(f.grandTotal) : 'su importe'
  const num = f.invoiceNumber ?? f.code ?? 'sin número'

  async function hacer(accion: () => Promise<void>, texto: string) {
    setOcupado(true); setError(null)
    try {
      await accion()
      await recargar()
      alHecho(texto)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo hacer.')
      setOcupado(false)
    }
  }

  return (
    <Dialogo titulo={`Factura ${num}`} alCerrar={alCerrar}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--cf-gris)' }}>
        {f.invoiceDate ? `Del ${fechaLarga(f.invoiceDate)} · ` : ''}{importe}
        {f.status === 'aprobada' && (f.dueDate ? ` · vence el ${fechaLarga(f.dueDate)}` : ' · sin vencimiento')}
        {f.status === 'pagada' && f.paidAt && ` · pagada el ${fechaLarga(f.paidAt)}${f.paidMethod ? ` por ${PAYMENT_METHOD_LABEL[f.paidMethod].toLowerCase()}` : ''}${f.paidByName ? ` (lo apuntó ${f.paidByName})` : ''}`}
      </p>
      {error && <div className="cf-error" role="alert">{error}</div>}

      {f.status === 'aprobada' && (
        <>
          <div className="cf-fila">
            <div className="cf-campo">
              <label htmlFor="pago-fecha">Fecha de pago</label>
              <input id="pago-fecha" className="cf-input" type="date" value={fecha} max={hoyEnMadrid()} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="cf-campo">
              <label htmlFor="pago-forma">Cómo se pagó</label>
              <select id="pago-forma" className="cf-select" value={forma} onChange={(e) => setForma(e.target.value as PaymentMethod | '')}>
                <option value="">Sin indicar</option>
                {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
              </select>
            </div>
          </div>
          <button type="button" className="cf-boton" disabled={ocupado || !fecha}
            onClick={() => hacer(() => marcarPagada(f.id, fecha, forma || null), `Factura ${num} marcada como pagada el ${fechaLarga(fecha)}. Ya no le debes esos ${importe}.`)}>
            {ocupado ? 'Guardando…' : 'Marcar como pagada'}
          </button>
          <div className="cf-campo">
            <label htmlFor="pago-venc">Vencimiento</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input id="pago-venc" className="cf-input" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
              <button type="button" className="cf-boton-sec cf-boton-peq" disabled={ocupado || venc === (f.dueDate ?? '')}
                onClick={() => hacer(() => cambiarVencimiento(f.id, venc || null), venc ? `Vencimiento de la factura ${num} cambiado al ${fechaLarga(venc)}.` : `La factura ${num} queda sin vencimiento.`)}>
                Cambiar
              </button>
            </div>
            <span className="cf-ayuda">Al aprobarla se calcula con el plazo de la ficha. Si lo cambias, queda apuntado quién lo cambió.</span>
          </div>
        </>
      )}

      {f.status === 'pagada' && (
        <button type="button" className="cf-boton-sec" disabled={ocupado}
          onClick={() => hacer(() => deshacerPago(f.id), `Deshecho el pago de la factura ${num}: vuelve a estar por pagar (${importe}).`)}>
          {ocupado ? 'Guardando…' : 'Deshacer el pago'}
        </button>
      )}

      <button type="button" className="cf-boton-texto" onClick={alCerrar} style={{ alignSelf: 'flex-start' }}>Cerrar</button>
    </Dialogo>
  )
}
