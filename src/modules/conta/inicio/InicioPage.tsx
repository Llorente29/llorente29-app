// src/modules/conta/inicio/InicioPage.tsx
//
// C06 · El Inicio del producto vendido solo (maqueta aprobada «Estilo nuevo ·
// Inicio», docs/conta/maquetas/c06/Estilo.dc.html). Con las cifras que hoy se
// pueden calcular de verdad; lo que aún no existe no se enseña (encargo C06, 3):
//
//   · Cabecera: saludo con su nombre, el día y hasta qué mes está cerrada la
//     contabilidad (si hay alguno cerrado). El mes que se mira y «+ Añadir»
//     (subir una factura, un asiento a mano, un cliente o proveedor). Sin los
//     avatares de la maqueta: aún no hay «Personas y asesor» que decir quién entra.
//   · Cuatro tarjetas del libro: en el banco (572), te deben (43/44), debes
//     (40/41) y el IVA del trimestre (477 − 472), con sus seis meses en barritas.
//     Sin «se presenta el…»: no hay calendario de plazos en la serie.
//   · «Solo necesito que me digas esto»: las sugerencias abiertas de la IA (se
//     contestan aquí), los papeles de compras por mirar y los asientos por revisar.
//   · «Lo que he hecho yo desde ayer»: lo que hizo lo automático, contado del
//     libro y del registro. Sin «movimientos del banco casados» ni «cobros
//     reclamados»: aún no existen (Bancos es del frente B).
//   · «Cerrar <mes anterior>»: los pasos del cierre del mes, los del Libro diario.
//
// Sin empresa todavía, el Inicio no tiene nada que enseñar: lleva al alta
// conversada (N1b), que es donde aterriza el cliente la primera vez.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { rutaAltaEmpresa, rutaAjustes, rutaCompras, rutaLibroDiario, rutaLibros, rutaMayor, rutaNuevoAsiento, rutaTerceros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useCuentasMenu, refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { cargarIa, responderSugerencia } from '@/modules/conta/services/iaService'
import { hechoAlAceptar, type Sugerencia } from '@/modules/conta/ia/tipos'
import { subcuentasSinNombre } from '@/modules/conta/services/pasosDiezService'
import { ayerEnMadrid, cierreDelMes, hechoDesdeAyer, ivaDelTrimestre, ivaPorMes, proximoPago, puntosDeSaldo, type HechoDesdeAyer } from '@/modules/conta/services/inicioService'
import { diaMes, euros, eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  barras, cambio, diaDeHoy, dudas, frasePago, lineasIva, textoIva, horaEnMadrid, mesYAnio, mesesHasta, primerNombre, resumenDudas, saludo, type PuntoMes,
} from '@/modules/conta/lib/inicio'
import { mesAnterior, nombreMes, type CierreMes, type PasoCierre } from '@/modules/conta/lib/diario'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { PasosDiez } from '@/modules/conta/diez/PasosDiez'
import { usePasosDiez } from '@/modules/conta/diez/usePasosDiez'
import { verTarjetaDiez } from '@/modules/conta/lib/pasosDiez'
import { leerCierres } from '@/modules/conta/services/diarioService'

type Carga<T> = { estado: 'cargando' } | { estado: 'listo'; v: T } | { estado: 'fallo'; texto: string }

