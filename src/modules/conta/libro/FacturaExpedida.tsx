// src/modules/conta/libro/FacturaExpedida.tsx
//
// S01d · El PDF de una factura expedida apuntada a mano (encargo de Julio,
// «adjuntar el PDF a la expedida y verlo al lado»).
//
//   · ElegirExpedida: el selector (PDF o foto JPG/PNG; la foto se convierte a
//     PDF al subirla). Dice por qué no vale un fichero.
//   · PapelExpedida: la factura pintada al lado, como el papel de «Revisar
//     factura» (PapelPdf, cxr-papel); en el móvil se recoge y se abre.
//   · TarjetaExpedida: la tarjeta «Factura» de un asiento de expedida. Con su
//     PDF adjunto, lo enseña con su nombre y «Abrir»; validado y sin PDF,
//     «Adjuntar el PDF»; en borrador, que se adjunta al validar. Una vez
//     adjunta no se cambia (la base tampoco lo deja).
//
// Cada «Adjuntar» dice en pantalla qué ha pasado, con el nombre del fichero o
// con el motivo (regla 8).

import { useEffect, useId, useState } from 'react'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { useFicheroElegido } from '@/modules/conta/libro/ficheroElegido'
import {
  ACEPTA_EXPEDIDA, admitePdfExpedida, claseDeFichero, esExpedidaAMano, motivoExpedida, problemaDeFichero, tamano, textoAdjunta,
  type AsientoParaExpedida,
} from '@/modules/conta/lib/expedidaPdf'
import { guardarExpedidaPdf, leerExpedidaPdf, urlDocumento, type DocExpedida } from '@/modules/conta/services/documentosService'

const motivo = (e: unknown) => motivoExpedida(e instanceof Error ? e.message : String(e))

/** El selector del fichero. Si no vale, lo dice debajo y no lo elige. */
export function ElegirExpedida({ etiqueta, alElegir, deshabilitado = false }: { etiqueta: string; alElegir: (f: File) => void; deshabilitado?: boolean }) {
  const id = useId()
  const [problema, setProblema] = useState<string | null>(null)
  return (
    <div className="cxd-expedida-elegir">
      <input id={id} className="cx-oculto" type="file" accept={ACEPTA_EXPEDIDA} disabled={deshabilitado}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          if (!f) return
          const p = problemaDeFichero(f.name, f.type, f.size)
          setProblema(p)
          if (!p) alElegir(f)
        }} />
      <label htmlFor={id} className="cx-boton-sec cxd-expedida-boton">{etiqueta}</label>
      <span className="cx-ayuda">PDF o foto (JPG o PNG): la foto se convierte a PDF al adjuntarla.</span>
      {problema && <p className="cx-error" role="alert">{problema}</p>}
    </div>
  )
}

/** La factura pintada: la primera página del PDF o la foto, con «Abrir». En el móvil, se recoge. */
export function PapelExpedida({ titulo, url, esFoto, movil, alAbrir }: {
  titulo: string; url: string | null; esFoto: boolean; movil: boolean
  /** Si se da, «Abrir» pide antes una dirección nueva (las firmadas caducan). */
  alAbrir?: () => void
}) {
  const [recogido, setRecogido] = useState(false)
  const visible = !movil || !recogido
  return (
    <section className="cxr-papel cxd-expedida-papel" aria-label="La factura">
      <div className="cxr-papel-cabeza">
        <span className="cxd-expedida-nombre">{titulo}</span>
        {url && (alAbrir
          ? <button type="button" className="cx-enlace" onClick={alAbrir}>Abrir</button>
          : <a href={url} target="_blank" rel="noopener noreferrer" className="cx-enlace">Abrir</a>)}
      </div>
      {movil && (
        <button type="button" className="cx-enlace cxd-expedida-recoger" aria-expanded={visible} onClick={() => setRecogido((x) => !x)}>
          {visible ? 'Recoger la factura' : 'Ver la factura'}
        </button>
      )}
      {visible && (
        <div className="cxr-papel-hoja cxd-expedida-hoja">
          {!url && <p className="cx-ayuda">Abriendo la factura…</p>}
          {url && (esFoto ? <img src={url} alt={titulo} /> : <PapelPdf url={url} titulo={titulo} />)}
        </div>
      )}
    </section>
  )
}

const cuandoFue = (iso: string) => new Intl.DateTimeFormat('es-ES', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
}).format(new Date(iso))

interface Leido { clave: string; doc: DocExpedida | null; url: string | null; error: string | null }

/**
 * La tarjeta «Factura» de un asiento de expedida a mano (serie 1, 'manual').
 * Para cualquier otro asiento no pinta nada: la página enseña su «Documento».
 */
