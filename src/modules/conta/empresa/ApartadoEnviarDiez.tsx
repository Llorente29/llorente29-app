// src/modules/conta/empresa/ApartadoEnviarDiez.tsx
//
// C07 · «Enviar a Diez» en Ajustes › Ejercicio (Julio, 22/10). Un interruptor
// por empresa: encendido, todo asiento que se valide sale solo a Diez (ventas,
// banco, facturas recibidas, manuales, liquidaciones y sus anulaciones);
// apagado, no se envía nada y las pantallas no hablan de Diez. Solo sale en
// una empresa que trabaja con Diez (conta_diez_base). Al cambiarlo dice qué ha
// hecho y cuántos asientos validados salen ahora o se quedan (regla 8).
//
// C12 (24/10): una empresa que traspasa una vez al mes (modo mensual) ya no
// tiene interruptor: el apartado dice que todo va a Diez en el traspaso del
// cierre del mes y lleva allí. El interruptor solo queda en las empresas que
// siguen con el envío al validar.
//
// Nombres dentro de cadenas (regla 40): conta_diez_base (company_id,
// account_id), de antes; lo demás, en envioDiezService.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros } from '@/config/navegacion'
import { tabla } from '@/modules/conta/services/bd'
import { ponerEnvioEmpresa, useEnvioDiez } from '@/modules/conta/services/envioDiezService'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { TarjetaCargando } from '@/modules/conta/ui/piezas'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function ApartadoEnviarDiez({ quien, movil, nombre }: { quien: Quien; movil: boolean; nombre: string | null }) {
  const { envio, error, recargar } = useEnvioDiez(quien.accountId, quien.companyId)
  const [conDiez, setConDiez] = useState<boolean | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    tabla('conta_diez_base').select('company_id').eq('account_id', quien.accountId).eq('company_id', quien.companyId).maybeSingle()
      .then((r: { data: unknown; error: unknown }) => { if (vivo) setConDiez(!r.error && !!r.data) })
    return () => { vivo = false }
  }, [quien.accountId, quien.companyId])

  // Una empresa que no trabaja con Diez no ve nada de Diez.
  if (conDiez === false) return null
  if (conDiez === null || !envio) return <TarjetaCargando />

  async function cambiar(encender: boolean) {
    setOcupado(true); setHecho(null); setFallo(null)
    try { setHecho((await ponerEnvioEmpresa(quien.companyId, encender, nombre)).texto); recargar() }
    catch (x) { setFallo(`No se ha cambiado: ${x instanceof Error ? x.message : 'no ha contestado'}`) }
    finally { setOcupado(false) }
  }

  if (envio.mensual) {
    return (
      <TarjetaApartado titulo="Traspasar a Diez" movil={movil}>
        <p className="cx-ayuda" style={{ margin: 0 }}>
          Lo de cada mes va a Diez de golpe, al cerrar el mes: ventas, banco, facturas recibidas, asientos a mano, liquidaciones y sus anulaciones. Al validar no sale nada suelto.
        </p>
        <p style={{ margin: 0 }}><Link to={rutaLibros('cierre', 'cerrar-mes')} className="cx-enlace">Traspasar el mes a Diez</Link></p>
        {error && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer cómo va a Diez: {error}</p>}
      </TarjetaApartado>
    )
  }

  return (
    <TarjetaApartado titulo="Enviar a Diez" movil={movil}>
      <label className="cx-campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" role="switch" checked={envio.encendido} disabled={ocupado} aria-describedby="enviar-diez-ayuda"
          onChange={(e) => { void cambiar(e.target.checked) }} />
        <span className="cx-etiqueta" style={{ margin: 0 }}>{envio.encendido ? 'Encendido' : 'Apagado'}</span>
      </label>
      <p className="cx-ayuda" id="enviar-diez-ayuda" style={{ margin: 0 }}>
        {envio.encendido
          ? <>Todo asiento que se valide sale solo a Diez: ventas, banco, facturas recibidas, manuales, liquidaciones y sus anulaciones{envio.desde ? <>, desde el {fechaLarga(envio.desde)}</> : null}. Si uno no llega, el asiento sigue validado y lo dice junto a su número, con «Reintentar».</>
          : 'No se envía nada a Diez y las pantallas no hablan de Diez. Al encenderlo, sale solo todo lo que se valide.'}
      </p>
      {envio.cambiadoPor && envio.cambiadoEn && <p className="cx-ayuda" style={{ margin: 0 }}>Lo cambió {envio.cambiadoPor} el {fechaLarga(envio.cambiadoEn.slice(0, 10))}.</p>}
      {error && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer si está encendido: {error}</p>}
      <Resultado hecho={hecho} fallo={fallo} />
    </TarjetaApartado>
  )
}
