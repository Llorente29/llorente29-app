// src/modules/conta/laboral/importar/VolcadoTarjeta.tsx
//
// N1 · PR 1 (01/11/2026) · El tercer paso del importador, con las filas ya
// cargadas: cada centro de Cegid con su local (propuesto por el nombre; lo
// confirma el administrador) y «Pasar a las fichas». Sin confirmar, nadie de
// ese centro entra, y la pantalla lo dice. Al acabar, lo que ha quedado, con
// números, los avisos uno por uno y lo que cobra que no cuadra con Cegid.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Selector, Tarjeta } from '@/modules/conta/diseno'
import {
  centrosDelLote, confirmarCentro, lineaNoCuadra, resumenVolcado, volcarLote,
  type CentroDelLote, type ResultadoVolcado,
} from './volcado'

export default function VolcadoTarjeta({ loteId }: { loteId: string }) {
  const { locations } = useApp()
  const [centros, setCentros] = useState<CentroDelLote[] | null>(null)
  const [elegido, setElegido] = useState<Record<string, string>>({})
  const [volcando, setVolcando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoVolcado | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    centrosDelLote(loteId).then((c) => { if (vivo) setCentros(c) }).catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [loteId])

  const opciones = [{ valor: '', texto: 'Elige el local…' }, ...locations.map((l) => ({ valor: l.id, texto: l.name }))]
  const valorDe = (c: CentroDelLote) => elegido[c.centro] ?? c.confirmado?.id ?? c.propuesto?.id ?? ''
  const sinConfirmar = (centros ?? []).filter((c) => !c.confirmado)

  async function confirmar(c: CentroDelLote) {
    const loc = valorDe(c)
    if (!loc) return
    setError('')
    try { setCentros(await confirmarCentro(loteId, c.centro, loc)) } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido confirmar.') }
  }

  async function volcar() {
    setVolcando(true); setError(''); setResultado(null)
    try { setResultado(await volcarLote(loteId)) } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido pasar a las fichas.') } finally { setVolcando(false) }
  }

  return (
    <Tarjeta titulo="Pasar a las fichas" nivel={3}
      apoyo="Cada centro de Cegid va a un local de la cuenta. Te proponemos el que se llama igual; confírmalo. Nadie de un centro sin confirmar entra en las fichas."
      accion={<Boton variante="principal" icono="subir" onClick={volcar} disabled={volcando || centros === null} data-prueba="volcado-pasar">
        {volcando ? 'Pasando…' : 'Pasar a las fichas'}</Boton>}>
      {centros === null && !error && <p className="s-apoyo" role="status">Leyendo los centros del fichero…</p>}
      {centros !== null && centros.length === 0 && <p className="s-apoyo">El fichero no trae ningún centro de trabajo.</p>}
      {centros !== null && centros.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
        <table className="s-tabla" data-prueba="volcado-centros">
          <thead><tr><th>Centro en Cegid</th><th>Personas</th><th>Local en la cuenta</th><th /></tr></thead>
          <tbody>
            {centros.map((c) => (
              <tr key={c.centro} data-prueba="volcado-centro">
                <td>{c.centro}</td>
                <td>{c.personas}</td>
                <td>
                  <Selector valor={valorDe(c)} alCambiar={(v) => setElegido((x) => ({ ...x, [c.centro]: v }))} opciones={opciones}
                    aria-label={`Local para el centro ${c.centro}`} />
                </td>
                <td>
                  {c.confirmado && valorDe(c) === c.confirmado.id
                    ? <Chip tono="seguro">Confirmado</Chip>
                    : <Boton variante="secundario" onClick={() => confirmar(c)} disabled={!valorDe(c)} data-prueba="volcado-confirmar">
                        {c.propuesto && !c.confirmado && valorDe(c) === c.propuesto.id ? 'Confirmar el propuesto' : 'Confirmar'}</Boton>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {centros !== null && sinConfirmar.length > 0 && (
        <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="volcado-sin-confirmar">
          {sinConfirmar.length === 1 ? 'Falta confirmar 1 centro' : `Faltan confirmar ${sinConfirmar.length} centros`}: {sinConfirmar.map((c) => c.centro).join(', ')}. Sus personas no entrarán hasta que lo confirmes.
        </p>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert" data-prueba="volcado-error">{error}</p>}
      {resultado && (
        <div data-prueba="volcado-resultado">
          <p className="s-aviso-lista" data-tono={resultado.avisos + resultado.errores === 0 ? 'seguro' : 'duda'} role="status" data-prueba="volcado-hecho">
            {resumenVolcado(resultado)}
          </p>
          {resultado.noCuadra.length > 0 && (
            <>
              <p className="s-apoyo"><strong>Lo que cobra no cuadra con su última nómina de Cegid ({resultado.noCuadra.length}):</strong></p>
              <ul className="s-importar-lotes" data-prueba="volcado-no-cuadra">
                {resultado.noCuadra.map((x) => <li key={x.persona}>{lineaNoCuadra(x)}</li>)}
              </ul>
            </>
          )}
          {resultado.mensajes.length > 0 && (
            <>
              <p className="s-apoyo"><strong>Avisos ({resultado.mensajes.length}):</strong></p>
              <ul className="s-importar-lotes" data-prueba="volcado-avisos">
                {resultado.mensajes.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </Tarjeta>
  )
}
