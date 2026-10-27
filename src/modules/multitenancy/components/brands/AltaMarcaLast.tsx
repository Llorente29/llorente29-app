// src/modules/multitenancy/components/brands/AltaMarcaLast.tsx
//
// F01 · tablero 2: «Dar de alta, en una sola pantalla». Lo que antes eran
// cinco botones técnicos (crear la marca, vincular cada local, importar,
// sembrar, recasar) pasa en uno. Folvy rellena lo que ya sabe (el ensayo del
// alta, f01_alta_marca con p_ensayo) y solo pregunta lo que no puede saber: de
// quién es la marca. Confirma con contenido o falla en pantalla (regla 8).

import { useEffect, useRef, useState } from 'react'
import {
  fraseHecho, iniciales, lineasCarta, localCorto, nombreCanal,
  type MarcaLast, type ResultadoAlta,
} from '../../lib/marcasLast'
import { darDeAlta, ensayarAlta } from '../../services/marcasLastService'
import './altaMarcaLast.css'

interface Props {
  accountId: string
  marca: MarcaLast
  onCerrar: () => void
  onHecho: (frase: string, r: ResultadoAlta) => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function AltaMarcaLast({ accountId, marca, onCerrar, onHecho }: Props) {
  const [nombre, setNombre] = useState(marca.marcaFolvy ?? marca.nombre)
  const [propia, setPropia] = useState(marca.propuesta.propia)
  const [socio, setSocio] = useState(marca.propuesta.socio ?? '')
  const [ensayo, setEnsayo] = useState<ResultadoAlta | null>(null)
  const [errorEnsayo, setErrorEnsayo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const primero = useRef<HTMLInputElement>(null)

  // Lo que haría el alta (la carta no depende de de quién sea la marca).
  useEffect(() => {
    let vivo = true
    ensayarAlta({ accountId, org: marca.org, nombreLast: marca.nombre, nombre: marca.marcaFolvy ?? marca.nombre, propia: true, socio: null })
      .then((r) => { if (vivo) setEnsayo(r) })
      .catch((e) => { if (vivo) setErrorEnsayo(msg(e)) })
    return () => { vivo = false }
  }, [accountId, marca])

  useEffect(() => {
    primero.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar, ocupado])

  const falta = !nombre.trim() ? 'Escribe el nombre de la marca.'
    : !propia && !socio.trim() ? 'Escribe el socio que te la cede.' : null

  const alta = async () => {
    if (falta) return
    setOcupado(true); setError(null)
    try {
      const r = await darDeAlta({ accountId, org: marca.org, nombreLast: marca.nombre, nombre: nombre.trim(), propia, socio: propia ? null : socio.trim() })
      onHecho(fraseHecho(r), r)
    } catch (e) {
      setError(`No se ha dado de alta: ${msg(e)}`)
    } finally {
      setOcupado(false)
    }
  }

  const cuenta = marca.cuentaLast ?? 'Last'
  const corto = nombre.trim() || marca.nombre
  const canales = marca.canales

  return (
    <div className="ml-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCerrar() }}>
      <div className="ml-panel" role="dialog" aria-modal="true" aria-labelledby="ml-titulo" data-prueba="alta-marca-last">
        <div className="ml-cab">
          <div className="ml-logo" aria-hidden>{iniciales(marca.nombre)}</div>
          <div>
            <h2 id="ml-titulo">{marca.nombre}</h2>
            <p>Encontrada en Last · cuenta de {cuenta}</p>
          </div>
        </div>

        <div className="ml-sec">
          <h3>La marca</h3>
          <div className="ml-campo">
            <label htmlFor="ml-nombre">Nombre</label>
            <input id="ml-nombre" ref={primero} className="ml-entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={ocupado} />
          </div>
          <div className="ml-campo">
            <span className="ml-etiqueta" id="ml-de-quien">¿De quién es?</span>
            <div className="ml-seg" role="group" aria-labelledby="ml-de-quien">
              <button type="button" aria-pressed={propia} onClick={() => setPropia(true)} disabled={ocupado}>Mía</button>
              <button type="button" aria-pressed={!propia} onClick={() => setPropia(false)} disabled={ocupado}>Cedida por un socio</button>
            </div>
            {!propia && (
              <>
                <div className="ml-socio">
                  <input aria-label="Socio" className="ml-entrada" value={socio} onChange={(e) => setSocio(e.target.value)} disabled={ocupado}
                    placeholder="El socio que te cede la marca" />
                  {marca.propuesta.socio && socio.trim() === marca.propuesta.socio && marca.propuesta.socioMarcas > 0 && (
                    <span className="ml-pista">socio de {marca.propuesta.socioMarcas} {marca.propuesta.socioMarcas === 1 ? 'marca tuya' : 'marcas tuyas'}</span>
                  )}
                </div>
                {marca.propuesta.socio && (
                  <span className="ml-pista">Lo proponemos porque viene de la cuenta de Last de {cuenta}. Si no es así, cámbialo.</span>
                )}
              </>
            )}
            {propia && !marca.propuesta.propia && (
              <span className="ml-pista">Viene de una cuenta de Last de marcas cedidas ({cuenta}). Si es tuya, déjalo así.</span>
            )}
          </div>
        </div>

        <div className="ml-sec">
          <h3>Dónde se vende</h3>
          {marca.locales.map((l) => (
            <div className="ml-local" key={l.id}>
              <span className="ml-l"><span className="ml-marca" aria-hidden>✓</span>{localCorto(l.nombre)}</span>
              {canales.length > 0 && <span className="ml-chip" data-tono="suave">{canales.map(nombreCanal).join(' · ')}</span>}
            </div>
          ))}
        </div>

        <div className="ml-sec">
          <h3>La carta</h3>
          {errorEnsayo && <p className="ml-cargando" role="alert">No se ha podido leer la carta de Last: {errorEnsayo}</p>}
          {!errorEnsayo && !ensayo && <p className="ml-cargando" aria-busy="true">Leyendo la carta de Last…</p>}
          {ensayo?.carta && (
            <ul className="ml-lineas" data-prueba="alta-carta">
              {lineasCarta(ensayo.carta, canales).map((l, i) => (
                <li key={i}><i data-tono={l.tono} aria-hidden>{l.tono === 'ok' ? '✓' : '!'}</i><span><b>{l.fuerte}</b>{l.resto}</span></li>
              ))}
            </ul>
          )}
        </div>

        {(error || falta) && <p className="ml-error" role="alert">{error ?? falta}</p>}

        <div className="ml-pie">
          <span className="ml-pista">No toca ninguna otra marca.</span>
          <button type="button" className="ml-boton" onClick={onCerrar} disabled={ocupado}>Ahora no</button>
          <button type="button" className="ml-boton" data-principal="si" onClick={() => void alta()} disabled={ocupado || !!falta}>
            {ocupado ? 'Dando de alta…' : `Dar de alta ${corto}`}
          </button>
        </div>
      </div>
    </div>
  )
}
