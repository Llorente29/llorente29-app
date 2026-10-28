// src/modules/conta/laboral/PortalEmpleadoPage.tsx
//
// LS1 (28/10/2026) · Pieza nueva de Laboral en Sumied: el portal del
// trabajador visto desde la empresa. Qué hace cada persona desde su móvil, por
// dónde entra, y quién tiene ya acceso. Para quien lo tiene, el enlace de un
// solo uso con su QR (el mismo de Folvy, `AccesoTrabajadorPanel`); para quien
// no, el camino a su ficha, donde se le da.
//
// Se enseña a todas las personas activas, tengan acceso o no (regla 7): el
// acceso decide la etiqueta, no si sale en la lista.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import AccesoTrabajadorPanel from '@/components/personal/AccesoTrabajadorPanel'
import { supabase } from '@/lib/supabase'
import { MARCAS } from '@/marca/marca'

const QUE_HACE = [
  'Fichar la entrada, las pausas y la salida desde el móvil, con la distancia al centro.',
  'Ver su registro de jornada del mes y firmarlo.',
  'Pedir que se corrija un fichaje: llega a «Para revisar».',
  'Pedir vacaciones y ausencias, y ver su cuadrante.',
  'Ver sus nóminas y documentos.',
]

/** La dirección por la que se entra: la de Sumied si la tiene, si no ésta. */
function direccionDeEntrada(): string {
  const visible = MARCAS.sumied.direccionVisible
  const dominio = MARCAS.sumied.dominios[0]
  if (typeof window !== 'undefined' && MARCAS.sumied.dominios.includes(window.location.hostname)) return `${window.location.origin}/acceso`
  return dominio ? `https://${dominio}/acceso` : visible ?? `${window.location.origin}/acceso`
}

export default function PortalEmpleadoPage() {
  const { staff, locations, activeAccountId } = useApp()
  const navigate = useNavigate()
  const [usuarios, setUsuarios] = useState<Map<string, string | null> | null>(null)
  const [error, setError] = useState('')
  const activos = staff.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))

  useEffect(() => {
    if (!supabase || !activeAccountId) return
    let vivo = true
    supabase.from('employees').select('id, username').eq('account_id', activeAccountId).then(({ data, error: e }) => {
      if (!vivo) return
      if (e) { setError(e.message); return }
      setUsuarios(new Map((data ?? []).map((r) => [r.id as string, (r.username as string | null) ?? null])))
    })
    return () => { vivo = false }
  }, [activeAccountId, staff.length])

  const conAcceso = usuarios ? activos.filter((e) => usuarios.get(e.id)).length : null
  const centro = (id: string) => locations.find((l) => l.id === id)?.name ?? 'Sin centro'

  return (
    <div className="s-pagina" data-prueba="laboral-portal">
      <Tarjeta titulo="El portal de tu equipo"
        apoyo={<>Cada persona entra desde su móvil en <b className="s-cifra">{direccionDeEntrada()}</b> con el usuario y la contraseña que le diste al darla de alta, o con el enlace de un solo uso de aquí abajo.</>}>
        <ul className="s-laboral-lista">
          {QUE_HACE.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </Tarjeta>

      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer quién tiene acceso: {error}</p>}

      <Tarjeta compacta titulo={conAcceso == null ? 'Personas' : `Personas · ${conAcceso} de ${activos.length} con acceso`}>
        {activos.length === 0 ? (
          <p className="s-apoyo">Aún no hay nadie dado de alta. Hazlo desde «Equipo».</p>
        ) : (
          <div className="l-revisar">
            {activos.map((e) => {
              const usuario = usuarios?.get(e.id) ?? null
              return (
                <div key={e.id} className="l-revisar-fila" data-prueba="portal-persona">
                  {usuarios == null ? <Chip tono="neutro">…</Chip>
                    : usuario ? <Chip tono="seguro">Con acceso</Chip> : <Chip tono="duda">Sin acceso</Chip>}
                  <div className="l-revisar-texto">
                    <b>{e.name}</b>
                    <span>{centro(e.locationId)}{usuario ? <> · usuario <span className="s-cifra">{usuario}</span></> : ' · aún no puede entrar al portal'}</span>
                  </div>
                  {usuario
                    ? <AccesoTrabajadorPanel employeeId={e.id} employeeName={e.name} />
                    : <Boton variante="secundario" onClick={() => navigate(`/conta/laboral?employee=${e.id}`)}>Darle acceso</Boton>}
                </div>
              )
            })}
          </div>
        )}
      </Tarjeta>
    </div>
  )
}
