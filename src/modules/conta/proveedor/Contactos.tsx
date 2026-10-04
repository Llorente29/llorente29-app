// src/modules/conta/proveedor/Contactos.tsx
//
// Con quién se habla en ese proveedor, cada uno con su papel (pedidos,
// comercial, administración, reparto). Es la ÚNICA fuente de email y teléfono
// del proveedor desde el C01b: las columnas viejas de `supplier` ya no se
// leen ni se escriben. El de administración (y si no hay, el principal) es a
// quien escribe el aviso de documento caducado (compliance_docs_due).
//
// Dos caras: la tarjeta «Con quién hablas» del resumen (N4) y la pestaña
// «Contactos», donde se añade, edita, hace principal y quita.

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Campo, Dialogo, Pildoras } from '@/modules/conta/proveedor/piezas'
import { Guardado, Inicial } from '@/modules/conta/ui/piezas'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { accionContacto } from '@/modules/conta/lib/textosFicha'
import { iniciales } from '@/modules/conta/lib/formato'
import {
  actualizarContacto, borrarContacto, crearContacto, hacerPrincipal, type DatosContacto,
} from '@/modules/conta/services/proveedorService'
import { ROLE_LABEL, type ContactRole, type ContactoProveedor } from '@/modules/conta/types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** «Pedidos · 600 000 000», «Comercial · luis@ejemplo.test». */
function apoyo(c: ContactoProveedor): string {
  return [ROLE_LABEL[c.role], c.phone ?? c.email].filter(Boolean).join(' · ')
}

/** La tarjeta «Con quién hablas» del resumen (N4). */
export function ConQuienHablas() {
  const { datos, rutaApartado } = useFicha()
  return (
    <section className="cx-tarjeta" aria-labelledby="cxp-quien">
      <div className="cx-tarjeta-cabeza">
        <h2 id="cxp-quien" className="cx-tarjeta-titulo">Con quién hablas</h2>
        <Link to={`${rutaApartado('contactos')}?nuevo=1`} style={{ fontSize: 14, fontWeight: 600 }}>+ Añadir</Link>
      </div>
      {datos.contactos.length === 0 && (
        <p className="cx-ayuda" style={{ margin: 0, borderTop: '1px solid var(--cx-linea)', paddingTop: 9 }}>
          Aún no hay nadie apuntado. Añade a quien le haces los pedidos.
        </p>
      )}
      {datos.contactos.map((c) => {
        const a = accionContacto(c)
        return (
          <div key={c.id} className="cxp-contacto">
            <Inicial texto={iniciales(c.name)} redonda />
            <div className="cxp-contacto-texto">
              <div className="cxp-contacto-nombre">{c.name}</div>
              <div className="cxp-contacto-apoyo">{apoyo(c)}</div>
            </div>
            {a && <a href={a.href} aria-label={`${a.texto} a ${c.name}`}>{a.texto}</a>}
          </div>
        )
      })}
    </section>
  )
}

