// src/modules/conta/impuestos/ReabrirTrimestre.tsx
//
// V04 · Respuesta 5, punto 3 · «Reabrir para corregir» el 303 de un periodo ya
// presentado, en Impuestos › Trimestre, debajo de la ficha del 303:
//   · escondido en «Más», y solo para el administrador de la empresa o su
//     gestor (lo decide la base: conta_iva_puede_reabrir);
//   · antes de reabrir, «¿Solo es una factura recibida? Se deduce en el 4T sin
//     reabrir»; luego un motivo escrito y la confirmación: «La presentación del
//     20/10 se queda como estaba. Lo que cambies irá en una nueva presentación»;
//   · reabierto, en rojo: «Reabierto para corregir, sin presentar», con la
//     original y la nueva juntas, y «Apuntar la nueva presentación» (su CSV),
//     que lo vuelve a cerrar;
//   · ya cerrado, la original y la nueva, juntas.
// Lo que hace la base lo dice con su contenido (regla 8).

import { useCallback, useEffect, useState } from 'react'
import { Boton, Campo, Chip, Dialogo, Selector, Texto } from '@/modules/conta/diseno'
import { fechaLarga, eurosExactos } from '@/modules/conta/lib/formato'
import { nuevaPresentacion } from '@/modules/conta/lib/ivaPresentado'
import { apuntarNuevaPresentacion, leerReaperturas, puedeReabrir, reabrir, type Presentacion, type Reapertura } from '@/modules/conta/services/reaperturaIvaService'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dm = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso)) : '—')

/** El trimestre siguiente, para «Se deduce en el 4T sin reabrir». */
function siguiente(trimestre: string): string {
  const n = Number(trimestre[0])
  return n >= 4 ? '1T' : `${n + 1}T`
}

export function ReabrirTrimestre({ companyId, ejercicio, trimestre, declaracionId, presentadaEl, presentada, deRuta, quien, alHacer }: {
  companyId: string; ejercicio: number; trimestre: string
  /** La declaración del 303 de este trimestre (la nº 1). */
  declaracionId: string; presentadaEl: string | null; presentada: boolean; deRuta: boolean; quien: string | null
  alHacer: (h: { tono: 'ok' | 'falta'; texto: string }) => void
}) {
  const [vuelta, setVuelta] = useState(0)
  const [leido, setLeido] = useState<{ clave: string; lista: Reapertura[]; puede: boolean; error: string | null } | null>(null)
  const clave = `${companyId}/${ejercicio}/${trimestre}/${vuelta}`
  useEffect(() => {
    let vivo = true
    Promise.all([leerReaperturas(companyId, ejercicio), deRuta ? Promise.resolve(false) : puedeReabrir(companyId)])
      .then(([lista, puede]) => { if (vivo) setLeido({ clave, lista: lista.filter((r) => r.periodo === trimestre), puede, error: null }) },
        (e: unknown) => { if (vivo) setLeido({ clave, lista: [], puede: false, error: msg(e) }) })
    return () => { vivo = false }
  }, [companyId, ejercicio, trimestre, deRuta, clave])
  const datos = leido?.clave === clave ? leido : null
  const [abriendo, setAbriendo] = useState(false)
  const [apuntando, setApuntando] = useState<Reapertura | null>(null)
  const hecho = useCallback((h: { tono: 'ok' | 'falta'; texto: string }) => { alHacer(h); setVuelta((v) => v + 1) }, [alHacer])

  if (!datos) return null
  if (datos.error) return <p className="s-apoyo" role="note">{datos.error}</p>
  const abierta = datos.lista.find((r) => !r.cerrada) ?? null
  const cerradas = datos.lista.filter((r) => r.cerrada)
  const ultima = cerradas[cerradas.length - 1]
  const ultimaPresentada = ultima ? ultima.nueva.presentada : presentadaEl

  return (
    <div className="s-trimestre-reabrir" data-prueba="reabrir">
      {abierta && (
        <div className="s-trimestre-reabierto" role="status" data-prueba="trimestre-reabierto">
          <p className="s-trimestre-reabierto-titulo"><strong>Reabierto para corregir, sin presentar</strong> · {nuevaPresentacion(abierta.nueva.secuencia ? { tipo: abierta.tipo, secuencia: abierta.nueva.secuencia } : { tipo: abierta.tipo, secuencia: 2 })}</p>
          <p className="s-apoyo">«{abierta.motivo}» · lo reabrió {abierta.por ?? 'alguien'} el {fechaLarga(abierta.abierta.slice(0, 10))}{abierta.dias > 0 ? `, hace ${abierta.dias} ${abierta.dias === 1 ? 'día' : 'días'}` : ''}. {abierta.asientos > 0 ? `${abierta.asientos} ${abierta.asientos === 1 ? 'asiento cambiado' : 'asientos cambiados'}, marcados en el diario.` : 'Aún no se ha cambiado ningún asiento.'}</p>
          {abierta.dias >= 30 && <p className="s-impuestos-porque-no" role="alert">Lleva {abierta.dias} días sin presentar: presenta la {nuevaPresentacion({ tipo: abierta.tipo, secuencia: abierta.nueva.secuencia })} y apúntala aquí.</p>}
          <Presentaciones original={abierta.original} nueva={abierta.nueva} tipo={abierta.tipo} />
          {datos.puede && <p><Boton variante="principal" onClick={() => setApuntando(abierta)}>Apuntar la nueva presentación</Boton></p>}
        </div>
      )}
      {cerradas.map((r) => (
        <div key={r.id} className="s-trimestre-reabierta" data-prueba="reapertura-cerrada">
          <p className="s-apoyo">Corregido con la {nuevaPresentacion({ tipo: r.tipo, secuencia: r.nueva.secuencia })}: «{r.motivo}».</p>
          <Presentaciones original={r.original} nueva={r.nueva} tipo={r.tipo} />
        </div>
      ))}
      {presentada && !abierta && datos.puede && (
        <details className="s-trimestre-mas" data-prueba="mas-303">
          <summary>Más</summary>
          <Boton onClick={() => setAbriendo(true)}>Reabrir para corregir el {trimestre}</Boton>
        </details>
      )}
      {abriendo && (
        <DialogoReabrir trimestre={trimestre} ejercicio={ejercicio} presentadaEl={ultimaPresentada} declaracionId={ultima ? ultima.nueva.id : declaracionId} quien={quien}
          alCerrar={() => setAbriendo(false)} alHacer={(h) => { setAbriendo(false); hecho(h) }} />
      )}
      {apuntando && (
        <DialogoApuntar r={apuntando} trimestre={trimestre} ejercicio={ejercicio} quien={quien}
          alCerrar={() => setApuntando(null)} alHacer={(h) => { setApuntando(null); hecho(h) }} />
      )}
    </div>
  )
}

