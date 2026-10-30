// src/modules/personal/laboral/AltaCorta.tsx
//
// LS1 (28/10/2026) · Pieza nueva de Laboral en Sumied: dar de alta a una
// persona con lo justo (nombre, DNI, teléfono, correo, puesto, centro,
// jornada y fecha) y, en el mismo paso, su acceso al portal para fichar desde
// el móvil. Usa el mismo alta de Folvy (`manage-employee`), así que la persona
// queda igual que una dada de alta en Personal.
//
// Al acabar enseña el usuario y la contraseña para dárselos (no se vuelven a
// ver), o el motivo por el que no se ha hecho (regla 8).

import { useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Boton, Dialogo } from '@/modules/conta/diseno'
import { createEmployeeWithAccount } from '@/services/employeeAuthService'
import { contrasenaDeAlta, dniLimpio, errorDeAlta, usuarioDeAlta, type DatosAlta } from './altaCorta'

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

export default function AltaCorta({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (id: string) => void }) {
  const { locations, refreshStaff } = useApp()
  const abiertos = locations.filter((l) => l.active)
  const [d, setD] = useState<DatosAlta>({
    nombre: '', dni: '', telefono: '', correo: '', puesto: '', centroId: abiertos.length === 1 ? abiertos[0].id : '', jornada: '40', fecha: hoy(),
  })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<{ nombre: string; usuario: string; contrasena: string } | null>(null)
  const cambia = (k: keyof DatosAlta) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })

  async function darDeAlta() {
    const fallo = errorDeAlta(d)
    if (fallo) { setError(fallo); return }
    setEnviando(true); setError('')
    const contrasena = contrasenaDeAlta()
    try {
      for (let intento = 0; intento < 5; intento++) {
        const usuario = usuarioDeAlta(d.nombre, intento)
        const r = await createEmployeeWithAccount({
          name: d.nombre.trim().replace(/\s+/g, ' '),
          username: usuario,
          password: contrasena,
          role: 'worker',
          email: d.correo.trim() || undefined,
          dni: dniLimpio(d.dni) || undefined,
          phone: d.telefono.replace(/[\s().-]/g, '') || undefined,
          position: d.puesto.trim() || undefined,
          locationId: d.centroId,
          weeklyHours: Number(d.jornada.trim().replace(',', '.')),
          startDate: d.fecha,
        })
        if (r.ok) {
          setHecho({ nombre: d.nombre.trim(), usuario: r.username || usuario, contrasena })
          await refreshStaff().catch(() => undefined)
          if (r.employee?.id) alCrear(r.employee.id)
          return
        }
        // El usuario ya lo tiene otra persona (o una cuenta suelta con ese nombre): se prueba con el siguiente número.
        if (!/ya está en uso|ya existe una cuenta/i.test(r.error ?? '')) { setError(`No se ha dado de alta: ${r.error ?? 'error desconocido'}`); return }
      }
      setError('No se ha dado de alta: no queda un usuario libre con ese nombre. Escribe el segundo apellido.')
    } finally {
      setEnviando(false)
    }
  }

  if (hecho) {
    return (
      <Dialogo titulo={`${hecho.nombre}, dado de alta`} alCerrar={alCerrar}
        explicacion="Dale estos datos para entrar en su portal y fichar desde el móvil. La contraseña no se vuelve a ver: apúntala ahora."
        acciones={<Boton variante="principal" onClick={alCerrar}>Hecho</Boton>}>
        <dl className="s-laboral-credenciales" data-prueba="alta-credenciales">
          <dt>Usuario</dt><dd className="s-cifra" data-prueba="alta-usuario">{hecho.usuario}</dd>
          <dt>Contraseña</dt><dd className="s-cifra" data-prueba="alta-contrasena">{hecho.contrasena}</dd>
          <dt>Dónde</dt><dd data-prueba="alta-donde">{window.location.origin}/acceso</dd>
        </dl>
      </Dialogo>
    )
  }

  return (
    <Dialogo titulo="Dar de alta a una persona" alCerrar={alCerrar}
      explicacion="Lo justo para que empiece a fichar. El contrato y el resto de la ficha se completan después."
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" onClick={darDeAlta} disabled={enviando} data-prueba="alta-guardar">{enviando ? 'Dando de alta…' : 'Dar de alta'}</Boton>
      </>}>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert" data-prueba="alta-error">{error}</p>}
      {abiertos.length === 0 && <p className="s-aviso-lista" data-tono="duda" role="alert">Antes hace falta un centro de trabajo: créalo en «Centros».</p>}
      <label className="s-campo"><span className="s-campo-etiqueta">Nombre y apellidos</span>
        <input className="s-control" value={d.nombre} onChange={cambia('nombre')} autoFocus data-prueba="alta-nombre" /></label>
      <div className="s-laboral-fila">
        <label className="s-campo"><span className="s-campo-etiqueta">DNI o NIE</span>
          <input className="s-control" value={d.dni} onChange={cambia('dni')} placeholder="12345678Z" data-prueba="alta-dni" /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Teléfono</span>
          <input className="s-control" type="tel" value={d.telefono} onChange={cambia('telefono')} data-prueba="alta-telefono" /></label>
      </div>
      <label className="s-campo"><span className="s-campo-etiqueta">Correo (opcional)</span>
        <input className="s-control" type="email" value={d.correo} onChange={cambia('correo')} data-prueba="alta-correo" /></label>
      <div className="s-laboral-fila">
        <label className="s-campo"><span className="s-campo-etiqueta">Puesto</span>
          <input className="s-control" value={d.puesto} onChange={cambia('puesto')} placeholder="Administración" data-prueba="alta-puesto" /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Centro de trabajo</span>
          <select className="s-control" value={d.centroId} onChange={cambia('centroId')} data-prueba="alta-centro">
            <option value="">Elige…</option>
            {abiertos.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
      </div>
      <div className="s-laboral-fila">
        <label className="s-campo"><span className="s-campo-etiqueta">Jornada (horas a la semana)</span>
          <input className="s-control" inputMode="decimal" value={d.jornada} onChange={cambia('jornada')} data-prueba="alta-jornada" /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Fecha de alta</span>
          <input className="s-control" type="date" value={d.fecha} onChange={cambia('fecha')} data-prueba="alta-fecha" /></label>
      </div>
    </Dialogo>
  )
}
