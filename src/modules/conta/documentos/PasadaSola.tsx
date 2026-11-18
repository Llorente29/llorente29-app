// src/modules/conta/documentos/PasadaSola.tsx
//
// E04 · Arriba en la ficha de una recibida que Sumied pasó sola a esta sociedad:
// una línea VERDE (no hay nada que mirar) que dice qué ha hecho y por qué, con el
// nombre y el NIF, y «Deshacer» al lado, a la vista. «Deshacer» la devuelve a la
// sociedad de la que vino y confirma con lo hecho (regla 8): «Devuelta a …. Ya no
// se moverá sola.»

import { useState } from 'react'
import type { PasadaSola as Dato } from '@/modules/conta/services/pasadaSolaService'
import { devolverPasadaSola } from '@/modules/conta/services/pasadaSolaService'

export function PasadaSola({ invoiceId, p, quien, alDevolver }: {
  invoiceId: string
  p: Dato | null
  quien: string | null
  /** Devuelta: ya no es de esta sociedad. */
  alDevolver: (texto: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  if (!p) return null
  const deshacer = async () => {
    setOcupado(true); setFallo(null)
    try { alDevolver(await devolverPasadaSola(invoiceId, quien)) } catch (e) {
      setFallo(`No se ha deshecho: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setOcupado(false) }
  }
  return (
    <div className="s-aviso-lista" data-tono="ok" role="status" data-prueba="pasada-sola">
      {p.texto}{' '}
      <button type="button" className="s-boton s-boton-enlace" onClick={() => void deshacer()} disabled={ocupado}>{ocupado ? 'Deshaciendo…' : 'Deshacer'}</button>
      {fallo && <span role="alert" style={{ display: 'block', marginTop: 4 }}>{fallo}</span>}
    </div>
  )
}
