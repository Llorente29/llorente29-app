// src/modules/conta/nucleo/conciliar/PantallaConciliar.tsx
//
// X29 · «Gestión de extractos bancarios» de ERP10, en la cinta «Conciliar» (Julio, 23/11): la maqueta nucleo_23
// (aprobada) y, de la 23b y la 23c, lo del punto 3 del encargo. Pieza 1 del conciliador, con lo que ya hay en la base:
//   · los bancos a la izquierda (su barra y sus pendientes); los filtros (desde y hasta, por defecto desde el día de
//     inicio; subcuenta, validados y contabilizados sí/no/todos; buscar por concepto o importe; serie de tesorería);
//   · la lista en colores (verde contabilizado, amarillo pendiente, ámbar lo que propone Sumied, gris lo de antes del
//     inicio), con el saldo línea a línea y la columna «Por qué»; el pie con los recuentos y lo marcado;
//   · la barra: Contabilizar los marcados (Intro), Validar (F5), Quitar validación, No contabilizar, Permitir
//     contabilizar, Borrar líneas y Traer el extracto;
//   · la franja verde de lo que Sumied ha conciliado solo hoy («Verlos», «Deshacer alguno») y la ámbar de avisos;
//   · «Datos del movimiento», con el saldo de Sumied frente al del banco;
//   · el panel «Casar con facturas», plegable (Sumied recuerda por persona si está plegado): con UNA factura, como R08.
// Sin frases en pantalla: el porqué, en el title. Lo que no cabe se corta con «…» y el title lo dice entero.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { usePestana, useSeVe } from '@/modules/conta/diseno/plantillas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { desapartar, facturasPendientes, ignorar, leerDatosBancos, type BancoVista, type FacturaPendiente } from '@/modules/conta/services/bancosPantallas'
import { nombreCorto, PROPUESTA_RECALCULADA } from '@/modules/conta/lib/bancosVista'
import { quienEs } from '@/modules/conta/lib/conciliarVista'
import { atajoDeSubcuenta } from '@/modules/conta/lib/asientoNucleo'
import { cuentasDeApunte, localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { marcasDeLaCuenta, plataformasDeLaCuenta, type Opcion } from '@/modules/conta/services/asientoGeneralService'
import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import { fechaEscrita, fechaVista } from '../ficha/teclas'
import { useUltimo } from '../ficha/useUltimo'
import { Casilla, Ventana } from '../piezas/Ventana'
import { CasillaLupa } from '../piezas/Lupa'
import { Lineas, type Columna } from '../piezas/Lineas'
import { formatoImporte } from '../piezas/logica'
import { saldoALaFecha } from '../bancos/servicio'
import { casarConEmitida, casarConFactura, deshacerCasado, facturasEmitidasPendientes, textoDeshecho } from '../bancos/conciliar'
import { emitidasQueEncajan, facturasQueEncajan, type FacturaEmitidaPendiente } from '../bancos/factura'
import { enPalabras } from '../bancos/seleccion'
import { contabilizar, esDeHosteleria, leerFicheroDelExtracto } from '../tesoreria/servicio'
import { queHaceIntro, type LineaEd } from '../tesoreria/tesoreria'
import { borrarLineas, cuentasDeLosBancos, guardarPlegado, hechoHoy, leerBanco, leerPlegado, quitarValidacion, validar } from './servicio'
import {
  avisos, colorDe, contabilizada, filtrar, pendiente, porQueDe, recuento, saldos, siguientePendiente, textoDelPie, textoHechoHoy, textoMarcados, textosDeAvisos,
  type Filtros, type Linea, type Tri,
} from './conciliar'
import './conciliar.css'

const cifra = (cent: number | null | undefined) => (cent === null || cent === undefined ? '' : formatoImporte(cent / 100))
type Aviso = { texto: string; tono: 'bien' | 'ambar' | 'gris' }
const lineaVacia = (): LineaEd => ({ cuenta: null, concepto: '', local: null, marca: null, plataforma: null })

/** Sí / No / Todos, como los interruptores de ERP10. */
function TresPosiciones({ id, valor, poner, todos = 'Todos' }: { id: string; valor: Tri; poner: (t: Tri) => void; todos?: string }) {
  return (
    <span className="cn-tres" role="group" id={id}>
      {(['no', 'si', 'todos'] as const).map((t) => (
        <button key={t} type="button" aria-pressed={valor === t} onClick={() => poner(t)}>{t === 'no' ? 'No' : t === 'si' ? 'Sí' : todos}</button>
      ))}
    </span>
  )
}

/** Una fecha que se escribe como en ERP10 (12112026, 12/11, 12-11-26…). */
function Fecha({ id, iso, hoy, poner, etiqueta }: { id: string; iso: string; hoy: string; poner: (f: string) => void; etiqueta: string }) {
  const [texto, setTexto] = useState<string | null>(null)
  const fijar = () => { if (texto !== null) { const f = fechaEscrita(texto, hoy); if (f) poner(f); setTexto(null) } }
  return <input id={id} aria-label={etiqueta} value={texto ?? fechaVista(iso)} onChange={(e) => setTexto(e.target.value)} onBlur={fijar}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fijar() } }} />
}

/** Un texto que puede no caber: se corta con «…» y el title lo dice entero. */
const Corto = ({ t, className }: { t: string; className?: string }) => <span className={`cn-corto${className ? ` ${className}` : ''}`} title={t}>{t}</span>

