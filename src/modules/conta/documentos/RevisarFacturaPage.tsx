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
//
// S01 · Decisiones de Julio sobre la maqueta 3 (17/10): «No es una factura»
// la deja descartada con su motivo, quién y cuándo, y se deshace (0160);
// «Lo que he leído» es de lectura, con el enlace directo a corregir en Compras;
// «Lo que he comprobado» es el bloque verde (✓ por comprobación, y en ámbar
// lo que no cuadra: no se esconde) y «Ver el asiento» se pliega.
//
// S01 (maqueta 3): la MISMA factura y el MISMO componente se ven desde
// Contabilidad › Asientos › Recibidas (`enAsientos`), con otro marco: las migas
// de Asientos, «N de M para revisar» y «Validar y siguiente ⏎» (Intro), que
// apunta y, si queda validada, pasa a la siguiente diciendo lo que ha hecho.

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaCompras, rutaDocumentos, rutaLibroDiario, rutaRecibidaEnAsientos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { eurosExactos, hoyEnMadrid, porcentaje } from '@/modules/conta/lib/formato'
import {
  VERES, ventanaParaRevisar, columnasDelApunte, facturasEnOrden, comoLlego, limites, lineaDiez, productoDeDocumentos, tonoDeLaFactura, vencimientoAEnsenar, verDe,
} from '@/modules/conta/documentos/documentos'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import {
  apuntarFactura, decirProveedor, descartarFactura, leerDescarte, leerDocumentos, leerFactura, plazoDeLaFicha, proveedoresDeLaCuenta, recuperarFactura,
  urlDelPapel, verPropuestaFactura, type Apuntada, type FacturaRevisar,
} from '@/modules/conta/services/documentosService'
import { useAnalitica, useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { PorNivel } from '@/modules/conta/textos/PorNivel'
import { useTexto } from '@/modules/conta/textos/useTexto'

const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
/** R5 · 4: lo más que ocupa el papel en el móvil antes de tocarlo. */
const PAPEL_MOVIL_MAX = 280
const euro = (n: number | null) => (n === null ? '—' : eurosExactos(n))

export default function RevisarFacturaPage({ enAsientos = false }: { enAsientos?: boolean }) {
  // S01: el local de la recepción, solo con el eje encendido (Definiciones › Analítica).
  const { local: ejeLocal } = useAnalitica()
  // S01 (paso 4): las palabras por nivel (maqueta 5); las cajas no se mueven.
  const tx = useTexto()
  const { invoiceId = '' } = useParams()
  const [query] = useSearchParams()
  const navegar = useNavigate()
  const { accountId, userId, userName } = useCuentaConta()
  const movil = useIsMobile()
  const producto = productoDeDocumentos(useProductoSolo(), MARCA.nombre)
  const ver = verDe(query.get('ver'))
  const mes = query.get('mes')
  const avisoDeAntes = (useLocation().state as { aviso?: string } | null)?.aviso ?? null
  const [vuelta, setVuelta] = useState(0)
  const f = useLeer(invoiceId ? () => leerFactura(invoiceId) : null, `${invoiceId}:${vuelta}`)
  const fac = f.datos

  // La lista de N22 con su filtro, para «1 de 5», Anterior y Siguiente.
  // Desde Asientos (S01), no por mes: las que esperan de los últimos 12 meses.
  const lista = useLeer(fac?.company_id && (mes || enAsientos) ? async () => {
    const { desde, hasta } = enAsientos ? ventanaParaRevisar(hoyEnMadrid()) : limites(mes!)
    const d = await leerDocumentos(fac.company_id!, desde, hasta)
    return facturasEnOrden(d.filas, ver)
  } : null, `${fac?.company_id}:${mes}:${ver}:${vuelta}`)
  const ids = lista.datos ?? []
  const pos = ids.indexOf(invoiceId)
  const ir = (id: string, aviso?: string) => navegar(enAsientos ? `${rutaRecibidaEnAsientos(id)}?ver=${ver}` : `${rutaRevisarFactura(id)}?ver=${ver}&mes=${mes ?? ''}`, aviso ? { state: { aviso } } : undefined)

  // La clave lleva la ruta: sin ella no se vuelve a leer cuando llega la factura (y se quedaba sin papel).
  const papel = useLeer(fac ? () => urlDelPapel(fac) : null, `${invoiceId}:papel:${fac?.llegada?.ruta ?? fac?.papel ?? ''}`)
  const plazo = useLeer(fac?.proveedor?.id && accountId ? () => plazoDeLaFicha(accountId, fac.proveedor!.id) : null, `${accountId}:${fac?.proveedor?.id}:plazo:${vuelta}`)
  const vista = useLeer(fac && accountId && fac.company_id && fac.fecha && !fac.asiento ? () => verPropuestaFactura(accountId, fac.company_id!, fac.id, fac.fecha!) : null,
    `${invoiceId}:${fac?.estado}:${fac?.proveedor?.id}:${vuelta}`)

  // S01 (0160): si está descartada, por qué, quién y cuándo.
  const descarte = useLeer(fac?.estado === 'descartada' ? () => leerDescarte(fac.id) : null, `${invoiceId}:${fac?.estado}:descarte:${vuelta}`)
  const [noEs, setNoEs] = useState(false)
  const [recuperado, setRecuperado] = useState<{ id: string; texto: string } | null>(null)
  const [falloDescarte, setFalloDescarte] = useState<string | null>(null)
  async function descartar(motivo: string) {
    if (!fac) return
    setFalloDescarte(null)
    try {
      await descartarFactura(fac.id, motivo, userName)
      setNoEs(false)
      const texto = `Descartada: «${motivo}». No es una factura y sale de «para revisar»; la tienes en Facturas recibidas › Todas, por si hay que deshacerlo.`
      const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
      if (enAsientos && siguiente) { ir(siguiente, texto); return }
      setRecuperado({ id: fac.id, texto })
      setVuelta((v) => v + 1)
    } catch (e) { setFalloDescarte(e instanceof Error ? e.message : String(e)) }
  }
  async function deshacerDescarte() {
    if (!fac) return
    setFalloDescarte(null)
    try {
      const estado = await recuperarFactura(fac.id, userName)
      setRecuperado({ id: fac.id, texto: `Recuperada: es una factura y vuelve a «${NOMBRE_ESTADO[estado] ?? estado}».` })
      setVuelta((v) => v + 1)
    } catch (e) { setFalloDescarte(e instanceof Error ? e.message : String(e)) }
  }
  const [apuntando, setApuntando] = useState(false)
  // Lo que ha pasado al apuntar, de ESTA factura (al pasar a la siguiente no se arrastra).
  const [apuntada, setApuntada] = useState<{ id: string; r: Apuntada } | null>(null)
  const hecho = apuntada?.id === invoiceId ? apuntada.r : null
  const [otra, setOtra] = useState(false)

  async function apuntar(ySiguiente = false) {
    if (!fac) return
    setApuntando(true)
    try {
      const r = await apuntarFactura(fac, userName, userId)
      // «Validar y siguiente»: solo pasa si quedó validada; lo hecho se dice en la siguiente (regla 8).
      const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
      if (ySiguiente && r.validado && siguiente) { ir(siguiente, r.texto); return }
      setApuntada({ id: fac.id, r })
      setVuelta((v) => v + 1)
    } finally {
      setApuntando(false)
    }
  }
  // Intro valida y pasa (el ⏎ del botón), salvo escribiendo o con un diálogo abierto.
  // Pulsa el botón mismo: si está apagado (sin proveedor, sin fecha, ya validada), no hace nada.
  useEffect(() => {
    if (!enAsientos) return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, button, a, [contenteditable="true"]') || t.closest('[role="dialog"]'))) return
      const boton = document.querySelector<HTMLButtonElement>('[data-validar-y-siguiente]')
      if (!boton || boton.disabled) return
      e.preventDefault(); boton.click()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [enAsientos])

  const volver = rutaDocumentos(ver, mes ?? undefined)
  if (f.error) return <ErrorConReintento mensaje={f.error} reintentar={f.recargar} />
  if (!fac) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando la factura">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={40} />)}</div>

  const prov = fac.proveedor
  const proveedor = prov?.nombre ?? 'No reconozco el emisor'
  const titulo = fac.numero ? tx('recibida.titulo', { proveedor, numero: fac.numero }) : tx('recibida.tituloSinNumero', { proveedor })
  const descartada = fac.estado === 'descartada'
  const yaApuntada = fac.asiento?.estado === 'validado' || descartada
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

  const sePuedeApuntar = !yaApuntada && !apuntando && !sinProveedor && !!fac.fecha
  const botonApuntar = !yaApuntada && (enAsientos
    ? <button type="button" className="cx-boton" onClick={() => void apuntar(true)} disabled={!sePuedeApuntar} aria-keyshortcuts="Enter" data-validar-y-siguiente="">
        {apuntando ? 'Validando…' : <><PorNivel clave="recibida.validarYSiguiente" /> <span aria-hidden="true">⏎</span></>}
      </button>
    : <button type="button" className="cx-boton" onClick={() => void apuntar()} disabled={apuntando || sinProveedor || !fac.fecha}>
        {apuntando ? 'Apuntando…' : <PorNivel clave="recibida.apuntar" />}
      </button>)
  const paraRevisar = pos >= 0 && ids.length ? ` · ${pos + 1} de ${ids.length}${ver === 'para-mirar' ? ' para revisar' : ''}` : ''
  const migas = enAsientos
    ? [{ etiqueta: 'Contabilidad', ruta: rutaLibroDiario() }, { etiqueta: 'Asientos', ruta: rutaLibroDiario() }, { etiqueta: `Recibidas${paraRevisar}` }]
    : [{ etiqueta: 'Documentos', ruta: rutaDocumentos() }, { etiqueta: 'Facturas recibidas', ruta: volver },
       { etiqueta: `${VERES.find((v) => v.id === ver)!.nombre}${pos >= 0 && ids.length ? ` · ${pos + 1} de ${ids.length}` : ''}` }]
  // Maqueta 3: arriba a la derecha, «← Anterior», lo que le pasa y «Validar y siguiente».
  const cabezaAsientos = enAsientos && !movil && (
    <div className="cxr-navegar">
      <button type="button" className="cx-boton-sec" disabled={pos <= 0} onClick={() => ir(ids[pos - 1])}>← Anterior</button>
      <button type="button" className="cx-boton-sec" onClick={() => setNoEs(true)} disabled={descartada}>No es una factura</button>
      {botonApuntar}
    </div>
  )
  const msgRecuperado = recuperado?.id === invoiceId ? recuperado.texto : null

  return (
    <div className="cxl-pagina">
      <header className="cxl-cabeza">
        <div>
          <Migas migas={migas} />
          <h1 className="cxl-titulo" style={{ fontSize: movil ? 24 : 28 }}>{titulo}</h1>
        </div>
        {enAsientos ? cabezaAsientos : !movil && navegacion}
      </header>
      <div role="status" aria-live="polite">
        {avisoDeAntes && !hecho && !msgRecuperado && <div className="cx-tarjeta cxr-hecho"><strong>{avisoDeAntes}</strong></div>}
        {msgRecuperado && <div className="cx-tarjeta cxr-hecho"><strong>{msgRecuperado}</strong></div>}
      </div>
      {falloDescarte && <div className="cx-error" role="alert">{falloDescarte}</div>}
      {descartada && (
        <section className="cx-tarjeta cxr-descartada" aria-label="No es una factura">
          <strong>No es una factura{descarte.datos ? `: ${descarte.datos.motivo}` : ''}.</strong>
          {descarte.datos && <span className="cx-ayuda"> La descartó {descarte.datos.quien ?? 'una persona'} el {fecha(descarte.datos.cuando.slice(0, 10))}. No se apunta ni cuenta en lo que debes.</span>}
          <button type="button" className="cx-boton-sec" onClick={() => void deshacerDescarte()}>Deshacer: sí es una factura</button>
        </section>
      )}

      <div className="cxr-revisar">
        <Papel fac={fac} url={papel.datos ?? null} error={papel.error} solo={producto.solo} movil={movil} />

        <div className="cxr-lado">
          <BandaFactura fac={fac} />

          <section className="cxr-bloque" aria-label="Lo que he leído">
            <div className="cxr-bloque-cabeza">
              <h2><PorNivel clave="recibida.leido" /></h2>
              {/* Decisión 2 (17/10): de lectura en este PR; se corrige en Compras, a un clic. */}
              <span className="cxr-bloque-enlaces">
                <Link to={rutaCompras()} className="cx-enlace">Corregir en Compras</Link>
                {prov && <button type="button" className="cx-enlace" onClick={() => setOtra(true)}>No es de este proveedor</button>}
              </span>
            </div>
            <div className="cxr-leido">
              <Leido etiqueta="Proveedor" valor={prov?.nombre ?? fac.propuesto?.nombre ?? 'No lo reconozco'}
                apoyo={prov ? `${prov.nif ? `NIF ${prov.nif}` : 'sin NIF'} · ficha ✓` : `${fac.propuesto?.nif ? `NIF ${fac.propuesto.nif} · ` : ''}no está en tus proveedores`} />
              <Leido etiqueta="Factura" valor={`${fac.numero ?? 'sin número'} · ${fecha(fac.fecha)}`} apoyo={fac.no_repetida ? 'no está repetida (lo confirmaste)' : 'no hay otra con su número y su total'} />
              {fac.tipos.map((t) => <Leido key={`b${t.tipo}`} etiqueta={`Base al ${porcentaje(t.tipo)}`} valor={euro(t.base)} />)}
              {fac.tipos.map((t) => <Leido key={`c${t.tipo}`} etiqueta={`IVA ${porcentaje(t.tipo)}`} valor={euro(t.cuota)} />)}
              {!!fac.recargo && <Leido etiqueta="Recargo de equivalencia" valor={euro(fac.recargo)} />}
              {!!fac.retencion && <Leido etiqueta="Retención" valor={euro(-Math.abs(fac.retencion))} />}
              <Leido etiqueta="Total" valor={euro(fac.total)} apoyo={avisos.some((a) => a.id === 'total' || a.id === 'suma') ? 'no cuadra con sus bases' : 'cuadra con sus bases'} aviso={avisos.some((a) => a.id === 'total' || a.id === 'suma')} />
              {ejeLocal && fac.recepcion && <Leido etiqueta={ejeLocal.nombre} valor={fac.recepcion.local ?? '—'} apoyo={`de la recepción del ${fecha(fac.recepcion.fecha).slice(0, 5)}`} />}
              <Leido etiqueta="Vence" valor={vence.valor} apoyo={vence.apoyo} aviso={vence.aviso} />
              {prov && <Leido etiqueta="Sus facturas se apuntan en" valor={prov.gasto ? `${prov.gasto.nombre} · ${prov.gasto.cuenta}` : 'sin decidir'}
                apoyo={prov.gasto?.origen ?? 'aún no hay nada aprendido'} />}
              {prov?.facturacion && <Leido etiqueta="Facturación" valor={prov.facturacion.nombre} apoyo={prov.facturacion.email} />}
            </div>
          </section>

          <Comprobado fac={fac} />

          {sinProveedor && <DecirProveedor accountId={accountId} invoiceId={fac.id} alGuardar={() => setVuelta((v) => v + 1)} />}

          <ComoSeApunta fac={fac} vista={vista.datos} error={vista.error} movil={movil} solo={producto.solo} />

          <div role="status" aria-live="polite">
            {hecho && <div className={`cx-tarjeta cxr-hecho${hecho.validado ? '' : ' cxr-mal'}`}><strong>{hecho.texto}</strong>
              {hecho.validado && pos >= 0 && pos < ids.length - 1 && <button type="button" className="cx-enlace" onClick={() => ir(ids[pos + 1])}>Siguiente factura →</button>}
            </div>}
          </div>

          {!movil && !enAsientos && (
            <div className="cxr-acciones">
              <button type="button" className="cx-boton-sec" onClick={() => setOtra(true)}>Otra cosa</button>
              <button type="button" className="cx-boton-sec" onClick={() => setNoEs(true)} disabled={descartada}>No es una factura</button>
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
            <li>Si no es una factura (un albarán, un presupuesto, un extracto…), <button type="button" className="cx-enlace" disabled={descartada} onClick={() => { setOtra(false); setNoEs(true) }}>dímelo y la saco de lo que hay que revisar</button>.</li>
          </ul>
          <DecirProveedor accountId={accountId} invoiceId={fac.id} alGuardar={() => { setOtra(false); setVuelta((v) => v + 1) }} />
        </Dialogo>
      )}
      {noEs && <NoEsFactura alCerrar={() => setNoEs(false)} alDescartar={(m) => descartar(m)} fallo={falloDescarte} />}
    </div>
  )
}

const NOMBRE_ESTADO: Record<string, string> = { borrador: 'borrador', en_revision: 'en revisión', aprobada: 'aprobada', con_discrepancias: 'con diferencias' }

const MOTIVOS = ['Es un albarán', 'Es un presupuesto', 'Es un extracto o un recibo', 'Está repetida'] as const

/** «No es una factura»: el motivo se elige o se escribe; sin motivo no se descarta (la base tampoco lo deja). */
function NoEsFactura({ alCerrar, alDescartar, fallo }: { alCerrar: () => void; alDescartar: (motivo: string) => Promise<void>; fallo: string | null }) {
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const listo = motivo.trim().length > 0
  return (
    <Dialogo titulo="No es una factura" alCerrar={alCerrar}>
      <p style={{ margin: 0 }}>Sale de lo que hay que revisar y no se apunta. No se borra: la tienes en Facturas recibidas › Todas y se puede deshacer.</p>
      <div role="group" aria-label="Qué es" className="cxr-motivos">
        {MOTIVOS.map((m) => <button key={m} type="button" className={motivo === m ? 'cx-boton' : 'cx-boton-sec'} aria-pressed={motivo === m} onClick={() => setMotivo(m)}>{m}</button>)}
      </div>
      <label className="cx-campo">Qué es, con tus palabras
        <input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ej.: es la proforma; la factura llega a fin de mes" />
      </label>
      {fallo && <p className="cx-error" role="alert">{fallo}</p>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" disabled={!listo || ocupado}
          onClick={() => { setOcupado(true); void alDescartar(motivo.trim()).finally(() => setOcupado(false)) }}>{ocupado ? 'Guardando…' : 'Descartar'}</button>
      </div>
    </Dialogo>
  )
}

/**
 * «Lo que he comprobado» (maqueta 3): una línea por comprobación de la lectura,
 * ✓ lo que cuadra y en ámbar lo que no (no se esconde: regla 7). Verde si todo
 * cuadra. Sin lectura del papel (hecha a mano), lo dice.
 */
function Comprobado({ fac }: { fac: FacturaRevisar }) {
  const com = fac.lectura?.comprobaciones ?? []
  const todo = com.length > 0 && com.every((c) => c.ok)
  const lineas = [
    ...com.map((c) => ({ id: c.id, ok: c.ok, texto: c.texto })),
    { id: 'repetida', ok: true, texto: fac.no_repetida ? 'No está repetida: lo confirmaste.' : 'No está repetida: ninguna otra de este proveedor con su número y su total.' },
  ]
  return (
    <section className={`cxr-comprobado${todo ? '' : ' cxr-comprobado-ambar'}`} aria-label="Lo que he comprobado">
      <h2>Lo que he comprobado</h2>
      {com.length === 0 && <p className="cx-ayuda" style={{ margin: 0 }}>No viene de leer un papel (se escribió a mano o en Compras): no hay comprobaciones de la lectura.</p>}
      <ul>
        {lineas.map((l) => <li key={l.id} className={l.ok ? 'cxr-ok' : 'cxr-falta'}><span aria-hidden="true">{l.ok ? '✓' : '!'}</span> {l.texto}</li>)}
      </ul>
    </section>
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
  const [abierto, setAbierto] = useState(useNivel() !== 'sin_experiencia')
  return (
    <section className="cxr-bloque" aria-label="Cómo se apunta">
      {/* Maqueta 3: «Ver el asiento», plegable. De serie abierto; sin experiencia, plegado (lo que se ofrece, no dónde está). */}
      <details className="cxr-plegable" open={abierto} onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><h2><PorNivel clave="recibida.verAsiento" /></h2></summary>
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
      </details>
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
