// src/modules/conta/libros/TraspasoADiez.tsx
//
// C12 (Julio, 24/10) · TRASPASAR EL MES A DIEZ, arriba de «Cerrar el mes». En
// vez de mandar cada asiento a Diez al validarlo, al cerrar el mes se traspasa
// todo de golpe. Un botón principal; el estado del mes en una frase
// (lib/traspaso.ts); lo que falta, en frases y con su enlace (se puede seguir
// igual, y queda apuntado); el resumen antes de traspasar; el avance; el
// cuadre con Diez («Cuadra» o qué cuenta difiere y por cuánto); y el informe
// para descargar. Confirmar, después de ver el resumen, vale como la
// autorización escrita de Julio para escribir en Diez real todo el mes: queda
// quién y cuándo (regla 8: cada paso dice en pantalla qué ha pasado).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaConta, CONTA, rutaLibroDiario, rutaLiquidaciones, rutaRecibidaEnAsientos } from '@/config/navegacion'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Guardado, Hueso } from '@/modules/conta/ui/piezas'
import { FiltroSelector } from '@/modules/conta/diseno/plantillas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { fraseDelCuadre, fraseDelMes, informe, mesTerminado, nombreDelMes, porTipo, queFalta, type FalloTraspaso, type Revision } from '@/modules/conta/lib/traspaso'
import { comprobarConDiez, confirmarTraspaso, leerTraspaso, revisarMes, traspasarTanda } from '@/modules/conta/services/traspasoService'

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '')
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A dónde se va a arreglar cada cosa que falta. */
function enlaceDe(codigo: string): string | null {
  switch (codigo) {
    case 'asientos': return rutaLibroDiario('revisar')
    case 'recibidas_sin_pdf': return rutaRecibidaEnAsientos()
    case 'cierres_en_espera': return rutaConta(CONTA.rutas.ventas)
    case 'liquidaciones_con_diferencia': return rutaLiquidaciones()
    default: return null
  }
}

