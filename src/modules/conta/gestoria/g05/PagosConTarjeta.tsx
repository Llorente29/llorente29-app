// src/modules/conta/gestoria/g05/PagosConTarjeta.tsx
//
// G05 · nº 61 · Ajustes › Cobros, «Pagos con tarjeta o Bizum» (maqueta
// Stripe.dc.html, v23): la cuenta de tu contabilidad donde entra el dinero de
// las tarjetas (Stripe), con sus cuatro mensajes (sin poner, bien, ya existe con
// otro nombre, es de un banco), y los pagos con tarjeta que esperan, con
// «Apuntar los N pagos». Cada botón dice lo que ha hecho (regla 8). Al apuntar,
// la factura que sale lleva su PDF y su correo en el momento (conta-cobro,
// «rematar»).
//
// También exporta AvisoPagoTarjeta: el aviso de la ficha del cliente.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAjustes, rutaAsiento, rutaFacturaVenta } from '@/config/navegacion'
import { apuntarPago, apuntarTodos, leerStripe, ponerStripe, rematarFacturas } from './datos'
import {
  avisoFicha, bloqueHecho, botonTodos, detallePago, euros, filasAsiento, mensajeCuenta, mensajeError, tituloLista, vale,
  type DatosStripe, type Envio, type EstadoCuenta, type PagoApuntado,
} from './modeloStripe'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })

