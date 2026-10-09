// src/modules/conta/libros/Cierre.tsx
//
// C05 · Cierre (regla 7).
//   · Ejercicios: cada ejercicio con su estado (abierto, preparado, cerrado,
//     traído), su modelo y cuántas veces se reabrió.
//   · Cerrar el mes: los meses del ejercicio, cerrados (quién y por qué) o
//     abiertos, con Cerrar y Reabrir (con motivo). Las mismas funciones que el
//     libro diario (C04): aquí solo están a mano.
//   · Regularización, cierre y apertura: Folvy calcula los tres asientos
//     (src/modules/conta/lib/cierre.ts), los PROPONE como cualquier otro
//     asiento (se validan en el libro diario) y los enlaza al ejercicio; luego
//     «Cerrar el ejercicio». Reabrir pide motivo y anula apertura y cierre con
//     contraasiento. Un ejercicio TRAÍDO se enseña tal cual: no se recalcula.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario, rutaLibros, rutaTuEmpresa } from '@/config/navegacion'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { prepararCierre, sumas, type AsientoCierre, type SaldoACerrar } from '@/modules/conta/lib/cierre'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { cerrarMes, leerCierres, reabrirMes } from '@/modules/conta/services/diarioService'
import { cerrarEjercicio, cuenta129, prepararCierreEnBase, reabrirEjercicio, saldosCuentas, type EjercicioLibros } from '@/modules/conta/services/librosService'

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '')

function estadoEjercicio(e: EjercicioLibros): { texto: string; tono: 'neutro' | 'ambar' | 'azul' } {
  if (e.origen === 'migrated') return { texto: 'traído', tono: 'neutro' }
  if (e.estado === 'closed') return { texto: 'cerrado', tono: 'azul' }
  if (e.cierre?.estado === 'preparado') return { texto: 'cierre preparado', tono: 'ambar' }
  return { texto: 'abierto', tono: 'neutro' }
}

// ── Ejercicios ──────────────────────────────────────────────────────────────

export function Ejercicios() {
  const L = useLibros()
  return (
    <section className="cxl-pagina" aria-label="Ejercicios">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Cierre' }]} /><h2>Ejercicios</h2></div>
        <div className="cxl-herramientas"><Link to={rutaTuEmpresa()} className="cx-boton-sec">Abrir un ejercicio o cambiar su plantilla</Link></div>
      </div>
      <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
        <table className="cxl-tabla" aria-label="Ejercicios de la empresa">
          <thead><tr><th>Ejercicio</th><th>Fechas</th><th>Estado</th><th>Modelo</th><th className="cxl-der">Plantilla media</th><th /></tr></thead>
          <tbody>{L.ejercicios.map((e) => {
            const s = estadoEjercicio(e)
            return (
              <tr key={e.id}><td><strong>{e.code}</strong>{e.id === L.ejercicio.id && <> <Chip tono="azul">el que miras</Chip></>}</td>
                <td>{ddmm(e.inicio)} – {ddmm(e.fin)}</td>
                <td><Chip tono={s.tono}>{s.texto}</Chip>{e.traidoHasta ? <span className="cxl-apoyo"> · traído hasta {ddmm(e.traidoHasta)}</span> : null}{e.cierre && e.cierre.reaperturas > 0 ? <span className="cxl-apoyo"> · reabierto {e.cierre.reaperturas} {e.cierre.reaperturas === 1 ? 'vez' : 'veces'}</span> : null}</td>
                <td>{e.modelo ? e.modelo.elegido : <span className="cxl-apoyo">sin elegir</span>}</td>
                <td className="cxl-der">{e.plantillaMedia}</td>
                <td>{e.origen !== 'migrated' && <Link to={rutaLibros('cierre', 'cierre-ejercicio')} className="cx-enlace">{e.estado === 'closed' ? 'Ver el cierre' : 'Cerrar'}</Link>}</td></tr>
            )
          })}</tbody>
        </table>
        <p className="cxl-pie">Un ejercicio traído de otro programa se enseña tal cual, con su cierre de allí: Folvy no lo recalcula ni lo reabre.</p>
      </div>
    </section>
  )
}

// ── Cerrar el mes ───────────────────────────────────────────────────────────