export function TarjetaExpedida({ a, accountId, quien, movil, alHacer, alFallar }: {
  a: AsientoParaExpedida & { id: string }; accountId: string; quien: string | null; movil: boolean
  alHacer: (texto: string) => void; alFallar: (texto: string) => void
}) {
  const [vuelta, setVuelta] = useState(0)
  const clave = `${accountId}:${a.id}:${vuelta}`
  const [leido, setLeido] = useState<Leido>({ clave: '', doc: null, url: null, error: null })
  const [elegido, elegir] = useFicheroElegido()
  const [ocupado, setOcupado] = useState(false)
  const [falloAqui, setFalloAqui] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    leerExpedidaPdf(accountId, a.id)
      .then(async (doc) => ({ doc, url: doc ? await urlDocumento(doc.ruta) : null }))
      .then(({ doc, url }) => { if (vivo) setLeido({ clave, doc, url, error: null }) },
        (e: unknown) => { if (vivo) setLeido({ clave, doc: null, url: null, error: motivo(e) }) })
    return () => { vivo = false }
  }, [accountId, a.id, clave])

  const listo = leido.clave === clave
  const doc = listo ? leido.doc : null

  async function adjuntar() {
    if (!elegido) return
    setOcupado(true); setFalloAqui(null)
    try {
      const r = await guardarExpedidaPdf(accountId, a.id, elegido.fichero, quien)
      alHacer(`${textoAdjunta(r.nombre, r.yaEstaba)} Queda guardada con el asiento y ya no se cambia.`)
      elegir(null); setVuelta((v) => v + 1)
    } catch (e) {
      const t = `La factura no se ha adjuntado: ${motivo(e)}. El asiento sigue validado; puedes volver a intentarlo.`
      setFalloAqui(t)
    } finally { setOcupado(false) }
  }

  // «Abrir» con una dirección nueva: la firmada dura cinco minutos.
  async function abrir() {
    if (!doc) return
    const ventana = window.open('', '_blank')
    try {
      const u = await urlDocumento(doc.ruta)
      if (ventana) ventana.location.href = u
      else window.location.href = u
    } catch (e) { ventana?.close(); alFallar(motivo(e)) }
  }

  if (!esExpedidaAMano(a)) return null
  return (
    <section className="cx-tarjeta cxd-expedida" aria-label="Factura">
      <h2 className="cx-tarjeta-titulo">Factura</h2>
      {!listo && <p className="cx-ayuda" aria-busy="true">Mirando si tiene la factura adjunta…</p>}
      {listo && leido.error && (
        <div className="cx-error" role="alert">
          No he podido leer si tiene la factura adjunta: {leido.error}.{' '}
          <button type="button" className="cx-enlace" onClick={() => setVuelta((v) => v + 1)}>Volver a mirar</button>
        </div>
      )}

      {doc && (
        <>
          <p><strong>{doc.nombre}</strong></p>
          <span className="cx-ayuda">
            Adjunta el {cuandoFue(doc.cuando)}{doc.quien ? ` por ${doc.quien}` : ''}{doc.bytes ? ` · ${tamano(doc.bytes)}` : ''}. Una vez adjunta no se cambia.
          </span>
          <PapelExpedida titulo={doc.nombre} url={leido.url} esFoto={false} movil={movil} alAbrir={() => void abrir()} />
        </>
      )}

      {listo && !leido.error && !doc && !admitePdfExpedida(a) && (
        <p className="cx-ayuda">
          {a.estado === 'anulado' ? 'Anulado sin factura adjunta: ya no se le adjunta.' : 'Sin factura adjunta. El PDF se adjunta con el asiento validado: valídalo y lo adjuntas aquí.'}
        </p>
      )}

      {listo && !leido.error && !doc && admitePdfExpedida(a) && (
        <>
          <p>Sin factura adjunta.</p>
          {!elegido && <ElegirExpedida etiqueta="Adjuntar el PDF" alElegir={(f) => { setFalloAqui(null); elegir(f) }} deshabilitado={ocupado} />}
          {elegido && (
            <>
              <PapelExpedida titulo={`${elegido.fichero.name} · ${tamano(elegido.fichero.size)}`} url={elegido.url}
                esFoto={claseDeFichero(elegido.fichero.name, elegido.fichero.type) !== 'pdf'} movil={movil} />
              <p className="cx-ayuda">Mira que es la factura de este asiento: una vez adjunta no se cambia.</p>
              <div className="cxd-acciones">
                <button type="button" className="cx-boton-sec" onClick={() => { setFalloAqui(null); elegir(null) }} disabled={ocupado}>Elegir otra</button>
                <button type="button" className="cx-boton" onClick={() => void adjuntar()} disabled={ocupado}>{ocupado ? 'Adjuntando…' : 'Adjuntar esta factura'}</button>
              </div>
            </>
          )}
          {falloAqui && <p className="cx-error" role="alert">{falloAqui}</p>}
        </>
      )}
    </section>
  )
}
