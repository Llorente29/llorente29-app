// src/modules/conta/documentos/AclararDocumento.tsx
//
// S01g · Ninguna fila de «Por aclarar» se abre sin una acción que la resuelva
// (regla 8; encargo del 31/10). Antes, al pulsar una llegada o una recepción
// solo se abría el fichero. Ahora se abre esto, con su porqué y sus acciones:
//
//   · una llegada sin leer: «Leerla» (el lector de «Subir factura») y
//     «No es una factura»;
//   · una llegada sin PDF (el correo traía un enlace): «Subir el PDF» (va a la
//     misma llegada y se lee en el momento) y «No es una factura»;
//   · una recepción que no se pudo hacer factura: «Subir la factura» (el de la
//     página) y «Ver el albarán».
// Cada acción dice qué ha pasado (regla 8), con la frase de la base.

import { useRef, useState } from 'react'
import { Boton, Dialogo } from '@/modules/conta/diseno'
import { DialogoPapel } from '@/modules/conta/compras/VerPapel'
import { faltaElPdf, type FilaDocumento } from '@/modules/conta/documentos/documentos'
import { leerLlegada, llegadaNoEsFactura, subirPdfDeLlegada, urlDeLlegada } from '@/modules/conta/services/documentosService'

export function AclararDocumento({ fila, accountId, quien, alCerrar, alHecho, alSubirFactura }: {
  fila: FilaDocumento; accountId: string; quien: string | null
  alCerrar: () => void; alHecho: (mensaje: string) => void; alSubirFactura: () => void
}) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [papel, setPapel] = useState(false)
  const pdf = useRef<HTMLInputElement>(null)
  const sinPdf = faltaElPdf(fila)
  const llegada = fila.tipo === 'llegada'

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

  const titulo = llegada ? (fila.archivo ? `«${fila.archivo}»` : sinPdf ? 'Un documento sin PDF' : 'Un documento sin leer') : `${fila.proveedor.nombre ?? 'Una recepción'}${fila.numero ? ` · ${fila.numero}` : ''}`
  const acciones = llegada ? (
    <>
      <Boton variante="secundario" onClick={() => void hacer('no', () => llegadaNoEsFactura(fila.id, quien))} disabled={!!ocupado}>{ocupado === 'no' ? 'Guardando…' : 'No es una factura'}</Boton>
      {sinPdf
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
        {llegada && !sinPdf && <button type="button" className="s-boton s-boton-enlace" onClick={() => void verDocumento()}>Ver el documento</button>}
        <input ref={pdf} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="s-oculto" aria-label="Elegir el PDF"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void hacer('pdf', () => subirPdfDeLlegada(accountId, fila.id, f)); e.target.value = '' }} />
        {error && <div className="cx-error" role="alert">{error}</div>}
      </Dialogo>
      {papel && <DialogoPapel recepcion={fila.id} titulo={titulo} alCerrar={() => setPapel(false)} />}
    </>
  )
}
