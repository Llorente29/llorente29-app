// src/modules/conta/gestoria/portal/PortalFicha.tsx
//
// GP · Tarea 4 (Code 3, 09/11/2026) · LA PESTAÑA «PORTAL» DE LA FICHA DEL
// CLIENTE, para la gestoría. Una lectura (conta_portal_ficha) y, en orden:
//   1. Lo que pide el cliente: altas y bajas de trabajadores (hacer o no) y
//      sus avisos («No estoy de acuerdo», cambios de datos…), para contestar.
//   2. La conversación, con su respuesta (al cliente le llega un correo).
//   3. Lo que le pide la gestoría: firmar un PDF, subir algo o contestar.
//   4. Quién entra en su portal, «Invitar al portal» y quitar.
//   5. Lo que ha subido, y la forma de pagar un devuelto (de toda la cuenta).
// Cada botón confirma con la frase de la base o dice por qué no (regla 8). Las
// palabras, de la calle: nunca «mandato», «payment» ni «SEPA».

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  abrirFichero, anularPeticion, enviarMensaje, guardarPagarDevuelto, hacerSolicitud, invitar, leerFichaPortal, leerPagarDevuelto, marcarLeidos, pedir,
  quitarAcceso, rechazarSolicitud, resolverIncidencia, type FichaPortal, type Permiso,
} from './datos'

export interface PropsPortalFicha {
  cuenta: string
  cliente: string
  nombreCliente: string
  /** Los servicios que se cobran por trabajador: dónde va un alta pedida desde el portal. */
  serviciosPorTrabajador: { id: string; nombre: string }[]
  /** Para probar sin base (Storybook, capturas): lo que haría leerFichaPortal. */
  leer?: () => Promise<FichaPortal>
}

const fecha = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short' }) : '')
const fechaHora = (s: string) => new Date(s).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const PERMISO: Record<Permiso, string> = { todo: 'Todo', facturas_documentos: 'Facturas y documentos' }
const PIDE: Record<string, string> = { firmar: 'Firmar', subir: 'Subir', contestar: 'Contestar' }
const INCIDENCIA: Record<string, string> = { no_de_acuerdo: 'No está de acuerdo con el recibo', cambio_datos: 'Quiere cambiar sus datos', otra: 'Aviso' }

/** Un botón que hace algo y dice lo que ha pasado (regla 8). */
function useHacer(despues: () => void) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const hacer = async (f: () => Promise<string>): Promise<boolean> => {
    setHaciendo(true); setAviso(null)
    try { setAviso({ ok: true, texto: await f() }); despues(); return true }
    catch (e) { setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) }); return false }
    finally { setHaciendo(false) }
  }
  const texto: ReactNode = aviso ? <p className="g4-hecho" data-ok={aviso.ok ? '' : undefined} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p> : null
  return { hacer, haciendo, texto }
}

