// src/modules/conta/bancos/CierreDelMes.tsx
//
// B01 · Bancos › Cierre del mes (sin maqueta, en el estilo de N17). Por cada
// banco, a fin de mes: el saldo del banco (su último extracto) frente al de
// su cuenta en contabilidad, y si no son iguales, POR QUÉ, movimiento a
// movimiento: lo que está en el banco y no está casado, y lo que está en
// contabilidad y no en el banco. El mes se da por bueno cuando todo cuadra.
// Cerrar el mes (y que el agente lo vigile) es de la tarea 6: aquí no hay
// botón que aún no haga nada.

import { Link } from 'react-router-dom'
import { rutaAsiento, rutaBancos } from '@/config/navegacion'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { cierreBanco, filaDe, limitesMes, nombreConCodigo, nombreMes } from '@/modules/conta/lib/bancosVista'
import { asientosSinMovimiento, leerMovimientos, saldosContables } from '@/modules/conta/services/bancosPantallas'
import { useBancos } from '@/modules/conta/bancos/contexto'

export function CierreDelMes() {
  const { accountId, companyId, datos, mes, hoy, vuelta } = useBancos()
  const { hasta } = limitesMes(mes)
  const corte = hasta < hoy ? hasta : hoy
  const lectura = useLeer(async () => {
    const [movs, saldos, asientos] = await Promise.all([
      Promise.all(datos.bancos.map((b) => leerMovimientos(accountId, b.id, mes))),
      saldosContables(companyId, corte, datos.bancos.map((b) => b.cuenta).filter((c): c is string => !!c)),
      asientosSinMovimiento(companyId, mes),
    ])
    return { movs, saldos, asientos }
  }, `${companyId}:${mes}:${vuelta}`)

  if (lectura.error) return <ErrorConReintento mensaje={lectura.error} reintentar={lectura.recargar} />
  if (!lectura.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el cierre">{[0, 1, 2].map((i) => <Hueso key={i} alto={56} />)}</div>
  const { movs, saldos, asientos } = lectura.datos

  const filas = datos.bancos.map((b, i) => {
    const extracto = datos.extractos.find((e) => e.cuentaId === b.id && e.hasta <= hasta && e.saldoFinalCent !== null) ?? null
    const sueltos = movs[i].filter((m) => m.estado !== 'casado' && m.estado !== 'ignorado')
    const libro = b.cuenta ? saldos[b.cuenta] ?? 0 : 0
    const enLibro = asientos.filter((a) => a.cuentaId === b.id)
    const c = cierreBanco(extracto?.saldoFinalCent ?? null, libro, sueltos.reduce((t, m) => t + m.importeCent, 0))
    return { b, extracto, sueltos, libro, enLibro, c }
  })
  const todo = filas.every((f) => f.c.cuadra && f.sueltos.length === 0)

  return (
    <section className="cxb-seccion" aria-labelledby="cxb-cierre-titulo">
      <div className="cxl-seccion"><div><h2 id="cxb-cierre-titulo">Cierre de {nombreMes(mes).toLowerCase()}</h2><p className="cx-ayuda">El saldo de cada banco frente al de contabilidad, a {fechaLarga(corte)}.</p></div></div>
      <div className={todo ? 'cxb-banda' : 'cxb-banda cxb-banda-ambar'} role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong>{todo ? `${nombreMes(mes)} cuadra en todos los bancos.` : `${nombreMes(mes)} aún no cuadra en ${filas.filter((f) => !(f.c.cuadra && f.sueltos.length === 0)).length} de ${filas.length} bancos.`}</strong>
          <span>Un mes cuadra cuando el saldo del banco es el de contabilidad al céntimo y no queda ningún movimiento sin casar.</span>
        </div>
      </div>

      {filas.map(({ b, extracto, sueltos, libro, enLibro, c }) => (
        <article key={b.id} className="cx-tarjeta cxb-cierre" aria-label={`Cierre de ${b.nombre}`}>
          <h3 className="cxl-subtitulo">{nombreConCodigo(b.nombre, b.cuenta)}</h3>
          <div className="cxb-cifras cxb-cifras-tres">
            <div className="cxb-cifra"><span className="cxb-cifra-etiqueta">Saldo en el banco</span><span className="cxb-cifra-valor">{extracto ? eurosExactos(extracto.saldoFinalCent! / 100) : '—'}</span>
              <span className="cxb-cifra-pie">{extracto ? `extracto hasta el ${fechaLarga(extracto.hasta)}` : 'falta el extracto'}</span></div>
            <div className="cxb-cifra"><span className="cxb-cifra-etiqueta">Saldo en contabilidad</span><span className="cxb-cifra-valor">{eurosExactos(libro / 100)}</span><span className="cxb-cifra-pie">{b.cuenta ?? 'sin cuenta'}</span></div>
            <div className="cxb-cifra"><span className="cxb-cifra-etiqueta">Diferencia</span>
              <span className={`cxb-cifra-valor ${c.cuadra ? 'cxb-verde' : c.cuadra === false ? 'cxb-ambar' : ''}`}>{c.diferenciaCent === null ? '—' : eurosExactos(c.diferenciaCent / 100)}</span>
              <span className={`cxb-cifra-pie ${c.cuadra ? 'cxb-verde' : 'cxb-ambar'}`}>{c.cuadra ? 'igual al céntimo' : c.cuadra === false ? 'hay que explicarla' : 'sin extracto'}</span></div>
          </div>
          <p className={c.cuadra ? 'cxb-frase-verde' : 'cx-aviso'}>{c.frase}</p>
          {sueltos.length > 0 && (
            <>
              <h4>En el banco y sin casar · {sueltos.length}</h4>
              <ul className="cxl-lista-estado">
                {sueltos.map((m) => { const f = filaDe(m); return (
                  <li key={m.id}><span>{diaMesCorto(m.fecha)} · {m.conceptoLimpio} <span className="cx-ayuda">· {f.estado.toLowerCase()}</span></span><span className="cx-cifra">{eurosExactos(m.importeCent / 100)}</span></li>
                ) })}
              </ul>
              <Link to={`${rutaBancos()}?banco=${b.id}&mes=${mes}&ver=todo`} className="cx-enlace">Ir a casarlos</Link>
            </>
          )}
          {enLibro.length > 0 && (
            <>
              <h4>En contabilidad y no en el banco · {enLibro.length}</h4>
              <ul className="cxl-lista-estado">
                {enLibro.map((a) => <li key={a.id}><Link to={rutaAsiento(a.id)}>{diaMesCorto(a.fecha)} · {a.concepto}</Link><span className="cx-cifra">{eurosExactos(a.importeCent / 100)}</span></li>)}
              </ul>
            </>
          )}
        </article>
      ))}
    </section>
  )
}
