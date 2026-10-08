// src/modules/conta/libros/Anuales.tsx
//
// C05 · Cuentas anuales y Registro.
//   · CuentasAnuales: el modelo que le toca a la empresa (regla 4), con las
//     cifras con las que se decide (activo, cifra de negocios, plantilla media;
//     este ejercicio y el anterior) y la elección, que puede ser más completa,
//     nunca menos (LSC 257.1 y 258.1). Debajo, enlaces a los estados.
//   · Mapeo: «Qué cuentas alimentan cada línea». Arriba lo pendiente (cuentas
//     con saldo sin sitio, o colocadas por defecto). Por cada línea, sus
//     prefijos (de serie o tuyos) con Cambiar de línea, Dejar fuera y Volver
//     al estándar; abajo el historial. Cada cambio confirma con contenido
//     (regla 8): de qué línea a qué línea y quién.
//   · PendienteC05b: memoria, legalización y depósito, que van en el C05b.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros, rutaMayor } from '@/config/navegacion'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  calcularEstado, mapeoEfectivo, modeloPropuesto, puedeElegir,
  type Estado, type FilaMapeo, type LineaModelo, type Magnitudes, type Modelo,
} from '@/modules/conta/lib/cuentasAnuales'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import type { EjercicioLibros } from '@/modules/conta/services/librosService'
import {
  aSaldoCuenta, cambiarMapeo, elegirModelo, historialMapeo, leerLineas, leerMapeo, planDeEmpresa, saldosCuentas, volverAlEstandar,
} from '@/modules/conta/services/librosService'

const NOMBRE_MODELO: Record<Modelo, string> = { normal: 'Normal', abreviado: 'Abreviado', pymes: 'Pymes' }
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

/** Activo total y cifra de negocios de un ejercicio, con el modelo dado. */
async function magnitudesDe(companyId: string, modelo: Modelo, e: EjercicioLibros): Promise<Magnitudes> {
  const [lb, mb, lp, mp, saldos] = await Promise.all([
    leerLineas(modelo, 'balance'), leerMapeo(companyId, modelo, 'balance'), leerLineas(modelo, 'pyg'), leerMapeo(companyId, modelo, 'pyg'),
    saldosCuentas(companyId, e.inicio, e.fin),
  ])
  const bal = calcularEstado('balance', lb, mapeoEfectivo(mb.serie, mb.propio), saldos.map((s) => aSaldoCuenta(s, 'balance')))
  const pyg = calcularEstado('pyg', lp, mapeoEfectivo(mp.serie, mp.propio), saldos.map((s) => aSaldoCuenta(s, 'pyg')))
  const total = bal.lineas.find((l) => l.code === 'ACT.TOTAL')
  const activo = total ? total.importe : bal.lineas.filter((l) => l.side === 'activo' && l.level === 1 && !l.isTotal).reduce((a, l) => a + l.importe, 0)
  return { activo, cifraNegocios: pyg.lineas.find((l) => l.code === '1')?.importe ?? 0, plantillaMedia: e.plantillaMedia }
}