/** Lee la cuenta de Stripe de una empresa (y relee tras cada cambio). */
function useStripe(empresa: string) {
  const [datos, setDatos] = useState<DatosStripe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vez, setVez] = useState(0)
  useEffect(() => {
    let vivo = true
    leerStripe(empresa).then((d) => { if (vivo) { setDatos(d); setError(null) } }).catch((e) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [empresa, vez])
  return { datos, error, recargar: () => setVez((v) => v + 1) }
}

/** Apuntar y, si salió una factura nueva, su PDF y su correo; el envío que falla se dice, pero lo apuntado ya está. */
async function conEnvio(empresa: string, apuntados: PagoApuntado[]): Promise<{ envio: Envio | null; aviso: string | null }> {
  if (!apuntados.some((a) => a.facturaNueva)) return { envio: null, aviso: null }
  try { return { envio: await rematarFacturas(empresa), aviso: null } } catch (e) { return { envio: null, aviso: `Apuntado, pero ${msg(e)}.` } }
}

export function PagosConTarjeta({ empresa, nombreEmpresa }: { empresa: string; nombreEmpresa: string }) {
  const { datos, error, recargar } = useStripe(empresa)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [probada, setProbada] = useState<{ estado: EstadoCuenta; guardada: boolean } | null>(null)
  const [errorForma, setErrorForma] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  if (error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer la cuenta de las tarjetas de {nombreEmpresa}: {error}</p>
  if (!datos) return null
  const escrito = codigo ?? datos.cuenta ?? ''
  // Lo que dice el mensaje: lo que se acaba de intentar guardar, o la cuenta puesta.
  const estado: EstadoCuenta = probada?.estado ?? datos
  const m = errorForma ? mensajeError(errorForma) : mensajeCuenta(estado, probada?.guardada === true)
  const malo = m.tono === 'mal'
  const puedeTodos = vale(datos) && datos.pendientes.length > 0

  const guardar = async () => {
    setOcupado(true); setAviso(null); setErrorForma(null)
    try {
      const r = await ponerStripe(empresa, escrito.trim() || null)
      setProbada({ estado: r.estado, guardada: r.guardada })
      setAviso({ ok: r.guardada, texto: r.frase })
      if (r.guardada) { setCodigo(null); recargar() }
    } catch (e) { setErrorForma(msg(e)); setProbada(null) } finally { setOcupado(false) }
  }
  const todos = async () => {
    setOcupado(true); setAviso(null)
    try {
      const r = await apuntarTodos(empresa)
      const { envio, aviso: a } = await conEnvio(empresa, r.apuntados)
      const noSalio = envio && envio.enviadas === 0 ? [...envio.sinEnviar, ...envio.fallos] : []
      setAviso({ ok: true, texto: [r.frase, a, ...noSalio].filter(Boolean).join(' ') })
      recargar()
    } catch (e) { setAviso({ ok: false, texto: `No se ha apuntado: ${msg(e)}` }) } finally { setOcupado(false) }
  }

  const lista = [...datos.pendientes.map((p) => ({ p, hecho: false })), ...datos.apuntadosHoy.map((p) => ({ p, hecho: true }))]
  return (
    <section className="s-tarjeta cxst-tarjeta" aria-label={`Pagos con tarjeta o Bizum · ${nombreEmpresa}`}>
      <div className="cxst-cabeza">
        <h3 className="cxst-titulo">Pagos con tarjeta o Bizum{nombreEmpresa ? <span className="cxst-de"> · {nombreEmpresa}</span> : null}</h3>
        <p className="cxst-apoyo">Cuando un cliente paga un recibo devuelto desde su portal, el dinero llega por Stripe. Dinos en qué cuenta de tu contabilidad lo apuntamos.</p>
      </div>
      <label className="cxst-etiqueta">Cuenta de tu contabilidad
        <span className="cxst-fila">
          <input className="cxst-campo" data-mal={malo || undefined} value={escrito} placeholder="572…" aria-label="Cuenta de Stripe" inputMode="numeric"
            onChange={(e) => { setCodigo(e.target.value); setProbada(null); setErrorForma(null) }} />
          <button type="button" className="cxg-boton cxg-boton-principal cxst-guardar" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        </span>
      </label>
      <div className="cxst-mensaje" data-tono={m.tono} role={malo ? 'alert' : 'status'}>
        <b>{m.titulo}</b>
        <span>{m.texto}</span>
      </div>
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}

      <div className="cxst-lista">
        <div className="cxst-lista-cabeza">
          <b>{tituloLista(datos)}</b>
          {puedeTodos && <button type="button" className="cxst-verde" onClick={() => void todos()} disabled={ocupado}>{ocupado ? 'Apuntando…' : botonTodos(datos.pendientes.length)}</button>}
        </div>
        {lista.map(({ p, hecho }) => (
          <div key={`${p.recibo}-${hecho}`} className="cxst-pago">
            <div className="cxst-pago-quien">
              <b>{p.cliente ?? 'Un cliente'}</b>
              <span>{detallePago(p)}</span>
            </div>
            <div className="cxst-pago-der">
              <b>{euros(p.importe)}</b>
              <span className="cxst-chip" data-tono={hecho ? 'ok' : 'ambar'}>{hecho ? 'Apuntado' : 'Espera'}</span>
            </div>
          </div>
        ))}
        {lista.length === 0 && <p className="cxst-apoyo">Ningún pago con tarjeta espera. Todo está apuntado.</p>}
      </div>
    </section>
  )
}

/** Lo apuntado desde la ficha (lo guarda la página, que sigue montada mientras la ficha se relee). */
export interface PagoHecho { a: PagoApuntado; envio: Envio | null; aviso: string | null }

/** El bloque verde, al apuntar: la factura que sale y sus dos asientos. */
function Hecho({ a, envio, aviso }: PagoHecho) {
  const b = bloqueHecho(a, envio, hoy())
  const cobro = a.asientos.find((x) => x.tipo === 'cobro')
  return (
    <div className="cxst-hecho" role="status">
      <b className="cxst-hecho-titulo">{b.titulo}</b>
      <p className="cxst-hecho-texto">{b.texto}</p>
      {[...b.noSalio, aviso].filter(Boolean).map((t, i) => <p key={i} className="cxst-hecho-texto" data-tono="ambar">{t}</p>)}
      <div className="cxst-conta">
        <div className="cxst-conta-sub">EN LA CONTABILIDAD</div>
        {a.asientos.map((x) => {
          const f = filasAsiento(x, a.numero)
          return (
            <div key={x.id} className="cxst-asiento">
              <div className="cxst-conta-sub2">{f.titulo}</div>
              {f.filas.map((r, i) => (
                <div key={i} className="cxst-apunte">
                  <span>{r.lado} {r.cuentas.map((c, j) => <span key={c.codigo}>{j > 0 ? ' · ' : ''}<b>{c.codigo}</b> {c.nombre}</span>)}</span>
                  <b>{r.importe}</b>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="cxst-enlaces">
        {cobro && <Link className="cx-enlace" to={rutaAsiento(cobro.id)}>Ver el asiento</Link>}
        {a.factura && <Link className="cx-enlace" to={rutaFacturaVenta(a.factura)}>Ver la factura {a.numero}</Link>}
      </div>
    </div>
  )
}

/**
 * En la ficha del cliente, en «Lo que no cuadra»: «Pagó con tarjeta y falta
 * apuntarlo», con «Apuntar el pago» (apagado mientras la cuenta no valga, con
 * el enlace a Ajustes) y, al apuntar, el bloque verde.
 */
export function AvisoPagoTarjeta({ diferencia, empresa, hecho, alHecho }: {
  diferencia: string | null; empresa: string
  /** Lo ya apuntado: se enseña el bloque verde aunque la incidencia ya no esté. */
  hecho: PagoHecho | null
  alHecho: (h: PagoHecho) => void
}) {
  const { datos, error } = useStripe(empresa)
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  if (hecho) return <Hecho {...hecho} />
  if (!diferencia) return null
  if (error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer el pago con tarjeta: {error}</p>
  if (!datos) return null
  const p = datos.pendientes.find((x) => x.id === diferencia)
  if (!p) return null
  const v = avisoFicha(p, datos)
  const apuntar = async () => {
    setOcupado(true); setFallo(null)
    try {
      const r = await apuntarPago(diferencia)
      if (!r.apuntado) { setFallo(r.frase); return }
      const { envio, aviso } = await conEnvio(empresa, [r.apuntado])
      alHecho({ a: r.apuntado, envio, aviso })
    } catch (e) { setFallo(`No se ha apuntado: ${msg(e)}`) } finally { setOcupado(false) }
  }
  return (
    <div className="cxst-aviso">
      <div className="cxst-aviso-sub">PENDIENTE DE REVISAR</div>
      <b className="cxst-aviso-titulo">{v.titulo}</b>
      <p className="cxst-aviso-texto">{v.texto} <b>{v.porQue}</b></p>
      <p className="cxst-aviso-detalle">{v.detalle}</p>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
      <div className="cxst-fila">
        <button type="button" className="cxst-verde" onClick={() => void apuntar()} disabled={!v.puede || ocupado}>{ocupado ? 'Apuntando…' : 'Apuntar el pago'}</button>
        <Link className="cx-enlace cxst-enlace" to={rutaAjustes('cobros')}>{v.enlace}</Link>
      </div>
    </div>
  )
}
