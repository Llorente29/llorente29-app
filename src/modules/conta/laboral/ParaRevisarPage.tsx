// src/modules/conta/laboral/ParaRevisarPage.tsx
//
// LS1 (28/10/2026) · Pieza nueva de Laboral en Sumied: «Para revisar» con la
// corrección dentro. Arriba, las peticiones de los trabajadores (aprobar o
// rechazar, con `resolve_clock_correction`, que aplica el cambio auditado y le
// avisa). Debajo, lo mismo que Folvy enseña en Personal (jornadas de más de
// 12 h, entradas sin salida, fuera del radio, desacuerdos), pero «Corregir»
// abre aquí mismo el diálogo en vez de mandar a Control horario.
//
// Corregir nunca borra: añade la salida que falta o cambia la hora de la
// entrada con su motivo (las RPC del registro, que auditan). Cada botón dice
// qué ha hecho o por qué no (regla 8).

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import ParaRevisar from '@/modules/personal/laboral/ParaRevisar'
import { diaMadrid, fechaLarga, horaMadrid } from '@/modules/personal/laboral/calculoJornada'
import type { JornadaParaRevisar } from '@/modules/personal/laboral/registroJornadaServicio'
import {
  addManualClockEntry, editClockEntry, fetchCorrectionRequests, resolveClockCorrection, type ClockCorrectionRequest,
} from '@/services/clockEditService'
import { errorDeCorreccion, isoDeMadrid, textoDePeticion } from './correccion'

type Accion = 'salida' | 'entrada'

function Corregir({ j, nombre, alCerrar, alHacer }: {
  j: JornadaParaRevisar; nombre: string; alCerrar: () => void; alHacer: (texto: string) => void
}) {
  const { userProfile } = useApp()
  const [accion, setAccion] = useState<Accion>('salida')
  const dia0 = diaMadrid(j.entrada)
  const [dia, setDia] = useState(dia0)
  const [hora, setHora] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    const fallo = errorDeCorreccion(accion === 'salida'
      ? { dia, hora, motivo, despuesDe: j.entrada, antesDe: j.salida }
      : { dia, hora, motivo, antesDe: j.salida })
    if (fallo) { setError(fallo); return }
    const iso = isoDeMadrid(dia, hora)
    setEnviando(true); setError('')
    try {
      if (accion === 'salida') await addManualClockEntry(j.employeeId, 'salida', iso, motivo.trim(), userProfile?.displayName ?? undefined)
      else await editClockEntry(j.clockEntryId, iso, motivo.trim(), undefined, userProfile?.displayName ?? undefined)
      alHacer(accion === 'salida'
        ? `Corregido: ${nombre} sale a las ${horaMadrid(iso)} del ${fechaLarga(diaMadrid(iso))}. Queda en su registro con el motivo, y lo verá en su portal.`
        : `Corregido: la entrada de ${nombre} pasa a las ${horaMadrid(iso)} del ${fechaLarga(diaMadrid(iso))}. Queda en su registro con el motivo, y lo verá en su portal.`)
    } catch (e) {
      setError(e instanceof Error ? `No se ha corregido: ${e.message}` : 'No se ha corregido. Vuelve a intentarlo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo={`Corregir la jornada de ${nombre}`} alCerrar={alCerrar}
      explicacion={`Entró a las ${horaMadrid(j.entrada)} del ${fechaLarga(dia0)}${j.salida ? ` y salió a las ${horaMadrid(j.salida)} del ${fechaLarga(diaMadrid(j.salida))}` : ' y no hay salida'}. Nada se borra: la corrección queda en el registro con su motivo.`}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" onClick={guardar} disabled={enviando} data-prueba="corregir-guardar">{enviando ? 'Guardando…' : 'Guardar la corrección'}</Boton>
      </>}>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert" data-prueba="corregir-error">{error}</p>}
      <fieldset className="s-laboral-opciones">
        <legend className="s-campo-etiqueta">Qué falta</legend>
        <label><input type="radio" name="accion" checked={accion === 'salida'} onChange={() => setAccion('salida')} /> {j.salida ? 'Una salida en medio (se le olvidó fichar)' : 'La salida'}</label>
        <label><input type="radio" name="accion" checked={accion === 'entrada'} onChange={() => setAccion('entrada')} /> La entrada está mal: cambiar su hora</label>
      </fieldset>
      <div className="s-laboral-fila">
        <label className="s-campo"><span className="s-campo-etiqueta">Día</span>
          <input className="s-control" type="date" value={dia} onChange={(e) => setDia(e.target.value)} data-prueba="corregir-dia" /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Hora (Madrid)</span>
          <input className="s-control" type="time" value={hora} onChange={(e) => setHora(e.target.value)} data-prueba="corregir-hora" /></label>
      </div>
      <label className="s-campo"><span className="s-campo-etiqueta">Motivo</span>
        <input className="s-control" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="No fichó la salida" data-prueba="corregir-motivo" /></label>
    </Dialogo>
  )
}

