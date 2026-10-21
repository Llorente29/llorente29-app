// src/modules/conta/impuestos/AceptarAsesoriaPage.tsx
//
// I01b · P4b · La página de aceptar la invitación de una empresa a su asesoría
// (/conta/asesoria?t=…). Se abre con sesión o sin ella (AuthRouter y la ruta
// del módulo). Enseña quién invita, a qué y cómo, y un solo botón. Aceptar
// vincula la cuenta de ese correo si ya usa Sumied; si no, queda esperando el
// alta de la plataforma, y lo dice (regla 8).

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import '@/modules/conta/estilo'
import { Boton, Tarjeta } from '@/modules/conta/diseno'
import { diaMesCorto } from '@/modules/conta/lib/formato'
import { asesoria } from '@/modules/conta/services/impuestosService'

interface Vista { ok: boolean; mensaje?: string; estado?: string; empresa?: string; invita?: string; asesoria?: string; base?: string; correo?: string; expira?: string }

export default function AceptarAsesoriaPage() {
  const [busqueda] = useSearchParams()
  const token = busqueda.get('t') ?? ''
  const [v, setV] = useState<Vista | null>(null)
  const [hecho, setHecho] = useState<{ ok: boolean; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    if (!token) return
    asesoria('ver', { token }).then((r) => { if (vivo) setV(r as Vista) })
    return () => { vivo = false }
  }, [token])

  const aceptar = async () => {
    setEnviando(true)
    const r = await asesoria('aceptar', { token })
    setEnviando(false)
    setHecho({ ok: r.ok, texto: r.mensaje })
  }

  const vista: Vista | null = token ? v : { ok: false, mensaje: 'Ese enlace no está completo: ábrelo desde el correo.' }
  const como = vista?.base === 'power_of_attorney' ? 'con el poder que tiene en Hacienda' : 'como colaboradora social'
  return (
    <div className="cx cx-colores s-aceptar">
      <main className="s-pantalla s-aceptar-cuerpo">
        <h1 className="s-impuestos-titulo">Llevar los impuestos de una empresa</h1>
        {!vista && <Tarjeta titulo="Leyendo la invitación…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
        {vista && !vista.ok && <Tarjeta titulo="Esta invitación no se puede abrir" tono="falta"><p className="s-apoyo">{vista.mensaje}</p></Tarjeta>}
        {vista?.ok && vista.estado !== 'pending' && !hecho && (
          <Tarjeta titulo={vista.estado === 'accepted' ? 'Ya está aceptada' : vista.estado === 'waiting_approval' ? 'Ya está aceptada' : 'Esta invitación ya no vale'}
            tono={vista.estado === 'accepted' || vista.estado === 'waiting_approval' ? 'ok' : 'falta'}>
            <p className="s-apoyo">
              {vista.estado === 'accepted' ? `Entra con tu usuario: verás ${vista.empresa} en Impuestos.`
                : vista.estado === 'waiting_approval' ? 'Sumied está dando de alta tu cuenta: te llegará un correo para poner tu contraseña.'
                  : `${vista.estado === 'cancelled' ? 'La empresa la canceló' : 'Caducó'}. Pide a ${vista.empresa} que te mande otra.`}
            </p>
          </Tarjeta>
        )}
        {vista?.ok && vista.estado === 'pending' && !hecho && (
          <Tarjeta titulo={`${vista.empresa} te invita a llevar sus impuestos`}>
            <p>{vista.invita ? `${vista.invita}, de ${vista.empresa},` : vista.empresa} te invita a llevar sus impuestos en Sumied{vista.asesoria ? ` como ${vista.asesoria}` : ''}, {como}.</p>
            <p className="s-apoyo">Verás su calendario de impuestos, sus declaraciones y sus libros de IVA, y podrás prepararlos. Es para el correo {vista.correo}{vista.expira ? `, y caduca el ${diaMesCorto(vista.expira)}` : ''}.</p>
            <p className="s-apoyo">Si ya usas Sumied con ese correo, la verás en Impuestos en cuanto aceptes. Si no, te damos de alta y te llega un correo para poner tu contraseña.</p>
            <Boton variante="principal" grande disabled={enviando} onClick={aceptar}>{enviando ? 'Aceptando…' : 'Aceptar la invitación'}</Boton>
          </Tarjeta>
        )}
        {hecho && <Tarjeta titulo={hecho.ok ? 'Hecho' : 'No se ha podido aceptar'} tono={hecho.ok ? 'ok' : 'falta'}><p>{hecho.texto}</p></Tarjeta>}
      </main>
    </div>
  )
}
