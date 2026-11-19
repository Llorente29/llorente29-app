// src/modules/conta/nucleo/bancos/PantallaBancos.tsx
//
// E05 · Bancos del núcleo (maqueta nucleo_6_bancos, la de la respuesta E05 · 1;
// ERP10, «Introducción de asientos por tesorería»). Detrás de conta_nucleo y en
// ordenador (BancosSegun); fuera, la pantalla de hoy sin un cambio.
//
//   · Arriba, la subcuenta del banco (57200001 · Banco principal ▾), cuántos
//     esperan a una persona, «Confirmar los N» cuando hay seguros, el cuadre
//     del banco con Sumied a la fecha y «Traer el extracto».
//   · La rejilla: fecha, lo que dice el banco, a qué va, ingreso y pago, y su
//     etiqueta. ↑ ↓ mueven, Intro confirma la propuesta del elegido, F5 abre el
//     mayor de su cuenta (el marco, por data-cuenta), Esc cierra la pestaña.
//   · Abajo, «Escribir uno a mano», validado al momento (conta_banco_a_mano), y
//     el saldo de la cuenta a la fecha.
//   · A la derecha, «Qué es» (la propuesta y su porqué, confirmar, otra cosa,
//     el asiento que sale, deshacer lo casado) y «El documento» (el
//     justificante, o «Falta el justificante»).
// Lo de hoy, por dentro: las lecturas (servicio.ts) y confirmar/deshacer
// (conciliar.ts) son las de bancos/Movimientos.tsx. Las piezas, las de la ficha (K04).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as KE } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { usePestana, useSeVe } from '@/modules/conta/diseno/plantillas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { facturasPendientes, leerDatosBancos, subirTicket, type BancoVista, type FacturaPendiente } from '@/modules/conta/services/bancosPantallas'
import { bancoInicial, mesInicial } from '@/modules/conta/bancos/navegacion'
import { mesesElegibles, nombreCorto, PROPUESTA_RECALCULADA, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { asientoQueSeCrea, confirmable, porValidar, quienEs, textoDelBanco } from '@/modules/conta/lib/conciliarVista'
import { validar } from '@/modules/conta/services/diarioService'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import { AsientoQueSale, AyudaTeclas, Casilla, CasillaFecha, EstadoFicha, type LineaAsiento } from '../ficha/piezas'
import { PanelDocumento } from '../ficha/PanelDocumento'
import { Buscador } from '../ficha/Buscador'
import { cifra } from '../ficha/textos'
import { useUltimo } from '../ficha/useUltimo'
import { cuentasQueEncajan, fechaVista, type CuentaDelPlan } from '../ficha/teclas'
import { aQueVa, etiquetaDe, ingresoPago, mover, porRevisar, segurosMarcados } from './rejilla'
import { casarConAlternativa, casarConCuenta, casarConFactura, confirmarPropuesta, confirmarVarios, deshacerCasado, escribirAMano, textoConfirmados, textoDeshecho } from './conciliar'
import { leerBancos, saldoALaFecha, urlDelJustificante } from './servicio'
import { mesDeAlLado, textoMes } from './mes'
import { casadoConFactura, facturasQueEncajan } from './factura'
import './bancos.css'

type Aviso = { tono: 'ok' | 'falta' | 'mal'; texto: string }

const TECLAS = [
  { tecla: 'Intro', texto: 'confirma lo que propone Sumied' },
  { tecla: '↑ ↓', texto: 'otro movimiento' },
  { tecla: 'F4', texto: 'busca la cuenta o la factura' },
  { tecla: 'Re Pág Av Pág', texto: 'otro mes' },
  { tecla: 'F5', texto: 'abre el mayor de la cuenta en otra pestaña' },
  { tecla: 'Esc', texto: 'cierra' },
] as const

const num = (x: string): number | null => { const n = Number(x.replace(/\./g, '').replace(',', '.')); return x.trim() && Number.isFinite(n) ? n : null }
const euros = (cent: number | null) => (cent === null ? '' : cifra(cent / 100))
const primeraHoja = (nombres: Readonly<Record<string, string>>, prefijo: string) => Object.keys(nombres).filter((c) => c.startsWith(prefijo) && c.length >= 8).sort()[0] ?? null

export default function PantallaBancos() {
  const cuentaConta = useCuentaConta()
  const accountId = cuentaConta.accountId ?? ''
  const { activa } = useEmpresas()
  const pestana = usePestana()
  const seVe = useSeVe()
  const navegar = useNavigate()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [sel, setSel] = useState(-1)
  const companyId = activa?.id ?? ''

  // Mientras vuelve a leer (después de confirmar o deshacer), lo último leído: la rejilla no se vacía ni pierde el foco (useUltimo, K04).
  const datos = useUltimo(useLeer(accountId && companyId ? () => leerDatosBancos(accountId, companyId) : null, `${accountId}:${companyId}:${vuelta}:datos`).datos, `${accountId}:${companyId}`)
  const bancos = datos?.bancos ?? []
  const banco: BancoVista | null = bancos.find((b) => b.id === query.get('banco')) ?? bancoInicial(bancos, datos?.dudas ?? {})
  // E05b · El periodo, como ERP10: el de la dirección (?mes=), o el del último extracto del banco, como hoy.
  const meses = useMemo(() => (datos ? mesesElegibles(datos.primerMovimiento, hoy) : []), [datos, hoy])
  const pedido = query.get('mes')
  const mes = datos && banco ? (pedido && meses.includes(pedido) ? pedido : mesInicial(meses, banco, hoy)) : null
  const [buscarFactura, setBuscarFactura] = useState<string | null>(null)
  const leida = useLeer(datos && banco && mes ? () => leerBancos(accountId, companyId, datos, banco, mes, hoy) : null, `${companyId}:${banco?.id}:${mes}:${vuelta}`)
  const lectura = { datos: useUltimo(leida.datos, `${companyId}:${banco?.id}:${mes}`), error: leida.error }
  const movs = useMemo(() => lectura.datos?.movs ?? [], [lectura.datos])
  const m: MovimientoBanco | null = movs[sel] ?? null
  const nombres = useMemo(() => datos?.nombres ?? {}, [datos])
  const nombreDe = (c: string | null) => (c ? nombres[c] ?? '' : '')
  const cuentasPlan: CuentaDelPlan[] = useMemo(() => Object.entries(nombres).filter(([c]) => c.length >= 8).map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.codigo.localeCompare(b.codigo)), [nombres])
  const seguros = segurosMarcados(movs)
  const revisar = porRevisar(movs)

  // El primero que espera a una persona, al abrir (o el primero, si no hay).
  const abierto = useRef('')
  useEffect(() => {
    const clave = `${banco?.id}:${mes}`
    if (!lectura.datos || abierto.current === clave) return
    abierto.current = clave
    const i = movs.findIndex((x) => x.estado !== 'casado' && x.estado !== 'ignorado' && x.estado !== 'antes_corte_sin_pareja')
    setSel(i >= 0 ? i : movs.length ? 0 : -1)
  }, [lectura.datos, movs, banco?.id, mes])

  // El saldo de la cuenta a la fecha del elegido (ERP10).
  const fechaSaldo = m?.fecha ?? null
  const saldo = useLeer(banco?.cuenta && fechaSaldo ? () => saldoALaFecha(companyId, banco.cuenta!, fechaSaldo) : null, `${companyId}:${banco?.cuenta}:${fechaSaldo}:${vuelta}:saldo`).datos
  const justificante = useLeer(m?.ticket ? () => urlDelJustificante(m.ticket) : null, `${m?.id}:${m?.ticket}:ticket`)

  const recargar = () => { setVuelta((v) => v + 1); refrescarCuentasMenu() }
  const hacer = async (que: () => Promise<string>) => {
    if (ocupado) return
    setOcupado(true)
    try { setAviso({ tono: 'ok', texto: await que() }); recargar() }
    catch (e) {
      const t = e instanceof Error ? e.message : String(e)
      setAviso({ tono: t === PROPUESTA_RECALCULADA ? 'falta' : 'mal', texto: t })
      if (t === PROPUESTA_RECALCULADA) recargar()
    } finally { setOcupado(false) }
  }
  const ctx = { accountId, companyId, hoy }
  const confirmar = (x: MovimientoBanco) => hacer(async () => { await confirmarPropuesta(ctx, x); return `Confirmado: ${x.propuesta?.que ?? 'el movimiento'} (${quienEs(x)}).` })
  const confirmarLosN = () => hacer(async () => textoConfirmados(await confirmarVarios(ctx, movs.filter((x) => seguros.includes(x.id)), quienEs)))
  const deshacer = (x: MovimientoBanco) => hacer(async () => textoDeshecho(quienEs(x), await deshacerCasado(x)))
  // Validar el asiento de lo casado, como «Por validar» de hoy (Movimientos.validarUno): la misma llamada y la misma frase.
  const validarAsiento = (x: MovimientoBanco) => hacer(async () => {
    const r = await validar(x.casado!.asientoId!, cuentaConta.userName ?? null)
    return `Validado: ${x.casado?.asientoConcepto ?? quienEs(x)} (${quienEs(x)}) es el asiento ${r.numero}. Ya está en el libro diario.`
  })

  // ── El teclado de la rejilla ──
  const rejilla = useRef<HTMLDivElement>(null)
  const ir = (i: number) => { setSel(i); setTimeout(() => rejilla.current?.querySelector<HTMLElement>(`[data-fila="${i}"]`)?.focus(), 0) }
  const enRejilla = (e: KE<HTMLDivElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ir(mover(sel, e.key === 'ArrowDown' ? 1 : -1, movs.length)) }
    else if (e.key === 'Enter' && m && confirmable(m)) { e.preventDefault(); void confirmar(m) }
    // F4 en un pago sin casar: «Es otra factura», con el buscador abierto.
    else if (e.key === 'F4' && m && m.importeCent < 0 && m.estado !== 'casado') { e.preventDefault(); setBuscarFactura(m.id) }
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (!seVe() || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      // Re Pág y Av Pág: el mes de antes y el de después (fuera de una casilla, que las usa para moverse).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.ctrlKey && !e.altKey && !e.metaKey && mes && !t?.closest('input, textarea, select')) {
        e.preventDefault()
        const otro = mesDeAlLado(meses, mes, e.key)
        if (otro !== mes) elegirMes(otro)
        return
      }
      if (e.key !== 'Escape') return
      if (t?.closest('[role="dialog"], [role="combobox"][aria-expanded="true"]')) return
      if (pestana?.cerrar) { e.preventDefault(); pestana.cerrar() }
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  })

  const elegirBanco = (id: string) => { const p = new URLSearchParams(query); p.set('banco', id); p.delete('mes'); setQuery(p, { replace: true }); abierto.current = ''; setAviso(null) }
  function elegirMes(x: string) { const p = new URLSearchParams(query); p.set('mes', x); if (banco) p.set('banco', banco.id); setQuery(p, { replace: true }); abierto.current = ''; setAviso(null); setBuscarFactura(null) }
  const cuadre = lectura.datos?.cuadre ?? null
  const estado = !cuadre || cuadre.bancoCent === null || cuadre.libroCent === null
    ? { tono: 'gris' as const, fuerte: 'Sin saldo del extracto.', resto: banco?.cuenta ? `Sumied, ${euros(cuadre?.libroCent ?? null)}` : '' }
    : cuadre.faltaCent === 0
      ? { tono: 'verde' as const, fuerte: 'El saldo cuadra.', resto: `Banco y Sumied, ${euros(cuadre.bancoCent)} a ${fechaVista(lectura.datos?.extractoHasta ?? '').slice(0, 5)}` }
      : { tono: 'ambar' as const, fuerte: 'No cuadra.', resto: `Banco ${euros(cuadre.bancoCent)} y Sumied ${euros(cuadre.libroCent)}` }

  if (datos && bancos.length === 0) return <div className="kf-ficha"><p className="kf-aviso" data-tono="falta">No hay ningún banco dado de alta.</p></div>
  if (lectura.error) return <div className="kf-ficha"><p className="kf-aviso" data-tono="mal">No se han podido leer los movimientos: {lectura.error}</p></div>
  const cargando = !lectura.datos

  return (
    <div className="kf-ficha kb-bancos" data-prueba="bancos-nucleo" aria-busy={cargando || undefined}>
      <header className="kf-cabecera">
        <h1>Bancos</h1>
        <select className="kb-banco" aria-label="Banco" data-cuenta={banco?.cuenta ?? undefined} value={banco?.id ?? ''} onChange={(e) => elegirBanco(e.target.value)}>
          {bancos.map((b) => <option key={b.id} value={b.id}>{b.cuenta ? `${b.cuenta} · ` : ''}{nombreCorto(b)}</option>)}
        </select>
        {mes && (
          <select className="kb-mes" aria-label="Periodo" value={mes} onChange={(e) => elegirMes(e.target.value)} data-prueba="periodo">
            {meses.map((x) => <option key={x} value={x}>{textoMes(x)}</option>)}
          </select>
        )}
        {!cargando && <span className="kf-cola" data-prueba="por-revisar">{revisar} por revisar</span>}
        {!cargando && seguros.length > 0 && (
          <button type="button" className="kf-boton-hueco kb-confirmar-n" disabled={ocupado} onClick={() => void confirmarLosN()}>Confirmar los {seguros.length}</button>
        )}
        {!cargando && <span className="kb-cuadre" title={`${estado.fuerte} ${estado.resto}`}><EstadoFicha {...estado} /></span>}
        <div className="kf-cabecera-botones">
          <button type="button" className="kf-boton-hueco" onClick={() => navegar(rutaBancos('subir'))}>Traer el extracto</button>
        </div>
      </header>
      {aviso && <p className="kf-aviso" data-tono={aviso.tono} role="status" data-prueba="aviso-bancos">{aviso.texto}</p>}
      <div className="kf-cuerpo">
        <div className="kf-izquierda">
          <div className="kf-formulario kb-izquierda">
            {cargando ? <p className="kf-panel-nota" aria-busy="true">Leyendo los movimientos…</p> : (
              <div className="kb-rejilla" ref={rejilla} onKeyDown={enRejilla} role="grid" aria-label="Movimientos del banco" aria-rowcount={movs.length}>
                <div className="kb-fila kb-cabeza" role="row">
                  <span role="columnheader">Fecha</span><span role="columnheader">Lo que dice el banco</span><span role="columnheader">A qué va</span>
                  <span role="columnheader" className="kf-cifra">Ingreso</span><span role="columnheader" className="kf-cifra">Pago</span><span role="columnheader" />
                </div>
                {movs.length === 0 && <p className="kf-panel-nota">{cuadre?.frase}</p>}
                {movs.map((x, i) => {
                  const ip = ingresoPago(x)
                  const cuenta = aQueVa(x, banco?.cuenta ?? null, x.casado?.asientoId ? lectura.datos!.delAsiento[x.casado.asientoId] ?? null : null)
                  const et = etiquetaDe(x)
                  return (
                    <div key={x.id} className="kb-fila" role="row" data-fila={i} tabIndex={i === sel ? 0 : -1} aria-selected={i === sel}
                      data-cuenta={cuenta ?? banco?.cuenta ?? undefined} data-movimiento={x.id} onClick={() => setSel(i)} onFocus={() => setSel(i)}>
                      <span role="gridcell">{fechaVista(x.fecha)}</span>
                      <span role="gridcell" className="kb-texto" title={textoDelBanco(x)}>{textoDelBanco(x)}</span>
                      <span role="gridcell" className="kb-texto">{cuenta ? <><span className="kb-codigo">{cuenta}</span> {nombreDe(cuenta)}</> : ''}</span>
                      <span role="gridcell" className="kf-cifra">{euros(ip.ingresoCent)}</span>
                      <span role="gridcell" className="kf-cifra">{euros(ip.pagoCent)}</span>
                      <span role="gridcell"><span className="kb-etiqueta" data-tono={et.tono}>{et.texto}</span></span>
                    </div>
                  )
                })}
              </div>
            )}
            {banco && <AMano banco={banco} hoy={hoy} cuentas={cuentasPlan} ocupado={ocupado} hacer={hacer} />}
            <p className="kb-saldo" data-prueba="saldo-a-la-fecha">Saldo de la cuenta a la fecha{fechaSaldo ? ` ${fechaVista(fechaSaldo)}` : ''} <strong>{saldo !== null && saldo !== undefined ? euros(saldo) : '—'}</strong></p>
          </div>
          <AyudaTeclas teclas={TECLAS} />
        </div>
        <PanelDocumento key={m?.id ?? 'nada'} otraPrimero
          documento={!m ? null : m.ticket ? (justificante.datos === null && !justificante.error ? undefined : justificante.datos ? { url: justificante.datos, foto: !/\.pdf$/i.test(m.ticket), titulo: `El justificante de ${quienEs(m)}` } : null) : null}
          alElegir={m ? (f) => void hacer(async () => { await subirTicket(accountId, m.id, f); return `Justificante guardado en el movimiento de ${quienEs(m)}.` }) : undefined}
          acepta="image/*,application/pdf" tituloSoltar="Falta el justificante" textoSoltar="Arrastra aquí la foto o el PDF del ticket, o pulsa para elegirlo."
          otra={{ nombre: 'Qué es', contenido: m ? <QueEs m={m} banco={banco} nombres={nombres} cuentas={cuentasPlan} ocupado={ocupado} companyId={companyId}
            confirmar={() => void confirmar(m)} deshacer={() => void deshacer(m)} validar={() => void validarAsiento(m)} hacer={hacer}
            buscando={buscarFactura === m.id} ponerBuscando={(si) => setBuscarFactura(si ? m.id : null)} /> : <p className="kf-panel-nota">Elige un movimiento.</p> }} />
      </div>
    </div>
  )
}

