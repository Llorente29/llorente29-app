// src/modules/conta/impuestos/Presentados.tsx
//
// I01b · P3 · Impuestos › Presentados: la lista, con el justificante en PDF y
// el CSV (encargo, punto 4). Lo presentado fuera también, y dice si se
// comprobó con Hacienda. Si falta el PDF del justificante, se sube aquí.
//
// «Subir justificantes» (I01c · P1, también con ?subir=1): se arrastran los PDF
// de la Sede, Sumied los lee, se repasan y se guardan como presentados fuera,
// con sus casillas (SubirJustificantes.tsx).
//
// «Ya presenté uno fuera · pegar CSV» (la cinta del calendario trae aquí con
// ?fuera=1): se pega el CSV y Sumied trae de Hacienda el justificante original,
// lo lee y enseña la ficha con el PDF al lado; o se sube un PDF (también un
// reimpreso) y se saca su CSV (TraerPorCsv.tsx, I01c · P1 definitiva). No pasa
// por la puerta de presentar, que sigue cerrada.
//
// Un 303 que sale a 0,00 € porque se compensó con trimestres anteriores lo
// dice debajo: «647,28 € compensado con trimestres anteriores» (Julio, 19/10).

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { enlaceJustificante, leerPresentados, subirJustificante, type Presentado, type Presentados as Datos } from '@/modules/conta/services/impuestosService'
import { nombreDeFila, periodoEnPalabras, textoResultado, type Resultado } from './calendario'
import { compensadoEnPalabras } from './justificantes'
import { SubirJustificantes } from './SubirJustificantes'
import { TraerPorCsv } from './TraerPorCsv'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Presentados({ companyId }: { companyId: string }) {
  const nivel = useNivel()
  const [busqueda, setBusqueda] = useSearchParams()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [hecho, setHecho] = useState<{ tono: 'ok' | 'falta'; texto: string } | null>(null)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  const fuera = busqueda.get('fuera') === '1'
  const cerrarFuera = () => { const b = new URLSearchParams(busqueda); b.delete('fuera'); setBusqueda(b, { replace: true }) }
  const subir = busqueda.get('subir') === '1'
  const abrirSubir = (si: boolean) => { const b = new URLSearchParams(busqueda); if (si) b.set('subir', '1'); else b.delete('subir'); setBusqueda(b, { replace: true }) }

  useEffect(() => {
    let vivo = true
    leerPresentados(companyId).then((d) => { if (vivo) { setDatos(d); setError(null) } }, (e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [companyId, vuelta])

  const hacer = async (f: () => Promise<string>) => {
    setHecho(null)
    try { setHecho({ tono: 'ok', texto: await f() }) } catch (e) { setHecho({ tono: 'falta', texto: msg(e) }) }
    recargar()
  }

  return (
    <div className="s-pantalla s-impuestos">
      <h1 className="cx-oculto">Impuestos · Presentados</h1>
      {hecho && <p className={hecho.tono === 'ok' ? 's-impuestos-hecho' : 's-impuestos-fallo'} role={hecho.tono === 'ok' ? 'status' : 'alert'}>{hecho.texto}</p>}
      {error && (
        <Tarjeta titulo="No se han podido leer los presentados" tono="falta" accion={<Boton onClick={recargar}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo tus impuestos…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {!error && datos && fuera && datos.puede_gestionar && (
        <TraerPorCsv companyId={companyId} alCerrar={cerrarFuera}
          alGuardar={(texto, ok) => { cerrarFuera(); setHecho({ tono: ok ? 'ok' : 'falta', texto }); recargar() }} />
      )}
      {!error && datos && subir && datos.puede_gestionar && (
        <SubirJustificantes companyId={companyId} alCerrar={() => abrirSubir(false)}
          alGuardar={(texto, ok) => { abrirSubir(false); setHecho({ tono: ok ? 'ok' : 'falta', texto }); recargar() }} />
      )}
      {!error && datos && (
        <Tarjeta compacta titulo="Presentados" apoyo="Lo presentado desde Sumied y lo que presentaste fuera, con su justificante y su CSV."
          accion={datos.puede_gestionar ? (
            <div className="s-impuestos-acciones">
              {!fuera && <Boton onClick={() => setBusqueda({ fuera: '1' })}>Ya presenté uno fuera · pegar CSV</Boton>}
              {!subir && <Boton variante="principal" onClick={() => abrirSubir(true)}>Subir justificantes</Boton>}
            </div>
          ) : null}>
          {datos.presentados.length === 0
            ? <p className="s-apoyo s-impuestos-vacio">Aún no hay ninguno presentado en Sumied. Si los presentó tu asesoría, sube sus justificantes en PDF con «Subir justificantes»: Sumied los lee solo.</p>
            : (
              <table className="s-tabla s-impuestos-tabla">
                <thead>
                  <tr><th scope="col">Impuesto</th><th scope="col">Presentado</th><th scope="col" className="s-tabla-cifra">Resultado</th><th scope="col">CSV</th><th scope="col">Justificante</th><th scope="col">En qué punto está</th></tr>
                </thead>
                <tbody>
                  {datos.presentados.map((p) => <Fila key={p.id} p={p} nivel={nivel} puede={datos.puede_gestionar} hacer={hacer} />)}
                </tbody>
              </table>
            )}
        </Tarjeta>
      )}

    </div>
  )
}

function Fila({ p, nivel, puede, hacer }: { p: Presentado; nivel: ReturnType<typeof useNivel>; puede: boolean; hacer: (f: () => Promise<string>) => Promise<void> }) {
  const estado = p.estado === 'paid' ? 'Pagado' : p.estado === 'refunded' ? 'Devuelto' : p.estado === 'offset' ? 'A compensar' : p.contabilizada ? 'Contabilizado' : 'Sin contabilizar'
  return (
    <tr>
      <td data-titulo="Impuesto">
        <span className="s-impuestos-nombre">{nombreDeFila(p, nivel)}</span>
        <span className="s-tabla-apoyo">{nivel !== 'experto' ? `modelo ${p.modelo} · ` : ''}{p.cadencia === 'annual' ? `de ${p.ejercicio}` : `${periodoEnPalabras(p.periodo)} de ${p.ejercicio}`}</span>
      </td>
      <td data-titulo="Presentado">
        {p.presentada ? `${diaMesCorto(p.presentada)}/${p.presentada.slice(0, 4)}` : '—'}{p.presentada_por ? ` · ${p.presentada_por}` : ''}
        <span className="s-tabla-apoyo">{p.por === 'outside' ? `fuera · ${p.traido ? 'traído de Hacienda por su CSV' : p.comprobada ? 'comprobado con Hacienda' : 'sin comprobar con Hacienda'}` : 'desde Sumied'}</span>
      </td>
      <td data-titulo="Resultado" className="s-tabla-cifra">
        {p.importe !== null ? <span className="s-cifra">{eurosExactos(p.importe)}</span> : '—'}
        <span className="s-tabla-apoyo">{compensadoEnPalabras(p) ?? textoResultado(p.resultado as Resultado | null)}</span>
      </td>
      <td data-titulo="CSV"><span className="s-impuestos-csv">{p.csv ?? '—'}</span></td>
      <td data-titulo="Justificante">
        {p.justificante_pdf
          ? <Boton variante="enlace" onClick={async () => { try { window.open(await enlaceJustificante(p.justificante_pdf!), '_blank', 'noopener') } catch (e) { void hacer(() => Promise.reject(e)) } }}>PDF ↗</Boton>
          : puede ? <SubirPdf p={p} hacer={hacer} /> : <span className="s-apoyo">Falta el PDF</span>}
        {p.justificante && <span className="s-tabla-apoyo">nº {p.justificante}</span>}
      </td>
      <td data-titulo="En qué punto está"><Chip tono={p.contabilizada ? 'seguro' : 'duda'}>{estado}</Chip></td>
    </tr>
  )
}

function SubirPdf({ p, hacer }: { p: Presentado; hacer: (f: () => Promise<string>) => Promise<void> }) {
  return (
    <label className="s-impuestos-subir">
      <span className="s-impuestos-subir-texto">Falta el PDF · subirlo</span>
      <input type="file" accept="application/pdf" className="cx-oculto" onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void hacer(() => subirJustificante({ declaracion: p.id, cuenta: p.cuenta, fichero: f }))
      }} />
    </label>
  )
}
