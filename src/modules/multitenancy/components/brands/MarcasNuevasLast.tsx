// src/modules/multitenancy/components/brands/MarcasNuevasLast.tsx
//
// F01 · Las marcas nuevas de Last encima de la lista de Marcas (las mismas
// filas que el aviso de Inicio) y el panel del alta. El aviso de Inicio trae
// aquí con ?alta=<cuenta de Last>:<marca>, y el panel se abre solo.
// Si no hay ninguna pendiente, no pinta nada.

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { avisoMarca, claveMarca, deClave, iniciales, pendientes, type MarcaLast } from '../../lib/marcasLast'
import { leerMarcasLast } from '../../services/marcasLastService'
import AltaMarcaLast from './AltaMarcaLast'
import './altaMarcaLast.css'

interface Props {
  accountId: string
  /** Tras un alta: la lista de marcas tiene que volver a leerse. */
  onAlta: () => void
}

export default function MarcasNuevasLast({ accountId, onAlta }: Props) {
  const [marcas, setMarcas] = useState<MarcaLast[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    let vivo = true
    leerMarcasLast(accountId)
      .then((m) => { if (vivo) { setMarcas(m); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, vuelta])

  const abrir = useCallback((m: MarcaLast) => {
    const p = new URLSearchParams(params); p.set('alta', claveMarca(m)); setParams(p, { replace: true })
  }, [params, setParams])
  const cerrar = useCallback(() => {
    const p = new URLSearchParams(params); p.delete('alta'); setParams(p, { replace: true })
  }, [params, setParams])

  const nuevas = pendientes(marcas ?? [])
  const pedida = deClave(params.get('alta'))
  const abierta = pedida ? nuevas.find((m) => m.org === pedida.org && m.nombre === pedida.nombre) ?? null : null

  return (
    <>
      {hecho && <div className="ml-hecho" role="status" data-prueba="alta-hecha">{hecho}</div>}
      {error && <p className="ml-error" role="alert" style={{ margin: '0 0 14px' }}>No se han podido leer las marcas de Last: {error}</p>}
      {pedida && marcas && !abierta && !hecho && (
        <p className="ml-error" role="alert" style={{ margin: '0 0 14px' }}>«{pedida.nombre}» ya no está pendiente de alta en Last.</p>
      )}
      {nuevas.length > 0 && (
        <section className="ml-nuevas" aria-labelledby="ml-nuevas-titulo" data-prueba="marcas-nuevas-last">
          <h2 id="ml-nuevas-titulo">Marcas nuevas en Last</h2>
          <ul className="ml-filas">
            {nuevas.map((m) => {
              const a = avisoMarca(m)
              return (
                <li className="ml-fila" key={claveMarca(m)}>
                  <div className="ml-ico" aria-hidden>{iniciales(m.nombre)}</div>
                  <div className="ml-txt"><b>{a.titulo}</b><span>{a.detalle}</span></div>
                  <span className="ml-chip" data-tono="aviso">{a.chip}</span>
                  <button type="button" className="ml-boton" data-principal="si" onClick={() => abrir(m)} aria-label={`Dar de alta ${m.nombre}`}>Dar de alta</button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {abierta && (
        <AltaMarcaLast
          accountId={accountId}
          marca={abierta}
          onCerrar={cerrar}
          onHecho={(frase) => { setHecho(frase); cerrar(); setVuelta((v) => v + 1); onAlta() }}
        />
      )}
    </>
  )
}
