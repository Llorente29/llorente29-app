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
//
// S02 · PR 2 · Los tres con el encabezado del patrón (EncabezadoLibro: su
// nombre como título, una frase con lo que se ve, «Ver: … Cambiar») y las
// tablas con el estilo del patrón. Lo que antes eran botones al lado del
// título del mapeo (Historial, Volver todo al estándar) son blancos del
// encabezado; el estado (Balance / PyG) es la vista del patrón.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros, rutaMayor } from '@/config/navegacion'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { Boton, BotonEnlace } from '@/modules/conta/diseno'
import { ControlesInforme, VistaInforme } from '@/modules/conta/diseno/plantillas'
import { EncabezadoLibro } from '@/modules/conta/libros/EncabezadoLibro'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  calcularEstado, mapeoEfectivo, modeloPropuesto, puedeElegir,
  type Estado, type FilaMapeo, type LineaModelo, type Magnitudes, type Modelo,
} from '@/modules/conta/lib/cuentasAnuales'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import type { EjercicioLibros } from '@/modules/conta/services/librosService'
import {
  aSaldoCuenta, cambiarMapeo, elegirModelo, historialMapeo, leerLineas, leerMapeo, nombresPgc, planDeEmpresa, saldosCuentas, volverAlEstandar,
} from '@/modules/conta/services/librosService'
import { MARCA } from '../cuenta/marca'

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
      setHecho(`Modelo ${NOMBRE_MODELO[m].toLowerCase()} elegido para ${L.ejercicio.code}${m !== prop.modelo ? ` (${MARCA.nombre} proponía el ${NOMBRE_MODELO[prop.modelo].toLowerCase()})` : ''}. El balance y la PyG ya salen con él.`)
      L.recargar()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido guardar.') } finally { setOcupado(false) }
  }

  const encabezado = (
    <EncabezadoLibro titulo={`Cuentas anuales ${L.ejercicio.code}`}
      frase={`El modelo que le toca a la empresa en ${L.ejercicio.code}, con las cifras con las que se decide${elegido ? `: ${NOMBRE_MODELO[elegido].toLowerCase()}, elegido` : ''}.`} />
  )
  if (d.error) return <section className="cxl-pagina" aria-label="Cuentas anuales del ejercicio">{encabezado}<ErrorConReintento mensaje={d.error} reintentar={d.recargar} /></section>
  return (
    <section className="cxl-pagina" aria-label="Cuentas anuales del ejercicio">
      {encabezado}
      <Guardado texto={hecho} />
      {!prop && <div className="s-lista-cargando" aria-busy="true" aria-label="Cargando las cifras" />}
      {prop && d.datos && (
        <>
          <section className="cxl-ia" aria-label="Qué modelo te toca">
            <div className="cxl-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> El modelo que te toca</div>
            <div>{prop.frase}</div>
          </section>
          <div className="cxl-caja">
            <table className="cxl-tabla cxl-apilada" aria-label="Cifras con las que se decide">
              <thead><tr><th>Límite (dos de tres)</th><th className="cxl-der">{L.ejercicio.code}</th>{d.datos.anterior && <th className="cxl-der">{L.anterior!.code}</th>}<th className="cxl-der">Abreviado / pymes</th><th className="cxl-der">PyG abreviada</th></tr></thead>
              <tbody>
                <tr><td>Activo</td><td className="cxl-der" data-titulo={L.ejercicio.code}>{eurosExactos(d.datos.actual.activo)}</td>{d.datos.anterior && <td className="cxl-der" data-titulo={L.anterior?.code}>{eurosExactos(d.datos.anterior.activo)}</td>}<td className="cxl-der" data-titulo="Abreviado / pymes">4.000.000 €</td><td className="cxl-der" data-titulo="PyG abreviada">11.400.000 €</td></tr>
                <tr><td>Cifra de negocios</td><td className="cxl-der" data-titulo={L.ejercicio.code}>{eurosExactos(d.datos.actual.cifraNegocios)}</td>{d.datos.anterior && <td className="cxl-der" data-titulo={L.anterior?.code}>{eurosExactos(d.datos.anterior.cifraNegocios)}</td>}<td className="cxl-der" data-titulo="Abreviado / pymes">8.000.000 €</td><td className="cxl-der" data-titulo="PyG abreviada">22.800.000 €</td></tr>
                <tr><td>Plantilla media</td><td className="cxl-der" data-titulo={L.ejercicio.code}>{d.datos.actual.plantillaMedia}</td>{d.datos.anterior && <td className="cxl-der" data-titulo={L.anterior?.code}>{d.datos.anterior.plantillaMedia}</td>}<td className="cxl-der" data-titulo="Abreviado / pymes">50</td><td className="cxl-der" data-titulo="PyG abreviada">250</td></tr>
              </tbody>
            </table>
            <p className="cxl-pie cxl-caja-cabeza">LSC art. 257.1 (balance y ECPN abreviados, y RD 1515/2007 art. 2.1 para pymes) y art. 258.1 (PyG abreviada). {d.datos.anterior ? `Hace falta cumplir dos de los tres límites dos ejercicios seguidos: se miran ${L.ejercicio.code} y ${L.anterior!.code}.` : 'Hace falta cumplir dos de los tres límites dos ejercicios seguidos; como no hay un ejercicio anterior con el que comparar, basta este.'} Las cifras son las de hoy: al cierre se recalculan. {L.ejercicio.plantillaMedia === 0 && <>La plantilla media está a 0: ponla en <Link to={rutaLibros('cierre', 'ejercicios')}>Ejercicios</Link>.</>}</p>
          </div>
          <div className="cx-tarjeta">
            <h2 className="cxl-subtitulo">Modelo de {L.ejercicio.code}{elegido ? `: ${NOMBRE_MODELO[elegido].toLowerCase()}` : ' (sin elegir: se usa el propuesto)'}</h2>
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
            <h2 className="cxl-subtitulo">Los estados</h2>
            <ul>
              <li><Link to={rutaLibros('balances', 'balance')}>Balance de situación</Link></li>
              <li><Link to={rutaLibros('balances', 'pyg')}>Pérdidas y ganancias</Link>{prop.pygAbreviada && prop.modelo === 'normal' ? ' (puede ser abreviada)' : ''}</li>
              <li><Link to={rutaLibros('balances', 'ecpn')}>Cambios en el patrimonio neto</Link></li>
              <li><Link to={rutaLibros('anuales', 'mapeo')}>Qué cuentas alimentan cada línea</Link></li>
              {/* S01e: lo que hay y lo que no, sin prometer fechas. */}
              <li>Memoria: aún no se prepara aquí. Lo que ya está apuntado para ella (como «Otros resultados») sale en la barra de cada estado; el texto lo redacta tu asesoría.</li>
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

// ── Mapeo ───────────────────────────────────────────────────────────────────

// S01e: una sola acción por cuenta. El diálogo ofrece cambiarla de línea,
// dejarla fuera o (si el cambio es tuyo) volver al estándar: antes cada píldora
// repetía «cambiar · dejar fuera» y el código iba sin nombre.
type Accion = { prefijo: string; nombre: string | null; porSigno: 'deudor' | 'acreedor' | null; desde: string | null; propio: boolean } | null
const FUERA = '__fuera'
const textoSigno = (s: 'deudor' | 'acreedor' | null) => (s === 'deudor' ? 'si su saldo es deudor' : s === 'acreedor' ? 'si su saldo es acreedor' : null)

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
    // El nombre de cada código del mapeo, del cuadro de cuentas (si no se puede leer, el código va solo).
    const nombres = await nombresPgc(plan, [...mapeo.serie, ...mapeo.propio].map((m) => m.prefix)).catch(() => new Map<string, string>())
    return { modelo, lineas, mapeo, saldos, nombres }
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
  /** «624 · Transportes»: el código con su nombre del cuadro de cuentas, o de la cuenta de la empresa. */
  const nombreDe = (prefijo: string | null): string | null => (prefijo ? d.datos?.nombres.get(prefijo) ?? d.datos?.saldos.find((x) => x.code === prefijo)?.name ?? null : null)
  const conNombre = (prefijo: string | null) => (prefijo ? `${prefijo}${nombreDe(prefijo) ? ` · ${nombreDe(prefijo)}` : ''}` : 'todas')

  async function alEstandar(prefijo: string | null) {
    if (!d.datos) return
    try {
      const r = await volverAlEstandar(L.companyId, d.datos.modelo, estado, prefijo)
      setHecho(r.vueltas ? (prefijo ? `La ${conNombre(prefijo)} vuelve a su línea de serie (${r.quien}).` : `${r.vueltas} cambios tuyos deshechos: todo vuelve al estándar (${r.quien}).`) : 'No había nada que deshacer: ya estaba como el estándar.')
      L.recargar()
    } catch (e) { setHecho(e instanceof Error ? e.message : 'No se ha podido.') }
  }

  const encabezado = (
    <EncabezadoLibro titulo="Qué cuentas alimentan cada línea"
      frase={`${estado === 'pyg' ? 'Pérdidas y ganancias' : 'Balance'}${d.datos ? `, modelo ${NOMBRE_MODELO[d.datos.modelo].toLowerCase()}` : ''}: cada línea del modelo con las cuentas que la forman.`}
      secundarios={<>
        <Boton onClick={() => setVerHistorial(!verHistorial)} aria-expanded={verHistorial}>Historial</Boton>
        {calc && calc.propios.size > 0 && <Boton onClick={() => void alEstandar(null)}>Volver todo al estándar</Boton>}
      </>} />
  )
  if (d.error) return <section className="cxl-pagina" aria-label="Qué cuentas alimentan cada línea">{encabezado}<ErrorConReintento mensaje={d.error} reintentar={d.recargar} /></section>
  return (
    <section className="cxl-pagina" aria-label="Qué cuentas alimentan cada línea">
      {encabezado}
      <ControlesInforme>
        <VistaInforme etiqueta="Estado" vistas={[{ id: 'balance', nombre: 'Balance' }, { id: 'pyg', nombre: 'Pérdidas y ganancias' }] as const} actual={estado === 'pyg' ? 'pyg' : 'balance'} alCambiar={setEstado} />
      </ControlesInforme>
      <Guardado texto={hecho} />
      {d.datos && <p className="cxl-apoyo">Modelo {NOMBRE_MODELO[d.datos.modelo].toLowerCase()}. De serie, cada cuenta va donde dice el Plan General de Contabilidad. Toca una cuenta para cambiarla de línea, dejarla fuera o devolverla a su sitio de serie: un cambio tuyo vale para esta empresa y queda en el historial.</p>}

      {verHistorial && (
        <div className="cxl-caja">
          <h2 className="cxl-subtitulo cxl-caja-cabeza">Historial</h2>
          {h.error && <ErrorConReintento mensaje={h.error} reintentar={h.recargar} />}
          {!h.datos && !h.error && <Hueso alto={32} />}
          {h.datos && !h.datos.length && <p className="cxl-pie">Sin cambios: todo está como el estándar.</p>}
          {h.datos && h.datos.length > 0 && (
            <table className="cxl-tabla cxl-apilada" aria-label="Historial del mapeo">
              <thead><tr><th>Cuándo</th><th>Quién</th><th>Cuenta</th><th>Qué</th><th>Motivo</th></tr></thead>
              <tbody>{h.datos.map((x, i) => <tr key={i}><td>{ddmm(x.cuando.slice(0, 10))}</td><td data-titulo="Quién">{x.quien ?? '—'}</td><td data-titulo="Cuenta">{conNombre(x.prefijo)}</td>
                <td data-titulo="Qué">{x.accion === 'estandar' ? `vuelve al estándar (estaba en ${x.de ?? '—'})` : x.accion === 'deja_fuera' ? `fuera del modelo (estaba en ${x.de ?? '—'})` : `de ${x.de ?? '—'} a ${x.a}`} · {x.estado} {x.modelo}</td><td data-titulo="Motivo">{x.motivo ?? ''}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}

      {!calc && <div className="s-lista-cargando" aria-busy="true" aria-label="Cargando el mapeo" />}
      {calc && (calc.r.sinSitio.length > 0 || calc.r.porDefecto.length > 0) && (
        <div className="cx-tarjeta">
          <h2 className="cxl-subtitulo">Por revisar</h2>
          <ul className="cxl-lista-estado">
            {calc.r.sinSitio.map((s) => (
              <li key={s.code}><span><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /> <Link to={rutaMayor(s.code)}>{s.code} {s.name}</Link> · {eurosExactos(s.saldo)} · <strong>sin sitio en el modelo</strong></span>
                <button type="button" className="cx-boton-sec" onClick={() => setAccion({ prefijo: s.templateCode ?? s.code, nombre: nombreDe(s.templateCode ?? s.code) ?? s.name, porSigno: null, desde: null, propio: false })}>Colocar</button></li>
            ))}
            {calc.r.porDefecto.map((c) => (
              <li key={c.code}><span><span className="cxl-punto cxl-punto-ambar" aria-hidden="true" /> <Link to={rutaMayor(c.code)}>{c.code} {c.name}</Link> · {eurosExactos(c.importe)} · colocada por defecto</span>
                <button type="button" className="cx-boton-sec" onClick={() => setAccion({ prefijo: c.templateCode ?? c.code, nombre: nombreDe(c.templateCode ?? c.code) ?? c.name, porSigno: null, desde: null, propio: false })}>Completar</button></li>
            ))}
          </ul>
        </div>
      )}
      {calc && calc.fuera.length > 0 && (
        <div className="cx-tarjeta">
          <h2 className="cxl-subtitulo">Fuera del modelo (por decisión tuya)</h2>
          <ul>{calc.fuera.map((m) => <li key={`${m.prefix}${m.byBalance ?? ''}`}>{conNombre(m.prefix)}{m.byBalance ? ` (${textoSigno(m.byBalance)})` : ''}{m.note ? ` · ${m.note}` : ''} <button type="button" className="cx-enlace" onClick={() => void alEstandar(m.prefix)}>Volver al estándar</button></li>)}</ul>
          <p className="cxl-pie">Una cuenta fuera con saldo deja de salir en los estados: el agente lo vigila cada noche.</p>
        </div>
      )}
      {calc && d.datos && (
        <div className="cxl-caja">
          <table className="cxl-tabla cxl-apilada" aria-label="Líneas y sus cuentas">
            <thead><tr><th>Línea</th><th>Cuentas que la alimentan</th><th className="cxl-der">Importe</th></tr></thead>
            <tbody>
              {calc.r.lineas.filter((l) => !l.isTotal).map((l) => {
                const ms = calc.porLinea.get(l.code) ?? []
                return (
                  <tr key={l.code} title={l.legalRef}>
                    <td className={`cxl-n${Math.min(l.level, 4)}`}>{l.text}{l.toCreate && <> <Chip tono="ambar">a crear</Chip></>}</td>
                    <td>{ms.length > 0 && <ul className="cxl-mapeo-cuentas">{ms.map((m) => {
                      const propio = calc.propios.has(`${m.prefix}|${m.byBalance ?? ''}`)
                      const nombre = nombreDe(m.prefix)
                      const signo = textoSigno(m.byBalance)
                      return (
                        <li key={`${m.prefix}${m.byBalance ?? ''}`}>
                          <button type="button" className="cxl-mapeo-cuenta" aria-label={`Cambiar la ${m.prefix}${nombre ? ` (${nombre})` : ''}`}
                            onClick={() => setAccion({ prefijo: m.prefix, nombre, porSigno: m.byBalance, desde: l.code, propio })}>
                            <span className="cxl-mapeo-codigo">{m.sign === 'resta' ? '−' : ''}{m.prefix}</span>
                            {nombre && <span>{nombre}</span>}
                            {signo && <span className="cxl-mapeo-marca">{signo}</span>}
                            {m.sign === 'resta' && <span className="cxl-mapeo-marca">resta</span>}
                            {propio ? <span className="cxl-mapeo-marca">· tuyo</span> : m.origin === 'defecto' ? <span className="cxl-mapeo-marca">· por defecto</span> : null}
                          </button>
                        </li>
                      )
                    })}</ul>}</td>
                    <td className="cxl-der" data-titulo="Importe">{l.oculta ? '—' : eurosExactos(l.importe)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {accion && d.datos && (
        <CambiarLinea accion={accion} lineas={d.datos.lineas} textoLinea={textoLinea} alCerrar={() => setAccion(null)}
          alEstandar={async () => { setAccion(null); await alEstandar(accion.prefijo) }}
          guardar={async (linea, motivo) => {
            const r = await cambiarMapeo(L.companyId, d.datos!.modelo, estado, accion.prefijo, linea, accion.porSigno, motivo)
            setAccion(null)
            const cuenta = `${accion.prefijo}${accion.nombre ? ` (${accion.nombre})` : ''}`
            setHecho(linea === null
              ? `La ${cuenta} queda fuera del modelo (estaba en «${textoLinea(r.de)}»). Con saldo, el agente lo avisará. Lo hizo ${r.quien}.`
              : `La ${cuenta} pasa de «${textoLinea(r.de)}» a «${textoLinea(r.a)}». Ya sale así en el ${estado === 'pyg' ? 'resultado' : 'balance'}. Lo hizo ${r.quien}.`)
            L.recargar()
          }} />
      )}
    </section>
  )
}

function CambiarLinea({ accion, lineas, textoLinea, alCerrar, alEstandar, guardar }: {
  accion: NonNullable<Accion>; lineas: LineaModelo[]; textoLinea: (c: string | null) => string; alCerrar: () => void
  alEstandar: () => Promise<void>; guardar: (linea: string | null, motivo: string | null) => Promise<void>
}) {
  const [linea, setLinea] = useState(accion.desde ?? '')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const fuera = linea === FUERA
  const cuenta = `${accion.prefijo}${accion.nombre ? ` · ${accion.nombre}` : ''}`
  async function ok() {
    if (!linea) { setError('Elige la línea.'); return }
    if (fuera && !motivo.trim()) { setError('Di por qué la dejas fuera: queda en el historial.'); return }
    setOcupado(true); setError(null)
    try { await guardar(fuera ? null : linea, motivo.trim() || null) } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido.') } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={`¿Dónde va la ${cuenta}?`} alCerrar={alCerrar}>
      {accion.desde && <p className="cxl-apoyo">Ahora está en «{textoLinea(accion.desde)}»{textoSigno(accion.porSigno) ? `, ${textoSigno(accion.porSigno)}` : ''}.</p>}
      <label>Línea<select className="cx-input" value={linea} onChange={(e) => setLinea(e.target.value)}>
        <option value="">Elige…</option>
        {lineas.filter((l) => !l.isTotal).map((l) => <option key={l.code} value={l.code}>{'  '.repeat(Math.max(0, l.level - 1))}{l.text}</option>)}
        <option value={FUERA}>Fuera del modelo (no sale en ninguna línea)</option>
      </select></label>
      <label>Motivo{fuera ? '' : ' (opcional)'}<input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
      {fuera && <p className="cxl-apoyo">Una cuenta fuera no sale en ninguna línea. Si tiene saldo, el balance deja de reflejarlo: úsalo solo para cuentas que no deben presentarse.</p>}
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton" onClick={() => void ok()} disabled={ocupado}>{ocupado ? 'Guardando…' : fuera ? 'Dejar fuera' : 'Cambiar'}</button>
        {accion.propio && <button type="button" className="cx-boton-sec" onClick={() => void alEstandar()} disabled={ocupado}>Volver al estándar</button>}
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </Dialogo>
  )
}

// ── Lo del C05b ─────────────────────────────────────────────────────────────

// S01e: lo que hay y lo que no, sin prometer («Próximamente» no decía nada).
const C05B = {
  memoria: { titulo: 'Memoria y certificación', texto: 'La memoria y la certificación de aprobación de cuentas no se preparan aquí: las redacta tu asesoría. Lo que ya está apuntado para la memoria (como «Otros resultados») sale en la barra de cada estado.' },
  legalizacion: { titulo: 'Legalización de libros', texto: 'Los libros en el formato del Registro Mercantil (Legalia) no se generan aquí. El diario, el mayor y los balances sí se bajan en PDF y Excel.' },
  deposito: { titulo: 'Depósito de cuentas', texto: 'Los modelos oficiales del depósito no se rellenan aquí. El balance, la cuenta de pérdidas y ganancias y el patrimonio neto, con los modelos oficiales del Plan General, sí.' },
} as const

export function PendienteC05b({ que }: { que: keyof typeof C05B }) {
  const x = C05B[que]
  return (
    <section className="cxl-pagina" aria-label={x.titulo}>
      <EncabezadoLibro titulo={x.titulo} frase="Esto aún no se hace aquí: lo que sí hay, abajo." />
      <div className="cxl-caja cxl-c05b"><Vacio titulo="Esto aún no se hace aquí." explicacion={x.texto} accion={<BotonEnlace a={rutaLibros('balances', 'balance')}>Ir a Balances</BotonEnlace>} /></div>
    </section>
  )
}
