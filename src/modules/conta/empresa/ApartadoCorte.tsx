// src/modules/conta/empresa/ApartadoCorte.tsx
//
// C04 R4 · «Desde cuándo asienta Folvy» en Ajustes › Ejercicio. La fecha de
// corte con el programa anterior se ve siempre; se cambia mientras no haya
// asientos traídos. Con alguno, solo lectura y el porqué: cambiarla dejaría
// lo traído a medias (se deshace lo traído y se vuelve a traer).

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { fijarCorte, leerCorte, type CorteEmpresa } from '@/modules/conta/services/corteService'
import { diaAnterior, diaSiguiente } from '@/modules/conta/lib/proponer'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import type { Quien } from '@/modules/conta/empresa/apartados'

export function ApartadoCorte({ quien, movil, alCambiar }: { quien: Quien; movil: boolean; alCambiar: () => void }) {
  const [c, setC] = useState<CorteEmpresa | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => { setVuelta((v) => v + 1); alCambiar() }, [alCambiar])
  const h = useHacer(recargar)
  const [editando, setEditando] = useState(false)
  const [desde, setDesde] = useState('')
  const [programa, setPrograma] = useState('')

  useEffect(() => {
    let vivo = true
    leerCorte(quien.accountId, quien.companyId).then((x) => { if (vivo) { setC(x); setError(null) } }, (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [quien.accountId, quien.companyId, vuelta])

  if (error) return <ErrorConReintento mensaje={error} reintentar={() => setVuelta((v) => v + 1)} />
  if (!c) return <TarjetaCargando />

  const fijo = c.traidos > 0
  const empezar = () => { setDesde(c.hasta ? diaSiguiente(c.hasta) : ''); setPrograma(c.programa ?? ''); setEditando(true); h.limpiar() }
  const guardar = (ev: FormEvent) => {
    ev.preventDefault()
    const hasta = desde ? diaAnterior(desde) : null
    const prog = programa.trim() || 'el programa anterior'
    let meses = 0
    void h.hacer(async () => {
      meses = await fijarCorte(quien.companyId, hasta, prog)
      setEditando(false)
    }, () => (hasta
      ? `Guardado: hasta el ${fechaLarga(hasta)} lo trae ${prog} (${meses} ${meses === 1 ? 'mes cerrado' : 'meses cerrados'} como traídos); Folvy asienta desde el ${fechaLarga(desde)} y no propone nada de antes.`
      : 'Guardado: sin corte. Folvy asienta el ejercicio entero.'))
  }

  return (
    <TarjetaApartado titulo="Desde cuándo asienta Folvy" movil={movil}
      accion={!fijo && !editando ? <button type="button" className="cx-enlace" onClick={empezar}>Cambiar</button> : undefined}>
      {!editando && (
        <p style={{ margin: 0 }} data-testid="corte-actual">
          {c.hasta
            ? <>Hasta el <strong>{fechaLarga(c.hasta)}</strong> lo trae {c.programa ?? 'el programa anterior'}; desde el <strong>{fechaLarga(diaSiguiente(c.hasta))}</strong> asienta Folvy.</>
            : <>Sin fecha de corte: Folvy asienta el ejercicio entero.</>}
        </p>
      )}
      {fijo && (
        <p className="cx-ayuda" data-testid="corte-fijo">
          No se puede cambiar: ya hay {c.traidos.toLocaleString('es-ES')} {c.traidos === 1 ? 'asiento traído' : 'asientos traídos'} de {c.programa ?? 'el programa anterior'}.
          Para moverla, primero se deshace lo traído y se vuelve a traer.
        </p>
      )}
      {editando && (
        <form onSubmit={guardar} className="cx-columna" aria-label="Fecha de corte">
          <label className="cx-campo">
            <span className="cx-etiqueta">¿Desde qué día asienta Folvy?</span>
            <input className="cx-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            <span className="cx-ayuda">Lo de antes lo trae el programa anterior. Vacío: Folvy asienta el ejercicio entero.</span>
          </label>
          <label className="cx-campo">
            <span className="cx-etiqueta">¿Con qué programa lo llevabais antes?</span>
            <input className="cx-input" value={programa} onChange={(e) => setPrograma(e.target.value)} placeholder="Diez, A3, Sage…" />
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