function Peticiones({ alHacer, vuelta }: { alHacer: (texto: string) => void; vuelta: number }) {
  const { staff, userProfile } = useApp()
  const [lista, setLista] = useState<ClockCorrectionRequest[] | null>(null)
  const [error, setError] = useState('')
  const [ocupada, setOcupada] = useState<string | null>(null)
  const nombre = useCallback((id: string) => staff.find((e) => e.id === id)?.name ?? 'Persona', [staff])

  useEffect(() => {
    let vivo = true
    fetchCorrectionRequests('pending').then((r) => { if (vivo) setLista(r) })
    return () => { vivo = false }
  }, [vuelta])

  async function resolver(p: ClockCorrectionRequest, aprobar: boolean) {
    setOcupada(p.id); setError('')
    try {
      await resolveClockCorrection(p.id, aprobar, undefined, userProfile?.displayName ?? undefined)
      setLista((l) => l?.filter((x) => x.id !== p.id) ?? null)
      alHacer(aprobar
        ? `Aprobada: ${textoDePeticion(p).toLowerCase()} para ${nombre(p.employeeId)}. Ya está en su registro y se le ha avisado.`
        : `Rechazada la petición de ${nombre(p.employeeId)}. Se le ha avisado; su registro no cambia.`)
    } catch (e) {
      setError(e instanceof Error ? `No se ha resuelto: ${e.message}` : 'No se ha resuelto. Vuelve a intentarlo.')
    } finally {
      setOcupada(null)
    }
  }

  if (!lista) return null
  return (
    <Tarjeta compacta titulo={`Peticiones de corrección · ${lista.length}`}
      apoyo={lista.length === 0 ? 'Nadie ha pedido corregir un fichaje.' : 'Lo que piden los trabajadores desde su portal. Aprobar cambia su registro con el motivo que escribieron.'}>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
      {lista.length > 0 && (
        <div className="l-revisar">
          {lista.map((p) => (
            <div key={p.id} className="l-revisar-fila" data-prueba="peticion">
              <Chip tono="duda">Petición</Chip>
              <div className="l-revisar-texto">
                <b>{nombre(p.employeeId)} · {textoDePeticion(p)}</b>
                <span>Dice: «{p.reason}». Pedida el {fechaLarga(diaMadrid(p.createdAt))} a las {horaMadrid(p.createdAt)}.</span>
              </div>
              <span className="s-laboral-acciones">
                <Boton variante="principal" disabled={ocupada === p.id} onClick={() => resolver(p, true)} data-prueba="peticion-aprobar">Aprobar</Boton>
                <Boton variante="secundario" disabled={ocupada === p.id} onClick={() => resolver(p, false)}>Rechazar</Boton>
              </span>
            </div>
          ))}
        </div>
      )}
    </Tarjeta>
  )
}

export default function ParaRevisarPage() {
  const { staff, refreshStaff } = useApp()
  const [jornada, setJornada] = useState<JornadaParaRevisar | null>(null)
  const [hecho, setHecho] = useState('')
  const [vuelta, setVuelta] = useState(0)

  function hacer(texto: string) {
    setJornada(null)
    setHecho(texto)
    setVuelta((v) => v + 1)
    void refreshStaff().catch(() => undefined)
  }

  return (
    <div className="s-pagina" data-prueba="laboral-para-revisar">
      {hecho && <p className="s-aviso-lista" data-tono="seguro" role="status" data-prueba="revisar-hecho">{hecho}</p>}
      <Peticiones alHacer={hacer} vuelta={vuelta} />
      <ParaRevisar key={vuelta} siempre alCorregir={setJornada} />
      {jornada && (
        <Corregir j={jornada} nombre={staff.find((e) => e.id === jornada.employeeId)?.name ?? jornada.nombre}
          alCerrar={() => setJornada(null)} alHacer={hacer} />
      )}
    </div>
  )
}
