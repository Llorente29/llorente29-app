// src/modules/conta/laboral/ficha/tiempo/TiempoPestana.tsx
//
// N1 · PR 3 (02/11/2026) · «Tiempo y turnos» en la ficha nueva, fiel a las
// maquetas 10 (ordenador) y 10b (móvil). Lee lo que ya existe, sin tocar la
// base: las marcas del registro de jornada (informe_registro_jornada), el
// cuadrante publicado de su local, sus firmas del mes y la bolsa de horas. Lo
// que no está, sale como «Falta» o «Pendiente · …» (N1·8): nunca un número
// inventado.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { Boton, BotonEnlace, Chip, Tarjeta } from '@/modules/conta/diseno'
import { CONTA, rutaConta } from '@/config/navegacion'
import { diaMadrid, horasYMinutos, type MarcaJornada } from '@/modules/personal/laboral/calculoJornada'
import { armarInforme, type DatosInforme } from '@/modules/personal/laboral/informeJornada'
import { descargar, nombreDeFichero, pdfDelInforme } from '@/modules/personal/laboral/informePdf'
import { firmasDe, leerInforme, pideFirmaDelMes, type FirmaDelMes } from '@/modules/personal/laboral/registroJornadaServicio'
import { getSchedule, listShiftTemplatesByIds } from '@/services/schedulerService'
import { getEffectiveCloseDay, getEmployeeBalanceState, type EmployeeBalanceStateExtended } from '@/services/hoursBalanceService'
import type { Ficha } from '../fichaService'
import {
  avisoSinSalida, filasDeLaSemana, lunesConDesplazamiento, mesConAnio, minutosPorMes, resumenDelMes, textoBolsa, textoSemana,
  turnosDeLaSemana, ultimosMeses, type TurnoDelDia,
} from './tiempoTextos'

const aMarcas = (d: DatosInforme | null): MarcaJornada[] =>
  (d?.marcas ?? []).map((m) => ({ id: m.id, tipo: m.tipo, hora: m.hora, anulada: m.anulada }))

