// src/modules/conta/compras/RemesaPagosPage.tsx
//
// PC01 · Entrega 2 · La ficha de una remesa de pagos (tablero 16, «pagos_2»,
// aprobado por Julio el 25/10):
//
//   · Encabezado: «Remesa de transferencias · 28/10» (o «Pago a mano · …»),
//     su frase según en qué punto está, y UN principal: «Confirmar el IBAN»
//     mientras haya uno por confirmar; «Descargar el fichero» cuando está
//     lista; nada cuando espera el cargo o está pagada. «Descargar sin …» saca
//     la que tiene el IBAN por confirmar y descarga las demás.
//   · Los pasos: Preparada → Fichero para el banco → En el banco: esperando el
//     cargo → Pagada (a mano, sin el del fichero).
//   · A la izquierda, los pagos: Proveedor · IBAN (✓ comprobado, «nuevo» en
//     ámbar) · Su factura · Vence · Importe; el aviso del IBAN que cambió, con
//     «Confirmar el IBAN» y «Sacarla de la remesa»; y los dos avisos de cómo
//     se cierra.
//   · A la derecha: los datos de la remesa, su asiento al llegar el cargo (la
//     pieza común, con «Cuadra») y el historial (quién y cuándo).
// Cada botón dice lo que ha pasado con la frase de la base (regla 8).

import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { rutaRemesasPagos } from '@/config/navegacion'
import { useLeer } from '@/modules/conta/libros/contexto'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, Chip, textoDeImporte } from '@/modules/conta/diseno'
import { AsientoQueSeCrea, BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { NOMBRE_ESTADO_REMESA, pasosRemesa } from '@/modules/conta/lib/pagos'
import { ficheroTransferencias, nombreFicheroRemesa } from '@/modules/conta/lib/sepa'
import {
  confirmarIban, datosFichero, ficheroDescargado, huellaFichero, leerRemesa, sacarDeRemesa, type PagoRemesa, type Remesa,
} from '@/modules/conta/services/pagosService'
import { DialogoRechazado } from './DialogosPagos'

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const fechaLarga = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return `${DIAS[d.getUTCDay()]}, ${iso.split('-').reverse().join('/')}` }
const horaMadrid = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ',')
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

function fraseDe(r: Remesa): string {
  const n = r.vivas
  const cuantas = n === 1 ? 'Una factura' : `${['Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'][n - 2] ?? String(n)} facturas`
  const desde = `${r.banco.nombre}${r.banco.iban4 ? ` ···${r.banco.iban4}` : ''}`
  if (r.porBanco) {
    return r.estado === 'pagada' ? `Pagada por el banco desde ${desde}: el cargo ya está casado en Bancos, con su asiento.`
      : `Mandada al banco desde ${desde} (Pagar con Revolut). Cuando llegue el cargo (${eurosExactos(r.porCargar)}), cásalo en Bancos con este pago: la factura quedará pagada con su asiento.`
  }
  if (r.aMano) {
    return r.estado === 'pagada' ? `Pagada a mano desde ${desde}: el cargo ya está casado en Bancos, con su asiento.`
      : `Pagada a mano desde ${desde}. Cuando llegue el cargo, cásalo en Bancos: el pago tendrá su asiento y la factura quedará pagada.`
  }
  switch (r.estado) {
    case 'preparada': return `${cuantas} ${n === 1 ? 'pagada' : 'pagadas'} de una vez desde ${desde}. Antes de descargar el fichero, confirma el IBAN que ha cambiado; después Sumied hace el resto cuando llegue el cargo.`
    case 'fichero': return `${cuantas} ${n === 1 ? 'pagada' : 'pagadas'} de una vez desde ${desde}. Descarga el fichero y súbelo a la banca de tu banco; cuando llegue el cargo, Sumied hace el resto.`
    case 'en_banco': return `El fichero ya está para el banco. Cuando llegue el cargo (${eurosExactos(r.porCargar)}), cásalo en Bancos con esta remesa: las facturas quedan pagadas con su asiento.`
    case 'pagada': return `Pagada: el cargo del banco está casado y ${n === 1 ? 'la factura tiene' : `las ${n} facturas tienen`} su asiento${r.validadoSolo ? ', validado solo porque el cargo cuadra con la remesa' : ', en «Por validar»'}.`
    default: return 'Esta remesa ya no tiene pagos: se sacaron o el banco los rechazó.'
  }
}

