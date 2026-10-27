// src/modules/multitenancy/components/brands/MarcasOcultasLast.tsx
//
// F01 · Respuesta 1: Marcas › Ocultas. Al final de Marcas, plegada, con el
// número («Ocultas (1)»): las marcas de Last que el cliente dijo que no usa,
// quién y cuándo, y «Volver a mostrar». Si no hay ninguna, no pinta nada.

import { useEffect, useState } from 'react'
import { fraseOculta, iniciales, ocultas, type MarcaLast } from '../../lib/marcasLast'
import { leerMarcasLast, ocultarMarca } from '../../services/marcasLastService'
import './altaMarcaLast.css'

interface Props {
  accountId: string
  vuelta: number
  onCambio: () => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function MarcasOcultasLast({ accountId, vuelta, onCambio }: Props) {
  const [marcas, setMarcas] = useState<MarcaLast[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    leerMarcasLast(accountId)
      .then((m) => { if (vivo) { setMarcas(ocultas(m)); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [accountId, vuelta])

  const mostrar = async (m: MarcaLast) => {
    setOcupado(true)
    try { setHecho({ ok: true, texto: await ocultarMarca(accountId, m.org, m.nombre, false) }); onCambio() }
    catch (e) { setHecho({ ok: false, texto: `No se ha guardado: ${msg(e)}` }) }
    finally { setOcupado(false) }
  }

  if (error) return <p className="ml-error" role="alert" style={{ margin: '18px 0 0' }}>No se han podido leer las marcas ocultas: {error}</p>
  if (marcas.length === 0 && !hecho) return null

  return (
    <details className="ml-ocultas" data-prueba="marcas-ocultas">
      <summary>Ocultas ({marcas.length})</summary>
      {hecho && <p className={hecho.ok ? 'ml-hecho' : 'ml-error'} role={hecho.ok ? 'status' : 'alert'} style={{ margin: '10px 0' }}>{hecho.texto}</p>}
      {marcas.length > 0 && (
        <ul className="ml-filas">
          {marcas.map((m) => (
            <li className="ml-fila" key={`${m.org}:${m.nombre}`} data-apagada="si">
              <div className="ml-ico" aria-hidden>{iniciales(m.nombre)}</div>
              <div className="ml-txt"><b>{m.nombre}</b><span>{fraseOculta(m)}. Last · cuenta de {m.cuentaLast ?? 'Last'}.</span></div>
              <button type="button" className="ml-boton" onClick={() => void mostrar(m)} disabled={ocupado} aria-label={`Volver a mostrar ${m.nombre}`}>Volver a mostrar</button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