/** La original y la nueva, juntas. */
function Presentaciones({ original, nueva, tipo }: { original: Presentacion; nueva: Presentacion; tipo: 'complementary' | 'substitutive' }) {
  const fila = (p: Presentacion, que: string) => (
    <li key={p.id}>
      <span>Nº {p.secuencia} · {que}</span>
      {p.presentada
        ? <span> · presentada el {fechaLarga(p.presentada.slice(0, 10))}{p.importe !== null ? ` · ${eurosExactos(p.importe)}` : ''}{p.csv ? ` · CSV ${p.csv}` : ''}</span>
        : <> · <Chip tono="falta">sin presentar</Chip></>}
    </li>
  )
  return (
    <ul className="s-trimestre-presentaciones" aria-label="Las presentaciones del trimestre" data-prueba="presentaciones">
      {fila(original, 'la original, se queda como estaba')}
      {fila(nueva, tipo === 'complementary' ? 'complementaria' : 'sustitutiva')}
    </ul>
  )
}

function DialogoReabrir({ trimestre, ejercicio, presentadaEl, declaracionId, quien, alCerrar, alHacer }: {
  trimestre: string; ejercicio: number; presentadaEl: string | null; declaracionId: string; quien: string | null
  alCerrar: () => void; alHacer: (h: { tono: 'ok' | 'falta'; texto: string }) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [tipo, setTipo] = useState<'complementary' | 'substitutive'>('complementary')
  const [entendido, setEntendido] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const corto = motivo.trim().length < 10
  async function hacer() {
    setOcupado(true); setFallo(null)
    try { alHacer({ tono: 'ok', texto: await reabrir(declaracionId, motivo.trim(), tipo, quien) }) }
    catch (e) { setFallo(msg(e)) } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={`Reabrir para corregir el ${trimestre} de ${ejercicio}`} alCerrar={alCerrar}
      explicacion={<>La presentación del {dm(presentadaEl)} se queda como estaba. Lo que cambies irá en una nueva presentación.</>}
      acciones={<>
        <Boton onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" onClick={() => void hacer()} disabled={ocupado || corto || !entendido}>{ocupado ? 'Reabriendo…' : `Reabrir el ${trimestre}`}</Boton>
      </>}>
      <div className="s-trimestre-solo-una" data-prueba="solo-una-recibida">
        <p className="s-apoyo"><strong>¿Solo es una factura recibida?</strong> Se deduce en el {siguiente(trimestre)} sin reabrir: asiéntala como siempre y Sumied la lleva al primer día abierto.</p>
        <Boton onClick={() => alHacer({ tono: 'ok', texto: `Sin reabrir: la factura recibida se deduce en el ${siguiente(trimestre)}. El ${trimestre} se queda como estaba.` })}>Es solo una factura recibida</Boton>
      </div>
      <Campo etiqueta="Por qué se reabre" ayuda="Queda escrito en cada asiento que se cambie mientras esté reabierto." error={fallo}>
        {(p) => <Texto {...p} valor={motivo} alCambiar={setMotivo} placeholder="Ej.: una venta de septiembre que se quedó sin asentar" />}
      </Campo>
      <Campo etiqueta="La nueva presentación">
        {(p) => <Selector {...p} valor={tipo} alCambiar={(v) => setTipo(v === 'substitutive' ? 'substitutive' : 'complementary')}
          opciones={[{ valor: 'complementary', texto: 'Complementaria (suma o resta lo que faltó)' }, { valor: 'substitutive', texto: 'Sustitutiva (sustituye a la de antes)' }]} />}
      </Campo>
      <label className="s-trimestre-entendido"><input type="checkbox" checked={entendido} onChange={(e) => setEntendido(e.target.checked)} /> La presentación del {dm(presentadaEl)} se queda como estaba. Lo que cambie irá en una nueva presentación.</label>
    </Dialogo>
  )
}

const RESULTADOS = [
  { valor: 'to_pay', texto: 'A ingresar' }, { valor: 'to_refund', texto: 'A devolver' }, { valor: 'to_offset', texto: 'A compensar' },
  { valor: 'zero', texto: 'Cero' }, { valor: 'no_activity', texto: 'Sin actividad' },
]

function DialogoApuntar({ r, trimestre, ejercicio, quien, alCerrar, alHacer }: {
  r: Reapertura; trimestre: string; ejercicio: number; quien: string | null
  alCerrar: () => void; alHacer: (h: { tono: 'ok' | 'falta'; texto: string }) => void
}) {
  const [csv, setCsv] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 16))
  const [resultado, setResultado] = useState('to_pay')
  const [importe, setImporte] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function hacer() {
    setOcupado(true); setFallo(null)
    const n = Number(importe.replace(/\./g, '').replace(',', '.')) || 0
    try { alHacer({ tono: 'ok', texto: await apuntarNuevaPresentacion(r.id, csv.trim().toUpperCase(), new Date(fecha).toISOString(), resultado, n, quien) }) }
    catch (e) { setFallo(msg(e)) } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={`Apuntar la ${nuevaPresentacion({ tipo: r.tipo, secuencia: r.nueva.secuencia })} del ${trimestre} de ${ejercicio}`} alCerrar={alCerrar}
      explicacion="La que has presentado en la sede de Hacienda: con ella el trimestre vuelve a estar cerrado."
      acciones={<>
        <Boton onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" onClick={() => void hacer()} disabled={ocupado || csv.trim().length !== 16}>{ocupado ? 'Apuntando…' : 'Apuntarla'}</Boton>
      </>}>
      <Campo etiqueta="CSV de Hacienda" ayuda="16 letras y números, en el justificante." error={fallo}>
        {(p) => <Texto {...p} valor={csv} alCambiar={setCsv} maxLength={16} />}
      </Campo>
      <Campo etiqueta="Presentada el">{(p) => <Texto {...p} type="datetime-local" valor={fecha} alCambiar={setFecha} />}</Campo>
      <Campo etiqueta="Resultado">{(p) => <Selector {...p} valor={resultado} alCambiar={setResultado} opciones={RESULTADOS} />}</Campo>
      {resultado !== 'zero' && resultado !== 'no_activity' && (
        <Campo etiqueta="Importe">{(p) => <Texto {...p} inputMode="decimal" valor={importe} alCambiar={setImporte} />}</Campo>
      )}
    </Dialogo>
  )
}
