// src/modules/conta/pagos/PagarConRevolut.tsx
//
// B01 Revolut · PR 2c-2 · PAGAR UNA FACTURA CON EL BANCO, desde su ficha
// (maqueta v2, pantalla 3, y v4 de la segunda aprobación, aprobadas por Julio).
//
//   · BloquePagarConRevolut: el bloque de la ficha de la factura recibida.
//     - Si la empresa no paga con ningún banco desde Sumied, no sale nada.
//     - Si hay un pago en marcha, dice en qué está y lo que se puede hacer.
//     - Si no puedes pagar: «Pídeselo a …, que puede pagar».
//     - Si puedes: «Pagar con Revolut» abre el panel: desde, el IBAN, el
//       titular (lo que dice el banco), el importe, el concepto, por qué hace
//       falta la segunda aprobación y «Aprobar y pagar».
//   · SegundaAprobacion: la lista exacta y «Confirmar con mi llave», o el PIN
//     de pago. Una confirmación para todos los pagos que salen juntos. Con
//     dos o más personas que pagan, la da otra (ella ve la misma pantalla).
// El botón lleva el nombre del banco de «Desde»: hoy, Revolut.
// Cada botón dice lo que ha pasado (regla 8).

import { useState } from 'react'
import { Boton, Campo, Dialogo, Selector, Texto } from '@/modules/conta/diseno'
import { BloqueFicha } from '@/modules/conta/diseno/plantillas'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { hayLlaves, nombreDelDispositivo, pagar, textoDeFalloLlave, usarLlave, type OpcionesConfirmar } from '@/modules/conta/pagos/llaveNavegador'
import {
  aprobar, cancelar, cuentasParaPagar, lineaDelPago, mandar, pagoDeLaFactura, paraMi, preguntarEstado, preparar, textoTitular, titular, verLote,
  type Titular,
} from '@/modules/conta/pagos/pagarService'
import { leerQuienPaga } from '@/modules/conta/bancos/revolut/pagosRevolut'

type Aviso = { tono: 'ok' | 'duda' | 'falta'; texto: string }
const Mensaje = ({ a }: { a: Aviso | null }) => a
  ? <p className="s-aviso-lista" data-tono={a.tono === 'ok' ? 'ok' : a.tono} role={a.tono === 'falta' ? 'alert' : 'status'}>{a.texto}</p>
  : null

const ETIQUETA_IBAN: Record<string, string> = { comprobado: '✓ comprobado', primer_pago: 'nuevo', cambiado: 'cambiado' }

export function BloquePagarConRevolut({ empresaId, facturaId }: { empresaId: string; facturaId: string }) {
  const [vuelta, setVuelta] = useState(0)
  const cuentas = useLeer(() => cuentasParaPagar(empresaId), `pagar-cuentas:${empresaId}`)
  const quien = useLeer(() => leerQuienPaga(empresaId), `pagar-quien:${empresaId}`)
  const vivo = useLeer(() => pagoDeLaFactura(facturaId), `pagar-vivo:${facturaId}:${vuelta}`)
  const [panel, setPanel] = useState(false)
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
        {!linea?.vivo && !panel && yoPuedo && (
          <Boton variante="principal" onClick={() => { setAviso(null); setPanel(true) }} data-prueba="abrir-pagar">Pagar con {banco}</Boton>
        )}
        {!linea?.vivo && !yoPuedo && (
          <p className="s-apoyo" data-prueba="pideselo">Pídeselo a {quien.datos.personas.map((x) => x.nombre).join(' o ')}, que puede pagar.</p>
        )}
        {panel && !linea?.vivo && (
          <PanelPagar empresaId={empresaId} facturaId={facturaId} cuentas={lista}
            alCerrar={() => setPanel(false)}
            alAprobar={(r) => { setPanel(false); setAviso({ tono: r.estado === 'listo' ? 'ok' : 'duda', texto: r.frase }); recargar(); if (r.abrirSegunda) setLote(r.lote) }} />
        )}
        <Mensaje a={aviso} />
      </div>
      {lote && <SegundaAprobacion empresaId={empresaId} lote={lote} alCerrar={(a) => { setLote(null); if (a) setAviso(a); recargar() }} />}
    </BloqueFicha>
  )
}

