// src/modules/conta/bancos/Movimientos.tsx
//
// B01 · Bancos › Movimientos (maqueta N17Bancos). Las migas con el banco, el
// segmento Para confirmar · Por aclarar · Todo, «Subir extracto» y «Sí a los
// N que propongo»; la banda de la IA con la frase del mes; las cinco cifras;
// y la tabla: fecha, lo que dice el banco, importe, el punto (verde casado
// solo, ámbar para confirmar, gris falta algo) y lo que Folvy cree que es,
// con su porqué y sus botones.
//
// Todo lo que se pulsa confirma con contenido o dice el fallo (regla 8). Los
// segmentos filtran porque se piden; «Todo» enseña todas las filas (regla 7).
// En el móvil la misma tabla se apila en tarjetas, una por movimiento (M4).

import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaBancos } from '@/config/navegacion'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import {
  TEXTO_BOTON, cierreBanco, filaDe, limitesMes, nombreMes, resumenFilas, tarjetaPorAclarar, ultimosIban, type Boton, type Fila, type MovimientoBanco,
} from '@/modules/conta/lib/bancosVista'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import { guardarRegla, ignorar, leerMovimientos, saldosContables, subirTicket, type FacturaPendiente } from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { DialogoCuenta, DialogoFactura, type Eleccion } from '@/modules/conta/bancos/dialogos'

type Segmento = 'confirmar' | 'aclarar' | 'todo'
const SEGMENTOS: { id: Segmento; nombre: string }[] = [{ id: 'confirmar', nombre: 'Para confirmar' }, { id: 'aclarar', nombre: 'Por aclarar' }, { id: 'todo', nombre: 'Todo' }]
const VISIBLES = 50

const signo = (c: number) => (c > 0 ? `+${eurosExactos(c / 100).replace(' €', '')}` : eurosExactos(c / 100).replace(' €', ''))