/** La pestaña «Contactos». */
export default function Contactos() {
  const { datos } = useFicha()
  const [params, setParams] = useSearchParams()
  const pedido = params.get('nuevo')
  const rolPedido = pedido && pedido in ROLE_LABEL ? pedido as ContactRole : null
  const [editando, setEditando] = useState<ContactoProveedor | 'nuevo' | null>(pedido ? 'nuevo' : null)
  const [borrando, setBorrando] = useState<ContactoProveedor | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const roles = new Set(datos.contactos.map((c) => c.role))

  function cerrar(texto?: string) {
    setEditando(null)
    if (params.has('nuevo')) { params.delete('nuevo'); setParams(params, { replace: true }) }
    if (texto) avisar(texto)
  }

  return (
    <div className="cx-formulario">
      {!roles.has('orders') && <div className="cx-aviso" id="campo-orders" tabIndex={-1}>Falta el contacto de pedidos: es a quien llama el botón «Llamar a pedidos» del móvil.</div>}
      {!roles.has('admin') && (
        <div className="cx-aviso" id="campo-admin" tabIndex={-1}>
          Falta: contacto de administración. Es quien lleva las facturas y los pagos, y a quien se avisa de un documento suyo que caduca.
        </div>
      )}
      <Guardado texto={aviso} />
      <div className="cx-tarjeta" style={{ padding: '6px 18px' }}>
        {datos.contactos.length === 0 && <p className="cx-ayuda" style={{ margin: '12px 0' }}>Aún no hay nadie apuntado.</p>}
        {datos.contactos.map((c) => {
          const a = accionContacto(c)
          return (
            <div key={c.id} className="cxp-contacto" style={{ flexWrap: 'wrap' }}>
              <Inicial texto={iniciales(c.name)} redonda />
              <div className="cxp-contacto-texto">
                <div className="cxp-contacto-nombre">
                  {c.name}{c.isPrimary && <span className="cx-chip" style={{ marginLeft: 8 }}>Principal</span>}
                </div>
                <div className="cxp-contacto-apoyo">{ROLE_LABEL[c.role]}{c.phone ? ` · ${c.phone}` : ''}{c.email ? ` · ${c.email}` : ''}</div>
                {c.notes && <div className="cxp-contacto-apoyo">{c.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                {a && <a href={a.href}>{a.texto}</a>}
                <button type="button" className="cx-enlace" onClick={() => setEditando(c)}>Editar</button>
                {!c.isPrimary && <BotonPrincipal c={c} alHecho={avisar} />}
                <button type="button" className="cx-enlace" onClick={() => setBorrando(c)}>Quitar</button>
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" className="cx-boton-sec" style={{ alignSelf: 'flex-start' }} onClick={() => setEditando('nuevo')}>+ Añadir contacto</button>

      {editando && (
        <FormContacto
          contacto={editando === 'nuevo' ? null : editando}
          rolInicial={editando === 'nuevo' ? (rolPedido ?? (!roles.has('orders') ? 'orders' : !roles.has('admin') ? 'admin' : 'sales')) : editando.role}
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
      <button type="button" className="cx-enlace" disabled={ocupado} onClick={async () => {
        setOcupado(true); setError(null)
        try { await hacerPrincipal(datos.ficha.id, c.id); await recargar(); alHecho(`${c.name} es ahora el contacto principal.`) }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar.') }
        finally { setOcupado(false) }
      }}>Hacer principal</button>
      {error && <span className="cx-error" role="alert">{error}</span>}
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
      <form className="cx-formulario" onSubmit={enviar} noValidate>
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
        <Campo campo="c-name" etiqueta="Nombre" error={errores.name}>
          {(p) => <input {...p} className="cx-input" value={name} onChange={(e) => setName(e.target.value)} />}
        </Campo>
        <Pildoras<ContactRole> campo="c-role" etiqueta="Qué lleva"
          opciones={(Object.keys(ROLE_LABEL) as ContactRole[]).map((r) => ({ valor: r, texto: ROLE_LABEL[r] }))}
          elegidas={[role]} alCambiar={(v) => { if (v[0]) setRole(v[0]) }} />
        <Campo campo="c-phone" etiqueta="Teléfono" error={errores.phone}>
          {(p) => <input {...p} className="cx-input" value={phone} type="tel" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />}
        </Campo>
        <Campo campo="c-email" etiqueta="Email" error={errores.email}>
          {(p) => <input {...p} className="cx-input" value={email} type="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} />}
        </Campo>
        <Campo campo="c-notes" etiqueta="Notas">
          {(p) => <input {...p} className="cx-input" value={notes} placeholder="Horario, extensión…" onChange={(e) => setNotes(e.target.value)} />}
        </Campo>
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={() => alCerrar()}>Cancelar</button>
          <button type="submit" className="cx-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
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
        {c.isPrimary
          ? 'Es el contacto principal. Si no hay contacto de administración, el aviso de documento caducado se queda sin a quién escribir hasta que hagas principal a otro.'
          : 'Se quita de la ficha de este proveedor.'}
      </p>
      {error && <div className="cx-error" role="alert">{error}</div>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={() => alCerrar()}>Cancelar</button>
        <button type="button" className="cx-boton" disabled={ocupado} onClick={async () => {
          setOcupado(true); setError(null)
          try { await borrarContacto(c.id); await recargar(); alCerrar(`${c.name} quitado.`) }
          catch (e) { setError(e instanceof Error ? e.message : 'No se pudo quitar.'); setOcupado(false) }
        }}>{ocupado ? 'Quitando…' : 'Quitar'}</button>
      </div>
    </Dialogo>
  )
}
