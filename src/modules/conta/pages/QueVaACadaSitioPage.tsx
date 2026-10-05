// src/modules/conta/pages/QueVaACadaSitioPage.tsx
//
// Ajustes › Plan contable › «Qué va a cada sitio» (C02 §4): una página corta,
// generada desde «qué se apunta aquí» (y las palabras clave de la empresa),
// que responde «¿dónde va el alquiler?», «¿y la luz?», «¿y Glovo?». Es lo que
// contestará la barra de preguntar. Búsqueda por nombre, número o palabra.
//
// Solo salen las cuentas que tienen «qué se apunta aquí» o palabras clave:
// las demás no tienen nada que decir aquí y siguen todas en el plan (no se
// esconde nada: esta página no es el plan, es su chuleta).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaPlan } from '@/config/navegacion'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { encaja } from '@/modules/conta/lib/planVista'

function Contenido() {
  const { plan, movil } = useAjustes()
  const [q, setQ] = useState('')
  const p = plan.datos
  const entradas = useMemo(() => (p?.cuentas ?? [])
    .filter((c) => c.status === 'activa' && (c.plainName || c.keywords.length))
    .sort((a, b) => a.code.localeCompare(b.code)), [p])
  const cabeza = movil
    ? <CabeceraEntradaMovil titulo="Qué va a cada sitio" antetitulo="Plan contable" atras={rutaPlan()} />
    : (
      <div className="cx-ajustes-panel-cabeza">
        <h2 className="cx-ajustes-panel-titulo">Qué va a cada sitio</h2>
        <p className="cx-ayuda" style={{ margin: 0 }}>Pregunta con tus palabras: «alquiler», «luz», «Glovo». <Link to={rutaPlan()} className="cx-enlace">Volver al plan</Link></p>
      </div>
    )
  if (plan.cargando) return <>{cabeza}<TarjetaCargando /></>
  if (plan.error || !p) return <>{cabeza}<ErrorConReintento mensaje={plan.error ?? 'No se ha podido leer.'} reintentar={plan.recargar} /></>
  if (!p.activo) return <>{cabeza}<div className="cx-tarjeta"><p className="cx-vacio">Primero hay que activar el plan contable. <Link to={rutaPlan()} className="cx-enlace">Activarlo</Link></p></div></>
  const quedan = entradas.filter((c) => encaja(q.replace(/^¿?\s*(dónde|donde)\s+(va|van|apunto|pongo)\s+(el|la|los|las)?\s*/i, '').replace(/\?$/, ''), c))
  return (
    <>
      {cabeza}
      <section className="cx-tarjeta" aria-label="Qué va a cada sitio">
        <input className="cx-input cx-buscar" style={{ width: '100%' }} type="search" aria-label="¿Dónde va…?" placeholder="¿Dónde va el alquiler?"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {quedan.length === 0 ? (
          <p className="cx-vacio">No encuentro nada que se apunte así. Prueba con otra palabra, o búscalo en el plan.</p>
        ) : (
          <ul className="cx-registro" aria-label="Dónde va cada cosa">
            {quedan.map((c) => (
              <li key={c.id}>
                <div className="cx-fila-texto">
                  <span className="cx-fila-titulo">{c.plainName ?? c.keywords.join(', ')}</span>
                  <span className="cx-fila-apoyo"><span className="cx-cifra">{c.code}</span> · {c.name}{c.keywords.length && c.plainName ? ` · también: ${c.keywords.join(', ')}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

export default function QueVaACadaSitioPage() {
  return <MarcoAjustes entrada="plan"><Contenido /></MarcoAjustes>
}
