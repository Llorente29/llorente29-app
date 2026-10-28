// src/modules/personal/laboral/InspeccionPage.tsx
//
// L1a · PR 2 (28/10/2026). El enlace para la Inspección: /inspeccion?t=<token>,
// sin sesión. Enseña el registro de jornada de una persona y un periodo, de
// solo lectura, igual que lo ve la empresa (con el DNI; una baja médica, como
// «ausente»), y se baja en PDF o en hoja de cálculo. Un enlace caducado,
// retirado o inventado dice que ya no es válido, sin más pistas.

import { useEffect, useState } from 'react'
import { Boton, Tarjeta } from '@/modules/conta/diseno'
import InformeJornadaVista from './InformeJornadaVista'
import { armarInforme, hojaDeCalculo, type DatosInforme } from './informeJornada'
import { fechaYHora } from './calculoJornada'
import { descargar, nombreDeFichero, pdfDelInforme } from './informePdf'
import { leerInformePorEnlace } from './registroJornadaServicio'
import { RAIZ_LABORAL } from './estilo'

export default function InspeccionPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? ''
  const [datos, setDatos] = useState<DatosInforme | null>(null)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState('')

  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      if (!token) { if (vivo) setError('Falta el enlace completo: ábrelo tal cual te lo mandaron.'); return }
      try {
        const d = await leerInformePorEnlace(token)
        if (vivo) setDatos(d)
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [token])

  const informe = datos ? armarInforme(datos) : null

  return (
    <main className={`${RAIZ_LABORAL} l-pagina-publica`} data-prueba="inspeccion">
      {error && (
        <Tarjeta tono="falta" titulo="Este enlace no abre">
          <p className="l-error" data-prueba="inspeccion-error">{error}</p>
        </Tarjeta>
      )}
      {!error && !informe && <p className="l-apoyo">Abriendo el registro…</p>}
      {informe && datos && (
        <InformeJornadaVista
          informe={informe}
          encima={<>
            <p className="l-apoyo" data-prueba="inspeccion-caduca">
              Enlace de solo lectura para la Inspección de Trabajo. Caduca el {datos.enlace ? fechaYHora(datos.enlace.caduca_at) : '—'}.
            </p>
            {hecho && <p className="l-hecho" role="status">{hecho}</p>}
          </>}
          acciones={<>
            <Boton onClick={() => {
              const n = nombreDeFichero(datos.persona.nombre, datos.periodo.desde, datos.periodo.hasta, 'csv')
              descargar(new Blob([hojaDeCalculo(informe)], { type: 'text/csv;charset=utf-8' }), n)
              setHecho(`Descargada la hoja de cálculo: «${n}».`)
            }}>Hoja de cálculo</Boton>
            <Boton variante="principal" onClick={() => {
              const n = nombreDeFichero(datos.persona.nombre, datos.periodo.desde, datos.periodo.hasta, 'pdf')
              descargar(pdfDelInforme(informe, datos.generado_at), n)
              setHecho(`Descargado el PDF: «${n}».`)
            }}>Descargar PDF</Boton>
          </>}
        />
      )}
    </main>
  )
}
