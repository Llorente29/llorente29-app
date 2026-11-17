// src/modules/conta/empresa/ApartadoCorte.tsx
//
// C04 R4 · «Desde cuándo asienta Folvy» en Ajustes › Ejercicio. La fecha de
// corte con el programa anterior se ve siempre; se cambia mientras no haya
// asientos traídos. Con alguno, solo lectura y el porqué: cambiarla dejaría
// lo traído a medias (se deshace lo traído y se vuelve a traer).

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { empezarSinHistorico, fijarCorte, leerCorte, nombrePrograma, type CorteEmpresa } from '@/modules/conta/services/corteService'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { diaAnterior, diaSiguiente } from '@/modules/conta/lib/proponer'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import type { Quien } from '@/modules/conta/empresa/apartados'
import { MARCA } from '../cuenta/marca'

/** 2026-11-01 → 01/11/2026 (N05c: las fechas, como las escribe la gente). */
const dma = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function ApartadoCorte({ quien, movil, alCambiar }: { quien: Quien; movil: boolean; alCambiar: () => void }) {
  const { userName } = useCuentaConta()
  const [confirmar, setConfirmar] = useState(false)
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
  // N05c · El programa como en el N03 («ERP10», «Diez» o «el programa de antes»), nunca «erp10».
  const nombreProg = nombrePrograma(c.programa)
  const elPrograma = nombreProg ?? 'el programa de antes'
  const dePrograma = nombreProg ? `de ${nombreProg}` : 'del programa de antes'
  // N05c · Traído a medias y sin lo anterior: o no se puede contabilizar, o se decidió empezar ya.
  const inicio = c.hasta ? diaSiguiente(c.hasta) : null
  const faltaLoAnterior = !!inicio && !c.historicoTraido
  const empezarYa = () => {
    if (!c.ejercicio || !inicio) return
    let texto = ''
    void h.hacer(async () => {
      texto = await empezarSinHistorico(quien.companyId, c.ejercicio!, userName ?? null)
      setConfirmar(false)
    }, () => texto)
  }
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
      ? `Guardado: hasta el ${fechaLarga(hasta)} lo trae ${prog} (${meses} ${meses === 1 ? 'mes cerrado' : 'meses cerrados'} como traídos); ${MARCA.nombre} asienta desde el ${fechaLarga(desde)} y no propone nada de antes.`
      : `Guardado: sin corte. ${MARCA.nombre} asienta el ejercicio entero.`))
  }

  return (
    <TarjetaApartado titulo={`Desde cuándo asienta ${MARCA.nombre}`} movil={movil}
      accion={!fijo && !editando ? <button type="button" className="cx-enlace" onClick={empezar}>Cambiar</button> : undefined}>
      {!editando && (
        <p style={{ margin: 0 }} data-testid="corte-actual">
          {c.hasta
            ? <>Hasta el <strong>{fechaLarga(c.hasta)}</strong> lo trae {elPrograma}; desde el <strong>{fechaLarga(diaSiguiente(c.hasta))}</strong> asienta {MARCA.nombre}.</>
            : <>Sin fecha de corte: {MARCA.nombre} asienta el ejercicio entero.</>}
        </p>
      )}
      {fijo && (
        <p className="cx-ayuda" data-testid="corte-fijo">
          No se puede cambiar: ya hay {c.traidos.toLocaleString('es-ES')} {c.traidos === 1 ? 'asiento traído' : 'asientos traídos'} {dePrograma}.
          Para moverla, primero se deshace lo traído y se vuelve a traer.
        </p>
      )}
      {!editando && faltaLoAnterior && inicio && (c.sinHistorico
        ? (
          <p className="cx-ayuda" data-testid="sin-historico-decidido">
            Se trabaja sin lo anterior al {dma(inicio)} desde el {dma(new Date(c.sinHistorico.el).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }))}
            {c.sinHistorico.por ? ` (lo decidió ${c.sinHistorico.por})` : ''}. Cuando lo tengas, tráelo.
          </p>
        )
        : (
          <div className="cx-columna" data-testid="sin-historico">
            <p style={{ margin: 0 }}>Lo anterior al {dma(inicio)} es {dePrograma} y todavía no se ha traído. Hasta entonces no se puede contabilizar.</p>
            <div><button type="button" className="cx-boton" onClick={() => { h.limpiar(); setConfirmar(true) }} disabled={h.guardando}>Empezar a trabajar ya</button></div>
          </div>
        ))}
      {confirmar && inicio && (
        <Dialogo titulo="Empezar a trabajar ya" alCerrar={() => setConfirmar(false)} cerrable sinBotonPorDefecto>
          <p style={{ margin: 0 }} data-testid="confirmar-sin-historico">Vas a poder contabilizar desde el {dma(inicio)}. Los saldos y los listados no llevarán lo de antes hasta que lo traigas.</p>
          {h.fallo && <p className="cx-error" role="alert">{h.fallo}</p>}
          <div className="cx-pie cxr-dos-iguales">
            <button type="button" className="cx-boton-sec" onClick={empezarYa} disabled={h.guardando}>{h.guardando ? 'Guardando…' : 'Empezar ya'}</button>
            <button type="button" className="cx-boton-sec" onClick={() => setConfirmar(false)} disabled={h.guardando}>Todavía no</button>
          </div>
        </Dialogo>
      )}
      {editando && (
        <form onSubmit={guardar} className="cx-columna" aria-label="Fecha de corte">
          <label className="cx-campo">
            <span className="cx-etiqueta">¿Desde qué día asienta {MARCA.nombre}?</span>
            <input className="cx-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            <span className="cx-ayuda">Lo de antes lo trae el programa anterior. Vacío: {MARCA.nombre} asienta el ejercicio entero.</span>
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