export function PortalFicha(p: PropsPortalFicha) {
  const [datos, setDatos] = useState<FichaPortal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const leer = p.leer
  const recargar = useCallback(() => {
    void (leer ? leer() : leerFichaPortal(p.cliente)).then((d) => { setDatos(d); setError(null) }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [p.cliente, leer])
  useEffect(() => { recargar() }, [recargar])
  const h = useHacer(recargar)

  if (error) return <section className="g4-bloque"><p className="g4-hecho" role="alert">No se ha podido leer el portal de este cliente: {error}</p>
    <button type="button" className="g4-boton" onClick={recargar}>Reintentar</button></section>
  if (!datos) return <section className="g4-bloque" aria-busy="true"><p className="g4-pequeno" style={{ fontSize: 14 }}>Leyendo el portal…</p></section>

  const activos = datos.accesos.filter((a) => !a.revocado_at)
  const solicitudes = datos.solicitudes.filter((s) => s.estado === 'pedida')
  const incidencias = datos.incidencias.filter((i) => i.estado === 'abierta')
  const pendientes = solicitudes.length + incidencias.length
  return (
    <div className="g4-portal" data-pantalla="portal-ficha" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {h.texto}

      <section aria-labelledby="gp-pide" className="g4-bloque">
        <div className="g4-bloque-cabecera"><h2 id="gp-pide" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Lo que pide el cliente</h2>
          <span className="g4-etiqueta" data-tono={pendientes ? 'aviso' : 'bien'}>{pendientes ? `${pendientes} sin contestar` : 'Al día'}</span></div>
        {pendientes === 0 && <p className="g4-nada">Nada pendiente.</p>}
        {solicitudes.map((s) => <Solicitud key={s.id} s={s} servicios={p.serviciosPorTrabajador} h={h} />)}
        {incidencias.map((i) => <Incidencia key={i.id} i={i} h={h} />)}
      </section>

      <Conversacion cliente={p.cliente} mensajes={datos.mensajes} h={h} recargar={recargar} />

      <Peticiones cuenta={p.cuenta} cliente={p.cliente} peticiones={datos.peticiones} h={h} />

      <section aria-labelledby="gp-entran" className="g4-bloque">
        <div className="g4-bloque-cabecera"><h2 id="gp-entran" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Quién entra en su portal</h2></div>
        {activos.length === 0 && <p className="g4-pequeno" style={{ fontSize: 14 }}>Nadie de {p.nombreCliente} entra todavía. Invítale: le llega un correo con el enlace, sin contraseña.</p>}
        {activos.map((a) => (
          <div key={a.id} className="g4-renglon">
            <span className="g4-cliente-textos"><b>{a.nombre ?? a.correo}</b><span className="g4-pequeno">{a.nombre ? `${a.correo} · ` : ''}{PERMISO[a.permiso]} · invitado el {fecha(a.invitado_at)}{a.invitado_por_name ? ` por ${a.invitado_por_name}` : ''}</span></span>
            <button type="button" className="g4-enlace" disabled={h.haciendo} onClick={() => { if (window.confirm(`¿Quitar el acceso a ${a.nombre ?? a.correo}?`)) void h.hacer(() => quitarAcceso(a.id)) }}>Quitar</button>
          </div>
        ))}
        <Invitar cliente={p.cliente} h={h} />
      </section>

      {datos.subidas.length > 0 && (
        <section aria-labelledby="gp-subidas" className="g4-bloque">
          <h2 id="gp-subidas" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Lo que ha subido</h2>
          {datos.subidas.slice(0, 20).map((s) => (
            <div key={s.id} className="g4-renglon">
              <span className="g4-cliente-textos"><b>{s.nombre}</b><span className="g4-pequeno">{fechaHora(s.created_at)} · {s.estado === 'en_el_buzon' ? 'En tu buzón de documentos' : s.estado === 'sin_buzon' ? 'Sin buzón: ábrelo y súbelo a mano' : s.estado === 'error' ? 'No ha llegado al buzón' : 'Recibido'}</span></span>
              <AbrirFichero ruta={s.ruta} h={h} />
            </div>
          ))}
        </section>
      )}

      <PagarDevuelto cuenta={p.cuenta} h={h} />
    </div>
  )
}

type H = ReturnType<typeof useHacer>

function AbrirFichero({ ruta, h, texto = 'Abrir' }: { ruta: string; h: H; texto?: string }) {
  return <button type="button" className="g4-enlace" onClick={() => void abrirFichero(ruta).then((u) => window.open(u, '_blank', 'noopener'), (e: unknown) => void h.hacer(() => Promise.reject(e)))}>{texto}</button>
}

function Solicitud({ s, servicios, h }: { s: FichaPortal['solicitudes'][number]; servicios: PropsPortalFicha['serviciosPorTrabajador']; h: H }) {
  const [servicio, setServicio] = useState(servicios[0]?.id ?? '')
  const [motivo, setMotivo] = useState('')
  const [rechazar, setRechazar] = useState(false)
  const cuando = s.fecha_efecto ?? s.mes
  return (
    <div className="g4-tarea" data-tono="aviso">
      <div className="g4-tarea-titulo">{s.tipo === 'alta' ? 'Alta' : 'Baja'} de {s.empleado_nombre}{cuando ? ` · desde el ${fecha(cuando)}` : ''}</div>
      <div className="g4-tarea-texto">Pedida desde el portal el {fechaHora(s.pedida_at)}. Al hacerla, {s.tipo === 'alta' ? 'entra en su recibo' : 'sale de su recibo'} desde ese mes.</div>
      {rechazar ? (
        <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => rechazarSolicitud(s.id, motivo.trim())) }}>
          <label className="g4-campo g4-campo-azul">Por qué no (el cliente lo lee)<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required maxLength={300} /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo}>No se hace</button>
            <button type="button" className="g4-boton" onClick={() => setRechazar(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {s.tipo === 'alta' && (servicios.length
            ? <label className="g4-campo g4-campo-azul">Se cobra en<select value={servicio} onChange={(e) => setServicio(e.target.value)}>{servicios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
            : <span className="g4-pequeno" style={{ fontSize: 13 }}>Esta empresa no tiene un servicio que se cobre por trabajador: créalo en «Tarifa y paquetes».</span>)}
          <button type="button" className="g4-boton" data-tipo="primario" disabled={h.haciendo || (s.tipo === 'alta' && !servicio)}
            onClick={() => void h.hacer(() => hacerSolicitud(s.id, s.tipo === 'alta' ? servicio : null))}>{s.tipo === 'alta' ? 'Darle de alta' : 'Darle de baja'}</button>
          <button type="button" className="g4-boton" onClick={() => setRechazar(true)}>No se hace</button>
        </div>
      )}
    </div>
  )
}

function Incidencia({ i, h }: { i: FichaPortal['incidencias'][number]; h: H }) {
  const [respuesta, setRespuesta] = useState('')
  return (
    <div className="g4-tarea" data-tono={i.tipo === 'no_de_acuerdo' ? 'mal' : 'aviso'}>
      <div className="g4-tarea-titulo">{INCIDENCIA[i.tipo] ?? 'Aviso'} · {fechaHora(i.created_at)}</div>
      <div className="g4-tarea-texto">«{i.texto}»{i.recibo_parado ? ' El recibo está parado hasta que lo resuelvas.' : ''}</div>
      <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => resolverIncidencia(i.id, respuesta.trim())) }}>
        <label className="g4-campo g4-campo-azul">Tu respuesta (le llega en Mensajes)<input value={respuesta} onChange={(e) => setRespuesta(e.target.value)} required maxLength={1000} /></label>
        <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo} style={{ alignSelf: 'flex-start' }}>Contestar y cerrar</button>
      </form>
    </div>
  )
}

