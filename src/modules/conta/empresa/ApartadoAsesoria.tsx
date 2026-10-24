// src/modules/conta/empresa/ApartadoAsesoria.tsx
//
// P01 · «¿Tu cuenta es una asesoría?», en Ajustes › Tus impuestos. Es la marca
// explícita de la CUENTA (accounts.tax_advisor_since; decisión de Julio,
// 19/10): con ella sale Impuestos › «Tus clientes», también vacía, para que
// una asesoría nueva vea dónde le llegarán sus clientes. La cambia la
// administración de la cuenta; mientras haya clientes que den permiso no se
// quita (la base lo dice y aquí se enseña).
// Y el correo al que responden los clientes al resumen del trimestre (si no
// lo hay, se pide antes de enviar).
//
// Regla 8: cada cambio dice qué ha pasado.

import { useEffect, useState } from 'react'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { leerSoyAsesoria, marcarAsesoria, ponerCorreoRespuesta, type SoyAsesoria } from '@/modules/conta/services/despachoService'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function ApartadoAsesoria({ quien, movil }: { quien: Quien; movil: boolean }) {
  const [soy, setSoy] = useState<SoyAsesoria | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [correo, setCorreo] = useState('')
  const h = useHacer(() => { setVuelta((v) => v + 1); refrescarContextoEsqueleto() })
  useEffect(() => {
    let vivo = true
    leerSoyAsesoria(quien.accountId).then((s) => { if (vivo) { setSoy(s); setCorreo(s.correo_respuesta ?? '') } }).catch(() => { if (vivo) setSoy(null) })
    return () => { vivo = false }
  }, [quien.accountId, vuelta])
  if (!soy) return null

  const poner = (es: boolean) => {
    let mensaje = ''
    void h.hacer(async () => { mensaje = (await marcarAsesoria(quien.accountId, es)).mensaje }, () => mensaje)
  }
  const guardarCorreo = () => {
    let mensaje = ''
    void h.hacer(async () => { mensaje = (await ponerCorreoRespuesta(quien.accountId, correo)).mensaje }, () => mensaje)
  }

  return (
    <TarjetaApartado titulo="¿Tu cuenta es una asesoría?" movil={movil}>
      <p style={{ margin: 0 }}>
        {movil && '¿Tu cuenta es una asesoría? '}
        <strong data-testid="es-asesoria">{soy.asesoria ? 'Sí' : 'No'}</strong>
        {soy.clientes > 0 && <> · llevas los impuestos de {soy.clientes} {soy.clientes === 1 ? 'cliente' : 'clientes'}</>}
      </p>
      <p className="cx-ayuda">Con «Sí» sale en Impuestos «Tus clientes»: los impuestos de las empresas que te dan permiso, y presentar por lotes. Solo ves a quien te ha dado permiso.</p>
      <div className="cx-tablas-filtros" role="group" aria-label="¿Tu cuenta es una asesoría?">
        <button type="button" className="cx-pildora" aria-pressed={soy.asesoria} disabled={!soy.puede_marcar || h.guardando || soy.asesoria} onClick={() => poner(true)}>Sí, soy una asesoría</button>
        <button type="button" className="cx-pildora" aria-pressed={!soy.asesoria} disabled={!soy.puede_marcar || h.guardando || !soy.asesoria} onClick={() => poner(false)}>No</button>
      </div>
      {!soy.puede_marcar && <p className="cx-ayuda">Lo cambia la administración de la cuenta.</p>}
      {soy.asesoria && (
        <div className="cx-columna" style={{ gap: 6 }}>
          <label htmlFor="correo-respuesta" className="cx-ayuda">Correo al que responden tus clientes al resumen del trimestre</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input id="correo-respuesta" type="email" className="cx-input" value={correo} onChange={(e) => setCorreo(e.target.value)}
              disabled={!soy.puede_gestionar || h.guardando} placeholder="despacho@tuasesoria.es" style={{ flex: '1 1 220px', minWidth: 0 }} />
            <button type="button" className="cx-pildora" disabled={!soy.puede_gestionar || h.guardando || correo.trim() === (soy.correo_respuesta ?? '')} onClick={guardarCorreo}>Guardar el correo</button>
          </div>
          {!soy.correo_respuesta && <p className="cx-ayuda">Sin él, Sumied te lo pedirá antes de mandar el primer resumen.</p>}
        </div>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