export function Movimientos() {
  const ctx = useBancos()
  const { accountId, companyId, banco, mes, movil, vuelta, recargar } = ctx
  const [query, setQuery] = useSearchParams()
  const navegar = useNavigate()
  const segmento = (['confirmar', 'aclarar', 'todo'].includes(query.get('ver') ?? '') ? query.get('ver') : movil ? 'confirmar' : 'todo') as Segmento
  const [todas, setTodas] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<{ que: 'cuenta' | 'factura'; m: MovimientoBanco } | null>(null)
  const fotoDe = useRef<string | null>(null)
  const inputFoto = useRef<HTMLInputElement>(null)

  const { hasta } = limitesMes(mes)
  const corte = hasta < ctx.hoy ? hasta : ctx.hoy
  const lectura = useLeer(banco ? async () => {
    const [movs, saldos] = await Promise.all([
      leerMovimientos(accountId, banco.id, mes),
      saldosContables(companyId, corte, banco.cuenta ? [banco.cuenta] : []),
    ])
    return { movs, libroCent: banco.cuenta ? saldos[banco.cuenta] ?? 0 : null }
  } : null, `${banco?.id}:${mes}:${vuelta}`)

  const movs = useMemo(() => lectura.datos?.movs ?? [], [lectura.datos])
  const filas = useMemo(() => movs.map(filaDe), [movs])
  const porId = useMemo(() => new Map(movs.map((m) => [m.id, m])), [movs])

  if (!banco) {
    return <div className="cx-tarjeta"><p>No hay ningún banco dado de alta. <Link to={rutaBancos('cuentas')} className="cx-enlace">Dalo de alta en Cuentas y extractos</Link> y sube su extracto.</p></div>
  }
  if (lectura.error) return <ErrorConReintento mensaje={lectura.error} reintentar={lectura.recargar} />
  if (!lectura.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los movimientos">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={44} />)}</div>

  const deFolvy = movs.filter((m) => m.estado === 'casado' && m.casado?.porQuien === 'folvy').length
  const r = resumenFilas(filas, mes, deFolvy)
  const propuestas = movs.filter((m) => m.estado === 'propuesto' && m.propuesta?.destino && !(m.propuesta.pideTicket && !m.ticket))
  const elegidas = filas.filter((f) => segmento === 'todo' || f.grupo === segmento)
  const mostradas = todas ? elegidas : elegidas.slice(0, VISIBLES)

  // Las cifras de los saldos: el último extracto del banco hasta fin de mes, y la 572 a la misma fecha.
  const extracto = ctx.datos.extractos.find((e) => e.cuentaId === banco.id && e.hasta <= hasta && e.saldoFinalCent !== null) ?? null
  const sinCasarCent = movs.filter((m) => m.estado !== 'casado' && m.estado !== 'ignorado').reduce((t, m) => t + m.importeCent, 0)
  const cierre = cierreBanco(extracto?.saldoFinalCent ?? null, lectura.datos.libroCent ?? 0, sinCasarCent)

  const hecho = (texto: string) => { setAviso({ tipo: 'ok', texto }); refrescarCuentasMenu(); recargar(); lectura.recargar() }
  const fallo = (e: unknown) => setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) })
  const con = async (id: string, f: () => Promise<void>) => { setOcupado(id); setAviso(null); try { await f() } catch (e) { fallo(e) } finally { setOcupado(null) } }
  const quien = (m: MovimientoBanco) => `${diaMesCorto(m.fecha)} de ${eurosExactos(m.importeCent / 100)}`

  const confirmarPropuesta = async (m: MovimientoBanco) => {
    const p = m.propuesta!
    await nucleo.confirmar(m.id, m.porque ?? p.que ?? 'Confirmado', p.destino as unknown as Destino, (m.confianza ?? 'probable'), p.reglaId ?? null)
  }

  const pulsar = (f: Fila, b: Boton) => {
    const m = porId.get(f.id)!
    switch (b) {
      case 'ver': if (m.casado?.asientoId) navegar(rutaAsiento(m.casado.asientoId)); return
      case 'deshacer': return con(m.id, async () => {
        await nucleo.deshacer(m.casado!.id, 'Deshecho desde Bancos › Movimientos')
        hecho(`Deshecho: el movimiento del ${quien(m)} vuelve a estar sin casar, y su asiento se ha quitado de contabilidad (o anulado, si estaba validado).`)
      })
      case 'si': case 'si-sin-ticket': return con(m.id, async () => {
        await confirmarPropuesta(m)
        hecho(`Casado: ${m.propuesta?.que ?? 'el movimiento'} (${quien(m)}). El asiento queda propuesto en contabilidad${b === 'si-sin-ticket' ? ', sin ticket' : ''}.`)
      })
      case 'subir-foto': fotoDe.current = m.id; inputFoto.current?.click(); return
      case 'otra-cosa': case 'decirlo-yo': setDialogo({ que: 'cuenta', m }); return
      case 'buscar-factura': setDialogo({ que: 'factura', m }); return
      case 'alta-tarjeta': navegar(`${rutaBancos('cuentas')}?banco=${banco.id}&tarjeta=${tarjetaPorAclarar(m.porque) ?? ''}`); return
    }
  }

  const alFoto = async (file: File | undefined) => {
    const id = fotoDe.current
    if (!file || !id) return
    const m = porId.get(id)!
    await con(id, async () => {
      await subirTicket(accountId, id, file)
      if (m.propuesta?.destino) {
        await confirmarPropuesta(m)
        hecho(`Ticket guardado y casado: ${m.propuesta.que ?? 'el pago'} (${quien(m)}).`)
      } else hecho(`Ticket guardado en el movimiento del ${quien(m)}.`)
    })
    if (inputFoto.current) inputFoto.current.value = ''
  }

  const siATodas = () => con('todas', async () => {
    let bien = 0
    const mal: string[] = []
    for (const m of propuestas) {
      try { await confirmarPropuesta(m); bien++ } catch (e) { mal.push(`${quien(m)}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    if (mal.length) setAviso({ tipo: 'error', texto: `Confirmados ${bien} de ${propuestas.length}. No he podido: ${mal.join(' · ')}` })
    else hecho(`Confirmados los ${bien}: sus asientos quedan propuestos en contabilidad.`)
    if (mal.length) { refrescarCuentasMenu(); recargar(); lectura.recargar() }
  })

  const elegirCuenta = (m: MovimientoBanco) => async (e: Eleccion) => {
    const destino: Destino = { tipo: 'cuenta', lineas: [{ cuenta: e.cuenta, importe: Math.abs(m.importeCent) / 100 }], concepto: e.concepto }
    const nombre = `${ctx.datos.nombres[e.cuenta] ?? e.cuenta} · ${e.cuenta}`
    await nucleo.confirmar(m.id, `Lo dijiste tú: ${nombre}.`, destino, 'probable', null)
    if (e.regla) await guardarRegla(companyId, { palabras: `Cuando el concepto tenga «${e.regla}» → ${nombre}`, contiene: e.regla, cuenta: e.cuenta, signo: m.importeCent < 0 ? -1 : 1, origen: 'persona' })
    hecho(`Casado con ${nombre} (${quien(m)})${e.regla ? `. Y desde ahora, lo que tenga «${e.regla}» irá ahí: está en Reglas` : ''}.`)
  }
  const apartar = (m: MovimientoBanco) => async (motivo: string) => {
    await ignorar(m.id, motivo)
    hecho(`Apartado el movimiento del ${quien(m)}: «${motivo}».`)
  }
  const elegirFactura = (m: MovimientoBanco) => async (f: FacturaPendiente) => {
    const importe = Math.min(Math.abs(m.importeCent), f.pendienteCent) / 100
    const concepto = `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}`.replace(/\s+/g, ' ')
    const destino: Destino = { tipo: 'factura_recibida', facturas: [{ id: f.id, importe }], cuenta_tercero: f.cuentaTercero ?? '', tercero_id: f.terceroId, concepto }
    await nucleo.confirmar(m.id, `Lo dijiste tú: paga la factura ${f.numero ?? ''} de ${f.proveedor}.`, destino, 'probable', null)
    hecho(`Casado: ${concepto} (${quien(m)}). La factura queda pagada.`)
  }

  const u = ultimosIban(banco.iban)
  return (
    <section className="cxb-movimientos" aria-labelledby="cxb-mov-titulo">
      <div className="cxl-seccion">
        <div>
          <nav className="cxp-migas" aria-label="Estás en"><span>Bancos</span><span aria-hidden="true">›</span><span aria-current="page">{banco.nombre}{u ? ` · ES·· ···· ${u}` : ''}</span></nav>
          <h2 id="cxb-mov-titulo">Movimientos</h2>
        </div>
        <div className="cxl-herramientas">
          <div className="cxl-segmento" role="group" aria-label="Qué movimientos ver">
            {SEGMENTOS.map((s) => (
              <button key={s.id} type="button" aria-pressed={segmento === s.id} onClick={() => { const p = new URLSearchParams(query); p.set('ver', s.id); setQuery(p, { replace: true }) }}>{s.nombre}</button>
            ))}
          </div>
          {!movil && <button type="button" className="cx-boton-sec" onClick={() => ctx.subir()}>Subir extracto</button>}
          {propuestas.length > 0 && (
            <button type="button" className="cx-boton" disabled={!!ocupado} onClick={siATodas}>
              {ocupado === 'todas' ? 'Confirmando…' : `Sí a los ${propuestas.length} que propongo`}
            </button>
          )}
        </div>
      </div>

      <div className="cxb-banda" role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong>{r.frase}</strong>
          <span>Lo casado solo está en «Lo que ha hecho Folvy», con el porqué y para deshacer. Nada pasa a contabilidad sin que esté seguro o lo confirmes tú.</span>
        </div>
        <Link to={`${rutaBancos('hecho')}?banco=${banco.id}&mes=${mes}`} className="cx-boton-sec">Ver lo que he hecho</Link>
      </div>

      <div className="cxb-cifras">
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Saldo en el banco</span>
          <span className="cxb-cifra-valor">{extracto ? eurosExactos(extracto.saldoFinalCent! / 100) : '—'}</span>
          <span className="cxb-cifra-pie">{extracto ? `extracto hasta el ${fechaLarga(extracto.hasta)}` : 'sube un extracto con saldos'}</span>
        </div>
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Saldo en contabilidad</span>
          <span className="cxb-cifra-valor">{lectura.datos.libroCent === null ? '—' : eurosExactos(lectura.datos.libroCent / 100)}</span>
          <span className={`cxb-cifra-pie ${cierre.cuadra ? 'cxb-verde' : cierre.cuadra === false ? 'cxb-ambar' : ''}`}>
            {lectura.datos.libroCent === null ? 'el banco no tiene su cuenta' : cierre.cuadra ? 'igual al céntimo' : cierre.cuadra === false ? `difiere ${eurosExactos(Math.abs(cierre.diferenciaCent!) / 100)}` : `a ${fechaLarga(corte)}`}
          </span>
        </div>
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Casado solo</span>
          <span className="cxb-cifra-valor">{r.casadoSolo}</span>
          <span className="cxb-cifra-pie cxb-verde">este mes · con deshacer</span>
        </div>
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Para confirmar</span>
          <span className="cxb-cifra-valor">{r.paraConfirmar}</span>
          <span className="cxb-cifra-pie cxb-ambar">una línea cada uno</span>
        </div>
        <div className="cxb-cifra">
          <span className="cxb-cifra-etiqueta">Por aclarar</span>
          <span className="cxb-cifra-valor">{r.porAclarar}</span>
          <span className="cxb-cifra-pie cxb-ambar">falta algo: te digo qué</span>
        </div>
      </div>

      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}

      <div className="cx-tarjeta cxb-tabla" role="table" aria-label={`Movimientos de ${nombreMes(mes).toLowerCase()} de ${banco.nombre}`}>
        <div className="cxb-fila cxb-cabeza" role="row">
          <span role="columnheader">Fecha</span>
          <span role="columnheader">Lo que dice el banco</span>
          <span role="columnheader" className="cxb-der">Importe</span>
          <span role="columnheader"><span className="cx-oculto">Estado</span></span>
          <span role="columnheader">Lo que Folvy cree que es</span>
          <span role="columnheader"><span className="cx-oculto">Qué hacer</span></span>
        </div>
        {mostradas.map((f) => {
          const m = porId.get(f.id)!
          return (
            <div key={f.id} className={`cxb-fila cxb-fila-${f.tono}`} role="row" data-testid={`mov-${m.id}`}>
              <span role="cell" className="cxb-fecha">{diaMesCorto(m.fecha)}</span>
              <span role="cell" className="cxb-banco">{m.conceptoLimpio}{m.tarjeta && <span className="cxb-tarjeta"> · tarjeta de {m.tarjeta.titular} (···{m.tarjeta.ultimos4})</span>}</span>
              <span role="cell" className={`cxb-importe ${m.importeCent > 0 ? 'cxb-entra' : ''}`}>{signo(m.importeCent)}</span>
              <span role="cell" className="cxb-punto-celda"><span className={`cxb-punto cxb-punto-${f.tono}`} title={f.estado} /><span className="cx-oculto">{f.estado}</span></span>
              <span role="cell" className="cxb-folvy">
                <strong>{f.titulo}</strong>
                <span>{f.porque}</span>
              </span>
              <span role="cell" className="cxb-botones">
                {f.botones.map((b) => (
                  <button key={b} type="button" className={b === 'decirlo-yo' ? 'cx-boton' : 'cx-boton-sec'} disabled={!!ocupado} onClick={() => pulsar(f, b)}>
                    {ocupado === m.id && (b === 'si' || b === 'deshacer' || b === 'si-sin-ticket' || b === 'subir-foto') ? '…' : TEXTO_BOTON[b]}
                  </button>
                ))}
              </span>
            </div>
          )
        })}
        {mostradas.length === 0 && (
          <p className="cxb-vacio">{filas.length === 0
            ? `No hay movimientos de ${nombreMes(mes).toLowerCase()} en ${banco.nombre}. Suelta aquí su extracto o usa «Subir extracto».`
            : segmento === 'confirmar' ? 'No te queda nada por confirmar.' : 'No te queda nada por aclarar.'}</p>
        )}
        <div className="cxb-pie">
          <span>Verde: casado solo, con deshacer. Ámbar: Folvy lo cree, confírmalo. Gris: falta algo y te dice qué. Cada movimiento se casa una sola vez.</span>
          {!todas && elegidas.length > VISIBLES && <button type="button" className="cx-enlace cxb-enlace-boton" onClick={() => setTodas(true)}>Ver los {elegidas.length}</button>}
        </div>
      </div>

      <input ref={inputFoto} type="file" accept="image/*,application/pdf" capture="environment" className="cx-oculto" aria-label="Foto del ticket"
        onChange={(e) => alFoto(e.target.files?.[0])} />
      {dialogo?.que === 'cuenta' && <DialogoCuenta m={dialogo.m} alCerrar={() => setDialogo(null)} alElegir={elegirCuenta(dialogo.m)} alApartar={apartar(dialogo.m)} />}
      {dialogo?.que === 'factura' && <DialogoFactura m={dialogo.m} alCerrar={() => setDialogo(null)} alElegir={elegirFactura(dialogo.m)} />}
    </section>
  )
}
