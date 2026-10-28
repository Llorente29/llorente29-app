// src/modules/multitenancy/components/brands/MarcasPorRevisarLast.tsx
//
// F01 · PR 3 · Encima de la lista de Marcas, lo que hay en Marcas › Revisar
// (tablero 4): las marcas de Last que llegan con otro código y se parecen a una
// tuya, lo que Folvy ha unido solo y las ventas de Last sin marca. Las mismas
// filas que el aviso de Inicio. Si no hay nada, no pinta nada.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { chipPregunta, textoReconocida, textoSinMarca, tituloPregunta, type PorRevisar } from '../../lib/cartaMarca'
import { claveMarca, iniciales } from '../../lib/marcasLast'
import { leerMarcasPorRevisar } from '../../services/cartaMarcaService'
import './altaMarcaLast.css'

interface Props { accountId: string; vuelta: number }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function MarcasPorRevisarLast({ accountId, vuelta }: Props) {
  const [datos, setDatos] = useState<PorRevisar | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    leerMarcasPorRevisar(accountId)
      .then((d) => { if (vivo) { setDatos(d); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [accountId, vuelta])

  if (error) return <p className="ml-error" role="alert" style={{ margin: '0 0 14px' }}>No se han podido leer las marcas de Last por revisar: {error}</p>
  if (!datos || (datos.preguntas.length + datos.reconocidas.length + datos.sinMarca.length) === 0) return null

  return (
    <section className="ml-nuevas" aria-labelledby="rv-marcas-titulo" data-prueba="marcas-por-revisar">
      <h2 id="rv-marcas-titulo">Marcas de Last por revisar</h2>
      <ul className="ml-filas">
        {datos.preguntas.map((q) => (
          <li className="ml-fila" key={claveMarca(q)}>
            <div className="ml-ico cc-ico-aviso" aria-hidden>{iniciales(q.nombre)}</div>
            <div className="ml-txt"><b>{q.nombre} llega con otro código. {tituloPregunta(q)}</b><span>Su carta se parece a la de tu {q.comparacion.marca}.</span></div>
            <span className="ml-chip" data-tono={q.ventas.despues + q.ventas.antes > 0 ? 'mal' : 'suave'}>{chipPregunta(q)}</span>
            <Link className="ml-boton cc-enlace" to={`/configuracion/revisar-last?marca=${encodeURIComponent(claveMarca(q))}`}>Revisar</Link>
          </li>
        ))}
        {datos.reconocidas.map((r) => (
          <li className="ml-fila" key={r.id}>
            <div className="ml-ico" aria-hidden>✓</div>
            <div className="ml-txt"><b>{textoReconocida(r).titulo}</b><span>{textoReconocida(r).detalle}</span></div>
            <Link className="ml-boton cc-enlace" to="/configuracion/revisar-last">Ver</Link>
          </li>
        ))}
        {datos.sinMarca.map((s, i) => (
          <li className="ml-fila" key={`${s.codigo ?? ''}:${i}`}>
            <div className="ml-ico cc-ico-aviso" aria-hidden>!</div>
            <div className="ml-txt"><b>{textoSinMarca(s)}</b><span>No descuentan almacén hasta que se sepa de qué marca son.</span></div>
            <Link className="ml-boton cc-enlace" to="/configuracion/revisar-last">Ver</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
