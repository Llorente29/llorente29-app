// src/modules/conta/documentos/AsientosDeCompras.tsx
//
// S01 · PR 3 · Entrega 5 (PC01, punto 6): el pago a proveedor y lo recibido sin
// factura (la provisión de fin de mes y su contrario del día 1) se deciden en
// Compras y gastos › Facturas recibidas, no en Asientos (lib/diario.ts,
// SE_DECIDE_EN). Aquí se enseñan TODOS los propuestos de esos orígenes, de
// cualquier fecha (regla 7), y se validan uno a uno; cada validación dice qué
// número ha cogido (regla 8). Para ver sus apuntes, el asiento abre su ficha.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { diaMes, eurosExactos } from '@/modules/conta/lib/formato'
import { Boton } from '@/modules/conta/diseno'
import { leerPropuestosDe, validar } from '@/modules/conta/services/diarioService'
import { DE_COMPRAS, queEsDeCompras, tituloDeCompras } from '@/modules/conta/lib/asientosDeCompras'

export function AsientosDeCompras() {
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const [vuelta, setVuelta] = useState(0)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const r = useLeer(accountId && activa ? () => leerPropuestosDe(accountId, activa.id, DE_COMPRAS) : null, `${accountId}:${activa?.id}:${vuelta}:asientos-compras`)

  async function validarUno(id: string, que: string) {
    setOcupado(id)
    setAviso(null)
    try {
      const v = await validar(id, userName ?? null)
      setAviso({ ok: true, texto: `Validado: ${que}. Es el asiento ${v.numero} de la serie ${v.serie}.` })
      setVuelta((x) => x + 1)
    } catch (e) {
      setAviso({ ok: false, texto: `No se ha validado ${que}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setOcupado(null)
    }
  }

  if (r.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No he podido leer los asientos de compras por validar: {r.error} <button type="button" className="s-boton s-boton-enlace" onClick={r.recargar}>Reintentar</button></p>
  const filas = r.datos ?? []
  if (filas.length === 0 && !aviso) return null
  return (
    <section className="cx-tarjeta" aria-label="Asientos de compras por validar" data-prueba="asientos-compras">
      <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">{tituloDeCompras(filas.length)}</h2></div>
      <div role="status" aria-live="polite">
        {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'}>{aviso.texto}</p>}
      </div>
      {filas.length > 0 && (
        <>
          <p className="cx-ayuda" style={{ marginTop: 0 }}>Los propongo yo: lo recibido sin factura al cerrar el mes (y su contrario el día 1) y los pagos a proveedor. Míralos y valídalos aquí.</p>
          <ul>
            {filas.map((a) => {
              const importe = a.apuntes.reduce((t, l) => t + l.debe, 0)
              const que = `${queEsDeCompras(a.origen)} del ${diaMes(a.fecha)}`
              return (
                <li key={a.id}>
                  <strong>{que}</strong> · {a.concepto} · {eurosExactos(importe)}
                  {a.razones.some((x) => x.decision === 'Mira esto') && <> · <em>mira esto: {a.razones.filter((x) => x.decision === 'Mira esto').map((x) => x.porque).join(' · ')}</em></>}
                  {' '}<Link to={rutaAsiento(a.id)}>Ver sus apuntes</Link>{' '}
                  <Boton onClick={() => void validarUno(a.id, que)} disabled={ocupado !== null}>{ocupado === a.id ? 'Validando…' : 'Validar'}</Boton>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