export default function PantallaConciliar() {
  const cuentaConta = useCuentaConta()
  const accountId = cuentaConta.accountId ?? ''
  const userId = cuentaConta.userId ?? ''
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
  const enfocar = (donde: string) => setTimeout(() => document.querySelector<HTMLElement>(`.cn ${donde}`)?.focus(), 0)

  // Lo de la cuenta y la empresa (como Asiento manual, X28): los bancos, el plan, los locales, las marcas y las plataformas.
  const datos = useUltimo(useLeer(accountId && companyId ? () => leerDatosBancos(accountId, companyId) : null, `${accountId}:${companyId}:${vuelta}:datos`).datos, `${accountId}:${companyId}`)
  const base = useUltimo(useLeer(accountId && companyId ? async () => {
    const [cuentas, locales, marcas, plataformas, hosteleria] = await Promise.all([
      cuentasDeApunte(accountId, companyId), localesDeLaCuenta(accountId), marcasDeLaCuenta(accountId), plataformasDeLaCuenta(accountId), esDeHosteleria(companyId)])
    const locs: Opcion[] = [...locales.map((l, i) => ({ id: l.id, codigo: String(i + 1), descripcion: l.nombre })), { id: 'comun', codigo: 'C', descripcion: 'Común a todos los locales' }]
    return { cuentas, locales: locs, marcas, plataformas, hosteleria }
  } : null, `${accountId}:${companyId}:${vuelta}:base`).datos, `${accountId}:${companyId}`)
  const bancos = useMemo(() => (datos?.bancos ?? []).filter((b) => b.cuenta), [datos])
  const banco: BancoVista | null = bancos.find((b) => b.id === query.get('banco')) ?? bancos[0] ?? null
  const cuenta572 = banco?.cuenta ?? null
  const inicio = datos?.corte ?? null
  const serie = 3

  // Los filtros: por defecto, desde el día de inicio de la empresa hasta el final de este año, y todo.
  const [filtros, setFiltros] = useState<Filtros | null>(null)
  const deInicio = useMemo<Filtros>(() => ({ desde: inicio ?? `${hoy.slice(0, 4)}-01-01`, hasta: `${hoy.slice(0, 4)}-12-31`, subcuenta: 'todos', validados: 'todos', contabilizados: 'todos', buscar: '' }), [inicio, hoy])
  if (datos && !filtros) setFiltros(deInicio)
  const f = filtros ?? deInicio
  const poner = (x: Partial<Filtros>) => setFiltros({ ...f, ...x })

  const leida = useLeer(banco && filtros ? () => leerBanco(accountId, companyId, banco, f.desde, f.hasta, inicio) : null, `${banco?.id}:${f.desde}:${f.hasta}:${vuelta}`)
  const lectura = useUltimo(leida.datos, `${companyId}:${banco?.id}:${f.desde}:${f.hasta}`)
  const todas = useMemo(() => lectura?.lineas ?? [], [lectura])
  const saldoDe = useMemo(() => { const s = saldos(todas.map((l) => l.m), lectura?.base ?? null); return new Map(todas.map((l, i) => [l.m.id, s[i]])) }, [todas, lectura])
  const cuentas = useUltimo(useLeer(datos ? () => cuentasDeLosBancos(accountId, bancos, inicio) : null, `${companyId}:${bancos.length}:${inicio}:${vuelta}:cuentas`).datos, companyId)
  const hecho = useUltimo(useLeer(companyId ? () => hechoHoy(companyId, hoy) : null, `${companyId}:${hoy}:${vuelta}:hoy`).datos, companyId)
  const [verHoy, setVerHoy] = useState(false)
  const filas = useMemo(() => { const v = filtrar(todas, f); return verHoy && hecho ? v.filter((l) => hecho.movimientos.includes(l.m.id)) : v }, [todas, f, verHoy, hecho])
  const r = recuento(todas, lectura?.antesFuera ?? 0)

  // Lo elegido y lo marcado.
  const [selId, setSelId] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const sel = filas.findIndex((l) => l.m.id === selId)
  const l: Linea | null = sel >= 0 ? filas[sel] : null
  const m = l?.m ?? null
  const asientos = lectura?.asientos ?? {}
  const marcadas = filas.filter((x) => marcados.has(x.m.id))
  const abierto = useRef('')
  useEffect(() => {
    const k = `${banco?.id}`
    if (!lectura || abierto.current === k) return
    abierto.current = k
    const i = siguientePendiente(filas, -1)
    setSelId(filas[i >= 0 ? i : 0]?.m.id ?? null)
  }, [lectura, filas, banco?.id])

  // La línea que se edita («Datos del movimiento»): la suya (lo contabilizado, su asiento; si no, lo que propone Sumied).
  const originalDe = (x: Linea | null): LineaEd => {
    if (!x) return lineaVacia()
    const a = x.m.casado?.asientoId ? asientos[x.m.casado.asientoId] : null
    if (a) return { cuenta: a.cuenta, concepto: a.concepto, local: a.local, marca: a.marca, plataforma: a.plataforma }
    const d = x.m.propuesta?.destino as { concepto?: string } | null | undefined
    return { cuenta: x.subcuenta, concepto: d?.concepto?.trim() || x.m.conceptoLimpio.trim() || x.m.conceptoBanco.trim(), local: null, marca: null, plataforma: null }
  }
  const original = originalDe(l)
  const [ed, setEd] = useState<LineaEd>(lineaVacia())
  const [clave, setClave] = useState('')
  const claveAhora = `${m?.id ?? ''}:${m?.estado ?? ''}:${vuelta}`
  if (claveAhora !== clave) { setClave(claveAhora); setEd(original) }
  const registrosCuenta = useMemo(() => (base?.cuentas ?? []).map((c) => ({ id: c.code, codigo: c.code, descripcion: c.oficial })), [base])
  const nombreDe = (c: string | null) => (c ? registrosCuenta.find((x) => x.codigo === c)?.descripcion ?? datos?.nombres[c] ?? '' : '')
  const plan = useMemo(() => (base?.cuentas ?? []).map((c) => ({ code: c.code, nombre: c.oficial })), [base])
  const digitos = base?.cuentas[0]?.code.length ?? 8
  const escribe = !!l && !l.antes && !contabilizada(l) && l.m.estado !== 'ignorado'
  const enAmbar = escribe && !!ed.cuenta && ed.cuenta === original.cuenta && !!l?.m.propuesta?.destino
  const saldoSumied = useLeer(cuenta572 && m ? () => saldoALaFecha(companyId, cuenta572, m.fecha) : null, `${companyId}:${cuenta572}:${m?.fecha}:${vuelta}:sumied`).datos
  const saldoBanco = m ? saldoDe.get(m.id) ?? null : null

  // El panel «Casar con facturas», plegado o no, de cada persona.
  const [plegado, setPlegado] = useState<boolean | null>(null)
  useEffect(() => { if (accountId && userId) void leerPlegado(accountId, userId).then(setPlegado) }, [accountId, userId])
  const plegar = (x: boolean) => { setPlegado(x); if (accountId && userId) void guardarPlegado(accountId, userId, x).catch(() => undefined) }
  const propuestasFactura = filas.filter((x) => pendiente(x) && x.m.propuesta?.origen === 'factura').length

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
  const elegir = (i: number) => { const x = filas[i]; if (x) { setSelId(x.m.id); setTimeout(() => document.querySelector<HTMLElement>(`.cn tr[data-movimiento="${x.m.id}"]`)?.focus(), 0) } }
  const bajar = (desde: number) => { const j = siguientePendiente(filas, desde); if (j >= 0) elegir(j) }
  const objetivo = (fila: Linea | null = l): Linea[] => (marcadas.length ? marcadas : fila ? [fila] : [])

  /** Contabilizar los marcados (o el elegido), uno a uno, como Intro en Asiento manual: lo que propone Sumied, o la subcuenta de la línea. */
  const contabilizarMarcados = (fila: Linea | null = l) => {
    const lista = objetivo(fila).filter((x) => !x.antes && !contabilizada(x) && x.m.estado !== 'ignorado')
    if (lista.length === 0) { setAviso({ tono: 'ambar', texto: 'No hay nada que contabilizar entre lo marcado.' }); return }
    void hacer(async () => {
      let bien = 0, cent = 0
      const no: string[] = []
      for (const x of lista) {
        const linea = x.m.id === m?.id && x.m.id === fila?.m.id ? ed : originalDe(x)
        const i = queHaceIntro(x.m, linea, originalDe(x), cuenta572)
        if (i.que === 'recalcular') { await nucleo.conciliarPendientes(accountId, companyId, hoy); throw new Error(PROPUESTA_RECALCULADA) }
        if (i.que === 'propuesta' || i.que === 'cuenta') {
          try {
            const nombre = `${linea.cuenta} ${nombreDe(linea.cuenta)}`.trim()
            await contabilizar(x.m.id, i.destino, i.que === 'propuesta' ? (x.m.porque ?? x.m.propuesta?.que ?? 'Lo propone Sumied') : `Lo dijiste tú: ${nombre}.`)
            bien++; cent += Math.abs(x.m.importeCent)
          } catch (e) { no.push(`${quienEs(x.m)}: ${enPalabras(e instanceof Error ? e.message : String(e))}`) }
        } else if (i.que === 'nada' && i.porque) no.push(`${quienEs(x.m)}: ${i.porque.replace(/:.*$/, '')}`)
      }
      setMarcados(new Set())
      const hecho = bien === 0 ? 'No se ha contabilizado ninguno.' : `Contabilizados: ${bien === 1 ? '1 movimiento' : `${bien} movimientos`}, ${formatoImporte(cent / 100)} €, en el diario (serie ${serie}).`
      return no.length ? `${hecho} ${no.length === 1 ? 'Uno no' : `${no.length} no`}: ${no.join(' · ')}.` : hecho
    }, () => bajar(fila ? filas.indexOf(fila) : sel))
  }
  const validarMarcados = () => { const ids = objetivo().map((x) => x.m.id); if (ids.length) void hacer(() => validar(ids, quien)) }
  const quitarMarcados = () => { const ids = objetivo().filter((x) => x.validado).map((x) => x.m.id); if (ids.length) void hacer(() => quitarValidacion(ids)); else setAviso({ tono: 'ambar', texto: 'Ninguno de los marcados está validado.' }) }
  const noContabilizar = () => {
    const lista = objetivo().filter((x) => !contabilizada(x) && x.m.estado !== 'ignorado')
    if (!lista.length) { setAviso({ tono: 'ambar', texto: 'Lo marcado ya está contabilizado o sin contabilizar a propósito.' }); return }
    void hacer(async () => { for (const x of lista) await ignorar(x.m.id, 'No contabilizar (Conciliar)'); setMarcados(new Set()); return `No se contabilizará${lista.length === 1 ? '' : 'n'}: ${lista.length === 1 ? '1 movimiento' : `${lista.length} movimientos`}.` })
  }
  const permitir = () => {
    const lista = objetivo().filter((x) => x.m.estado === 'ignorado')
    if (!lista.length) return
    void hacer(async () => { for (const x of lista) await desapartar(x.m.id); setMarcados(new Set()); return `Se puede${lista.length === 1 ? '' : 'n'} contabilizar otra vez: ${lista.length === 1 ? '1 movimiento' : `${lista.length} movimientos`}.` })
  }
  const [confirmaBorrar, setConfirmaBorrar] = useState(false)
  const borrar = () => {
    const ids = objetivo().map((x) => x.m.id)
    if (!ids.length) return
    if (!confirmaBorrar) { setConfirmaBorrar(true); return }
    setConfirmaBorrar(false)
    void hacer(async () => { const t = await borrarLineas(ids, quien); setMarcados(new Set()); return t })
  }
  const deshacer = () => { if (m?.casado) void hacer(async () => textoDeshecho(quienEs(m), await deshacerCasado(m))) }
  const fichero = useRef<HTMLInputElement>(null)
  const leerFichero = (x: File) => { if (banco && datos) void hacer(() => leerFicheroDelExtracto(x, banco, datos.bancos, { accountId, companyId, hoy }), () => { abierto.current = '' }) }

  // El teclado: ↑ ↓ mueven, Espacio marca, Intro contabiliza, F5 valida; en «Datos del movimiento», Intro pasa a la siguiente.
  const enLista = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.metaKey) return
    if ((e.target as HTMLElement).closest('input, button, select')) return
    // La fila con el foco (no la elegida de antes): con ella trabajan ↑ ↓ y Espacio.
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-movimiento]')
    const i = tr ? filas.findIndex((x) => x.m.id === tr.dataset.movimiento) : sel
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); elegir(Math.max(0, Math.min(filas.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
    else if (e.key === ' ' && filas[i]) { e.preventDefault(); setSelId(filas[i].m.id); alternar(filas[i]) }
  }
  const alternar = (x: Linea) => setMarcados((s) => { const n = new Set(s); if (n.has(x.m.id)) n.delete(x.m.id); else if (!x.antes) n.add(x.m.id); return n })
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (!seVe() || e.defaultPrevented) return
      if (e.key === 'F5' && !e.ctrlKey) { e.preventDefault(); validarMarcados(); return }
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"]')) return
      if (confirmaBorrar) { setConfirmaBorrar(false); return }
      if (pestana?.cerrar) { e.preventDefault(); pestana.cerrar() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const orden = ['#cn-ed-subcuenta', '#cn-ed-concepto', '#cn-ed-local', ...(base?.hosteleria ? ['#cn-ed-marca', '#cn-ed-plataforma'] : [])]
  const pasar = (desde: string) => {
    const j = orden.indexOf(desde)
    if (j < 0 || j >= orden.length - 1) { contabilizarMarcados(); return }
    const ya = document.querySelector<HTMLElement>(`.cn ${orden[j + 1]}`)
    if (ya) ya.focus(); else enfocar(orden[j + 1])
  }
  const tecla = (desde: string) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.defaultPrevented) { e.preventDefault(); if (e.ctrlKey) contabilizarMarcados(); else pasar(desde) }
  }

  if (datos && bancos.length === 0) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar">No hay ningún banco con su subcuenta.</p></div>
  if (leida.error && !lectura) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar" role="alert">No se han podido leer los movimientos: {enPalabras(leida.error)}</p></div>
  const cargando = !lectura || !base

  const columnas: Columna[] = [
    { clave: 'marca', titulo: <span className="cn-sr">Marcar</span>, ancho: '24px' },
    { clave: 'fecha', titulo: 'Fecha', ancho: '86px' },
    { clave: 'banco', titulo: 'Concepto bancario' },
    { clave: 'asiento', titulo: 'Concepto del asiento' },
    { clave: 'importe', titulo: 'Importe', cifra: true, ancho: '78px' },
    { clave: 'saldo', titulo: 'Saldo', cifra: true, ancho: '90px' },
    { clave: 'subcuenta', titulo: 'Subcuenta', ancho: '76px' },
    { clave: 'nombre', titulo: 'Nombre', ancho: '10%' },
    { clave: 'porque', titulo: 'Por qué', ancho: '128px' },
    { clave: 'doc', titulo: 'Doc.', ancho: '52px' },
    { clave: 'validado', titulo: <span title="Validado">✓</span>, ancho: '22px' },
  ]
  const celda = (x: Linea, c: string): ReactNode => {
    const a = x.m.casado?.asientoId ? asientos[x.m.casado.asientoId] : null
    switch (c) {
      case 'marca': return <input type="checkbox" aria-label={`Marcar ${quienEs(x.m)}`} checked={marcados.has(x.m.id)} disabled={x.antes} tabIndex={-1}
        onClick={(e) => e.stopPropagation()} onChange={() => alternar(x)} />
      case 'fecha': return fechaVista(x.m.fecha)
      case 'banco': return <Corto t={x.m.conceptoBanco.trim() || x.m.conceptoLimpio} />
      case 'asiento': return <Corto t={a?.concepto || (x.m.propuesta?.destino as { concepto?: string } | undefined)?.concepto || x.m.conceptoLimpio} />
      case 'importe': return <span data-signo={x.m.importeCent < 0 ? 'menos' : undefined}>{x.m.estado === 'ignorado' ? <s>{cifra(x.m.importeCent)}</s> : cifra(x.m.importeCent)}</span>
      case 'saldo': return cifra(saldoDe.get(x.m.id))
      case 'subcuenta': return <span data-cuenta={x.subcuenta ?? undefined}>{x.subcuenta ?? ''}</span>
      case 'nombre': return <Corto t={nombreDe(x.subcuenta).toUpperCase()} />
      case 'porque': { const p = porQueDe(x); return p ? <span className="cn-porque" data-tono={p.tono} title={p.title}>{p.texto}</span> : null }
      case 'doc': return a?.numero ? <span title={`Asiento ${a.serie ?? serie}/${a.numero}`}>{`${a.serie ?? serie}/${a.numero}`}</span> : ''
      case 'validado': return x.validado ? <span title={`Validado${x.m.validado?.quien ? ` por ${x.m.validado.quien}` : ''}`}>✓</span> : ''
      default: return null
    }
  }

  const textoHoy = hecho ? textoHechoHoy(hecho) : null
  const listaAvisos = textosDeAvisos(avisos(todas, bancos.filter((b) => b.id === banco?.id).map((b) => ({ nombre: nombreCorto(b), leido: b.conexion?.leida ?? b.ultimoExtracto?.subido ?? null })), hoy))
  const pie = textoDelPie(r, inicio)
  const ip = m ? { ingreso: m.importeCent > 0, cent: m.importeCent } : null
  const marcadosTexto = textoMarcados(marcadas)

  const barra = (
    <div className="kp-barra cn-barra" role="toolbar" aria-label="La barra" data-pieza="barra">
      <button type="button" className="cn-principal" data-boton="contabilizar" disabled={ocupado} onClick={() => contabilizarMarcados()} title="Contabiliza los marcados (o el elegido) en el diario, serie 3">
        ✔ Contabilizar {marcadas.length ? 'los marcados' : 'el elegido'} <kbd>Intro</kbd>
      </button>
      <button type="button" data-boton="validar" disabled={ocupado} onClick={validarMarcados}>☑ Validar <kbd>F5</kbd></button>
      <button type="button" data-boton="quitar-validacion" disabled={ocupado} onClick={quitarMarcados}>☐ Quitar validación</button>
      <span className="cn-sep" aria-hidden="true" />
      <button type="button" data-boton="no-contabilizar" disabled={ocupado} onClick={noContabilizar}>⊘ No contabilizar</button>
      <button type="button" data-boton="permitir" disabled={ocupado || !objetivo().some((x) => x.m.estado === 'ignorado')} onClick={permitir}>↺ Permitir contabilizar</button>
      <button type="button" data-boton="borrar" disabled={ocupado} onClick={borrar} data-confirma={confirmaBorrar ? 'si' : undefined}>
        {confirmaBorrar ? `¿Borrar ${objetivo().length === 1 ? 'la línea' : `las ${objetivo().length}`}? Sí, borrar` : '🗑 Borrar líneas'}
      </button>
      <span className="cn-sep" aria-hidden="true" />
      <button type="button" data-boton="traer" disabled={ocupado} onClick={() => fichero.current?.click()} title="Norma 43 o Excel">⇪ Traer el extracto</button>
      <input ref={fichero} type="file" hidden accept=".n43,.q43,.aeb,.txt,.csv,.xls,.xlsx,text/plain,text/csv" aria-label="Fichero del extracto" data-prueba="fichero-extracto"
        onChange={(e) => { const x = e.target.files?.[0]; if (x) leerFichero(x); e.target.value = '' }} />
      {m?.casado && <button type="button" data-boton="deshacer" disabled={ocupado} onClick={deshacer} title="Lo quita del diario y vuelve a estar sin contabilizar">Deshacer</button>}
      {aviso && <div className="kp-barra-aviso"><span className="kp-aviso" data-tono={aviso.tono} role="status" title={aviso.texto} data-prueba="aviso-conciliar">{aviso.texto}</span></div>}
    </div>
  )

  return (
    <div className="cn" data-prueba="conciliar-nucleo" aria-busy={cargando || undefined}>
      <Ventana id="cn" titulo="Gestión de extractos bancarios" pestanas={[]} alCerrar={pestana?.cerrar}>
        {barra}
        {textoHoy && (
          <p className="cn-franja" data-tono="verde" data-prueba="hecho-hoy">
            <span>✔ {textoHoy}</span>
            <button type="button" className="cn-enlace" onClick={() => { setVerHoy((v) => !v); setAviso(null) }} aria-pressed={verHoy}>{verHoy ? 'Ver todos' : 'Verlos'}</button>
            <button type="button" className="cn-enlace" onClick={() => { setVerHoy(true); setAviso({ tono: 'gris', texto: 'Elige el que quieras deshacer y pulsa «Deshacer» en la barra.' }) }}>Deshacer alguno</button>
          </p>
        )}
        {listaAvisos.length > 0 && <p className="cn-franja" data-tono="ambar" data-prueba="avisos">{listaAvisos.map((t) => <span key={t}>⚠ {t}</span>)}</p>}
        <div className="cn-cuerpo" data-plegado={plegado ? 'si' : undefined}>
          <nav className="cn-bancos" aria-label="Bancos">
            {bancos.map((b) => {
              const c = cuentas?.[b.id]
              const leido = b.conexion?.leida
              return (
                <button key={b.id} type="button" className="cn-banco" aria-current={b.id === banco?.id ? 'true' : undefined} data-banco={b.id}
                  onClick={() => { const p = new URLSearchParams(query); p.set('banco', b.id); setQuery(p, { replace: true }); abierto.current = ''; setMarcados(new Set()); setAviso(null) }}>
                  <strong className="cn-corto" title={nombreCorto(b)}>{nombreCorto(b)}</strong>
                  <span className="cn-banco-cuenta">{b.cuenta}</span>
                  <span className="cn-banco-estado">{b.conexion ? `conectado${leido ? ` · leído ${leido.slice(0, 10) === hoy ? 'hoy' : fechaVista(leido.slice(0, 10)).slice(0, 5)} ${new Date(leido).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}` : ''}`
                    : b.ultimoExtracto ? `extracto subido el ${fechaVista(b.ultimoExtracto.subido.slice(0, 10)).slice(0, 5)}` : 'sin extracto'}</span>
                  {c && <span className="cn-barrita" aria-hidden="true"><span style={{ width: `${c.total ? Math.round((c.contabilizadas / c.total) * 100) : 100}%` }} /></span>}
                  {c && <span className="cn-banco-cuantos">{c.pendientes === 0 ? 'al día' : <>{c.contabilizadas} de {c.total} · <b>{c.pendientes} {c.pendientes === 1 ? 'pendiente' : 'pendientes'}</b></>}</span>}
                </button>
              )
            })}
          </nav>
          <div className="cn-centro">
            <div className="cn-filtros">
              <Casilla rotulo="Desde · Hasta" htmlFor="cn-desde" className="cn-fechas">
                <Fecha id="cn-desde" etiqueta="Desde" iso={f.desde} hoy={hoy} poner={(x) => poner({ desde: x })} />
                <Fecha id="cn-hasta" etiqueta="Hasta" iso={f.hasta} hoy={hoy} poner={(x) => poner({ hasta: x })} />
              </Casilla>
              <Casilla rotulo="Subcuenta" htmlFor="cn-f-subcuenta"><TresPosiciones id="cn-f-subcuenta" valor={f.subcuenta} poner={(x) => poner({ subcuenta: x })} todos="Todas" /></Casilla>
              <Casilla rotulo="Validados" htmlFor="cn-f-validados"><TresPosiciones id="cn-f-validados" valor={f.validados} poner={(x) => poner({ validados: x })} /></Casilla>
              <Casilla rotulo="Contabilizados" htmlFor="cn-f-contabilizados"><TresPosiciones id="cn-f-contabilizados" valor={f.contabilizados} poner={(x) => poner({ contabilizados: x })} /></Casilla>
              <Casilla rotulo="Buscar (concepto, importe)" htmlFor="cn-buscar" className="cn-buscar">
                <input id="cn-buscar" value={f.buscar} onChange={(e) => poner({ buscar: e.target.value })} title={f.buscar || undefined} />
              </Casilla>
              <Casilla rotulo="Serie de tesorería" htmlFor="cn-serie" gris><input id="cn-serie" readOnly tabIndex={-1} value={`${serie} · TESORERÍA`} /></Casilla>
            </div>
            <div className="cn-lista" onKeyDown={enLista}>
              {cargando ? <p className="cn-cargando" aria-busy="true">Leyendo los movimientos…</p> : (
                <Lineas etiqueta="Movimientos del extracto" columnas={columnas} filas={filas} celda={celda} elegida={sel >= 0 ? sel : null}
                  alElegir={(i) => setSelId(filas[i]?.m.id ?? null)} alIntro={(i) => { setSelId(filas[i]?.m.id ?? null); contabilizarMarcados(filas[i] ?? null) }}
                  claseFila={(x) => ({ 'data-movimiento': x.m.id, 'data-color': colorDe(x), 'data-marcado': marcados.has(x.m.id) ? 'si' : undefined, 'data-contabilizado': contabilizada(x) ? 'si' : undefined })}
                  vacia="No hay movimientos con estos filtros."
                  suma={(
                    <div className="cn-pie" data-prueba="pie">
                      <span className="cn-pie-cuenta">{pie.map((t, i) => <span key={t} data-parte={i}>{t}</span>)}</span>
                      {marcadosTexto && <strong data-prueba="marcados">{marcadosTexto}</strong>}
                    </div>
                  )} />
              )}
            </div>
            <section className="cn-datos" aria-label="Datos del movimiento" data-prueba="datos-movimiento">
              <h2 className="kp-bloque-titulo"><span>Datos del movimiento</span></h2>
              <div className="cn-datos-uno">
                <Casilla rotulo="Fecha" htmlFor="cn-ed-fecha" gris><input id="cn-ed-fecha" readOnly tabIndex={-1} value={m ? fechaVista(m.fecha) : ''} /></Casilla>
                <Casilla rotulo="Concepto bancario" htmlFor="cn-ed-banco" gris><input id="cn-ed-banco" readOnly tabIndex={-1} value={m?.conceptoBanco ?? ''} title={m?.conceptoBanco} /></Casilla>
                <Casilla rotulo="Concepto del asiento" htmlFor="cn-ed-concepto" gris={!escribe}>
                  <input id="cn-ed-concepto" readOnly={!escribe} value={ed.concepto} title={ed.concepto} onChange={(e) => setEd((x) => ({ ...x, concepto: e.target.value }))} onKeyDown={tecla('#cn-ed-concepto')} />
                </Casilla>
                <Casilla rotulo="Importe" htmlFor="cn-ed-importe" gris><input id="cn-ed-importe" className="kp-num" readOnly tabIndex={-1} value={ip ? cifra(ip.cent) : ''} /></Casilla>
                <Casilla rotulo="Subcuenta" htmlFor="cn-ed-subcuenta" gris={!escribe} ambar={enAmbar}>
                  <CasillaLupa id="cn-ed-subcuenta" etiqueta="Subcuenta" registros={registrosCuenta} valor={ed.cuenta} gris={!escribe} ambar={enAmbar}
                    resolver={(texto) => { const a = atajoDeSubcuenta(texto, digitos, plan); const c = a.codigo ? registrosCuenta.find((x) => x.codigo === a.codigo) ?? null : null; return { registro: c, abrir: !c } }}
                    poner={(x) => setEd((y) => ({ ...y, cuenta: x?.codigo ?? null }))} alIntro={() => pasar('#cn-ed-subcuenta')}
                    teclas={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); contabilizarMarcados() } else if (e.key === 'Enter') { e.preventDefault(); pasar('#cn-ed-subcuenta') } }} />
                </Casilla>
                <Casilla rotulo="" htmlFor="cn-ed-nombre" gris><input id="cn-ed-nombre" readOnly tabIndex={-1} aria-label="Nombre de la subcuenta" value={nombreDe(ed.cuenta).toUpperCase()} title={nombreDe(ed.cuenta)} /></Casilla>
              </div>
              <div className="cn-datos-dos" data-hosteleria={base?.hosteleria ? 'si' : undefined}>
                <Casilla rotulo="Local" htmlFor="cn-ed-local" gris={!escribe}>
                  <CasillaLupa id="cn-ed-local" etiqueta="Local" registros={base?.locales ?? []} valor={ed.local} gris={!escribe} vista={(x) => x.descripcion}
                    poner={(x) => setEd((y) => ({ ...y, local: x?.id ?? null }))} alIntro={() => pasar('#cn-ed-local')} teclas={tecla('#cn-ed-local')} />
                </Casilla>
                {base?.hosteleria && <>
                  <Casilla rotulo="Marca" htmlFor="cn-ed-marca" gris={!escribe}>
                    <CasillaLupa id="cn-ed-marca" etiqueta="Marca" registros={base.marcas} valor={ed.marca} gris={!escribe} vista={(x) => x.descripcion}
                      poner={(x) => setEd((y) => ({ ...y, marca: x?.id ?? null }))} alIntro={() => pasar('#cn-ed-marca')} teclas={tecla('#cn-ed-marca')} />
                  </Casilla>
                  <Casilla rotulo="Plataforma" htmlFor="cn-ed-plataforma" gris={!escribe}>
                    <CasillaLupa id="cn-ed-plataforma" etiqueta="Plataforma" registros={base.plataformas} valor={ed.plataforma} gris={!escribe} vista={(x) => x.descripcion}
                      poner={(x) => setEd((y) => ({ ...y, plataforma: x?.id ?? null }))} alIntro={() => pasar('#cn-ed-plataforma')} teclas={tecla('#cn-ed-plataforma')} />
                  </Casilla>
                </>}
                <Casilla rotulo="Validar" htmlFor="cn-ed-validar">
                  <input id="cn-ed-validar" type="checkbox" checked={!!l?.validado} disabled={!l || ocupado}
                    onChange={() => { if (l) void hacer(() => (l.validado ? quitarValidacion([l.m.id]) : validar([l.m.id], quien))) }} />
                </Casilla>
                <Casilla rotulo="Saldo Sumied" htmlFor="cn-saldo-sumied" gris><input id="cn-saldo-sumied" className="kp-num" readOnly tabIndex={-1} value={cifra(saldoSumied)} /></Casilla>
                <Casilla rotulo="Saldo del banco" htmlFor="cn-saldo-banco" gris><input id="cn-saldo-banco" className="kp-num" readOnly tabIndex={-1} value={cifra(saldoBanco)} /></Casilla>
                <Casilla rotulo="Cuadra" htmlFor="cn-cuadra" gris ambar={saldoSumied !== null && saldoSumied !== undefined && saldoBanco !== null && saldoSumied !== saldoBanco}>
                  <input id="cn-cuadra" readOnly tabIndex={-1} className="cn-cuadra"
                    value={saldoSumied === null || saldoSumied === undefined || saldoBanco === null ? '' : saldoSumied === saldoBanco ? '✓' : '✗'}
                    title={saldoSumied !== null && saldoSumied !== undefined && saldoBanco !== null && saldoSumied !== saldoBanco ? `Sumied ${cifra(saldoSumied)} y el banco ${cifra(saldoBanco)}: no cuadran` : undefined} />
                </Casilla>
              </div>
            </section>
          </div>
          {plegado ? (
            <button type="button" className="cn-panel-plegado" onClick={() => plegar(false)} data-prueba="casar-plegado" aria-expanded="false"
              title="Desplegar «Casar con facturas»">‹ Casar con facturas · {propuestasFactura === 1 ? '1 propuesta' : `${propuestasFactura} propuestas`}</button>
          ) : (
            <CasarConFacturas l={l} companyId={companyId} accountId={accountId} hoy={hoy} ocupado={ocupado}
              plegar={() => plegar(true)} hacer={(q) => hacer(q, () => bajar(sel))} />
          )}
        </div>
      </Ventana>
    </div>
  )
}

