// src/modules/conta/compras/VerPapel.tsx
//
// «Ver el papel» (repaso, 10/10): nadie decide sobre un papel que no ve. Abre
// la foto o el PDF que ya está guardado con la recepción (las páginas de su
// lectura, o el documento de la recepción), sin salir de Compras.

import { useEffect, useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { tabla } from '@/modules/conta/services/bd'
import { getReceiptFileUrl } from '@/modules/supply/services/goodsReceiptService'

interface Pagina { url: string; pdf: boolean }

async function paginasDe(recepcion: string): Promise<Pagina[]> {
  const { data, error } = await tabla('goods_receipt').select('raw_document_url, ai_session_id').eq('id', recepcion).maybeSingle()
  if (error) throw new Error(`No se pudo leer la recepción: ${error.message}`)
  const g = data as { raw_document_url: string | null; ai_session_id: string | null } | null
  let rutas: string[] = []
  if (g?.ai_session_id) {
    const { data: a } = await tabla('goods_receipt_ai_session').select('input_files').eq('id', g.ai_session_id).maybeSingle()
    const files = (a as { input_files: unknown } | null)?.input_files
    if (Array.isArray(files)) rutas = files.map((f) => (typeof f === 'string' ? f : (f as { path?: string })?.path ?? '')).filter(Boolean)
  }
  if (!rutas.length && g?.raw_document_url) rutas = [g.raw_document_url]
  const urls = await Promise.all(rutas.map(async (r) => ({ url: await getReceiptFileUrl(r), pdf: /\.pdf($|\?)/i.test(r) })))
  return urls.filter((u): u is Pagina => !!u.url)
}

export function DialogoPapel({ recepcion, titulo, alCerrar }: { recepcion: string; titulo: string; alCerrar: () => void }) {
  const [paginas, setPaginas] = useState<Pagina[] | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    paginasDe(recepcion).then((p) => { if (vivo) setPaginas(p) }, (e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [recepcion])
  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar}>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {!fallo && paginas === null && <p role="status" style={{ margin: 0 }}>Abriendo el papel…</p>}
      {paginas && paginas.length === 0 && (
        <p style={{ margin: 0 }}>Esta recepción no tiene el papel guardado: se apuntó sin foto ni PDF. Lo que se leyó de él es lo que sale en la fila.</p>
      )}
      {paginas && paginas.length > 0 && (
        <div className="cxc-papel">
          {paginas.map((p, i) => p.pdf
            ? <iframe key={i} src={p.url} title={`${titulo} · página ${i + 1}`} className="cxc-papel-pdf" />
            : <img key={i} src={p.url} alt={`${titulo} · página ${i + 1}`} className="cxc-papel-img" />)}
        </div>
      )}
      <div className="cx-pie"><button type="button" className="cx-boton-sec" onClick={alCerrar}>Cerrar</button></div>
    </Dialogo>
  )
}

/** El botón «Ver el papel», con su diálogo. */
export function VerPapel({ recepcion, titulo }: { recepcion: string; titulo: string }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button type="button" className="cx-boton-sec" onClick={() => setAbierto(true)}>Ver el papel</button>
      {abierto && <DialogoPapel recepcion={recepcion} titulo={titulo} alCerrar={() => setAbierto(false)} />}
    </>
  )
}