function useCarga<T>(f: (() => Promise<T>) | null, clave: string): [Carga<T>, () => void] {
  // El resultado se guarda con la clave (y la vuelta) que lo pidió: mientras no
  // llega el de la clave de ahora, está «cargando». Sin setState síncrono en el efecto.
  const [vuelta, setVuelta] = useState(0)
  const [r, setR] = useState<{ clave: string; c: Carga<T> } | null>(null)
  const actual = `${clave}#${vuelta}`
  useEffect(() => {
    if (!f) return
    let vivo = true
    f().then((v) => { if (vivo) setR({ clave: actual, c: { estado: 'listo', v } }) },
      (e: unknown) => { if (vivo) setR({ clave: actual, c: { estado: 'fallo', texto: e instanceof Error ? e.message : String(e) } }) })
    return () => { vivo = false }
    // f cambia con la clave: la clave manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual])
  return [r && r.clave === actual ? r.c : { estado: 'cargando' }, () => setVuelta((x) => x + 1)]
}

export default function InicioPage() {
  const { accountId, userName } = useCuentaConta()
  const { activa, empresas, cargando } = useEmpresas()
  const hoy = hoyEnMadrid()
  const mesActual = `${hoy.slice(0, 7)}-01`
  const [mes, setMes] = useState(mesActual)

  if (cargando) return <div className="cx-tarjeta"><Hueso ancho={220} /></div>
  if (!activa || empresas.length === 0) return <Navigate to={rutaAltaEmpresa()} replace />
  if (!accountId) return null

  return (
    <>
      <Cabecera nombre={primerNombre(userName)} hoy={hoy} mes={mes} mesActual={mesActual} alCambiarMes={setMes}
        accountId={accountId} companyId={activa.id} />
      {!activa.completa && (
        <div className="cx-aviso-alta" role="status" aria-label="Alta a medias">
          <span><b>Alta a medias</b> · {activa.razonSocial ?? 'empresa sin nombre todavía'}</span>
          <Link to={rutaAltaEmpresa()} className="cx-boton">Seguir</Link>
        </div>
      )}
      <Diez accountId={accountId} companyId={activa.id} quien={userName} />
      <Cifras accountId={accountId} companyId={activa.id} mes={mes} hoy={hoy} />
      <div className="cxi-cuerpo">
        <Dudas accountId={accountId} companyId={activa.id} />
        <div className="cxi-columna">
          <HechoYo companyId={activa.id} hoy={hoy} />
          <Cierre accountId={accountId} companyId={activa.id} mes={mesAnterior(mesActual)} />
        </div>
      </div>
    </>
  )
}

// ── Traer de Diez (C06, respuesta 3) ─────────────────────────────────────────

/**
 * Los cuatro pasos antes de traer de Diez, mientras falte alguno, para quien
 * viene de Diez (lo dijo en el alta) o ya tiene su base registrada
 * (verTarjetaDiez, C06 respuesta 4). Hecho todo, no se enseña.
 */
function Diez({ accountId, companyId, quien }: { accountId: string; companyId: string; quien: string | null }) {
  const [e, recargar] = usePasosDiez(accountId, companyId)
  if (e === null || e === 'fallo') return null
  if (!verTarjetaDiez(e.listo, e.programa)) return null
  return <PasosDiez accountId={accountId} companyId={companyId} quien={quien} estado={e} recargar={recargar} />
}

// ── Cabecera ────────────────────────────────────────────────────────────────

function Cabecera({ nombre, hoy, mes, mesActual, alCambiarMes, accountId, companyId }: {
  nombre: string | null; hoy: string; mes: string; mesActual: string; alCambiarMes: (m: string) => void; accountId: string; companyId: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [cierres] = useCarga<CierreMes[]>(() => leerCierres(accountId, companyId), `${accountId}|${companyId}`)
  const ultimoCerrado = cierres.estado === 'listo' ? [...cierres.v].map((c) => c.mes).sort().pop() ?? null : null
  const meses = useMemo(() => mesesHasta(mesActual, 12).reverse(), [mesActual])
  return (
    <header className="cxi-cabecera">
      <div className="cxi-titulos">
        <h1 className="cxi-titulo">{saludo(horaEnMadrid())}{nombre ? `, ${nombre}` : ''}</h1>
        <span className="cxi-subtitulo">
          {diaDeHoy(hoy)}.{ultimoCerrado ? ` Tu contabilidad está cerrada hasta ${nombreMes(ultimoCerrado)}.` : ''}
        </span>
      </div>
      <div className="cxi-acciones">
        <label className="cx-oculto" htmlFor="cxi-mes">Mes que miras</label>
        <select id="cxi-mes" className="cxi-mes" value={mes} onChange={(e) => alCambiarMes(e.target.value)}>
          {meses.map((m) => <option key={m} value={m}>{mesYAnio(m)}</option>)}
        </select>
        <button type="button" className="cx-boton" aria-expanded={abierto} aria-haspopup="menu" onClick={() => setAbierto((v) => !v)}>+ Añadir</button>
        {abierto && (
          <div className="cxi-anadir-menu" role="menu" aria-label="Añadir" onClick={() => setAbierto(false)}>
            <Link role="menuitem" to={`${rutaCompras()}?subir=1`}>Subir una factura</Link>
            <Link role="menuitem" to={rutaNuevoAsiento()}>Un asiento a mano</Link>
            <Link role="menuitem" to={rutaTerceros()}>Un cliente o un proveedor</Link>
          </div>
        )}
      </div>
    </header>
  )
}

// ── Las cuatro tarjetas ─────────────────────────────────────────────────────

function Cifras({ accountId, companyId, mes, hoy }: { accountId: string; companyId: string; mes: string; hoy: string }) {
  const [puntos, reintentar] = useCarga<(PuntoMes | null)[]>(() => puntosDeSaldo(companyId, mes, hoy), `${companyId}|${mes}|${hoy}`)
  const [iva] = useCarga(() => ivaDelTrimestre(accountId, companyId, mes, hoy), `${accountId}|${companyId}|${mes}|${hoy}`)
  const [pago] = useCarga(() => proximoPago(accountId, hoy), `${accountId}|${hoy}`)
  const [ivaMeses] = useCarga(() => ivaPorMes(accountId, companyId, mes, hoy), `${accountId}|${companyId}|${mes}|${hoy}|ivas`)

  if (puntos.estado === 'fallo') return <ErrorConReintento mensaje={puntos.texto} reintentar={reintentar} />
  if (puntos.estado === 'cargando') {
    return <div className="cxi-cifras" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="cxi-cifra"><Hueso ancho={140} /></div>)}</div>
  }
  const p = puntos.v
  const ult = p[p.length - 1]
  const ant = p.length > 1 ? p[p.length - 2] : null
  const serie = (k: 'banco' | 'teDeben' | 'debes') => p.map((x) => (x ? x[k] : null))
  const sinEjercicio = ult === null
  return (
    <div className="cxi-cifras">
      <Cifra etiqueta="En el banco" valor={ult ? euros(ult.banco) : '—'} ruta={rutaMayor('572')}
        apoyo={sinEjercicio ? 'sin ejercicio abierto en este mes' : cambio(ant?.banco ?? null, ult.banco, euros) ?? 'saldo del libro'}
        tono={ult && ant && ult.banco >= ant.banco ? 'verde' : undefined} barras={barras(serie('banco'))} />
      <Cifra etiqueta="Te deben" valor={ult ? euros(ult.teDeben) : '—'} ruta={rutaTerceros('clientes')}
        apoyo="clientes y deudores, del libro" barras={barras(serie('teDeben'))} />
      <Cifra etiqueta="Debes" valor={ult ? euros(ult.debes) : '—'} ruta={rutaTerceros('proveedores')}
        apoyo={pago.estado === 'listo' ? frasePago(pago.v, hoy, diaMes) ?? 'proveedores y acreedores' : 'proveedores y acreedores'}
        tono={pago.estado === 'listo' && pago.v !== null && pago.v < hoy ? 'ambar' : undefined} barras={barras(serie('debes'))} />
      <Cifra etiqueta="IVA del trimestre" valor={iva.estado === 'listo' ? euros(iva.v.aPagar) : iva.estado === 'fallo' ? '—' : '…'}
        ruta={rutaLibros('registro', 'expedidas')}
        apoyo={iva.estado === 'listo' ? textoIva(iva.v.trimestre, lineasIvaDe(iva.v)) : iva.estado === 'fallo' ? iva.texto : ' '}
        apoyoNodo={iva.estado === 'listo' ? (
          <span className="cxi-iva">
            {lineasIvaDe(iva.v).map((l) => (
              <span key={l.etiqueta} className="cxi-iva-linea">
                <span>{l.etiqueta}</span> <span className="cxi-cifra-mono">{l.importe}</span>{l.nota && <span className="cxi-iva-nota"> {l.nota}</span>}
              </span>
            ))}
          </span>
        ) : undefined}
        barras={ivaMeses.estado === 'listo' ? barras(ivaMeses.v) : []} ia />
    </div>
  )
}

/** M01 · Las tres líneas del IVA del trimestre, con los importes en euros con sus céntimos. */
const lineasIvaDe = (v: { repercutido: number; soportado: number }) => lineasIva(v.repercutido, v.soportado, eurosExactos)

function Cifra({ etiqueta, valor, apoyo, apoyoNodo, tono, barras: bs, ruta, ia = false }: {
  etiqueta: string; valor: string; apoyo: string; tono?: 'verde' | 'ambar'; barras: { alto: number; ultima: boolean }[]; ruta: string; ia?: boolean
  /** Lo mismo que `apoyo`, pintado (con cifras en mono); el lector oye `apoyo`. */
  apoyoNodo?: ReactNode
}) {
  return (
    <Link to={ruta} className="cxi-cifra" aria-label={`${etiqueta}: ${valor}. ${apoyo}`}>
      <span className="cxi-cifra-texto">
        <span className="cxi-cifra-etiqueta">{etiqueta}</span>
        <span className="cxi-cifra-valor">{valor}</span>
        <span className={`cxi-cifra-apoyo${tono ? ` cxi-cifra-apoyo-${tono}` : ''}`}>{apoyoNodo ?? apoyo}</span>
      </span>
      {bs.length > 0 && (
        <span className="cxi-barras" aria-hidden="true">
          {bs.map((b, i) => <span key={i} className={`cxi-barra${b.ultima ? (ia ? ' cxi-barra-ultima-ia' : ' cxi-barra-ultima') : ''}`} style={{ height: b.alto }} />)}
        </span>
      )}
    </Link>
  )
}

// ── «Solo necesito que me digas esto» ──────────────────────────────────────

function Dudas({ accountId, companyId }: { accountId: string; companyId: string }) {
  const cuentas = useCuentasMenu()
  const [sinNombre] = useCarga<number>(() => subcuentasSinNombre(accountId, companyId), `${accountId}|${companyId}`)
  const [ia, recargar] = useCarga<Sugerencia[]>(() => cargarIa(companyId).then((r) => r.sugerencias), companyId)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const sugerencias = ia.estado === 'listo' ? ia.v : []
  const lista = dudas(sugerencias, cuentas.compras ?? 0, cuentas.libros ?? 0, sinNombre.estado === 'listo' ? sinNombre.v : 0)

  async function responder(s: Sugerencia, acepta: boolean) {
    setOcupado(true); setHecho(null); setFallo(null)
    try {
      const anadidos = await responderSugerencia(s.id, acepta)
      setHecho(acepta ? hechoAlAceptar(s, anadidos) : 'Vale, no lo hago. No te lo vuelvo a proponer por lo mismo.')
      recargar(); refrescarCuentasMenu()
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally { setOcupado(false) }
  }

  return (
    <section className="cxi-seccion" aria-labelledby="cxi-dudas">
      <div className="cxi-seccion-cabeza">
        <h2 id="cxi-dudas" className="cxi-seccion-titulo">Solo necesito que me digas esto</h2>
        <span className="cxi-seccion-apoyo">{ia.estado === 'cargando' ? '…' : resumenDudas(lista.length)}</span>
      </div>
      {ia.estado === 'fallo' && <p className="cx-aviso" role="alert">{ia.texto}</p>}
      {ia.estado === 'listo' && lista.length === 0 && <p className="cxi-nada">Nada que decidir ahora. Si algo me hace dudar, te lo pregunto aquí.</p>}
      {lista.map((d) => {
        const s = sugerencias.find((x) => x.id === d.id)
        let acciones: ReactNode
        if (d.tipo === 'sugerencia' && s) {
          acciones = <>
            <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void responder(s, true)}>Sí, hazlo</button>
            <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => void responder(s, false)}>No, gracias</button>
          </>
        } else if (d.tipo === 'sinNombre') {
          acciones = <Link className="cx-boton" to={rutaAjustes('plan')}>Ponerles nombre</Link>
        } else if (d.tipo === 'compras') {
          acciones = <Link className="cx-boton" to={rutaCompras()}>Mirarlos</Link>
        } else {
          acciones = <Link className="cx-boton" to={rutaLibroDiario('revisar')}>Revisarlos</Link>
        }
        return (
          <div key={d.id} className="cxi-duda">
            <span className={`cxi-duda-inicial cxi-duda-inicial-${d.inicial.toLowerCase()}`} aria-hidden="true">{d.inicial}</span>
            <span className="cxi-duda-texto"><span className="cxi-duda-titulo">{d.titulo}</span><span className="cxi-duda-apoyo">{d.apoyo}</span></span>
            <span className="cxi-duda-acciones">{acciones}</span>
          </div>
        )
      })}
      {hecho && <p className="cx-guardado" role="status">{hecho}</p>}
      {fallo && <p className="cx-aviso" role="alert">No se ha guardado: {fallo}</p>}
    </section>
  )
}

