// src/modules/conta/pagos/PagarVarias.tsx
//
// B01 Revolut · PR 3b · PAGAR VARIAS FACTURAS A LA VEZ CON EL BANCO, desde
// Compras › Pagos (maqueta v2, pantalla 4, aprobada por Julio). Es la remesa
// de siempre con otra salida: las facturas marcadas, desde la cuenta de
// «Desde», un solo «Aprobar y pagar», y una sola segunda aprobación para todas.
//
//   · Cada factura, preparada por la base (conta_pago_preparar: lo que saldría
//     y por qué haría falta la segunda) y su titular, preguntado al banco.
//   · No sale lo que la base no deja pagar (sin IBAN, domiciliada…), ni un
//     titular que no coincide salvo «pagar igual» con su porqué. Se dice cuáles
//     y por qué; las demás salen juntas.
//   · Sin segunda aprobación, se mandan al banco en el mismo gesto; con ella,
//     la pantalla de la llave o el PIN (la da quien aprueba si es la única que
//     paga; si no, otra persona).
// Cada botón dice lo que ha pasado (regla 8).

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Boton, Dialogo, Texto } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  aprobarVarias, mandar, preparar, quienesSalen, textoPagadas, textoTitular, titular, type FilaVarias,
} from '@/modules/conta/pagos/pagarService'
import { SegundaAprobacion } from '@/modules/conta/pagos/PagarConRevolut'

/** Lo que dice al cerrar; con «lote», Pagos enseña cómo va cada pago (maqueta v2, pantalla 4). */
type Aviso = { tono: 'ok' | 'duda' | 'falta'; texto: string; lote?: string }
const ETIQUETA_IBAN: Record<string, string> = { comprobado: '✓ comprobado', primer_pago: 'nuevo', cambiado: 'cambiado' }

/**
 * B01 · Respuesta B01·12 (03/11) · El panel de Pagos, fijo a la derecha y SIN velo (maqueta v2,
 * pantalla 2): la lista sigue a la vista y se puede seguir marcando. En el móvil, la hoja desde abajo.
 * Escape lo cierra; no se lleva el foco (se está marcando en la lista).
 */
export function PanelFijo({ titulo, alCerrar, acciones, children }: { titulo: string; alCerrar: () => void; acciones?: ReactNode; children?: ReactNode }) {
  const id = useId()
  const cerrar = useRef(alCerrar)
  useEffect(() => { cerrar.current = alCerrar }, [alCerrar])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar.current() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])
  return (
    <div className="pg-panel-fijo cx">
      <div className="s-dialogo s-dialogo-lateral" role="dialog" aria-modal="false" aria-labelledby={id} data-prueba="panel-pagar">
        <div className="s-dialogo-cabeza">
          <h2 id={id} className="s-dialogo-titulo">{titulo}</h2>
          <span className="s-apoyo pg-panel-esc">Esc cierra</span>
          <Boton variante="fantasma" icono="cerrar" className="s-dialogo-cerrar" aria-label="Cerrar" onClick={alCerrar}>{''}</Boton>
        </div>
        <div className="s-dialogo-cuerpo">{children}</div>
        {acciones && <div className="s-dialogo-acciones">{acciones}</div>}
      </div>
    </div>
  )
}

