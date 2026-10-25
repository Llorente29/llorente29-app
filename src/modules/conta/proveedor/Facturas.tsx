// src/modules/conta/proveedor/Facturas.tsx
//
// Las facturas del proveedor (columna izquierda de N4 y apartado «Facturas»):
// fecha, número, importe y estado — «Pagada» en verde, «Por pagar» en azul y
// «¿Repetida?» en ámbar con su explicación en una línea (C01b §4: mismo
// número e importe que otra anterior; no se apunta en ninguna cifra).
// «¿Posible repetida?» (respuesta 2): misma fecha e importe con otro número;
// la misma decisión.
// «IBAN distinto al de la ficha» (respuesta 2, punto 1): la lectura trajo otra
// cuenta. Bancos no la casa (y la base lo rechaza) hasta que alguien decide
// «Es el nuevo IBAN» o «No es suyo».
//
// «Ver» abre la factura: cambiar el vencimiento y, si está por pagar, cómo se
// paga. PC01 (Julio, 25/10): «Marcar como pagada» y «Deshacer el pago» se
// fueron. O hay un pago con asiento, o no está pagada: queda pagada sola al
// casar su pago en Bancos (o con el pago del lote de prepago), y se deshace
// deshaciendo ese casado. La ficha dice lo pagado con asiento.
// Cada acción va por su RPC, que escribe la factura y su rastro a la vez, y
// confirma con contenido (regla 8).
//
// I01e (Julio, 20/10): salen también las facturas del libro de IVA de los
// asientos de su cuenta que no son una factura subida aquí —las traídas de
// Diez, sobre todo—, con su origen y «Ver» a su asiento. Antes, un proveedor
// traído de Diez decía «Aún no hay facturas suyas» con cinco en el libro.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Dialogo, HechoConDeshacer } from '@/modules/conta/proveedor/piezas'
import { Vacio } from '@/modules/conta/ui/piezas'
import { cambiarVencimiento, decidirIban, noEsRepetida, type FacturaDeProveedor } from '@/modules/conta/services/proveedorService'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { PAYMENT_METHOD_LABEL } from '@/modules/conta/types'
import { rutaSubirFacturaProveedor } from '@/config/navegacion'
import { ETIQUETA_REPETIDA } from '@/modules/conta/lib/repetidas'
import { AVISO_IBAN_DISTINTO, facturaFrenada, puedeSerElNuevo } from '@/modules/conta/lib/ibanFactura'
import { formatearIban, normalizarIban } from '@/modules/conta/lib/iban'
import { rutaAsiento } from '@/config/navegacion'
import { textoOrigenFactura, type FacturaDelLibro } from '@/modules/conta/lib/libroProveedor'
import { MARCA } from '../cuenta/marca'

const ESTADO: Record<string, { texto: string; tono: string }> = {
  aprobada: { texto: 'Por pagar', tono: 'cx-chip cx-chip-azul' },
  pagada: { texto: 'Pagada', tono: 'cx-chip cx-chip-ia' },
  borrador: { texto: 'Borrador', tono: 'cx-chip' },
  en_revision: { texto: 'En revisión', tono: 'cx-chip' },
  con_discrepancias: { texto: 'Con diferencias', tono: 'cx-chip' },
  // S01 (0160): sale, con lo que es (regla 7); se deshace en Contabilidad › Asientos › Recibida.
  descartada: { texto: 'No es una factura', tono: 'cx-chip' },
}

// PC01 · El estado de pago de una aprobada, el que calcula la base (conta_recibida_pago).
const ESTADO_PAGO: Record<string, { texto: string; tono: string }> = {
  pagada: { texto: 'Pagada', tono: 'cx-chip cx-chip-ia' },
  vencida: { texto: 'Vencida', tono: 'cx-chip cx-chip-rojo' },
  pagada_parte: { texto: 'Pagada en parte', tono: 'cx-chip cx-chip-ambar' },
  sin_vencimiento: { texto: 'Sin vencimiento', tono: 'cx-chip cx-chip-ambar' },
  vence_semana: { texto: 'Vence esta semana', tono: 'cx-chip cx-chip-ambar' },
  por_pagar: { texto: 'Por pagar', tono: 'cx-chip cx-chip-azul' },
}

