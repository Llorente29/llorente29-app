// src/modules/conta/bancos/SubirExtracto.tsx
//
// B01 · «Subir extracto», el gesto único (respuesta 3, punto 2): un fichero,
// las cuentas que traiga. Se suelta aquí o en cualquier pantalla de Bancos (o
// se elige con el botón); se lee y se cuadra EN el navegador, y se enseña
// «He leído…» con cada cuenta del fichero y el banco de Folvy al que va (por
// su IBAN, o por el que se recordó la vez anterior). Lo que no se sabe se
// pregunta, y la respuesta se recuerda (bank_account_iban). Un fichero que no
// cuadra no entra, y dice por qué. Al importar, Folvy concilia lo nuevo y lo
// dice con cifras (regla 8).
// S01d: si una cuenta del fichero no es de ningún banco (o aún no hay
// ninguno), «Nuevo banco con este IBAN (…)» lo da de alta aquí mismo, con el
// IBAN puesto, y la deja elegida para subirla. Sin volver a Cuentas y extractos.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { DialogoBancoNuevo } from '@/modules/conta/bancos/DialogoBancoNuevo'
import { ibanSinBanco, textoNuevoConIban } from '@/modules/conta/bancos/bancoNuevo'
import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { ibanLegible } from '@/modules/conta/lib/bancosVista'
import type { Cuadre, ExtractoLeido } from '@/modules/conta/lib/extractoBanco'
import { abrirExtracto, bancos as nucleo, emparejar, leerYCuadrar, type ExtractoAbierto, type ResultadoConciliar, type ResultadoImportar } from '@/modules/conta/services/bancosService'
import { pasarAgente, recordarIban } from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useBancos } from '@/modules/conta/bancos/contexto'

type Paso =
  | { que: 'elegir' }
  | { que: 'leyendo'; nombre: string }
  | { que: 'leido'; a: ExtractoAbierto; e: ExtractoLeido; cuadre: Cuadre; resumen: string }
  | { que: 'importando'; nombre: string }
  | { que: 'hecho'; nombre: string; importados: ResultadoImportar[]; conciliado: ResultadoConciliar | null; avisoConciliar: string | null }

const NO_SUBIR = '-'

