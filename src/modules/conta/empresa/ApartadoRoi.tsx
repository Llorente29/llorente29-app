// src/modules/conta/empresa/ApartadoRoi.tsx
//
// S01o·2 · Ajustes › Tus impuestos › «¿Estás en el ROI?» (Julio, 01/11). El
// registro de operadores intracomunitarios: sin estar en él, el IVA español que
// cobra un proveedor de la UE no se puede deducir y va al gasto. Sin contestar,
// esas facturas no se apuntan solas y «Por revisar» hace la pregunta.
// Guardar confirma o falla en pantalla, con su contenido (regla 8).

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { TarjetaApartado, Resultado } from '@/modules/conta/empresa/campos'
import { useLeer } from '@/modules/conta/libros/contexto'
import { leerRoi, guardarRoi } from '@/modules/conta/services/apuntaSoloService'
import { textoRoi } from '@/modules/conta/lib/apuntaSolo'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function PreguntaRoi({ quien, alContestar }: { quien: Quien; alContestar?: (texto: string) => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  async function contestar(v: boolean) {
    setOcupado(true); setFallo(null)
    try { await guardarRoi(quien.accountId, quien.companyId, v); alContestar?.(textoRoi(v, true)) }
    catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  return (
    <div className="cx-columna" style={{ gap: 10 }} data-prueba="pregunta-roi">
      <strong>¿Tu empresa está en el ROI, el registro de las que compran sin IVA dentro de la UE?</strong>
      <div style={{ display: 'flex', gap: 10 }}>
        <Boton variante="principal" disabled={ocupado} onClick={() => void contestar(true)}>Sí</Boton>
        <Boton disabled={ocupado} onClick={() => void contestar(false)}>No</Boton>
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </div>
  )
}

export function ApartadoRoi({ quien, movil }: { quien: Quien; movil: boolean }) {
  const [vuelta, setVuelta] = useState(0)
  const [hecho, setHecho] = useState<string | null>(null)
  const datos = useLeer(() => leerRoi(quien.accountId, quien.companyId), `${quien.companyId}:${vuelta}:roi`)
  const v = datos.datos
  return (
    <TarjetaApartado titulo="¿Estás en el ROI?" movil={movil}>
      {v === undefined || v === null
        ? <PreguntaRoi quien={quien} alContestar={(t) => { setHecho(t); setVuelta((x) => x + 1) }} />
        : <>
            <p className="cx-ayuda" style={{ margin: 0 }} data-prueba="roi-contestado">{textoRoi(v, false)}</p>
            <div><Boton onClick={async () => { await guardarRoi(quien.accountId, quien.companyId, !v); setHecho(textoRoi(!v, true)); setVuelta((x) => x + 1) }}>
              {v ? 'No, no está en el ROI' : 'Sí, está en el ROI'}
            </Boton></div>
          </>}
      {datos.error && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer si estás en el ROI: {datos.error}</p>}
      <Resultado hecho={hecho} fallo={null} />
    </TarjetaApartado>
  )
}
