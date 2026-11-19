// src/modules/conta/nucleo/bancos/PantallaBancos.tsx
//
// E05 · Bancos del núcleo (maqueta nucleo_6_bancos; ERP10, «Introducción de asientos por
// tesorería»). R08 · Conciliar en un paso (maqueta nucleo_10_bancos_conciliar_en_un_paso,
// aprobada por Julio el 19/11): conciliar es el ÚLTIMO paso, el asiento queda en el diario.
// Detrás de conta_nucleo y en ordenador (BancosSegun); fuera, la pantalla de hoy sin un cambio.
//
//   · Arriba, la subcuenta del banco, el periodo, «5 por conciliar · 41 conciliados · 1 apartado»
//     y la pastilla «Cuadra. Banco y Sumied, 6.668,93 · extracto de hoy, 13:17» (el saldo del
//     último extracto de la cadena contra lo que está en el diario), o en ámbar con las dos cifras.
//   · La rejilla, con una casilla en cada fila y otra en la cabecera; el estado, en una palabra.
//     Espacio marca, Mayús ↑ ↓ marca seguidos, Intro concilia y pasa al siguiente, F4 busca la
//     cuenta o la factura, Ctrl Z deshace lo último, Re Pág / Av Pág cambian de mes, Esc cierra.
//   · Con algo marcado, la barra de abajo («5 marcados · 6.119,71 a la cuenta [buscador] F4 ·
//     Conciliar los 5 · Quitar la marca») y, a la derecha, «Los 5 asientos que van al diario».
//   · Sin nada marcado, «Escribir uno a mano» y el saldo de la cuenta a la fecha; a la derecha,
//     «Qué es» (la propuesta, otra cuenta, otra factura, deshacer, o por qué está apartado) y
//     «El documento».
//   · Al abrir, lo que el banco no cobró se aparta solo (bank_apartar_no_cobrados) y se dice.
// Los mensajes de la base, en palabras (seleccion.enPalabras).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as KE } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rutaBancos } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { usePestana, useSeVe } from '@/modules/conta/diseno/plantillas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { desapartar, facturasPendientes, leerDatosBancos, subirTicket, type BancoVista, type FacturaPendiente } from '@/modules/conta/services/bancosPantallas'
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
import { aQueVa, ingresoPago, mover } from './rejilla'
import { casarConAlternativa, casarConCuenta, casarConEmitida, casarConFactura, conciliarAUnaCuenta, conciliarComoPropone, facturasEmitidasPendientes, confirmarPropuesta, deshacerCasado, escribirAMano, textoDeshecho, type Conciliados } from './conciliar'
import { apartarNoCobrados, cuandoDelExtracto, leerBancos, porQueApartado, saldoALaFecha, textoApartados, urlDelJustificante } from './servicio'
import { mesDeAlLado, textoMes } from './mes'
import { casadoConFactura, cobroConFactura, emitidasQueEncajan, facturasQueEncajan, type FacturaEmitidaPendiente } from './factura'
import { alternar, asientosQueVan, avisoMezcla, conciliable, contraElBanco, cuantos, enPalabras, losMarcados, marcarSeguidos, marcarTodos, palabraDe, sumaMarcados, textoConciliados } from './seleccion'
import './bancos.css'

type Aviso = { tono: 'ok' | 'falta' | 'mal'; texto: string }

const TECLAS = [
  { tecla: 'Espacio', texto: 'marca el movimiento' },
  { tecla: 'Mayús ↑ ↓', texto: 'marca varios seguidos' },
  { tecla: 'F4', texto: 'busca la cuenta o la factura' },
  { tecla: 'Intro', texto: 'concilia y pasa al siguiente' },
  { tecla: 'Ctrl Z', texto: 'deshace' },
] as const

