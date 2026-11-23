// src/modules/conta/nucleo/tesoreria/PantallaTesoreria.tsx
//
// X28 · Tesorería como ERP10: «Introducción de asientos por tesorería» (maqueta nucleo_21, aprobada; ERP10, captura
// 09_tesoreria). Sustituye a la pantalla de bancos del núcleo (E05 y R08) para contabilizar los movimientos; las reglas
// y la conexión con el banco se quedan donde están (Bancos). Hecha con las piezas comunes del K12 (nucleo/piezas):
//   · la ventana, con la pestaña «Movimientos» abajo, y la barra (guardar es Intro; nuevo, ⊕ otro movimiento);
//   · «Banco»: periodo, subcuenta del banco con su lupa y su nombre, saldo a la fecha y «Leer fichero de extracto
//     bancario» (Norma 43 o Excel, aquí mismo; con el banco conectado dice cuándo fue la última lectura);
//   · «Movimientos», uno por fila: documento (el número de su asiento), fecha, subcuenta y nombre, concepto, ingreso y
//     pago (no debe y haber). Sin contabilizar, la subcuenta que propone Sumied, en ámbar; si no sabe, en blanco;
//   · debajo, la línea que se edita: documento, fecha, subcuenta con lupa, saldo a la fecha, concepto, ingreso o pago,
//     y local, marca y plataforma (marca y plataforma, solo en una empresa de hostelería);
//   · los totales: ingresos, pagos y saldo final, con «⊕ otro movimiento · N movimientos · M sin contabilizar»;
//   · a la derecha, el documento: la factura que paga o cobra, con lo pendiente antes de este movimiento, o el
//     justificante (que se adjunta arrastrándolo).
// Intro contabiliza (serie 3, en el diario: el último paso del R08) y baja al siguiente sin contabilizar; si paga una
// factura, la deja pagada. Lo contabilizado se cambia con el mismo número mientras el IVA de su trimestre no esté
// presentado (0800). «Deshacer» lo quita (no lo cambia). Sin «marcar varios» (respuesta X28 · 1, decisión 3).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { usePestana, useSeVe } from '@/modules/conta/diseno/plantillas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { leerDatosBancos, subirTicket, type BancoVista } from '@/modules/conta/services/bancosPantallas'
import { bancoInicial, mesInicial } from '@/modules/conta/bancos/navegacion'
import { mesesElegibles, nombreCorto, PROPUESTA_RECALCULADA, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { quienEs } from '@/modules/conta/lib/conciliarVista'
import { atajoDeSubcuenta } from '@/modules/conta/lib/asientoNucleo'
import { cuentasDeApunte, localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { marcasDeLaCuenta, plataformasDeLaCuenta, type Opcion } from '@/modules/conta/services/asientoGeneralService'
import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import { fechaEscrita, fechaVista } from '../ficha/teclas'
import { useUltimo } from '../ficha/useUltimo'
import { Barra, Bloque, Casilla, Ventana } from '../piezas/Ventana'
import { CasillaLupa } from '../piezas/Lupa'
import { ConDocumento, DocumentoDerecha } from '../piezas/Documento'
import { Lineas, type Columna } from '../piezas/Lineas'
import { CasillaImporte } from '../piezas/Importe'
import { formatoImporte, leerImporte } from '../piezas/logica'
import { apartarNoCobrados, leerBancos, saldoALaFecha, textoApartados, urlDelJustificante } from '../bancos/servicio'
import { deshacerCasado, textoDeshecho } from '../bancos/conciliar'
import { mesDeAlLado, textoMes } from '../bancos/mes'
import { enPalabras } from '../bancos/seleccion'
import {
  asientosDeTesoreria, contabilizar, esDeHosteleria, facturaDelMovimiento, leerFicheroDelExtracto, modificar, otroMovimiento, sePuedeModificar,
  type AsientoDeTesoreria, type FacturaDelMovimiento,
} from './servicio'
import { facturaDeLaPropuesta, ingresoYPago, queHaceIntro, siguienteSinContabilizar, subcuentaDeFila, totalesDe, textoDelPie, type LineaEd } from './tesoreria'
import './tesoreria.css'

/** Lo menos que ocupa la pantalla sin plegar el documento (a 1366, sin cortar ningún rótulo). */
const MINIMO_PANTALLA = 860
const cifra = (cent: number | null | undefined) => (cent === null || cent === undefined ? '' : formatoImporte(cent / 100))
type Aviso = { texto: string; tono: 'bien' | 'ambar' | 'gris' }
const lineaVacia = (): LineaEd => ({ cuenta: null, concepto: '', local: null, marca: null, plataforma: null })

export default function PantallaTesoreria() {
  const cuentaConta = useCuentaConta()
  const accountId = cuentaConta.accountId ?? ''
  const quien = cuentaConta.userName ?? null
  const { activa } = useEmpresas()
  const companyId = activa?.id ?? ''
  const pestana = usePestana()
  const seVe = useSeVe()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [sel, setSel] = useState(-1)
  const [nuevo, setNuevo] = useState(false)

  const enfocar = (donde: string) => setTimeout(() => document.querySelector<HTMLElement>(`.ts ${donde}`)?.focus(), 0)

  // Al abrir, lo que el banco no cobró se aparta solo (como Bancos del núcleo), y se dice.
  const apartado = useRef('')
  useEffect(() => {
    if (!companyId || apartado.current === companyId) return
    apartado.current = companyId
    void apartarNoCobrados(companyId).then((xs) => { const t = textoApartados(xs); if (t) { setAviso({ tono: 'ambar', texto: t }); setVuelta((v) => v + 1) } }).catch(() => undefined)
  }, [companyId])

  // Lo de la cuenta y la empresa: los bancos, el plan, los locales, las marcas, las plataformas y si es de hostelería.
  const datos = useUltimo(useLeer(accountId && companyId ? () => leerDatosBancos(accountId, companyId) : null, `${accountId}:${companyId}:${vuelta}:datos`).datos, `${accountId}:${companyId}`)
  const base = useLeer(accountId && companyId ? async () => {
    const [cuentas, locales, marcas, plataformas, hosteleria] = await Promise.all([
      cuentasDeApunte(accountId, companyId), localesDeLaCuenta(accountId), marcasDeLaCuenta(accountId), plataformasDeLaCuenta(accountId), esDeHosteleria(companyId)])
    const locs: Opcion[] = [...locales.map((l, i) => ({ id: l.id, codigo: String(i + 1), descripcion: l.nombre })), { id: 'comun', codigo: 'C', descripcion: 'Común a todos los locales' }]
    return { cuentas, locales: locs, marcas, plataformas, hosteleria }
  } : null, `${accountId}:${companyId}:${vuelta}:base`).datos
  const bancos = useMemo(() => datos?.bancos ?? [], [datos])
  const banco: BancoVista | null = bancos.find((b) => b.id === query.get('banco')) ?? bancoInicial(bancos, datos?.dudas ?? {})
  const meses = useMemo(() => (datos ? mesesElegibles(datos.primerMovimiento, hoy) : []), [datos, hoy])
  const pedido = query.get('mes')
  const mes = datos && banco ? (pedido && meses.includes(pedido) ? pedido : mesInicial(meses, banco, hoy)) : null
  const cuenta572 = banco?.cuenta ?? null

  const leida = useLeer(datos && banco && mes ? async () => {
    const l = await leerBancos(accountId, companyId, datos, banco, mes, hoy)
    const asientos = await asientosDeTesoreria(companyId, l.movs.map((m) => m.casado?.asientoId).filter((x): x is string => !!x), banco.cuenta)
    return { ...l, asientos }
  } : null, `${companyId}:${banco?.id}:${mes}:${vuelta}`)
  const lectura = useUltimo(leida.datos, `${companyId}:${banco?.id}:${mes}`)
  const movs = useMemo(() => lectura?.movs ?? [], [lectura])
  const asientos: Record<string, AsientoDeTesoreria> = lectura?.asientos ?? {}
  const m: MovimientoBanco | null = nuevo ? null : movs[sel] ?? null
  const asientoDe = (x: MovimientoBanco | null) => (x?.casado?.asientoId ? asientos[x.casado.asientoId] ?? null : null)
  const t = totalesDe(movs)

  const registrosCuenta = useMemo(() => (base?.cuentas ?? []).map((c) => ({ id: c.code, codigo: c.code, descripcion: c.oficial })), [base])
  const nombreDe = (c: string | null) => (c ? registrosCuenta.find((r) => r.codigo === c)?.descripcion ?? datos?.nombres[c] ?? '' : '')
  const plan = useMemo(() => (base?.cuentas ?? []).map((c) => ({ code: c.code, nombre: c.oficial })), [base])
  const digitos = base?.cuentas[0]?.code.length ?? 8
  const registrosBanco = useMemo(() => bancos.filter((b) => b.cuenta).map((b) => ({ id: b.id, codigo: b.cuenta!, descripcion: nombreCorto(b) })), [bancos])

  // La línea que se edita: al elegir una fila, la suya (lo contabilizado, su asiento; si no, lo que propone Sumied).
  const original: LineaEd = useMemo(() => {
    if (nuevo || !m) return lineaVacia()
    const a = asientoDe(m)
    if (a) return { cuenta: a.cuenta, concepto: a.concepto, local: a.local, marca: a.marca, plataforma: a.plataforma }
    const sc = subcuentaDeFila(m, cuenta572, null)
    const d = m.propuesta?.destino as { concepto?: string } | null | undefined
    return { cuenta: sc.codigo, concepto: d?.concepto?.trim() || m.conceptoLimpio.trim() || m.conceptoBanco.trim(), local: null, marca: null, plataforma: null }
  }, [nuevo, m, asientos, cuenta572]) // eslint-disable-line react-hooks/exhaustive-deps
  const [ed, setEd] = useState<LineaEd>(lineaVacia())
  const [clave, setClave] = useState('')
  const claveAhora = nuevo ? 'nuevo' : `${m?.id ?? ''}:${m?.estado ?? ''}:${m?.casado?.asientoId ?? ''}:${vuelta}`
  if (claveAhora !== clave) { setClave(claveAhora); setEd(original) }
  const [nuevoFecha, setNuevoFecha] = useState(hoy)
  const [nuevoIngreso, setNuevoIngreso] = useState('')
  const [nuevoPago, setNuevoPago] = useState('')

  // Lo contabilizado: si se puede cambiar (y la subcuenta).
  const asientoSel = asientoDe(m)
  const puede = useLeer(asientoSel ? () => sePuedeModificar(asientoSel.id) : null, `${asientoSel?.id ?? ''}:${vuelta}:puede`).datos
  const escribe = nuevo || (!!m && m.estado !== 'ignorado' && (!asientoSel || !!puede?.puede))
  const escribeSubcuenta = escribe && (!asientoSel || !!puede?.subcuenta)
  const enAmbar = !nuevo && !!m && !asientoSel && ed.cuenta !== null && ed.cuenta === original.cuenta && subcuentaDeFila(m, cuenta572, null).propuesta

  // El saldo del banco a la fecha (el del diario al final del periodo) y el de la subcuenta de la línea a su fecha.
  const saldoBanco = lectura?.cuadre?.libroCent ?? null
  const fechaLinea = nuevo ? nuevoFecha : m?.fecha ?? null
  const saldoLinea = useLeer(ed.cuenta && fechaLinea ? () => saldoALaFecha(companyId, ed.cuenta!, fechaLinea) : null, `${companyId}:${ed.cuenta}:${fechaLinea}:${vuelta}:saldo`).datos

  // A la derecha: la factura que paga o cobra (o la que propone), o el justificante.
  const leidaFactura = useLeer(m ? async () => ({ f: await facturaDelMovimiento(m, m.casado?.id ?? null, m.casado ? null : facturaDeLaPropuesta(m)) }) : null, `${m?.id ?? ''}:${m?.casado?.id ?? ''}:${vuelta}:factura`)
  const factura = { datos: leidaFactura.datos?.f ?? null, cargando: !!m && leidaFactura.datos === null && !leidaFactura.error }
  const justificante = useLeer(m?.ticket ? () => urlDelJustificante(m.ticket) : null, `${m?.id}:${m?.ticket}:ticket`)

  // Al abrir el banco y el periodo, el primero sin contabilizar.
  const abierto = useRef('')
  useEffect(() => {
    const k = `${banco?.id}:${mes}`
    if (!lectura || abierto.current === k) return
    abierto.current = k
    const i = siguienteSinContabilizar(movs, -1)
    setSel(i >= 0 ? i : movs.length ? 0 : -1)
    enfocar('#ts-ed-subcuenta')
  }, [lectura, movs, banco?.id, mes])

  const recargar = () => { setVuelta((v) => v + 1); refrescarCuentasMenu() }
  const hacer = async (que: () => Promise<string>, despues?: () => void) => {
    if (ocupado) return
    setOcupado(true)
    try { setAviso({ tono: 'bien', texto: await que() }); despues?.(); recargar() }
    catch (e) {
      const tx = enPalabras(e instanceof Error ? e.message : String(e))
      setAviso({ tono: 'ambar', texto: tx })
      if (tx === PROPUESTA_RECALCULADA) recargar()
    } finally { setOcupado(false) }
  }
  const elegir = (i: number) => { setNuevo(false); setSel(i); enfocar('#ts-ed-subcuenta') }

  /** Intro: contabiliza (o modifica) la línea y baja al siguiente sin contabilizar. */
  const contabilizarLinea = () => {
    if (nuevo) { apuntarNuevo(); return }
    if (!m) return
    const i = queHaceIntro(m, ed, original, cuenta572)
    const bajar = () => { const j = siguienteSinContabilizar(movs, sel); if (j >= 0 && j !== sel) elegir(j) }
    if (i.que === 'nada') { if (i.porque) setAviso({ tono: 'ambar', texto: i.porque }); else bajar(); return }
    if (i.que === 'recalcular') {
      void hacer(async () => { await nucleo.conciliarPendientes(accountId, companyId, hoy); throw new Error(PROPUESTA_RECALCULADA) })
      return
    }
    if (i.que === 'modificar') { void hacer(() => modificar(asientoSel!.id, i.cambios, quien), bajar); return }
    const nombre = `${ed.cuenta} ${nombreDe(ed.cuenta)}`.trim()
    void hacer(async () => {
      await contabilizar(m.id, i.destino, i.que === 'propuesta' ? (m.porque ?? m.propuesta?.que ?? 'Lo propone Sumied') : `Lo dijiste tú: ${nombre}.`)
      return `Contabilizado: ${quienEs(m)}, ${formatoImporte(Math.abs(m.importeCent) / 100)} a la ${nombre}, en el diario (serie 3).${i.que === 'propuesta' && facturaDeLaPropuesta(m) ? ' La factura queda pagada por lo que paga.' : ''}`
    }, bajar)
  }
  const apuntarNuevo = () => {
    const ingreso = leerImporte(nuevoIngreso), pago = leerImporte(nuevoPago)
    const importeCent = Math.round((ingreso - pago) * 100)
    if (!banco || !ed.cuenta || !importeCent || (ingreso > 0 && pago > 0)) {
      setAviso({ tono: 'ambar', texto: !ed.cuenta ? 'Falta la subcuenta: escríbela o búscala con F4.' : 'Pon el ingreso o el pago (uno de los dos).' })
      return
    }
    void hacer(() => otroMovimiento({ bancoId: banco.id, fecha: nuevoFecha, cuenta: ed.cuenta!, concepto: ed.concepto, importeCent, quien, local: ed.local, marca: ed.marca, plataforma: ed.plataforma }),
      () => { setEd(lineaVacia()); setNuevoIngreso(''); setNuevoPago(''); enfocar('#ts-ed-subcuenta') })
  }
  const deshacer = () => { if (m?.casado) void hacer(async () => textoDeshecho(quienEs(m), await deshacerCasado(m))) }

  // Las casillas de la línea, en el orden de Intro; en la última, contabiliza.
  const orden = [...(nuevo ? ['#ts-ed-fecha'] : []), '#ts-ed-subcuenta', '#ts-ed-concepto', ...(nuevo ? ['#ts-ed-ingreso', '#ts-ed-pago'] : []), '#ts-ed-local',
    ...(base?.hosteleria ? ['#ts-ed-marca', '#ts-ed-plataforma'] : [])]
  const pasar = (desde: string) => { const j = orden.indexOf(desde); if (j >= 0 && j < orden.length - 1) enfocar(orden[j + 1]); else contabilizarLinea() }
  const tecla = (desde: string) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.defaultPrevented) {
      e.preventDefault()
      if (e.ctrlKey) contabilizarLinea(); else pasar(desde)
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.ctrlKey) {
      e.preventDefault(); const j = sel + (e.key === 'ArrowDown' ? 1 : -1); if (j >= 0 && j < movs.length) elegir(j)
    }
  }

  const elegirBanco = (id: string) => { const p = new URLSearchParams(query); p.set('banco', id); p.delete('mes'); setQuery(p, { replace: true }); abierto.current = ''; setAviso(null); setNuevo(false) }
  const elegirMes = (x: string) => { const p = new URLSearchParams(query); p.set('mes', x); if (banco) p.set('banco', banco.id); setQuery(p, { replace: true }); abierto.current = ''; setAviso(null); setNuevo(false) }
  useEffect(() => {
    const f = (e: globalThis.KeyboardEvent) => {
      if (!seVe() || e.defaultPrevented) return
      const en = (e.target as HTMLElement | null)?.closest('input, textarea, select')
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.ctrlKey && !e.altKey && !e.metaKey && mes && !en) {
        e.preventDefault(); const otro = mesDeAlLado(meses, mes, e.key); if (otro !== mes) elegirMes(otro); return
      }
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"]')) return
      if (pestana?.cerrar) { e.preventDefault(); pestana.cerrar() }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  })

  // «Leer fichero de extracto bancario».
  const fichero = useRef<HTMLInputElement>(null)
  const leerFichero = (f: File) => {
    if (!banco || !datos) return
    void hacer(() => leerFicheroDelExtracto(f, banco, datos.bancos, { accountId, companyId, hoy }), () => { abierto.current = '' })
  }

  if (datos && bancos.length === 0) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar">No hay ningún banco dado de alta.</p></div>
  if (leida.error && !lectura) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar" role="alert">No se han podido leer los movimientos: {enPalabras(leida.error)}</p></div>
  const cargando = !lectura || !base

  const columnas: Columna[] = [
    { clave: 'doc', titulo: 'Doc.', ancho: '52px' },
    { clave: 'fecha', titulo: 'Fecha', ancho: '86px' },
    { clave: 'subcuenta', titulo: 'Subcuenta', ancho: '84px' },
    { clave: 'nombre', titulo: '', ancho: '27%' },
    { clave: 'concepto', titulo: 'Concepto' },
    { clave: 'ingreso', titulo: 'Ingreso', cifra: true, ancho: '86px' },
    { clave: 'pago', titulo: 'Pago', cifra: true, ancho: '86px' },
  ]
  const celda = (x: MovimientoBanco, c: string) => {
    const a = asientoDe(x)
    const sc = subcuentaDeFila(x, cuenta572, a?.cuenta ?? null)
    const ip = ingresoYPago(x.importeCent)
    const tachar = x.estado === 'ignorado'
    switch (c) {
      case 'doc': return a?.numero ?? ''
      case 'fecha': return fechaVista(x.fecha)
      case 'subcuenta': return <span data-cuenta={sc.codigo ?? undefined}>{sc.codigo ?? ''}</span>
      case 'nombre': return nombreDe(sc.codigo).toUpperCase()
      case 'concepto': return <span title={x.conceptoBanco}>{a?.concepto || x.conceptoBanco.trim() || x.conceptoLimpio}</span>
      case 'ingreso': return tachar && ip.ingresoCent ? <s>{cifra(ip.ingresoCent)}</s> : cifra(ip.ingresoCent)
      case 'pago': return tachar && ip.pagoCent ? <s>{cifra(ip.pagoCent)}</s> : cifra(ip.pagoCent)
      default: return null
    }
  }
  const ip = m ? ingresoYPago(m.importeCent) : { ingresoCent: null, pagoCent: null }
  const estadoLinea: Aviso | null = !m ? null
    : m.estado === 'ignorado' ? { tono: 'gris', texto: 'Apartado: el banco no lo cobró. Se abre otra vez en Bancos.' }
      : asientoSel && puede && !puede.puede ? { tono: 'gris', texto: puede.porque ?? 'No se puede cambiar.' }
        : asientoSel && puede && !puede.subcuenta ? { tono: 'gris', texto: puede.subcuentaPorque ?? '' }
          : null

  const edicion = (
    <div className="ts-edicion" data-cuenta={ed.cuenta ?? undefined} data-prueba="linea-tesoreria">
      <div className="ts-edicion-uno">
        <Casilla rotulo="Doc." htmlFor="ts-ed-doc" gris mide="cifra"><input id="ts-ed-doc" readOnly tabIndex={-1} value={asientoSel?.numero ?? ''} /></Casilla>
        <Casilla rotulo="Fecha" htmlFor="ts-ed-fecha" gris={!nuevo}>
          {nuevo ? <FechaEd id="ts-ed-fecha" iso={nuevoFecha} hoy={hoy} poner={setNuevoFecha} alIntro={() => pasar('#ts-ed-fecha')} />
            : <input id="ts-ed-fecha" readOnly tabIndex={-1} value={m ? fechaVista(m.fecha) : ''} />}
        </Casilla>
        <Casilla rotulo="Subcuenta" htmlFor="ts-ed-subcuenta" gris={!escribeSubcuenta} ambar={enAmbar}>
          <CasillaLupa id="ts-ed-subcuenta" etiqueta="Subcuenta" registros={registrosCuenta} valor={ed.cuenta} gris={!escribeSubcuenta} ambar={enAmbar}
            resolver={(texto) => { const a = atajoDeSubcuenta(texto, digitos, plan); const c = a.codigo ? registrosCuenta.find((r) => r.codigo === a.codigo) ?? null : null; return { registro: c, abrir: !c } }}
            poner={(r) => setEd((x) => ({ ...x, cuenta: r?.codigo ?? null }))} alIntro={() => pasar('#ts-ed-subcuenta')}
            teclas={(e) => { if (!escribeSubcuenta) tecla('#ts-ed-subcuenta')(e); else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); contabilizarLinea() } else if (e.ctrlKey) tecla('#ts-ed-subcuenta')(e); else if (e.key === 'Enter') { e.preventDefault(); pasar('#ts-ed-subcuenta') } }} />
        </Casilla>
        <Casilla rotulo="" htmlFor="ts-ed-nombre" gris><input id="ts-ed-nombre" readOnly tabIndex={-1} aria-label="Nombre de la subcuenta" value={nombreDe(ed.cuenta).toUpperCase()} /></Casilla>
        <Casilla rotulo="Saldo a la fecha" htmlFor="ts-ed-saldo" gris><input id="ts-ed-saldo" className="kp-num" readOnly tabIndex={-1} value={saldoLinea === null || saldoLinea === undefined ? '' : cifra(saldoLinea)} /></Casilla>
        <Casilla rotulo="Concepto" htmlFor="ts-ed-concepto" gris={!escribe}>
          <input id="ts-ed-concepto" readOnly={!escribe} value={ed.concepto} onChange={(e) => setEd((x) => ({ ...x, concepto: e.target.value }))} onKeyDown={tecla('#ts-ed-concepto')} />
        </Casilla>
        <Casilla rotulo="Ingreso" htmlFor="ts-ed-ingreso" gris={!nuevo}>
          {nuevo ? <CasillaImporte id="ts-ed-ingreso" valor={nuevoIngreso} poner={setNuevoIngreso} teclas={tecla('#ts-ed-ingreso')} />
            : <input id="ts-ed-ingreso" className="kp-num" readOnly tabIndex={-1} value={cifra(ip.ingresoCent)} />}
        </Casilla>
        <Casilla rotulo="Pago" htmlFor="ts-ed-pago" gris={!nuevo}>
          {nuevo ? <CasillaImporte id="ts-ed-pago" valor={nuevoPago} poner={setNuevoPago} teclas={tecla('#ts-ed-pago')} />
            : <input id="ts-ed-pago" className="kp-num" readOnly tabIndex={-1} value={cifra(ip.pagoCent)} />}
        </Casilla>
      </div>
      <div className="ts-edicion-dos" data-hosteleria={base?.hosteleria ? 'si' : undefined}>
        <Casilla rotulo="Local" htmlFor="ts-ed-local" gris={!escribe}>
          <CasillaLupa id="ts-ed-local" etiqueta="Local" registros={base?.locales ?? []} valor={ed.local} gris={!escribe} vista={(r) => r.descripcion}
            poner={(r) => setEd((x) => ({ ...x, local: r?.id ?? null }))} alIntro={() => pasar('#ts-ed-local')} teclas={tecla('#ts-ed-local')} />
        </Casilla>
        {base?.hosteleria && <>
          <Casilla rotulo="Marca" htmlFor="ts-ed-marca" gris={!escribe}>
            <CasillaLupa id="ts-ed-marca" etiqueta="Marca" registros={base.marcas} valor={ed.marca} gris={!escribe} vista={(r) => r.descripcion}
              poner={(r) => setEd((x) => ({ ...x, marca: r?.id ?? null }))} alIntro={() => pasar('#ts-ed-marca')} teclas={tecla('#ts-ed-marca')} />
          </Casilla>
          <Casilla rotulo="Plataforma" htmlFor="ts-ed-plataforma" gris={!escribe}>
            <CasillaLupa id="ts-ed-plataforma" etiqueta="Plataforma" registros={base.plataformas} valor={ed.plataforma} gris={!escribe} vista={(r) => r.descripcion}
              poner={(r) => setEd((x) => ({ ...x, plataforma: r?.id ?? null }))} alIntro={() => pasar('#ts-ed-plataforma')} teclas={tecla('#ts-ed-plataforma')} />
          </Casilla>
        </>}
      </div>
    </div>
  )

  const conexion = banco?.conexion
  const lectorTexto = conexion ? `${conexion.banco} · conectado${conexion.leida ? ` · último ${fechaVista(conexion.leida.slice(0, 10)).slice(0, 5)} ${new Date(conexion.leida).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}` : ''}`
    : 'Norma 43 o Excel'

  const izquierda = (
    <div className="ts-pantalla">
      <Barra
        guardar={{ hacer: contabilizarLinea, puede: escribe && !ocupado, titulo: asientoSel ? 'Guardar el cambio (Intro): el mismo número' : 'Contabilizar (Intro)' }}
        cancelar={{ hacer: () => { setEd(original); setNuevoIngreso(''); setNuevoPago('') }, puede: escribe, titulo: 'Cancelar lo escrito' }}
        nuevo={{ hacer: () => { setNuevo(true); setEd(lineaVacia()); setNuevoFecha(hoy); enfocar('#ts-ed-fecha') }, titulo: 'Otro movimiento (el que no vino en el extracto)' }}
        anterior={{ hacer: () => elegir(Math.max(0, sel - 1)), puede: !nuevo && sel > 0, titulo: 'El movimiento de antes (Ctrl ↑)' }}
        siguiente={{ hacer: () => elegir(Math.min(movs.length - 1, sel + 1)), puede: !nuevo && sel < movs.length - 1, titulo: 'El movimiento de después (Ctrl ↓)' }}
        documento={{ hacer: () => enfocar('.kp-documento-barra button'), hay: !!(factura.datos || m?.ticket), titulo: factura.datos ? `Factura ${factura.datos.numero}` : m?.ticket ? 'El justificante' : 'Sin documento' }}
        extra={m?.casado ? <button type="button" className="kp-barra-mas" disabled={ocupado} onClick={deshacer} data-prueba="deshacer">Deshacer</button> : undefined}
        aviso={<>
          {estadoLinea && <span className="kp-aviso" data-tono={estadoLinea.tono} role="status" title={estadoLinea.texto}>{estadoLinea.texto}</span>}
          {aviso && <span className="kp-aviso" data-tono={aviso.tono} role="status" title={aviso.texto} data-prueba="aviso-tesoreria">{aviso.texto}</span>}
        </>}
      />
      <div className="ts-cuerpo">
        <Bloque titulo="Banco" className="ts-banco">
          <div className="ts-fila-banco">
            <Casilla rotulo="Periodo" htmlFor="ts-periodo">
              <select id="ts-periodo" value={mes ?? ''} onChange={(e) => elegirMes(e.target.value)} data-prueba="periodo">
                {meses.map((x) => <option key={x} value={x} title={textoMes(x)}>{`${x.slice(5, 7)}/${x.slice(0, 4)}`}</option>)}
              </select>
            </Casilla>
            <Casilla rotulo="Subcuenta" htmlFor="ts-banco" mide="subcuenta">
              <CasillaLupa id="ts-banco" etiqueta="Subcuenta del banco" registros={registrosBanco} valor={banco?.id ?? null} titulo={banco ? `${banco.cuenta ?? ''} · ${nombreCorto(banco)}` : undefined}
                poner={(r) => { if (r) elegirBanco(r.id) }} alIntro={() => enfocar('#ts-ed-subcuenta')} />
            </Casilla>
            <Casilla rotulo="" htmlFor="ts-banco-nombre" gris mide="nombre"><input id="ts-banco-nombre" readOnly tabIndex={-1} aria-label="Nombre del banco" value={banco ? (banco.cuentaNombre ?? nombreCorto(banco)).toUpperCase() : ''} /></Casilla>
            <Casilla rotulo="Saldo a la fecha" htmlFor="ts-saldo" gris mide="corto"><input id="ts-saldo" className="kp-num" readOnly tabIndex={-1} value={cifra(saldoBanco)} /></Casilla>
            <Casilla rotulo="Leer fichero de extracto bancario" htmlFor="ts-lector" gris className="ts-lector"
              mas={<button type="button" className="ts-carpeta" aria-label="Leer fichero de extracto bancario" title="Norma 43 o Excel" disabled={ocupado} onClick={() => fichero.current?.click()}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" fill="#f2c14e" stroke="#c99a22" strokeWidth="1" /></svg>
              </button>}>
              <input id="ts-lector" readOnly tabIndex={-1} value={lectorTexto} title={lectorTexto} />
            </Casilla>
            <input ref={fichero} type="file" hidden accept=".n43,.q43,.aeb,.txt,.csv,.xls,.xlsx,text/plain,text/csv" aria-label="Fichero del extracto" data-prueba="fichero-extracto"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) leerFichero(f); e.target.value = '' }} />
          </div>
        </Bloque>
        <Bloque titulo="Movimientos" crece className="ts-movimientos">
          {cargando ? <p className="ts-cargando" aria-busy="true">Leyendo los movimientos…</p> : (
            <Lineas etiqueta="Movimientos" columnas={columnas} filas={movs} celda={celda} elegida={nuevo ? null : sel} alElegir={elegir}
              claseFila={(x) => ({ 'data-movimiento': x.id, 'data-ambar': subcuentaDeFila(x, cuenta572, null).propuesta && x.estado !== 'casado' ? 'si' : undefined, 'data-contabilizado': x.estado === 'casado' ? 'si' : undefined })}
              vacia={lectura?.cuadre?.frase ?? 'No hay movimientos en este periodo.'}
              edicion={edicion}
              otra={() => { setNuevo(true); setEd(lineaVacia()); setNuevoFecha(hoy); enfocar('#ts-ed-fecha') }}
              otraTexto={{ etiqueta: 'Otro movimiento', texto: `otro movimiento · ${textoDelPie(t)}` }}
              suma={(
                <div className="ts-totales" aria-label="Totales">
                  <Casilla rotulo="Total ingresos" htmlFor="ts-total-ingresos" gris><input id="ts-total-ingresos" className="kp-num" readOnly value={cifra(t.ingresosCent)} /></Casilla>
                  <Casilla rotulo="Total pagos" htmlFor="ts-total-pagos" gris><input id="ts-total-pagos" className="kp-num" readOnly value={cifra(t.pagosCent)} /></Casilla>
                  <Casilla rotulo="Saldo final" htmlFor="ts-saldo-final" gris><input id="ts-saldo-final" className="kp-num" readOnly value={cifra(saldoBanco)} /></Casilla>
                </div>
              )} />
          )}
        </Bloque>
      </div>
    </div>
  )

  return (
    <div className="ts" data-prueba="tesoreria-nucleo" aria-busy={cargando || undefined}>
      <Ventana id="ts" titulo="Introducción de asientos por tesorería" pestanas={['Movimientos']} alCerrar={pestana?.cerrar}>
        <ConDocumento minimo={MINIMO_PANTALLA} persona={accountId && cuentaConta.userId ? { cuenta: accountId, usuario: cuentaConta.userId } : null}
          izquierda={izquierda}
          derecha={<DocumentoDerecha
            documento={!m?.ticket ? null : justificante.datos === null && !justificante.error ? undefined : justificante.datos ? { url: justificante.datos, foto: !/\.pdf$/i.test(m.ticket), titulo: `El justificante de ${quienEs(m)}` } : null}
            alAdjuntar={m ? (f) => void hacer(async () => { await subirTicket(accountId, m.id, f); return `Justificante guardado en el movimiento de ${quienEs(m)}.` }) : undefined}
            acepta="image/*,application/pdf"
            vacio={<Factura f={factura.datos} cargando={factura.cargando} entra={(m?.importeCent ?? 0) > 0} />} />} />
      </Ventana>
    </div>
  )
}

