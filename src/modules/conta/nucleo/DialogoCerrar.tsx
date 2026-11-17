// src/modules/conta/nucleo/DialogoCerrar.tsx
//
// K03 · El aspa de una pestaña con cambios sin guardar pregunta antes (encargo
// K03). Es el Dialogo del sistema de siempre (foco atrapado, Esc y el fondo
// hacen «Seguir aquí»), con las palabras del encargo: «Tienes cambios sin
// guardar en …», «Guardar y cerrar», «Cerrar sin guardar», «Seguir aquí».
// Guardar y cerrar solo cierra si guarda; si no, dice por qué y se queda
// (regla 8).

import { useState } from 'react'
import { Dialogo } from '@/modules/conta/diseno/Dialogo'
import { Boton } from '@/modules/conta/diseno/Boton'
import { resumenCambios } from '@/modules/conta/diseno/plantillas/cambios'
import type { CambiosDePestana } from '@/modules/conta/diseno/plantillas/pestana'

export function DialogoCerrar({ nombre, c, alCerrar, alSeguir }: {
  nombre: string
  c: CambiosDePestana
  /** Cierra la pestaña (ya guardada o descartada). */
  alCerrar: () => void
  alSeguir: () => void
}) {
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const guardarYCerrar = async () => {
    setGuardando(true); setFallo(null)
    let r: boolean | string
    try { r = await c.onGuardar() } catch (e) { r = e instanceof Error ? e.message : String(e) }
    setGuardando(false)
    if (r === true) { alCerrar(); return }
    setFallo(typeof r === 'string' && r ? r : 'no se ha podido guardar')
  }
  return (
    <Dialogo titulo={`Tienes cambios sin guardar en ${c.donde ?? nombre}`} alCerrar={alSeguir}
      explicacion={`Si cierras ahora: ${resumenCambios(c.cambios)}.`}
      acciones={<>
        <Boton variante="enlace" className="s-boton-perder" onClick={() => { c.onDescartar?.(); alCerrar() }} disabled={guardando}>Cerrar sin guardar</Boton>
        <Boton variante="secundario" onClick={alSeguir} data-autofocus="">Seguir aquí</Boton>
        <Boton variante="principal" onClick={() => { void guardarYCerrar() }} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y cerrar'}</Boton>
      </>}>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha guardado: {fallo}. La pestaña sigue abierta, con tus cambios.</p>}
    </Dialogo>
  )
}
