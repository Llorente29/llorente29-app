// src/modules/conta/pagos/PagarConRevolut.tsx
//
// B01 Revolut · PR 2c-2 · PAGAR UNA FACTURA CON EL BANCO, desde su ficha
// (maqueta v2, pantalla 3, y v4 de la segunda aprobación, aprobadas por Julio).
//
//   · BloquePagarConRevolut: el bloque de la ficha de la factura recibida.
//     - Si la empresa no paga con ningún banco desde Sumied, no sale nada.
//     - Si hay un pago en marcha, dice en qué está y lo que se puede hacer.
//     - Si no puedes pagar: «Pídeselo a …, que puede pagar».
//     - Si puedes y no hay pago en marcha, no sale: «Pagar · X €» de arriba abre
//       el panel lateral de Pagos (B01 · Cola 1e, Julio 03/11: nada del pago en
//       la columna estrecha; maqueta v2, pantallas 2 y 5).
//   · SegundaAprobacion: la lista exacta y «Confirmar con mi llave», o el PIN
//     de pago. Una confirmación para todos los pagos que salen juntos. Con
//     dos o más personas que pagan, la da otra (ella ve la misma pantalla).
// El botón lleva el nombre del banco de «Desde»: hoy, Revolut.
// Cada botón dice lo que ha pasado (regla 8).

