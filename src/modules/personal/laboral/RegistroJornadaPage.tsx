// src/modules/personal/laboral/RegistroJornadaPage.tsx
//
// L1a · PR 2 (28/10/2026). Personal › Registro de jornada: el informe para la
// Inspección de una persona y un mes (tablero 5). Se elige quién y qué mes, y
// sale día a día; se baja en PDF o en hoja de cálculo, y el administrador
// crea un enlace de solo lectura para la Inspección que caduca solo. Cada
// botón dice lo que ha hecho (regla 8). Llega con ?persona=<id>&mes=AAAA-MM
// desde «Para revisar».
//
// L1a-H (29/10/2026): arriba, el interruptor de la empresa «Pedir a cada
// persona que firme su registro del mes» (apagado por defecto). Lo cambia el
// administrador y la pantalla dice qué ha hecho (regla 8); los demás lo ven.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { Boton, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import InformeJornadaVista from './InformeJornadaVista'
import { armarInforme, hojaDeCalculo, periodoDelMes, textoPeriodo, type DatosInforme } from './informeJornada'
import { diaMadrid, fechaYHora } from './calculoJornada'
import { descargar, nombreDeFichero, pdfDelInforme } from './informePdf'
import { crearEnlace, leerInforme, pedirFirmaDelMes, pideFirmaDelMes, retirarEnlace, type EnlaceInspeccion } from './registroJornadaServicio'
import { APOYO_INTERRUPTOR, TITULO_INTERRUPTOR, fraseDelCambio } from './firmaDelMes'
import { ordenarPersonas, personaPorDefecto } from './personas'
import { RAIZ_LABORAL } from './estilo'

/** «Pedir a cada persona que firme su registro del mes», de la empresa. */
function FirmaDelMesInterruptor({ accountId, esAdmin, hoy }: { accountId: string; esAdmin: boolean; hoy: string }) {
  const [pide, setPide] = useState<boolean | null>(null)
  const [cambiando, setCambiando] = useState(false)
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const v = await pideFirmaDelMes(accountId)
        if (vivo) setPide(v)
      } catch (e) {
        if (vivo) { setPide(null); setError(e instanceof Error ? e.message : String(e)) }
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [accountId])

  async function cambiar(pedir: boolean) {
    setCambiando(true); setError(''); setHecho('')
    try {
      const r = await pedirFirmaDelMes(accountId, pedir)
      setPide(r.pedir)
      setHecho(fraseDelCambio(r.pedir, r.personas, hoy))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCambiando(false)
    }
  }

  const on = pide === true
  return (
    <div data-prueba="firma-interruptor">
      <Tarjeta nivel={3} titulo={TITULO_INTERRUPTOR} apoyo={APOYO_INTERRUPTOR}
        accion={
          <button type="button" role="switch" aria-checked={on} aria-label={TITULO_INTERRUPTOR}
            className="l-interruptor" data-on={on || undefined} data-prueba="firma-interruptor-boton"
            disabled={!esAdmin || pide === null || cambiando} onClick={() => { void cambiar(!on) }}>
            <span className="l-interruptor-bola" />
          </button>
        }>
        <p className="l-nota" data-prueba="firma-interruptor-estado">
          {pide === null ? 'Sin saber si está encendido.' : on ? 'Encendido.' : 'Apagado: nadie ve la firma del registro en su portal.'}
          {!esAdmin && ' Solo el administrador de la empresa puede cambiarlo.'}
        </p>
        {hecho && <p className="l-hecho" role="status" data-prueba="firma-interruptor-hecho">{hecho}</p>}
        {error && <p className="l-error">{error}</p>}
      </Tarjeta>
    </div>
  )
}

