// src/modules/conta/documentos/AclararDocumento.tsx
//
// S01g · Ninguna fila de «Por aclarar» se abre sin una acción que la resuelva
// (regla 8; encargo del 31/10). Antes, al pulsar una llegada o una recepción
// solo se abría el fichero. Ahora se abre esto, con su porqué y sus acciones:
//
//   · una llegada sin leer: «Leerla» (el lector de «Subir factura»),
//     «No es una factura» y, S01p·18.2 · 3, «Eliminar», que BORRA de verdad (la
//     fila, su actividad, su lectura y el fichero del almacén) con su confirmación;
//     solo si no ha llegado a los libros: si ha llegado, el botón no sale y se dice por qué;
//   · una llegada sin PDF (el correo traía un enlace): «Subir el PDF» (va a la
//     misma llegada y se lee en el momento) y «No es una factura»;
//   · S01p·20 · 1 · un correo de plataforma del que no salió nada (regla 8; Julio,
//     13/11): su asunto, su porqué, «Volver a leer» (lo pide otra vez a la entrada:
//     si entra, la fila sale sola) y «Subir el PDF a mano»;
//   · una recepción que no se pudo hacer factura: «Subir la factura» (el de la
//     página) y «Ver el albarán».
// Cada acción dice qué ha pasado (regla 8), con la frase de la base.

import { useRef, useState } from 'react'
import { Boton, Dialogo } from '@/modules/conta/diseno'
import { DialogoPapel } from '@/modules/conta/compras/VerPapel'
import { esCorreoSinFactura, faltaElPdf, tituloDeLlegada, type FilaDocumento } from '@/modules/conta/documentos/documentos'
import {
  leerLlegada, llegadaEliminable, llegadaEliminar, llegadaNoEsFactura, releerCorreoDeLlegada, subirPdfDeLlegada, subirPdfDelCorreo, urlDeLlegada,
} from '@/modules/conta/services/documentosService'
import { useLeer } from '@/modules/conta/libros/contexto'

export function AclararDocumento({ fila, accountId, companyId, quien, alCerrar, alHecho, alSubirFactura }: {
  fila: FilaDocumento; accountId: string; companyId?: string | null; quien: string | null
  alCerrar: () => void; alHecho: (mensaje: string) => void; alSubirFactura: () => void
}) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [papel, setPapel] = useState(false)
  const [eliminar, setEliminar] = useState(false)
  const pdf = useRef<HTMLInputElement>(null)
  const sinPdf = faltaElPdf(fila)
  const correo = esCorreoSinFactura(fila) && fila.correo ? fila.correo : null
  const llegada = fila.tipo === 'llegada'
  const eliminable = useLeer(llegada ? () => llegadaEliminable(fila.id) : null, `${fila.id}:eliminable`)

  const hacer = async (que: string, fn: () => Promise<string>) => {
    setOcupado(que); setError(null)
    try { alHecho(await fn()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(null) }
  }
  const verDocumento = async () => {
    try {
      const url = await urlDeLlegada(fila.id)
      if (url) window.open(url, '_blank', 'noopener'); else setError('Este documento no tiene fichero que enseñar.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const titulo = llegada ? (fila.archivo || correo ? tituloDeLlegada(fila) : sinPdf ? 'Un documento sin PDF' : 'Un documento sin leer') : `${fila.proveedor.nombre ?? 'Una recepción'}${fila.numero ? ` · ${fila.numero}` : ''}`
  const acciones = llegada ? (
    <>
      {eliminable.datos?.puede && <Boton variante="secundario" onClick={() => setEliminar(true)} disabled={!!ocupado}>Eliminar</Boton>}
      <Boton variante="secundario" onClick={() => void hacer('no', () => llegadaNoEsFactura(fila.id, quien, fila.archivo))} disabled={!!ocupado}>{ocupado === 'no' ? 'Guardando…' : 'No es una factura'}</Boton>
      {correo ? (
        <>
          <Boton variante="secundario" icono="subir" onClick={() => pdf.current?.click()} disabled={!!ocupado}>{ocupado === 'pdf' ? 'Subiendo y leyendo…' : 'Subir el PDF a mano'}</Boton>
          <Boton variante="principal" onClick={() => companyId ? void hacer('releer', () => releerCorreoDeLlegada(companyId, correo.id)) : setError('Elige la empresa para volver a leer el correo.')} disabled={!!ocupado}>
            {ocupado === 'releer' ? 'Leyendo otra vez…' : 'Volver a leer'}
          </Boton>
        </>
      ) : sinPdf
        ? <Boton variante="principal" icono="subir" onClick={() => pdf.current?.click()} disabled={!!ocupado}>{ocupado === 'pdf' ? 'Subiendo y leyendo…' : 'Subir el PDF'}</Boton>
        : <Boton variante="principal" onClick={() => void hacer('leer', () => leerLlegada(accountId, fila.id))} disabled={!!ocupado}>{ocupado === 'leer' ? 'Leyéndola…' : 'Leerla'}</Boton>}
    </>
  ) : (
    <>
      <Boton variante="secundario" onClick={() => setPapel(true)} disabled={!!ocupado}>Ver el albarán</Boton>
      <Boton variante="principal" icono="subir" onClick={alSubirFactura} disabled={!!ocupado}>Subir la factura</Boton>
    </>
  )

  return (
    <>
      <Dialogo titulo={titulo} explicacion={fila.porque ?? 'Hay algo que aclarar.'} alCerrar={alCerrar} acciones={acciones}>
        {llegada && !sinPdf && !correo && <button type="button" className="s-boton s-boton-enlace" onClick={() => void verDocumento()}>Ver el documento</button>}
        <input ref={pdf} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="s-oculto" aria-label="Elegir el PDF"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void hacer('pdf', () => (correo ? subirPdfDelCorreo(accountId, fila.id, f) : subirPdfDeLlegada(accountId, fila.id, f))); e.target.value = '' }} />
        {correo && <p className="s-apoyo" data-prueba="correo-sin-factura">Llegó por correo y no he sacado de él ninguna factura ni liquidación. «Volver a leer» lo pide otra vez a la entrada: si ahora se entiende, entra y sale de aquí.</p>}
        {error && <div className="cx-error" role="alert">{error}</div>}
        {llegada && eliminable.datos && !eliminable.datos.puede && (
          <p className="s-apoyo" data-prueba="no-se-elimina">No se puede eliminar: {eliminable.datos.porque}</p>
        )}
        {llegada && eliminable.error && <p className="s-apoyo" role="status">No he podido saber si se puede eliminar: {eliminable.error}</p>}
        {eliminar && (
          <div className="s-aviso-lista" data-tono="duda" role="alertdialog" aria-label="¿Eliminar el documento?" data-prueba="confirmar-eliminar">
            <p style={{ margin: '0 0 8px' }}><strong>¿Eliminar {fila.archivo ? `«${fila.archivo}»` : 'este documento'}?</strong> Se borra de verdad: la fila, su actividad, lo que leyó la IA y el fichero del almacén. No se puede deshacer.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Boton variante="principal" onClick={() => void hacer('eliminar', () => llegadaEliminar(fila.id, quien))} disabled={!!ocupado}>{ocupado === 'eliminar' ? 'Eliminando…' : 'Sí, eliminarlo'}</Boton>
              <Boton variante="secundario" onClick={() => setEliminar(false)} disabled={!!ocupado}>No, déjalo</Boton>
            </div>
          </div>
        )}
      </Dialogo>
      {papel && <DialogoPapel recepcion={fila.id} titulo={titulo} alCerrar={() => setPapel(false)} />}
    </>
  )
}
