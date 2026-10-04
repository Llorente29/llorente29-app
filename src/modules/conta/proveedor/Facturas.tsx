// src/modules/conta/proveedor/Facturas.tsx
//
// Las facturas del proveedor (columna izquierda de N4 y apartado «Facturas»):
// fecha, número, importe y estado — «Pagada» en verde, «Por pagar» en azul y
// «¿Repetida?» en ámbar con su explicación en una línea (C01b §4: mismo
// número e importe que otra anterior; no se apunta en ninguna cifra).
// «¿Posible repetida?» (respuesta 2): misma fecha e importe con otro número;
// la misma decisión.
// «IBAN distinto al de la ficha» (respuesta 2, punto 1): la lectura trajo otra
// cuenta. «Marcar como pagada» queda desactivado (y la base lo rechaza) hasta
// que alguien decide «Es el nuevo IBAN» o «No es suyo».
//
// «Ver» abre la factura: «Marcar como pagada» (y luego «Deshacer» en la misma
// pantalla), cambiar el vencimiento, o «Deshacer el pago» si ya lo estaba.
// Cada acción va por su RPC, que escribe la factura y su rastro a la vez, y
// confirma con contenido (regla 8): «Factura F-… marcada como pagada el
// 04/10/2026. Ya no le debes esos 1.283,15 €.»

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Dialogo, HechoConDeshacer } from '@/modules/conta/proveedor/piezas'
import { Vacio } from '@/modules/conta/ui/piezas'
import { cambiarVencimiento, decidirIban, deshacerPago, marcarPagada, noEsRepetida, type FacturaDeProveedor } from '@/modules/conta/services/proveedorService'
import { diaMesCorto, eurosExactos, fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '@/modules/conta/types'
import { rutaSubirFacturaProveedor } from '@/config/navegacion'
import { ETIQUETA_REPETIDA } from '@/modules/conta/lib/repetidas'
import { AVISO_IBAN_DISTINTO, facturaFrenada, puedeSerElNuevo } from '@/modules/conta/lib/ibanFactura'
import { formatearIban, normalizarIban } from '@/modules/conta/lib/iban'

const ESTADO: Record<string, { texto: string; tono: string }> = {
  aprobada: { texto: 'Por pagar', tono: 'cx-chip cx-chip-azul' },
  pagada: { texto: 'Pagada', tono: 'cx-chip cx-chip-ia' },
  borrador: { texto: 'Borrador', tono: 'cx-chip' },
  en_revision: { texto: 'En revisión', tono: 'cx-chip' },
  con_discrepancias: { texto: 'Con diferencias', tono: 'cx-chip' },
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
  const { datos, rutaApartado } = useFicha()
  return (
    <section className="cx-tarjeta" aria-labelledby="cxp-facturas" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="cx-tarjeta-cabeza">
        <h2 id="cxp-facturas" className="cx-tarjeta-titulo">Facturas</h2>
        {datos.facturas.length > 0 && <Link to={rutaApartado('facturas')} style={{ fontSize: 14, fontWeight: 600 }}>Ver todas</Link>}
      </div>
      <ListaFacturas facturas={datos.facturas.slice(0, max)} />
    </section>
  )
}

export function ListaFacturas({ facturas }: { facturas: FacturaDeProveedor[] }) {
  const { datos, repetidas } = useFicha()
  const [abierta, setAbierta] = useState<FacturaDeProveedor | null>(null)
  const [hecho, setHecho] = useState<{ texto: string; deshacer?: () => Promise<void> } | null>(null)
  if (facturas.length === 0) {
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
      {hecho && <HechoConDeshacer texto={hecho.texto} deshacer={hecho.deshacer} alIrse={() => setHecho(null)} />}
      <div role="list" aria-label="Facturas">
        {facturas.map((f) => {
          const rep = repetidas.get(f.id)
          const frena = facturaFrenada(f, datos.ficha.iban)
          const e = rep ? { texto: ETIQUETA_REPETIDA[rep.nivel], tono: 'cx-chip cx-chip-ambar' }
            : frena ? { texto: 'IBAN distinto', tono: 'cx-chip cx-chip-ambar' }
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

function DialogoFactura({ factura: f, alCerrar, alHecho }: {
  factura: FacturaDeProveedor; alCerrar: () => void
  alHecho: (h: { texto: string; deshacer?: () => Promise<void> }) => void
}) {
  const { datos, repetidas, recargar, actor } = useFicha()
  const [fecha, setFecha] = useState(hoyEnMadrid())
  const [forma, setForma] = useState<PaymentMethod | ''>(datos.ficha.paymentMethod ?? '')
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
        {f.status === 'pagada' && f.paidAt && ` · pagada el ${fechaLarga(f.paidAt)}${f.paidMethod ? ` por ${PAYMENT_METHOD_LABEL[f.paidMethod].toLowerCase()}` : ''}${f.paidByName ? ` (lo apuntó ${f.paidByName})` : ''}`}
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
          <div className="cx-formulario-fila">
            <div className="cx-campo">
              <label htmlFor="pago-fecha">Fecha de pago</label>
              <input id="pago-fecha" className="cx-input" type="date" value={fecha} max={hoyEnMadrid()} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="cx-campo">
              <label htmlFor="pago-forma">Cómo se pagó</label>
              <select id="pago-forma" className="cx-input" value={forma} onChange={(e) => setForma(e.target.value as PaymentMethod | '')}>
                <option value="">Sin indicar</option>
                {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
              </select>
            </div>
          </div>
          {frena && <span className="cx-ayuda">«Marcar como pagada» está desactivado hasta que decidas sobre el IBAN.</span>}
          <button type="button" className="cx-boton" disabled={ocupado || !fecha || frena}
            onClick={() => hacer(
              () => marcarPagada(f.id, fecha, forma || null),
              `Factura ${num} marcada como pagada el ${fechaLarga(fecha)}. Ya no le debes esos ${importe}.`,
              async () => { await deshacerPago(f.id); await recargar() },
            )}>
            {ocupado ? 'Guardando…' : 'Marcar como pagada'}
          </button>
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
        <button type="button" className="cx-boton-sec" disabled={ocupado}
          onClick={() => hacer(() => deshacerPago(f.id), `Deshecho el pago de la factura ${num}: vuelve a estar por pagar (${importe}).`)}>
          {ocupado ? 'Guardando…' : 'Deshacer el pago'}
        </button>
      )}

      {f.status !== 'aprobada' && f.status !== 'pagada' && !rep && (
        <p className="cx-ayuda" style={{ margin: 0 }}>Aún no está aprobada: hasta que se apruebe en Facturas no cuenta en lo que le debes.</p>
      )}

      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cerrar</button>
      </div>
    </Dialogo>
  )
}
