// src/modules/conta/portal/pantallas/Cuenta.tsx
//
// GP · Tarea 3 · Tu cuenta: la cuenta donde se cargan los recibos (sus últimos
// dígitos, de Code 1) y «Cambiar de cuenta» (firmas una domiciliación nueva
// desde el móvil, en la página de GoCardless; en la demo, el sandbox), los
// datos para las facturas con «Pedir un cambio de datos», las personas con
// acceso con «Invitar a alguien», y lo que tiene contratado. Una sola lectura:
// conta_portal_cuenta.

import { useState } from 'react'
import { accion, leer } from '../cliente'
import { Cargando, Dialogo, Fallo } from '../comun'
import { cuentaEnmascarada, fecha, lineasDelRecibo } from '../formato'
import type { Cuenta as DatosCuenta } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'

export function Cuenta({ cliente, avisar }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosCuenta>('conta_portal_cuenta', cliente)
  const [cambiando, setCambiando] = useState(false)
  const [datosDialogo, setDatosDialogo] = useState(false)
  const [invitar, setInvitar] = useState(false)
  if (cargando && !datos) return <Cargando que="tu cuenta" />
  if (error || !datos) return <Fallo texto={error ?? 'No se ha podido cargar.'} otraVez={recargar} />
  const dom = datos.domiciliacion
  const iban = dom ? cuentaEnmascarada(dom.cuenta_pais, dom.cuenta_final) : null
  const contratado = lineasDelRecibo(datos.contratado)

  const cambiarCuenta = async () => {
    setCambiando(true)
    try {
      const r = await accion('cambiar_cuenta', { cliente })
      if (r.ok && typeof r.url === 'string') { window.location.href = r.url; return }
      avisar({ tipo: r.ok ? 'ok' : 'mal', texto: r.frase ?? 'Hecho.' })
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setCambiando(false) }
  }
  const quitar = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Quitar el acceso de ${nombre}? Ya no podrá entrar en tu espacio.`)) return
    try {
      const r = await leer<{ frase: string }>('conta_portal_acceso_quitar', { p_acceso: id })
      avisar({ tipo: 'ok', texto: r.frase }); recargar()
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) }
  }

  return (
    <>
      <h1 className="pt-h1">Tu cuenta</h1>
      <section className="pt-tarjeta" aria-label="Cuenta de cargo">
        <b style={{ fontSize: 15 }}>Cuenta donde se cargan tus recibos</b>
        <div className="pt-cabeza" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontFamily: 'var(--titulo)', fontSize: 18, fontWeight: 700 }}>{iban ?? (dom ? 'Cuenta domiciliada' : 'Sin cuenta domiciliada')}</span>
            {dom && <span style={{ fontSize: 12, color: '#0B6B4F', fontWeight: 600 }}>Domiciliación firmada{dom.firmada ? ` el ${fecha(dom.firmada)}` : ''}{dom.banco ? ` · ${dom.banco}` : ''}</span>}
          </div>
          <button type="button" className="pt-boton sec chico" disabled={cambiando} onClick={cambiarCuenta}>{cambiando ? 'Abriendo…' : datos.cambio_en_marcha ? 'Seguir con el cambio' : 'Cambiar de cuenta'}</button>
        </div>
        <div className="pt-nota">Al cambiarla firmas una domiciliación nueva desde el móvil. Desde ese día, tus recibos se cargan en la cuenta nueva.</div>
      </section>

      <section className="pt-tarjeta" style={{ gap: 4 }} aria-label="Tus datos para las facturas">
        <b style={{ fontSize: 15, marginBottom: 6 }}>Tus datos para las facturas</b>
        {datos.datos && [['Razón social', datos.datos.razon_social], ['NIF', datos.datos.nif], ['Dirección', datos.datos.direccion], ['Correo para las facturas', datos.datos.correo_facturas]]
          .map(([k, v]) => <div className="pt-datos" key={k}><span>{k}</span><b style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{v || '—'}</b></div>)}
        {datos.cambio_datos_abierto
          ? <div className="pt-nota" style={{ marginTop: 8 }}>Ya le has pedido un cambio a tu gestoría: lo está revisando.</div>
          : <button type="button" className="pt-boton enlace" style={{ marginTop: 8, alignSelf: 'flex-start' }} onClick={() => setDatosDialogo(true)}>Pedir un cambio de datos</button>}
      </section>

      <section className="pt-tarjeta" style={{ gap: 4 }} aria-label="Personas con acceso">
        <b style={{ fontSize: 15, marginBottom: 6 }}>Personas con acceso</b>
        {datos.personas.map((p) => (
          <div className="pt-datos" key={p.id}>
            <span style={{ color: 'var(--tinta)' }}><b style={{ fontWeight: 600 }}>{p.nombre}</b>{p.nombre !== p.correo && <span className="pt-nota"> · {p.correo}</span>}{!p.ha_entrado && <span className="pt-nota"> · aún no ha entrado</span>}</span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="pt-nota" style={{ fontSize: 14 }}>{p.permiso === 'todo' ? 'Todo' : 'Facturas y documentos'}</span>
              {!p.soy_yo && <button type="button" className="pt-boton enlace" onClick={() => quitar(p.id, p.nombre)}>Quitar</button>}
            </span>
          </div>
        ))}
        <button type="button" className="pt-boton enlace" style={{ marginTop: 8, alignSelf: 'flex-start', textAlign: 'left' }} onClick={() => setInvitar(true)}>Invitar a alguien (por ejemplo, tu administrativa)</button>
      </section>

      <section className="pt-tarjeta" style={{ gap: 8 }} aria-label="Lo que tienes contratado">
        <b style={{ fontSize: 15 }}>Lo que tienes contratado</b>
        {contratado.length === 0 && <div className="pt-nota">Tu gestoría aún no ha preparado ningún recibo.</div>}
        {contratado.map((l, i) => <div className="pt-datos" key={i} style={{ borderBottom: 0, padding: 0 }}><span style={{ color: 'var(--tinta)' }}>{l.texto}</span><b style={{ fontWeight: 600 }}>{l.importe}</b></div>)}
      </section>

      {datosDialogo && <CambioDatos cliente={cliente} cerrar={() => setDatosDialogo(false)} hecho={(t) => { setDatosDialogo(false); avisar({ tipo: 'ok', texto: t }); recargar() }} avisar={avisar} />}
      {invitar && <Invitar cliente={cliente} cerrar={() => setInvitar(false)} hecho={(t) => { setInvitar(false); avisar({ tipo: 'ok', texto: t }); recargar() }} avisar={avisar} />}
    </>
  )
}

function CambioDatos({ cliente, cerrar, hecho, avisar }: { cliente: string; cerrar: () => void; hecho: (t: string) => void; avisar: Pantalla['avisar'] }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const enviar = async () => {
    if (!texto.trim()) { avisar({ tipo: 'mal', texto: 'Escribe qué hay que cambiar.' }); return }
    setEnviando(true)
    try { hecho((await leer<{ frase: string }>('conta_portal_incidencia_crear', { p_party: cliente, p_tipo: 'cambio_datos', p_texto: texto, p_recibo: null })).frase) }
    catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setEnviando(false) }
  }
  return (
    <Dialogo titulo="Pedir un cambio de datos" cerrar={cerrar}>
      <div className="pt-nota" style={{ fontSize: 13 }}>Tu gestoría lo cambia y te avisa. Las facturas ya emitidas no cambian.</div>
      <label className="pt-campo">Qué hay que cambiar<textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={3000} placeholder="Por ejemplo: la dirección es ahora…" /></label>
      <div className="pt-botones"><button type="button" className="pt-boton" disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar a mi gestoría'}</button></div>
    </Dialogo>
  )
}

function Invitar({ cliente, cerrar, hecho, avisar }: { cliente: string; cerrar: () => void; hecho: (t: string) => void; avisar: Pantalla['avisar'] }) {
  const [f, setF] = useState({ nombre: '', correo: '', permiso: 'facturas_documentos' })
  const [enviando, setEnviando] = useState(false)
  const enviar = async () => {
    setEnviando(true)
    try {
      const r = await accion('invitar', { cliente, ...f })
      if (r.ok) hecho(r.frase ?? 'Invitada.')
      else avisar({ tipo: 'mal', texto: r.frase ?? 'No se ha podido invitar.' })
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setEnviando(false) }
  }
  return (
    <Dialogo titulo="Invitar a alguien" cerrar={cerrar}>
      <div className="pt-nota" style={{ fontSize: 13 }}>Le llega un correo con un enlace para entrar, sin contraseña.</div>
      <label className="pt-campo">Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
      <label className="pt-campo">Correo<input type="email" inputMode="email" autoComplete="off" value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} /></label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend className="pt-campo" style={{ marginBottom: 6 }}>Qué puede ver</legend>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" name="permiso" checked={f.permiso === 'facturas_documentos'} onChange={() => setF({ ...f, permiso: 'facturas_documentos' })} /> Facturas y documentos</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="radio" name="permiso" checked={f.permiso === 'todo'} onChange={() => setF({ ...f, permiso: 'todo' })} /> Todo (también recibos, trabajadores y mensajes)</label>
      </fieldset>
      <div className="pt-botones"><button type="button" className="pt-boton" disabled={enviando || !f.correo} onClick={enviar}>{enviando ? 'Invitando…' : 'Invitar'}</button></div>
    </Dialogo>
  )
}
