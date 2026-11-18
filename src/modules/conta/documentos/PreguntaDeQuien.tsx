// src/modules/conta/documentos/PreguntaDeQuien.tsx
//
// E03 · Arriba en la ficha de una recibida, en la franja ámbar de las dudas:
// «Esta factura va a nombre de …» y sus dos botones, del mismo tamaño (el que más
// se usará, relleno). Mientras no se conteste, la ficha no deja validar. Cada
// botón confirma con lo que ha hecho (regla 8): «Apuntado: su IVA se deduce. Lo
// decidió … el …», o «Pasada a …, con su PDF. Ya no está en esta lista.».
// Con su asiento validado y marcada sola antes del E03: lo dice, sin botones.

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { botonesDeQuien, SOLO_SUMIED, type DeQuien, type RespuestaDeQuien } from '@/modules/conta/lib/deQuienEs'
import { contestarDeQuien, pasarALaOtra } from '@/modules/conta/services/deQuienService'

export function PreguntaDeQuien({ invoiceId, q, quien, alContestar, alPasar }: {
  invoiceId: string
  q: DeQuien | null
  quien: string | null
  /** Contestada: la ficha vuelve a leer (su asiento se propone otra vez). */
  alContestar: (texto: string) => void
  /** Pasada a la otra sociedad: ya no es de esta lista. */
  alPasar: (texto: string) => void
}) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  if (!q) return null
  if (q.soloSumied) {
    return <p className="s-aviso-lista" data-tono="neutro" data-prueba="solo-sumied">{SOLO_SUMIED}</p>
  }
  if (!q.pregunta || !q.frase) return null
  const hacer = async (que: RespuestaDeQuien | 'pasar') => {
    setOcupado(que); setFallo(null)
    try {
      if (que === 'pasar') {
        if (!q.sociedadId) throw new Error('No sé a qué sociedad pasarla.')
        alPasar(await pasarALaOtra(invoiceId, q.sociedadId, quien))
      } else {
        alContestar(await contestarDeQuien(invoiceId, que, quien))
      }
    } catch (e) {
      setFallo(`No se ha hecho: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setOcupado(null) }
  }
  return (
    <section className="s-aviso-lista cxf-de-quien" data-tono="duda" aria-label="¿De quién es esta factura?" data-prueba="de-quien">
      <p style={{ margin: '0 0 8px' }}><strong>{q.frase}</strong></p>
      <div className="cxf-de-quien-botones">
        {botonesDeQuien(q).map((b) => (
          <Boton key={b.que} variante={b.principal ? 'principal' : 'secundario'} onClick={() => void hacer(b.que)} disabled={!!ocupado}>
            {ocupado === b.que ? (b.que === 'pasar' ? 'Pasándola…' : 'Guardando…') : b.texto}
          </Boton>
        ))}
      </div>
      {fallo && <p className="s-apoyo" role="alert" style={{ margin: '8px 0 0' }}>{fallo}</p>}
    </section>
  )
}
