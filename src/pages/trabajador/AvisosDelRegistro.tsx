// src/pages/trabajador/AvisosDelRegistro.tsx
//
// L1a · PR 2 (28/10/2026). Lo que el registro de jornada le pide a la persona,
// en su portal, arriba (tablero 6 de la maqueta):
//   · cada corrección que hizo otro en sus fichajes, como una tarjeta: «Tu
//     encargado añadió tu salida del 12/10 a las 17:00 · ¿Es correcto?» con
//     [Sí] y [No es así]. Un toque; si no está de acuerdo, así sale en el
//     informe para la Inspección;
//   · la firma del mes que acabó: revisa los días y firma. Si después se
//     corrige un fichaje de ese mes, se vuelve a pedir.
// Cada toque dice lo que ha hecho (regla 8).
//
// L1a-H (29/10/2026): la firma del mes sale SOLO si la empresa la pide
// (accounts.firma_registro_mes, el interruptor de Laboral › Registro de
// jornada; apagado por defecto). Si no se puede saber, no se pide. Las
// correcciones del encargado salen siempre, como antes.

import { useEffect, useState } from 'react'
import { Boton, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import type { Employee } from '../../types'
import {
  correccionesPorResponder, firmarMes, firmasDe, leerInforme, pideFirmaDelMes, responderCorreccion, type CorreccionPendiente,
} from '@/modules/personal/laboral/registroJornadaServicio'
import { armarInforme, mesYAnio, type InformeJornada } from '@/modules/personal/laboral/informeJornada'
import { diaMadrid, fechaYHora, horaMadrid } from '@/modules/personal/laboral/calculoJornada'
import { PIEZA_LABORAL } from '@/modules/personal/laboral/estilo'
import { mesAnterior } from '@/modules/personal/laboral/firmaDelMes'

const TIPO: Record<string, string> = { entrada: 'entrada', salida: 'salida', pausa_inicio: 'pausa', pausa_fin: 'vuelta de la pausa' }
const diaMes = (iso: string) => { const d = diaMadrid(iso); return `${d.slice(8, 10)}/${d.slice(5, 7)}` }

/** La frase de una corrección, para la persona. */
function fraseCorreccion(c: CorreccionPendiente): string {
  const tipo = TIPO[c.tipo ?? ''] ?? 'marca'
  const hora = c.horaDespues ?? c.horaAntes
  const del = hora ? `del ${diaMes(hora)}` : ''
  switch (c.accion) {
    case 'create_manual': return `Tu encargado añadió tu ${tipo} ${del} a las ${hora ? horaMadrid(hora) : '—'}`
    case 'edit': return `Tu encargado cambió tu ${tipo} ${del}: de las ${c.horaAntes ? horaMadrid(c.horaAntes) : '—'} a las ${c.horaDespues ? horaMadrid(c.horaDespues) : '—'}`
    case 'void': return `Tu encargado anuló tu ${tipo} ${del} de las ${c.horaAntes ? horaMadrid(c.horaAntes) : '—'}`
    default: return `Tu encargado recuperó tu ${tipo} ${del} de las ${hora ? horaMadrid(hora) : '—'}`
  }
}

function TarjetaCorreccion({ c }: { c: CorreccionPendiente }) {
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function responder(conforme: boolean) {
    setEnviando(true); setError('')
    try {
      await responderCorreccion(c.id, conforme)
      setHecho(conforme
        ? 'Hecho: has dicho que es correcto.'
        : 'Hecho: has dicho que no es así. Tu encargado lo verá, y así sale en tu registro de jornada.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div data-prueba="correccion-del-encargado">
      <Tarjeta tono={hecho ? 'ok' : 'duda'} nivel={3}
        titulo={`${fraseCorreccion(c)} · ¿Es correcto?`}
        apoyo={`Lo puso ${c.quien || 'tu encargado'} el ${fechaYHora(c.cuando)}${c.motivo ? ` · motivo: «${c.motivo}»` : ''}.`}>
        {hecho ? <p className="l-hecho" role="status">{hecho}</p> : (
          <div className="l-portal-botones">
            <Boton variante="principal" disabled={enviando} onClick={() => { void responder(true) }}>Sí</Boton>
            <Boton disabled={enviando} onClick={() => { void responder(false) }}>No es así</Boton>
          </div>
        )}
        {error && <p className="l-error">{error}</p>}
      </Tarjeta>
    </div>
  )
}

function TarjetaFirma({ employee }: { employee: Employee }) {
  const hoy = diaMadrid(new Date().toISOString())
  const mes = mesAnterior(hoy)
  const [estado, setEstado] = useState<'nada' | 'firmar' | 'volver'>('nada')
  const [informe, setInforme] = useState<InformeJornada | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const [firmas, datos] = await Promise.all([
          firmasDe(employee.id),
          leerInforme(employee.id, `${mes}-01`, `${mes}-${String(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`),
        ])
        if (!vivo) return
        const delMes = firmas.filter(f => f.mes === `${mes}-01`)
        if (delMes.some(f => !f.invalidadaAt)) { setEstado('nada'); return }
        if (datos.marcas.filter(m => !m.anulada).length === 0) { setEstado('nada'); return }
        setInforme(armarInforme(datos))
        setEstado(delMes.length > 0 ? 'volver' : 'firmar')
      } catch {
        // Sin la base de la 0705 (o sin red), no se pide nada: no es un fallo que enseñar aquí.
        if (vivo) setEstado('nada')
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [employee.id, mes])

  if (estado === 'nada' && !hecho) return null
  const nombreMes = mesYAnio(`${mes}-01`).split(' de ')[0]
  const parcial = /parcial/i.test(employee.contractType ?? '') || (employee.weeklyHours > 0 && employee.weeklyHours < 40)

  async function firmar() {
    if (!informe) return
    setError('')
    try {
      const r = await firmarMes(employee.id, `${mes}-01`, {
        total: informe.totales.total, ordinarias: informe.totales.ordinarias, extra: informe.totales.extra,
        dias: informe.totalesCrudos.diasTrabajados,
      })
      setAbierto(false)
      setEstado('nada')
      setHecho(`Firmado el ${fechaYHora(r.firmadoAt)}. Si se corrige algún fichaje de ${nombreMes}, te lo pediremos otra vez.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (hecho) {
    return <div data-prueba="firma-del-mes"><Tarjeta tono="ok" nivel={3} titulo={`Tu registro de ${nombreMes}`}><p className="l-hecho" role="status">{hecho}</p></Tarjeta></div>
  }
  return (
    <div data-prueba="firma-del-mes">
      <Tarjeta tono="duda" nivel={3}
        titulo={estado === 'volver'
          ? `Se corrigió un fichaje de ${nombreMes} después de que lo firmaras: vuelve a firmarlo`
          : `Firma tu registro de ${nombreMes} · ${informe?.totales.total ?? ''} en ${informe?.totalesCrudos.diasTrabajados ?? 0} días`}
        apoyo={parcial ? 'Con contrato a tiempo parcial es obligatorio firmarlo cada mes.' : 'Así queda claro qué horas hiciste. Revisa los días antes de firmar.'}>
        <div className="l-portal-botones">
          <Boton variante="principal" onClick={() => setAbierto(true)}>Revisar y firmar</Boton>
        </div>
      </Tarjeta>
      {abierto && informe && (
        <Dialogo titulo={`Tu registro de ${nombreMes}`}
          explicacion={`${informe.totales.total} en ${informe.totalesCrudos.diasTrabajados} días · ordinarias ${informe.totales.ordinarias} · extra ${informe.totales.extra}. Si algo no está bien, no firmes y pide la corrección desde «Mis fichajes».`}
          alCerrar={() => setAbierto(false)}
          acciones={<>
            <Boton onClick={() => setAbierto(false)}>Ahora no</Boton>
            <Boton variante="principal" onClick={() => { void firmar() }} data-autofocus>{`Firmar ${nombreMes}`}</Boton>
          </>}>
          <ul className="l-registro">
            {informe.filas.filter(f => f.tramos.length > 0).map(f => (
              <li key={f.dia}>{f.diaTexto}: {f.tramos.map(t => `${t.entrada}–${t.salida}`).join(' y ')} · {f.total}{f.corregido ? ' · corregido después' : ''}</li>
            ))}
          </ul>
          {error && <p className="l-error">{error}</p>}
        </Dialogo>
      )}
    </div>
  )
}

export default function AvisosDelRegistro({ employee, accountId }: { employee: Employee; accountId: string | null | undefined }) {
  const [correcciones, setCorrecciones] = useState<CorreccionPendiente[]>([])
  const [pideFirma, setPideFirma] = useState(false)
  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const v = accountId ? await pideFirmaDelMes(accountId) : false
        if (vivo) setPideFirma(v)
      } catch {
        // Sin saberlo (sin la 1135 o sin red), no se pide: apagado.
        if (vivo) setPideFirma(false)
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [accountId])
  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const l = await correccionesPorResponder(employee.id)
        if (vivo) setCorrecciones(l)
      } catch {
        if (vivo) setCorrecciones([])
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [employee.id])

  return (
    <div className={`${PIEZA_LABORAL} l-portal px-4 pt-3 max-w-md mx-auto`}>
      {correcciones.map(c => <TarjetaCorreccion key={c.id} c={c} />)}
      {pideFirma && <TarjetaFirma employee={employee} />}
    </div>
  )
}