function bajar(texto: string, fichero: string) {
  const url = URL.createObjectURL(new Blob(['﻿', texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = fichero
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function TraspasoADiez({ companyId, meses, cerrados, hoy, vuelta, alCambiar }: {
  companyId: string
  /** Los meses del ejercicio hasta hoy (AAAA-MM-01). */
  meses: readonly string[]
  /** Los meses cerrados (AAAA-MM-01). */
  cerrados: readonly string[]
  hoy: string
  vuelta: number
  /** Cuando el traspaso cierra el mes: la lista de meses se vuelve a leer. */
  alCambiar: () => void
}) {
  // El mes: el primero sin cerrar (el que toca); si todos lo están, el último.
  const porDefecto = useMemo(() => meses.find((m) => !cerrados.includes(m)) ?? meses[meses.length - 1] ?? hoy.slice(0, 7) + '-01', [meses, cerrados, hoy])
  // Lo que elige la persona; sin elegir, el que toca (y sigue al que toca si cambia, al cerrar uno).
  const [elegido, setMes] = useState<string | null>(null)
  const mes = elegido && meses.includes(elegido) ? elegido : porDefecto
  const [otra, setOtra] = useState(0)
  const r = useLeer(() => revisarMes(companyId, mes), `${companyId}:${mes}:${vuelta}:${otra}:traspaso`)
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fallos, setFallos] = useState<FalloTraspaso[] | null>(null)
  const recargar = () => setOtra((x) => x + 1)

  const nombre = nombreDelMes(mes)
  const d = r.datos

  /** Las tandas hasta que no queda nada, y después el cuadre. */
  async function traspasar() {
    setError(null); setHecho(null)
    try {
      let quedan = 1; let ultima: Awaited<ReturnType<typeof traspasarTanda>> | null = null
      while (quedan > 0) {
        ultima = await traspasarTanda(companyId, mes)
        quedan = ultima.quedan
        setOcupado(`Traspasando ${nombre}: ${ultima.llegaron_total.toLocaleString('es-ES')} de ${ultima.van.toLocaleString('es-ES')} en Diez${ultima.no_llegaron ? ` · ${ultima.no_llegaron} sin llegar` : ''}…`)
      }
      setFallos(ultima?.fallaron ?? [])
      setOcupado('Comprobando con Diez…')
      const c = await comprobarConDiez(companyId, mes)
      const llegados = ultima ? `${ultima.llegaron_total.toLocaleString('es-ES')} de ${ultima.van.toLocaleString('es-ES')} han llegado a Diez` : 'Nada que traspasar'
      setHecho(`${mayuscula(nombre)} traspasado: ${llegados}${ultima?.no_llegaron ? `; ${ultima.no_llegaron} no` : ''}. ${fraseDelCuadre(c.cuadre, c.cuadra, eurosExactos)} ${c.mes_cerrado ? `${mayuscula(nombre)} queda cerrado: lo que se corrija va al mes siguiente.` : (c.motivo ?? '')}`.trim())
      if (c.mes_cerrado) alCambiar()
    } catch (e) {
      setError(`El traspaso se ha parado: ${mensajeDe(e)}. Lo que ya llegó está en Diez; al volver a pulsar sigue por donde iba.`)
    } finally { setOcupado(null); recargar() }
  }

  async function confirmar() {
    setMes(mes) // al cerrarse, el que toca pasa al siguiente: el resultado se queda en este
    setOcupado('Confirmando…'); setError(null)
    try {
      await confirmarTraspaso(companyId, mes)
      setConfirmando(false)
      await traspasar()
    } catch (e) { setError(`No se ha confirmado el traspaso: ${mensajeDe(e)}`); setOcupado(null) }
  }

  async function volverAComprobar() {
    setOcupado('Comprobando con Diez…'); setError(null); setHecho(null)
    try {
      const c = await comprobarConDiez(companyId, mes)
      setHecho(`${fraseDelCuadre(c.cuadre, c.cuadra, eurosExactos)} ${c.mes_cerrado ? `${mayuscula(nombre)} queda cerrado.` : (c.motivo ?? '')}`.trim())
      if (c.mes_cerrado) alCambiar()
    } catch (e) { setError(`No se ha podido comprobar: ${mensajeDe(e)}`) } finally { setOcupado(null); recargar() }
  }

  async function descargar(rev: Revision) {
    try {
      const t = await leerTraspaso(companyId, mes)
      if (!t) { setError('Ese mes aún no tiene traspaso.'); return }
      bajar(informe(rev, t), `traspaso-diez-${mes.slice(0, 7)}.csv`)
    } catch (e) { setError(mensajeDe(e)) }
  }

  const t = d?.traspaso ?? null
  const terminado = mesTerminado(mes, hoy)
  const faltan = d ? queFalta(d.faltan) : []
  const tipos = d ? porTipo(d.por_tipo) : []
  // El botón principal: traspasar (o seguir) cuando el mes ha terminado y hay algo que mandar.
  const puedeEmpezar = !!d && d.conectado && terminado && d.van > 0 && t?.estado !== 'terminado'
  const sigue = t?.estado === 'traspasando'
  const verDetalle = fallos ?? (t?.estado === 'con_fallos' ? null : [])

  return (
    <section className="cx-tarjeta cxl-traspaso" aria-labelledby="cxl-traspaso-titulo">
      <div className="cxl-seccion">
        <h3 className="cxl-subtitulo" id="cxl-traspaso-titulo">Traspasar a Diez</h3>
        <FiltroSelector etiqueta="Mes que se traspasa" valor={mes} alCambiar={(m) => { setMes(m); setHecho(null); setError(null); setFallos(null) }}
          opciones={meses.map((m) => ({ valor: m, texto: `${nombreDelMes(m)} de ${m.slice(0, 4)}` }))} />
      </div>
      {r.error && <ErrorConReintento mensaje={r.error} reintentar={r.recargar} />}
      {!d && !r.error && <Hueso alto={60} />}
      {d && (
        <>
          <p className={`cxl-traspaso-frase ${t?.estado === 'terminado' && d.mes_cerrado ? 'cxl-verde' : faltan.length && terminado && !t ? 'cxl-ambar' : ''}`} data-testid="traspaso-frase">
            {d.conectado ? fraseDelMes(d, hoy) : 'Esta empresa no está conectada con Diez: no hay nada que traspasar.'}
          </p>

          {faltan.length > 0 && !(t?.estado === 'terminado') && (
            <ul className="cxl-lista-estado" aria-label="Lo que falta">
              {faltan.map((f) => {
                const a = enlaceDe(f.codigo)
                return (
                  <li key={f.codigo} className="cxl-mes">
                    <span className="cxl-mes-que"><span className="cxl-punto cxl-punto-ambar" aria-hidden="true" /><span>{f.texto}</span></span>
                    {a && <Link to={a} className="cx-enlace">Ir a verlo</Link>}
                  </li>
                )
              })}
            </ul>
          )}

          {d.conectado && (d.van > 0 || d.ya_en_diez > 0) && (
            <div className="cxl-traspaso-resumen" aria-label="Lo que va">
              <p className="cxl-apoyo">
                {d.van > 0 ? <>Van <strong>{d.van.toLocaleString('es-ES')}</strong> {d.van === 1 ? 'asiento' : 'asientos'}</> : 'No va nada más'}
                {d.ya_en_diez > 0 && <> · {d.ya_en_diez.toLocaleString('es-ES')} ya {d.ya_en_diez === 1 ? 'estaba' : 'estaban'} en Diez y no se vuelven a mandar</>}
                {d.no_viajan > 0 && <> · {d.no_viajan.toLocaleString('es-ES')} anulados antes de llegar a Diez no viajan (ni ellos ni su anulación)</>}
              </p>
              {tipos.length > 0 && (
                <ul className="cxl-traspaso-tipos">
                  {tipos.map((x) => <li key={x.tipo}><span>{x.nombre}</span><strong>{x.n.toLocaleString('es-ES')}</strong></li>)}
                </ul>
              )}
              {d.por_cuenta.length > 0 && (
                <details>
                  <summary>Totales por cuenta</summary>
                  <table className="cx-tabla cxl-traspaso-cuentas">
                    <thead><tr><th>Cuenta</th><th>Nombre</th><th className="cx-cifra">Debe</th><th className="cx-cifra">Haber</th></tr></thead>
                    <tbody>{d.por_cuenta.map((c) => <tr key={c.cuenta}><td>{c.cuenta}</td><td>{c.nombre}</td><td className="cx-cifra">{eurosExactos(Number(c.debe))}</td><td className="cx-cifra">{eurosExactos(Number(c.haber))}</td></tr>)}</tbody>
                  </table>
                </details>
              )}
            </div>
          )}

          {t && (t.estado === 'terminado' || t.estado === 'con_fallos') && (
            <p className={`cxl-traspaso-cuadre ${t.cuadra ? 'cxl-verde' : t.cuadra === false ? 'cxl-rojo' : ''}`} data-testid="traspaso-cuadre">
              {fraseDelCuadre(t.cuadre, t.cuadra, eurosExactos)}
            </p>
          )}
          {t && <p className="cxl-pie">Confirmado por {t.confirmado_por_nombre ?? 'alguien de la cuenta'} el {new Date(t.confirmado_en).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}{t.faltaba?.length ? ', con cosas pendientes' : ''}.</p>}

          <Guardado texto={ocupado ?? hecho} />
          {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
          {verDetalle && verDetalle.length > 0 && (
            <ul className="cxl-lista-estado" aria-label="Lo que no ha llegado">
              {verDetalle.map((f) => (
                <li key={f.entry_id} className="cxl-mes">
                  <span className="cxl-mes-que"><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /><span>{f.numero ? `Asiento ${f.numero}` : 'Un asiento'}: {f.motivo}</span></span>
                  <Link to={rutaAsiento(f.entry_id)} className="cx-enlace">Ver el asiento</Link>
                </li>
              ))}
            </ul>
          )}

          <div className="cxl-herramientas">
            {(puedeEmpezar || sigue) && (
              <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => (sigue ? void traspasar() : setConfirmando(true))}>
                {sigue ? `Seguir traspasando ${nombre}` : `Traspasar ${nombre} a Diez`}
              </button>
            )}
            {t?.estado === 'terminado' && !d.mes_cerrado && (
              <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => void volverAComprobar()}>Volver a comprobar con Diez</button>
            )}
            {t && <button type="button" className="cx-boton-sec" onClick={() => void descargar(d)}>Descargar el informe</button>}
          </div>
        </>
      )}

      {confirmando && d && (
        <Dialogo titulo={`Traspasar ${nombre} a Diez`} alCerrar={() => { if (!ocupado) setConfirmando(false) }}>
          <p>Van <strong>{d.van.toLocaleString('es-ES')}</strong> {d.van === 1 ? 'asiento' : 'asientos'} de {nombre}{tipos.length ? `: ${tipos.map((x) => `${x.nombre.toLowerCase()} ${x.n}`).join(', ')}` : ''}.</p>
          {faltan.length > 0 && (
            <div className="cxl-aviso-ambar" role="note">
              <p>Antes faltan cosas:</p>
              <ul>{faltan.map((f) => <li key={f.codigo}>{f.texto}</li>)}</ul>
              <p>Si traspasas igual, queda apuntado que faltaban. Lo que se arregle después va al mes siguiente.</p>
            </div>
          )}
          <p className="cxl-apoyo">Al confirmar, autorizas escribir en Diez todo lo de {nombre}: ventas, facturas recibidas, banco, asientos a mano y liquidaciones. Queda apuntado quién y cuándo. Si llega todo y cuadra, {nombre} se cierra.</p>
          {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
          <div className="cxl-herramientas">
            <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void confirmar()}>{ocupado ?? (faltan.length ? 'Traspasar igual' : 'Traspasar')}</button>
            <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
          </div>
        </Dialogo>
      )}
    </section>
  )
}