export function SubirExtracto() {
  const ctx = useBancos()
  const { accountId, companyId, datos, hoy, recargar } = ctx
  const [paso, setPaso] = useState<Paso>({ que: 'elegir' })
  const [error, setError] = useState<string | null>(null)
  const [asignacion, setAsignacion] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  // S01d · La cuenta del fichero para la que se está dando de alta un banco nuevo, y lo que se dijo al hacerlo.
  const [nuevoPara, setNuevoPara] = useState<number | null>(null)
  const [dadoDeAlta, setDadoDeAlta] = useState<string | null>(null)
  const nombreBanco = (id: string) => datos.bancos.find((b) => b.id === id)?.nombre ?? 'el banco'

  const leer = async (f: File) => {
    setError(null); setDadoDeAlta(null); setPaso({ que: 'leyendo', nombre: f.name })
    try {
      const a = await abrirExtracto(f)
      const { extracto, cuadre, resumen } = leerYCuadrar(a)
      setAsignacion(emparejar(extracto, datos.bancos).map((x) => x ?? ''))
      setPaso({ que: 'leido', a, e: extracto, cuadre, resumen })
    } catch (e) {
      setError(`No he podido leer «${f.name}»: ${e instanceof Error ? e.message : String(e)}`)
      setPaso({ que: 'elegir' })
    }
  }

  // El fichero soltado (aquí o en otra pantalla de Bancos) llega por el contexto, y se toma una vez.
  useEffect(() => {
    if (!ctx.archivo) return
    const f = ctx.tomarArchivo()
    if (f) void Promise.resolve().then(() => leer(f))
  }, [ctx.archivo]) // eslint-disable-line react-hooks/exhaustive-deps

  const importar = async (p: Extract<Paso, { que: 'leido' }>) => {
    setError(null); setPaso({ que: 'importando', nombre: p.a.nombre })
    try {
      // Lo que la persona dice hoy se recuerda: la próxima vez ese IBAN va solo a su banco.
      const recordados: Record<string, string[]> = Object.fromEntries(datos.bancos.map((b) => [b.id, [...b.ibanes]]))
      for (const [i, c] of p.e.cuentas.entries()) {
        const b = datos.bancos.find((x) => x.id === asignacion[i])
        if (b && c.iban && c.iban !== b.iban && !b.ibanes.includes(c.iban)) { await recordarIban(b.id, c.iban); recordados[b.id].push(c.iban) }
      }
      const asig = asignacion.map((x) => (x && x !== NO_SUBIR ? x : null))
      const importados = await nucleo.importar(p.a, p.e, p.cuadre, asig, 'fichero', recordados)
      let conciliado: ResultadoConciliar | null = null
      let avisoConciliar: string | null = null
      // El agente «Conciliación» pasa después de cada extracto, y la pasada queda registrada con su resumen (tarea 6).
      try { conciliado = (await pasarAgente(accountId, companyId, hoy, 'extracto')).resultado } catch (e) { avisoConciliar = e instanceof Error ? e.message : String(e) }
      setPaso({ que: 'hecho', nombre: p.a.nombre, importados, conciliado, avisoConciliar })
      refrescarCuentasMenu(); recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPaso(p)
    }
  }

  return (
    <section className="cxb-seccion" aria-label="Subir extracto">
      {/* S02 · PR 2: el título y su frase, en el encabezado de la página (BancosPage). */}
      {error && <div className="cx-error" role="alert">{error}</div>}
      {dadoDeAlta && paso.que === 'leido' && <div className="cx-guardado" role="status">{dadoDeAlta}</div>}

      {(paso.que === 'elegir' || paso.que === 'leyendo') && (
        <div className="cxb-zona" onClick={() => input.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          aria-label="Elegir el fichero del extracto">
          <strong>{paso.que === 'leyendo' ? `Leyendo «${paso.nombre}»…` : 'Suelta aquí el extracto, o pulsa para elegirlo'}</strong>
          <span>Lo puedes soltar en cualquier pantalla de Bancos. Nada sale de tu ordenador hasta que digas «Subir».</span>
          <span className="cx-boton-sec">Elegir fichero</span>
        </div>
      )}
      <input ref={input} type="file" className="cx-oculto" accept=".n43,.q43,.aeb,.txt,.csv,.xls,.xlsx,text/plain,text/csv" aria-label="Fichero del extracto"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f); e.target.value = '' }} />

      {paso.que === 'leido' && (
        <div className="cx-tarjeta cx-formulario">
          <div className={paso.cuadre.ok ? 'cxb-banda' : 'cxb-banda cxb-banda-ambar'} role="note">
            <span className="cx-ia-punto" aria-hidden="true" />
            <div className="cxb-banda-texto">
              <strong>{paso.resumen}</strong>
              {!paso.cuadre.ok && <span>No lo subo: {paso.cuadre.motivos.join(' ')}</span>}
              {paso.cuadre.sinComprobar.length > 0 && <span>{paso.cuadre.sinComprobar.join(' ')}</span>}
            </div>
          </div>
          <h3 className="cxl-subtitulo">«{paso.a.nombre}» · {paso.e.cuentas.length} {paso.e.cuentas.length === 1 ? 'cuenta' : 'cuentas'}</h3>
          {paso.e.cuentas.map((c, i) => {
            const elegido = datos.bancos.find((b) => b.id === asignacion[i])
            const nuevoIban = !!(elegido && c.iban && c.iban !== elegido.iban && !elegido.ibanes.includes(c.iban))
            return (
              <div key={i} className="cxb-lista-fila cxb-cuenta-fichero">
                <span className="cxb-lista-texto">
                  <strong className="cx-cifra">{c.iban ? ibanLegible(c.iban) : c.identificacion}</strong>
                  <span className="cx-ayuda">{c.movimientos.length} movimientos{c.desde && c.hasta ? ` del ${fechaLarga(c.desde)} al ${fechaLarga(c.hasta)}` : ''}{c.saldoFinalCent !== null ? ` · saldo final ${eurosExactos(c.saldoFinalCent / 100)}` : ''}</span>
                  {!asignacion[i] && <span className="cxb-ambar">Esta cuenta no la conozco: dime a qué banco va y lo recuerdo.</span>}
                  {nuevoIban && <span className="cx-ayuda">Recordaré que este IBAN va a {elegido!.nombre}.</span>}
                  {(!asignacion[i] || asignacion[i] === NO_SUBIR) && ibanSinBanco(c.iban, datos.bancos) && (
                    <button type="button" className="cx-boton-sec" onClick={() => setNuevoPara(i)}>{textoNuevoConIban(c.iban)}</button>
                  )}
                </span>
                <label className="cxb-local">
                  <span className="cx-oculto">A qué banco va</span>
                  <select className="cx-input" value={asignacion[i] ?? ''} onChange={(e) => setAsignacion(asignacion.map((x, j) => (j === i ? e.target.value : x)))}>
                    <option value="">Elige el banco…</option>
                    {datos.bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                    <option value={NO_SUBIR}>No subir esta cuenta</option>
                  </select>
                </label>
              </div>
            )
          })}
          {datos.bancos.length === 0 && <p className="cx-ayuda">Aún no tienes ningún banco: pulsa «Nuevo banco…» junto a su cuenta y lo doy de alta aquí mismo, con el IBAN del fichero si lo trae; después subes el extracto a él.</p>}
          {/* S01d · Entra, pero se dice: el total cuadra y alguna fila no sale de la anterior. Encima del botón, en ámbar, con sus filas. */}
          {paso.cuadre.ok && (paso.cuadre.avisos?.length ?? 0) > 0 && (
            <div className="cxb-banda cxb-banda-ambar cxb-aviso-filas" role="note" data-prueba="aviso-filas">
              <div className="cxb-banda-texto">
                {paso.cuadre.avisos!.map((t) => <strong key={t}>{t}</strong>)}
                <details>
                  <summary>Ver las filas</summary>
                  <ul className="cxb-filas-rotas">
                    {(paso.cuadre.filasRotas ?? []).map((f, i) => (
                      <li key={i}>
                        <span className="cx-cifra">{fechaLarga(f.fecha)}{f.fechaValor && f.fechaValor !== f.fecha ? ` (valor ${fechaLarga(f.fechaValor)})` : ''}</span>
                        {' · '}{f.concepto}{' · '}<span className="cx-cifra">{eurosExactos(f.importeCent / 100)}</span>
                        <span className="cx-ayuda"> · el banco dice {eurosExactos(f.saldoCent / 100)} y de la fila anterior sale {eurosExactos(f.esperadoCent / 100)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          )}
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setPaso({ que: 'elegir' })}>Otro fichero</button>
            <button type="button" className="cx-boton" disabled={!paso.cuadre.ok || asignacion.some((x) => !x) || asignacion.every((x) => x === NO_SUBIR)
              || asignacion.some((x) => x && x !== NO_SUBIR && !datos.bancos.some((b) => b.id === x))} onClick={() => importar(paso)}>
              Subir {asignacion.filter((x) => x && x !== NO_SUBIR).length === 1 ? 'la cuenta' : `las ${asignacion.filter((x) => x && x !== NO_SUBIR).length} cuentas`}
            </button>
          </div>
        </div>
      )}

      {nuevoPara !== null && paso.que === 'leido' && (
        <DialogoBancoNuevo ibanInicial={paso.e.cuentas[nuevoPara]?.iban ?? ''} alCerrar={() => setNuevoPara(null)} alCrear={(hecho, texto) => {
          const i = nuevoPara
          setAsignacion((a) => a.map((x, j) => (j === i ? hecho.banco : x)))
          setNuevoPara(null)
          setDadoDeAlta(`${texto} Elegido para la cuenta ${paso.e.cuentas[i]?.iban ? ibanLegible(paso.e.cuentas[i].iban) : paso.e.cuentas[i]?.identificacion ?? ''} del fichero: ya puedes subirla.`)
          refrescarCuentasMenu(); recargar()
        }} />
      )}

      {paso.que === 'importando' && <div className="cx-tarjeta" aria-busy="true"><p>Subiendo «{paso.nombre}» y mirando los movimientos nuevos…</p></div>}

      {paso.que === 'hecho' && (
        <div className="cx-tarjeta cx-formulario">
          <div className="cx-guardado" role="status">
            Subido «{paso.nombre}». {paso.importados.map((r) => r.repetido
              ? `${nombreBanco(r.banco)}: ${r.mensaje ?? 'ese fichero ya se había subido'}.`
              : `${nombreBanco(r.banco)}: ${r.nuevos} ${r.nuevos === 1 ? 'nuevo' : 'nuevos'}${r.repetidos ? `, ${r.repetidos} ya estaban` : ''}${r.posiblesRepetidos ? `, ${r.posiblesRepetidos} quizá repetidos` : ''}${r.continuidad === 'hueco' && r.hueco !== null ? ` · falta un trozo entre este y el anterior (${eurosExactos(r.hueco)})` : r.continuidad === 'sigue' ? ' · sigue al anterior' : ''}.`).join(' ')}
          </div>
          {paso.conciliado && (
            <p className="cxb-frase-verde">
              Después los he mirado: he casado yo {paso.conciliado.casadosSolos}, te propongo {paso.conciliado.propuestos} y quedan {paso.conciliado.porAclarar} por aclarar
              {paso.conciliado.antesDelCorte ? ` (y ${paso.conciliado.antesDelCorte} de antes del corte, solo para enlazar)` : ''}.
            </p>
          )}
          {paso.avisoConciliar && <div className="cx-aviso" role="alert">Subido, pero no he podido mirar los movimientos: {paso.avisoConciliar}</div>}
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setPaso({ que: 'elegir' })}>Subir otro</button>
            <Link to={`${rutaBancos()}?banco=${paso.importados[0]?.banco ?? ''}`} className="cx-boton">Ver los movimientos</Link>
          </div>
        </div>
      )}
    </section>
  )
}
