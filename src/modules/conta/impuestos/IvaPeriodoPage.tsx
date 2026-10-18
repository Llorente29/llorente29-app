// src/modules/conta/impuestos/IvaPeriodoPage.tsx
//
// I01b · P2 · El IVA de un periodo (tablero 9, maqueta «Modelo303.png»):
// migas, el título en palabras, las dos fechas, los pasos en fila y dos
// pestañas, Resumen y Modelo oficial (casillas). A la derecha, «Presentar a
// Hacienda»: quién presenta, cómo se paga, lo que hará Sumied solo, el botón
// con el importe, la nota de que Hacienda lo revisa al recibirlo, «Descargar
// el fichero oficial» y «Ya lo presenté fuera».
//
// Regla 8: cada botón dice lo que ha pasado, con contenido. Y mientras la
// puerta de Hacienda esté cerrada, el botón dice por qué no presenta todavía
// (declaracion.ts, botonPresentar).

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rutaImpuestos, rutaLibros } from '@/config/navegacion'
import { Boton, Campo, Chip, Dialogo, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import {
  aceptarAviso, calcular303, cargosPosibles, casarCargo, confirmarCertificado, contabilizar303, hacienda, leerDeclaracion, leerPuerta,
  ponerPago, revisarDeclaracion, type CargoPosible,
} from '@/modules/conta/services/impuestosService'
import { CASILLAS_303 } from './casillas303'
import { textoResultado, type Resultado } from './calendario'
import {
  botonPresentar, comparacion, deDondeSale, lineaPlazos, migaIva, pasos, sePuedeDomiciliar, siguientePaso, textoConfirmar, textoPago,
  tituloIva, vistaComprobacion, type DeclaracionVer, type Puerta,
} from './declaracion'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function IvaPeriodoPage() {
  const { ejercicio: ej, periodo = '' } = useParams<{ ejercicio: string; periodo: string }>()
  const ejercicio = Number(ej)
  const { activa } = useEmpresas()
  const nivel = useNivel()
  const [datos, setDatos] = useState<DeclaracionVer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [puerta, setPuerta] = useState<Puerta | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [pestana, setPestana] = useState<'resumen' | 'casillas'>('resumen')
  const [hecho, setHecho] = useState<{ tono: 'ok' | 'falta'; texto: string } | null>(null)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])

  useEffect(() => {
    if (!activa || !Number.isInteger(ejercicio) || !periodo) return
    let vivo = true
    leerDeclaracion(activa.id, ejercicio, periodo).then((d) => { if (vivo) { setDatos(d); setError(null) } }, (e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [activa, ejercicio, periodo, vuelta])
  useEffect(() => { let vivo = true; leerPuerta().then((p) => { if (vivo) setPuerta(p) }); return () => { vivo = false } }, [])

  /** Cada acción: lo que dice si sale bien, y lo que dice si no. Después, volver a leer. */
  const hacer = useCallback(async (f: () => Promise<string>) => {
    setHecho(null)
    try { setHecho({ tono: 'ok', texto: await f() }) } catch (e) { setHecho({ tono: 'falta', texto: msg(e) }) }
    recargar()
  }, [recargar])

  if (!activa) return <div className="s-pantalla"><Tarjeta titulo="Aún no hay ninguna empresa"><p className="s-apoyo">Da de alta tu empresa primero.</p></Tarjeta></div>
  const titulo = datos ? tituloIva(datos, nivel) : `IVA del ${periodo}`
  return (
    <div className="s-pantalla s-impuestos">
      <nav aria-label="Migas" className="s-impuestos-migas"><Link to={rutaImpuestos()}>Impuestos</Link> › {datos ? migaIva(datos) : `${periodo} ${ejercicio}`}</nav>
      <div className="s-impuestos-cabeza">
        <h1 className="s-impuestos-titulo">{titulo} <span className="s-impuestos-titulo-apoyo">· {datos ? lineaPlazos(datos) : 'modelo 303'}</span></h1>
        {datos && (
          <ol className="s-impuestos-pasos" aria-label="En qué punto está">
            {pasos(datos).map((p) => (
              <li key={p.texto} data-estado={p.estado}>
                {p.estado === 'hecho' ? <Chip tono="seguro">✓ {p.texto}</Chip> : p.estado === 'ahora' ? <Chip tono="accion">{p.texto}</Chip> : <Chip>{p.texto}</Chip>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div role="tablist" aria-label="Qué ver" className="s-impuestos-pestanas">
        <button type="button" role="tab" aria-selected={pestana === 'resumen'} onClick={() => setPestana('resumen')}>Resumen</button>
        <button type="button" role="tab" aria-selected={pestana === 'casillas'} onClick={() => setPestana('casillas')}>Modelo oficial (casillas)</button>
      </div>
      {hecho && <p className={hecho.tono === 'ok' ? 's-impuestos-hecho' : 's-impuestos-fallo'} role={hecho.tono === 'ok' ? 'status' : 'alert'}>{hecho.texto}</p>}
      {error && (
        <Tarjeta titulo="No se ha podido leer la declaración" tono="falta" accion={<Boton onClick={recargar}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo la declaración…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {!error && datos && (
        <div className="s-impuestos-columnas">
          <div className="s-impuestos-principal">
            {!datos.presenta_303 && (
              <Tarjeta titulo="Esta empresa no presenta el 303" tono="duda">
                <p className="s-apoyo">No está en sus impuestos. Si lo presenta, añádelo en el calendario con «+ Añadir otro impuesto».</p>
              </Tarjeta>
            )}
            {datos.presenta_303 && !datos.declaracion && (
              <Tarjeta titulo="Aún no está calculado" accion={datos.puede_gestionar
                ? <Boton variante="principal" onClick={() => hacer(async () => {
                  const r = await calcular303(activa.id, ejercicio, periodo)
                  return `Calculado con ${r.apuntes} apuntes del libro de IVA: ${eurosExactos(r.importe)} ${textoResultado(r.resultado as Resultado)}.`
                })}>Calcular con mis libros</Boton> : null}>
                <p className="s-apoyo">Sumied lo calcula con el libro de IVA del {diaMesCorto(datos.desde)} al {diaMesCorto(datos.hasta)} y lo cuadra con la contabilidad.</p>
              </Tarjeta>
            )}
            {datos.declaracion && pestana === 'resumen' && <Resumen d={datos} hacer={hacer} companyId={activa.id} />}
            {datos.declaracion && pestana === 'casillas' && <Casillas d={datos} />}
          </div>
          <aside className="s-impuestos-lado">
            <PanelPresentar d={datos} puerta={puerta} hacer={hacer} />
          </aside>
        </div>
      )}
    </div>
  )
}

type Hacer = (f: () => Promise<string>) => Promise<void>

function Resumen({ d, hacer, companyId }: { d: DeclaracionVer; hacer: Hacer; companyId: string }) {
  const r = d.declaracion!
  const lineas = deDondeSale(d)
  const editable = d.puede_gestionar && ['draft', 'reviewed'].includes(r.estado)
  return (
    <>
      <Tarjeta>
        <div className="s-impuestos-resultado">
          <span className="s-apoyo">Resultado</span>
          <span><span className="s-cifra s-impuestos-grande">{eurosExactos(r.importe ?? 0)}</span> <span className="s-impuestos-resultado-que">{textoResultado(r.resultado)}</span></span>
          <span className="s-apoyo">{comparacion(d)}</span>
        </div>
        {editable && (
          <div className="s-impuestos-fila-botones">
            {r.estado === 'draft' && d.comprobaciones.every((c) => c.resultado !== 'error') && (
              <Boton onClick={() => hacer(async () => { await revisarDeclaracion(r.id); return 'Revisado. Ya se puede presentar.' })}>Lo he revisado</Boton>
            )}
            <Boton variante="enlace" onClick={() => hacer(async () => {
              const x = await calcular303(companyId, d.ejercicio, d.periodo)
              return `Vuelto a calcular con ${x.apuntes} apuntes: ${eurosExactos(x.importe)} ${textoResultado(x.resultado as Resultado)}.${r.estado === 'reviewed' ? ' Vuelve a estar en borrador: revísalo otra vez.' : ''}`
            })}>Volver a calcular con lo que hay ahora en los libros</Boton>
          </div>
        )}
      </Tarjeta>
      <Tarjeta compacta titulo="De dónde sale">
        <table className="s-tabla s-impuestos-tabla s-impuestos-origen">
          <thead className="cx-oculto"><tr><th scope="col">Qué</th><th scope="col">Libro</th><th scope="col">Importe</th></tr></thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.titulo} data-fuerte={l.fuerte ? 'si' : undefined}>
                <td data-titulo="Qué"><span className={l.fuerte ? 's-impuestos-nombre' : undefined}>{l.titulo}</span>{l.detalle && <span className="s-tabla-apoyo">{l.detalle}</span>}</td>
                <td data-titulo="Libro">
                  {l.libro && <Link to={rutaLibros('registro', l.libro)}>Libro de facturas {l.libro} · {l.apuntes} →</Link>}
                </td>
                <td data-titulo="Importe" className="s-tabla-cifra"><span className={l.fuerte ? 's-cifra s-impuestos-nombre' : 's-cifra'}>{eurosExactos(l.importe)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
      <Tarjeta titulo="Lo que ha comprobado Sumied">
        <ul className="s-impuestos-comprobado">
          {d.comprobaciones.map((c) => <Comprobado key={c.id} c={c} editable={editable} hacer={hacer} />)}
        </ul>
      </Tarjeta>
      {d.registro.length > 0 && (
        <details className="s-impuestos-registro">
          <summary>Lo que ha pasado con esta declaración ({d.registro.length})</summary>
          <ul>
            {d.registro.map((e, i) => (
              <li key={`${e.cuando}-${i}`}><span className="s-apoyo">{diaMesCorto(e.cuando)} {e.cuando.slice(11, 16)} · {e.quien ?? 'Sumied'}</span> {e.mensaje ?? e.a}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function Comprobado({ c, editable, hacer }: { c: DeclaracionVer['comprobaciones'][number]; editable: boolean; hacer: Hacer }) {
  const v = vistaComprobacion(c)
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  return (
    <li data-marca={v.marca}>
      <span className="s-impuestos-marca" aria-hidden="true">{v.marca}</span>
      <span>
        {v.texto}
        {v.aceptada && <span className="s-apoyo"> · {v.aceptada}</span>}
        {v.sePuedeAceptar && editable && !abierto && <> · <Boton variante="enlace" onClick={() => setAbierto(true)}>Dar por bueno</Boton></>}
        {abierto && (
          <span className="s-impuestos-aceptar">
            <Campo etiqueta="Por qué está bien">{(p) => <Texto {...p} valor={motivo} alCambiar={setMotivo} placeholder="Ej.: la factura es de septiembre y llegó en octubre" />}</Campo>
            <Boton onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton variante="principal" disabled={!motivo.trim()} onClick={() => hacer(async () => {
              await aceptarAviso(c.id, motivo.trim()); setAbierto(false)
              return `Aviso dado por bueno: «${c.titulo}». Queda apuntado con tu nombre y el motivo.`
            })}>Dar por bueno</Boton>
          </span>
        )}
      </span>
    </li>
  )
}

function Casillas({ d }: { d: DeclaracionVer }) {
  return (
    <Tarjeta compacta titulo="Modelo oficial (casillas)" apoyo="Las casillas del 303 como las recibe Hacienda. Las que puso una persona a mano lo dicen.">
      <table className="s-tabla s-impuestos-tabla">
        <thead><tr><th scope="col">Casilla</th><th scope="col">Qué es</th><th scope="col" className="s-tabla-cifra">Importe</th></tr></thead>
        <tbody>
          {d.casillas.map((c) => (
            <tr key={c.casilla}>
              <td data-titulo="Casilla"><span className="s-impuestos-nombre">[{c.casilla}]</span></td>
              <td data-titulo="Qué es">
                {CASILLAS_303[c.casilla]?.texto ?? `Casilla ${c.casilla}`}
                {c.origen === 'manual' && <span className="s-tabla-apoyo">Puesta a mano: {c.motivo}</span>}
              </td>
              <td data-titulo="Importe" className="s-tabla-cifra">
                {c.valor !== null ? <span className="s-cifra">{c.casilla === '65' ? `${String(c.valor).replace('.', ',')} %` : eurosExactos(c.valor)}</span> : c.texto}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tarjeta>
  )
}

function PanelPresentar({ d, puerta, hacer }: { d: DeclaracionVer; puerta: Puerta | null; hacer: Hacer }) {
  const r = d.declaracion
  const boton = botonPresentar(d, puerta)
  const [confirmar, setConfirmar] = useState(false)
  const [fuera, setFuera] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const ce = d.presentador.certificado
  const paso = siguientePaso(d)

  const presentar = () => hacer(async () => {
    setEnviando(true)
    try {
      if (r!.estado === 'draft') await revisarDeclaracion(r!.id)
      const token = await confirmarCertificado(ce!.id, 'file', r!.id)
      const s = await hacienda('presentar_303', { declaracion: r!.id, confirmacion: token })
      if (!s.ok) throw new Error(s.mensaje)
      return s.mensaje
    } finally { setEnviando(false); setConfirmar(false) }
  })

  const bajar = () => hacer(async () => {
    const s = await hacienda('fichero_303', { declaracion: r!.id })
    if (!s.ok) throw new Error(`No se ha descargado: ${s.mensaje}`)
    const texto = String(s.fichero ?? '')
    const bytes = Uint8Array.from(texto, (ch) => ch.charCodeAt(0) & 0xff) // ISO-8859-1, como lo lee Hacienda
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=iso-8859-1' }))
    a.download = String(s.nombre ?? '303.txt')
    a.click()
    URL.revokeObjectURL(a.href)
    return `Descargado ${a.download}: ${s.mensaje}`
  })

  return (
    <section className="s-tarjeta s-impuestos-panel" aria-labelledby="presentar-titulo">
      <h2 id="presentar-titulo" className="s-tarjeta-titulo">Presentar a Hacienda</h2>
      {r && ['filed', 'booked', 'paid', 'offset', 'refunded'].includes(r.estado) ? (
        <Presentado d={d} paso={paso} hacer={hacer} />
      ) : (
        <>
          <div className="s-impuestos-panel-bloque">
            <span className="s-apoyo">Presenta</span>
            <strong>{d.presentador.modo === 'advisor' ? 'Tu asesoría, con su certificado' : ce ? `Certificado de ${ce.nombre}` : 'Aún no hay certificado'}</strong>
            {ce && d.presentador.modo === 'company' && <span className="s-apoyo">válido hasta el {diaMesCorto(ce.caduca)}/{ce.caduca.slice(0, 4)}</span>}
            <Link to={rutaImpuestos('certificados')}>cambiar</Link>
          </div>
          {r && r.resultado && <Pago d={d} hacer={hacer} />}
          <div className="s-impuestos-panel-bloque">
            <span className="s-apoyo">Al presentar, Sumied hará solo</span>
            <ul className="s-impuestos-lista">
              <li>guardar el justificante y el CSV</li>
              <li>el asiento de liquidación: 477 contra 472{r?.resultado === 'to_pay' ? ' y 4750' : r?.resultado ? ' y 4700' : ''}</li>
              {r?.resultado === 'to_pay' && <li>avisar si el cargo no llega al banco</li>}
            </ul>
          </div>
          <Boton variante="principal" grande ancho disabled={!boton.activo || enviando} onClick={() => setConfirmar(true)}>{enviando ? 'Presentando…' : boton.texto}</Boton>
          {boton.porque && <p className={boton.activo ? 's-apoyo' : 's-impuestos-porque-no'} role="note">{boton.porque}</p>}
          <p className="s-apoyo s-impuestos-nota">Hacienda revisa el modelo al recibirlo. Si encuentra un error, no se presenta nada y te dice qué falla.</p>
          <hr className="s-impuestos-raya" />
          {r && r.estado !== 'pending' && <Boton variante="enlace" onClick={bajar}>Descargar el fichero oficial</Boton>}
          {r && d.puede_gestionar && <Boton variante="enlace" onClick={() => setFuera(true)}>Ya lo presenté fuera · pegar CSV</Boton>}
        </>
      )}
      {confirmar && r && (
        <Dialogo titulo="¿Presentar a Hacienda?" alCerrar={() => setConfirmar(false)} explicacion={textoConfirmar(d)}
          acciones={<><Boton onClick={() => setConfirmar(false)}>Cancelar</Boton><Boton variante="principal" disabled={enviando} onClick={presentar}>{enviando ? 'Presentando…' : `Sí, ${boton.texto.charAt(0).toLowerCase()}${boton.texto.slice(1)}`}</Boton></>}>
          <p className="s-apoyo">Hacienda revisa el modelo al recibirlo. Si encuentra un error, no se presenta nada y te dice qué falla.</p>
        </Dialogo>
      )}
      {fuera && r && <DialogoFuera d={d} puerta={puerta} alCerrar={() => setFuera(false)} hacer={hacer} />}
    </section>
  )
}

function Pago({ d, hacer }: { d: DeclaracionVer; hacer: Hacer }) {
  const r = d.declaracion!
  const editable = d.puede_gestionar && ['draft', 'reviewed'].includes(r.estado)
  const [banco, setBanco] = useState(r.pago_cuenta ?? d.bancos[0]?.id ?? '')
  const opciones = d.bancos.map((b) => ({ valor: b.id, texto: `${b.nombre} ···· ${b.final}` }))
  return (
    <div className="s-impuestos-panel-bloque">
      <span className="s-apoyo">Pago</span>
      <span>{textoPago(d)}</span>
      {editable && r.resultado === 'to_pay' && (
        <>
          {sePuedeDomiciliar(d) && r.pago !== 'direct_debit' && opciones.length > 0 && (
            <span className="s-impuestos-pago">
              <Campo etiqueta="Domiciliar en">{(p) => <Selector {...p} valor={banco} alCambiar={setBanco} opciones={opciones} />}</Campo>
              <Boton onClick={() => hacer(async () => (await ponerPago(r.id, 'direct_debit', banco)).mensaje)}>Domiciliar</Boton>
            </span>
          )}
          {sePuedeDomiciliar(d) && opciones.length === 0 && <span className="s-apoyo">Para domiciliar, da de alta el banco con su IBAN en Bancos.</span>}
          {!sePuedeDomiciliar(d) && d.domiciliacion && <span className="s-apoyo">Domiciliar ya no se puede: era hasta el {diaMesCorto(d.domiciliacion)}.</span>}
          {r.pago === 'direct_debit' && (
            <Boton variante="enlace" onClick={() => hacer(async () => (await ponerPago(r.id, 'self', null)).mensaje)}>
              Pagar yo, sin domiciliar{d.presentacion ? ` (hasta el ${diaMesCorto(d.presentacion)})` : ''}
            </Boton>
          )}
        </>
      )}
      {editable && r.resultado === 'to_refund' && opciones.length > 0 && (
        <span className="s-impuestos-pago">
          <Campo etiqueta="Que lo devuelvan en">{(p) => <Selector {...p} valor={banco} alCambiar={setBanco} opciones={opciones} />}</Campo>
          <Boton onClick={() => hacer(async () => (await ponerPago(r.id, 'refund', banco)).mensaje)}>Guardar</Boton>
        </span>
      )}
    </div>
  )
}

function Presentado({ d, paso, hacer }: { d: DeclaracionVer; paso: ReturnType<typeof siguientePaso>; hacer: Hacer }) {
  const r = d.declaracion!
  const [cargos, setCargos] = useState<CargoPosible[] | null>(null)
  useEffect(() => {
    if (paso !== 'casar') return
    let vivo = true
    cargosPosibles(r.id).then((c) => { if (vivo) setCargos(c) }, () => { if (vivo) setCargos([]) })
    return () => { vivo = false }
  }, [paso, r.id])
  return (
    <>
      <div className="s-impuestos-panel-bloque">
        <Chip tono="seguro">{r.por === 'outside' ? 'Presentado fuera' : 'Presentado'}</Chip>
        <span>el {r.presentada ? `${diaMesCorto(r.presentada)} a las ${new Date(r.presentada).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}` : '—'}{r.presentada_por ? ` por ${r.presentada_por}` : ''}</span>
        {r.csv && <span className="s-apoyo">CSV {r.csv}</span>}
        {r.justificante && <span className="s-apoyo">Justificante {r.justificante}</span>}
        {!r.justificante_pdf && <Link to={rutaImpuestos('presentados')}>Falta el justificante en PDF: súbelo en Presentados</Link>}
      </div>
      <div className="s-impuestos-panel-bloque">
        <span className="s-apoyo">Pago</span>
        <span>{textoPago(d)}</span>
      </div>
      {paso === 'contabilizar' && d.puede_gestionar && (
        <Boton variante="principal" ancho onClick={() => hacer(async () => (await contabilizar303(r.id)).mensaje)}>Contabilizar la liquidación</Boton>
      )}
      {paso === 'casar' && (
        <div className="s-impuestos-panel-bloque">
          <span className="s-apoyo">{r.resultado === 'to_pay' ? 'El cargo en el banco' : 'El abono en el banco'}</span>
          {cargos === null && <span className="s-apoyo">Buscando…</span>}
          {cargos?.length === 0 && <span>Aún no ha llegado al banco un movimiento de {eurosExactos(r.importe ?? 0)}. Cuando llegue, cásalo aquí; si no llega, te avisamos en Inicio.</span>}
          {cargos?.map((c) => (
            <span key={c.movimiento} className="s-impuestos-pago">
              <span>{diaMesCorto(c.fecha)} · {c.cuenta} · <span className="s-cifra">{eurosExactos(c.importe)}</span>{c.concepto ? ` · ${c.concepto}` : ''}</span>
              <Boton onClick={() => hacer(async () => (await casarCargo(r.id, c.movimiento)).mensaje)}>Es este</Boton>
            </span>
          ))}
        </div>
      )}
      {paso === 'nada' && <p className="s-impuestos-hecho">Todo hecho: presentado, contabilizado{r.estado === 'paid' ? ' y pagado' : r.estado === 'refunded' ? ' y devuelto' : ''}.</p>}
    </>
  )
}

function DialogoFuera({ d, puerta, alCerrar, hacer }: { d: DeclaracionVer; puerta: Puerta | null; alCerrar: () => void; hacer: Hacer }) {
  const r = d.declaracion!
  const [csv, setCsv] = useState('')
  const limpio = csv.replace(/\s/g, '').toUpperCase()
  const valido = /^[A-Z0-9]{16}$/.test(limpio)
  const ce = d.presentador.certificado
  const comprobable = !!puerta?.abierta && !!ce && d.presentador.puedo_presentar
  const apuntar = (comprobar: boolean) => hacer(async () => {
    alCerrar()
    const confirmacion = comprobar && ce ? await confirmarCertificado(ce.id, 'query', r.id) : null
    const s = await hacienda('ya_presentado_fuera', { declaracion: r.id, csv: limpio, confirmacion })
    if (!s.ok) throw new Error(s.mensaje)
    return s.mensaje
  })
  return (
    <Dialogo titulo="Ya lo presenté fuera" alCerrar={alCerrar}
      explicacion="Pega el CSV del justificante que te dio Hacienda (16 letras y números). Queda apuntado como presentado, y Sumied hace el asiento de liquidación."
      acciones={<>
        <Boton onClick={alCerrar}>Cancelar</Boton>
        {comprobable && <Boton disabled={!valido} onClick={() => apuntar(true)}>Comprobarlo con Hacienda y apuntar</Boton>}
        <Boton variante="principal" disabled={!valido} onClick={() => apuntar(false)}>{comprobable ? 'Apuntar sin comprobar' : 'Apuntar'}</Boton>
      </>}>
      <Campo etiqueta="CSV del justificante" error={csv && !valido ? 'Son 16 letras y números, como aparecen en el justificante.' : null}
        ayuda={comprobable ? null : 'Sin la conexión con Hacienda abierta, se apunta sin comprobar y se dice así.'}>
        {(p) => <Texto {...p} valor={csv} alCambiar={setCsv} autoComplete="off" />}
      </Campo>
    </Dialogo>
  )
}