export default function TiempoPestana({ ficha }: { ficha: Ficha }) {
  const p = ficha.persona
  const { staff, locations, activeAccountId } = useApp()
  const ahora = useMemo(() => new Date(), [])
  const hoy = diaMadrid(ahora.toISOString())
  const meses = ultimosMeses(hoy, 3)
  const [semana, setSemana] = useState(0)
  const lunes = lunesConDesplazamiento(hoy, semana)
  const desde = [`${meses[2]}-01`, lunes].sort()[0]

  const [informe, setInforme] = useState<DatosInforme | null>(null)
  const [errorInforme, setErrorInforme] = useState('')
  const [turnos, setTurnos] = useState<Record<string, TurnoDelDia[]> | null | undefined>(undefined)
  const [firmas, setFirmas] = useState<FirmaDelMes[] | null>(null)
  const [pideFirma, setPideFirma] = useState<boolean | null>(null)
  const [bolsa, setBolsa] = useState<EmployeeBalanceStateExtended | null | undefined>(undefined)
  const [descargando, setDescargando] = useState(false)

  useEffect(() => {
    let vivo = true
    leerInforme(p.id, desde, hoy)
      .then((d) => { if (vivo) { setInforme(d); setErrorInforme('') } })
      .catch((e: unknown) => { if (vivo) setErrorInforme(e instanceof Error ? e.message : 'No se ha podido leer su registro de jornada.') })
    return () => { vivo = false }
  }, [p.id, desde, hoy])

  useEffect(() => {
    let vivo = true
    const local = p.local?.id
    if (!local) return
    getSchedule(local, lunes).then(async (c) => {
      const ids = Object.keys(c?.cells ?? {})
      const plantillas = await listShiftTemplatesByIds(ids)
      if (vivo) setTurnos(turnosDeLaSemana(c, plantillas, p.id))
    }).catch(() => { if (vivo) setTurnos(null) })
    return () => { vivo = false }
  }, [p.id, p.local?.id, lunes])

  useEffect(() => {
    let vivo = true
    firmasDe(p.id).then((f) => { if (vivo) setFirmas(f) }).catch(() => { if (vivo) setFirmas([]) })
    if (activeAccountId) pideFirmaDelMes(activeAccountId).then((x) => { if (vivo) setPideFirma(x) }).catch(() => { if (vivo) setPideFirma(null) })
    return () => { vivo = false }
  }, [p.id, activeAccountId])

  const empleado = staff.find((e) => e.id === p.id)
  const local = locations.find((l) => l.id === empleado?.locationId)
  useEffect(() => {
    let vivo = true
    if (!empleado || !local) return
    const cierre = getEffectiveCloseDay({ closeDay: local.hoursBalanceCloseDay ?? 25, syncWithGestoria: false, gestoriaDay: undefined })
    getEmployeeBalanceState(empleado, cierre).then((s) => { if (vivo) setBolsa(s) }).catch(() => { if (vivo) setBolsa(null) })
    return () => { vivo = false }
  }, [empleado, local])

  const marcas = aMarcas(informe)
  const mes = resumenDelMes(marcas, hoy, ahora)
  const filas = filasDeLaSemana(lunes, marcas, turnos ?? null, ahora)
  const porMes = minutosPorMes(marcas, meses, ahora)
  const ultimoSinSalida = mes.sinSalida[mes.sinSalida.length - 1]
  const turnosDelSinSalida = ultimoSinSalida && turnos ? turnos[ultimoSinSalida] : null
  const mesAnterior = meses[1]
  const firmaDe = (m: string) => firmas?.find((f) => f.mes.slice(0, 7) === m && !f.invalidadaAt)
  const contrato = ficha.contrato
  const horasSemana = contrato?.horas_semana ?? informe?.persona.horas_semana ?? null

  async function pdf() {
    if (!informe) return
    setDescargando(true)
    try {
      const desdeMes = `${hoy.slice(0, 7)}-01`
      const datos = await leerInforme(p.id, desdeMes, hoy)
      descargar(pdfDelInforme(armarInforme(datos), datos.generado_at), nombreDeFichero(p.nombre, desdeMes, hoy, 'pdf'))
    } finally { setDescargando(false) }
  }

  const chipFirma = (m: string) => {
    const f = firmaDe(m)
    if (f) return <Chip tono="seguro">Firmado el {f.firmadoAt.slice(8, 10)}/{f.firmadoAt.slice(5, 7)}</Chip>
    if (pideFirma === false) return <Chip tono="neutro">No se pide firma</Chip>
    return <Chip tono="duda">Sin firmar</Chip>
  }

  if (errorInforme) {
    return <Tarjeta titulo="No se ha podido leer su tiempo" tono="falta"><p className="s-apoyo" role="alert">{errorInforme}</p></Tarjeta>
  }

  return (
    <div className="s-tiempo" data-prueba="ficha-tiempo">
      <div className="s-tiempo-acciones">
        <Boton variante="secundario" onClick={() => void pdf()} disabled={!informe || descargando} data-prueba="tiempo-pdf">
          {descargando ? 'Preparando…' : 'Descargar su registro de jornada (PDF)'}</Boton>
      </div>

      {ultimoSinSalida && (
        <div className="s-aviso-lista s-tiempo-aviso" data-tono="duda" data-prueba="tiempo-aviso">
          <span><strong>{avisoSinSalida(ultimoSinSalida, turnosDelSinSalida)}</strong> Corrígelo para que su registro de jornada cuadre.</span>
          <BotonEnlace variante="secundario" a={rutaConta(CONTA.rutas.laboralPagina, { pagina: 'para-revisar' })}>Corregir la salida</BotonEnlace>
        </div>
      )}

      <div className="s-tiempo-cifras">
        <section className="s-tarjeta s-tiempo-cifra" data-prueba="tiempo-mes">
          <span className="s-tiempo-e">Trabajadas en {mesConAnio(meses[0]).split(' ')[0].toLowerCase()}</span>
          <span className="s-tiempo-v">{informe ? horasYMinutos(mes.minutosTrabajados) || '0' : '…'}</span>
          <span className="s-tiempo-s">fichadas hasta hoy</span>
        </section>
        <section className="s-tarjeta s-tiempo-cifra" data-prueba="tiempo-bolsa">
          <span className="s-tiempo-e">Bolsa de horas</span>
          {bolsa ? <>
            <span className="s-tiempo-v">{textoBolsa(bolsa.currentPeriod.delta)}</span>
            <span className="s-tiempo-s">{bolsa.currentPeriod.delta > 0 ? 'horas de más, a compensar con descanso' : bolsa.currentPeriod.delta < 0 ? 'horas que debe' : 'al día'} · {bolsa.currentPeriod.periodLabel}</span>
          </> : bolsa === null || !empleado || !local
            ? <><span className="s-tiempo-v s-persona-falta">Falta</span><span className="s-tiempo-s">{!local ? 'no tiene local' : 'no se ha podido calcular'}</span></>
            : <span className="s-tiempo-v">…</span>}
        </section>
        <section className="s-tarjeta s-tiempo-cifra" data-tono={mes.sinSalida.length > 0 ? 'duda' : undefined} data-prueba="tiempo-corregir">
          <span className="s-tiempo-e">Fichajes por corregir</span>
          <span className="s-tiempo-v">{informe ? mes.sinSalida.length : '…'}</span>
          <span className="s-tiempo-s">{mes.sinSalida.length === 0 ? 'ninguno este mes' : mes.sinSalida.length === 1 ? 'sin salida' : 'días sin salida'}</span>
        </section>
        <section className="s-tarjeta s-tiempo-cifra" data-prueba="tiempo-firma">
          <span className="s-tiempo-e">Registro de {mesConAnio(mesAnterior).split(' ')[0].toLowerCase()}</span>
          <span className="s-tiempo-v s-tiempo-v-texto">{firmas === null ? '…' : firmaDe(mesAnterior) ? 'Firmado' : pideFirma === false ? 'No se pide firma' : 'Sin firmar'}</span>
          <span className="s-tiempo-s">{pideFirma === false ? 'la firma del mes está apagada en Ajustes' : 'se pide en su portal el día 1'}</span>
        </section>
      </div>

      <Tarjeta titulo={`Esta semana · ${textoSemana(lunes)}`}
        accion={<span className="s-tiempo-flechas">
          <button type="button" className="s-persona-enlace" onClick={() => setSemana((s) => s - 1)} data-prueba="tiempo-anterior">‹ Anterior</button>
          <button type="button" className="s-persona-enlace" onClick={() => setSemana((s) => s + 1)} disabled={semana >= 0}>Siguiente ›</button>
        </span>}>
        <div className="s-tiempo-semana" data-prueba="tiempo-semana">
          <div className="s-tiempo-cab" />
          {filas.map((f) => <div key={f.dia} className="s-tiempo-cab">{f.diaTexto}</div>)}
          <div className="s-tiempo-lado">Su turno</div>
          {filas.map((f) => <div key={f.dia}>{f.turnos === null ? <span className="s-tiempo-libre">—</span> : f.turnos.length === 0 ? <span className="s-tiempo-libre">Libre</span> : f.turnos.map((t, i) => <span key={i} className="s-tiempo-turno">{t.inicio}–{t.fin}</span>)}</div>)}
          <div className="s-tiempo-lado">Lo que fichó</div>
          {filas.map((f) => <div key={f.dia} className={f.sinSalida ? 's-tiempo-mal' : f.fichado === '—' ? 's-tiempo-libre' : undefined}>{f.fichado}</div>)}
          <div className="s-tiempo-lado">Horas</div>
          {filas.map((f) => <div key={f.dia} className={f.sinSalida ? 's-tiempo-mal' : f.horas === '—' ? 's-tiempo-libre' : undefined}>{f.horas}</div>)}
        </div>
        <ul className="s-tiempo-lista" data-prueba="tiempo-semana-movil">
          {filas.map((f) => (
            <li key={f.dia}>
              <span className="s-tiempo-d">{f.diaTexto}<small>{f.turnos === null ? '—' : f.turnos.length === 0 ? 'Libre' : f.turnos.map((t) => `${t.inicio.replace(/:00$/, '')}–${t.fin.replace(/:00$/, '')}`).join(' · ')}</small></span>
              <span className={f.sinSalida ? 's-tiempo-mal' : f.fichado === '—' ? 's-tiempo-libre' : undefined}>{f.fichado}</span>
              <span className={f.sinSalida ? 's-tiempo-mal' : undefined}>{f.horas === '—' ? '' : f.horas}</span>
            </li>
          ))}
        </ul>
        <p className="s-persona-nota">
          {turnos === null ? 'El cuadrante de esta semana no está publicado: el turno sale cuando se publique. '
            : !p.local ? 'Sin local en su ficha: no hay cuadrante del que sacar el turno. '
            : `El turno sale del cuadrante de ${p.local.nombre}. `}
          Lo fichado, de su móvil o de la tablet del local, con la hora del servidor.
        </p>
      </Tarjeta>

      <div className="s-tiempo-dos">
        <Tarjeta titulo="Su jornada">
          <dl className="s-persona-datos s-persona-datos-anchos">
            <div className="s-persona-dato"><dt>Por contrato</dt><dd>{horasSemana ? `${horasSemana} horas a la semana` : <span className="s-persona-falta">Falta</span>}{contrato?.jornada === 'completa' ? ' · a jornada completa' : contrato?.jornada === 'parcial' ? ' · a tiempo parcial' : ''}</dd></div>
            <div className="s-persona-dato"><dt>Al año, según convenio</dt><dd>{contrato?.convenio?.horas_anuales ? `${Number(contrato.convenio.horas_anuales).toLocaleString('es-ES')} horas` : <span className="s-persona-falta">Falta</span>}</dd></div>
            <div className="s-persona-dato"><dt>Horario</dt><dd>{p.local ? <>Sale del cuadrante de {p.local.nombre}. <Link className="s-persona-enlace" to={rutaConta(CONTA.rutas.laboralPagina, { pagina: 'calendario' })}>Ver sus turnos</Link></> : <span className="s-persona-falta">Falta: no tiene local</span>}</dd></div>
            <div className="s-persona-dato"><dt>Descanso</dt><dd><span className="s-persona-falta">Falta</span> <small className="s-persona-oficial">el convenio cargado no lo trae</small></dd></div>
          </dl>
        </Tarjeta>
        <Tarjeta titulo="Sus registros de jornada">
          <table className="s-tabla s-tiempo-registros" data-prueba="tiempo-registros">
            <thead><tr><th>Mes</th><th className="s-num">Horas</th><th>Firma</th></tr></thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m}><td>{mesConAnio(m)}</td><td className="s-num">{informe ? horasYMinutos(porMes[m]) || '0' : '…'}</td><td>{m === meses[0] ? <Chip tono="neutro">Mes en curso</Chip> : chipFirma(m)}</td></tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      </div>
    </div>
  )
}