export function CuentasAnuales() {
  const L = useLibros()
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const d = useLeer(async () => {
    const plan = await planDeEmpresa(L.accountId, L.companyId)
    const base: Modelo = plan === 'pymes' ? 'pymes' : 'abreviado'
    const [actual, anterior] = await Promise.all([magnitudesDe(L.companyId, base, L.ejercicio), L.anterior ? magnitudesDe(L.companyId, base, L.anterior) : Promise.resolve(null)])
    return { plan, actual, anterior }
  }, `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)

  const prop = useMemo(() => {
    if (!d.datos) return null
    const p = modeloPropuesto(d.datos.actual, d.datos.anterior)
    // Con el plan general no hay modelo de pymes: le toca el abreviado.
    if (d.datos.plan === 'general' && p.modelo === 'pymes') return { ...p, modelo: 'abreviado' as Modelo, permitidos: p.permitidos.filter((m) => m !== 'pymes') }
    return p
  }, [d.datos])
  const elegido = L.ejercicio.modelo?.elegido ?? null

  async function elegir(m: Modelo) {
    if (!prop || !d.datos) return
    if (!puedeElegir(prop, m)) { setError(`No puedes elegir el modelo ${NOMBRE_MODELO[m].toLowerCase()}: por tus cifras te corresponde el ${NOMBRE_MODELO[prop.modelo].toLowerCase()} o uno más completo.`); return }
    setOcupado(true); setError(null)
    try {
      await elegirModelo(L.accountId, L.companyId, L.ejercicio.id, m, prop.modelo, { actual: d.datos.actual, anterior: d.datos.anterior, plan: d.datos.plan }, L.quien)
      setHecho(`Modelo ${NOMBRE_MODELO[m].toLowerCase()} elegido para ${L.ejercicio.code}${m !== prop.modelo ? ` (Folvy proponía el ${NOMBRE_MODELO[prop.modelo].toLowerCase()})` : ''}. El balance y la PyG ya salen con él.`)
      L.recargar()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido guardar.') } finally { setOcupado(false) }
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Cuentas anuales del ejercicio">
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Cuentas anuales y Registro' }]} /><h2>Cuentas anuales {L.ejercicio.code}</h2></div></div>
      <Guardado texto={hecho} />
      {!prop && <div className="cx-tarjeta" aria-busy="true">{[0, 1].map((i) => <Hueso key={i} alto={48} />)}</div>}
      {prop && d.datos && (
        <>
          <section className="cxl-ia" aria-label="Qué modelo te toca">
            <div className="cxl-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> El modelo que te toca</div>
            <div>{prop.frase}</div>
          </section>
          <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
            <table className="cxl-tabla" aria-label="Cifras con las que se decide">
              <thead><tr><th>Límite (dos de tres)</th><th className="cxl-der">{L.ejercicio.code}</th>{d.datos.anterior && <th className="cxl-der">{L.anterior!.code}</th>}<th className="cxl-der">Abreviado / pymes</th><th className="cxl-der">PyG abreviada</th></tr></thead>
              <tbody>
                <tr><td>Activo</td><td className="cxl-der">{eurosExactos(d.datos.actual.activo)}</td>{d.datos.anterior && <td className="cxl-der">{eurosExactos(d.datos.anterior.activo)}</td>}<td className="cxl-der">4.000.000 €</td><td className="cxl-der">11.400.000 €</td></tr>
                <tr><td>Cifra de negocios</td><td className="cxl-der">{eurosExactos(d.datos.actual.cifraNegocios)}</td>{d.datos.anterior && <td className="cxl-der">{eurosExactos(d.datos.anterior.cifraNegocios)}</td>}<td className="cxl-der">8.000.000 €</td><td className="cxl-der">22.800.000 €</td></tr>
                <tr><td>Plantilla media</td><td className="cxl-der">{d.datos.actual.plantillaMedia}</td>{d.datos.anterior && <td className="cxl-der">{d.datos.anterior.plantillaMedia}</td>}<td className="cxl-der">50</td><td className="cxl-der">250</td></tr>
              </tbody>
            </table>
            <p className="cxl-pie">LSC art. 257.1 (balance y ECPN abreviados, y RD 1515/2007 art. 2.1 para pymes) y art. 258.1 (PyG abreviada). Hace falta cumplir dos de los tres límites dos ejercicios seguidos; en el primero, basta ese. Las cifras son las de hoy: al cierre se recalculan. {L.ejercicio.plantillaMedia === 0 && <>La plantilla media está a 0: ponla en <Link to={rutaLibros('cierre', 'ejercicios')}>Ejercicios</Link>.</>}</p>
          </div>
          <div className="cx-tarjeta">
            <h3 className="cxl-titulo">Modelo de {L.ejercicio.code}{elegido ? `: ${NOMBRE_MODELO[elegido].toLowerCase()}` : ' (sin elegir: se usa el propuesto)'}</h3>
            {L.ejercicio.modelo?.quien && <p className="cxl-apoyo">Lo eligió {L.ejercicio.modelo.quien}.</p>}
            <div className="cxl-segmento" role="group" aria-label="Elegir el modelo">
              {(['pymes', 'abreviado', 'normal'] as Modelo[]).filter((m) => d.datos!.plan === 'pymes' || m !== 'pymes').map((m) => (
                <button key={m} type="button" aria-pressed={(elegido ?? prop.modelo) === m} disabled={ocupado || !prop.permitidos.includes(m)}
                  title={prop.permitidos.includes(m) ? undefined : 'Por tus cifras no te corresponde'} onClick={() => void elegir(m)}>
                  {NOMBRE_MODELO[m]}{m === prop.modelo ? ' · propuesto' : ''}
                </button>
              ))}
            </div>
            {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
          </div>
          <div className="cx-tarjeta">
            <h3 className="cxl-titulo">Los estados</h3>
            <ul>
              <li><Link to={rutaLibros('balances', 'balance')}>Balance de situación</Link></li>
              <li><Link to={rutaLibros('balances', 'pyg')}>Pérdidas y ganancias</Link>{prop.pygAbreviada && prop.modelo === 'normal' ? ' (puede ser abreviada)' : ''}</li>
              <li><Link to={rutaLibros('balances', 'ecpn')}>Cambios en el patrimonio neto</Link></li>
              <li><Link to={rutaLibros('anuales', 'mapeo')}>Qué cuentas alimentan cada línea</Link></li>
              <li>Memoria: en el C05b.</li>
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

// ── Mapeo ───────────────────────────────────────────────────────────────────

type Accion = { tipo: 'cambiar' | 'fuera'; prefijo: string; porSigno: 'deudor' | 'acreedor' | null; desde: string | null } | null

export function Mapeo() {
  const L = useLibros()
  const [estado, setEstado] = useState<Estado>('balance')
  const [hecho, setHecho] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const d = useLeer(async () => {
    const plan = await planDeEmpresa(L.accountId, L.companyId)
    const modelo: Modelo = L.ejercicio.modelo?.elegido ?? (plan === 'pymes' ? 'pymes' : 'abreviado')
    const [lineas, mapeo, saldos] = await Promise.all([leerLineas(modelo, estado), leerMapeo(L.companyId, modelo, estado), saldosCuentas(L.companyId, L.ejercicio.inicio, L.ejercicio.fin)])
    return { modelo, lineas, mapeo, saldos }
  }, `${L.companyId}:${L.ejercicio.id}:${estado}:${L.vuelta}`)
  const h = useLeer(verHistorial ? () => historialMapeo(L.accountId, L.companyId) : null, `${L.companyId}:${verHistorial}:${L.vuelta}`)

  const calc = useMemo(() => {
    if (!d.datos) return null
    const ef = mapeoEfectivo(d.datos.mapeo.serie, d.datos.mapeo.propio)
    const r = calcularEstado(estado, d.datos.lineas, ef, d.datos.saldos.map((s) => aSaldoCuenta(s, estado === 'pyg' ? 'pyg' : 'balance')))
    const porLinea = new Map<string, FilaMapeo[]>()
    for (const m of ef) if (!m.excluded) porLinea.set(m.lineCode, [...(porLinea.get(m.lineCode) ?? []), m])
    const fuera = d.datos.mapeo.propio.filter((m) => m.excluded)
    return { r, porLinea, fuera, propios: new Set(d.datos.mapeo.propio.map((m) => `${m.prefix}|${m.byBalance ?? ''}`)) }
  }, [d.datos, estado])
  const textoLinea = (code: string | null) => (code ? d.datos?.lineas.find((l) => l.code === code)?.text ?? code : 'fuera del modelo')

  async function alEstandar(prefijo: string | null) {
    if (!d.datos) return
    try {
      const r = await volverAlEstandar(L.companyId, d.datos.modelo, estado, prefijo)
      setHecho(r.vueltas ? (prefijo ? `La ${prefijo} vuelve a su línea de serie (${r.quien}).` : `${r.vueltas} cambios tuyos deshechos: todo vuelve al estándar (${r.quien}).`) : 'No había nada que deshacer: ya estaba como el estándar.')
      L.recargar()
    } catch (e) { setHecho(e instanceof Error ? e.message : 'No se ha podido.') }
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Qué cuentas alimentan cada línea">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Cuentas anuales y Registro' }]} /><h2>Qué cuentas alimentan cada línea</h2></div>
        <div className="cxl-herramientas">
          <div className="cxl-segmento" role="group" aria-label="Estado">
            <button type="button" aria-pressed={estado === 'balance'} onClick={() => setEstado('balance')}>Balance</button>
            <button type="button" aria-pressed={estado === 'pyg'} onClick={() => setEstado('pyg')}>Pérdidas y ganancias</button>
          </div>
          <button type="button" className="cx-boton-sec" onClick={() => setVerHistorial(!verHistorial)} aria-expanded={verHistorial}>Historial</button>
          {calc && calc.propios.size > 0 && <button type="button" className="cx-boton-sec" onClick={() => void alEstandar(null)}>Volver todo al estándar</button>}
        </div>
      </div>
      <Guardado texto={hecho} />
      {d.datos && <p className="cxl-apoyo">Modelo {NOMBRE_MODELO[d.datos.modelo].toLowerCase()}. De serie, cada cuenta va donde dice el PGC (texto consolidado del BOE). Un cambio tuyo vale para esta empresa y queda en el historial.</p>}

      {verHistorial && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <h3 className="cxl-titulo">Historial</h3>
          {h.error && <ErrorConReintento mensaje={h.error} reintentar={h.recargar} />}
          {!h.datos && !h.error && <Hueso alto={32} />}
          {h.datos && !h.datos.length && <p className="cxl-pie">Sin cambios: todo está como el estándar.</p>}
          {h.datos && h.datos.length > 0 && (
            <table className="cxl-tabla" aria-label="Historial del mapeo">
              <thead><tr><th>Cuándo</th><th>Quién</th><th>Cuenta</th><th>Qué</th><th>Motivo</th></tr></thead>
              <tbody>{h.datos.map((x, i) => <tr key={i}><td>{ddmm(x.cuando.slice(0, 10))}</td><td>{x.quien ?? '—'}</td><td>{x.prefijo ?? 'todas'}</td>
                <td>{x.accion === 'estandar' ? `vuelve al estándar (estaba en ${x.de ?? '—'})` : x.accion === 'deja_fuera' ? `fuera del modelo (estaba en ${x.de ?? '—'})` : `de ${x.de ?? '—'} a ${x.a}`} · {x.estado} {x.modelo}</td><td>{x.motivo ?? ''}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}

      {!calc && <div className="cx-tarjeta" aria-busy="true">{[0, 1, 2].map((i) => <Hueso key={i} alto={36} />)}</div>}
      {calc && (calc.r.sinSitio.length > 0 || calc.r.porDefecto.length > 0) && (
        <div className="cx-tarjeta">
          <h3 className="cxl-titulo">Por revisar</h3>
          <ul className="cxl-lista-estado">
            {calc.r.sinSitio.map((s) => (
              <li key={s.code}><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /> <Link to={rutaMayor(s.code)}>{s.code} {s.name}</Link> · {eurosExactos(s.saldo)} · <strong>sin sitio en el modelo</strong>
                {' '}<button type="button" className="cx-enlace" onClick={() => setAccion({ tipo: 'cambiar', prefijo: s.templateCode ?? s.code, porSigno: null, desde: null })}>Colocar</button></li>
            ))}
            {calc.r.porDefecto.map((c) => (
              <li key={c.code}><span className="cxl-punto cxl-punto-ambar" aria-hidden="true" /> <Link to={rutaMayor(c.code)}>{c.code} {c.name}</Link> · {eurosExactos(c.importe)} · colocada por defecto
                {' '}<button type="button" className="cx-enlace" onClick={() => setAccion({ tipo: 'cambiar', prefijo: c.templateCode ?? c.code, porSigno: null, desde: null })}>Completar</button></li>
            ))}
          </ul>
        </div>
      )}
      {calc && calc.fuera.length > 0 && (
        <div className="cx-tarjeta">
          <h3 className="cxl-titulo">Fuera del modelo (por decisión tuya)</h3>
          <ul>{calc.fuera.map((m) => <li key={`${m.prefix}${m.byBalance ?? ''}`}>{m.prefix}{m.byBalance ? ` (saldo ${m.byBalance})` : ''}{m.note ? ` · ${m.note}` : ''} <button type="button" className="cx-enlace" onClick={() => void alEstandar(m.prefix)}>Volver al estándar</button></li>)}</ul>
          <p className="cxl-pie">Una cuenta fuera con saldo deja de salir en los estados: el agente lo vigila cada noche.</p>
        </div>
      )}
      {calc && d.datos && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <table className="cxl-tabla" aria-label="Líneas y sus cuentas">
            <thead><tr><th>Línea</th><th>Cuentas que la alimentan</th><th className="cxl-der">Importe</th></tr></thead>
            <tbody>
              {calc.r.lineas.filter((l) => !l.isTotal).map((l) => {
                const ms = calc.porLinea.get(l.code) ?? []
                return (
                  <tr key={l.code} title={l.legalRef}>
                    <td className={`cxl-n${Math.min(l.level, 4)}`}>{l.text}{l.toCreate && <> <Chip tono="ambar">a crear</Chip></>}</td>
                    <td>{ms.map((m) => {
                      const propio = calc.propios.has(`${m.prefix}|${m.byBalance ?? ''}`)
                      return (
                        <span key={`${m.prefix}${m.byBalance ?? ''}`} className="cx-pildora" style={{ marginRight: 4 }}>
                          {m.sign === 'resta' ? '−' : ''}{m.prefix}{m.byBalance ? (m.byBalance === 'deudor' ? ' (D)' : ' (H)') : ''}{propio ? ' · tuyo' : m.origin === 'defecto' ? ' · por defecto' : ''}
                          {' '}<button type="button" className="cx-enlace" aria-label={`Cambiar la ${m.prefix} de línea`} onClick={() => setAccion({ tipo: 'cambiar', prefijo: m.prefix, porSigno: m.byBalance, desde: l.code })}>cambiar</button>
                          {' '}<button type="button" className="cx-enlace" aria-label={`Dejar fuera la ${m.prefix}`} onClick={() => setAccion({ tipo: 'fuera', prefijo: m.prefix, porSigno: m.byBalance, desde: l.code })}>dejar fuera</button>
                          {propio && <>{' '}<button type="button" className="cx-enlace" onClick={() => void alEstandar(m.prefix)}>estándar</button></>}
                        </span>
                      )
                    })}</td>
                    <td className="cxl-der">{l.oculta ? '—' : eurosExactos(l.importe)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {accion && d.datos && (
        <CambiarLinea accion={accion} lineas={d.datos.lineas} textoLinea={textoLinea} alCerrar={() => setAccion(null)}
          guardar={async (linea, motivo) => {
            const r = await cambiarMapeo(L.companyId, d.datos!.modelo, estado, accion.prefijo, linea, accion.porSigno, motivo)
            setAccion(null)
            setHecho(linea === null
              ? `La ${accion.prefijo} queda fuera del modelo (estaba en «${textoLinea(r.de)}»). Con saldo, el agente lo avisará. Lo hizo ${r.quien}.`
              : `La ${accion.prefijo} pasa de «${textoLinea(r.de)}» a «${textoLinea(r.a)}». Ya sale así en el ${estado === 'pyg' ? 'resultado' : 'balance'}. Lo hizo ${r.quien}.`)
            L.recargar()
          }} />
      )}
    </section>
  )
}

function CambiarLinea({ accion, lineas, textoLinea, alCerrar, guardar }: {
  accion: NonNullable<Accion>; lineas: LineaModelo[]; textoLinea: (c: string | null) => string; alCerrar: () => void; guardar: (linea: string | null, motivo: string | null) => Promise<void>
}) {
  const [linea, setLinea] = useState(accion.desde ?? '')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const fuera = accion.tipo === 'fuera'
  async function ok() {
    if (!fuera && !linea) { setError('Elige la línea.'); return }
    if (fuera && !motivo.trim()) { setError('Di por qué la dejas fuera: queda en el historial.'); return }
    setOcupado(true); setError(null)
    try { await guardar(fuera ? null : linea, motivo.trim() || null) } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido.') } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={fuera ? `Dejar fuera la ${accion.prefijo}` : `¿A qué línea va la ${accion.prefijo}?`} alCerrar={alCerrar}>
      {accion.desde && <p className="cxl-apoyo">Ahora está en «{textoLinea(accion.desde)}».</p>}
      {!fuera && (
        <label>Línea<select className="cx-input" value={linea} onChange={(e) => setLinea(e.target.value)}>
          <option value="">Elige…</option>
          {lineas.filter((l) => !l.isTotal).map((l) => <option key={l.code} value={l.code}>{'  '.repeat(Math.max(0, l.level - 1))}{l.text}</option>)}
        </select></label>
      )}
      <label>Motivo{fuera ? '' : ' (opcional)'}<input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
      {fuera && <p className="cxl-apoyo">Una cuenta fuera no sale en ninguna línea. Si tiene saldo, el balance deja de reflejarlo: úsalo solo para cuentas que no deben presentarse.</p>}
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton" onClick={() => void ok()} disabled={ocupado}>{ocupado ? 'Guardando…' : fuera ? 'Dejar fuera' : 'Cambiar'}</button>
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </Dialogo>
  )
}

// ── Lo del C05b ─────────────────────────────────────────────────────────────

const C05B = {
  memoria: { titulo: 'Memoria y certificación', texto: 'La memoria (con lo que la IA ya ha apuntado, como «Otros resultados») y la certificación de aprobación de cuentas.' },
  legalizacion: { titulo: 'Legalización de libros', texto: 'El diario y el de inventarios y cuentas anuales en el formato del Registro Mercantil (Legalia), con su huella.' },
  deposito: { titulo: 'Depósito de cuentas', texto: 'Los modelos del Registro (Orden JUS/616/2022) casilla a casilla, cruzados con cada línea del balance y de la PyG.' },
} as const

export function PendienteC05b({ que }: { que: keyof typeof C05B }) {
  const x = C05B[que]
  return (
    <section className="cxl-pagina" aria-label={x.titulo}>
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Cuentas anuales y Registro' }]} /><h2>{x.titulo}</h2></div></div>
      <div className="cx-tarjeta cxl-c05b"><Vacio titulo="Llega en la siguiente entrega (C05b)." explicacion={`${x.texto} Mientras tanto, el balance y la PyG ya salen en PDF y Excel desde Balances.`} accion={<Link to={rutaLibros('balances', 'balance')} className="cx-boton-sec">Ir a Balances</Link>} /></div>
    </section>
  )
}
