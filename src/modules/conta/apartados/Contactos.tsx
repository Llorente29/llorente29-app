// src/modules/conta/apartados/Contactos.tsx
//
// Con quién se habla en ese proveedor, cada uno con su papel (pedidos,
// comercial, administración, reparto). Es la ÚNICA fuente de email y teléfono
// del proveedor desde el C01. El principal es el que usa el aviso de ficha
// técnica caducada (compliance-doc-notify) y el que sale primero.

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Campo, Dialogo, Guardado } from '@/modules/conta/components/ui'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { accionContacto } from '@/modules/conta/lib/textosFicha'
import {
  actualizarContacto, borrarContacto, crearContacto, hacerPrincipal, type DatosContacto,
} from '@/modules/conta/services/proveedorService'
import { ROLE_LABEL, type ContactRole, type ContactoProveedor } from '@/modules/conta/types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Contactos() {
  const { datos } = useFicha()
  const [params, setParams] = useSearchParams()
  const nuevo = params.get('nuevo') as ContactRole | null
  const [editando, setEditando] = useState<ContactoProveedor | 'nuevo' | null>(nuevo && nuevo in ROLE_LABEL ? 'nuevo' : null)
  const [borrando, setBorrando] = useState<ContactoProveedor | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const roles = new Set(datos.contactos.map((c) => c.role))

  function cerrar(texto?: string) {
    setEditando(null)
    if (params.has('nuevo')) { params.delete('nuevo'); setParams(params, { replace: true }) }
    if (texto) avisar(texto)
  }

  return (
    <div className="cf-form cf-form-ancho" style={{ maxWidth: 720 }}>
      {!roles.has('orders') && <div className="cf-aviso" id="campo-orders">Falta el contacto de pedidos: es a quien llama el botón «Llamar» del móvil.</div>}
      {!roles.has('admin') && <div className="cf-aviso" id="campo-admin">Falta el contacto de administración: el que lleva las facturas y los pagos.</div>}

      {datos.contactos.length === 0 && <p className="cf-nota" style={{ margin: 0 }}>Aún no hay nadie apuntado.</p>}
      {datos.contactos.map((c) => {
        const a = accionContacto(c)
        return (
          <div key={c.id} className="cf-tarjeta" style={{ gap: 6 }}>
            <div className="cf-contacto">
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="cf-contacto-nombre">{c.name}{c.isPrimary && <span className="cf-etiqueta" style={{ marginLeft: 8, fontSize: 12 }}>Principal</span>}</span>
                <span className="cf-contacto-detalle">{ROLE_LABEL[c.role]}</span>
                {c.phone && <span className="cf-contacto-detalle">{c.phone}</span>}
                {c.email && <span className="cf-contacto-detalle">{c.email}</span>}
                {c.notes && <span className="cf-contacto-detalle">{c.notes}</span>}
              </div>
              {a && <a href={a.href}>{a.texto}</a>}
            </div>
            <div className="cf-pie-form" style={{ gap: 4 }}>
              <button type="button" className="cf-boton-texto" onClick={() => setEditando(c)}>Editar</button>
              {!c.isPrimary && <BotonPrincipal c={c} alHecho={avisar} />}
              <button type="button" className="cf-boton-texto cf-boton-peligro" onClick={() => setBorrando(c)}>Quitar</button>
            </div>
          </div>
        )
      })}
      <button type="button" className="cf-anadir" onClick={() => setEditando('nuevo')}>+ Añadir contacto</button>
      <Guardado texto={aviso} />

      {editando && (
        <FormContacto
          contacto={editando === 'nuevo' ? null : editando}
          rolInicial={editando === 'nuevo' ? (nuevo && nuevo in ROLE_LABEL ? nuevo : !roles.has('orders') ? 'orders' : !roles.has('admin') ? 'admin' : 'sales') : editando.role}
          alCerrar={cerrar}
        />
      )}
      {borrando && <DialogoQuitar c={borrando} alCerrar={(t) => { setBorrando(null); if (t) avisar(t) }} />}
    </div>
  )
}

function BotonPrincipal({ c, alHecho }: { c: ContactoProveedor; alHecho: (t: string) => void }) {
  const { datos, recargar } = useFicha()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button type="button" className="cf-boton-texto" disabled={ocupado} onClick={async () => {
        setOcupado(true); setError(null)
        try { await hacerPrincipal(datos.ficha.id, c.id); await recargar(); alHecho(`${c.name} es ahora el contacto principal.`) }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar.') }
        finally { setOcupado(false) }
      }}>Hacer principal</button>
      {error && <span className="cf-campo-error" role="alert">{error}</span>}
    </>
  )
}