function PanelPagar({ empresaId, facturaId, cuentas, alCerrar, alAprobar }: {
  empresaId: string; facturaId: string; cuentas: { id: string; nombre: string; iban4: string | null; banco: string }[]
  alCerrar: () => void
  alAprobar: (r: { lote: string; estado: 'listo' | 'esperando_segunda'; frase: string; abrirSegunda: boolean }) => void
}) {
  const [cuentaId, setCuentaId] = useState(cuentas[0].id)
  const prep = useLeer(() => preparar(empresaId, facturaId, cuentaId), `pagar-preparar:${facturaId}:${cuentaId}`)
  const d = prep.datos
  // El titular, en cuanto se puede pagar: lo pregunta el banco antes de aprobar.
  const tit = useLeer(d?.sePuede ? () => titular(empresaId, facturaId, cuentaId) : null, `pagar-titular:${facturaId}:${cuentaId}:${d?.sePuede === true}`)
  const t: Titular | null = tit.datos && tit.datos.ok ? tit.datos.titular : null
  const [pagarIgual, setPagarIgual] = useState(false)
  const [porque, setPorque] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const noCoincide = t?.resultado === 'no_coincide'
  const banco = cuentas.find((c) => c.id === cuentaId)?.banco ?? 'el banco'

  const aprobarYPagar = async () => {
    if (!d) return
    if (noCoincide && (!pagarIgual || !porque.trim())) { setError('El titular no coincide: compruébalo con el proveedor y, si es su cuenta, marca «pagar igual» y di por qué.'); return }
    setHaciendo(true); setError(null)
    try {
      const r = await aprobar(empresaId, cuentaId, facturaId, noCoincide ? porque.trim() : null)
      if (r.estado === 'listo') {
        const m = await mandar(empresaId, r.lote)
        alAprobar({ lote: r.lote, estado: 'listo', frase: `${r.frase} ${m.texto}`, abrirSegunda: false })
      } else {
        alAprobar({ lote: r.lote, estado: 'esperando_segunda', frase: r.frase, abrirSegunda: r.segunda?.quien !== 'otra' })
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setHaciendo(false)
  }

  const tt = textoTitular(t, d?.beneficiario ?? null, banco)
  return (
    <div className="pg-dialogo-campos" data-prueba="panel-pagar">
      {cuentas.length > 1 && (
        <Campo etiqueta="Desde" ayuda="Solo salen las cuentas con las que se puede pagar desde Sumied.">{(c) => (
          <Selector {...c} valor={cuentaId} alCambiar={(v) => { setCuentaId(v); setPagarIgual(false); setPorque('') }}
            opciones={cuentas.map((x) => ({ valor: x.id, texto: `${x.banco} · ${x.nombre}${x.iban4 ? ` ···${x.iban4}` : ''}` }))} />
        )}</Campo>
      )}
      {prep.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{prep.error}</p>}
      {!d && !prep.error && <p className="s-apoyo" role="status">Preparando el pago…</p>}
      {d && !d.sePuede && <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="no-se-puede">{d.porque}</p>}
      {d && d.sePuede && <>
        <dl className="s-resumen" data-prueba="resumen-pago">
          <dt>Importe</dt><dd><strong>{eurosExactos(d.importe)}</strong></dd>
          <dt>A</dt><dd>{d.beneficiario}</dd>
          <dt>IBAN</dt><dd>···{d.iban4} · {ETIQUETA_IBAN[d.ibanCheck ?? ''] ?? d.ibanCheck}{d.ibanNota ? ` · ${d.ibanNota}` : ''}</dd>
          <dt>Desde</dt><dd>{cuentas.find((c) => c.id === cuentaId)?.nombre}{cuentas.find((c) => c.id === cuentaId)?.iban4 ? ` ···${cuentas.find((c) => c.id === cuentaId)?.iban4}` : ''}</dd>
          <dt>Concepto</dt><dd>{d.concepto}</dd>
          <dt>Titular</dt><dd data-prueba="titular">{tit.datos && !tit.datos.ok ? tit.datos.texto : tt.texto}</dd>
        </dl>
        {noCoincide && (
          <div className="pg-dialogo-campos">
            <label className="s-check"><input type="checkbox" checked={pagarIgual} onChange={(e) => setPagarIgual(e.target.checked)} /> Lo he comprobado con el proveedor: pagar igual</label>
            {pagarIgual && <Campo etiqueta="Por qué (queda escrito con tu nombre)">{(c) => <Texto {...c} valor={porque} alCambiar={setPorque} maxLength={200} />}</Campo>}
          </div>
        )}
        {(d.motivosTexto.length > 0 || (noCoincide && pagarIgual)) && (
          <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="pide-segunda">
            {`Hace falta una segunda aprobación (${[...d.motivosTexto, ...(noCoincide && pagarIgual && !d.motivos.includes('pagar_igual') ? ['pagar igual con un titular que no coincide'] : [])].join(', ')}). `}
            {d.quien.segunda === 'otra'
              ? 'La da otra persona que pueda pagar, con su llave o su PIN. Hasta entonces no sale nada.'
              : 'La confirmas tú con tu llave, o con tu PIN de pago, en una pantalla aparte. Hasta entonces no sale nada.'}
          </p>
        )}
      </>}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
      <div className="s-fila-campos">
        <Boton onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!d?.sePuede || haciendo || (noCoincide && !pagarIgual)} onClick={() => void aprobarYPagar()} data-prueba="aprobar-y-pagar">
          {haciendo ? 'Aprobando…' : 'Aprobar y pagar'}
        </Boton>
      </div>
      <p className="s-apoyo">Queda en el registro: quién, cuándo y qué.</p>
    </div>
  )
}

/** La segunda aprobación de un lote: la lista exacta, con la llave o con el PIN (maqueta v4). */
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