import { useState } from 'react'
import { Boton, Campo, Dialogo, Texto } from '@/modules/conta/diseno'
import { BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { hayLlaves, nombreDelDispositivo, pagar, textoDeFalloLlave, usarLlave, type OpcionesConfirmar } from '@/modules/conta/pagos/llaveNavegador'
import {
  cancelar, cuentasParaPagar, lineaDelPago, mandar, pagoDeLaFactura, paraMi, preguntarEstado, verLote,
} from '@/modules/conta/pagos/pagarService'
import { leerQuienPaga } from '@/modules/conta/bancos/revolut/pagosRevolut'

type Aviso = { tono: 'ok' | 'duda' | 'falta'; texto: string }
const Mensaje = ({ a }: { a: Aviso | null }) => a
  ? <p className="s-aviso-lista" data-tono={a.tono === 'ok' ? 'ok' : a.tono} role={a.tono === 'falta' ? 'alert' : 'status'}>{a.texto}</p>
  : null


export function BloquePagarConRevolut({ empresaId, facturaId, refresco = 0 }: { empresaId: string; facturaId: string; refresco?: number }) {
  const [vuelta, setVuelta] = useState(0)
  const cuentas = useLeer(() => cuentasParaPagar(empresaId), `pagar-cuentas:${empresaId}`)
  const quien = useLeer(() => leerQuienPaga(empresaId), `pagar-quien:${empresaId}`)
  const vivo = useLeer(() => pagoDeLaFactura(facturaId), `pagar-vivo:${facturaId}:${vuelta}:${refresco}`)
  const [lote, setLote] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  // Solo se relee el pago, no la ficha: releer la ficha vacía lo que la rodea mientras lee, y el
  // bloque (con la segunda aprobación abierta) se desmontaría (e2e 41340811574). La factura no cambia
  // al aprobar ni al mandar: queda pagada al casar su cargo en Bancos.
  const recargar = () => setVuelta((v) => v + 1)

  const lista = cuentas.datos ?? []
  // Sin ninguna cuenta con la que pagar desde Sumied, el bloque no existe: el pago sigue siendo el de siempre.
  if (cuentas.error) return <BloqueFicha titulo="Pagar con el banco"><p className="s-apoyo">No se ha podido saber si se puede pagar desde Sumied: {cuentas.error}</p></BloqueFicha>
  if (!cuentas.datos || lista.length === 0) return null
  // Sin nadie con el permiso de pagar, los pagos no están activados: tampoco sale (lo dice Bancos).
  if (quien.error) return <BloqueFicha titulo="Pagar con el banco"><p className="s-apoyo">No se ha podido saber quién puede pagar: {quien.error}</p></BloqueFicha>
  if (!quien.datos || quien.datos.personas.length === 0) return null
  const yoPuedo = quien.datos.yoPuedo
  const banco = lista[0].banco
  const p = vivo.datos
  const linea = p ? lineaDelPago(p, banco) : null

  // B01 · Cola 1e (Julio, 03/11): nada del pago en la columna estrecha. Sin un pago en marcha y pudiendo
  // pagar, el bloque no sale: «Pagar · X €» de arriba abre el panel lateral (maqueta v2, pantallas 2 y 5).
  if (!linea?.vivo && yoPuedo && !aviso && !lote) return null
  const preguntar = async () => {
    if (!p) return
    setHaciendo(true); setAviso(null)
    const r = await preguntarEstado(empresaId, p.lote)
    setHaciendo(false); setAviso({ tono: r.ok ? 'ok' : 'falta', texto: r.texto }); recargar()
  }
  const mandarYa = async () => {
    if (!p) return
    setHaciendo(true); setAviso(null)
    const r = await mandar(empresaId, p.lote)
    setHaciendo(false); setAviso({ tono: r.ok ? 'ok' : 'falta', texto: r.texto }); recargar()
  }

  return (
    <BloqueFicha titulo={`Pagar con ${banco}`}>
      <div data-prueba="pagar-con-banco">
        {vivo.error && <p className="s-apoyo">{vivo.error}</p>}
        {linea && (
          <div className="s-fila-campos">
            <p className="s-aviso-lista" data-tono={linea.tono} role="status" data-prueba="pago-estado">{linea.texto}{p ? ` · ${eurosExactos(p.importe)}` : ''}</p>
            {p?.estado === 'esperando_segunda' && <Boton onClick={() => setLote(p.lote)}>Ver la segunda aprobación</Boton>}
            {p?.estado === 'lista' && <Boton variante="principal" disabled={haciendo} onClick={() => void mandarYa()}>{haciendo ? 'Mandando…' : `Mandar a ${banco}`}</Boton>}
            {(p?.estado === 'enviando' || p?.estado === 'enviada' || p?.estado === 'esperando_banco') && <Boton disabled={haciendo} onClick={() => void preguntar()}>{haciendo ? 'Preguntando…' : `Preguntar a ${banco}`}</Boton>}
          </div>
        )}
        {!linea?.vivo && !yoPuedo && (
          <p className="s-apoyo" data-prueba="pideselo">Pídeselo a {quien.datos.personas.map((x) => x.nombre).join(' o ')}, que puede pagar.</p>
        )}
        <Mensaje a={aviso} />
      </div>
      {lote && <SegundaAprobacion empresaId={empresaId} lote={lote} alCerrar={(a) => { setLote(null); if (a) setAviso(a); recargar() }} />}
    </BloqueFicha>
  )
}

export function SegundaAprobacion({ empresaId, lote, alCerrar }: { empresaId: string; lote: string; alCerrar: (a: Aviso | null) => void }) {
  const l = useLeer(() => verLote(lote), `lote:${lote}`)
  const [conPin, setConPin] = useState(!hayLlaves())
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const d = l.datos
  const disp = nombreDelDispositivo()

  // Después de la segunda, el lote está «listo»: se manda al banco en el mismo gesto.
  const despues = async (frase: string) => {
    const m = await mandar(empresaId, lote)
    alCerrar({ tono: m.ok ? 'ok' : 'falta', texto: `${frase} ${m.texto}` })
  }

  const conLlave = async () => {
    setHaciendo(true); setError(null)
    try {
      const o = await pagar<{ reto: string; opciones: OpcionesConfirmar; sin_llave?: boolean }>('llave_opciones', { lote })
      if (!o.ok) { setError(o.texto); return }
      if (o.sin_llave) { setConPin(true); setError(o.texto ?? 'Este dispositivo no tiene tu llave: usa tu PIN de pago.'); return }
      let credencial
      try { credencial = await usarLlave(o.opciones) } catch (e) { setError(`No has confirmado. No ha salido ningún pago: siguen aprobados y esperando. ${textoDeFalloLlave(e)}`); return }
      const r = await pagar<{ frase?: string }>('llave_confirmar', { reto: o.reto, credencial, dispositivo: disp })
      if (!r.ok) { setError(r.texto); return }
      await despues(r.texto ?? r.frase ?? 'Confirmado con tu llave.')
    } finally { setHaciendo(false) }
  }

  const conElPin = async () => {
    if (!d) return
    if (!/^\d{6}$/.test(pin)) { setError('Tu PIN de pago son 6 cifras.'); return }
    setHaciendo(true); setError(null)
    try {
      const r = await pagar<{ frase?: string; quedan?: number; bloqueado?: boolean }>('pin_confirmar', { lote, pin, huella: d.huella, dispositivo: disp })
      setPin('')
      if (!r.ok) { setError(r.texto); return }
      await despues(r.texto ?? r.frase ?? 'Confirmado con tu PIN de pago.')
    } finally { setHaciendo(false) }
  }

  const noPagar = async () => {
    setHaciendo(true); setError(null)
    try { alCerrar({ tono: 'duda', texto: (await cancelar(lote, 'No pagar')).frase }) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setHaciendo(false) }
  }

  const n = d?.pagos.filter((x) => x.estado !== 'cancelada').length ?? 0
  const titulo = !d ? 'Segunda aprobación' : `Confirma con ${conPin ? 'tu PIN de pago' : 'tu llave'} ${n === 1 ? 'el pago que sale ahora' : `los ${n} pagos que salen ahora`}`
  return (
    <Dialogo titulo={titulo} alCerrar={() => alCerrar(null)}
      explicacion={d ? (d.estado !== 'esperando_segunda' ? `Este pago ya no espera la segunda aprobación (está «${d.estado}»).`
        : `${d.motivosTexto.length ? `Pide segunda aprobación: ${d.motivosTexto.join(', ')}. ` : ''}${n > 1 ? `Una sola confirmación vale para los ${n}. ` : ''}Lo que confirmas es esta lista exacta: si algo cambia después, se pide otra.`) : undefined}
      acciones={d?.estado === 'esperando_segunda' && d.puedoDar ? <>
        <Boton disabled={haciendo} onClick={() => void noPagar()}>No pagar</Boton>
        {conPin
          ? <Boton variante="principal" disabled={haciendo || pin.length !== 6} onClick={() => void conElPin()} data-prueba="confirmar-pin">{haciendo ? 'Confirmando…' : 'Confirmar y pagar'}</Boton>
          : <Boton variante="principal" disabled={haciendo} onClick={() => void conLlave()} data-prueba="confirmar-llave">{haciendo ? 'Esperando a tu llave…' : 'Confirmar con mi llave'}</Boton>}
      </> : <Boton onClick={() => alCerrar(null)}>Cerrar</Boton>}>
      {l.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{l.error}</p>}
      {!d && !l.error && <p className="s-apoyo" role="status">Leyendo los pagos…</p>}
      {d && <>
        <ul className="s-lista" data-prueba="lista-segunda">
          {d.pagos.filter((x) => x.estado !== 'cancelada').map((x) => (
            <li key={x.id}><strong>{x.beneficiario}</strong> · {x.concepto ?? 'sin número'} · IBAN ···{x.iban4}
              {x.motivosTexto.length ? ` · ${x.motivosTexto.join(', ')}` : x.ibanCheck === 'comprobado' ? ' · ✓ comprobado' : ''} · <strong>{eurosExactos(x.importe)}</strong></li>
          ))}
        </ul>
        <p className="s-apoyo">Desde {d.desde.banco} · {d.desde.nombre}{d.desde.iban4 ? ` ···${d.desde.iban4}` : ''} · <strong>{eurosExactos(d.total)}</strong>{d.aprobadoPor ? ` · aprobado por ${d.aprobadoPor}` : ''}</p>
        {d.estado === 'esperando_segunda' && !d.puedoDar && <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="la-da-otra">{d.noPuedoPorque}</p>}
        {d.estado === 'esperando_segunda' && d.puedoDar && conPin && (
          <Campo etiqueta="PIN de pago (6 cifras)" ayuda="Vale para esta lista y nada más. Con 5 fallos se bloquea.">{(c) => (
            <Texto {...c} type="password" inputMode="numeric" autoComplete="off" maxLength={6} valor={pin} alCambiar={(v) => setPin(v.replace(/\D/g, ''))} data-prueba="pin-pago" />
          )}</Campo>
        )}
        {d.estado === 'esperando_segunda' && d.puedoDar && (
          <p className="s-apoyo">
            {conPin
              ? <>{hayLlaves() && <button type="button" className="pg-enlace" onClick={() => { setConPin(false); setError(null) }}>Usar mi llave</button>}</>
              : <>¿No tienes tu llave en este dispositivo, o prefieres no usarla? <button type="button" className="pg-enlace" onClick={() => { setConPin(true); setError(null) }}>Usar mi PIN de pago</button></>}
          </p>
        )}
      </>}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
    </Dialogo>
  )
}

/**
 * Lo que espera MI segunda aprobación (con dos o más personas que pagan), en Compras › Pagos.
 * Regla 7: si hay alguno, se ve; si no hay ninguno, no ocupa sitio (no es un aviso que interrumpe).
 */
export function EsperanMiSegunda({ empresaId, alCambiar }: { empresaId: string; alCambiar: () => void }) {
  const [vuelta, setVuelta] = useState(0)
  const lista = useLeer(() => paraMi(empresaId), `para-mi:${empresaId}:${vuelta}`)
  const [lote, setLote] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const xs = lista.datos ?? []
  if (lista.error) return <p className="s-apoyo">No se ha podido saber si algún pago espera tu segunda aprobación: {lista.error}</p>
  if (!xs.length && !aviso) return null
  return (
    <div className="pg-aviso-ambar" role="status" data-prueba="esperan-mi-segunda">
      {xs.length > 0 && <p><strong>{xs.length === 1 ? '1 pago espera tu segunda aprobación' : `${xs.length} pagos esperan tu segunda aprobación`}.</strong></p>}
      {xs.map((x) => (
        <p key={x.lote}>Aprobado por {x.aprobadoPor ?? 'otra persona'}: {x.pagos === 1 ? '1 pago' : `${x.pagos} pagos`}, {eurosExactos(x.total)}.{' '}
          <button type="button" className="pg-enlace" onClick={() => { setAviso(null); setLote(x.lote) }}>Verlo y aprobarlo</button></p>
      ))}
      <Mensaje a={aviso} />
      {lote && <SegundaAprobacion empresaId={empresaId} lote={lote} alCerrar={(a) => { setLote(null); if (a) setAviso(a); setVuelta((v) => v + 1); alCambiar() }} />}
    </div>
  )
}