function FormContacto({ contacto, rolInicial, alCerrar }: { contacto: ContactoProveedor | null; rolInicial: ContactRole; alCerrar: (texto?: string) => void }) {
  const { datos, actor, recargar } = useFicha()
  const [name, setName] = useState(contacto?.name ?? '')
  const [role, setRole] = useState<ContactRole>(rolInicial)
  const [phone, setPhone] = useState(contacto?.phone ?? '')
  const [email, setEmail] = useState(contacto?.email ?? '')
  const [notes, setNotes] = useState(contacto?.notes ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Pon su nombre (o el del departamento: «Pedidos»).'
    if (email.trim() && !EMAIL.test(email.trim())) errs.email = 'Este email no es correcto: revisa que tenga @ y el dominio.'
    if (!phone.trim() && !email.trim()) errs.phone = 'Pon al menos un teléfono o un email: si no, no hay forma de hablar con él.'
    setErrores(errs)
    if (Object.keys(errs).length > 0) return
    const d: DatosContacto = { name, role, phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null }
    setOcupado(true); setFallo(null)
    try {
      if (contacto) await actualizarContacto(contacto.id, d)
      // El primero que se apunta es el principal; los demás, no.
      else await crearContacto(datos.ficha.accountId, datos.ficha.id, d, actor, datos.contactos.length === 0)
      await recargar()
      alCerrar(contacto ? `${d.name.trim()} guardado.` : `${d.name.trim()} añadido como contacto de ${ROLE_LABEL[role].toLowerCase()}.`)
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo guardar.')
      setOcupado(false)
    }
  }

  return (
    <Dialogo titulo={contacto ? `Editar a ${contacto.name}` : 'Nuevo contacto'} alCerrar={() => alCerrar()}>
      <form className="cf-form" onSubmit={enviar} noValidate>
        {fallo && <div className="cf-error" role="alert">{fallo}</div>}
        <Campo campo="c-name" etiqueta="Nombre" error={errores.name}>
          {(p) => <input {...p} className="cf-input" value={name} onChange={(e) => setName(e.target.value)} />}
        </Campo>
        <Campo campo="c-role" etiqueta="Qué lleva">
          {(p) => (
            <select {...p} className="cf-select" value={role} onChange={(e) => setRole(e.target.value as ContactRole)}>
              {(Object.keys(ROLE_LABEL) as ContactRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          )}
        </Campo>
        <Campo campo="c-phone" etiqueta="Teléfono" error={errores.phone}>
          {(p) => <input {...p} className="cf-input" value={phone} type="tel" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />}
        </Campo>
        <Campo campo="c-email" etiqueta="Email" error={errores.email}>
          {(p) => <input {...p} className="cf-input" value={email} type="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} />}
        </Campo>
        <Campo campo="c-notes" etiqueta="Notas">
          {(p) => <input {...p} className="cf-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Horario, extensión…" />}
        </Campo>
        <div className="cf-pie-form">
          <button type="submit" className="cf-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="cf-boton-texto" onClick={() => alCerrar()}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  )
}

function DialogoQuitar({ c, alCerrar }: { c: ContactoProveedor; alCerrar: (texto?: string) => void }) {
  const { recargar } = useFicha()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialogo titulo={`¿Quitar a ${c.name}?`} alCerrar={() => alCerrar()}>
      <p style={{ margin: 0, fontSize: 15 }}>
        {c.isPrimary ? 'Es el contacto principal: el aviso de ficha técnica caducada se queda sin a quién escribir hasta que hagas principal a otro.' : 'Se quita de la ficha de este proveedor.'}
      </p>
      {error && <div className="cf-error" role="alert">{error}</div>}
      <div className="cf-pie-form">
        <button type="button" className="cf-boton" disabled={ocupado} onClick={async () => {
          setOcupado(true); setError(null)
          try { await borrarContacto(c.id); await recargar(); alCerrar(`${c.name} quitado.`) }
          catch (e) { setError(e instanceof Error ? e.message : 'No se pudo quitar.'); setOcupado(false) }
        }}>{ocupado ? 'Quitando…' : 'Quitar'}</button>
        <button type="button" className="cf-boton-texto" onClick={() => alCerrar()}>Cancelar</button>
      </div>
    </Dialogo>
  )
}