export default function RemesaPagosPage() {
  const { remesaId = '' } = useParams()
  const { state } = useLocation() as { state: { frase?: string } | null }
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(remesaId ? () => leerRemesa(remesaId) : null, `${remesaId}:${vuelta}:remesa`)
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'falta'; texto: string } | null>(state?.frase ? { tono: 'seguro', texto: state.frase } : null)
  const [ocupado, setOcupado] = useState(false)
  const [rechazar, setRechazar] = useState<PagoRemesa | null>(null)
  useEffect(() => { if (state?.frase) window.history.replaceState({}, '') }, [state])
  const r = datos.datos

  const hacer = async (que: () => Promise<{ frase: string }>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ tono: 'seguro', texto: (await que()).frase }); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ tono: 'falta', texto: (e as Error).message }) }
    finally { setOcupado(false) }
  }

  const descargar = async (antesSacar: PagoRemesa | null) => {
    if (!r) return
    await hacer(async () => {
      let previa = ''
      if (antesSacar) previa = `${(await sacarDeRemesa(antesSacar.id)).frase} `
      const d = await datosFichero(r.id)
      const xml = ficheroTransferencias(d)
      const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
      const a = document.createElement('a')
      a.href = url; a.download = nombreFicheroRemesa(r.codigo); document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      const f = await ficheroDescargado(r.id, await huellaFichero(xml), d.pagos.length)
      return { frase: `${previa}${f.frase}` }
    })
  }

  if (datos.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer la remesa: {datos.error}</p>
  if (!r) return <div className="s-lista" aria-busy="true" aria-label="Cargando la remesa"><div className="s-lista-cargando" /></div>

  const porConfirmar = r.pagos.filter((p) => p.estado === 'por_confirmar')
  const primera = porConfirmar[0] ?? null
  const vivos = r.pagos.filter((p) => p.estado !== 'sacada')
  const titulo = r.porBanco ? `Pago por el banco · ${diaMesCorto(r.fechaPago)}` : r.aMano ? `Pago a mano · ${diaMesCorto(r.fechaPago)}` : `Remesa de transferencias · ${diaMesCorto(r.fechaPago)}`
  // B01 · 2c-2 · Un pago mandado por la API del banco no tiene fichero: como uno a mano, sin «Descargar».
  const sinFichero = r.aMano || r.porBanco

  const principal = !sinFichero && primera
    ? <Boton variante="principal" disabled={ocupado} onClick={() => void hacer(() => confirmarIban(primera.id))}>Confirmar el IBAN</Boton>
    : !sinFichero && r.estado === 'fichero'
      ? <Boton variante="principal" disabled={ocupado} onClick={() => void descargar(null)}>{ocupado ? 'Preparando…' : 'Descargar el fichero'}</Boton>
      : undefined
  const secundarios = !sinFichero && primera && r.vivas > 1
    ? <Boton disabled={ocupado} onClick={() => void descargar(primera)}>Descargar sin {primera.proveedor}</Boton>
    : !sinFichero && r.estado === 'en_banco' ? <Boton disabled={ocupado} onClick={() => void descargar(null)}>Descargar el fichero otra vez</Boton> : undefined

  // El asiento: cada proveedor a su 400/410 (debe) y el banco a su 572 (haber).
  const porProveedor = new Map<string, { nombre: string; cuenta: string; importe: number }>()
  for (const p of r.pagos.filter((x) => x.estado !== 'sacada' && x.estado !== 'rechazada')) {
    const k = p.cuenta ?? p.proveedor
    const v = porProveedor.get(k) ?? { nombre: p.proveedor, cuenta: p.cuenta ?? '—', importe: 0 }
    v.importe = Math.round((v.importe + p.importe) * 100) / 100
    porProveedor.set(k, v)
  }
  const lineas = [
    ...[...porProveedor.values()].map((v) => ({ codigo: v.cuenta, nombre: v.nombre, debe: textoDeImporte(v.importe), haber: null })),
    { codigo: r.banco.cuenta ?? '572', nombre: `${r.banco.nombre}${r.banco.iban4 ? ` ···${r.banco.iban4}` : ''}`, debe: null, haber: textoDeImporte(r.total) },
  ]

  return (
    <div className="pg-pagina">
      <EncabezadoPagina titulo={titulo} frase={fraseDe(r)} migasExtra={[{ etiqueta: 'Remesas', a: rutaRemesasPagos() }, { etiqueta: `Remesa ${r.codigo}` }]}
        principal={principal} secundarios={secundarios} />
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="aviso-remesa">{aviso.texto}</p>}

      <ol className="pg-pasos" aria-label="En qué punto está la remesa">
        {pasosRemesa(r.estado, sinFichero, r.validadoSolo).map((p, i) => (
          <li key={p.etiqueta} data-hecho={p.hecho ? 'si' : 'no'} data-actual={p.actual ? 'si' : 'no'} aria-current={p.actual ? 'step' : undefined}>
            <span className="pg-paso-marca" aria-hidden="true">{p.hecho ? '✓' : i + 1}</span>
            <span className="pg-paso-texto">{p.etiqueta}{p.detalle && <span className="pg-paso-detalle" data-prueba="validado-solo">{p.detalle}</span>}</span>
          </li>
        ))}
      </ol>
      <p className="s-oculto" role="status">{NOMBRE_ESTADO_REMESA[r.estado]}</p>

      <div className="pg-ficha">
        <div className="pg-ficha-izq">
          <section className="pg-caja" aria-label="Los pagos">
            <table className="pg-tabla">
              <thead><tr><th>Proveedor</th><th>IBAN</th><th>Su factura</th><th>Vence</th><th className="pg-num">Importe</th></tr></thead>
              <tbody>
                {vivos.map((p) => (
                  <tr key={p.id} data-estado={p.estado}>
                    <td>{p.proveedor}{(p.estado === 'rechazada' || p.estado === 'pagada') && <> <Chip tono={p.estado === 'pagada' ? 'seguro' : 'falta'}>{p.estado === 'pagada' ? 'Pagada' : 'Rechazada'}</Chip></>}</td>
                    <td className={p.estado === 'por_confirmar' ? 'pg-iban-nuevo' : undefined}>
                      {p.iban4 ? `${p.ibanPais ?? ''} ···· ${p.iban4}` : '—'}
                      {p.estado === 'por_confirmar' && ' · nuevo'}
                      {(p.ibanEstado === 'comprobado' || (p.ibanEstado === 'cambiado' && p.confirmadoAt)) && <span className="pg-iban-ok" title={p.confirmadoPor ? `Confirmado por ${p.confirmadoPor}` : 'El mismo de sus pagos anteriores'}> ✓</span>}
                      {p.ibanEstado === 'primer_pago' && !p.confirmadoAt && <span className="cx-ayuda" title={p.ibanNota ?? ''}> · primer pago</span>}
                      {p.ibanEstado === 'primer_pago' && p.confirmadoAt && <span className="pg-iban-ok" title={`Confirmado por ${p.confirmadoPor ?? '—'}`}> ✓</span>}
                      {/* Respuesta 7 · Un primer pago no para la remesa, pero sin confirmar su IBAN el asiento no se valida solo. */}
                      {p.ibanEstado === 'primer_pago' && !p.confirmadoAt && p.estado === 'pendiente' && !sinFichero && (
                        <button type="button" className="pg-enlace pg-enlace-chico" disabled={ocupado} onClick={() => void hacer(() => confirmarIban(p.id))}>Confirmarlo</button>
                      )}
                    </td>
                    <td>{p.numero ?? 'sin número'}{p.motivo && <span className="cx-ayuda"> · {p.motivo}</span>}</td>
                    <td className={p.vence && p.vence < r.fechaPago ? 'pg-vence-rojo' : undefined}>{p.vence ? diaMesCorto(p.vence) : '—'}</td>
                    <td className="pg-num">
                      {eurosExactos(p.importe).replace(' €', '')}
                      {r.estado === 'en_banco' && p.estado === 'pendiente' && (
                        <button type="button" className="pg-enlace pg-enlace-chico" disabled={ocupado} onClick={() => setRechazar(p)}>Rechazado</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {porConfirmar.map((p) => (
              <div key={p.id} className="pg-aviso-ambar pg-aviso-fila" role="status">
                <p><strong>El IBAN de {p.proveedor} {p.ibanNota?.startsWith('No coincide') ? 'no coincide con el de sus pagos anteriores' : 'ha cambiado'}</strong> ({p.ibanNota}). Llámales a un número que ya tuvieras antes de confirmarlo.</p>
                <span className="pg-aviso-acciones">
                  <button type="button" className="pg-enlace" disabled={ocupado} onClick={() => void hacer(() => confirmarIban(p.id))}>Confirmar el IBAN</button>
                  <button type="button" className="pg-enlace" disabled={ocupado} onClick={() => void hacer(() => sacarDeRemesa(p.id))}>Sacarla de la remesa</button>
                </span>
              </div>
            ))}
            <div className="pg-pie"><span>{plural(r.vivas, 'pago', 'pagos')}{r.rechazadas ? ` · ${plural(r.rechazadas, 'rechazado', 'rechazados')}` : ''}</span><span>Total <strong className="s-cifra">{eurosExactos(r.total)}</strong></span></div>
          </section>
          <div className="pg-notas pg-notas-dos">
            <p><strong>Cuando llegue el cargo,</strong> casa el movimiento con la remesa entera (o con cada pago, si el banco los carga uno a uno), marca {r.vivas === 1 ? 'la factura pagada' : `las ${r.vivas} facturas pagadas`} y hace su asiento. Te avisa en Inicio.</p>
            <p><strong>Si el banco rechaza un pago,</strong> esa factura vuelve a «Por pagar» con el motivo del banco, y las demás siguen su curso.</p>
          </div>
        </div>

        <div className="pg-ficha-der">
          <BloqueFicha titulo="Datos de la remesa">
            <dl className="pg-datos">
              <dt>Cuenta de cargo</dt><dd>{r.banco.nombre}{r.banco.iban4 ? ` ···${r.banco.iban4}` : ''}</dd>
              <dt>Fecha de pago</dt><dd>{fechaLarga(r.fechaPago)}</dd>
              <dt>Total</dt><dd className="s-cifra">{eurosExactos(r.total)}</dd>
              {r.porBanco && <><dt>Cómo sale</dt><dd>Por la API del banco (Pagar con Revolut), sin fichero</dd></>}
              {!sinFichero && <><dt>Fichero</dt><dd>SEPA de transferencias · {plural(r.vivas, 'pago', 'pagos')}{r.ficheroAt ? ` · descargado ${horaMadrid(r.ficheroAt)}` : ''}</dd></>}
              <dt>Hecha por</dt><dd>{r.creadaPor ?? '—'} · {horaMadrid(r.creada)}</dd>
              {r.estado === 'pagada' && <><dt>Su asiento</dt><dd>{r.validadoSolo ? 'Validado solo: el cargo cuadra con la remesa' : 'En «Por validar»'}</dd></>}
            </dl>
          </BloqueFicha>
          <AsientoQueSeCrea titulo={r.estado === 'pagada' ? 'Su asiento' : 'Su asiento, al llegar el cargo'} lineas={lineas}
            nota={r.aMano ? 'Se hace con el cargo del banco, al casarlo en Bancos, y se valida en «Por validar».'
              : 'Se hace con el cargo del banco, al casarlo en Bancos. Se valida solo si el cargo es la remesa entera y sus IBAN están confirmados.'} />
          <BloqueFicha titulo="Historial">
            <ul className="pg-historial">
              {r.historial.map((h, i) => <li key={i}>{horaMadrid(h.at)} · {h.por ? `${h.por}: ` : ''}{h.texto}</li>)}
            </ul>
          </BloqueFicha>
        </div>
      </div>

      {/* En el móvil, el principal va abajo, bajo el pulgar. */}
      {principal && <BotonPulgar>{principal}</BotonPulgar>}
      {rechazar && <DialogoRechazado linea={rechazar} alCerrar={(frase) => { setRechazar(null); if (frase) { setAviso({ tono: 'seguro', texto: frase }); setVuelta((v) => v + 1) } }} />}
    </div>
  )
}
