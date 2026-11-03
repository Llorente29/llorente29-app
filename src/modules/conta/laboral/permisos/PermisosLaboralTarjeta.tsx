// src/modules/conta/laboral/permisos/PermisosLaboralTarjeta.tsx
//
// N1 · PR 2 (02/11/2026) · En Sumied › Laboral › Equipo, para el administrador:
// quién tiene el permiso de Laboral, con su permiso en palabras y quién se lo
// dio y cuándo. Se da y se quita en la ficha de cada persona, «Más acciones».

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Chip, Tarjeta } from '@/modules/conta/diseno'
import { filasDePermiso, leerPermisos, QUE_VE, type FilaPermiso } from './permisosLaboral'

export default function PermisosLaboralTarjeta() {
  const { activeAccountId, staff } = useApp()
  const [filas, setFilas] = useState<FilaPermiso[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeAccountId) return
    let vivo = true
    const nombres = new Map(staff.map((e) => [e.id, e.name]))
    leerPermisos(activeAccountId)
      .then(({ perfiles, permisos }) => { if (vivo) setFilas(filasDePermiso(perfiles, permisos, (id) => nombres.get(id))) })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se ha podido leer quién tiene el permiso.') })
    return () => { vivo = false }
  }, [activeAccountId, staff])

  const dados = filas?.filter((f) => !f.porSerAdministrador).length ?? 0
  return (
    <div data-prueba="permisos-laboral">
      <Tarjeta titulo="Quién tiene el permiso de Laboral"
        apoyo={`${QUE_VE}. Se da y se quita en la ficha de cada persona, en «Más acciones».`}>
        {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
        {!error && filas === null && <p className="s-apoyo" role="status">Leyendo…</p>}
        {filas && (
          <>
            <table className="s-tabla" data-prueba="permisos-laboral-tabla">
              <thead><tr><th>Persona</th><th>Permiso</th><th>Quién se lo dio y cuándo</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.userId} data-prueba="permisos-laboral-fila">
                    <td>{f.nombre}</td>
                    <td>{f.porSerAdministrador ? <Chip tono="neutro">Administrador</Chip> : <Chip tono="accion">Permiso de Laboral</Chip>}</td>
                    <td>{f.origen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="s-apoyo">{dados === 0 ? 'Nadie más lo tiene: solo los administradores.' : `${dados === 1 ? '1 persona lo tiene' : `${dados} personas lo tienen`} además de los administradores.`}</p>
          </>
        )}
      </Tarjeta>
    </div>
  )
}
