// src/modules/conta/documentos/NifDeLaFicha.tsx
//
// N1 · En la ficha de la recibida, cuando su proveedor no tiene NIF: guardarlo
// en su ficha AHORA, sin esperar a validar (sin NIF no hay asiento que validar).
// Si el documento lo trae, sale escrito; si no (CARREFOUR 2026FBFN01634861), se
// escribe. Se comprueba antes de guardar y dice lo que ha hecho (regla 8).

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { cambiosDelNif, faltaEnElNif, nifPropuesto, textoGuardado } from '@/modules/conta/lib/nifDeLaFicha'
import { guardarFicha } from '@/modules/conta/services/proveedorService'
import type { FichaProveedor } from '@/modules/conta/types'

export function NifDeLaFicha({ proveedorId, proveedor, entityKind, delDocumento, alGuardar }: {
  proveedorId: string
  proveedor: string
  entityKind: FichaProveedor['entityKind'] | null
  /** El NIF que trae el documento (puede no traerlo). */
  delDocumento: string | null
  /** Guardado (con lo que se dice): que la ficha lo enseñe y vuelva a preparar el asiento. */
  alGuardar: (texto: string) => void
}) {
  const propuesto = nifPropuesto(delDocumento)
  const [escrito, setEscrito] = useState(propuesto)
  const [tocado, setTocado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const falta = faltaEnElNif(escrito)
  const guardar = async () => {
    if (falta) { setTocado(true); return }
    setGuardando(true); setFallo(null)
    try {
      await guardarFicha(proveedorId, cambiosDelNif(escrito, entityKind))
      alGuardar(textoGuardado(proveedor, escrito))
    } catch (e) {
      setFallo(`No se ha guardado: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setGuardando(false) }
  }
  return (
    <BloqueFicha titulo="NIF del proveedor">
      <p className="s-apoyo" data-prueba="nif-de-la-ficha">
        {propuesto
          ? `La ficha de ${proveedor} no tiene NIF y sin él no se puede preparar el asiento. El documento trae el ${propuesto}: guárdalo en su ficha.`
          : `La ficha de ${proveedor} no tiene NIF y el documento no lo trae. Sin él no se puede preparar el asiento: escríbelo (lo pone en la factura, junto a su nombre) y lo guardo en su ficha.`}
      </p>
      <div className="s-fila-campos">
        <input className="s-control" aria-label={`NIF de ${proveedor}`} placeholder="NIF" value={escrito} autoComplete="off"
          onChange={(e) => { setEscrito(e.target.value); setFallo(null) }} onBlur={() => setTocado(true)} />
        <Boton onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar en su ficha'}</Boton>
      </div>
      {tocado && falta && <p className="cxf-error" role="status">{falta}</p>}
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="status">{fallo}</p>}
    </BloqueFicha>
  )
}
