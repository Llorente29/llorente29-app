// src/modules/conta/empresa/ApartadoPresentar.tsx
//
// «Para presentar el 200 y depositar las cuentas» (respuesta 3 del C00, punto
// 5): lo que esos documentos piden de la empresa, uno a uno, con ✓ o «falta»
// y dónde se pone. Regla 7: se enseña todo, también lo que está bien. Si ya
// toca presentar (un ejercicio cerrado, o el 200 entre lo que presenta) lo que
// falta sale en ámbar; si aún no, en gris: se avisa sin alarmar.

import { useId } from 'react'
import type { DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import { NOMBRE_DOCUMENTO, faltan, requisitosParaPresentar, tocaPresentar } from '@/modules/conta/lib/presentar'
import { APARTADOS } from '@/modules/conta/empresa/apartados'
import { Chip } from '@/modules/conta/ui/piezas'
import { TarjetaApartado } from '@/modules/conta/empresa/campos'

export function ParaPresentar({ d, movil, hoy }: { d: DatosEmpresa; movil: boolean; hoy: string }) {
  const id = useId()
  const rs = requisitosParaPresentar(d, hoy)
  if (rs.length === 0) return null
  const toca = tocaPresentar(d)
  const n = faltan(rs).length
  const titulo = (clave: string) => APARTADOS.find((a) => a.id === clave)?.titulo(d, hoy) ?? clave
  return (
    <TarjetaApartado titulo="Para presentar el 200 y depositar las cuentas" movil={movil}
      accion={n === 0 ? <Chip tono="ia">Está todo</Chip> : <Chip tono={toca ? 'ambar' : 'neutro'}>{n === 1 ? 'Falta 1' : `Faltan ${n}`}</Chip>}>
      <p className="cx-ayuda" style={{ margin: 0 }} id={id}>
        Lo que piden el modelo 200 y el depósito de las cuentas en el Registro Mercantil tiene que estar ya aquí, no pedirse el día de presentar.
        {!toca && ' Aún no toca: la primera vez será al cerrar el primer ejercicio.'}
      </p>
      <ul className="cx-presentar" aria-describedby={id}>
        {rs.map((r) => (
          <li key={r.clave} className={`cx-presentar-fila cx-presentar-${r.estado}${r.estado === 'falta' && toca ? ' cx-presentar-toca' : ''}`}>
            <span className="cx-presentar-marca" aria-hidden="true">{r.estado === 'hecho' ? '✓' : r.estado === 'falta' ? '!' : '?'}</span>
            <span className="cx-fila-texto">
              <span className="cx-fila-titulo">{r.texto}</span>
              <span className="cx-fila-apoyo">
                {r.estado === 'hecho' ? 'Hecho' : r.estado === 'falta' ? `Falta · se pone en «${titulo(r.donde)}»` : 'Solo lo ve un administrador'}
                {' · '}para {r.para.map((p) => NOMBRE_DOCUMENTO[p]).join(' y ')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </TarjetaApartado>
  )
}
