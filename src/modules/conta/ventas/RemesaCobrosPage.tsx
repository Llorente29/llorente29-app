// src/modules/conta/ventas/RemesaCobrosPage.tsx
//
// PC01 · Entrega 3 · La ficha de una remesa de recibos (tablero cobros-2,
// aprobado por Julio el 25/10):
//
//   · Encabezado: «Remesa de recibos · 01/10», su frase según en qué punto está,
//     y UN principal: «Descargar el fichero» mientras está preparada; «Pasar el
//     devuelto en la próxima remesa» si hay un recibo devuelto aún por cobrar;
//     nada mientras espera el abono. «Descargar el fichero» (otra vez) va de
//     secundario.
//   · Los pasos: Preparada → En el banco → Abonada → Plazo de devoluciones ·
//     hasta el DD/MM (8 semanas desde el abono, lo que dura el derecho del
//     cliente a devolver un recibo CORE).
//   · A la izquierda, los recibos: Cliente · Mandato · Factura · Importe ·
//     Estado; el aviso del devuelto (motivo del banco y gastos) con «Pasarlo en
//     la próxima remesa»; y los dos avisos: el plazo de 8 semanas y los
//     mandatos firmados desde el móvil.
//   · A la derecha: los datos de la remesa (con el identificador de acreedor),
//     su asiento (el del abono o, si hay un devuelto, el de la devolución), el
//     mandato del cliente del devuelto y el historial.
// «Mandarle el enlace de pago» (tarjeta o Bizum) es de la entrega 4: no sale.
// Cada botón dice lo que ha pasado con la frase de la base (regla 8).

import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { rutaCobros } from '@/config/navegacion'
import { useLeer } from '@/modules/conta/libros/contexto'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, Chip, textoDeImporte } from '@/modules/conta/diseno'
import { AsientoQueSeCrea, BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { NOMBRE_ESTADO_REMESA, pasosRemesa } from '@/modules/conta/lib/cobros'
import { ficheroRecibos, nombreFicheroRecibos } from '@/modules/conta/lib/sepa'
import { huellaFichero } from '@/modules/conta/services/pagosService'
import {
  datosFicheroRecibos, ficheroRecibosDescargado, leerRemesaCobros, sacarRecibo, type ReciboRemesa, type RemesaCobros,
} from '@/modules/conta/services/cobrosService'

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const fechaLarga = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return `${DIAS[d.getUTCDay()]}, ${iso.split('-').reverse().join('/')}` }
const horaMadrid = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const diaMadrid = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' })
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const NUMEROS = ['Un recibo', 'Dos recibos', 'Tres recibos', 'Cuatro recibos', 'Cinco recibos', 'Seis recibos']

function fraseDe(r: RemesaCobros): string {
  const cuantos = NUMEROS[r.vivos - 1] ?? `${r.vivos} recibos`
  switch (r.estado) {
    case 'preparada': return `${cuantos} ${r.vivos === 1 ? 'domiciliado' : 'domiciliados'}. Descarga el fichero y súbelo a la banca de ${r.banco.nombre} antes del ${diaMesCorto(r.cargo)}; cuando llegue el abono, las facturas quedan cobradas.`
    case 'en_banco': return `El fichero ya está para el banco. Cuando llegue el abono (${eurosExactos(r.porAbonar)}), cásalo en Bancos con esta remesa: las facturas quedan cobradas.`
    case 'plazo':
    case 'cerrada': {
      const cobrados = r.cobrados === r.vivos ? (r.vivos === 1 ? 'Cobrado' : 'Cobrados todos') : `Cobrados ${r.cobrados === 2 ? 'dos' : r.cobrados === 1 ? 'uno' : r.cobrados}`
      const dev = r.devueltos ? `; ${r.devueltos === 1 ? 'uno devuelto' : `${r.devueltos} devueltos`}${r.recibos.some((x) => x.estado === 'devuelto' && x.pendiente >= 0.005) ? ', que ya está otra vez por cobrar' : ''}` : ''
      return `${cuantos} ${r.vivos === 1 ? 'domiciliado' : 'domiciliados'}. ${cobrados}${dev}.${r.estado === 'plazo' && !r.devueltos ? ` Si alguno vuelve devuelto antes del ${r.plazoHasta ? diaMesCorto(r.plazoHasta) : '—'}, se casa con su recibo.` : ''}`
    }
    default: return 'Esta remesa ya no tiene recibos: se sacaron antes de mandar el fichero.'
  }
}