export function DialogoPagarVarias({ empresaId, cuenta, facturas, alCerrar, fijo, extra }: {
  empresaId: string
  /** B01 · Cola 1e · Con el saldo de la última lectura del banco (null: no se sabe). */
  cuenta: { id: string; nombre: string; iban4: string | null; banco: string; saldo?: number | null; saldoLeido?: string | null }
  facturas: readonly { id: string; proveedor: string; numero: string | null }[]
  alCerrar: (a: Aviso | null) => void
  /** B01·12 · En Pagos: el panel sin velo, que sigue a lo que se marca. */
  fijo?: boolean
  /** B01·12 · Lo de otro banco («Preparar el fichero SEPA»), dentro del panel. */
  extra?: ReactNode
}) {
  const nueva = (f: { id: string; proveedor: string; numero: string | null }): FilaVarias => ({
    facturaId: f.id, proveedor: f.proveedor, numero: f.numero, preparado: null, error: null, titular: null, titularError: null, pagarIgual: false, porque: '',
  })
  // Lo sabido de cada factura, por su id; las filas salen de las facturas de ahora (B01·12: cambian mientras se marca).
  const [sabido, setSabido] = useState<Record<string, Partial<FilaVarias>>>({})
  const filas: FilaVarias[] = facturas.map((f) => ({ ...nueva(f), ...sabido[f.id] }))
  const [lote, setLote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const cambiar = (id: string, c: Partial<FilaVarias>) => setSabido((m) => ({ ...m, [id]: { ...m[id], ...c } }))

  // Una a una (el banco pregunta el titular de cada IBAN): primero lo que dice la base, después el titular.
  // B01·12 · En Pagos el panel sigue abierto mientras se marca: entran las nuevas y salen las desmarcadas.
  const pedidas = useRef(new Set<string>())
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])
  const ids = facturas.map((f) => f.id).join(',')
  useEffect(() => {
    montado.current = true
    for (const id of [...pedidas.current]) if (!facturas.some((f) => f.id === id)) pedidas.current.delete(id)
    const porHacer = facturas.filter((f) => !pedidas.current.has(f.id))
    porHacer.forEach((f) => pedidas.current.add(f.id))
    void (async () => {
      for (const f of porHacer) {
        let p
        try { p = await preparar(empresaId, f.id, cuenta.id) } catch (e) { if (montado.current) cambiar(f.id, { error: e instanceof Error ? e.message : String(e) }); continue }
        if (!montado.current) return
        cambiar(f.id, { preparado: p })
        if (!p.sePuede) continue
        const t = await titular(empresaId, f.id, cuenta.id)
        if (!montado.current) return
        cambiar(f.id, t.ok ? { titular: t.titular ?? { resultado: 'ahora_no', porque: 'sin respuesta' } } : { titularError: t.texto })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cuando cambian las facturas
  }, [ids])

  const { salen, fuera, comprobando } = quienesSalen(filas)
  const total = salen.reduce((s, f) => s + (f.preparado?.importe ?? 0), 0)
  const motivos = [...new Set(salen.flatMap((f) => [...(f.preparado?.motivosTexto ?? []), ...(f.pagarIgual && f.titular?.resultado === 'no_coincide' ? ['pagar igual con un titular que no coincide'] : [])]))]
  const otra = salen.some((f) => f.preparado?.quien.segunda === 'otra')
  // B01 · Cola 1e · Antes de aprobar, el saldo: si no llega, se dice con la cifra y no se puede pulsar.
  const saldo = cuenta.saldo ?? null
  const noLlega = saldo !== null && salen.length > 0 && saldo + 0.005 < total
  const titularBien = salen.filter((f) => f.titular?.resultado === 'coincide').length

  const aprobarYPagar = async () => {
    if (!salen.length) return
    setHaciendo(true); setError(null)
    try {
      const r = await aprobarVarias(empresaId, cuenta.id, salen.map((f) => ({ id: f.facturaId, pagarIgualPorque: f.pagarIgual && f.titular?.resultado === 'no_coincide' ? f.porque.trim() : null })))
      if (r.estado === 'listo') {
        const m = await mandar(empresaId, r.lote)
        // Regla 8: lo que ha pasado, con su contenido.
        alCerrar({ tono: m.ok ? 'ok' : 'falta', lote: r.lote, texto: m.ok
          ? `${textoPagadas(salen.length, total, cuenta.banco)} ${m.texto}`
          : `${r.frase} ${m.texto}` })
      } else if (r.segunda?.quien === 'otra') {
        alCerrar({ tono: 'duda', texto: r.frase })
      } else {
        setLote(r.lote)
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setHaciendo(false)
  }

  if (lote) return <SegundaAprobacion empresaId={empresaId} lote={lote} alCerrar={(a) => alCerrar(a ? { ...a, lote } : null)} />
  const n = salen.length
  const tituloPanel = facturas.length === 1 ? 'Pagar 1 factura' : `Pagar ${facturas.length} facturas`
  const acciones = (<>
        <Boton onClick={() => alCerrar(null)}>Cancelar</Boton>
        <Boton variante="principal" disabled={haciendo || comprobando > 0 || n === 0 || noLlega} onClick={() => void aprobarYPagar()} data-prueba="aprobar-y-pagar-varias">
          {haciendo ? 'Aprobando…' : comprobando > 0 ? `Comprobando ${comprobando}…` : `Aprobar y pagar · ${eurosExactos(total)}`}
        </Boton>
      </>)
  const cuerpo = (<>
      {/* Maqueta v2, pantalla 2: las facturas (una transferencia por factura), desde, cuándo, lo que comprueba Sumied. */}
      <ul className="pg-panel-facturas" data-prueba="lista-varias">
        {filas.map((f) => {
          const p = f.preparado
          const tt = f.titularError ? { tono: 'duda' as const, texto: f.titularError } : textoTitular(f.titular, p?.beneficiario ?? f.proveedor, cuenta.banco)
          const sale = salen.includes(f)
          const porQueNo = fuera.find((x) => x.fila === f)?.porque
          return (
            <li key={f.facturaId} className="pg-panel-factura" data-prueba="fila-varias" data-sale={sale ? 'si' : porQueNo ? 'no' : 'comprobando'}>
              <div className="pg-panel-par">
                <span className="pg-panel-quien">{p?.beneficiario ?? f.proveedor} · {f.numero ?? 'sin número'}</span>
                <span className="s-cifra">{p?.sePuede ? eurosExactos(p.importe) : '—'}</span>
              </div>
              <div className="pg-panel-detalle">
                {p?.sePuede && <>IBAN ···{p.iban4} · {ETIQUETA_IBAN[p.ibanCheck ?? ''] ?? p.ibanCheck} · {tt.texto}</>}
                {p?.sePuede && p.motivosTexto.length > 0 && <> · pide segunda: {p.motivosTexto.join(', ')}</>}
                {!p && !f.error && 'comprobando…'}
              </div>
              {porQueNo && <p className="s-aviso-lista" data-tono="duda" role="status">No sale: {porQueNo}</p>}
              {f.titular?.resultado === 'no_coincide' && (
                <div className="pg-dialogo-campos">
                  <label className="s-check"><input type="checkbox" checked={f.pagarIgual} onChange={(e) => cambiar(f.facturaId, { pagarIgual: e.target.checked })} /> Lo he comprobado con el proveedor: pagar igual</label>
                  {f.pagarIgual && <Texto aria-label={`Por qué pagar igual a ${f.proveedor}`} valor={f.porque} alCambiar={(v) => cambiar(f.facturaId, { porque: v })} maxLength={200} />}
                </div>
              )}
            </li>
          )
        })}
        {comprobando === 0 && n > 0 && (
          <li className="pg-panel-par pg-panel-total"><strong>{n === 1 ? '1 transferencia' : `${n} transferencias, una por factura`}</strong><strong className="s-cifra">{eurosExactos(total)}</strong></li>
        )}
      </ul>
      <div className="pg-panel-desde" data-prueba="panel-desde">
        <span className="s-apoyo">Desde</span>
        <div className="pg-panel-par">
          <span><strong>{cuenta.nombre}</strong>{cuenta.iban4 ? <span className="s-apoyo"> ···{cuenta.iban4}</span> : null}</span>
          {saldo !== null
            ? <span className="s-cifra" data-prueba="saldo-antes-despues">{eurosExactos(saldo)} → <strong>{eurosExactos(Math.round((saldo - total) * 100) / 100)}</strong></span>
            : <span className="s-apoyo">sin saldo leído todavía</span>}
        </div>
        {cuenta.saldoLeido && <span className="s-apoyo">Saldo de las {new Date(cuenta.saldoLeido).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}</span>}
      </div>
      <div className="pg-panel-cuando">
        <div className="pg-panel-par"><span className="s-apoyo">Cuándo</span><strong data-prueba="sale-ahora">Sale ahora.</strong></div>
        <p className="s-apoyo">{cuenta.banco} paga al momento.</p>
      </div>
      {noLlega && (
        <p className="s-aviso-lista" data-tono="falta" role="alert" data-prueba="no-llega">{`En ${cuenta.banco} hay ${eurosExactos(saldo!)}; hacen falta ${eurosExactos(total)}.`} Pasa dinero a {cuenta.banco} o quita facturas.</p>
      )}
      {comprobando === 0 && n > 0 && (
        <div className="pg-panel-comprueba-caja">
          <span className="s-apoyo">Lo que comprueba Sumied</span>
          <ul className="pg-panel-comprueba" data-prueba="lo-que-comprueba">
            <li data-bien={titularBien === n ? 'si' : 'no'}>Titular: {cuenta.banco} dice que coincide en {titularBien} de {n}.</li>
            {motivos.length > 0 ? <li data-bien="no">Pide segunda aprobación: {motivos.join(', ')}.</li> : <li data-bien="si">Sin segunda aprobación: los topes y los IBAN, bien.</li>}
          </ul>
        </div>
      )}
      {comprobando === 0 && (
        <p className="s-apoyo" role="status" data-prueba="resumen-varias">
          {n === 0 ? 'No sale ninguna: mira por qué en cada una.' : `Salen ${n === 1 ? '1 pago' : `${n} pagos`}, ${eurosExactos(total)}, con una sola aprobación.`}
          {fuera.length > 0 ? ` ${fuera.length === 1 ? '1 se queda' : `${fuera.length} se quedan`} por pagar.` : ''}
        </p>
      )}
      {comprobando === 0 && motivos.length > 0 && (
        <p className="s-aviso-lista" data-tono="duda" role="status" data-prueba="pide-segunda-varias">
          {`Hace falta una segunda aprobación (${motivos.join(', ')}). `}
          {otra ? 'La da otra persona que pueda pagar, con su llave o su PIN: una sola para todos. Hasta entonces no sale nada.'
            : 'La confirmas tú con tu llave, o con tu PIN de pago: una sola para todos. Hasta entonces no sale nada.'}
        </p>
      )}
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
      {extra}
    </>)
  if (fijo) return <PanelFijo titulo={tituloPanel} alCerrar={() => alCerrar(null)} acciones={acciones}>{cuerpo}</PanelFijo>
  return <Dialogo lateral titulo={tituloPanel} alCerrar={() => alCerrar(null)} acciones={acciones}>{cuerpo}</Dialogo>
}