/** «Qué es»: el movimiento, lo que propone Sumied y su porqué, y lo que se puede hacer con él. */
function QueEs({ m, banco, nombres, cuentas, ocupado, companyId, confirmar, deshacer, validar: validarIt, hacer, buscando, ponerBuscando }: {
  m: MovimientoBanco; banco: BancoVista | null; nombres: Readonly<Record<string, string>>; cuentas: CuentaDelPlan[]; ocupado: boolean; companyId: string
  confirmar: () => void; deshacer: () => void; validar: () => void; hacer: (q: () => Promise<string>) => Promise<void>
  buscando: boolean; ponerBuscando: (si: boolean) => void
}) {
  const [texto, setTexto] = useState<string | null>(null)
  const [regla, setRegla] = useState(false)
  const entra = m.importeCent > 0
  const p = m.propuesta
  const d = p?.destino as unknown as Destino | null | undefined
  const lineas = d ? asientoQueSeCrea(m, d, banco?.cuenta ?? null) : null
  const asiento: LineaAsiento[] = (lineas ?? []).map((l) => ({ codigo: l.cuenta, nombre: nombres[l.cuenta] ?? '', debe: l.debeCent ? l.debeCent / 100 : null, haber: l.haberCent ? l.haberCent / 100 : null }))
  const suma = (lineas ?? []).reduce((t, l) => t + l.debeCent, 0)
  const cuadra = lineas ? suma === (lineas ?? []).reduce((t, l) => t + l.haberCent, 0) : false
  const comision = primeraHoja(nombres, '626')
  const aCuenta = (c: CuentaDelPlan) => hacer(() => casarConCuenta(companyId, m, { cuenta: c.codigo, nombre: c.nombre, concepto: `${quienEs(m)} · ${c.nombre}`, regla: regla ? m.conceptoLimpio.trim() || null : null }))
  const casado = m.estado === 'casado' && m.casado
  // «Es otra factura» (E05b): las facturas recibidas sin pagar, las de hoy (bank_facturas_recibidas_pendientes).
  // La clave lleva «buscando»: useLeer solo vuelve a leer cuando cambia la clave (la e2e 44473982157 se quedó sin lista).
  const facturas = useLeer(buscando ? () => facturasPendientes(companyId) : null, `${companyId}:${m.id}:${buscando ? 'buscando' : 'no'}:facturas`)
  const [textoFactura, setTextoFactura] = useState<string | null>(null)
  const [elegida, setElegida] = useState<FacturaPendiente | null>(null)
  const si = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (buscando) document.getElementById(`kb-factura-${m.id}`)?.focus() }, [buscando, m.id])
  useEffect(() => { if (elegida) si.current?.focus() }, [elegida])
  const conFactura = elegida ? casadoConFactura(m, elegida) : null
  const lineasFactura = conFactura ? asientoQueSeCrea(m, conFactura.destino, banco?.cuenta ?? null) : null
  return (
    <div className="kb-que-es" data-prueba="que-es">
      <p className="kb-que-es-arriba"><span>{fechaVista(m.fecha)} · {quienEs(m)} · {entra ? 'ingreso' : 'pago'}</span><strong className="kf-cifra">{euros(Math.abs(m.importeCent))}</strong></p>
      {casado ? (
        <>
          <p><strong>{m.casado!.porQuien === 'folvy' ? 'Hecho solo.' : 'Hecho.'}</strong> {m.casado!.porque}</p>
          {porValidar(m) && <button type="button" className="kf-guardar kb-si" disabled={ocupado} onClick={validarIt} data-prueba="validar">Validar el asiento</button>}
          <button type="button" className="kf-enlace" disabled={ocupado} onClick={deshacer} data-prueba="deshacer">Deshacer</button>
        </>
      ) : (
        <>
          {p?.que ? <p><strong>{p.que}</strong>{m.porque ? ` ${m.porque}` : ''}</p> : m.porque ? <p>{m.porque}</p> : null}
          {confirmable(m) && (
            <button type="button" className="kf-guardar kb-si" disabled={ocupado} onClick={confirmar} data-prueba="confirmar">Sí, es ese {entra ? 'ingreso' : 'pago'} <kbd>Intro</kbd></button>
          )}
          {!entra && !buscando && <button type="button" className="kf-enlace" onClick={() => ponerBuscando(true)} data-prueba="otra-factura">Es otra factura</button>}
          {!entra && buscando && (
            <div className="kb-otra-factura" data-prueba="buscar-factura">
              <span className="kf-titulo">Es otra factura</span>
              <Buscador id={`kb-factura-${m.id}`} etiqueta="Factura" placeholder="Proveedor o número de factura" abrir valor={textoFactura ?? ''} ponerTexto={setTextoFactura}
                cargando={facturas.datos === null && !facturas.error} lista={(t) => facturasQueEncajan(m, facturas.datos ?? [], t)}
                texto={(f) => `${f.proveedor} · ${f.numero ?? 'sin número'} · del ${fechaVista(f.fecha)} · queda ${cifra(f.pendienteCent / 100)}`}
                elegir={(f) => { setElegida(f); setTextoFactura(`${f.proveedor} · ${f.numero ?? 'sin número'}`) }} />
              {facturas.error && <p className="kf-aviso" data-tono="mal">{facturas.error}</p>}
              {facturas.datos && facturas.datos.length === 0 && <p>No hay ninguna factura recibida sin pagar.</p>}
            </div>
          )}
          {elegida && conFactura && (
            <>
              <p><strong>Paga la factura {elegida.numero ?? 'sin número'} de {elegida.proveedor}.</strong> Del {fechaVista(elegida.fecha)}, queda {cifra(elegida.pendienteCent / 100)}.</p>
              <button type="button" ref={si} className="kf-guardar kb-si" disabled={ocupado} data-prueba="confirmar-factura"
                onClick={() => void hacer(() => casarConFactura(m, elegida, quienEs(m)))}>Sí, es esa factura <kbd>Intro</kbd></button>
            </>
          )}
          <div className="kb-otra-cosa" role="group" aria-label="O es otra cosa">
            <span className="kf-titulo">O es otra cosa</span>
            {(p?.alternativas ?? []).map((a) => <button key={a.etiqueta} type="button" className="kf-boton-hueco" disabled={ocupado} onClick={() => void hacer(() => casarConAlternativa(m, a))}>{a.etiqueta}</button>)}
            {comision && !entra && <button type="button" className="kf-boton-hueco" disabled={ocupado} onClick={() => void aCuenta({ codigo: comision, nombre: nombres[comision] ?? comision })}>Comisión del banco</button>}
            <Buscador id={`kb-otra-${m.id}`} etiqueta="Otra cuenta" placeholder="Otra cuenta: 6001, 600.1 o parte del nombre" valor={texto ?? ''} ponerTexto={setTexto}
              lista={(t) => cuentasQueEncajan(t, cuentas, 8)} texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { setTexto(null); void aCuenta(c) }} />
            {m.conceptoLimpio.trim() && (
              <label className="kb-regla"><input type="checkbox" checked={regla} onChange={(e) => setRegla(e.target.checked)} /> Hacerlo solo la próxima vez que pase igual</label>
            )}
          </div>
          {lineasFactura ? <AsientoQueSale lineas={lineasFactura.map((l) => ({ codigo: l.cuenta, nombre: nombres[l.cuenta] ?? '', debe: l.debeCent ? l.debeCent / 100 : null, haber: l.haberCent ? l.haberCent / 100 : null }))}
              etiqueta={{ texto: `Cuadra · ${cifra(lineasFactura.reduce((t, l) => t + l.debeCent, 0) / 100)}`, tono: 'bien' }} />
            : lineas && <AsientoQueSale lineas={asiento} etiqueta={cuadra ? { texto: `Cuadra · ${cifra(suma / 100)}`, tono: 'bien' } : { texto: 'No cuadra', tono: 'ambar' }} />}
        </>
      )}
    </div>
  )
}