export default function RemesaCobrosPage() {
  const { remesaId = '' } = useParams()
  const navegar = useNavigate()
  const { state } = useLocation() as { state: { frase?: string } | null }
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(remesaId ? () => leerRemesaCobros(remesaId) : null, `${remesaId}:${vuelta}:remesa-cobros`)
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'falta'; texto: string } | null>(state?.frase ? { tono: 'seguro', texto: state.frase } : null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (state?.frase) window.history.replaceState({}, '') }, [state])
  const r = datos.datos

  const hacer = async (que: () => Promise<{ frase: string }>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ tono: 'seguro', texto: (await que()).frase }); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ tono: 'falta', texto: (e as Error).message }) }
    finally { setOcupado(false) }
  }

  const descargar = async () => {
    if (!r) return
    await hacer(async () => {
      const d = await datosFicheroRecibos(r.id)
      const xml = ficheroRecibos(d)
      const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
      const a = document.createElement('a')
      a.href = url; a.download = nombreFicheroRecibos(r.codigo); document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return ficheroRecibosDescargado(r.id, await huellaFichero(xml), d.recibos.length)
    })
  }

  if (datos.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer la remesa: {datos.error}</p>
  if (!r) return <div className="s-lista" aria-busy="true" aria-label="Cargando la remesa"><div className="s-lista-cargando" /></div>

  const devueltosPorCobrar = r.recibos.filter((x) => x.estado === 'devuelto' && x.pendiente >= 0.005)
  const pasarDevueltos = () => navegar(rutaCobros('proxima'), { state: { marcar: devueltosPorCobrar.map((x) => x.facturaId) } })
  const principal = r.estado === 'preparada'
    ? <Boton variante="principal" disabled={ocupado} onClick={() => void descargar()}>{ocupado ? 'Preparando…' : 'Descargar el fichero'}</Boton>
    : devueltosPorCobrar.length > 0
      ? <Boton variante="principal" disabled={ocupado} onClick={pasarDevueltos}>{devueltosPorCobrar.length === 1 ? 'Pasar el devuelto en la próxima remesa' : 'Pasar los devueltos en la próxima remesa'}</Boton>
      : undefined
  const secundarios = r.estado !== 'preparada' && r.estado !== 'vacia' && r.porAbonar > 0
    ? <Boton disabled={ocupado} onClick={() => void descargar()}>Descargar el fichero</Boton> : undefined

  // El asiento: con un devuelto, el de la devolución (430 y 626 al debe, 572 al haber); si no, el del abono (572 contra las 430).
  const banco = `${r.banco.nombre}${r.banco.iban4 ? ` ···${r.banco.iban4}` : ''}`
  const dev = r.recibos.find((x) => x.estado === 'devuelto') ?? null
  const lineas = dev
    ? [
      { codigo: dev.cuenta ?? '430', nombre: dev.cliente, debe: textoDeImporte(dev.importe), haber: null },
      ...(dev.gastos ? [{ codigo: r.cuentaGastos ?? '626', nombre: 'Gastos de devolución', debe: textoDeImporte(dev.gastos), haber: null }] : []),
      { codigo: r.banco.cuenta ?? '572', nombre: banco, debe: null, haber: textoDeImporte(Math.round((dev.importe + (dev.gastos ?? 0)) * 100) / 100) },
    ]
    : [
      { codigo: r.banco.cuenta ?? '572', nombre: banco, debe: textoDeImporte(r.total), haber: null },
      ...porCliente(r.recibos).map((v) => ({ codigo: v.cuenta, nombre: v.nombre, debe: null, haber: textoDeImporte(v.importe) })),
    ]
  const vivos = r.recibos.filter((x) => x.estado !== 'sacada')
  const mandatoDe = dev ?? vivos[0] ?? null

  return (
    <div className="pg-pagina">
      <EncabezadoPagina titulo={`Remesa de recibos · ${diaMesCorto(r.cargo)}`} frase={fraseDe(r)}
        migasExtra={[{ etiqueta: `Remesa ${r.codigo}` }]} principal={principal} secundarios={secundarios} />
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="aviso-remesa">{aviso.texto}</p>}

      <ol className="pg-pasos" aria-label="En qué punto está la remesa">
        {pasosRemesa(r.estado, r.plazoHasta).map((p, i) => (
          <li key={p.etiqueta} data-hecho={p.hecho ? 'si' : 'no'} data-actual={p.actual ? 'si' : 'no'} aria-current={p.actual ? 'step' : undefined}>
            <span className="pg-paso-marca" aria-hidden="true">{p.hecho ? '✓' : i + 1}</span>
            <span className="pg-paso-texto">{p.etiqueta}</span>
          </li>
        ))}
      </ol>
      <p className="s-oculto" role="status">{NOMBRE_ESTADO_REMESA[r.estado]}</p>

      <div className="pg-ficha">
        <div className="pg-ficha-izq">
          <section className="pg-caja" aria-label="Los recibos">
            <table className="pg-tabla">
              <thead><tr><th>Cliente</th><th>Mandato</th><th>Factura</th><th className="pg-num">Importe</th><th>Estado</th></tr></thead>
              <tbody>
                {vivos.map((x) => (
                  <tr key={x.id} data-estado={x.estado}>
                    <td>{x.cliente}</td>
                    <td>{x.mandato} · <span className="cx-ayuda">{x.primero ? 'primer cobro' : 'recurrente'}</span></td>
                    <td>{x.numero ?? 'sin número'}</td>
                    <td className="pg-num">{eurosExactos(x.importe).replace(' €', '')}</td>
                    <td>
                      <Chip tono={x.estado === 'cobrado' ? 'seguro' : x.estado === 'devuelto' ? 'falta' : 'neutro'}>
                        {x.estado === 'cobrado' ? 'Cobrado' : x.estado === 'devuelto' ? `Devuelto${x.motivo ? ` · ${x.motivo}` : ''}` : 'Esperando el abono'}
                      </Chip>
                      {r.estado === 'preparada' && x.estado === 'pendiente' && (
                        <button type="button" className="pg-enlace pg-enlace-chico" disabled={ocupado} onClick={() => void hacer(() => sacarRecibo(x.id))}>Sacarlo</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.recibos.filter((x) => x.estado === 'devuelto').map((x) => (
              <div key={x.id} className="pg-aviso-rojo pg-aviso-fila" role="status" data-prueba="aviso-devuelto">
                <p><strong>{x.cliente} devolvió el recibo{x.devuelto ? ` el ${diaMesCorto(x.devuelto)}` : ''}</strong> (motivo del banco: {x.motivo ?? 'sin decir'}).{' '}
                  {x.pendiente >= 0.005 ? `Su factura ha vuelto a «Por cobrar», con ${eurosExactos(x.gastos ?? 0)} de gastos de devolución.` : 'Su factura ya está cobrada otra vez.'}</p>
                {x.pendiente >= 0.005 && (
                  <span className="pg-aviso-acciones">
                    <button type="button" className="pg-enlace" onClick={() => navegar(rutaCobros('proxima'), { state: { marcar: [x.facturaId] } })}>Pasarlo en la próxima remesa</button>
                  </span>
                )}
              </div>
            ))}
            <div className="pg-pie">
              <span>{plural(r.vivos, 'recibo', 'recibos')}{r.devueltos ? ` · ${plural(r.devueltos, 'devuelto', 'devueltos')}` : ''}</span>
              <span>Cobrado <strong className="s-cifra">{eurosExactos(r.cobrado)}</strong> de {eurosExactos(r.total)}</span>
            </div>
          </section>
          <div className="pg-notas pg-notas-dos">
            <p><strong>Un recibo se puede devolver durante 8 semanas.</strong> La remesa no se da por cerrada hasta que pasa ese plazo; mientras, cualquier devolución que llegue al banco se casa con su recibo en Bancos.</p>
            <p><strong>Mandatos firmados desde el móvil.</strong> El cliente firma el mandato desde el correo, con el móvil. Queda guardado en su ficha de Contactos y la remesa no deja pasar un recibo sin él.</p>
          </div>
        </div>

        <div className="pg-ficha-der">
          <BloqueFicha titulo="Datos de la remesa">
            <dl className="pg-datos">
              <dt>Cuenta de abono</dt><dd>{banco}{r.empresa ? ` · ${r.empresa}` : ''}</dd>
              <dt>Cargo a los clientes</dt><dd>{fechaLarga(r.cargo)}</dd>
              <dt>Tipo</dt><dd>Recibos a particulares y empresas (CORE)</dd>
              <dt>Identificador de acreedor</dt><dd>{r.acreedor ?? 'Falta el NIF de la empresa'}</dd>
              <dt>Fichero</dt><dd>SEPA de recibos · {plural(r.vivos, 'recibo', 'recibos')}{r.ficheroAt ? ` · descargado ${horaMadrid(r.ficheroAt)}` : ''}</dd>
              <dt>Hecha por</dt><dd>{r.creadaPor ?? '—'} · {horaMadrid(r.creada)}</dd>
            </dl>
          </BloqueFicha>
          <AsientoQueSeCrea titulo={dev ? 'Su asiento, la devolución' : r.estado === 'plazo' || r.estado === 'cerrada' ? 'Su asiento, el abono' : 'Su asiento, al llegar el abono'} lineas={lineas}
            nota={dev ? 'Hecho solo al casar en Bancos la devolución del banco.' : 'Se hace con el abono del banco, al casarlo en Bancos, y espera en «Por validar».'} />
          {mandatoDe && <BloqueMandato x={mandatoDe} />}
          <BloqueFicha titulo="Historial">
            <ul className="pg-historial">
              {r.historial.map((h, i) => <li key={i}>{horaMadrid(h.at)} · {h.por ? `${h.por}: ` : ''}{h.texto}</li>)}
            </ul>
          </BloqueFicha>
        </div>
      </div>

      {principal && <BotonPulgar>{principal}</BotonPulgar>}
    </div>
  )
}

function porCliente(recibos: readonly ReciboRemesa[]) {
  const m = new Map<string, { nombre: string; cuenta: string; importe: number }>()
  for (const x of recibos.filter((y) => y.estado !== 'sacada')) {
    const k = x.cuenta ?? x.cliente
    const v = m.get(k) ?? { nombre: x.cliente, cuenta: x.cuenta ?? '430', importe: 0 }
    v.importe = Math.round((v.importe + x.importe) * 100) / 100
    m.set(k, v)
  }
  return [...m.values()]
}

function BloqueMandato({ x }: { x: ReciboRemesa }) {
  const firmado = x.mandatoFicha?.firmado
    ? `${diaMadrid(x.mandatoFicha.firmado)}, por correo, con firma electrónica${x.mandatoFicha.firmante ? ` (${x.mandatoFicha.firmante})` : ''}`
    : `${x.firmado.split('-').reverse().join('/')}, apuntado a mano en su ficha`
  return (
    <BloqueFicha titulo={`Mandato de ${x.cliente}`}>
      <dl className="pg-datos" data-prueba="mandato">
        <dt>Referencia</dt><dd>{x.mandato}</dd>
        <dt>Firmado</dt><dd>{firmado}</dd>
        <dt>Tipo</dt><dd>Recurrente · CORE</dd>
        <dt>Cuenta</dt><dd>{x.ibanPais ?? ''} ···· {x.iban4 ?? '—'}</dd>
        <dt>Último cobro</dt><dd>{x.ultimoCobro?.fecha ? `${diaMesCorto(x.ultimoCobro.fecha)} · ${x.ultimoCobro.estado === 'cobrado' ? 'cobrado' : 'devuelto'}` : 'Este es el primero'}</dd>
      </dl>
      {x.mandatoFicha && <a className="pg-enlace" href={`/mandato.html?t=${x.mandatoFicha.token}`} target="_blank" rel="noreferrer">Ver el mandato firmado</a>}
    </BloqueFicha>
  )
}