function Conversacion({ cliente, mensajes, h, recargar }: { cliente: string; mensajes: FichaPortal['mensajes']; h: H; recargar: () => void }) {
  const [texto, setTexto] = useState('')
  const sinLeer = mensajes.filter((m) => m.de === 'cliente' && !m.leido).length
  // Al abrir la conversación, lo del cliente queda leído (y deja de salir en «Lo que tienes que hacer»).
  useEffect(() => { if (sinLeer > 0) void marcarLeidos(cliente).then(recargar, () => undefined) }, [cliente, sinLeer, recargar])
  return (
    <section aria-labelledby="gp-mensajes" className="g4-bloque">
      <div className="g4-bloque-cabecera"><h2 id="gp-mensajes" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Mensajes</h2>
        {sinLeer > 0 && <span className="g4-etiqueta" data-tono="aviso">{sinLeer} sin leer</span>}</div>
      {mensajes.length === 0 && <p className="g4-pequeno" style={{ fontSize: 14 }}>Aún no os habéis escrito por el portal.</p>}
      <div role="log" aria-label="Conversación con el cliente" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
        {mensajes.slice(-50).map((m) => (
          <div key={m.id} style={{ alignSelf: m.de === 'gestoria' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.de === 'gestoria' ? '#E8F0FE' : '#F3F5F9', borderRadius: 12, padding: '10px 14px' }}>
            <div className="g4-pequeno">{m.autor} · {fechaHora(m.cuando)}</div>
            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.texto}</div>
            {m.adjuntos?.map((a) => <AbrirFichero key={a.ruta} ruta={a.ruta} h={h} texto={`📎 ${a.nombre}`} />)}
          </div>
        ))}
      </div>
      <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => enviarMensaje(cliente, texto.trim())).then((ok) => { if (ok) setTexto('') }) }}>
        <label className="g4-campo g4-campo-azul">Contestar<textarea value={texto} onChange={(e) => setTexto(e.target.value)} required rows={3} maxLength={4000}
          style={{ border: '1px solid #C98A3E', borderRadius: 10, padding: 12, font: 'inherit', fontSize: 14, fontWeight: 500 }} /></label>
        <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo || !texto.trim()} style={{ alignSelf: 'flex-start' }}>Enviar</button>
      </form>
    </section>
  )
}

