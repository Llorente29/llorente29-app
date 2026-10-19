// src/modules/conta/impuestos/Presentados.tsx
//
// I01b · P3 · Impuestos › Presentados: la lista, con el justificante en PDF y
// el CSV (encargo, punto 4). Lo presentado fuera también, y dice si se
// comprobó con Hacienda. Si falta el PDF del justificante, se sube aquí.
//
// «Ya presenté uno fuera · pegar CSV» (la cinta del calendario trae aquí con
// ?fuera=1): se elige el periodo del 303, se calcula si aún no lo está (así
// queda qué se presentó) y se apunta con su CSV. Con la puerta cerrada, sin
// comprobar, y se dice.

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boton, Campo, Chip, Dialogo, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import {
  calcular303, enlaceJustificante, hacienda, leerDeclaracion, leerPresentados, subirJustificante, type Presentado, type Presentados as Datos,
} from '@/modules/conta/services/impuestosService'
import { nombreDeFila, periodoEnPalabras, textoResultado, type Resultado } from './calendario'
import { fraseCalculo, pideJustificante } from './declaracion'

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
      {!error && datos && (
        <Tarjeta compacta titulo="Presentados" apoyo="Lo presentado desde Sumied y lo que presentaste fuera, con su justificante y su CSV."
          accion={datos.puede_gestionar ? <Boton onClick={() => setBusqueda({ fuera: '1' })}>Ya presenté uno fuera · pegar CSV</Boton> : null}>
          {datos.presentados.length === 0
            ? <p className="s-apoyo s-impuestos-vacio">Aún no hay ninguno presentado en Sumied. Si ya presentaste alguno fuera, apúntalo con «Ya presenté uno fuera».</p>
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
      {fuera && datos && <DialogoFuera datos={datos} companyId={companyId} alCerrar={cerrarFuera} hacer={hacer} />}
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
        <span className="s-tabla-apoyo">{p.por === 'outside' ? `fuera · ${p.comprobada ? 'comprobado con Hacienda' : 'sin comprobar con Hacienda'}` : 'desde Sumied'}</span>
      </td>
      <td data-titulo="Resultado" className="s-tabla-cifra">
        {p.importe !== null ? <span className="s-cifra">{eurosExactos(p.importe)}</span> : '—'}
        <span className="s-tabla-apoyo">{textoResultado(p.resultado as Resultado | null)}</span>
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

function DialogoFuera({ datos, companyId, alCerrar, hacer }: {
  datos: Datos; companyId: string; alCerrar: () => void; hacer: (f: () => Promise<string>) => Promise<void>
}) {
  const opciones = datos.para_apuntar.map((x) => ({
    valor: `${x.ejercicio}/${x.periodo}`,
    texto: `IVA del ${periodoEnPalabras(x.periodo)} de ${x.ejercicio} · ${x.declaracion && x.importe !== null && x.estado !== 'pending' ? `calculado: ${eurosExactos(x.importe)} ${textoResultado(x.resultado as Resultado | null)}`
      : x.declaracion && x.estado !== 'pending' && x.estado !== null ? 'no se puede calcular todavía' : 'sin calcular'}`,
  }))
  const [elegido, setElegido] = useState(opciones[0]?.valor ?? '')
  const [csv, setCsv] = useState('')
  const limpio = csv.replace(/\s/g, '').toUpperCase()
  const valido = /^[A-Z0-9]{16}$/.test(limpio)
  const apuntar = () => hacer(async () => {
    alCerrar()
    const x = datos.para_apuntar.find((y) => `${y.ejercicio}/${y.periodo}` === elegido)
    if (!x) throw new Error('Elige el periodo.')
    let id = x.declaracion
    let antes = ''
    if (!id || x.estado === 'pending' || x.estado === null) {
      const c = await calcular303(companyId, x.ejercicio, x.periodo)
      id = c.declaracion
      antes = `${fraseCalculo({ ...c, resultado: c.resultado as Resultado | null })} `
    }
    // Si Sumied no ha podido calcularlo, lo presentado son las casillas del justificante: se escriben en su página (0240).
    const d = await leerDeclaracion(companyId, x.ejercicio, x.periodo)
    if (pideJustificante(d)) {
      throw new Error(`${antes}No se ha apuntado: Sumied no ha podido calcular el IVA del ${periodoEnPalabras(x.periodo)} de ${x.ejercicio}, así que hay que copiar las casillas del justificante. Ábrelo (Impuestos › IVA del ${periodoEnPalabras(x.periodo)}) y usa allí «Ya lo presenté fuera».`)
    }
    const s = await hacienda('ya_presentado_fuera', { declaracion: id, csv: limpio })
    if (!s.ok) throw new Error(`${antes}No se ha apuntado: ${s.mensaje}`)
    return `${antes}${s.mensaje}`
  })
  if (opciones.length === 0) {
    return (
      <Dialogo titulo="Ya presenté uno fuera" alCerrar={alCerrar} acciones={<Boton onClick={alCerrar}>Entendido</Boton>}
        explicacion="No hay ningún IVA trimestral de este año ni del pasado sin presentar en Sumied. Los demás modelos se apuntarán aquí cuando Sumied los calcule." />
    )
  }
  return (
    <Dialogo titulo="Ya presenté uno fuera" alCerrar={alCerrar}
      explicacion="Elige el periodo y pega el CSV del justificante (16 letras y números). Si aún no está calculado, Sumied lo calcula con tus libros para que quede qué se presentó, y hace el asiento de liquidación."
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!valido || !elegido} onClick={apuntar}>Apuntar</Boton></>}>
      <Campo etiqueta="Qué presentaste">{(p) => <Selector {...p} valor={elegido} alCambiar={setElegido} opciones={opciones} />}</Campo>
      <Campo etiqueta="CSV del justificante" error={csv && !valido ? 'Son 16 letras y números, como aparecen en el justificante.' : null}
        ayuda="Mientras la conexión con Hacienda no esté abierta, se apunta sin comprobar y se dice así.">
        {(p) => <Texto {...p} valor={csv} alCambiar={setCsv} autoComplete="off" />}
      </Campo>
    </Dialogo>
  )
}
