// src/modules/conta/nucleo/recibida/LineasDeLaFactura.tsx
//
// E10 · La fila de las líneas de la factura, bajo los importes. Siempre en el mismo sitio:
// mientras se leen dice «Leyendo…» y, cuando terminan, las cuenta sin que nada salte. Si
// faltan, en ámbar, cuántas de cuántas y «Leer las que faltan» (regla 7: no se esconde; regla 8:
// el botón dice lo que ha pasado). «Ver las líneas» las despliega en una tabla.

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { leerLasLineasQueFaltan, lineasDeLaLectura } from '@/modules/conta/services/documentosService'
import { importeEs } from '@/modules/conta/documentos/fichaRecibida'
import type { EstadoLineas } from '../../../../../supabase/functions/_shared/lecturaPorPartes'
import { filaDeLineas, textoAlLeerFaltan } from './lineas'

type Linea = { texto: string; cantidad: number | null; importe: number | null; iva: number | null }

const cifra = (n: number | null) => (n === null || !Number.isFinite(Number(n)) ? '—' : importeEs(Number(n)))
const cantidad = (n: number | null) => (n === null || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(Number(n)))

export function LineasDeLaFactura({ accountId, invoiceId, lineas, recargar }: {
  accountId: string | null
  invoiceId: string | null
  lineas: readonly Linea[]
  /** Las líneas han cambiado (terminó la lectura o «Leer las que faltan»): volver a leer la factura (el setState de su vuelta, que no cambia). */
  recargar: Dispatch<SetStateAction<number>>
}) {
  const [lectura, setLectura] = useState<{ de: string; sesion: string; estado: EstadoLineas } | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [dicho, setDicho] = useState<{ de: string; texto: string; mal: boolean } | null>(null)
  const ultimo = useRef<string | null>(null)

  useEffect(() => {
    if (!accountId || !invoiceId) return
    let vivo = true
    lineasDeLaLectura(accountId, invoiceId)
      .then((r) => {
        if (!vivo) return
        // Si han cambiado (terminó la lectura), la factura se vuelve a leer con sus líneas.
        const clave = r ? `${invoiceId}:${r.estado.estado}:${r.estado.leidas}` : null
        if (clave && ultimo.current && ultimo.current !== clave && ultimo.current.startsWith(`${invoiceId}:`)) recargar((n) => n + 1)
        ultimo.current = clave
        setLectura(r ? { de: invoiceId, ...r } : null)
      })
      .catch(() => { if (vivo) setLectura(null) })
    return () => { vivo = false }
  }, [accountId, invoiceId, vuelta, recargar])

  const propia = lectura?.de === invoiceId ? lectura : null
  // Mientras se leen, se mira cada cinco segundos; al terminar, la factura se vuelve a leer con sus líneas.
  useEffect(() => {
    if (propia?.estado.estado !== 'leyendo') return
    const t = setTimeout(() => setVuelta((n) => n + 1), 5000)
    return () => clearTimeout(t)
  }, [propia])
  const fila = filaDeLineas(lineas.length, propia?.estado)
  if (fila.tono === 'nada') return null
  const abiertaAqui = abierta === invoiceId

  const leerFaltan = async () => {
    if (!accountId || !propia || leyendo) return
    setLeyendo(true); setDicho(null)
    try {
      const e = await leerLasLineasQueFaltan(accountId, propia.sesion)
      setDicho({ de: propia.de, texto: textoAlLeerFaltan(e), mal: e?.estado !== 'completas' && e !== null })
      setVuelta((n) => n + 1)
      recargar((n) => n + 1)
    } catch (err) {
      setDicho({ de: propia.de, texto: err instanceof Error ? err.message : String(err), mal: true })
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <div className="kf-lineas" data-prueba="lineas-factura" data-tono={fila.tono}>
      <div className="kf-lineas-fila">
        <span data-prueba="lineas-texto">{fila.texto}</span>
        {fila.tono === 'ambar' && fila.leerFaltan && (
          <button type="button" className="kf-boton-hueco kf-lineas-leer" disabled={leyendo} onClick={() => void leerFaltan()}>
            {leyendo ? 'Leyendo…' : 'Leer las que faltan'}
          </button>
        )}
        {fila.tono !== 'leyendo' && fila.ver && (
          <button type="button" className="kf-enlace-plano kf-lineas-ver" aria-expanded={abiertaAqui} onClick={() => setAbierta(abiertaAqui ? null : invoiceId)}>
            {abiertaAqui ? 'Ocultar las líneas' : 'Ver las líneas'}
          </button>
        )}
      </div>
      {dicho?.de === invoiceId && <p className="kf-lineas-dicho" role="status" data-mal={dicho.mal ? 'si' : undefined}>{dicho.texto}</p>}
      {abiertaAqui && (
        <div className="kf-lineas-tabla">
          <table>
            <thead><tr><th>Artículo</th><th>Cantidad</th><th>Importe</th><th>IVA</th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}><td>{l.texto}</td><td>{cantidad(l.cantidad)}</td><td>{cifra(l.importe)}</td><td>{l.iva === null ? '—' : `${cantidad(l.iva)} %`}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