function Peticiones({ cuenta, cliente, peticiones, h }: { cuenta: string; cliente: string; peticiones: FichaPortal['peticiones']; h: H }) {
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<'firmar' | 'subir' | 'contestar'>('subir')
  const [titulo, setTitulo] = useState('')
  const [detalle, setDetalle] = useState('')
  const [fechaLimite, setFechaLimite] = useState('')
  const [pdf, setPdf] = useState<File | null>(null)
  const vivas = peticiones.filter((q) => q.estado === 'pendiente')
  const cerradas = peticiones.filter((q) => q.estado !== 'pendiente').slice(0, 10)
  return (
    <section aria-labelledby="gp-peticiones" className="g4-bloque">
      <div className="g4-bloque-cabecera"><h2 id="gp-peticiones" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Lo que le pides</h2>
        <button type="button" className="g4-enlace" onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : '+ Pedirle algo'}</button></div>
      {abierto && (
        <form className="g4-formulario" onSubmit={(e) => {
          e.preventDefault()
          void h.hacer(() => pedir(cuenta, cliente, { tipo, titulo: titulo.trim(), detalle: detalle.trim(), fecha: fechaLimite, pdf })).then((ok) => { if (ok) { setAbierto(false); setTitulo(''); setDetalle(''); setFechaLimite(''); setPdf(null) } })
        }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="g4-campo g4-campo-azul">Qué le pides<select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="subir">Que suba un documento</option><option value="firmar">Que firme un PDF</option><option value="contestar">Que conteste una pregunta</option></select></label>
            <label className="g4-campo g4-campo-azul">Para cuándo (si corre prisa)<input type="date" value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} /></label>
          </div>
          <label className="g4-campo g4-campo-azul">Título (lo ve el cliente)<input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={140}
            placeholder={tipo === 'firmar' ? 'Contrato de servicios 2027' : tipo === 'subir' ? 'Facturas de gasto de octubre' : '¿Tienes local alquilado?'} /></label>
          <label className="g4-campo g4-campo-azul">Detalle (opcional)<input value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={600} /></label>
          {tipo === 'firmar' && <label className="g4-campo g4-campo-azul">El PDF que firma<input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} required /></label>}
          <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo} style={{ alignSelf: 'flex-start' }}>Pedírselo</button>
          <span className="g4-pequeno" style={{ fontSize: 13 }}>Le llega un aviso por correo y lo ve en su portal, en Inicio.</span>
        </form>
      )}
      {vivas.length === 0 && !abierto && <p className="g4-pequeno" style={{ fontSize: 14 }}>No le has pedido nada que esté sin hacer.</p>}
      {vivas.map((q) => (
        <div key={q.id} className="g4-renglon">
          <span className="g4-cliente-textos"><b>{PIDE[q.tipo]}: {q.titulo}</b><span className="g4-pequeno">Pedido el {fecha(q.created_at)}{q.fecha_limite ? ` · para el ${fecha(q.fecha_limite)}` : ''}{q.creada_por_name ? ` · ${q.creada_por_name}` : ''}</span></span>
          <button type="button" className="g4-enlace" disabled={h.haciendo} onClick={() => void h.hacer(() => anularPeticion(q.id))}>Anular</button>
        </div>
      ))}
      {cerradas.length > 0 && <>
        <h3 className="g4-seccion-titulo">Cerradas</h3>
        {cerradas.map((q) => (
          <div key={q.id} className="g4-renglon">
            <span className="g4-cliente-textos"><b>{PIDE[q.tipo]}: {q.titulo}</b>
              <span className="g4-pequeno">{q.estado === 'hecha' ? `Hecho el ${fecha(q.hecha_at)}${q.hecha_por_name ? ` por ${q.hecha_por_name}` : ''}` : `Anulada el ${fecha(q.hecha_at)}`}{q.respuesta ? ` · «${q.respuesta}»` : ''}</span></span>
            <span className="g4-etiqueta" data-tono={q.estado === 'hecha' ? 'bien' : undefined}>{q.estado === 'hecha' ? 'Hecho' : 'Anulada'}</span>
          </div>
        ))}
      </>}
    </section>
  )
}

