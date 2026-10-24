// src/modules/conta/libro/DetalleDiez.tsx
//
// C07 · El detalle pequeño junto al número del asiento (Julio, 22/10): «En
// Diez · 4/1.234», o «No enviado · motivo · Reintentar». No es una sección: va
// en la misma línea que el número. Sin detalle (apagado, o lo que no va a
// Diez), no pinta nada. «Reintentar» dice lo que ha pasado (regla 8).

import { useState } from 'react'
import { Chip } from '@/modules/conta/ui/piezas'
import { fraseDiez, type DetalleDiez } from '@/modules/conta/lib/enDiez'
import { enviarADiez } from '@/modules/conta/services/conDiezService'

const tonoChip = (t: DetalleDiez['tono']) => (t === 'verde' ? 'ia' : t === 'azul' ? 'azul' : t === 'ambar' ? 'ambar' : 'neutro')

export function DetalleDiezPieza({ d, alHacer, alFallar, conMotivo = true, sinBoton = false }: {
  d: DetalleDiez | null
  /** Dentro de algo que ya es un botón (la tarjeta del móvil): sin «Reintentar». */
  sinBoton?: boolean
  alHacer: (texto: string) => void
  alFallar: (texto: string) => void
  /** En la fila del libro el motivo va solo en el title; en el asiento, también escrito. */
  conMotivo?: boolean
}) {
  const [ocupado, setOcupado] = useState(false)
  if (!d) return null
  async function reintentar() {
    if (!d?.reintentar) return
    setOcupado(true)
    try {
      const r = await enviarADiez(d.reintentar)
      ;(r.estado === 'en_diez' ? alHacer : alFallar)(r.estado === 'en_diez' ? r.texto : `No se ha enviado a Diez: ${r.motivo}.`)
    } catch (x) { alFallar(`No se ha enviado a Diez: ${x instanceof Error ? x.message : 'no ha contestado'}.`) }
    finally { setOcupado(false) }
  }
  const frase = fraseDiez(d)
  return (
    <span className="cxd-diez-detalle" data-prueba="detalle-diez" title={frase}>
      <span aria-label={frase}><Chip tono={tonoChip(d.tono)}>{d.texto}</Chip></span>
      {conMotivo && d.motivo && <span className="cx-ayuda" style={{ margin: 0 }}> · {d.motivo}</span>}
      {d.reintentar && !sinBoton && (
        <>
          {' · '}
          <button type="button" className="cx-enlace" onClick={() => { void reintentar() }} disabled={ocupado}>{ocupado ? 'Enviando…' : 'Reintentar'}</button>
        </>
      )}
    </span>
  )
}