const numero = (f: FacturaDeProveedor) => f.invoiceNumber ?? f.code ?? 'Sin número'

const ultimas4 = (iban: string | null) => iban ? `…${normalizarIban(iban).slice(-4)}` : '—'

/**
 * El aviso de la ficha (resumen y portada del móvil): qué facturas traen otro
 * IBAN y que no se paguen hasta decidir. Lleva a la lista de facturas.
 */
export function AvisoIban() {
  const { datos, rutaApartado } = useFicha()
  const distintas = datos.facturas.filter((f) => facturaFrenada(f, datos.ficha.iban))
  if (distintas.length === 0) return null
  const f = distintas[0]
  return (
    <div className="cx-aviso" role="alert">
      <strong>{AVISO_IBAN_DISTINTO}.</strong>{' '}
      {distintas.length === 1
        ? <>La factura {numero(f)} trae la cuenta {ultimas4(f.readIban)} y en la ficha tienes la {ultimas4(datos.ficha.iban)}.</>
        : <>{distintas.length} facturas traen otra cuenta que la de la ficha ({ultimas4(datos.ficha.iban)}).</>}
      {' '}No se puede marcar como pagada hasta que decidas si es su nuevo IBAN.{' '}
      <Link to={rutaApartado('facturas')}>{distintas.length === 1 ? 'Ver la factura' : 'Ver las facturas'}</Link>
    </div>
  )
}

/** La tarjeta «Facturas» del resumen: las últimas `max`, con «Ver todas». */
export function TarjetaFacturas({ max = 6 }: { max?: number }) {
  const { datos, rutaApartado, facturasLibro } = useFicha()
  const filas = juntas(datos.facturas, facturasLibro).slice(0, max)
  return (
    <section className="cx-tarjeta" aria-labelledby="cxp-facturas" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="cx-tarjeta-cabeza">
        <h2 id="cxp-facturas" className="cx-tarjeta-titulo">Facturas</h2>
        {datos.facturas.length + facturasLibro.length > 0 && <Link to={rutaApartado('facturas')} style={{ fontSize: 14, fontWeight: 600 }}>Ver todas</Link>}
      </div>
      <ListaFacturas facturas={filas.flatMap((x) => (x.tipo === 'sumied' ? [x.f] : []))} libro={filas.flatMap((x) => (x.tipo === 'libro' ? [x.l] : []))} />
    </section>
  )
}

type Fila = { tipo: 'sumied'; f: FacturaDeProveedor } | { tipo: 'libro'; l: FacturaDelLibro }
const fechaDe = (x: Fila) => (x.tipo === 'sumied' ? x.f.invoiceDate ?? '' : x.l.fecha)

/** Las de aquí y las del libro, de la más reciente a la más antigua (sin fecha, al final). */
function juntas(facturas: FacturaDeProveedor[], libro: FacturaDelLibro[]): Fila[] {
  return [...facturas.map((f) => ({ tipo: 'sumied' as const, f })), ...libro.map((l) => ({ tipo: 'libro' as const, l }))]
    .sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)))
}

