// src/modules/conta/bancos/CierreDelMes.tsx
//
// B01 · El cierre del mes de cada banco (tarea 6; sin maqueta, en el estilo de
// N17). Por cada banco, a fin de mes: el saldo del banco (su último extracto)
// frente al de su cuenta en contabilidad, y la lista de lo que explica la
// diferencia: lo que está en el banco sin casar y lo que está en contabilidad
// y no en el banco. El estado lo calcula la base (bank_meses_estado), el mismo
// que comprueba bank_mes_cerrar: lo que dice la pantalla es lo que decide el
// cierre.
//
// S02 · PR 2: vive en Contabilidad › Cierre y Registro › Cerrar el mes, en la
// MISMA página que el cierre del mes de la contabilidad (libros/Cierre.tsx):
// los dos cierres de un mes, juntos. Ya no depende del contexto de Bancos: le
// llegan la cuenta, la empresa y el mes, y lee él mismo los bancos de la
// empresa (leerBancosDelCierre, con account_id: regla 9).
//
// No se cierra con movimientos sin casar ni con una diferencia sin explicar,
// salvo «a sabiendas»: la persona dice por qué y queda escrito con su nombre
// (respuesta 4). Reabrir también pide el porqué. Cada botón dice lo que ha
// hecho, con el banco, el mes y el saldo (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaBancos } from '@/config/navegacion'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { filaDe, limitesMes, nombreConCodigo, nombreMes } from '@/modules/conta/lib/bancosVista'
import {
  asientosSinMovimiento, cerrarMes, leerBancosDelCierre, leerMovimientos, mesesEstado, reabrirMes, type BancoDelCierre, type EstadoMes,
} from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { LO_HECHO } from '@/modules/conta/bancos/marca'

type Aviso = { tipo: 'ok' | 'error'; texto: string } | null