// ── «Lo que he hecho yo desde ayer» ────────────────────────────────────────

function HechoYo({ companyId, hoy }: { companyId: string; hoy: string }) {
  const [h, reintentar] = useCarga<HechoDesdeAyer>(() => hechoDesdeAyer(companyId, ayerEnMadrid(hoy)), `${companyId}|${hoy}`)
  return (
    <section className="cxi-hecho" aria-labelledby="cxi-hecho">
      <div className="cxi-hecho-cabeza"><span className="cxi-hecho-punto" aria-hidden="true" /><h2 id="cxi-hecho" className="cxi-hecho-titulo">Lo que he hecho yo desde ayer</h2></div>
      {h.estado === 'cargando' && <Hueso ancho={200} />}
      {h.estado === 'fallo' && <ErrorConReintento mensaje={h.texto} reintentar={reintentar} />}
      {h.estado === 'listo' && (
        <div className="cxi-hecho-rejilla">
          <Dato n={h.v.asientosSolos} uno="asiento validado solo" varios="asientos validados solos" />
          <Dato n={h.v.asientosParaRevisar} uno="asiento propuesto para revisar" varios="asientos propuestos para revisar" />
          <Dato n={h.v.datosDeLaEmpresa} uno="dato de tu empresa puesto por mí" varios="datos de tu empresa puestos por mí" />
        </div>
      )}
      <Link className="cxi-hecho-enlace" to={rutaAjustes('folvy')}>Ver todo y deshacer lo que no te guste</Link>
    </section>
  )
}

