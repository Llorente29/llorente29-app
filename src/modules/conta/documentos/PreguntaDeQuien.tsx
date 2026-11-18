// src/modules/conta/documentos/PreguntaDeQuien.tsx
//
// E03 · Arriba en la ficha de una recibida, en la franja ámbar de las dudas:
// «Esta factura va a nombre de …» y sus dos botones, del mismo tamaño. Mientras no
// se conteste, la ficha no deja validar. Cada botón confirma con lo que ha hecho
// (regla 8): «Apuntado: su IVA se deduce. Lo decidió … el …», o «Pasada a …, con su
// PDF. Ya no está en esta lista.». Con su asiento validado y marcada sola antes del
// E03: lo dice, sin botones.
//
// E04 · Cuando no se sabe de quién es (fuera o sin leer) y la cuenta tiene más de
// una sociedad, debajo de la frase y antes de los botones del IVA: «Es de:
// [sociedad ▾]», con las de la cuenta (con el nombre del cambio de empresa) y la
// de ahora elegida. Si se elige otra, sale «Pasarla a …», que hace lo del E03. Los
// dos botones del IVA, en hueco: ninguno relleno.

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { botonesDeQuien, eligeSociedad, SOLO_SUMIED, type DeQuien, type RespuestaDeQuien } from '@/modules/conta/lib/deQuienEs'
import { contestarDeQuien, pasarALaOtra } from '@/modules/conta/services/deQuienService'

export function PreguntaDeQuien({ invoiceId, q, quien, sociedades, actual, alContestar, alPasar }: {
  invoiceId: string
  q: DeQuien | null
  quien: string | null
  /** E04 · Las sociedades de la cuenta, con el nombre que se ve en «Cambiar de empresa». */
  sociedades: readonly { id: string; nombre: string }[]
  /** E04 · La sociedad en la que está la factura. */
  actual: string | null
  /** Contestada: la ficha vuelve a leer (su asiento se propone otra vez). */
  alContestar: (texto: string) => void
  /** Pasada a la otra sociedad: ya no es de esta lista. */
  alPasar: (texto: string) => void
}) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [elegida, setElegida] = useState<{ factura: string; id: string } | null>(null)
  if (!q) return null
  if (q.soloSumied) {
    return <p className="s-aviso-lista" data-tono="neutro" data-prueba="solo-sumied">{SOLO_SUMIED}</p>
  }
  if (!q.pregunta || !q.frase) return null
  const conSelector = eligeSociedad(q.caso, sociedades.length) && !!actual
  const es = elegida?.factura === invoiceId ? elegida.id : actual
  const otra = conSelector && es && es !== actual ? sociedades.find((s) => s.id === es) ?? null : null
  const hacer = async (que: RespuestaDeQuien | 'pasar' | 'pasar_elegida') => {
    setOcupado(que); setFallo(null)
    try {
      if (que === 'pasar' || que === 'pasar_elegida') {
        const destino = que === 'pasar' ? q.sociedadId : otra?.id ?? null
        if (!destino) throw new Error('No sé a qué sociedad pasarla.')
        alPasar(await pasarALaOtra(invoiceId, destino, quien))
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
      {conSelector && (
        <div className="cxf-de-quien-es" data-prueba="de-quien-es">
          <label>
            Es de:{' '}
            <select className="s-control" value={es ?? ''} onChange={(e) => setElegida({ factura: invoiceId, id: e.target.value })} disabled={!!ocupado}>
              {sociedades.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          {otra && (
            <Boton variante="principal" onClick={() => void hacer('pasar_elegida')} disabled={!!ocupado}>
              {ocupado === 'pasar_elegida' ? 'Pasándola…' : `Pasarla a ${otra.nombre}`}
            </Boton>
          )}
        </div>
      )}
      {!otra && (
        <div className="cxf-de-quien-botones">
          {botonesDeQuien(q).map((b) => (
            <Boton key={b.que} variante={b.principal ? 'principal' : 'secundario'} onClick={() => void hacer(b.que)} disabled={!!ocupado}>
              {ocupado === b.que ? (b.que === 'pasar' ? 'Pasándola…' : 'Guardando…') : b.texto}
            </Boton>
          ))}
        </div>
      )}
      {fallo && <p className="s-apoyo" role="alert" style={{ margin: '8px 0 0' }}>{fallo}</p>}
    </section>
  )
}
