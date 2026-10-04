// src/modules/conta/proveedor/Notas.tsx
//
// La tarjeta de notas, debajo de «Con quién hablas» (respuesta 1, decisión 1:
// lo que tenía la pantalla vieja de Cocina no se pierde). Se escribe en el
// sitio y se guarda al salir del campo.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { SeGuarda } from '@/modules/conta/proveedor/piezas'
import { useGuardarAlSalir } from '@/modules/conta/proveedor/useGuardarAlSalir'

export function Notas() {
  const { datos } = useFicha()
  const g = useGuardarAlSalir()
  const [notas, setNotas] = useState(datos.ficha.notes ?? '')
  return (
    <section className="cx-tarjeta" aria-labelledby="cxp-notas">
      <div className="cx-tarjeta-cabeza"><h2 id="cxp-notas" className="cx-tarjeta-titulo">Notas</h2></div>
      <label htmlFor="campo-notes" className="cx-oculto">Notas sobre este proveedor</label>
      <textarea id="campo-notes" className="cx-input" value={notas} placeholder="Lo que conviene saber: horario de reparto, pedido mínimo, con quién no…"
        onChange={(e) => setNotas(e.target.value)} onBlur={() => void g.guardar({ notes: notas.trim() || null }, 'notas')} />
      {g.fallo && <div className="cx-error" role="alert">{g.fallo}</div>}
      <SeGuarda texto={g.texto} ocupado={g.ocupado} />
    </section>
  )
}
