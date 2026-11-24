// src/modules/supply/lineas/LineasLeidas.tsx
//
// E10b (23/11) · Las líneas de una factura larga, en el detalle de la factura de FOLVY (encima de su
// tabla de líneas). Las líneas de artículo, con su lote y su caducidad, son de Folvy; en Sumied no se ven
// (Julio, 23/11). Esta fila solo dice algo cuando hay algo que hacer:
//   · mientras se leen, «Leyendo las líneas de la factura…», y al terminar se vuelve a leer la factura;
//   · si faltan, en ámbar, cuántas de cuántas y «Leer las que faltan» (regla 7: no se esconde; regla 8:
//     el botón dice lo que ha pasado). También las de una empresa que entraron antes de usar Folvy
//     (E10b: entonces no se leyeron).
// Una factura leída de una vez, o con todas sus líneas, no enseña nada aquí: la tabla de abajo las tiene.

import { useEffect, useRef, useState } from 'react'
import { leerLasLineasQueFaltan, lineasDeLaLectura } from '@/modules/conta/services/documentosService'
import type { EstadoLineas } from '../../../../supabase/functions/_shared/lecturaPorPartes'
import { filaDeLineas, textoAlLeerFaltan } from './lineasLeidas'

export function LineasLeidas({ accountId, invoiceId, lineas, alCambiar }: {
  accountId: string | null
  invoiceId: string | null
  /** Cuántas líneas tiene hoy la factura. */
  lineas: number
  /** Las líneas han cambiado (terminó la lectura o «Leer las que faltan»): volver a leer la factura. */
  alCambiar: () => void
}) {
  const [lectura, setLectura] = useState<{ de: string; sesion: string; estado: EstadoLineas } | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [leyendo, setLeyendo] = useState(false)
  const [dicho, setDicho] = useState<{ de: string; texto: string; mal: boolean } | null>(null)
  const ultimo = useRef<string | null>(null)
  const cambio = useRef(alCambiar)
  useEffect(() => { cambio.current = alCambiar }, [alCambiar])

  useEffect(() => {
    if (!accountId || !invoiceId) return
    let vivo = true
    lineasDeLaLectura(accountId, invoiceId)
      .then((r) => {
        if (!vivo) return
        // Si han cambiado (terminó la lectura), la factura se vuelve a leer con sus líneas.
        const clave = r ? `${invoiceId}:${r.estado.estado}:${r.estado.leidas}` : null
        if (clave && ultimo.current && ultimo.current !== clave && ultimo.current.startsWith(`${invoiceId}:`)) cambio.current()
        ultimo.current = clave
        setLectura(r ? { de: invoiceId, ...r } : null)
      })
      .catch(() => { if (vivo) setLectura(null) })
    return () => { vivo = false }
  }, [accountId, invoiceId, vuelta])

  const propia = lectura?.de === invoiceId ? lectura : null
  // Mientras se leen, se mira cada cinco segundos.
  useEffect(() => {
    if (propia?.estado.estado !== 'leyendo') return
    const t = setTimeout(() => setVuelta((n) => n + 1), 5000)
    return () => clearTimeout(t)
  }, [propia])

  const fila = filaDeLineas(lineas, propia?.estado)
  const dichoAqui = dicho?.de === invoiceId ? dicho : null
  if ((fila.tono === 'nada' || fila.tono === 'bien') && !dichoAqui) return null

  const leerFaltan = async () => {
    if (!accountId || !propia || leyendo) return
    setLeyendo(true); setDicho(null)
    try {
      const e = await leerLasLineasQueFaltan(accountId, propia.sesion)
      setDicho({ de: propia.de, texto: textoAlLeerFaltan(e), mal: e !== null && e.estado !== 'completas' })
      setVuelta((n) => n + 1)
      cambio.current()
    } catch (err) {
      setDicho({ de: propia.de, texto: err instanceof Error ? err.message : String(err), mal: true })
    } finally {
      setLeyendo(false)
    }
  }

  const ambar = fila.tono === 'ambar'
  return (
    <div data-prueba="lineas-leidas" data-tono={fila.tono}
      className={`rounded-lg border px-3 py-2 text-sm flex flex-col gap-1 ${ambar ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border-default bg-page text-text-secondary'}`}>
      {fila.tono !== 'nada' && fila.tono !== 'bien' && (
        <div className="flex items-center gap-3">
          <span className="flex-1" data-prueba="lineas-texto">{fila.texto}</span>
          {fila.tono === 'ambar' && fila.leerFaltan && (
            <button type="button" disabled={leyendo} onClick={() => void leerFaltan()}
              className="rounded-md border border-amber-400 bg-white px-3 py-1 text-amber-900 hover:bg-amber-100 disabled:opacity-60">
              {leyendo ? 'Leyendo…' : 'Leer las que faltan'}
            </button>
          )}
        </div>
      )}
      {dichoAqui && <p role="status" className={dichoAqui.mal ? 'text-amber-900' : 'text-emerald-800'}>{dichoAqui.texto}</p>}
    </div>
  )
}