export default function RegistroJornadaPage() {
  const { staff, userProfile, activeAccountId } = useApp()
  const [params, setParams] = useSearchParams()
  const hoy = diaMadrid(new Date().toISOString())
  // W08: las activas primero y las de baja al final; abre con la primera activa.
  const personas = ordenarPersonas(staff)
  const persona = params.get('persona') ?? personaPorDefecto(personas)
  const mes = params.get('mes') ?? hoy.slice(0, 7)
  const { desde, hasta } = periodoDelMes(mes, hoy)
  const esAdmin = userProfile?.role === 'admin'

  const [datos, setDatos] = useState<DatosInforme | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [hecho, setHecho] = useState('')
  const [enlace, setEnlace] = useState<EnlaceInspeccion | null>(null)
  const [enlaceRetirado, setEnlaceRetirado] = useState(false)

  useEffect(() => {
    if (!persona) return
    let vivo = true
    const t = window.setTimeout(async () => {
      setCargando(true); setError(''); setHecho('')
      try {
        const d = await leerInforme(persona, desde, hasta)
        if (vivo) setDatos(d)
      } catch (e) {
        if (vivo) { setDatos(null); setError(e instanceof Error ? e.message : String(e)) }
      } finally {
        if (vivo) setCargando(false)
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [persona, desde, hasta])

  const informe = datos ? armarInforme(datos) : null
  const elegir = (clave: 'persona' | 'mes', valor: string) => {
    const p = new URLSearchParams(params); p.set(clave, valor); if (clave === 'persona' && !p.get('mes')) p.set('mes', mes)
    setParams(p, { replace: true })
  }

  function bajarPdf() {
    if (!informe || !datos) return
    const nombre = nombreDeFichero(datos.persona.nombre, desde, hasta, 'pdf')
    descargar(pdfDelInforme(informe, datos.generado_at), nombre)
    setHecho(`Descargado el PDF: «${nombre}».`)
  }
  function bajarHoja() {
    if (!informe || !datos) return
    const nombre = nombreDeFichero(datos.persona.nombre, desde, hasta, 'csv')
    descargar(new Blob([hojaDeCalculo(informe)], { type: 'text/csv;charset=utf-8' }), nombre)
    setHecho(`Descargada la hoja de cálculo: «${nombre}».`)
  }
  async function hacerEnlace() {
    if (!persona) return
    setError(''); setHecho(''); setEnlaceRetirado(false)
    try {
      setEnlace(await crearEnlace(persona, desde, hasta, 30))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  async function copiar() {
    if (!enlace) return
    try {
      await navigator.clipboard.writeText(enlace.url)
      setHecho(`Enlace copiado. Caduca el ${fechaYHora(enlace.caducaAt)}.`)
    } catch {
      setHecho('No se ha podido copiar solo: selecciona el enlace y cópialo.')
    }
  }
  async function retirar() {
    if (!enlace) return
    try {
      await retirarEnlace(enlace.token)
      setEnlaceRetirado(true)
      setHecho('Enlace retirado: ya no abre.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className={RAIZ_LABORAL} data-prueba="registro-jornada">
      {activeAccountId && <FirmaDelMesInterruptor accountId={activeAccountId} esAdmin={esAdmin} hoy={hoy} />}
      <div className="l-filtros">
        <label>Persona
          <select value={persona} onChange={e => elegir('persona', e.target.value)} data-prueba="registro-persona">
            {personas.map(p => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (de baja)'}</option>)}
          </select>
        </label>
        <label>Mes
          <input type="month" value={mes} max={hoy.slice(0, 7)} onChange={e => e.target.value && elegir('mes', e.target.value)} data-prueba="registro-mes" />
        </label>
      </div>

      {error && <Tarjeta tono="falta" titulo="No se ha podido" nivel={3}><p className="l-error">{error}</p></Tarjeta>}
      {cargando && !informe && <p className="l-apoyo">Sacando el registro…</p>}

      {informe && (
        <InformeJornadaVista
          informe={informe}
          acciones={<>
            <Boton onClick={bajarHoja} data-prueba="bajar-hoja">Hoja de cálculo</Boton>
            {esAdmin && <Boton onClick={() => { void hacerEnlace() }} data-prueba="crear-enlace">Enlace para la Inspección</Boton>}
            <Boton variante="principal" onClick={bajarPdf} data-prueba="bajar-pdf">Descargar PDF</Boton>
          </>}
          encima={hecho ? <p className="l-hecho" role="status" data-prueba="registro-hecho">{hecho}</p> : null}
        />
      )}

      {enlace && (
        <Dialogo
          titulo="Enlace para la Inspección"
          explicacion={enlaceRetirado
            ? 'Retirado: ya no abre. Si hace falta otro, créalo de nuevo.'
            : `De solo lectura: el registro de ${datos?.persona.nombre ?? 'esta persona'} de ${textoPeriodo(desde, hasta)}, con su DNI. Caduca solo el ${fechaYHora(enlace.caducaAt)}. Cada vez que se abre, queda apuntado.`}
          alCerrar={() => setEnlace(null)}
          acciones={<>
            {!enlaceRetirado && <Boton onClick={() => { void retirar() }}>Retirarlo ya</Boton>}
            {!enlaceRetirado && <Boton variante="principal" onClick={() => { void copiar() }} data-autofocus>Copiar el enlace</Boton>}
          </>}
        >
          <p className="l-apoyo l-enlace" data-prueba="enlace-url">{enlace.url}</p>
          {hecho && <p className="l-hecho" role="status">{hecho}</p>}
        </Dialogo>
      )}
    </div>
  )
}
