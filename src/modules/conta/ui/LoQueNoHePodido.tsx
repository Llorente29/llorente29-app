// src/modules/conta/ui/LoQueNoHePodido.tsx
//
// S01 · PR 3 · Entrega 5 (PC01): «Lo que no he podido proponer, y por qué», en
// el apartado donde se arregla. Cada fila dice qué es y, en palabras de oficina,
// qué falta y qué hacer (lo escribe la base al intentarlo). Sin filas no ocupa
// sitio; con filas, salen todas (regla 7). Si no se puede leer, lo dice (regla 8).

import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { leerNoPropuesto } from '@/modules/conta/services/noPropuestoService'
import { tituloNoPropuesto, type Donde } from '@/modules/conta/lib/noPropuesto'

export function LoQueNoHePodido({ donde, vuelta = 0 }: { donde: Donde; vuelta?: number }) {
  const { activa } = useEmpresas()
  const r = useLeer(activa ? () => leerNoPropuesto(activa.id, donde) : null, `${activa?.id}:${donde}:${vuelta}:no-propuesto`)
  if (r.error) return <p className="cx-ayuda cxt-ambar" role="note">No he podido leer lo que no se ha propuesto: {r.error}</p>
  if (!r.datos || r.datos.length === 0) return null
  return (
    <section className="cx-tarjeta cxd-sin-propuesta" aria-label="Lo que no he podido proponer">
      <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">{tituloNoPropuesto(r.datos.length)}</h2></div>
      <p className="cx-ayuda" style={{ marginTop: 0 }}>Lo propongo solo en cuanto llega lo que lo origina y cada noche; esto no he podido. Cuando lo arregles, sale de aquí la próxima vez que lo intente.</p>
      <ul>{r.datos.map((x) => <li key={x.id}><strong>{x.que}</strong> · {x.porque}</li>)}</ul>
    </section>
  )
}
