// src/modules/conta/documentos/RevisarFacturaPage.tsx
//
// D01 · N23 «Revisar factura» (maqueta N23Revisar). A la izquierda el papel tal
// como llegó; a la derecha la banda de la IA (qué es y con qué casa), «Lo que
// he leído» con su porqué, «Cómo se apunta» con la propuesta de verdad (la
// misma función que la tanda, sin escribir) y un solo botón azul: «Está bien ·
// apuntar». Las cuentas, siempre nombre · código. Anterior y Siguiente recorren
// la lista de N22 con su mismo filtro y mes.
//
// «Está bien · apuntar» aprueba como en Compras, propone, valida, guarda su PDF
// y la manda a Diez; cada paso que no sale se dice (regla 8), también el freno
// de Diez («No ha llegado a Diez: …»). En el móvil, el papel arriba y el botón
// abajo, bajo el pulgar.
//
// R5 (Julio, capturas): el vencimiento de la factura manda y, si su ficha da
// otro día, se dice en ámbar; no se promete «a Diez con su PDF» mientras Diez
// no guarde documentos; «Cómo se apunta» en dos columnas con su título; el
// papel del móvil recortado a lo escrito (unos 280 px como mucho) y entero al
// tocarlo; la banda en ámbar mientras no esté apuntada.

import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaCompras, rutaDocumentos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { eurosExactos, porcentaje } from '@/modules/conta/lib/formato'
import {
  VERES, columnasDelApunte, comoLlego, filtrar, limites, lineaDiez, tonoDeLaFactura, vencimientoAEnsenar, verDe,
} from '@/modules/conta/documentos/documentos'
import { useProducto } from '@/modules/conta/documentos/producto'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import {
  apuntarFactura, decirProveedor, leerDocumentos, leerFactura, plazoDeLaFicha, proveedoresDeLaCuenta, urlDelPapel, verPropuestaFactura,
  type Apuntada, type FacturaRevisar,
} from '@/modules/conta/services/documentosService'

const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
/** R5 · 4: lo más que ocupa el papel en el móvil antes de tocarlo. */
const PAPEL_MOVIL_MAX = 280
const euro = (n: number | null) => (n === null ? '—' : eurosExactos(n))