function Invitar({ cliente, h }: { cliente: string; h: H }) {
  const [abierto, setAbierto] = useState(false)
  const [correo, setCorreo] = useState('')
  const [nombre, setNombre] = useState('')
  const [permiso, setPermiso] = useState<Permiso>('todo')
  if (!abierto) return <button type="button" className="g4-boton" data-tipo="primario" style={{ alignSelf: 'flex-start' }} onClick={() => setAbierto(true)}>Invitar al portal</button>
  return (
    <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => invitar(cliente, correo.trim(), nombre.trim(), permiso)).then((ok) => { if (ok) { setAbierto(false); setCorreo(''); setNombre('') } }) }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="g4-campo g4-campo-azul">Correo<input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required autoComplete="off" /></label>
        <label className="g4-campo g4-campo-azul">Nombre (opcional)<input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} /></label>
        <label className="g4-campo g4-campo-azul">Qué ve<select value={permiso} onChange={(e) => setPermiso(e.target.value as Permiso)}>
          <option value="todo">Todo</option><option value="facturas_documentos">Solo facturas y documentos</option></select></label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo}>Mandar la invitación</button>
        <button type="button" className="g4-boton" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      <span className="g4-pequeno" style={{ fontSize: 13 }}>Le llega un correo con tu marca y un enlace para entrar, sin contraseña. «Solo facturas y documentos» no ve recibos, trabajadores ni mensajes.</span>
    </form>
  )
}

function PagarDevuelto({ cuenta, h }: { cuenta: string; h: H }) {
  const [formas, setFormas] = useState<('banco' | 'tarjeta')[] | null>(null)
  useEffect(() => { void leerPagarDevuelto(cuenta).then(setFormas, () => setFormas(null)) }, [cuenta])
  if (!formas) return null
  const cambiar = (f: 'banco' | 'tarjeta', si: boolean) => {
    const nuevas = si ? [...new Set([...formas, f])] : formas.filter((x) => x !== f)
    void h.hacer(() => guardarPagarDevuelto(cuenta, nuevas)).then((ok) => { if (ok) setFormas(nuevas) })
  }
  return (
    <section aria-labelledby="gp-devuelto" className="g4-bloque">
      <h2 id="gp-devuelto" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Cómo paga un recibo devuelto</h2>
      <p className="g4-pequeno" style={{ fontSize: 14, margin: 0 }}>Vale para todos tus clientes. Lo que no marques no le sale en su portal.</p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 14 }}>
        <input type="checkbox" checked={formas.includes('banco')} disabled={h.haciendo} onChange={(e) => cambiar('banco', e.target.checked)} style={{ width: 20, height: 20 }} />
        Pagar ahora desde su banco
      </label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 14 }}>
        <input type="checkbox" checked={formas.includes('tarjeta')} disabled={h.haciendo} onChange={(e) => cambiar('tarjeta', e.target.checked)} style={{ width: 20, height: 20 }} />
        Pagar con tarjeta o Bizum
      </label>
    </section>
  )
}