/** `libro`: las del libro de IVA que no son una factura subida aquí (I01e). Sin ella, las de la ficha. */
export function ListaFacturas({ facturas, libro: libroDado }: { facturas: FacturaDeProveedor[]; libro?: FacturaDelLibro[] }) {
  const { datos, repetidas, facturasLibro, rutaApartado } = useFicha()
  const libro = libroDado ?? facturasLibro
  const [abierta, setAbierta] = useState<FacturaDeProveedor | null>(null)
  const [hecho, setHecho] = useState<{ texto: string; deshacer?: () => Promise<void> } | null>(null)
  // Si no se ha podido leer el libro, se dice: nunca «no tiene facturas» por no haberlas podido leer.
  const sinLibro = datos.libroError && (
    <div className="cx-aviso" role="alert" style={{ marginBottom: 10 }}>
      No se han podido leer sus facturas del libro de IVA ({datos.libroError}). Las de abajo son solo las subidas a {MARCA.nombre}.
    </div>
  )
  if (facturas.length === 0 && libro.length === 0) {
    if (datos.libroError) return sinLibro
    if (datos.libro?.apuntes.length) {
      return (
        <div style={{ borderTop: '1px solid var(--cx-linea)', paddingTop: 14 }}>
          <Vacio titulo="Ninguna factura suya en el libro de IVA."
            explicacion={`Su cuenta ${datos.libro.cuenta?.code ?? ''} sí tiene ${datos.libro.apuntes.length === 1 ? '1 apunte' : `${datos.libro.apuntes.length} apuntes`}: están en Contabilidad, con su origen.`}
            accion={<Link className="cx-boton-sec" to={rutaApartado('contabilidad')}>Ver sus apuntes</Link>} />
        </div>
      )
    }
    return (
      <div style={{ borderTop: '1px solid var(--cx-linea)', paddingTop: 14 }}>
        <Vacio titulo="Aún no hay facturas suyas."
          explicacion="Cuando subas la primera, aquí verás lo que le has comprado, lo que le debes y cuándo le toca el próximo pago."
          accion={<Link className="cx-boton-sec" to={rutaSubirFacturaProveedor(datos.ficha.id)}>Subir su primera factura</Link>} />
      </div>
    )
  }
  return (
    <>
      {sinLibro}
      {hecho && <HechoConDeshacer texto={hecho.texto} deshacer={hecho.deshacer} alIrse={() => setHecho(null)} />}
      <div role="list" aria-label="Facturas">
        {juntas(facturas, libro).map((x) => {
          if (x.tipo === 'libro') return <FilaDelLibro key={`libro-${x.l.entryId}-${x.l.numero}`} l={x.l} />
          const f = x.f
          const rep = repetidas.get(f.id)
          const frena = facturaFrenada(f, datos.ficha.iban)
          const e = rep ? { texto: ETIQUETA_REPETIDA[rep.nivel], tono: 'cx-chip cx-chip-ambar' }
            : frena ? { texto: 'IBAN distinto', tono: 'cx-chip cx-chip-ambar' }
            : (f.status === 'aprobada' || f.status === 'pagada') && f.estadoPago && ESTADO_PAGO[f.estadoPago] ? ESTADO_PAGO[f.estadoPago]
            : ESTADO[f.status] ?? { texto: f.status, tono: 'cx-chip' }
          return (
            <div key={f.id} role="listitem" className="cxp-factura">
              <span className="cxp-factura-fecha">{f.invoiceDate ? diaMesCorto(f.invoiceDate) : '—'}</span>
              <span className="cxp-factura-num">
                {numero(f)}{rep?.nivel === 'repetida' ? ' (otra vez)' : ''}
                {rep && <span className="cxp-factura-explica">{rep.explicacion}</span>}
                {!rep && frena && <span className="cxp-factura-explica">{AVISO_IBAN_DISTINTO}: trae la {ultimas4(f.readIban)}. No la pagues hasta decidir.</span>}
              </span>
              <span className="cxp-factura-importe">{f.grandTotal !== null ? eurosExactos(f.grandTotal) : '—'}</span>
              <span className="cxp-factura-estado"><span className={e.tono}>{e.texto}</span></span>
              <span className="cxp-factura-ver">
                <button type="button" className="cx-enlace" onClick={() => setAbierta(f)} aria-label={`Ver la factura ${numero(f)}`}>Ver</button>
              </span>
            </div>
          )
        })}
      </div>
      {abierta && (
        <DialogoFactura factura={abierta} alCerrar={() => setAbierta(null)}
          alHecho={(h) => { setAbierta(null); setHecho(h) }} />
      )}
    </>
  )
}