export default function RevisarFacturaPage() {
  const { invoiceId = '' } = useParams()
  const [query] = useSearchParams()
  const navegar = useNavigate()
  const { accountId, userId, userName } = useCuentaConta()
  const movil = useIsMobile()
  const producto = useProducto()
  const ver = verDe(query.get('ver'))
  const mes = query.get('mes')
  const [vuelta, setVuelta] = useState(0)
  const f = useLeer(invoiceId ? () => leerFactura(invoiceId) : null, `${invoiceId}:${vuelta}`)
  const fac = f.datos

  // La lista de N22 con su filtro, para «1 de 5», Anterior y Siguiente.
  const lista = useLeer(fac?.company_id && mes ? async () => {
    const { desde, hasta } = limites(mes)
    const d = await leerDocumentos(fac.company_id!, desde, hasta)
    return filtrar(d.filas, ver).filter((x) => x.tipo === 'factura').map((x) => x.id)
  } : null, `${fac?.company_id}:${mes}:${ver}:${vuelta}`)
  const ids = lista.datos ?? []
  const pos = ids.indexOf(invoiceId)
  const ir = (id: string) => navegar(`${rutaRevisarFactura(id)}?ver=${ver}&mes=${mes ?? ''}`)

  // La clave lleva la ruta: sin ella no se vuelve a leer cuando llega la factura (y se quedaba sin papel).
  const papel = useLeer(fac ? () => urlDelPapel(fac) : null, `${invoiceId}:papel:${fac?.llegada?.ruta ?? fac?.papel ?? ''}`)
  const plazo = useLeer(fac?.proveedor?.id && accountId ? () => plazoDeLaFicha(accountId, fac.proveedor!.id) : null, `${accountId}:${fac?.proveedor?.id}:plazo:${vuelta}`)
  const vista = useLeer(fac && accountId && fac.company_id && fac.fecha && !fac.asiento ? () => verPropuestaFactura(accountId, fac.company_id!, fac.id, fac.fecha!) : null,
    `${invoiceId}:${fac?.estado}:${fac?.proveedor?.id}:${vuelta}`)

  const [apuntando, setApuntando] = useState(false)
  // Lo que ha pasado al apuntar, de ESTA factura (al pasar a la siguiente no se arrastra).
  const [apuntada, setApuntada] = useState<{ id: string; r: Apuntada } | null>(null)
  const hecho = apuntada?.id === invoiceId ? apuntada.r : null
  const [otra, setOtra] = useState(false)

  async function apuntar() {
    if (!fac) return
    setApuntando(true)
    try {
      const r = await apuntarFactura(fac, userName, userId)
      setApuntada({ id: fac.id, r })
      setVuelta((v) => v + 1)
    } finally {
      setApuntando(false)
    }
  }

  const volver = rutaDocumentos(ver, mes ?? undefined)
  if (f.error) return <ErrorConReintento mensaje={f.error} reintentar={f.recargar} />
  if (!fac) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando la factura">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={40} />)}</div>

  const prov = fac.proveedor
  const titulo = `${prov?.nombre ?? 'No reconozco el emisor'}${fac.numero ? ` · ${fac.numero}` : ''}`
  const yaApuntada = fac.asiento?.estado === 'validado'
  const sinProveedor = !prov
  const lectura = fac.lectura
  const avisos = (lectura?.comprobaciones ?? []).filter((c) => !c.ok)
  const vence = vencimientoAEnsenar(fac.vence, fac.fecha, plazo.datos ?? null)

  const navegacion = ids.length > 1 && pos >= 0 && (
    <div className="cxr-navegar">
      <button type="button" className="cx-boton-sec" disabled={pos <= 0} onClick={() => ir(ids[pos - 1])}>← Anterior</button>
      <button type="button" className="cx-boton-sec" disabled={pos >= ids.length - 1} onClick={() => ir(ids[pos + 1])}>Siguiente →</button>
    </div>
  )

  const botonApuntar = !yaApuntada && (
    <button type="button" className="cx-boton" onClick={() => void apuntar()} disabled={apuntando || sinProveedor || !fac.fecha}>
      {apuntando ? 'Apuntando…' : 'Está bien · apuntar'}
    </button>
  )

  return (
    <div className="cxl-pagina">
      <header className="cxl-cabeza">
        <div>
          <Migas migas={[
            { etiqueta: 'Documentos', ruta: rutaDocumentos() }, { etiqueta: 'Facturas recibidas', ruta: volver },
            { etiqueta: `${VERES.find((v) => v.id === ver)!.nombre}${pos >= 0 && ids.length ? ` · ${pos + 1} de ${ids.length}` : ''}` },
          ]} />
          <h1 className="cxl-titulo" style={{ fontSize: movil ? 24 : 28 }}>{titulo}</h1>
        </div>
        {!movil && navegacion}
      </header>

      <div className="cxr-revisar">
        <Papel fac={fac} url={papel.datos ?? null} error={papel.error} solo={producto.solo} movil={movil} />

        <div className="cxr-lado">
          <BandaFactura fac={fac} />

          <section className="cxr-bloque" aria-label="Lo que he leído">
            <h2>Lo que he leído</h2>
            <div className="cxr-leido">
              <Leido etiqueta="Proveedor" valor={prov?.nombre ?? fac.propuesto?.nombre ?? 'No lo reconozco'}
                apoyo={prov ? `${prov.nif ? `NIF ${prov.nif}` : 'sin NIF'} · ficha ✓` : `${fac.propuesto?.nif ? `NIF ${fac.propuesto.nif} · ` : ''}no está en tus proveedores`} />
              <Leido etiqueta="Factura" valor={`${fac.numero ?? 'sin número'} · ${fecha(fac.fecha)}`} apoyo={fac.no_repetida ? 'no está repetida (lo confirmaste)' : 'no hay otra con su número y su total'} />
              {fac.tipos.map((t) => <Leido key={`b${t.tipo}`} etiqueta={`Base al ${porcentaje(t.tipo)}`} valor={euro(t.base)} />)}
              {fac.tipos.map((t) => <Leido key={`c${t.tipo}`} etiqueta={`IVA ${porcentaje(t.tipo)}`} valor={euro(t.cuota)} />)}
              {!!fac.recargo && <Leido etiqueta="Recargo de equivalencia" valor={euro(fac.recargo)} />}
              {!!fac.retencion && <Leido etiqueta="Retención" valor={euro(-Math.abs(fac.retencion))} />}
              <Leido etiqueta="Total" valor={euro(fac.total)} apoyo={avisos.some((a) => a.id === 'total' || a.id === 'suma') ? 'no cuadra con sus bases' : 'cuadra con sus bases'} aviso={avisos.some((a) => a.id === 'total' || a.id === 'suma')} />
              {fac.recepcion && <Leido etiqueta="Local" valor={fac.recepcion.local ?? '—'} apoyo={`de la recepción del ${fecha(fac.recepcion.fecha).slice(0, 5)}`} />}
              <Leido etiqueta="Vence" valor={vence.valor} apoyo={vence.apoyo} aviso={vence.aviso} />
              {prov && <Leido etiqueta="Sus facturas se apuntan en" valor={prov.gasto ? `${prov.gasto.nombre} · ${prov.gasto.cuenta}` : 'sin decidir'}
                apoyo={prov.gasto?.origen ?? 'aún no hay nada aprendido'} />}
              {prov?.facturacion && <Leido etiqueta="Facturación" valor={prov.facturacion.nombre} apoyo={prov.facturacion.email} />}
            </div>
            {avisos.length > 0 && <ul className="cxr-aviso" style={{ margin: '10px 0 0', paddingLeft: 18 }}>{avisos.map((a) => <li key={a.id}>{a.texto}</li>)}</ul>}
          </section>

          {sinProveedor && <DecirProveedor accountId={accountId} invoiceId={fac.id} alGuardar={() => setVuelta((v) => v + 1)} />}

          <ComoSeApunta fac={fac} vista={vista.datos} error={vista.error} movil={movil} solo={producto.solo} />

          <div role="status" aria-live="polite">
            {hecho && <div className={`cx-tarjeta cxr-hecho${hecho.validado ? '' : ' cxr-mal'}`}><strong>{hecho.texto}</strong>
              {hecho.validado && pos >= 0 && pos < ids.length - 1 && <button type="button" className="cx-enlace" onClick={() => ir(ids[pos + 1])}>Siguiente factura →</button>}
            </div>}
          </div>

          {!movil && (
            <div className="cxr-acciones">
              <button type="button" className="cx-boton-sec" onClick={() => setOtra(true)}>Otra cosa</button>
              {botonApuntar}
            </div>
          )}
        </div>
      </div>

      {movil && (
        <div className="cxr-pulgar">
          <button type="button" className="cx-boton-sec" onClick={() => setOtra(true)}>Otra cosa</button>
          {botonApuntar || <Link to={volver} className="cx-boton-sec">Volver</Link>}
        </div>
      )}
      {movil && navegacion}

      {otra && (
        <Dialogo titulo="¿Qué le pasa?" alCerrar={() => setOtra(false)}>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Si los importes, la fecha o el número no son esos, corrígelos en <Link to={rutaCompras()}>Compras</Link>: allí se aprueba la factura de su recepción.</li>
            <li>Si no es de este proveedor, elige el bueno aquí abajo.</li>
          </ul>
          <DecirProveedor accountId={accountId} invoiceId={fac.id} alGuardar={() => { setOtra(false); setVuelta((v) => v + 1) }} />
        </Dialogo>
      )}
    </div>
  )
}

