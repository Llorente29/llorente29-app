// src/modules/conta/libro/NoConfirmados.tsx
//
// Cierre del día · bajo las cifras de un asiento de ventas del día:
// «3 pedidos no confirmados · 71,70 € · no están en estas ventas» y «Ver».
// La lista: hora, marca, canal, código, importe y cómo acabó, en palabras.
// En el móvil, por niveles: código e importe; hora, marca y canal; cómo acabó.
//
// Un umbral ordena, no esconde (regla 7): si hay uno, se dice. Si la
// plataforma lo pagó después y ya tiene su asiento aparte, se enlaza.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { comoAcabo, enLaZona, lineaNoConfirmados } from '@/modules/conta/lib/cierreDelDia'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { noConfirmadosDelResumen, type NoConfirmado } from '@/modules/conta/services/diarioService'
import { rutaAsiento } from '@/config/navegacion'

export function NoConfirmadosDelDia({ accountId, companyId, resumenId }: { accountId: string; companyId: string; resumenId: string }) {
  const [r, setR] = useState<{ clave: string; lista: NoConfirmado[] | null; error: string | null }>({ clave: '', lista: null, error: null })
  const [abierta, setAbierta] = useState(false)
  const clave = `${accountId}:${companyId}:${resumenId}`
  useEffect(() => {
    let vivo = true
    noConfirmadosDelResumen(accountId, companyId, resumenId).then(
      (lista) => { if (vivo) setR({ clave, lista, error: null }) },
      (e: unknown) => { if (vivo) setR({ clave, lista: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, resumenId, clave])
  const lista = r.clave === clave ? r.lista : null
  const error = r.clave === clave ? r.error : null

  if (error) return <p className="cx-error" role="alert">No he podido leer los pedidos no confirmados de este día: {error}</p>
  if (!lista || lista.length === 0) return null
  const total = lista.reduce((t, x) => t + Math.round(x.total * 100), 0) / 100

  return (
    <div className="cxd-noconf" aria-label="Pedidos no confirmados">
      <div className="cxd-noconf-linea">
        <span>{lineaNoConfirmados(lista.length, total)}</span>
        <button type="button" className="cx-enlace" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>{abierta ? 'Ocultar' : 'Ver'}</button>
      </div>
      {abierta && (
        <>
          <p className="cx-ayuda">Seguían abiertos a la hora de cierre del día y se cerraron como no confirmados por la plataforma: no son venta. Si la plataforma paga alguno, te lo propongo como venta de su día.</p>
          <div className="cxd-noconf-tabla" role="table" aria-label="Lista de pedidos no confirmados">
            <div className="cxd-noconf-fila cxd-noconf-cabeza" role="row">
              <span role="columnheader">Hora</span><span role="columnheader">Marca</span><span role="columnheader">Canal</span>
              <span role="columnheader">Código</span><span role="columnheader" className="cxd-der">Importe</span><span role="columnheader">Cómo acabó</span>
            </div>
            {lista.map((x) => (
              <div key={x.id} className="cxd-noconf-fila" role="row">
                <span role="cell" className="cxd-noconf-hora">{enLaZona(new Date(x.soldAt), 'Europe/Madrid').hora}</span>
                <span role="cell" className="cxd-noconf-marca">{x.marca ?? 'Sin marca'}</span>
                <span role="cell" className="cxd-noconf-canal">{x.canal ?? 'Sin canal'}</span>
                <span role="cell" className="cxd-noconf-codigo">{x.codigo ?? 'sin código'}</span>
                <span role="cell" className="cxd-importe cxd-noconf-importe">{eurosExactos(x.total)}</span>
                <span role="cell" className="cxd-noconf-como">
                  {comoAcabo(x.orderStatus, x.deliveryState)}
                  {x.asientoAparte && <> · <Link to={rutaAsiento(x.asientoAparte)} className="cx-enlace">pagado después, en su asiento</Link></>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