export function CerrarMes() {
  const L = useLibros()
  const [hecho, setHecho] = useState<string | null>(null)
  const [reabriendo, setReabriendo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const d = useLeer(() => leerCierres(L.accountId, L.companyId), `${L.companyId}:${L.vuelta}`)
  const meses = useMemo(() => {
    const r: string[] = []
    let y = Number(L.ejercicio.inicio.slice(0, 4)); let m = Number(L.ejercicio.inicio.slice(5, 7))
    const hoy = new Date().toISOString().slice(0, 7)
    for (;;) {
      const k = `${y}-${String(m).padStart(2, '0')}`
      if (`${k}-01` > L.ejercicio.fin || k > hoy) break
      r.push(`${k}-01`)
      m++; if (m > 12) { m = 1; y++ }
    }
    return r
  }, [L.ejercicio])

  async function cerrar(mes: string) {
    setOcupado(mes); setHecho(null)
    try { await cerrarMes(L.companyId, mes); setHecho(`${nombreMes(mes)} cerrado: ya no entra ningún asiento con fecha de ese mes. Lo que llegue tarde va al primer día abierto.`); d.recargar() }
    catch (e) { setHecho(`No se ha cerrado ${nombreMes(mes)}: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Cerrar el mes">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Cierre' }]} /><h2>Cerrar el mes</h2></div>
        <div className="cxl-herramientas"><Link to={rutaLibroDiario()} className="cx-boton-sec">Lo que falta, en el libro diario</Link></div>
      </div>
      <Guardado texto={hecho} />
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && (
        <div className="cx-tarjeta">
          <ul className="cxl-lista-estado">
            {meses.map((mes) => {
              const c = d.datos!.find((x) => x.mes === mes)
              return (
                <li key={mes}>
                  <span className={`cxl-punto ${c ? 'cxl-punto-verde' : 'cxl-punto-ambar'}`} aria-hidden="true" /> <strong>{nombreMes(mes)}</strong>
                  {c ? <> · cerrado{c.tipo === 'tax_filed' ? ' (impuesto presentado)' : c.tipo === 'migrated' ? ' (traído)' : ''}{c.quien ? ` por ${c.quien}` : ''}
                    {c.tipo === 'manual' && <> <button type="button" className="cx-enlace" onClick={() => setReabriendo(mes)}>Reabrir</button></>}</>
                    : <> · abierto <button type="button" className="cx-boton-sec" disabled={ocupado === mes} onClick={() => void cerrar(mes)}>{ocupado === mes ? 'Cerrando…' : 'Cerrar'}</button></>}
                </li>
              )
            })}
          </ul>
          <p className="cxl-pie">Cerrar un mes impide asientos con fecha en él (regla 9 del libro). Un mes cerrado por un impuesto presentado o traído no se reabre desde aquí.</p>
        </div>
      )}
      {reabriendo && (
        <ConMotivo titulo={`Reabrir ${nombreMes(reabriendo)}`} explicacion="Vuelven a entrar asientos con fecha de ese mes. Queda apuntado quién y por qué." boton="Reabrir"
          alCerrar={() => setReabriendo(null)}
          hacer={async (motivo) => { await reabrirMes(L.companyId, reabriendo, motivo); setHecho(`${nombreMes(reabriendo)} reabierto. Motivo: «${motivo}».`); setReabriendo(null); d.recargar() }} />
      )}
    </section>
  )
}

function ConMotivo({ titulo, explicacion, boton, alCerrar, hacer }: { titulo: string; explicacion: string; boton: string; alCerrar: () => void; hacer: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function ok() {
    if (!motivo.trim()) { setError('Hace falta el motivo.'); return }
    setOcupado(true); setError(null)
    try { await hacer(motivo.trim()) } catch (e) { setError(mensajeDe(e)) } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar}>
      <p className="cxl-apoyo">{explicacion}</p>
      <label>Motivo<input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton" onClick={() => void ok()} disabled={ocupado}>{ocupado ? 'Un momento…' : boton}</button>
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </Dialogo>
  )
}

// ── Regularización, cierre y apertura ───────────────────────────────────────

export function CierreEjercicio() {
  const L = useLibros()
  const e = L.ejercicio
  const siguiente = L.ejercicios.find((x) => x.anteriorId === e.id) ?? L.ejercicios.find((x) => x.inicio > e.fin) ?? null
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [reabrir, setReabrir] = useState(false)
  const traido = e.origen === 'migrated'

  const d = useLeer(traido ? null : async () => {
    const [saldos, c129] = await Promise.all([saldosCuentas(L.companyId, e.inicio, e.fin, true), cuenta129(L.accountId, L.companyId)])
    const lista: SaldoACerrar[] = saldos.map((s) => ({
      code: s.code, name: s.name, templateCode: s.templateCode, locationId: s.locationId, brandId: s.brandId,
      // Todo lo del ejercicio salvo el cierre. La regularización SÍ entra: si ya hay una validada (al reabrir se
      // queda), las 6 y 7 están a cero y no se regulariza otra vez.
      debe: s.inicialDebe + s.aperturaDebe + s.periodoDebe + s.regularizacionDebe,
      haber: s.inicialHaber + s.aperturaHaber + s.periodoHaber + s.regularizacionHaber,
    }))
    return { lista, c129 }
  }, `${L.companyId}:${e.id}:${L.vuelta}`)

  const plan = useMemo(() => {
    if (!d.datos || !d.datos.c129 || !siguiente) return null
    try {
      return { ok: prepararCierre(d.datos.lista, { cuenta129: d.datos.c129, finEjercicio: e.fin, inicioSiguiente: siguiente.inicio, ejercicio: e.code, siguiente: siguiente.code }), error: null }
    } catch (x) { return { ok: null, error: mensajeDe(x) } }
  }, [d.datos, e, siguiente])

  // Una regularización ya enlazada se reutiliza; si aún quedan 6 o 7 con saldo, no se apila otra encima.
  const regEnlazada = e.cierre?.regularizacion ?? null
  const regDoble = !!(regEnlazada && plan?.ok?.regularizacion)

  async function preparar() {
    if (!plan?.ok || regDoble) return
    setOcupado(true); setError(null); setHecho(null)
    try {
      await prepararCierreEnBase(L.companyId, e.id, [plan.ok.regularizacion, plan.ok.cierre, plan.ok.apertura], L.quien, regEnlazada)
      const n = [plan.ok.regularizacion, plan.ok.cierre, plan.ok.apertura].filter(Boolean).length
      setHecho(`Propuestos ${n} asientos (${[plan.ok.regularizacion && 'regularización', plan.ok.cierre && 'cierre', plan.ok.apertura && `apertura de ${siguiente!.code}`].filter(Boolean).join(', ')}). ${plan.ok.regularizacion ? `Resultado ${eurosExactos(plan.ok.resultado)} a la ${d.datos!.c129}.` : 'La regularización ya estaba hecha: se mantiene.'} Valídalos en el libro diario y vuelve para cerrar.`)
      L.recargar()
    } catch (x) { setError(mensajeDe(x)) } finally { setOcupado(false) }
  }
  async function cerrar() {
    setOcupado(true); setError(null); setHecho(null)
    try { const r = await cerrarEjercicio(e.id); setHecho(`Ejercicio ${r.ejercicio} cerrado por ${r.quien}. Ya no entra ningún asiento con fecha en él.`); L.recargar() }
    catch (x) { setError(mensajeDe(x)) } finally { setOcupado(false) }
  }

  return (
    <section className="cxl-pagina" aria-label="Regularización, cierre y apertura">
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Cierre' }]} /><h2>Cierre del ejercicio {e.code}</h2></div></div>
      <Guardado texto={hecho} />
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
      {traido && <div className="cx-tarjeta"><Vacio titulo={`El ejercicio ${e.code} es traído.`} explicacion="Se enseña tal cual vino, con su cierre de allí. Folvy no lo recalcula ni lo reabre." /></div>}
      {!traido && d.error && <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />}
      {!traido && !d.datos && !d.error && <div className="cx-tarjeta" aria-busy="true">{[0, 1].map((i) => <Hueso key={i} alto={48} />)}</div>}
      {!traido && d.datos && (
        <>
          <div className="cx-tarjeta">
            <ol className="cxl-lista-estado">
              <li><span className={`cxl-punto ${e.cierre ? 'cxl-punto-verde' : 'cxl-punto-ambar'}`} aria-hidden="true" /> Preparar los tres asientos{e.cierre ? ` · preparados${e.cierre.estado === 'cerrado' ? ' y validados' : ''}` : ''}</li>
              <li><span className={`cxl-punto ${e.cierre?.estado === 'cerrado' ? 'cxl-punto-verde' : 'cxl-punto-ambar'}`} aria-hidden="true" /> Validarlos en el libro diario {e.cierre && <>({[e.cierre.regularizacion, e.cierre.cierre, e.cierre.apertura].map((id, i) => id ? <Link key={id} to={rutaAsiento(id)} className="cx-enlace">{['regularización', 'cierre', 'apertura'][i]} </Link> : null)})</>}</li>
              <li><span className={`cxl-punto ${e.estado === 'closed' ? 'cxl-punto-verde' : 'cxl-punto-ambar'}`} aria-hidden="true" /> Cerrar el ejercicio{e.estado === 'closed' ? ' · cerrado' : ''}</li>
            </ol>
          </div>
          {!d.datos.c129 && <p className="cxl-sin-sitio" role="alert">La empresa no tiene la cuenta 129 (Resultado del ejercicio) en su plan: hace falta para regularizar. Actívala en el plan contable.</p>}
          {!siguiente && <p className="cxl-sin-sitio" role="alert">Aún no existe el ejercicio siguiente: la apertura va en él. Ábrelo en <Link to={rutaTuEmpresa()}>Tu empresa › Ejercicio</Link>.</p>}
          {plan?.error && <p className="cxl-sin-sitio" role="alert">{plan.error}</p>}
          {plan?.ok && e.estado !== 'closed' && (
            <div className="cx-tarjeta">
              <h3 className="cxl-subtitulo">Lo que Folvy propone</h3>
              {plan.ok.regularizacion
                ? <p>Resultado del ejercicio: <strong>{eurosExactos(plan.ok.resultado)}</strong> ({plan.ok.resultado >= 0 ? 'beneficio' : 'pérdida'}), a la {d.datos.c129}.</p>
                : <p>La regularización ya está validada: gastos e ingresos están a cero y el resultado está en la {d.datos.c129}.</p>}
              {regDoble && <p className="cxl-sin-sitio" role="alert">Ya hay una regularización enlazada y aún quedan gastos o ingresos con saldo: o está sin validar (valídala en el libro diario) o hay apuntes posteriores (anúlala allí y prepara otra vez). No se apila una segunda.</p>}
              {[plan.ok.regularizacion, plan.ok.cierre, plan.ok.apertura].map((a) => a && <ResumenAsiento key={a.tipo} a={a} />)}
              {e.cierre?.estado === 'preparado' && <p className="cxl-apoyo">Ya están preparados. Prepararlos otra vez propone tres nuevos y enlaza esos: descarta antes los anteriores en el libro diario.</p>}
              <div className="cxl-herramientas">
                <button type="button" className={e.cierre ? 'cx-boton-sec' : 'cx-boton'} onClick={() => void preparar()} disabled={ocupado || regDoble}>{ocupado ? 'Un momento…' : e.cierre ? 'Preparar otra vez' : 'Preparar el cierre'}</button>
                {e.cierre?.estado === 'preparado' && <button type="button" className="cx-boton" onClick={() => void cerrar()} disabled={ocupado}>Cerrar el ejercicio</button>}
              </div>
            </div>
          )}
          {e.estado === 'closed' && (
            <div className="cx-tarjeta">
              <p>El ejercicio {e.code} está cerrado. Reabrirlo anula la apertura y el cierre con contraasiento; la regularización se queda y se rehace al volver a cerrar.</p>
              <button type="button" className="cx-boton-sec" onClick={() => setReabrir(true)}>Reabrir el ejercicio</button>
            </div>
          )}
        </>
      )}
      {reabrir && (
        <ConMotivo titulo={`Reabrir el ejercicio ${e.code}`} explicacion="Solo un administrador. Se anulan la apertura y el cierre con su contraasiento, y queda apuntado quién y por qué." boton="Reabrir"
          alCerrar={() => setReabrir(false)}
          hacer={async (motivo) => { const r = await reabrirEjercicio(e.id, motivo); setReabrir(false); setHecho(`Ejercicio ${r.ejercicio} reabierto por ${r.quien}; ${r.anulados.length} asientos anulados con contraasiento. Motivo: «${motivo}».`); L.recargar() }} />
      )}
    </section>
  )
}

function ResumenAsiento({ a }: { a: AsientoCierre }) {
  const s = sumas(a)
  return (
    <details>
      <summary>{a.concepto} · {ddmm(a.fecha)} · {a.apuntes.length} apuntes · {eurosExactos(s.debe)} {s.cuadra ? '✓ cuadra' : '✗ no cuadra'}</summary>
      <table className="cxl-tabla" aria-label={a.concepto}>
        <thead><tr><th>Cuenta</th><th className="cxl-der">Debe</th><th className="cxl-der">Haber</th></tr></thead>
        <tbody>{a.apuntes.map((p, i) => <tr key={i}><td>{p.cuenta}</td><td className="cxl-der">{p.debe ? eurosExactos(p.debe) : ''}</td><td className="cxl-der">{p.haber ? eurosExactos(p.haber) : ''}</td></tr>)}</tbody>
      </table>
    </details>
  )
}
