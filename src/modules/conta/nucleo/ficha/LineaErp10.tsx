// src/modules/conta/nucleo/ficha/LineaErp10.tsx
//
// X10f (20/11) · La línea de ERP10 de la ficha de cada factura y asiento, junto a su estado: verde
// «En ERP10 · asiento N», gris «Saliendo a ERP10…» y ámbar «No ha salido a ERP10: …» con «Volver a
// intentarlo». Una sola línea, pequeña, sin ventanas (encargo X10f · 5). Mientras sale, se vuelve a
// mirar sola cada 10 segundos: lo validado sale solo, sin tocar nada más. «Volver a intentarlo» lo saca
// en el acto, como el botón de «Salida a ERP10» (a mano), y lo que pase se ve en la misma línea (regla 8).

import { useState } from 'react'
import './ficha.css'
import type { Linea } from '@/modules/conta/erp10/salidaSola'
import { sacarAErp10 } from '@/modules/conta/services/erp10ApiService'
import { MOTIVO_SALIDA_PARADA, SALIDA_ERP10_PARADA } from '@/modules/conta/erp10/parada'

export function LineaErp10({ linea, companyId, entryId, fecha, quien, releer }: {
  linea: Linea | null; companyId: string | null; entryId: string | null; fecha: string | null; quien: string | null; releer: () => void
}) {
  const [sacando, setSacando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  if (!linea) return null
  async function otraVez() {
    if (!companyId || !entryId || !fecha) return
    setSacando(true); setFallo(null)
    try {
      await sacarAErp10(companyId, `${fecha.slice(0, 7)}-01`, [entryId], quien)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'no ha contestado')
    } finally { setSacando(false); releer() }
  }
  const texto = sacando ? 'Saliendo a ERP10…' : fallo ? `No ha salido a ERP10: ${fallo.replace(/\.$/, '')}.` : linea.texto
  const tono = sacando ? 'gris' : fallo ? 'ambar' : linea.tono
  return (
    <span className="kf-estado kf-erp10" data-tono={tono} role="status" aria-label="ERP10" data-prueba="linea-erp10">
      <span className="kf-estado-punto" aria-hidden="true" />
      <span className="kf-erp10-texto" title={texto}>{texto}</span>
      {(linea.reintentar || fallo) && !sacando && <> <button type="button" className="kf-enlace kf-erp10-otra" disabled={SALIDA_ERP10_PARADA} title={SALIDA_ERP10_PARADA ? `${MOTIVO_SALIDA_PARADA}.` : undefined} onClick={() => void otraVez()}>Volver a intentarlo</button></>}
    </span>
  )
}
