// src/modules/conta/impuestos/Sociedades.tsx
//
// I01b · Impuestos › Impuesto de sociedades (respuesta 2 de Julio: la pestaña,
// con sus plazos y «Se calculará aquí pronto»). Los pagos a cuenta (202) y la
// declaración del año (200), con sus fechas, de conta_impuesto_calendario.
// Calcularlos es del I01c.

import { Boton, Tarjeta } from '@/modules/conta/diseno'
import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto } from '@/modules/conta/lib/formato'
import { nombreDeFila, nombreDeOficina, periodoEnPalabras, type Siguiente } from './calendario'
import { useCalendario } from './useCalendario'

const DE_SOCIEDADES = ['200', '202']

export function Sociedades({ companyId }: { companyId: string }) {
  const { datos, error, recargar } = useCalendario(companyId)
  const nivel = useNivel()
  const plazos: Siguiente[] = datos
    ? [...datos.filas, ...datos.siguiente].filter((x) => DE_SOCIEDADES.includes(x.modelo))
      .sort((a, b) => a.presentacion.localeCompare(b.presentacion))
    : []
  const presenta = datos?.modelos.filter((m) => DE_SOCIEDADES.includes(m.modelo)) ?? []
  const noPresenta = datos?.no_presenta.filter((m) => DE_SOCIEDADES.includes(m.modelo)) ?? []
  return (
    <div className="s-pantalla s-impuestos">
      <h1 className="cx-oculto">Impuestos · Impuesto de sociedades</h1>
      {error && (
        <Tarjeta titulo="No se han podido leer los plazos" tono="falta" accion={<Boton onClick={recargar}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo tus impuestos…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {!error && datos && (
        <Tarjeta compacta titulo="Impuesto de sociedades" apoyo="Se calculará aquí pronto. Mientras, aquí tienes sus plazos.">
          {presenta.length === 0 && (
            <p className="s-apoyo s-impuestos-vacio">
              {noPresenta.length > 0 ? noPresenta.map((m) => `No te sale el ${m.modelo}: ${m.por_que}`).join(' ') : 'Esta empresa no presenta el impuesto de sociedades.'}
            </p>
          )}
          {presenta.length > 0 && (
            <table className="s-tabla s-impuestos-tabla">
              <thead><tr><th scope="col">Qué</th><th scope="col">Hasta</th><th scope="col">En qué punto está</th></tr></thead>
              <tbody>
                {plazos.map((p) => (
                  <tr key={`${p.modelo}-${p.ejercicio}-${p.periodo}`}>
                    <td data-titulo="Qué">
                      <span className="s-impuestos-nombre">{nombreDeFila({ ...p, nombre: p.nombre }, nivel)}</span>
                      <span className="s-tabla-apoyo">
                        {nivel !== 'experto' ? `modelo ${p.modelo} · ` : ''}{p.modelo === '202' ? `${periodoEnPalabras(p.periodo)} de ${p.ejercicio}` : `de ${p.ejercicio}`}
                      </span>
                    </td>
                    <td data-titulo="Hasta">{diaMesCorto(p.presentacion)}/{p.presentacion.slice(0, 4)}</td>
                    <td data-titulo="En qué punto está"><span className="s-apoyo">Se calculará aquí pronto</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {presenta.length > 0 && (
            <ul className="s-impuestos-porque s-impuestos-vacio">
              {presenta.map((m) => <li key={m.modelo}><strong>{nombreDeOficina(m.modelo, m.cadencia, m.nombre)} ({m.modelo})</strong> · {m.por_que}</li>)}
            </ul>
          )}
        </Tarjeta>
      )}
    </div>
  )
}
