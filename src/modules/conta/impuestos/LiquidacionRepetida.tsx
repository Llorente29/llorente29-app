// src/modules/conta/impuestos/LiquidacionRepetida.tsx
//
// S01p·21 · En Impuestos › Trimestre (303): «Liquidación apuntada dos veces», con las dos al
// lado y «Dejar solo esta». Al pulsar, dice qué asiento ha creado y con qué fecha (regla 8).
// Lo hace la base (conta_liquidacion_dejar_esta): el 303 enlazado con la que se deja y cada
// repetida sin efecto con su contraasiento en el primer día abierto, sin tocar ningún libro.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { Boton, Chip } from '@/modules/conta/diseno'
import { dejarSoloEstaLiquidacion, liquidacionesRepetidas } from '@/modules/conta/services/impuestosService'
import { estadoLiquidacion, fraseRepetida, lineaLiquidacion, quedaPorDecidir, type LiquidacionRepetida as Fila } from './liquidacionRepetida'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function LiquidacionRepetida({ declaracion, puede, quien }: { declaracion: string; puede: boolean; quien: string | null }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    liquidacionesRepetidas(declaracion).then((xs) => { if (vivo) setFilas(xs) }, (e: unknown) => { if (vivo) { setFilas([]); setFallo(`No he podido mirar si la liquidación está repetida: ${msg(e)}`) } })
    return () => { vivo = false }
  }, [declaracion, vuelta])
  if (!filas || (filas.length < 2 && !fallo)) return null
  const porDecidir = quedaPorDecidir(filas)
  const dejar = async (asiento: string) => {
    setOcupado(asiento); setFallo(null); setHecho(null)
    try { setHecho((await dejarSoloEstaLiquidacion(declaracion, asiento, quien)).mensaje); setVuelta((v) => v + 1) }
    catch (e) { setFallo(`No se ha hecho: ${msg(e)}`) }
    finally { setOcupado(null) }
  }
  return (
    <section className="s-tarjeta s-trimestre-repetida" aria-labelledby="repetida-titulo" data-prueba="liquidacion-repetida">
      <h3 id="repetida-titulo" className="s-trimestre-cartera-titulo">Liquidación apuntada dos veces</h3>
      {filas.length >= 2 && <p className="s-apoyo" data-prueba="repetida-frase">{fraseRepetida(filas)}</p>}
      <ul className="s-lista-simple">
        {filas.map((x) => {
          const estado = estadoLiquidacion(x)
          return (
            <li key={x.asiento} data-prueba="repetida-fila" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <Link to={rutaAsiento(x.asiento)}>{lineaLiquidacion(x)}</Link>
              {estado && <Chip tono={x.enlazada ? 'seguro' : 'neutro'}>{estado}</Chip>}
              {porDecidir && puede && (
                <Boton variante="secundario" onClick={() => void dejar(x.asiento)} disabled={!!ocupado}>{ocupado === x.asiento ? 'Dejando solo esta…' : 'Dejar solo esta'}</Boton>
              )}
            </li>
          )
        })}
      </ul>
      {porDecidir && !puede && <p className="s-apoyo">Lo decide un administrador de la empresa.</p>}
      {hecho && <p className="cx-guardado" role="status" data-prueba="repetida-hecho">{hecho}</p>}
      {fallo && <p className="cx-error" role="alert">{fallo}</p>}
    </section>
  )
}