/** «Escribir uno a mano · si no viene en el extracto»: la línea de edición de ERP10, validada al momento. */
function AMano({ banco, hoy, cuentas, ocupado, hacer }: { banco: BancoVista; hoy: string; cuentas: CuentaDelPlan[]; ocupado: boolean; hacer: (q: () => Promise<string>) => Promise<void> }) {
  const [fecha, setFecha] = useState(hoy)
  const [cuenta, setCuenta] = useState<CuentaDelPlan | null>(null)
  const [texto, setTexto] = useState<string | null>(null)
  const [concepto, setConcepto] = useState('')
  const [ingreso, setIngreso] = useState('')
  const [pago, setPago] = useState('')
  const raiz = useRef<HTMLFormElement>(null)
  const i = num(ingreso), p = num(pago)
  const listo = !!fecha && !!cuenta && ((i ?? 0) > 0) !== ((p ?? 0) > 0)
  const apuntar = () => {
    if (!listo || ocupado) return
    void hacer(async () => {
      const r = await escribirAMano({ bancoId: banco.id, fecha, cuenta: cuenta!.codigo, concepto, ingreso: i, pago: p })
      setCuenta(null); setTexto(null); setConcepto(''); setIngreso(''); setPago('')
      return r.texto
    })
  }
  // Intro pasa a la casilla siguiente; en la última, apunta (como la ficha: queHaceIntro).
  const teclas = (e: KE<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return
    const lista = Array.from(raiz.current?.querySelectorAll<HTMLElement>('[data-casilla]') ?? [])
    const j = lista.indexOf(e.target as HTMLElement)
    if (j < 0) return
    e.preventDefault()
    if (j < lista.length - 1) lista[j + 1].focus(); else apuntar()
  }
  return (
    <form className="kb-a-mano" ref={raiz} onKeyDown={teclas} onSubmit={(e) => { e.preventDefault(); apuntar() }} aria-label="Escribir uno a mano" data-prueba="a-mano">
      <h2 className="kf-titulo">Escribir uno a mano <span className="kb-apoyo">· si no viene en el extracto</span></h2>
      <div className="kf-fila" style={{ gridTemplateColumns: '104px 2fr 2.2fr 1fr 1fr auto' }}>
        <Casilla rotulo="Fecha" htmlFor="kb-fecha"><CasillaFecha id="kb-fecha" etiqueta="Fecha" iso={fecha} hoy={hoy} poner={setFecha} /></Casilla>
        <Casilla rotulo="Cuenta" origen="F4" htmlFor="kb-cuenta">
          <Buscador id="kb-cuenta" etiqueta="Cuenta" valor={texto ?? (cuenta ? `${cuenta.codigo} · ${cuenta.nombre}` : '')} cuenta={cuenta?.codigo ?? null} ponerTexto={(t) => { setTexto(t); setCuenta(null) }}
            lista={(t) => cuentasQueEncajan(t, cuentas, 8).filter((c) => c.codigo !== banco.cuenta)} texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { setCuenta(c); setTexto(null) }} />
        </Casilla>
        <Casilla rotulo="Concepto" htmlFor="kb-concepto"><input id="kb-concepto" data-casilla value={concepto} onChange={(e) => setConcepto(e.target.value)} /></Casilla>
        <Casilla rotulo="Ingreso" htmlFor="kb-ingreso"><input id="kb-ingreso" data-casilla className="kf-cifra" inputMode="decimal" value={ingreso} onChange={(e) => setIngreso(e.target.value)} /></Casilla>
        <Casilla rotulo="Pago" htmlFor="kb-pago"><input id="kb-pago" data-casilla className="kf-cifra" inputMode="decimal" value={pago} onChange={(e) => setPago(e.target.value)} /></Casilla>
        <button type="submit" className="kf-boton-hueco kb-apuntar" disabled={!listo || ocupado}>Apuntar</button>
      </div>
    </form>
  )
}