export function CierreDelMes({ accountId, companyId, mes, hoy, bancoDestacado = null }: {
  accountId: string
  companyId: string
  /** 'YYYY-MM'. */
  mes: string
  hoy: string
  /** El banco por el que se llegó (?banco=, desde Bancos): va el primero. */
  bancoDestacado?: string | null
}) {
  const [aviso, setAviso] = useState<Aviso>(null)
  const [dialogo, setDialogo] = useState<{ que: 'sabiendas' | 'reabrir'; banco: BancoDelCierre; e: EstadoMes } | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const { hasta } = limitesMes(mes)
  const terminado = hasta < hoy
  const lectura = useLeer(async () => {
    const bancos = await leerBancosDelCierre(accountId, companyId)
    const [estados, movs, asientos] = await Promise.all([
      mesesEstado(companyId, mes),
      Promise.all(bancos.map((b) => leerMovimientos(accountId, b.id, mes))),
      asientosSinMovimiento(companyId, mes),
    ])
    return { bancos, estados, movs, asientos }
  }, `${accountId}:${companyId}:${mes}:${vuelta}`)

  if (lectura.error) return <ErrorConReintento mensaje={lectura.error} reintentar={lectura.recargar} />
  if (!lectura.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el cierre de los bancos">{[0, 1, 2].map((i) => <Hueso key={i} alto={56} />)}</div>
  const { bancos, estados, movs, asientos } = lectura.datos

  const hacer = async (f: () => Promise<string>) => {
    setAviso(null)
    try { setAviso({ tipo: 'ok', texto: await f() }); refrescarCuentasMenu(); setVuelta((v) => v + 1) } catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) }
  }
  const nombre = nombreMes(mes).toLowerCase()

  if (bancos.length === 0) {
    return (
      <div className="cx-tarjeta">
        <p className="cx-ayuda">Esta empresa aún no tiene ningún banco: no hay saldos que cerrar. <Link to={rutaBancos('cuentas')} className="cx-enlace">Dar de alta un banco</Link></p>
      </div>
    )
  }

  const filas = bancos.map((b, i) => {
    const e = estados.find((x) => x.bancoId === b.id) ?? null
    const sueltos = movs[i].filter((m) => m.estado !== 'casado' && m.estado !== 'ignorado')
    const enLibro = asientos.filter((a) => a.cuentaId === b.id)
    const cuadra = !!e && e.saldoBancoCent !== null && e.diferenciaCent === 0 && e.sueltos === 0
    return { b, e, sueltos, enLibro, cuadra }
  })
  // El banco por el que se llegó, el primero; los demás, como vienen (por nombre).
  const ordenadas = bancoDestacado ? [...filas].sort((x, y) => Number(y.b.id === bancoDestacado) - Number(x.b.id === bancoDestacado)) : filas
  const pendientes = filas.filter((f) => !f.e?.cierre).length

  return (
    <div className="cxb-seccion" data-testid="cierre-bancos">
      <div className={filas.every((f) => f.cuadra || f.e?.cierre) ? 'cxb-banda' : 'cxb-banda cxb-banda-ambar'} role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong>{!terminado ? `${nombreMes(mes)} aún no ha terminado: el banco se cierra a partir del día 1 del mes siguiente.`
            : pendientes === 0 ? `${nombreMes(mes)} está cerrado en todos los bancos.`
            : `${nombreMes(mes)}: ${filas.filter((f) => f.cuadra && !f.e?.cierre).length} de ${pendientes} bancos sin cerrar cuadran al céntimo.`}</strong>
          <span>El mes de un banco se cierra cuando su saldo es el de contabilidad al céntimo y no queda ningún movimiento sin casar. Si no, solo a sabiendas, diciendo por qué.</span>
        </div>
      </div>
      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}

      {ordenadas.map(({ b, e, sueltos, enLibro, cuadra }) => (
        <article key={b.id} className="cx-tarjeta cxb-cierre" aria-label={`Cierre de ${b.nombre}`} data-destacado={b.id === bancoDestacado || undefined}>
          <div className="cx-tarjeta-cabeza">
            <h4 className="cxl-subtitulo">{nombreConCodigo(b.nombre, b.cuenta)}</h4>
            {e?.cierre ? (
              <span className="cxb-cerrado">
                <span className={e.cierre.aSabiendas ? 'cx-chip cx-chip-ambar' : 'cx-chip cx-chip-ia'}>{e.cierre.aSabiendas ? 'Cerrado a sabiendas' : 'Cerrado'}</span>
                <button type="button" className="cx-boton-sec" onClick={() => setDialogo({ que: 'reabrir', banco: b, e })}>Reabrir…</button>
              </span>
            ) : terminado && e && (
              cuadra
                ? <button type="button" className="cx-boton-sec" onClick={() => hacer(async () => {
                    await cerrarMes(b.id, mes, false, null)
                    return `Cerrado ${nombre} de ${b.nombre}: el banco y contabilidad dicen lo mismo, ${eurosExactos(e.saldoBancoCent! / 100)}.`
                  })}>Cerrar {nombre} de {b.nombre}</button>
                : <button type="button" className="cx-boton-sec" onClick={() => setDialogo({ que: 'sabiendas', banco: b, e })}>Cerrar a sabiendas…</button>
            )}
          </div>
          {e?.cierre && (
            <p className="cx-ayuda">
              Lo cerró {e.cierre.por ?? 'alguien'} el {fechaLarga(e.cierre.el)}{e.cierre.aSabiendas && e.cierre.motivo ? `, a sabiendas: «${e.cierre.motivo}»` : ''}.
            </p>
          )}
          {e && (
            <div className="cxb-cifras cxb-cifras-tres">
              <div className="cxb-cifra"><span className="cxb-cifra-etiqueta">Saldo en el banco</span>
                <span className="cxb-cifra-valor">{e.saldoBancoCent === null ? '—' : eurosExactos(e.saldoBancoCent / 100)}</span>
                <span className="cxb-cifra-pie">{e.extractoHasta ? `extracto hasta el ${fechaLarga(e.extractoHasta)}` : 'falta el extracto'}</span></div>
              <div className="cxb-cifra"><span className="cxb-cifra-etiqueta">Saldo en contabilidad</span>
                <span className="cxb-cifra-valor">{eurosExactos(e.saldoLibroCent / 100)}</span><span className="cxb-cifra-pie">{b.cuenta ? nombreConCodigo(b.cuentaNombre ?? 'su cuenta', b.cuenta) : 'sin cuenta'}</span></div>
              <div className="cxb-cifra"><span className="cxb-cifra-etiqueta">Diferencia</span>
                <span className={`cxb-cifra-valor ${e.diferenciaCent === 0 ? 'cxb-verde' : e.diferenciaCent !== null ? 'cxb-ambar' : ''}`}>{e.diferenciaCent === null ? '—' : eurosExactos(e.diferenciaCent / 100)}</span>
                <span className={`cxb-cifra-pie ${e.diferenciaCent === 0 ? 'cxb-verde' : 'cxb-ambar'}`}>
                  {e.diferenciaCent === 0 ? 'igual al céntimo' : e.diferenciaCent === null ? 'sin saldo de fin de mes'
                    : e.diferenciaCent === e.sueltosCent ? 'la explican los movimientos sin casar' : 'hay algo más que explicar'}
                </span></div>
            </div>
          )}
          {sueltos.length > 0 && (
            <>
              <h5 className="cxb-cierre-sub">En el banco y sin casar · {sueltos.length} · {eurosExactos(sueltos.reduce((t, m) => t + m.importeCent, 0) / 100)}</h5>
              <ul className="cxl-lista-estado">
                {sueltos.map((m) => { const f = filaDe(m); return (
                  <li key={m.id}><span>{diaMesCorto(m.fecha)} · {m.conceptoLimpio} <span className="cx-ayuda">· {f.estado.toLowerCase()}</span></span><span className="cx-cifra">{eurosExactos(m.importeCent / 100)}</span></li>
                ) })}
              </ul>
              <Link to={`${rutaBancos()}?banco=${b.id}&mes=${mes}&ver=todo`} className="cx-enlace">Ir a casarlos, en Bancos</Link>
            </>
          )}
          {enLibro.length > 0 && (
            <>
              <h5 className="cxb-cierre-sub">En contabilidad y no en el banco · {enLibro.length}</h5>
              <ul className="cxl-lista-estado">
                {enLibro.map((a) => <li key={a.id}><Link to={rutaAsiento(a.id)}>{diaMesCorto(a.fecha)} · {a.concepto}</Link><span className="cx-cifra">{eurosExactos(a.importeCent / 100)}</span></li>)}
              </ul>
            </>
          )}
        </article>
      ))}

      {dialogo && (
        <DialogoMotivo
          titulo={dialogo.que === 'reabrir' ? `Reabrir ${nombre} de ${dialogo.banco.nombre}` : `Cerrar ${nombre} de ${dialogo.banco.nombre} a sabiendas`}
          explicacion={dialogo.que === 'reabrir'
            ? 'Al reabrirlo se puede volver a casar y a cerrar. El cierre de antes queda en el registro.'
            : `${dialogo.e.sueltos ? `Quedan ${dialogo.e.sueltos} movimientos sin casar (${eurosExactos(dialogo.e.sueltosCent / 100)}). ` : ''}${dialogo.e.diferenciaCent ? `El banco y contabilidad difieren ${eurosExactos(dialogo.e.diferenciaCent / 100)}. ` : ''}${dialogo.e.saldoBancoCent === null ? 'Falta el saldo del banco a fin de mes. ' : ''}Queda escrito con tu nombre lo que pongas aquí.`}
          boton={dialogo.que === 'reabrir' ? 'Reabrir' : 'Cerrar a sabiendas'}
          alCerrar={() => setDialogo(null)}
          alAceptar={(motivo) => hacer(async () => {
            const d = dialogo
            if (d.que === 'reabrir') { await reabrirMes(d.e.cierre!.id, motivo); setDialogo(null); return `Reabierto ${nombre} de ${d.banco.nombre}: «${motivo}».` }
            await cerrarMes(d.banco.id, mes, true, motivo); setDialogo(null)
            return `Cerrado ${nombre} de ${d.banco.nombre} a sabiendas: «${motivo}». Queda en «${LO_HECHO}», en Bancos.`
          })}
        />
      )}
    </div>
  )
}

export function DialogoMotivo({ titulo, explicacion, boton, alCerrar, alAceptar }: {
  titulo: string; explicacion: string; boton: string; alCerrar: () => void; alAceptar: (motivo: string) => Promise<void>
}) {
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar}>
      <form className="cx-formulario" onSubmit={async (e) => { e.preventDefault(); setOcupado(true); try { await alAceptar(motivo.trim()) } finally { setOcupado(false) } }}>
        <p className="cx-ayuda">{explicacion}</p>
        <label className="cx-campo"><span>Por qué</span><input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Ej.: el recibo está reclamado al banco" /></label>
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="cx-boton" disabled={!motivo.trim() || ocupado}>{ocupado ? 'Guardando…' : boton}</button>
        </div>
      </form>
    </Dialogo>
  )
}