/** La factura que se paga o se cobra (maqueta 21): número y de quién, fechas, total y lo pendiente antes de este movimiento. */
function Factura({ f, cargando, entra }: { f: FacturaDelMovimiento | null; cargando: boolean; entra: boolean }) {
  if (cargando) return <p aria-busy="true">Buscando el documento…</p>
  if (!f) return <p>Sin documento. Arrastra aquí el justificante, o pulsa «Adjuntar el documento».</p>
  return (
    <div className="ts-factura" data-prueba="factura-del-movimiento">
      <p className="ts-factura-titulo"><strong>Factura {f.numero}{f.quien ? ` · ${f.quien}` : ''}</strong></p>
      {f.fecha && <p>Fecha de emisión: {fechaVista(f.fecha)}</p>}
      {f.vence && <p>Vencimiento: {fechaVista(f.vence)}</p>}
      <p>Total: {formatoImporte(f.totalCent / 100)} €</p>
      <p>Pendiente antes de este {entra ? 'cobro' : 'pago'}: {formatoImporte(f.pendienteAntesCent / 100)} €</p>
    </div>
  )
}

/** Una fecha que se escribe como en ERP10 (12112026, 12/11, 12-11-26…). */
function FechaEd({ id, iso, hoy, poner, alIntro }: { id: string; iso: string; hoy: string; poner: (f: string) => void; alIntro: () => void }) {
  const [texto, setTexto] = useState<string | null>(null)
  const fijar = () => { if (texto !== null) { const f = fechaEscrita(texto, hoy); if (f) poner(f); setTexto(null) } }
  return (
    <input id={id} value={texto ?? fechaVista(iso)} onChange={(e) => setTexto(e.target.value)} onBlur={fijar}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fijar(); alIntro() } }} />
  )
}