function Leido({ etiqueta, valor, apoyo, aviso }: { etiqueta: string; valor: string; apoyo?: string; aviso?: boolean }) {
  return (
    <>
      <div>{etiqueta}</div>
      <div className="cxr-leido-valor">{valor}{apoyo && <span className={`cxr-apoyo${aviso ? ' cxr-aviso' : ''}`}>{apoyo}</span>}</div>
    </>
  )
}

function Papel({ fac, url, error, solo, movil }: { fac: FacturaRevisar; url: string | null; error: string | null; solo: boolean; movil: boolean }) {
  const l = fac.llegada
  const esFoto = /^image\//.test(l?.tipo ?? '') || /\.(jpe?g|png|webp)$/i.test(l?.archivo ?? fac.papel ?? '')
  // R5 · 4: en el móvil, recortado a lo escrito (como mucho 280 px) y entero al tocarlo.
  const [entero, setEntero] = useState(false)
  const [tinta, setTinta] = useState<number | null>(null)
  const recorte = movil && !entero ? Math.min(PAPEL_MOVIL_MAX, tinta ? Math.max(120, Math.ceil(tinta) + 12) : PAPEL_MOVIL_MAX) : null
  const cuando = l?.cuando ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(l.cuando)) : null
  return (
    <section className="cxr-papel" aria-label="La factura tal como llegó">
      <div className="cxr-papel-cabeza">
        <span>{l?.archivo ?? 'Factura'} · {comoLlego(l?.canal ?? fac.canal, l?.tipo, solo)}{l?.a ? ` a ${l.a.replace(/@.*/, '@')}` : ''}{cuando ? ` · ${cuando}` : ''}</span>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="cx-enlace">Abrir</a>}
      </div>
      <div className="cxr-papel-hoja">
        {error && <p className="cx-error">No se ha podido abrir el papel: {error}</p>}
        {!error && !url && <p className="cx-ayuda">Esta factura no tiene papel guardado.</p>}
        {url && (
          // Tocar el papel también lo abre o lo recoge (el botón de debajo es lo mismo, para el teclado y el lector).
          <div className={`cxr-papel-recorte${recorte !== null ? ' cxr-papel-recortado' : ''}`} style={recorte !== null ? { maxHeight: recorte } : undefined}
            onClick={movil ? () => setEntero((x) => !x) : undefined}>
            {esFoto ? <img src={url} alt={`La factura ${fac.numero ?? ''} tal como llegó`} />
              : <PapelPdf url={url} titulo={`La factura ${fac.numero ?? ''} tal como llegó`} alMedir={setTinta} />}
          </div>
        )}
        {url && movil && (
          <button type="button" className="cx-enlace cxr-papel-entero" aria-expanded={entero} onClick={() => setEntero((x) => !x)}>
            {entero ? 'Recoger el papel' : 'Ver el papel entero'}
          </button>
        )}
      </div>
    </section>
  )
}

