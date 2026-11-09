// src/modules/conta/portal/pantallas/Mensajes.tsx
//
// GP · Tarea 3 · Mensajes con tu gestoría: la conversación, con adjuntos. Al
// abrirla, los de la gestoría quedan leídos. Si se llega desde «Contestar» de
// una petición, el mensaje la contesta. Una sola lectura: conta_portal_mensajes.

import { useEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { abrir, leer, subirFichero } from '../cliente'
import { Cargando, Fallo } from '../comun'
import { cuando, puedeSubirse } from '../formato'
import type { Mensajes as DatosMensajes } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'

export function Mensajes({ cliente, abrir: pedido, avisar, ir }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosMensajes>('conta_portal_mensajes', cliente)
  const [texto, setTexto] = useState('')
  const [adjuntos, setAdjuntos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const hilo = useRef<HTMLDivElement>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const contestar = pedido.contestar ?? null
  const sinLeer = (datos?.mensajes ?? []).some((m) => m.de === 'gestoria' && !m.leido)
  useEffect(() => { if (sinLeer) void leer('conta_portal_mensajes_leidos', { p_party: cliente }).catch(() => undefined) }, [sinLeer, cliente])
  useEffect(() => { hilo.current?.scrollTo({ top: hilo.current.scrollHeight }) }, [datos])
  if (cargando && !datos) return <Cargando que="tus mensajes" />
  if (error || !datos) return <Fallo texto={error ?? 'No se han podido cargar.'} otraVez={recargar} />

  const elegir = (l: FileList | null) => {
    const nuevos = [...(l ?? [])].filter((f) => { const m = puedeSubirse(f); if (m) avisar({ tipo: 'mal', texto: m }); return !m })
    setAdjuntos((a) => [...a, ...nuevos].slice(0, 5))
    if (entrada.current) entrada.current.value = ''
  }
  const enviar = async () => {
    if (!texto.trim() && !adjuntos.length) return
    setEnviando(true)
    try {
      if (contestar) {
        await leer('conta_portal_peticion_contestar', { p_peticion: contestar, p_respuesta: texto })
        avisar({ tipo: 'ok', texto: 'Contestado. Tu gestoría ya lo tiene.' })
        setTexto(''); ir('mensajes'); recargar(); return
      }
      const subidos: { ruta: string; nombre: string; tipo: string; bytes: number }[] = []
      for (const f of adjuntos) subidos.push({ ruta: await subirFichero(cliente, f, 'mensajes'), nombre: f.name, tipo: f.type, bytes: f.size })
      const r = await leer<{ frase: string }>('conta_portal_mensaje_enviar', { p_party: cliente, p_texto: texto, p_adjuntos: subidos })
      avisar({ tipo: 'ok', texto: r.frase })
      setTexto(''); setAdjuntos([]); recargar()
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setEnviando(false) }
  }

  return (
    <>
      <h1 className="pt-h1">Mensajes con tu gestoría</h1>
      {contestar && pedido.pregunta && <div className="pt-aviso info" role="status"><span>Contestas a: «{pedido.pregunta}»</span><button type="button" onClick={() => ir('mensajes')}>No contestar</button></div>}
      <section className="pt-tarjeta pt-chat" style={{ padding: 0, gap: 0 }} aria-label="Conversación">
        <div className="pt-chat-hilo" ref={hilo} aria-live="polite">
          {datos.mensajes.length === 0 && <div className="pt-nota">Escribe aquí lo que necesites. Tu gestoría contesta en el día y te avisamos por correo.</div>}
          {datos.mensajes.map((m) => (
            <div key={m.id} className={`pt-burbuja-msg${m.de === 'cliente' ? ' mio' : ''}`}>
              {m.de === 'gestoria' && <small style={{ opacity: 1, fontWeight: 700 }}>{m.autor}</small>}
              {m.texto && <span>{m.texto}</span>}
              {m.adjuntos.map((a, i) => (
                <button type="button" key={a.ruta} className="pt-adjunto" onClick={() => abrir(cliente, 'adjunto', m.id, i).catch((e: Error) => avisar({ tipo: 'mal', texto: e.message }))}>
                  <Paperclip size={12} aria-hidden="true" /> {a.nombre}
                </button>
              ))}
              <small>{m.de === 'cliente' ? 'Tú' : m.autor.split(' ')[0]} · {cuando(m.cuando)}</small>
            </div>
          ))}
        </div>
        {adjuntos.length > 0 && (
          <div className="pt-botones" style={{ padding: '8px 12px 0' }}>
            {adjuntos.map((f, i) => <button type="button" key={i} className="pt-filtro" onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`}>{f.name} ×</button>)}
          </div>
        )}
        <div className="pt-chat-escribir">
          <input ref={entrada} type="file" className="pt-oculto" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic" onChange={(e) => elegir(e.target.files)} aria-label="Adjuntar un fichero" />
          {!contestar && <button type="button" className="pt-boton sec" style={{ width: 44, padding: 0 }} aria-label="Adjuntar" onClick={() => entrada.current?.click()}><Paperclip size={18} /></button>}
          <label className="pt-oculto" htmlFor="pt-escribir">Escribe un mensaje</label>
          <textarea id="pt-escribir" className="pt-texto" rows={1} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={contestar ? 'Tu respuesta…' : 'Escribe a tu gestoría…'} maxLength={5000} />
          <button type="button" className="pt-boton" disabled={enviando || (!texto.trim() && !adjuntos.length)} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar'}</button>
        </div>
      </section>
    </>
  )
}
