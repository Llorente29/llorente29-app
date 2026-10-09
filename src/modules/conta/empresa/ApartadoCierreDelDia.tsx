// src/modules/conta/empresa/ApartadoCierreDelDia.tsx
//
// Cierre del día · «Hora de cierre del día» en Ajustes › Ejercicio. A esa
// hora (de Madrid) se dan por terminadas las ventas del día anterior; un
// pedido que siga abierto se cierra como no confirmado. 6:00 de serie.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { horaParaLeer, HORA_DE_CIERRE_DE_SERIE } from '@/modules/conta/lib/cierreDelDia'
import { guardarHoraDeCierre, horaDeCierre } from '@/modules/conta/services/diarioService'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function ApartadoCierreDelDia({ quien, movil }: { quien: Quien; movil: boolean }) {
  const [hora, setHora] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  const h = useHacer(recargar)
  const [editando, setEditando] = useState(false)
  const [nueva, setNueva] = useState('')

  useEffect(() => {
    let vivo = true
    horaDeCierre(quien.accountId, quien.companyId).then((x) => { if (vivo) { setHora(x); setError(null) } }, (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [quien.accountId, quien.companyId, vuelta])

  if (error) return <ErrorConReintento mensaje={error} reintentar={recargar} />
  if (!hora) return <TarjetaCargando />

  const guardar = (ev: FormEvent) => {
    ev.preventDefault()
    let guardada = ''
    void h.hacer(async () => {
      guardada = await guardarHoraDeCierre(quien.accountId, quien.companyId, nueva)
      setEditando(false)
    }, () => `Guardado: cada día se cierra a las ${horaParaLeer(guardada)} del día siguiente. Lo que siga abierto a esa hora se cierra como no confirmado.`)
  }

  return (
    <TarjetaApartado titulo="Hora de cierre del día" movil={movil}
      accion={!editando ? <button type="button" className="cx-enlace" onClick={() => { setNueva(hora); setEditando(true); h.limpiar() }}>Cambiar</button> : undefined}>
      {!editando && (
        <p style={{ margin: 0 }}>
          {/* En el móvil la tarjeta no pinta su título: que el valor no se quede sin decir qué es. */}
          {movil && 'Hora de cierre del día: '}
          <span data-testid="hora-cierre"><strong>{horaParaLeer(hora)}</strong>{hora === HORA_DE_CIERRE_DE_SERIE ? ' (la de serie)' : ''}</span>
        </p>
      )}
      <p className="cx-ayuda">A esa hora se dan por terminadas las ventas del día anterior. Un pedido que siga abierto se cierra como no confirmado.</p>
      {editando && (
        <form onSubmit={guardar} className="cx-columna" aria-label="Hora de cierre del día">
          <label className="cx-campo">
            <span className="cx-etiqueta">Hora de cierre del día</span>
            <input className="cx-input" type="time" value={nueva} onChange={(e) => setNueva(e.target.value)} required />
          </label>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setEditando(false)} disabled={h.guardando}>Cancelar</button>
            <button type="submit" className="cx-boton" disabled={h.guardando}>{h.guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