const TONO_PALABRA = { 'Por conciliar': 'mira', Conciliado: 'bien', Apartado: 'neutro' } as const

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
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const ancla = useRef(-1)
  const [cuentaBarra, setCuentaBarra] = useState<CuentaDelPlan | null>(null)
  const [textoBarra, setTextoBarra] = useState<string | null>(null)
  const ultimos = useRef<string[]>([])
  const companyId = activa?.id ?? ''

  // Al abrir, lo que el banco no cobró se aparta solo, y se dice (una vez por empresa).
  const apartado = useRef('')
  useEffect(() => {
    if (!companyId || apartado.current === companyId) return
    apartado.current = companyId
    void apartarNoCobrados(companyId).then((xs) => { const t = textoApartados(xs); if (t) { setAviso({ tono: 'falta', texto: t }); setVuelta((v) => v + 1) } }).catch(() => { /* la pantalla sigue; el detector vuelve a mirar la próxima vez */ })
  }, [companyId])

  // Mientras vuelve a leer (después de conciliar o deshacer), lo último leído: la rejilla no se vacía ni pierde el foco (useUltimo, K04).
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
  const cuenta572 = banco?.cuenta ?? null
  const cuenta = cuantos(movs)
  const marcadosVivos = losMarcados(movs, marcados)
  const conCuenta = (x: MovimientoBanco) => aQueVa(x, cuenta572, x.casado?.asientoId ? lectura.datos?.delAsiento[x.casado.asientoId] ?? null : null)

  // El primero por conciliar, al abrir (o el primero, si no hay).
  const abierto = useRef('')
  useEffect(() => {
    const clave = `${banco?.id}:${mes}`
    if (!lectura.datos || abierto.current === clave) return
    abierto.current = clave
    const i = movs.findIndex((x) => palabraDe(x) === 'Por conciliar')
    setSel(i >= 0 ? i : movs.length ? 0 : -1)
  }, [lectura.datos, movs, banco?.id, mes])

  // El saldo de la cuenta a la fecha del elegido (ERP10), con lo del diario.
  const fechaSaldo = m?.fecha ?? null
  const saldo = useLeer(cuenta572 && fechaSaldo ? () => saldoALaFecha(companyId, cuenta572, fechaSaldo) : null, `${companyId}:${cuenta572}:${fechaSaldo}:${vuelta}:saldo`).datos
  const justificante = useLeer(m?.ticket ? () => urlDelJustificante(m.ticket) : null, `${m?.id}:${m?.ticket}:ticket`)

  const recargar = () => { setVuelta((v) => v + 1); refrescarCuentasMenu() }
  const hacer = async (que: () => Promise<string>) => {
    if (ocupado) return
    setOcupado(true)
    try { setAviso({ tono: 'ok', texto: await que() }); recargar() }
    catch (e) {
      const t = enPalabras(e instanceof Error ? e.message : String(e))
      setAviso({ tono: t === PROPUESTA_RECALCULADA ? 'falta' : 'mal', texto: t })
      if (t === PROPUESTA_RECALCULADA) recargar()
    } finally { setOcupado(false) }
  }
  const ctx = { accountId, companyId, hoy }
  const siguiente = (desde: number) => { const j = movs.findIndex((x, i) => i > desde && conciliable(x)); if (j >= 0) ir(j) }
  const confirmar = (x: MovimientoBanco) => hacer(async () => {
    await confirmarPropuesta(ctx, x); ultimos.current = [x.id]; siguiente(movs.indexOf(x))
    return `Conciliado: ${x.propuesta?.que ?? 'el movimiento'} (${quienEs(x)}) · en el diario.`
  })
  const conciliarMarcados = () => hacer(async () => {
    const lista = marcadosVivos
    const r: Conciliados = cuentaBarra ? await conciliarAUnaCuenta(lista, { cuenta: cuentaBarra.codigo, nombre: cuentaBarra.nombre }, quienEs) : await conciliarComoPropone(ctx, lista, quienEs)
    if ('recalculado' in r && r.recalculado) throw new Error(PROPUESTA_RECALCULADA)
    ultimos.current = r.ids
    setMarcados(new Set()); setCuentaBarra(null); setTextoBarra(null)
    return textoConciliados(r)
  })
  const deshacer = (x: MovimientoBanco) => hacer(async () => textoDeshecho(quienEs(x), await deshacerCasado(x)))
  // Ctrl Z: deshace lo último que se ha conciliado aquí (uno o el grupo).
  const deshacerUltimo = () => {
    const xs = movs.filter((x) => ultimos.current.includes(x.id) && x.casado)
    if (xs.length === 0) { setAviso({ tono: 'falta', texto: 'No hay nada que deshacer: lo último que has conciliado aquí ya está deshecho, o no has conciliado nada.' }); return }
    void hacer(async () => {
      // De atrás adelante: así el último sale del diario sin dejar hueco, y el anterior pasa a ser el último.
      const dicho: string[] = []
      for (const x of [...xs].reverse()) dicho.push(await deshacerCasado(x))
      ultimos.current = []
      return xs.length === 1 ? textoDeshecho(quienEs(xs[0]), dicho[0]) : `Deshechos ${xs.length} movimientos: vuelven a estar por conciliar. ${[...new Set(dicho)].map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('. ')}.`
    })
  }
  // Lo que quedó sin pasar al diario de antes del R08: la misma llamada y la misma frase que «Por validar» de hoy.
  const validarAsiento = (x: MovimientoBanco) => hacer(async () => {
    const r = await validar(x.casado!.asientoId!, cuentaConta.userName ?? null)
    return `Validado: ${x.casado?.asientoConcepto ?? quienEs(x)} (${quienEs(x)}) es el asiento ${r.numero}. Ya está en el libro diario.`
  })
  const reabrir = (x: MovimientoBanco) => hacer(async () => { await desapartar(x.id); return `Abierto otra vez: el movimiento de ${quienEs(x)} vuelve a estar por conciliar.` })

  const limpiar = () => { setMarcados(new Set()); setCuentaBarra(null); setTextoBarra(null); ancla.current = -1 }
  const elegirBanco = (id: string) => { const p = new URLSearchParams(query); p.set('banco', id); p.delete('mes'); setQuery(p, { replace: true }); abierto.current = ''; setAviso(null); limpiar() }
  function elegirMes(x: string) { const p = new URLSearchParams(query); p.set('mes', x); if (banco) p.set('banco', banco.id); setQuery(p, { replace: true }); abierto.current = ''; setAviso(null); setBuscarFactura(null); limpiar() }
  // ── El teclado de la rejilla ──
  const rejilla = useRef<HTMLDivElement>(null)
  const ir = (i: number) => { setSel(i); setTimeout(() => rejilla.current?.querySelector<HTMLElement>(`[data-fila="${i}"]`)?.focus(), 0) }
  const enRejilla = (e: KE<HTMLDivElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
    if ((e.target as HTMLElement).closest('input, button, select')) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const j = mover(sel, e.key === 'ArrowDown' ? 1 : -1, movs.length)
      if (e.shiftKey) { if (ancla.current < 0) ancla.current = sel; setMarcados((s) => marcarSeguidos(s, movs, ancla.current, j)) } else ancla.current = j
      ir(j)
    } else if (e.key === ' ' && m) { e.preventDefault(); setMarcados((s) => alternar(s, m)); ancla.current = sel }
    else if (e.key === 'Enter') {
      if (marcadosVivos.length > 0) { e.preventDefault(); if (cuentaBarra || marcadosVivos.every(confirmable)) void conciliarMarcados(); else document.getElementById('kb-barra-cuenta')?.focus() }
      else if (m && confirmable(m)) { e.preventDefault(); void confirmar(m) }
    }
    // F4: con algo marcado, la cuenta de abajo; si no, «Es otra factura» del elegido (un pago, sus recibidas; un cobro, sus emitidas).
    else if (e.key === 'F4') {
      if (marcadosVivos.length > 0) { e.preventDefault(); document.getElementById('kb-barra-cuenta')?.focus() }
      else if (m && m.importeCent !== 0 && conciliable(m)) { e.preventDefault(); setBuscarFactura(m.id) }
    }
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (!seVe() || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      const enCasilla = !!t?.closest('input, textarea, select')
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !enCasilla) { e.preventDefault(); deshacerUltimo(); return }
      // Re Pág y Av Pág: el mes de antes y el de después (fuera de una casilla, que las usa para moverse).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.ctrlKey && !e.altKey && !e.metaKey && mes && !enCasilla) {
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

  const cuadre = lectura.datos?.cuadre ?? null
  const cuando = cuandoDelExtracto(lectura.datos?.extractoHasta ?? null, lectura.datos?.extractoLlego ?? null, hoy)
  const estado = !cuadre || cuadre.bancoCent === null || cuadre.libroCent === null
    ? { tono: 'gris' as const, fuerte: 'Sin saldo del extracto.', resto: cuenta572 ? `Sumied, ${euros(cuadre?.libroCent ?? null)}` : '' }
    : cuadre.faltaCent === 0
      ? { tono: 'verde' as const, fuerte: 'Cuadra.', resto: `Banco y Sumied, ${euros(cuadre.bancoCent)}${cuando ? ` · ${cuando}` : ''}` }
      : { tono: 'ambar' as const, fuerte: 'No cuadra.', resto: `Banco ${euros(cuadre.bancoCent)} y Sumied ${euros(cuadre.libroCent)}${cuando ? ` · ${cuando}` : ''}` }

  if (datos && bancos.length === 0) return <div className="kf-ficha"><p className="kf-aviso" data-tono="falta">No hay ningún banco dado de alta.</p></div>
  if (lectura.error) return <div className="kf-ficha"><p className="kf-aviso" data-tono="mal">No se han podido leer los movimientos: {enPalabras(lectura.error)}</p></div>
  const cargando = !lectura.datos
  const conciliables = movs.filter(conciliable)
  const todos = conciliables.length > 0 && conciliables.every((x) => marcados.has(x.id))
  const suma = sumaMarcados(marcadosVivos)
  const mezcla = avisoMezcla(marcadosVivos, cuentaBarra?.codigo ?? null)
  const listos = marcadosVivos.length > 0 && (!!cuentaBarra || marcadosVivos.every(confirmable))

  return (
    <div className="kf-ficha kb-bancos" data-prueba="bancos-nucleo" aria-busy={cargando || undefined}>
      <header className="kf-cabecera">
        <h1>Bancos</h1>
        <select className="kb-banco" aria-label="Banco" data-cuenta={cuenta572 ?? undefined} value={banco?.id ?? ''} onChange={(e) => elegirBanco(e.target.value)}>
          {bancos.map((b) => <option key={b.id} value={b.id}>{b.cuenta ? `${b.cuenta} · ` : ''}{nombreCorto(b)}</option>)}
        </select>
        {mes && (
          <select className="kb-mes" aria-label="Periodo" value={mes} onChange={(e) => elegirMes(e.target.value)} data-prueba="periodo">
            {meses.map((x) => <option key={x} value={x}>{textoMes(x)}</option>)}
          </select>
        )}
        {!cargando && <span className="kb-cuantos" data-prueba="por-conciliar"><strong>{cuenta.porConciliar} por conciliar</strong>{cuenta.texto.slice(cuenta.texto.indexOf(' · '))}</span>}
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
              <div className="kb-rejilla" ref={rejilla} onKeyDown={enRejilla} role="grid" aria-label="Movimientos del banco" aria-rowcount={movs.length} aria-multiselectable="true">
                <div className="kb-fila kb-cabeza" role="row">
                  <span role="columnheader"><input type="checkbox" aria-label="Marcar todos" checked={todos} disabled={conciliables.length === 0} onChange={() => setMarcados((s) => marcarTodos(s, movs))} /></span>
                  <span role="columnheader">Fecha</span><span role="columnheader">Lo que dice el banco</span><span role="columnheader">A qué cuenta va</span>
                  <span role="columnheader" className="kf-cifra">Ingreso</span><span role="columnheader" className="kf-cifra">Pago</span><span role="columnheader">Estado</span>
                </div>
                {movs.length === 0 && <p className="kf-panel-nota">{cuadre?.frase}</p>}
                {movs.map((x, i) => {
                  const ip = ingresoPago(x)
                  // Marcado y con la cuenta de abajo elegida, la que va a llevar (maqueta).
                  const c = marcados.has(x.id) && cuentaBarra && conciliable(x) ? cuentaBarra.codigo : conCuenta(x)
                  const palabra = palabraDe(x)
                  const marcado = marcados.has(x.id)
                  const tachar = palabra === 'Apartado'
                  return (
                    <div key={x.id} className="kb-fila" role="row" data-fila={i} tabIndex={i === sel ? 0 : -1} aria-selected={i === sel} data-marcado={marcado || undefined}
                      data-cuenta={c ?? cuenta572 ?? undefined} data-movimiento={x.id} onClick={() => setSel(i)} onFocus={() => setSel(i)}>
                      <span role="gridcell"><input type="checkbox" aria-label={`Marcar ${quienEs(x)}`} checked={marcado} disabled={!conciliable(x)} tabIndex={-1}
                        onChange={() => { setMarcados((s) => alternar(s, x)); ancla.current = i }} onClick={(e) => e.stopPropagation()} /></span>
                      <span role="gridcell">{fechaVista(x.fecha).slice(0, 5)}</span>
                      <span role="gridcell" className="kb-texto" title={textoDelBanco(x)}>{x.conceptoLimpio.trim() || textoDelBanco(x)}</span>
                      <span role="gridcell" className="kb-texto" title={c ? `${c} ${nombreDe(c)}` : undefined}>{c ? <><strong className="kb-codigo">{c}</strong> {nombreDe(c)}</> : ''}</span>
                      <span role="gridcell" className="kf-cifra">{tachar && ip.ingresoCent !== null ? <s>{euros(ip.ingresoCent)}</s> : euros(ip.ingresoCent)}</span>
                      <span role="gridcell" className="kf-cifra">{tachar && ip.pagoCent !== null ? <s>{euros(ip.pagoCent)}</s> : euros(ip.pagoCent)}</span>
                      <span role="gridcell"><span className="kb-etiqueta" data-tono={TONO_PALABRA[palabra]}>{palabra}</span></span>
                    </div>
                  )
                })}
              </div>
            )}
            {marcadosVivos.length > 0 ? (
              <div className="kb-barra" data-prueba="barra-marcados" role="group" aria-label="Lo marcado">
                <div className="kb-barra-arriba">
                  <strong className="kb-barra-cuantos">{marcadosVivos.length === 1 ? '1 marcado' : `${marcadosVivos.length} marcados`} · {euros(suma.cent)}</strong>
                  <span className="kb-apoyo">a la cuenta</span>
                  <div className="kb-barra-cuenta">
                    <Buscador id="kb-barra-cuenta" etiqueta="A la cuenta" placeholder={marcadosVivos.every(confirmable) ? 'La que propone Sumied, u otra: 6001, 600.1 o parte del nombre' : '6001, 600.1 o parte del nombre'}
                      valor={textoBarra ?? (cuentaBarra ? `${cuentaBarra.codigo} · ${cuentaBarra.nombre}` : '')} cuenta={cuentaBarra?.codigo ?? null}
                      ponerTexto={(t) => { setTextoBarra(t); setCuentaBarra(null) }}
                      lista={(t) => cuentasQueEncajan(t, cuentasPlan, 8).filter((c) => c.codigo !== cuenta572)} texto={(c) => `${c.codigo} · ${c.nombre}`}
                      elegir={(c) => { setCuentaBarra(c); setTextoBarra(null); setTimeout(() => document.getElementById('kb-conciliar-n')?.focus(), 0) }} />
                  </div>
                  <kbd>F4</kbd>
                </div>
                {mezcla && <p className="kf-aviso" data-tono="falta" data-prueba="aviso-mezcla">{mezcla}</p>}
                <div className="kb-barra-abajo">
                  <button type="button" id="kb-conciliar-n" className="kf-guardar" data-prueba="conciliar-marcados" disabled={!listos || ocupado} onClick={() => void conciliarMarcados()}>Conciliar {marcadosVivos.length === 1 ? 'el marcado' : `los ${marcadosVivos.length}`}</button>
                  <button type="button" className="kf-enlace" onClick={limpiar}>Quitar la marca</button>
                </div>
              </div>
            ) : (
              <>
                {banco && <AMano banco={banco} hoy={hoy} cuentas={cuentasPlan} ocupado={ocupado} hacer={hacer} />}
                <p className="kb-saldo" data-prueba="saldo-a-la-fecha">Saldo de la cuenta a la fecha{fechaSaldo ? ` ${fechaVista(fechaSaldo)}` : ''} <strong>{saldo !== null && saldo !== undefined ? euros(saldo) : '—'}</strong></p>
              </>
            )}
          </div>
          <AyudaTeclas teclas={TECLAS} />
        </div>
        {marcadosVivos.length > 0 ? (
          <aside className="kf-panel kb-panel-marcados" data-prueba="van-al-diario" aria-label="Los asientos que van al diario">
            <Marcados ms={marcadosVivos} cuenta={cuentaBarra} cuenta572={cuenta572} nombres={nombres} cuentaDe={conCuenta} />
          </aside>
        ) : (
          <PanelDocumento key={m?.id ?? 'nada'} otraPrimero
            documento={!m ? null : m.ticket ? (justificante.datos === null && !justificante.error ? undefined : justificante.datos ? { url: justificante.datos, foto: !/\.pdf$/i.test(m.ticket), titulo: `El justificante de ${quienEs(m)}` } : null) : null}
            alElegir={m ? (f) => void hacer(async () => { await subirTicket(accountId, m.id, f); return `Justificante guardado en el movimiento de ${quienEs(m)}.` }) : undefined}
            acepta="image/*,application/pdf" tituloSoltar="Falta el justificante" textoSoltar="Arrastra aquí la foto o el PDF del ticket, o pulsa para elegirlo."
            otra={{ nombre: 'Qué es', contenido: m ? <QueEs m={m} banco={banco} nombres={nombres} cuentas={cuentasPlan} ocupado={ocupado} companyId={companyId} accountId={accountId} hoy={hoy}
              extractos={datos?.extractos ?? []} confirmar={() => void confirmar(m)} deshacer={() => void deshacer(m)} validar={() => void validarAsiento(m)} reabrir={() => void reabrir(m)} hacer={hacer}
              buscando={buscarFactura === m.id} ponerBuscando={(si) => setBuscarFactura(si ? m.id : null)} /> : <p className="kf-panel-nota">Elige un movimiento.</p> }} />
        )}
      </div>
    </div>
  )
}