function BandaFactura({ fac }: { fac: FacturaRevisar }) {
  const porque = fac.lectura?.porque ?? []
  const prov = fac.proveedor?.nombre
  const casa = fac.recepcion ? ` y casa con lo recibido${fac.recepcion.local ? ` en ${fac.recepcion.local}` : ''} el ${fecha(fac.recepcion.fecha).slice(0, 5)}` : ''
  const titulo = fac.asiento?.estado === 'validado' ? `Ya está apuntada${fac.asiento.numero ? ` (asiento ${fac.asiento.numero})` : ''}.`
    : prov ? `Es de ${prov}${casa}.` : 'No reconozco quién la emite: dime de quién es y la apunto.'
  return (
    <section className={`cx-ia-bloque${tonoDeLaFactura(fac.asiento) === 'ambar' ? ' cxr-ia-ambar' : ''}`} aria-label="Lo que entiendo de esta factura">
      <span className="cx-ia-punto" aria-hidden="true" />
      <div className="cx-ia-texto">
        <span className="cx-ia-titulo">{titulo}</span>
        {porque.length > 0 && <span className="cx-ia-porque">{porque.join(' ')}</span>}
      </div>
    </section>
  )
}

function ComoSeApunta({ fac, vista, error, movil, solo }: {
  fac: FacturaRevisar; vista: Awaited<ReturnType<typeof verPropuestaFactura>> | null; error: string | null; movil: boolean; solo: boolean
}) {
  const lineas = vista?.propuesta ? vista.propuesta.lineas : []
  // El nombre se acorta si no cabe; el código, nunca: una cuenta siempre con su código al lado.
  const nombre = (cuenta: string) => (
    <span className="cxr-apunte-cuenta" title={`${(vista?.propuesta ? vista.nombres.get(cuenta) : null) ?? 'Cuenta'} · ${cuenta}`}>
      <span className="cxr-apunte-nombre">{(vista?.propuesta ? vista.nombres.get(cuenta) : null) ?? 'Cuenta'}</span>
      <span className="cxr-apunte-codigo">{`\u00a0· ${cuenta}`}</span>
    </span>
  )
  const col = columnasDelApunte(lineas)
  return (
    <section className="cxr-bloque" aria-label="Cómo se apunta">
      <h2>Cómo se apunta</h2>
      {fac.asiento && <p style={{ margin: 0 }}>Ya tiene su asiento ({fac.asiento.estado}).</p>}
      {!fac.asiento && error && <p className="cx-error">No se ha podido preparar: {error}</p>}
      {!fac.asiento && !error && !vista && <Hueso alto={60} />}
      {!fac.asiento && vista && !vista.propuesta && <p className="cxr-aviso" style={{ margin: 0 }}>{vista.porque}</p>}
      {!fac.asiento && vista?.propuesta && (
        <>
          {movil ? (
            // R5 · 3: en el móvil, cada cuenta en su línea y su cifra a la derecha, por grupos.
            <div className="cxr-apunte-movil">
              {([['Gasto e IVA', col.gasto], ['A pagar', col.pagar]] as const).map(([titulo, filas]) => (
                <div key={titulo} className="cxr-apunte-grupo">
                  <span className="cxr-apunte-titulo">{titulo}</span>
                  {filas.map((l, i) => (
                    <div key={i} className="cxr-apunte-linea">{nombre(l.cuenta)}<span className="cxr-der">{eurosExactos(l.importe)}</span></div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="cxr-apunte" role="table" aria-label="Las líneas del asiento">
              <span className="cxr-apunte-titulo" role="columnheader">Cuenta</span>
              <span className="cxr-apunte-titulo cxr-der" role="columnheader">Gasto e IVA</span>
              <span className="cxr-apunte-titulo cxr-der" role="columnheader">A pagar</span>
              {lineas.map((l, i) => (
                <div key={i} style={{ display: 'contents' }} role="row">
                  <span role="cell" className="cxr-apunte-celda">{nombre(l.cuenta)}</span>
                  <span className="cxr-der" role="cell">{l.debe ? eurosExactos(l.debe) : ''}</span>
                  <span className="cxr-der" role="cell">{l.haber ? eurosExactos(l.haber) : ''}</span>
                </div>
              ))}
            </div>
          )}
          <p className="cxr-apoyo" style={{ margin: '8px 0 0' }}>Facturas recibidas{fac.recepcion?.local ? ` · ${fac.recepcion.local}` : ''} · {lineaDiez(solo)}</p>
          {vista.propuesta.avisos.length > 0 && <ul className="cxr-aviso" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{vista.propuesta.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </>
      )}
    </section>
  )
}

function DecirProveedor({ accountId, invoiceId, alGuardar }: { accountId: string | null; invoiceId: string; alGuardar: () => void }) {
  const ps = useLeer(accountId ? () => proveedoresDeLaCuenta(accountId) : null, `${accountId}:proveedores`)
  const [elegido, setElegido] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function guardar() {
    setOcupado(true); setFallo(null)
    try { await decirProveedor(invoiceId, elegido); alGuardar() } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  return (
    <section className="cxr-bloque" aria-label="De quién es">
      <h2>¿De quién es?</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select className="cx-input" value={elegido} onChange={(e) => setElegido(e.target.value)} aria-label="Proveedor" style={{ flex: 1, minWidth: 0 }}>
          <option value="">Elige el proveedor…</option>
          {(ps.datos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.nif ? ` · ${p.nif}` : ''}</option>)}
        </select>
        <button type="button" className="cx-boton" disabled={!elegido || ocupado} onClick={() => void guardar()}>Es este</button>
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </section>
  )
}