/** El panel «Casar con facturas» (maqueta 23b), con UNA factura en esta pieza: la que paga o cobra el movimiento elegido. */
function CasarConFacturas({ l, companyId, accountId, hoy, ocupado, plegar, hacer }: {
  l: Linea | null; companyId: string; accountId: string; hoy: string; ocupado: boolean
  plegar: () => void; hacer: (q: () => Promise<string>) => void
}) {
  const m = l && pendiente(l) ? l.m : null
  const entra = (m?.importeCent ?? 0) > 0
  const recibidas = useLeer(m && !entra ? () => facturasPendientes(companyId) : null, `${companyId}:${m?.id}:recibidas`)
  const emitidas = useLeer(m && entra ? () => facturasEmitidasPendientes(accountId, companyId, hoy) : null, `${companyId}:${m?.id}:emitidas`)
  const [texto, setTexto] = useState('')
  const [elegida, setElegida] = useState<string | null>(null)
  const lista: (FacturaPendiente | FacturaEmitidaPendiente)[] = !m ? [] : entra ? emitidasQueEncajan(m, emitidas.datos ?? [], texto).slice(0, 6) : facturasQueEncajan(m, recibidas.datos ?? [], texto).slice(0, 6)
  const propuesta = (m?.propuesta?.destino as { facturas?: { id: string }[] } | undefined)?.facturas?.[0]?.id ?? null
  const id = elegida && lista.some((x) => x.id === elegida) ? elegida : propuesta && lista.some((x) => x.id === propuesta) ? propuesta : null
  const f = lista.find((x) => x.id === id) ?? null
  const dif = f && m ? Math.abs(m.importeCent) - f.pendienteCent : null
  const quienDe = (x: FacturaPendiente | FacturaEmitidaPendiente) => ('proveedor' in x ? x.proveedor : x.cliente)
  const conciliar = () => {
    if (!m || !f) return
    hacer(() => ('proveedor' in f ? casarConFactura(m, f, quienEs(m)) : casarConEmitida(m, f as FacturaEmitidaPendiente, quienEs(m))))
  }
  return (
    <aside className="cn-panel" aria-label="Casar con facturas" data-prueba="casar-desplegado">
      <header><strong>Casar con facturas</strong><button type="button" className="cn-plegar" onClick={plegar} title="Plegar el panel" aria-label="Plegar el panel">›</button></header>
      {!m ? <p className="cn-panel-nota">{l && contabilizada(l) ? 'Contabilizado.' : 'Elige un movimiento sin contabilizar.'}</p> : (
        <>
          <p className="cn-panel-nota" title={m.conceptoBanco}>{quienEs(m)} · {entra ? 'cobro' : 'pago'} del {fechaVista(m.fecha).slice(0, 5)} · {formatoImporte(Math.abs(m.importeCent) / 100)} €</p>
          <ul className="cn-facturas" role="radiogroup" aria-label="Facturas">
            {lista.map((x) => (
              <li key={x.id}>
                <label title={`${quienDe(x)} · ${x.numero ?? 'sin número'} · del ${fechaVista(x.fecha)}`}>
                  <input type="radio" name="cn-factura" checked={x.id === id} onChange={() => setElegida(x.id)} />
                  <span className="cn-corto">{x.numero ?? 'sin número'} · {quienDe(x)}</span>
                  <b>{formatoImporte(x.pendienteCent / 100)}</b>
                </label>
              </li>
            ))}
            {lista.length === 0 && <li className="cn-panel-nota">{(entra ? emitidas : recibidas).datos === null ? 'Buscando…' : `Ninguna factura ${entra ? 'emitida por cobrar' : 'recibida sin pagar'} encaja.`}</li>}
          </ul>
          <input className="cn-panel-buscar" aria-label="Buscar otra factura" placeholder="Buscar otra factura: proveedor, número o importe" value={texto} onChange={(e) => setTexto(e.target.value)} />
          {f && dif !== null && (
            <dl className="cn-panel-cuentas">
              <dt>Factura</dt><dd>{formatoImporte(f.pendienteCent / 100)}</dd>
              <dt>Movimiento</dt><dd>{formatoImporte(Math.abs(m.importeCent) / 100)}</dd>
              <dt>Diferencia</dt><dd data-tono={dif !== 0 ? 'ambar' : undefined}>{formatoImporte(dif / 100)}</dd>
            </dl>
          )}
          <button type="button" className="cn-principal" disabled={!f || ocupado} onClick={conciliar} data-prueba="conciliar-factura">Conciliar con la factura</button>
        </>
      )}
    </aside>
  )
}