/** Una factura del libro de IVA (de Diez, sobre todo): con su origen y «Ver» a su asiento. */
function FilaDelLibro({ l }: { l: FacturaDelLibro }) {
  return (
    <div role="listitem" className="cxp-factura" data-prueba="factura-libro">
      <span className="cxp-factura-fecha">{diaMesCorto(l.fecha)}</span>
      <span className="cxp-factura-num">
        {l.numero}
        <span className="cxp-factura-origen">
          En el libro de IVA{l.asiento ? `, asiento ${l.asiento}` : ''}{l.isp ? '. Sin IVA en la factura: lo pusiste tú (inversión del sujeto pasivo)' : ''}
        </span>
      </span>
      <span className="cxp-factura-importe">{eurosExactos(l.importe)}</span>
      <span className="cxp-factura-estado"><span className="cx-chip" data-prueba="origen">{textoOrigenFactura(l.origen, MARCA.nombre)}</span></span>
      <span className="cxp-factura-ver">
        <Link className="cx-enlace" to={rutaAsiento(l.entryId)} aria-label={`Ver el asiento de la factura ${l.numero}`}>Ver</Link>
      </span>
    </div>
  )
}

function DialogoFactura({ factura: f, alCerrar, alHecho }: {
  factura: FacturaDeProveedor; alCerrar: () => void
  alHecho: (h: { texto: string; deshacer?: () => Promise<void> }) => void
}) {
  const { datos, repetidas, recargar, actor } = useFicha()
  const [venc, setVenc] = useState(f.dueDate ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importe = f.grandTotal !== null ? eurosExactos(f.grandTotal) : 'su importe'
  const num = numero(f)
  const rep = repetidas.get(f.id)
  const original = rep ? datos.facturas.find((x) => x.id === rep.deId) : null
  const frena = facturaFrenada(f, datos.ficha.iban)
  const nuevo = puedeSerElNuevo(f.readIban)

  async function hacer(accion: () => Promise<void>, texto: string, deshacer?: () => Promise<void>) {
    setOcupado(true); setError(null)
    try {
      await accion()
      await recargar()
      alHecho({ texto, deshacer })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo hacer.')
      setOcupado(false)
    }
  }

  return (
    <Dialogo titulo={`Factura ${num}`} alCerrar={alCerrar}>
      <p className="cx-ayuda" style={{ margin: 0, fontSize: 15 }}>
        {f.invoiceDate ? `Del ${fechaLarga(f.invoiceDate)} · ` : ''}<span className="cx-cifra">{importe}</span>
        {f.status === 'aprobada' && !rep && (f.dueDate ? ` · vence el ${fechaLarga(f.dueDate)}` : ' · sin vencimiento')}
        {f.status === 'pagada' && f.paidAt && ` · pagada el ${fechaLarga(f.paidAt)}${f.paidMethod ? ` por ${PAYMENT_METHOD_LABEL[f.paidMethod].toLowerCase()}` : ''}${f.paidByName ? ` (${f.paidByName})` : ''}`}
      </p>
      {error && <div className="cx-error" role="alert">{error}</div>}

      {rep && (
        <div className="cx-aviso">
          <strong>{ETIQUETA_REPETIDA[rep.nivel]}</strong> {rep.explicacion}
          {original && <> La de arriba es la {numero(original)} del {original.invoiceDate ? fechaLarga(original.invoiceDate) : 'sin fecha'}, que entró antes.</>}
          {' '}No cuenta en lo que le has comprado ni en lo que le debes.
        </div>
      )}
      {rep && (
        <button type="button" className="cx-boton-sec" disabled={ocupado} style={{ alignSelf: 'flex-start' }}
          onClick={() => hacer(() => noEsRepetida(f.id, actor.name),
            `Factura ${num} apuntada: no es repetida.${f.status === 'aprobada' || f.status === 'pagada' ? ' Ya cuenta en lo que le has comprado y en lo que le debes.' : ' Contará cuando se apruebe.'}`)}>
          {ocupado ? 'Guardando…' : 'No es repetida: apuntarla'}
        </button>
      )}

      {frena && f.readIban && (
        <div className="cx-aviso">
          <strong>{AVISO_IBAN_DISTINTO}.</strong> La factura trae <span className="cx-cifra">{formatearIban(normalizarIban(f.readIban))}</span>;
          {' '}en la ficha tienes <span className="cx-cifra">{datos.ficha.iban ? formatearIban(normalizarIban(datos.ficha.iban)) : '—'}</span>.
          {' '}Un cambio de cuenta en una factura es el engaño más común: si no te lo ha dicho el proveedor, llámale antes de decidir.
        </div>
      )}
      {frena && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="cx-boton-sec" disabled={ocupado || !nuevo.ok}
            onClick={() => hacer(() => decidirIban(f.id, 'es_el_nuevo', actor.name),
              `IBAN de ${datos.ficha.name} cambiado a ${ultimas4(f.readIban)} (antes ${ultimas4(datos.ficha.iban)}). Queda apuntado quién y cuándo. Sube el certificado del banco de la cuenta nueva en Documentos.`)}>
            Es el nuevo IBAN
          </button>
          <button type="button" className="cx-boton-sec" disabled={ocupado}
            onClick={() => hacer(() => decidirIban(f.id, 'no_es_suyo', actor.name),
              `Apuntado: el IBAN de la factura ${num} no es suyo. Se queda el de la ficha (${ultimas4(datos.ficha.iban)}); págala a ése.`)}>
            No es suyo
          </button>
          {!nuevo.ok && <span className="cx-ayuda" style={{ flexBasis: '100%' }}>{nuevo.motivo}</span>}
        </div>
      )}
      {f.ibanDecision && f.ibanDecisionAt && (
        <p className="cx-ayuda" style={{ margin: 0 }}>
          {f.ibanDecision === 'es_el_nuevo' ? 'Su IBAN pasó a la ficha' : 'Su IBAN no es del proveedor: se paga al de la ficha'}
          {` el ${fechaLarga(f.ibanDecisionAt.slice(0, 10))}`}{f.ibanDecisionByName ? ` (lo decidió ${f.ibanDecisionByName})` : ''}.
        </p>
      )}

      {f.status === 'aprobada' && !rep && (
        <>
          <p className="cx-ayuda" style={{ margin: 0 }} data-prueba="como-se-paga">
            {f.pagado > 0 ? <>Lleva pagado con asiento <span className="cx-cifra">{eurosExactos(f.pagado)}</span> de {importe}. </> : null}
            Se marca pagada sola cuando casas su pago en Bancos: el cargo hace su asiento y la deja pagada.
            {frena ? ' Mientras no decidas sobre el IBAN, Bancos no la casa.' : ''}
          </p>
          <div className="cx-campo">
            <label htmlFor="pago-venc">Vencimiento</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input id="pago-venc" className="cx-input" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
              <button type="button" className="cx-boton-sec" disabled={ocupado || venc === (f.dueDate ?? '')}
                onClick={() => hacer(() => cambiarVencimiento(f.id, venc || null), venc ? `Vencimiento de la factura ${num} cambiado al ${fechaLarga(venc)}.` : `La factura ${num} queda sin vencimiento.`)}>
                Cambiar
              </button>
            </div>
            <span className="cx-ayuda">Al aprobarla se calcula con el plazo de la ficha. Si lo cambias, queda apuntado quién lo cambió.</span>
          </div>
        </>
      )}

      {f.status === 'pagada' && (
        <p className="cx-ayuda" style={{ margin: 0 }} data-prueba="como-se-deshace">
          Está pagada por su pago con asiento. Si el pago no era de esta factura, deshaz ese casado en Bancos: vuelve sola a por pagar.
        </p>
      )}

      {f.status !== 'aprobada' && f.status !== 'pagada' && f.status !== 'descartada' && !rep && (
        <p className="cx-ayuda" style={{ margin: 0 }}>Aún no está aprobada: hasta que se apruebe en Facturas no cuenta en lo que le debes.</p>
      )}

      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cerrar</button>
      </div>
    </Dialogo>
  )
}
