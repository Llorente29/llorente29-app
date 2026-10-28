// src/modules/multitenancy/components/brands/MarcasNuevasLast.tsx
//
// F01 · Las marcas nuevas de Last encima de la lista de Marcas (las mismas
// filas que el aviso de Inicio) y el panel del alta. El aviso de Inicio trae
// aquí con ?alta=<cuenta de Last>:<marca>, y el panel se abre solo.
// Respuesta 1: cada fila lleva también «No la uso», con su confirmación en una
// línea; las que tienen pinta de cancelada salen abajo, sin destacar.
// Si no hay ninguna pendiente, no pinta nada.

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { avisoMarca, claveMarca, deClave, fraseNoLaUso, iniciales, pendientes, type MarcaLast } from '../../lib/marcasLast'
import { leerMarcasLast, ocultarMarca } from '../../services/marcasLastService'
import AltaMarcaLast from './AltaMarcaLast'
import './altaMarcaLast.css'

interface Props {
  accountId: string
  /** Cambia cuando otra parte de Marcas toca las marcas de Last (las ocultas). */
  vuelta: number
  /** Tras un alta o «No la uso»: lo demás de Marcas tiene que volver a leerse. */
  onCambio: () => void
  /** F01 · PR 3: tras el alta, la ficha de la marca en su carta (con la frase del alta). */
  onAlta?: (brandId: string, frase: string) => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function MarcasNuevasLast({ accountId, vuelta, onCambio, onAlta }: Props) {
  const [marcas, setMarcas] = useState<MarcaLast[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ ok: boolean; texto: string } | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    let vivo = true
    leerMarcasLast(accountId)
      .then((m) => { if (vivo) { setMarcas(m); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [accountId, vuelta])

  const abrir = useCallback((m: MarcaLast) => {
    const p = new URLSearchParams(params); p.set('alta', claveMarca(m)); setParams(p, { replace: true })
  }, [params, setParams])
  const cerrar = useCallback(() => {
    const p = new URLSearchParams(params); p.delete('alta'); setParams(p, { replace: true })
  }, [params, setParams])

  const noLaUso = async (m: MarcaLast) => {
    setOcupado(true)
    try {
      setHecho({ ok: true, texto: await ocultarMarca(accountId, m.org, m.nombre, true) })
      setConfirmando(null)
      onCambio()
    } catch (e) {
      setHecho({ ok: false, texto: `No se ha guardado: ${msg(e)}` })
    } finally {
      setOcupado(false)
    }
  }

  const nuevas = pendientes(marcas ?? [])
  const pedida = deClave(params.get('alta'))
  const abierta = pedida ? nuevas.find((m) => m.org === pedida.org && m.nombre === pedida.nombre) ?? null : null

  return (
    <>
      {hecho && <div className={hecho.ok ? 'ml-hecho' : 'ml-error'} role={hecho.ok ? 'status' : 'alert'} data-prueba="alta-hecha" style={hecho.ok ? undefined : { margin: '0 0 14px' }}>{hecho.texto}</div>}
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
              const clave = claveMarca(m)
              return (
                <li className="ml-fila" key={clave} data-apagada={m.apagada ? 'si' : undefined}>
                  <div className="ml-ico" aria-hidden>{iniciales(m.nombre)}</div>
                  <div className="ml-txt"><b>{a.titulo}</b><span>{a.detalle}</span></div>
                  <span className="ml-chip" data-tono={a.chipTono}>{a.chip}</span>
                  <button type="button" className="ml-boton" data-principal={m.apagada ? 'no' : 'si'} onClick={() => abrir(m)} aria-label={`Dar de alta ${m.nombre}`}>Dar de alta</button>
                  <button type="button" className="ml-boton" onClick={() => { setConfirmando(clave); setHecho(null) }} disabled={ocupado} aria-label={`No la uso: ${m.nombre}`}>No la uso</button>
                  {confirmando === clave && (
                    <div className="ml-confirmar" role="group" aria-label={`Confirmar: No la uso ${m.nombre}`}>
                      <span>{fraseNoLaUso(m.nombre)}</span>
                      <button type="button" className="ml-boton" onClick={() => void noLaUso(m)} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Sí, no la uso'}</button>
                      <button type="button" className="ml-boton" onClick={() => setConfirmando(null)} disabled={ocupado}>Cancelar</button>
                    </div>
                  )}
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
          onHecho={(frase, r) => {
            onCambio()
            if (onAlta && r.brandId) { onAlta(r.brandId, frase); return }
            setHecho({ ok: true, texto: frase }); cerrar()
          }}
          onOculta={(frase) => { setHecho({ ok: true, texto: frase }); cerrar(); onCambio() }}
        />
      )}
    </>
  )
}
