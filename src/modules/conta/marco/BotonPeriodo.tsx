// src/modules/conta/marco/BotonPeriodo.tsx
//
// S02 · El botón del periodo (encargo S02, «Cabecera»; decisión 3 de Julio,
// 22/10): sale SOLO en las pantallas que leen el periodo; donde sale, siempre
// en el mismo sitio de la cabecera (lo pone ahí PeriodoEnBarra), con el mismo
// control y el mismo formato: «Octubre 2026 · Ejercicio 2026 · abierto».
//
// Por dentro es un <select> de verdad, transparente encima del texto: el
// teclado, el lector de pantalla y el móvil lo tratan como lo que es, y la
// lista con la que se elige es la que la pantalla lee (regla 30).

import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { Icono } from '@/modules/conta/diseno'
import { textoDelPeriodo } from './periodo'

export interface OpcionPeriodo { valor: string; etiqueta: string }

export function BotonPeriodo({ tipo, valor, opciones, alCambiar, etiqueta }: {
  /** Un mes ('YYYY-MM') o un ejercicio (su código, «2026»). */
  tipo: 'mes' | 'ejercicio'
  valor: string
  opciones: readonly OpcionPeriodo[]
  alCambiar: (valor: string) => void
  /** El nombre del control para el lector («Mes», «Ejercicio»). */
  etiqueta?: string
}) {
  const marco = useMarco()
  const t = textoDelPeriodo(tipo === 'mes' ? { mes: valor } : { ejercicio: valor }, marco?.ejercicios ?? [])
  const nombre = etiqueta ?? (tipo === 'mes' ? 'Mes' : 'Ejercicio')
  return (
    <span className="s-periodo" title={t.entero}>
      <Icono nombre="fecha" />
      <span className="s-periodo-texto" aria-hidden="true">
        <span className="s-periodo-arriba">{t.arriba}</span>
        <span className="s-periodo-abajo">{t.abajo}</span>
      </span>
      <Icono nombre="desplegar" />
      <select className="s-periodo-select" aria-label={nombre} aria-description={t.entero} value={valor} onChange={(e) => alCambiar(e.target.value)}>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </span>
  )
}