/** A la derecha, con algo marcado: lo que suman y «Los N asientos que van al diario», uno por movimiento. */
function Marcados({ ms, cuenta, cuenta572, nombres, cuentaDe }: {
  ms: readonly MovimientoBanco[]; cuenta: CuentaDelPlan | null; cuenta572: string | null; nombres: Readonly<Record<string, string>>; cuentaDe: (m: MovimientoBanco) => string | null
}) {
  const suma = sumaMarcados(ms)
  const fechas = [...new Set(ms.map((x) => fechaVista(x.fecha).slice(0, 5)))]
  const filas = cuenta ? asientosQueVan(ms, cuenta.codigo) : ms.map((x) => ({ ...asientosQueVan([x], cuentaDe(x) ?? '')[0] }))
  const faltan = filas.filter((f) => !f.cuenta).length
  return (
    <div className="kb-marcados">
      <p className="kb-marcados-arriba"><span>{suma.texto}{fechas.length === 1 ? ` · ${fechas[0]}` : ''}</span><strong className="kf-cifra">{euros(suma.cent)}</strong></p>
      <div className="kb-van">
        <p className="kb-van-titulo"><strong>{ms.length === 1 ? 'El asiento que va al diario' : `Los ${ms.length} asientos que van al diario`}</strong>
          {faltan === 0 ? <span className="kb-etiqueta" data-tono="bien">Cuadran</span> : <span className="kb-etiqueta" data-tono="mira">Falta la cuenta</span>}</p>
        <table className="kb-van-tabla">
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td>{fechaVista(f.fecha).slice(0, 5)}</td>
                <td className="kb-texto" title={f.texto}>{f.texto}</td>
                <td className="kb-texto" title={f.cuenta ? `${f.cuenta} ${nombres[f.cuenta] ?? ''}` : undefined}>{f.cuenta ? `${f.cuenta} ${f.lado}` : 'elige la cuenta (F4)'}</td>
                <td className="kf-cifra"><strong>{euros(f.importeCent)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="kb-apoyo">{contraElBanco(ms, cuenta572)}</p>
      </div>
      <p className="kb-nota">Al pulsar <strong>Conciliar</strong> van al diario. No hay que confirmarlos después. Si te equivocas, <strong>Deshacer</strong> los quita.</p>
    </div>
  )
}

/** «Qué es»: el movimiento, lo que propone Sumied y su porqué, y lo que se puede hacer con él. */
function QueEs({ m, banco, nombres, cuentas, ocupado, companyId, accountId, hoy, extractos, confirmar, deshacer, validar: validarIt, reabrir, hacer, buscando, ponerBuscando }: {
  m: MovimientoBanco; banco: BancoVista | null; nombres: Readonly<Record<string, string>>; cuentas: CuentaDelPlan[]; ocupado: boolean; companyId: string; accountId: string; hoy: string
  extractos: Parameters<typeof porQueApartado>[1]
  confirmar: () => void; deshacer: () => void; validar: () => void; reabrir: () => void; hacer: (q: () => Promise<string>) => Promise<void>
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
  // «Es otra factura» (E05b): en un pago, las facturas recibidas sin pagar, las de hoy (bank_facturas_recibidas_pendientes).
  // E05c: en un cobro, las emitidas con algo por cobrar, como las ve el motor (cargarContexto).
  // La clave lleva «buscando»: useLeer solo vuelve a leer cuando cambia la clave (la e2e 44473982157 se quedó sin lista).
  const facturas = useLeer(buscando && !entra ? () => facturasPendientes(companyId) : null, `${companyId}:${m.id}:${buscando ? 'buscando' : 'no'}:facturas`)
  const emitidas = useLeer(buscando && entra ? () => facturasEmitidasPendientes(accountId, companyId, hoy) : null, `${companyId}:${m.id}:${buscando ? 'buscando' : 'no'}:emitidas`)
  const [textoFactura, setTextoFactura] = useState<string | null>(null)
  const [elegida, setElegida] = useState<FacturaPendiente | null>(null)
  const [emitida, setEmitida] = useState<FacturaEmitidaPendiente | null>(null)
  const si = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (buscando) document.getElementById(`kb-factura-${m.id}`)?.focus() }, [buscando, m.id])
  useEffect(() => { if (elegida || emitida) si.current?.focus() }, [elegida, emitida])
  const conFactura = elegida ? casadoConFactura(m, elegida) : emitida ? cobroConFactura(m, emitida) : null
  const lineasFactura = conFactura ? asientoQueSeCrea(m, conFactura.destino, banco?.cuenta ?? null) : null
  return (
    <div className="kb-que-es" data-prueba="que-es">
      <p className="kb-que-es-arriba"><span>{fechaVista(m.fecha)} · {quienEs(m)} · {entra ? 'ingreso' : 'pago'}</span><strong className="kf-cifra">{euros(Math.abs(m.importeCent))}</strong></p>
      {casado ? (
        <>
          <p data-prueba="conciliado"><strong>{m.casado!.porQuien === 'folvy' ? 'Hecho por Sumied' : 'Conciliado'}{porValidar(m) ? ', sin pasar al diario.' : ' · en el diario.'}</strong> {enPalabras(m.casado!.porque)}</p>
          {porValidar(m) && <button type="button" className="kf-guardar kb-si" disabled={ocupado} onClick={validarIt} data-prueba="validar">Pasarlo al diario</button>}
          <button type="button" className="kf-enlace" disabled={ocupado} onClick={deshacer} data-prueba="deshacer">Deshacer</button>
        </>
      ) : m.estado === 'ignorado' ? (
        <Apartado m={m} extractos={extractos} ocupado={ocupado} reabrir={reabrir} />
      ) : (
        <>
          {p?.que ? <p><strong>{p.que}</strong>{m.porque ? ` ${enPalabras(m.porque)}` : ''}</p> : m.porque ? <p>{enPalabras(m.porque)}</p> : null}
          {confirmable(m) && (
            <button type="button" className="kf-guardar kb-si" disabled={ocupado} onClick={confirmar} data-prueba="confirmar">Conciliar: es ese {entra ? 'ingreso' : 'pago'} <kbd>Intro</kbd></button>
          )}
          {!buscando && <button type="button" className="kf-enlace" onClick={() => ponerBuscando(true)} data-prueba="otra-factura">Es otra factura</button>}
          {entra && buscando && (
            <div className="kb-otra-factura" data-prueba="buscar-factura">
              <span className="kf-titulo">Es otra factura</span>
              <Buscador id={`kb-factura-${m.id}`} etiqueta="Factura" placeholder="Cliente o número de factura" abrir valor={textoFactura ?? ''} ponerTexto={setTextoFactura}
                cargando={emitidas.datos === null && !emitidas.error} lista={(t) => emitidasQueEncajan(m, emitidas.datos ?? [], t)}
                texto={(f) => `${f.cliente} · ${f.numero ?? 'sin número'} · del ${fechaVista(f.fecha)} · queda ${cifra(f.pendienteCent / 100)}`}
                elegir={(f) => { setEmitida(f); setTextoFactura(`${f.cliente} · ${f.numero ?? 'sin número'}`) }} />
              {emitidas.error && <p className="kf-aviso" data-tono="mal">{emitidas.error}</p>}
              {emitidas.datos && emitidas.datos.length === 0 && <p>No hay ninguna factura emitida por cobrar.</p>}
            </div>
          )}
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
          {emitida && conFactura && (
            <>
              <p><strong>Cobra la factura {emitida.numero ?? 'sin número'} de {emitida.cliente}.</strong> Del {fechaVista(emitida.fecha)}, queda {cifra(emitida.pendienteCent / 100)}.</p>
              <button type="button" ref={si} className="kf-guardar kb-si" disabled={ocupado} data-prueba="confirmar-factura"
                onClick={() => void hacer(() => casarConEmitida(m, emitida, quienEs(m)))}>Conciliar: es esa factura <kbd>Intro</kbd></button>
            </>
          )}
          {elegida && conFactura && (
            <>
              <p><strong>Paga la factura {elegida.numero ?? 'sin número'} de {elegida.proveedor}.</strong> Del {fechaVista(elegida.fecha)}, queda {cifra(elegida.pendienteCent / 100)}.</p>
              <button type="button" ref={si} className="kf-guardar kb-si" disabled={ocupado} data-prueba="confirmar-factura"
                onClick={() => void hacer(() => casarConFactura(m, elegida, quienEs(m)))}>Conciliar: es esa factura <kbd>Intro</kbd></button>
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

/** Un apartado: por qué, en palabras (el salto de saldo que lo delata, si lo apartó el banco), y «Volver a abrirlo». */
function Apartado({ m, extractos, ocupado, reabrir }: { m: MovimientoBanco; extractos: Parameters<typeof porQueApartado>[1]; ocupado: boolean; reabrir: () => void }) {
  const porque = useLeer(() => porQueApartado(m, extractos), `${m.id}:${m.motivoIgnorado}:apartado`)
  const fecha = fechaVista(m.fecha).slice(0, 5)
  return (
    <div className="kb-apartado" data-prueba="apartado">
      <p><strong>{porque.datos?.titulo ?? 'Apartado.'}</strong> {quienEs(m)}, {cifra(Math.abs(m.importeCent) / 100)}, del {fecha}.</p>
      {porque.datos?.detalle && <p className="kb-apoyo">{porque.datos.detalle}</p>}
      <button type="button" className="kf-enlace" disabled={ocupado} onClick={reabrir} data-prueba="reabrir">Volver a abrirlo</button>
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
