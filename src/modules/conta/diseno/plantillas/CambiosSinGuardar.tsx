// src/modules/conta/diseno/plantillas/CambiosSinGuardar.tsx
//
// «Cambios sin guardar», la pieza común de toda ficha que se edita (encargo
// «Ficha de la recibida completa», punto 2; tablero 3b). Es contabilidad y se
// confirma con un botón: nada se guarda solo.
//
//   · <MarcaCambiado>: «CAMBIADO» junto al rótulo del campo y, debajo,
//     «Antes: 19/10/2026 · Deshacer».
//   · <BarraCambios>: la barra fija arriba del formulario, en ámbar:
//     «⚠ 1 cambio sin guardar · Vence: 19/10/2026 → 18/11/2026», con
//     «Descartar» y «Guardar cambios (Ctrl S)». Ctrl/Cmd+S guarda mientras hay
//     cambios. Lo que pasa al guardar se dice en la misma barra (regla 8): el
//     que guarda pasa `mensaje`.
//   · <AvisoSalir>: el aviso al salir con cambios (ver avisoSalir.ts).
//
// El estado (qué ha cambiado, deshacer, descartar, la relectura) es
// useCambiosSinGuardar, en cambios.ts.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Boton } from '../Boton'
import { Icono } from '../Icono'
import { useAvisoSalir, type AvisoSalirControl, type OpcionesAvisoSalir } from './avisoSalir'
import { cuentaCambios, resumenCambios, type CambioCampo } from './cambios'

/**
 * La marca de un campo cambiado. `parte` dice qué trozo pintar, para ponerlo
 * en su sitio: 'etiqueta' (la píldora «Cambiado», junto al rótulo) o 'antes'
 * («Antes: … · Deshacer», debajo del campo). Sin `parte`, los dos seguidos.
 * Sin `cambio`, nada. <CampoFicha cambio alDeshacer> ya lo pone en su sitio.
 */
export function MarcaCambiado({ cambio, onDeshacer, parte }: {
  cambio?: CambioCampo | null
  onDeshacer: () => void
  parte?: 'etiqueta' | 'antes'
}) {
  if (!cambio) return null
  const etiqueta = <span className="s-campo-cambiado">Cambiado</span>
  const antes = (
    <span className="s-campo-antes">
      Antes: <span className="s-cifra">{cambio.antes}</span> · <button type="button" className="s-boton s-boton-enlace s-campo-deshacer"
        aria-label={`Deshacer el cambio de ${cambio.etiqueta}: vuelve a ${cambio.antes}`} onClick={onDeshacer}>Deshacer</button>
    </span>
  )
  if (parte === 'etiqueta') return etiqueta
  if (parte === 'antes') return antes
  return <>{etiqueta} {antes}</>
}

export interface MensajeGuardado {
  tono: 'ok' | 'falta'
  /** Con contenido: «Guardado. El asiento se ha rehecho con 282,39 €», no «Hecho» (regla 8). */
  texto: string
}

/**
 * La barra de arriba del formulario. Con cambios: cuántos y cuáles, y
 * «Descartar» · «Guardar cambios». Sin cambios: el `mensaje` del último
 * guardado, si lo hay (verde o rojo); si no, nada.
 */
export function BarraCambios({ cambios, onDescartar, onGuardar, guardando = false, mensaje }: {
  cambios: readonly CambioCampo[]
  onDescartar: () => void
  onGuardar: () => void
  guardando?: boolean
  mensaje?: MensajeGuardado | null
}) {
  const hay = cambios.length > 0
  const guardar = useRef(onGuardar)
  useEffect(() => { guardar.current = onGuardar }, [onGuardar])
  useEffect(() => {
    if (!hay || guardando) return
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        guardar.current()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [hay, guardando])

  if (!hay) {
    if (!mensaje) return null
    return (
      <div className="s-barra-cambios" data-tono={mensaje.tono} role={mensaje.tono === 'falta' ? 'alert' : 'status'}>
        <Icono nombre={mensaje.tono === 'ok' ? 'ok' : 'aviso'} />
        <span className="s-barra-cambios-texto">{mensaje.texto}</span>
      </div>
    )
  }
  const resumen = resumenCambios(cambios)
  return (
    <section className="s-barra-cambios" data-tono="duda" aria-label="Cambios sin guardar">
      <Icono nombre="aviso" />
      <span className="s-barra-cambios-texto" role="status">
        <strong>{cuentaCambios(cambios.length)}</strong>{resumen && <> · <span className="s-cifra">{resumen}</span></>}
        {mensaje?.tono === 'falta' && <span className="s-barra-cambios-fallo" role="alert"> · {mensaje.texto}</span>}
      </span>
      <span className="s-barra-cambios-acciones">
        <Boton variante="secundario" onClick={onDescartar} disabled={guardando}>Descartar</Boton>
        <Boton variante="principal" onClick={onGuardar} disabled={guardando} tecla="Ctrl S" atajo="Control+S">
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </Boton>
      </span>
    </section>
  )
}

/**
 * El aviso al salir, como componente: pinta «¿Salir sin guardar?» cuando hace
 * falta y, con un ref, da `pedirSalir(accion)` para ‹ ›, Esc… Lo mismo, sin
 * ref, con el hook useAvisoSalir.
 */
export const AvisoSalir = forwardRef<AvisoSalirControl, OpcionesAvisoSalir>(function AvisoSalir(props, ref) {
  const { pedirSalir, aviso } = useAvisoSalir(props)
  useImperativeHandle(ref, () => ({ pedirSalir }), [pedirSalir])
  return <>{aviso}</>
})