function Dato({ n, uno, varios }: { n: number; uno: string; varios: string }) {
  return <div className="cxi-hecho-dato"><span className="cxi-hecho-numero">{n}</span><span className="cxi-hecho-texto">{n === 1 ? uno : varios}</span></div>
}

// ── «Cerrar <mes>» ─────────────────────────────────────────────────────────

function Cierre({ accountId, companyId, mes }: { accountId: string; companyId: string; mes: string }) {
  const [c, reintentar] = useCarga<{ pasos: PasoCierre[] }>(() => cierreDelMes(accountId, companyId, mes), `${accountId}|${companyId}|${mes}`)
  const hechos = c.estado === 'listo' ? c.v.pasos.filter((p) => p.hecho).length : 0
  const total = c.estado === 'listo' ? c.v.pasos.length : 0
  return (
    <section className="cxi-seccion cxi-cierre" aria-labelledby="cxi-cierre">
      <div className="cxi-seccion-cabeza" style={{ paddingBottom: 6 }}>
        <h2 id="cxi-cierre" className="cxi-seccion-titulo" style={{ fontSize: 18 }}>Cerrar {nombreMes(mes)}</h2>
        {c.estado === 'listo' && <span className="cx-cifra">{hechos} de {total}</span>}
      </div>
      {c.estado === 'cargando' && <Hueso ancho={200} />}
      {c.estado === 'fallo' && <ErrorConReintento mensaje={c.texto} reintentar={reintentar} />}
      {c.estado === 'listo' && (
        <>
          <div className="cxi-progreso" role="progressbar" aria-valuenow={Math.round((hechos / Math.max(total, 1)) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Cierre de ${nombreMes(mes)}`}>
            <div className="cxi-progreso-barra" style={{ width: `${(hechos / Math.max(total, 1)) * 100}%` }} />
          </div>
          {c.v.pasos.map((p) => (
            <div key={p.texto} className={`cxi-paso ${p.hecho ? 'cxi-paso-hecho' : 'cxi-paso-falta'}`}>
              <span className="cxi-paso-marca" aria-hidden="true">{p.hecho ? '✓' : ''}</span>
              <span className="cxi-paso-texto">{p.texto}</span>
            </div>
          ))}
          <Link className="cx-enlace" to={rutaLibroDiario()}>Ir al libro diario</Link>
        </>
      )}
    </section>
  )
}
