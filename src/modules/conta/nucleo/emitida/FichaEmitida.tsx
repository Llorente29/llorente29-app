// src/modules/conta/nucleo/emitida/FichaEmitida.tsx
//
// K05 · La ficha de la factura emitida en el núcleo (maqueta nucleo_4,
// aprobada por Julio el 17/11; ERP10, «Introducción de facturas expedidas»).
// Es la recibida dada la vuelta: el mismo sitio para cada cosa, con el cliente
// en lugar del proveedor, «A qué cuenta de venta va» y «Cómo se cobra».
//
// Tres modos:
//   · a mano (ventas/facturas/nueva): se escribe; «Guardar y siguiente» la
//     guarda y la valida (el asiento de conta_venta_emitir, asiento.ts), le
//     adjunta su PDF si se ha soltado, apunta el cobro si toca, lo dice todo
//     (regla 8) y deja la siguiente en blanco;
//   · rellenada (ventas/facturas/asiento/<asiento> de un asiento de expedida
//     propuesto o en borrador): se lee; como hoy, de un propuesto solo se
//     cambia la cuenta (cambiarCuenta: la duda de la cuenta de venta) y el
//     cobro; Intro valida y pasa a la siguiente de la cola;
//   · hecha sola (la emitida de Facturación con su asiento, o un asiento de
//     expedida ya validado): se lee, con «Hecha por Sumied».
// Hacer la factura (numerarla, emitirla) es de Facturación: la borrador y la
// rectificativa de Facturación se abren con su ficha de hoy (`hoy`).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as KE, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaEmitidaAsiento, rutaFacturasVenta, rutaNuevaFacturaVenta, rutaConta, CONTA } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { CrearDesdeBuscador } from '@/modules/conta/plan/CrearDesdeBuscador'
import { LineaErp10 } from '@/modules/conta/nucleo/ficha/LineaErp10'
import { useLineaErp10 } from '@/modules/conta/nucleo/ficha/useLineaErp10'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { useCambiosSinGuardar, useNombreDePestana, usePestana, useSeVe, useAvisoSalir } from '@/modules/conta/diseno/plantillas'
import { ACEPTA_PAPEL, importeEs, rehacerCuota, rehacerRetencion, otroTipo, type LineaIva } from '@/modules/conta/documentos/fichaRecibida'
import { guardarExpedidaPdf } from '@/modules/conta/services/documentosService'
import { cambiarCuenta, leerAsiento, localesDeLaCuenta, validar } from '@/modules/conta/services/diarioService'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { AsientoQueSale, AyudaTeclas, Casilla, CasillaFecha, Comprobaciones, Duda, EstadoFicha, NombreDeCuenta } from '../ficha/piezas'
import { Buscador } from '../ficha/Buscador'
import { MayorEnElPanel } from '../ficha/MayorEnElPanel'
import { PanelDocumento } from '../ficha/PanelDocumento'
import { cifra, TECLAS_DE_LA_EMITIDA } from '../ficha/textos'
import { useUltimo } from '../ficha/useUltimo'
import { cuentasQueEncajan, queHaceIntro, type CuentaDelPlan } from '../ficha/teclas'
import { dondeVaElFoco, dudaDelGasto, etiquetaDelAsiento, puedeGuardar, trimestreDe } from '../recibida/estado'
import { calendarioDe } from '../recibida/servicio'
import {
  asientoDeLaEmitida, borradorDesdeAsiento, borradorVacio, comprobacionesEmitida, estadoDeLaEmitida, ETIQUETAS_EMITIDA, fechaDelCobro, nombreDePestanaEmitida,
  queHaceElCobro, textoOperacionCliente, vaciasEmitida, type BorradorEmitida, type CuentasEmitida, type ModoEmitida,
} from './asiento'
import {
  apuntarCobro, asientoDeFacturacion, cobroDeLaFactura, colaEmitidas, deLaEmpresa, documentoDeLaEmitida, emitidaRepetida, guardarEmitida, mayorDelCliente, repartoDeVentas, ultimaCuentaDeCobro,
} from './servicio'

type Aviso = { tono: 'ok' | 'falta' | 'mal'; texto: string }
const num = (x: string): number | null => { const n = Number(x.replace(/\./g, '').replace(',', '.')); return x.trim() && Number.isFinite(n) ? n : null }

function casillasDe(raiz: HTMLElement | null): HTMLElement[] {
  return raiz ? Array.from(raiz.querySelectorAll<HTMLElement>('[data-casilla]')).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null) : []
}

export default function FichaEmitida({ de, hoy: deHoy }: { de: 'nueva' | 'factura' | 'asiento'; hoy?: ReactNode }) {
  const { facturaId = '', entryId: entryParam = '' } = useParams()
  const { state } = useLocation()
  const navegar = useNavigate()
  const pestana = usePestana()
  const seVe = useSeVe()
  const { accountId, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const { local: ejeLocal } = useAnalitica()
  const hoy = hoyEnMadrid()
  const empresa = activa?.id ?? null
  const [vuelta, setVuelta] = useState(0)
  const [completa, setCompleta] = useState<string | null>(null)
  // Dónde se ha puesto ya el foco y si alguien ha empezado a escribir en esta ficha (dondeVaElFoco).
  const focoPuesto = useRef('')
  const tocada = useRef('')

  // ── De qué emitida es: la de Facturación (su asiento), la del asiento, o una nueva ──
  // Envuelta: datos null es «leyendo»; { r: null }, que no tiene asiento (la de Facturación de hoy).
  const fac = useLeer(de === 'factura' && accountId && facturaId ? () => asientoDeFacturacion(accountId, facturaId).then((r) => ({ r })) : null, `${accountId}:${facturaId}:emitida-fac`)
  const entryId = de === 'asiento' ? entryParam : de === 'factura' ? fac.datos?.r?.entryId ?? '' : ''
  const claveFicha = de === 'nueva' ? 'nueva' : `${de}:${facturaId || entryParam}`
  const asientoL = useLeer(accountId && entryId ? () => leerAsiento(accountId, entryId) : null, `${accountId}:${entryId}:asiento:${vuelta}`)
  const asiento = useUltimo(asientoL.datos, entryId)
  const modo: ModoEmitida = de === 'nueva' ? 'a_mano' : asiento?.estado === 'validado' ? 'hecha_sola' : 'rellenada'
  const empL = useLeer(accountId && empresa ? () => deLaEmpresa(accountId, empresa, hoy) : null, `${accountId}:${empresa}:emitida-empresa:${vuelta}`)
  const emp = useUltimo(empL.datos, empresa ?? '')
  const calendario = useLeer(accountId && empresa ? () => calendarioDe(accountId, empresa) : null, `${accountId}:${empresa}:calendario`).datos ?? null
  const localesL = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}:locales`).datos
  const locales = useMemo(() => localesL ?? [], [localesL])
  const cola = useUltimo(useLeer(de === 'asiento' && accountId && empresa ? () => colaEmitidas(accountId, empresa) : null, `${accountId}:${empresa}:cola-emitidas:${vuelta}`).datos, empresa ?? '')
  const doc = useLeer(accountId && entryId ? () => documentoDeLaEmitida(accountId, entryId) : null, `${accountId}:${entryId}:doc:${vuelta}`)

  // ── El borrador ──
  const original = useMemo<BorradorEmitida>(() => (de === 'nueva' || !asiento ? borradorVacio(hoy) : borradorDesdeAsiento(asiento)), [de, asiento, hoy])
  const nombreCliente = useCallback((id: string) => emp?.clientes.find((c) => c.id === id)?.nombre ?? 'otro cliente', [emp])
  const formato = useMemo(() => (campo: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (campo === 'clienteId') return nombreCliente(String(v))
    if (campo === 'fecha' || campo === 'cobroFecha') return String(v).split('-').reverse().join('/')
    if (campo === 'iva' || campo === 'ventas') return `${(v as unknown[]).length} líneas`
    if (campo === 'retencion') return `${(v as { tipo: string }).tipo} %`
    return String(v)
  }, [nombreCliente])
  const ed = useCambiosSinGuardar<BorradorEmitida>(original, ETIQUETAS_EMITIDA, formato)
  const b = ed.valor
  const { reiniciar } = ed
  const deFicha = useRef(claveFicha)
  useEffect(() => { if (deFicha.current !== claveFicha) { deFicha.current = claveFicha; reiniciar(borradorVacio(hoy)) } }, [claveFicha, reiniciar, hoy])
  const soloLeer = modo !== 'a_mano'
  const [textoCliente, setTextoCliente] = useState<string | null>(null)
  const [textoCuenta, setTextoCuenta] = useState<Record<number, string>>({})
  const [textoCobro, setTextoCobro] = useState<string | null>(null)
  // X21 · Las subcuentas creadas desde los buscadores de esta ficha («No está: crear la …»): ya elegibles y con su nombre.
  const [creadas, setCreadas] = useState<CuentaDelPlan[]>([])
  const [fichero, setFichero] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => () => { if (fichero) URL.revokeObjectURL(fichero.url) }, [fichero])

  // ── Del cliente: su ficha, su mayor, lo aprendido de sus ventas, su último cobro ──
  const cliente = emp?.clientes.find((c) => c.id === b.clienteId) ?? null
  const sub = cliente?.subcuenta ?? null
  const mayor = useUltimo(useLeer(accountId && empresa && sub ? () => mayorDelCliente(accountId, empresa, sub.id, hoy) : null, `${accountId}:${empresa}:${sub?.id}:mayor:${vuelta}`).datos, `${claveFicha}:${b.clienteId}`)
  const reparto = useUltimo(useLeer(accountId && empresa && b.clienteId && modo !== 'hecha_sola' ? () => repartoDeVentas(accountId, empresa, b.clienteId, entryId || null) : null, `${accountId}:${empresa}:${b.clienteId}:${entryId}:reparto:${vuelta}`).datos, `${claveFicha}:${b.clienteId}`)
  // En la hecha sola, el cobro apuntado de verdad (o nada: pendiente de cobrar), nunca la propuesta de su ficha.
  const cobroApuntado = useLeer(modo === 'hecha_sola' && accountId && empresa && sub && b.numero ? () => cobroDeLaFactura(accountId, empresa, sub.id, b.numero) : null, `${accountId}:${empresa}:${sub?.id}:${b.numero}:cobro:${vuelta}`).datos ?? null
  const ultimoCobro = useLeer(accountId && empresa && sub && !cliente?.cobro ? () => ultimaCuentaDeCobro(accountId, empresa, sub.id) : null, `${accountId}:${empresa}:${sub?.id}:ultimo-cobro`).datos ?? null
  const repetida = useLeer(accountId && empresa && b.numero.trim() ? () => emitidaRepetida(accountId, empresa, b.numero, cliente?.nif ?? null, entryId || null) : null, `${accountId}:${empresa}:${b.numero}:${cliente?.nif}:${entryId}:repetida:${vuelta}`).datos ?? null

  // Lo que se propone donde nadie ha escrito: la cuenta de venta (la de su última factura, o la primera 70x) y el cobro (de su ficha o de la última).
  const ventaPropuesta = reparto?.[0]?.cuenta ?? emp?.ventas[0]?.codigo ?? ''
  const cobroPropuesto = cliente?.cobro ?? ultimoCobro ?? ''
  const origenCobro = b.cobroCuenta !== null ? null : cliente?.cobro ? 'de su ficha' : ultimoCobro ? 'de la última' : null
  const be: BorradorEmitida = useMemo(() => ({
    ...b,
    ventas: b.ventas.map((v, i) => (i === 0 && !v.cuenta && !soloLeer ? { ...v, cuenta: ventaPropuesta } : v)),
    cobroCuenta: b.cobroCuenta ?? cobroPropuesto,
    cobroFecha: b.cobroFecha ?? fechaDelCobro(b.fecha, cliente?.dias ?? null),
  }), [b, ventaPropuesta, cobroPropuesto, cliente?.dias, soloLeer])

  // ── El asiento que sale ──
  const cuentas: CuentasEmitida | null = useMemo(() => (emp ? {
    cliente: sub ? { codigo: sub.codigo, nombre: sub.nombre } : null, tipos: emp.tipos, retencion: emp.retencion,
    nombre: (c: string) => emp.nombres.get(c) ?? null,
  } : null), [emp, sub])
  const previa = cuentas ? asientoDeLaEmitida(be, cuentas, cliente?.nombre ?? null) : null
  const total = previa?.total ?? 0
  const cobroImporte = Math.round(((previa?.total ?? 0)) * 100) / 100
  const nombreVenta = useCallback((c: string) => emp?.nombres.get(c) ?? creadas.find((x) => x.codigo === c)?.nombre ?? 'Cuenta', [emp, creadas])
  const cuentasVenta: CuentaDelPlan[] = useMemo(() => [...(emp?.ventas ?? []).map((c) => ({ codigo: c.codigo, nombre: c.nombre })),
    ...creadas.filter((c) => !(emp?.ventas ?? []).some((v) => v.codigo === c.codigo))], [emp, creadas])
  /** X21 · «No está: crear la …» en los buscadores de cuenta de esta ficha (la empresa, la de la ficha). */
  const crearCuenta = (alCrear: (c: CuentaDelPlan) => void) => (q: string, cerrar: () => void) => (empresa
    ? <CrearDesdeBuscador accountId={accountId} companyId={empresa} q={q} quien={userName ?? null}
        alCrear={(c) => { const n = { codigo: c.code, nombre: c.name }; setCreadas((x) => [...x, n]); alCrear(n); cerrar() }} />
    : null)
  const cuentasCobro: CuentaDelPlan[] = useMemo(() => [...(emp?.cobros ?? []).map((c) => ({ codigo: c.codigo, nombre: c.nombre })),
    ...creadas.filter((c) => !(emp?.cobros ?? []).some((v) => v.codigo === c.codigo))], [emp, creadas])

  // ── Lo que se dice: la duda, las comprobaciones, la franja ──
  const [decidida, setDecidida] = useState<string | null>(null)
  const duda = reparto && modo !== 'hecha_sola' ? dudaDelGasto({ reparto, confianza: reparto.length >= 2 ? 'probable' : 'seguro', cuentaAhora: be.ventas[0]?.cuenta ?? '', decidida: decidida === `${claveFicha}:${b.clienteId}` }) : null
  const comprobaciones = modo === 'a_mano' ? [] : comprobacionesEmitida({ numero: b.numero, fecha: b.fecha, calendario, repetida, hayCliente: !!cliente, nif: cliente?.nif ?? null, iva: b.iva, total })
  const vacias = vaciasEmitida(be, total)
  // X10f · Su línea de ERP10, junto al estado.
  const erp10 = useLineaErp10({ accountId, companyId: empresa, entryId: entryId || null, validado: asiento?.estado === 'validado', fecha: asiento?.fecha ?? null })
  const estado = estadoDeLaEmitida({ modo, comprobaciones, hayDuda: !!duda, vacias, asiento: asiento?.numero ?? null })
  useNombreDePestana(nombreDePestanaEmitida(cliente?.nombre, de !== 'nueva'))

  // ── La cola (‹ ›): la de los asientos de expedida por revisar ──
  const ids = cola ?? []
  const pos = de === 'asiento' ? ids.indexOf(entryParam) : -1
  const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
  const anterior = pos > 0 ? ids[pos - 1] : null

  const avisoDeAntes = (state as { aviso?: string } | null)?.aviso ?? null
  const claveAviso = `${claveFicha}:${avisoDeAntes ?? ''}`
  const [propio, setPropio] = useState<{ k: string; a: Aviso | null } | null>(null)
  const aviso: Aviso | null = propio && propio.k === claveAviso ? propio.a : avisoDeAntes ? { tono: 'ok', texto: avisoDeAntes } : null
  const setAviso = (a: Aviso | null) => setPropio({ k: claveAviso, a })
  const [guardando, setGuardando] = useState(false)

  /** El cobro, si toca; si no, por qué queda pendiente. Siempre una frase (regla 8). */
  async function elCobro(cuenta430: string, numero: string, fechaFactura: string): Promise<string> {
    if (!empresa || !cliente) return ''
    const bancos = new Map((emp?.cobros ?? []).filter((c) => c.bancoId).map((c) => [c.codigo, c.bancoId!]))
    const q = queHaceElCobro({ cuenta: be.cobroCuenta ?? '', fecha: be.cobroFecha ?? '', hoy, importe: cobroImporte, bancos })
    if (q.que === 'pendiente') return `Queda pendiente de cobrar (${q.porque}).`
    try { return await apuntarCobro({ companyId: empresa, cobro: q, cuenta430, partyId: cliente.id, numero, fechaFactura, quien: userName }) }
    catch (e) { return `El cobro no se ha apuntado (${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}): queda pendiente de cobrar.` }
  }

  async function guardarYSiguiente() {
    if (guardando || !emp || !empresa || !cuentas || !previa) return
    setGuardando(true); setAviso(null)
    try {
      if (modo === 'hecha_sola') { if (siguiente) navegar(rutaEmitidaAsiento(siguiente)); return }
      if (vacias.length) { setAviso({ tono: 'falta', texto: `No se ha guardado: falta ${vacias.join(', ')}.` }); return }
      if (previa.faltan.length) { setAviso({ tono: 'falta', texto: `No se ha guardado: falta ${previa.faltan.join(', ')}${previa.faltan.some((f) => /^la 477/.test(f)) ? ' en tu plan' : ''}.` }); return }
      if (!previa.cuadra) { setAviso({ tono: 'falta', texto: `No se ha guardado: el asiento no cuadra (debe ${cifra(previa.debe)}, haber ${cifra(previa.haber)}).` }); return }
      if (!cliente) return
      if (modo === 'rellenada' && asiento && accountId) {
        // Como hoy en un propuesto: se cambia la cuenta de lo cambiado (cambiarCuenta) y se valida.
        const dicho: string[] = []
        const lineas70 = asiento.apuntes.filter((l) => /^70/.test(l.cuenta))
        for (const [i, v] of be.ventas.entries()) {
          const l = lineas70[i]
          if (!l || !v.cuenta || v.cuenta === l.cuenta) continue
          const nueva = emp.ventas.find((c) => c.codigo === v.cuenta)
          if (!nueva) { setAviso({ tono: 'falta', texto: `No se ha guardado: la ${v.cuenta} no está en el plan.` }); return }
          dicho.push(await cambiarCuenta(accountId, empresa, asiento, l.posicion, { id: nueva.id, code: nueva.codigo, nombre: nueva.nombre, oficial: nueva.nombre }, userName))
        }
        let v: { serie: number; numero: number }
        try { v = await validar(asiento.id, userName) } catch (e) {
          setAviso({ tono: 'falta', texto: `${dicho.join(' ')} Sin validar: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}. No paso a la siguiente.`.trim() }); setVuelta((x) => x + 1); return
        }
        if (fichero) { try { await guardarExpedidaPdf(accountId, asiento.id, fichero.file, userName); dicho.push(`Su PDF, ${fichero.file.name}, adjunto.`); setFichero(null) } catch (e) { dicho.push(`El PDF no se ha adjuntado (${e instanceof Error ? e.message : String(e)}).`) } }
        dicho.push(await elCobro(sub?.codigo ?? '', b.numero, b.fecha))
        refrescarCuentasMenu()
        const texto = `Apuntada y validada: 1 / ${v.numero}, la ${b.numero} de ${cliente.nombre} por ${cifra(total)}. ${dicho.join(' ')}${siguiente ? '' : ' No quedan más por revisar.'}`.replace(/\s+/g, ' ').trim()
        if (siguiente) { navegar(rutaEmitidaAsiento(siguiente), { state: { aviso: texto } }); return }
        setAviso({ tono: 'ok', texto }); setVuelta((x) => x + 1); return
      }
      // A mano: el asiento de conta_venta_emitir, validado; su PDF; su cobro.
      const local = ejeLocal ? (be.ventas[0]?.local || null) : null
      const r = await guardarEmitida({ companyId: empresa, b: be, cliente, cuentas, local, quien: userName })
      const dicho = [...r.frases]
      if (!r.validada) {
        navegar(rutaEmitidaAsiento(r.entryId), { state: { aviso: `Guardada la ${b.numero} de ${cliente.nombre}, sin validar: ${String(r.porque).replace(/\.$/, '')}. ${dicho.join(' ')}`.trim() } }); return
      }
      if (fichero && accountId) {
        try { const x = await guardarExpedidaPdf(accountId, r.entryId, fichero.file, userName); dicho.push(`Su PDF, ${x.nombre}, adjunto.`) }
        catch (e) { dicho.push(`El PDF no se ha adjuntado (${e instanceof Error ? e.message : String(e)}): adjúntalo desde su asiento.`) }
        setFichero(null)
      }
      const c430 = sub?.codigo ?? (await deLaEmpresa(accountId!, empresa, hoy)).clientes.find((c) => c.id === cliente.id)?.subcuenta?.codigo ?? ''
      dicho.push(await elCobro(c430, b.numero, b.fecha))
      refrescarCuentasMenu()
      ed.reiniciar(borradorVacio(hoy))
      setTextoCliente(null); setTextoCuenta({}); setTextoCobro(null)
      setAviso({ tono: 'ok', texto: `Apuntada y validada: 1 / ${r.validada.numero}, la ${b.numero} de ${cliente.nombre} por ${cifra(total)}. ${dicho.join(' ')} Escribe la siguiente.`.replace(/\s+/g, ' ').trim() })
      setVuelta((x) => x + 1)
      focoPuesto.current = ''; tocada.current = ''
      setTimeout(() => document.getElementById('kf-cliente')?.focus(), 0)
    } catch (e) {
      setAviso({ tono: 'mal', texto: `No se ha podido: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}. No paso a la siguiente.` })
    } finally { setGuardando(false) }
  }

  const salida = useAvisoSalir({ hay: ed.hay, cambios: ed.cambios, donde: cliente ? `${cliente.nombre}${b.numero ? ` ${b.numero}` : ''}` : 'la factura nueva',
    onGuardar: async () => 'Se guarda con «Guardar y siguiente» (Intro).', onDescartar: ed.descartar })

  // ── El teclado: Intro, Esc ──
  const raiz = useRef<HTMLDivElement>(null)
  const alPulsar = (e: KE<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const lista = casillasDe(raiz.current)
      const sobre = t.closest('button, a, summary') ? 'boton' : t.closest('textarea') ? 'texto' : null
      const que = queHaceIntro({ orden: lista.length, actual: lista.indexOf(t), sobre })
      if (!que) return
      e.preventDefault()
      if (que.que === 'siguiente') { const s = lista[que.a]; s.focus(); if (s instanceof HTMLInputElement) s.select() }
      else void guardarYSiguiente()
    } else if (e.key === 'Escape' && !t.closest('[role="dialog"]')) {
      // Sin parar la pulsación, llega a window cuando la ventana de «cambios sin guardar» ya está puesta (React la pinta
      // dentro de este mismo Esc) y su Esc la cierra al momento: no se veía (e2e 44479781525; reproducido en Chromium).
      e.preventDefault(); e.stopPropagation()
      if (pestana?.cerrar) pestana.cerrar(); else salida.pedirSalir(() => navegar(rutaFacturasVenta()))
    }
  }
  useEffect(() => {
    const fuera = (e: KeyboardEvent) => {
      if (!seVe() || (e.key !== 'Enter' && e.key !== 'Escape') || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      const t = e.target as HTMLElement | null
      if (t && (raiz.current?.contains(t) || t.closest('input, textarea, select, button, a, [role="dialog"], [contenteditable="true"]'))) return
      e.preventDefault()
      if (e.key === 'Enter') void guardarYSiguiente()
      else if (pestana?.cerrar) pestana.cerrar()
    }
    window.addEventListener('keydown', fuera)
    return () => window.removeEventListener('keydown', fuera)
  })

  // El foco: en la nueva, el cliente; con la duda, su «Dejar …». Una vez por ficha, cuando ya está pintada.
  const pintada = de === 'nueva' ? !!emp : !!asiento && !!emp
  const marcarTocada = () => { if (pintada) tocada.current = claveFicha }
  useEffect(() => {
    if (!seVe()) return
    const donde = dondeVaElFoco({ pintada, yaPuesto: focoPuesto.current === claveFicha, tocada: tocada.current === claveFicha, aMano: de === 'nueva', hayDuda: !!duda })
    if (!donde) return
    const x = raiz.current?.querySelector<HTMLElement>(donde === 'proveedor' ? '#kf-cliente' : '.kf-duda .kf-boton-ambar')
    if (!x) return
    x.focus()
    focoPuesto.current = claveFicha
  }, [claveFicha, pintada, de, duda, seVe])

  // ── Lo que no es de esta ficha: la de Facturación (borrador, rectificativa) o «La ficha completa» ──
  if (de === 'factura' && fac.datos && !fac.datos.r) return <>{deHoy}</>
  if (de === 'factura' && completa === facturaId) {
    return <><p className="kf-aviso" data-tono="ok"><button type="button" className="kf-enlace" onClick={() => setCompleta(null)}>‹ Volver a la ficha nueva</button></p>{deHoy}</>
  }
  if (fac.error || asientoL.error || empL.error) return <div className="kf-ficha"><p className="kf-aviso" data-tono="mal">No se ha podido abrir la factura: {fac.error ?? asientoL.error ?? empL.error}</p></div>
  const cargando = !emp || (de !== 'nueva' && !asiento)

  // ── Lo que se pinta ──
  const ponerIva = (i: number, c: Partial<LineaIva>, rehacer = true) => {
    const iva = b.iva.map((l, j) => (j === i ? (rehacer ? rehacerCuota({ ...l, ...c }) : { ...l, ...c }) : l))
    ed.poner('iva', iva)
    const base = iva.reduce((t, l) => t + (num(l.base) ?? 0), 0)
    if (b.retencion) ed.poner('retencion', rehacerRetencion(b.retencion, base))
  }
  const ponerVenta = (i: number, c: Partial<BorradorEmitida['ventas'][number]>) => ed.poner('ventas', be.ventas.map((v, j) => (j === i ? { ...v, ...c } : v)))
  const elegirCliente = (id: string) => {
    ed.poner('clienteId', id)
    setTextoCliente(null)
    const c = emp?.clientes.find((x) => x.id === id)
    if (c?.retencion && !b.retencion) ed.poner('retencion', rehacerRetencion({ tipo: String(c.retencion), importe: '' }, previa?.base ?? 0))
  }
  const tiposIva = [...(emp?.tipos.keys() ?? [])]
  const operacion = cliente ? textoOperacionCliente(cliente.operacion, cliente.recargo) : null
  const conEstaFactura = mayor ? mayor.saldo + (modo === 'hecha_sola' ? 0 : total) : null
  const colaTexto = de === 'nueva' ? 'Nueva' : pos >= 0 ? `${pos + 1} de ${ids.length} por revisar` : ''
  const etiqueta = previa ? etiquetaDelAsiento({ debe: previa.debe, haber: previa.haber, cuadra: previa.cuadra, faltan: previa.faltan, lineas: previa.vista.length }) : { texto: 'Se forma al escribir', tono: 'vacio' as const }
  const documento = fichero ? { url: fichero.url, foto: !/pdf/i.test(fichero.file.type), titulo: fichero.file.name }
    : de === 'nueva' ? null : doc.datos ? { url: doc.datos.url, foto: false, titulo: doc.datos.titulo } : doc.error ? null : entryId ? undefined : null
  const puede = puedeGuardar({ guardando, validada: modo === 'hecha_sola' && !siguiente, descartada: false })
  const concepto = cliente ? `Factura ${b.numero || ''} · ${cliente.nombre}`.replace('Factura  ·', 'Factura ·') : ''
  const nombreCobro = be.cobroCuenta ? emp?.nombres.get(be.cobroCuenta) ?? creadas.find((x) => x.codigo === be.cobroCuenta)?.nombre ?? 'Cuenta' : ''
  const nombreDelCobro = modo === 'hecha_sola' ? cobroApuntado?.nombre ?? '' : nombreCobro
  const ejercicio = b.fecha.slice(0, 4)

  return (
    <div className="kf-ficha kf-emitida" ref={raiz} onKeyDown={(e) => { marcarTocada(); alPulsar(e) }} onPointerDown={marcarTocada} data-prueba="ficha-emitida-nucleo" data-modo={modo} aria-busy={cargando || undefined}>
      <header className="kf-cabecera">
        <h1>Factura emitida</h1>
        <span className="kf-cola">{colaTexto}</span>
        {!cargando && <EstadoFicha {...estado} />}
        {!cargando && <LineaErp10 linea={erp10.linea} companyId={empresa} entryId={entryId || null} fecha={asiento?.fecha ?? null} quien={userName} releer={erp10.releer} />}
        <div className="kf-cabecera-botones">
          <button type="button" className="kf-flecha" aria-label="La anterior" disabled={!anterior} onClick={() => anterior && salida.pedirSalir(() => navegar(rutaEmitidaAsiento(anterior)))}>‹</button>
          <button type="button" className="kf-flecha" aria-label="La siguiente" disabled={!siguiente} onClick={() => siguiente && salida.pedirSalir(() => navegar(rutaEmitidaAsiento(siguiente)))}>›</button>
          <Mas de={de} entryId={entryId} abrirCompleta={() => setCompleta(facturaId)} />
          <button type="button" className="kf-guardar" data-guardar-y-siguiente disabled={!puede || cargando} onClick={() => void guardarYSiguiente()}>
            {guardando ? 'Guardando…' : 'Guardar y siguiente'} <kbd>Intro</kbd>
          </button>
        </div>
      </header>
      {aviso && <p className="kf-aviso" data-tono={aviso.tono} role="status" data-prueba="aviso-ficha">{aviso.texto}</p>}
      {salida.aviso}
      <div className="kf-cuerpo">
        <div className="kf-izquierda">
        <div className="kf-formulario">
          {cargando ? <p className="kf-panel-nota" aria-busy="true">Abriendo la factura…</p> : <>
            <div className="kf-fila" style={{ gridTemplateColumns: '1.1fr 1.1fr 2.9fr 1.7fr' }}>
              <Casilla rotulo="Cliente" htmlFor="kf-cliente">
                {soloLeer ? <input id="kf-cliente" readOnly tabIndex={-1} value={sub?.codigo ?? cliente?.nombre ?? ''} data-cuenta={sub?.codigo} />
                  : <Buscador id="kf-cliente" etiqueta="Cliente" cargando={!emp} valor={textoCliente ?? (b.clienteId ? sub?.codigo || cliente?.nombre || '' : '')} cuenta={sub?.codigo ?? null}
                      placeholder="Código, nombre o NIF"
                      ponerTexto={setTextoCliente} lista={(t) => { const q = t.toLowerCase(); return (emp?.clientes ?? []).filter((c) => !q || c.nombre.toLowerCase().includes(q) || (c.nif ?? '').toLowerCase().includes(q) || (c.subcuenta?.codigo ?? '').startsWith(q)) }}
                      texto={(c) => `${c.subcuenta ? `${c.subcuenta.codigo} · ` : ''}${c.nombre}${c.nif ? ` · ${c.nif}` : ''}`} elegir={(c) => elegirCliente(c.id)} />}
              </Casilla>
              <Casilla rotulo="N.I.F." origen={cliente ? 'de su ficha' : null} htmlFor="kf-nif"><input id="kf-nif" readOnly tabIndex={-1} value={cliente?.nif ?? ''} /></Casilla>
              <Casilla rotulo="Nombre" origen={cliente ? 'de su ficha' : null} htmlFor="kf-nombre"><input id="kf-nombre" readOnly tabIndex={-1} value={cliente?.nombre ?? ''} title={cliente?.nombre} /></Casilla>
              <Casilla rotulo="Tipo de operación" origen={operacion ? 'de su ficha' : null} htmlFor="kf-operacion"><input id="kf-operacion" readOnly tabIndex={-1} value={operacion ?? ''} /></Casilla>
            </div>
            <div className="kf-fila" style={{ gridTemplateColumns: '1.7fr 1.1fr 1.1fr 1.1fr' }}>
              <Casilla rotulo="N.º de factura" htmlFor="kf-numero"><input id="kf-numero" data-casilla={soloLeer ? undefined : ''} readOnly={soloLeer} value={b.numero} onChange={(e) => ed.poner('numero', e.target.value)} /></Casilla>
              <Casilla rotulo="Fecha factura" htmlFor="kf-fecha">{soloLeer ? <input id="kf-fecha" readOnly tabIndex={-1} value={b.fecha.split('-').reverse().join('/')} /> : <CasillaFecha id="kf-fecha" etiqueta="Fecha factura" iso={b.fecha} hoy={hoy} poner={(x) => ed.poner('fecha', x)} />}</Casilla>
              <Casilla rotulo="Se declara en" htmlFor="kf-declara"><input id="kf-declara" readOnly tabIndex={-1} value={trimestreDe(b.fecha)} /></Casilla>
              <Casilla rotulo="Serie / documento" htmlFor="kf-serie"><input id="kf-serie" readOnly tabIndex={-1} value={asiento?.numero ? `1 / ${asiento.numero}` : '1 / —'} /></Casilla>
            </div>
            {/* El concepto, en su fila: a lo ancho cabe entero (Julio, 19/11: «a 1456 y a 1366 no se corta nada»). */}
            <div className="kf-fila" style={{ gridTemplateColumns: '1fr' }}>
              <Casilla rotulo="Concepto del asiento" origen={concepto ? 'Sumied' : null} htmlFor="kf-concepto"><input id="kf-concepto" readOnly tabIndex={-1} value={asiento?.concepto ?? concepto} title={asiento?.concepto ?? concepto} /></Casilla>
            </div>
            <div className="kf-saldo" data-prueba="saldo-cliente">
              Saldo del cliente a hoy <strong>{mayor ? cifra(mayor.saldo) : '—'}</strong>
              · con esta factura <strong>{conEstaFactura !== null ? cifra(conEstaFactura) : '—'}</strong>
              {cliente && <Link className="kf-enlace" to={rutaConta(CONTA.rutas.tercero, { partyId: cliente.id })}>Ficha del cliente</Link>}
            </div>
            <Comprobaciones lista={comprobaciones} nota={modo === 'a_mano' ? 'Al escribir se comprueba que no esté repetida, el periodo y el NIF' : null} />

            <div className="kf-importes">
              <div className="kf-bloque">
                <table className="kf-iva">
                  <colgroup><col className="kf-col-base" /><col className="kf-col-tipo" /><col /><col className="kf-iva-quitar" /></colgroup>
                  <thead><tr>
                    <th><span className="kf-iva-cabeza"><span className="kf-titulo">IVA {!soloLeer && <button type="button" className="kf-enlace-plano" onClick={() => ed.poner('iva', [...b.iva, otroTipo(b.iva, tiposIva.length ? tiposIva : undefined)])}>+ Otro tipo</button>}</span><span>Base</span></span></th>
                    <th>%</th><th>Cuota</th><th />
                  </tr></thead>
                  <tbody>
                    {b.iva.map((l, i) => (
                      <tr key={i}>
                        <td><input className="kf-cifra" data-casilla={soloLeer ? undefined : ''} readOnly={soloLeer} aria-label={`Base ${i + 1}`} value={l.base} onChange={(e) => ponerIva(i, { base: e.target.value })} onBlur={() => { const n = num(l.base); if (n !== null && !soloLeer) ponerIva(i, { base: importeEs(n) }) }} /></td>
                        <td><select data-casilla={soloLeer ? undefined : ''} disabled={soloLeer} aria-label={`Tipo de IVA ${i + 1}`} className="kf-cifra" value={l.tipo} onChange={(e) => ponerIva(i, { tipo: e.target.value })}>
                          {[...new Set([...tiposIva.map(String), l.tipo])].filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select></td>
                        <td><input className="kf-cifra" aria-label={`Cuota ${i + 1}`} value={l.cuota} readOnly={soloLeer} tabIndex={-1} onChange={(e) => ponerIva(i, { cuota: e.target.value }, false)} /></td>
                        <td>{!soloLeer && b.iva.length > 1 && <button type="button" className="kf-quitar" aria-label={`Quitar el tipo ${l.tipo} %`} tabIndex={-1} onClick={() => ed.poner('iva', b.iva.filter((_, j) => j !== i))}>×</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="kf-total">
                <div className="kf-total-arriba"><span>Total factura</span><span className="kf-total-cifra" data-prueba="total">{cifra(total)}</span></div>
                <label className="kf-total-retencion">Retención
                  <select data-casilla={soloLeer ? undefined : ''} disabled={soloLeer} value={b.retencion?.tipo ?? ''} onChange={(e) => ed.poner('retencion', e.target.value ? rehacerRetencion({ tipo: e.target.value, importe: '' }, previa?.base ?? 0) : null)}>
                    <option value="">Sin retención</option>
                    {[...new Set([...(emp?.retenciones ?? []).map((r) => r.tipo), ...(b.retencion?.tipo ? [Number(b.retencion.tipo)] : [])])].map((t) => <option key={t} value={String(t)}>{t} % · {b.retencion?.tipo === String(t) ? b.retencion.importe : cifra(Math.round((previa?.base ?? 0) * t) / 100)}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="kf-dos">
              <div className="kf-bloque">
                <h2 className="kf-titulo">A qué cuenta de venta va
                  {!soloLeer && <span className="kf-titulo-derecha">
                    <button type="button" className="kf-enlace-plano" onClick={() => ed.poner('ventas', [...be.ventas, { cuenta: '', local: be.ventas[0]?.local ?? '', importe: '' }])}>+ Otra cuenta</button>
                    <button type="button" className="kf-enlace-plano" onClick={() => ed.poner('ventas', [...be.ventas, { cuenta: be.ventas[0]?.cuenta ?? '', local: '', importe: '' }])}>+ Repartir</button>
                  </span>}
                </h2>
                {be.ventas.map((v, i) => (
                  <div className="kf-gasto" key={i} data-una={be.ventas.length === 1 ? 'si' : undefined}>
                    {modo === 'hecha_sola' ? <input readOnly tabIndex={-1} aria-label={`Cuenta de venta ${i + 1}`} value={v.cuenta} data-cuenta={v.cuenta || undefined} />
                      : <Buscador id={`kf-venta-${i}`} etiqueta={`Cuenta de venta ${i + 1}`} cargando={!emp} valor={textoCuenta[i] ?? v.cuenta} cuenta={v.cuenta || null} duda={!!duda && i === 0}
                          ponerTexto={(t) => setTextoCuenta((x) => ({ ...x, [i]: t }))} lista={(t) => cuentasQueEncajan(t, cuentasVenta, 8)}
                          texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { ponerVenta(i, { cuenta: c.codigo }); setTextoCuenta((x) => { const y = { ...x }; delete y[i]; return y }) }}
                          crear={crearCuenta((c) => { ponerVenta(i, { cuenta: c.codigo }); setTextoCuenta((x) => { const y = { ...x }; delete y[i]; return y }) })} />}
                    <NombreDeCuenta etiqueta={`Nombre de la cuenta de venta ${i + 1}`} valor={v.cuenta ? nombreVenta(v.cuenta) : ''} duda={!!duda && i === 0} />
                    <input className="kf-cifra" data-casilla={be.ventas.length > 1 && !soloLeer ? '' : undefined} aria-label={`Importe de la venta ${i + 1}`}
                      value={be.ventas.length === 1 ? importeEs(previa?.base ?? 0) : v.importe} readOnly={be.ventas.length === 1 || soloLeer}
                      tabIndex={be.ventas.length === 1 ? -1 : 0} onChange={(e) => ponerVenta(i, { importe: e.target.value })} />
                    {!soloLeer && be.ventas.length > 1 ? <button type="button" className="kf-quitar" aria-label={`Quitar la cuenta ${i + 1}`} tabIndex={-1} onClick={() => ed.poner('ventas', be.ventas.filter((_, j) => j !== i))}>×</button> : <span />}
                  </div>
                ))}
                <div className="kf-pareja">
                  <select aria-label="Local" data-casilla={ejeLocal && !soloLeer ? '' : undefined} disabled={!ejeLocal || soloLeer} value={be.ventas[0]?.local ?? ''} onChange={(e) => ponerVenta(0, { local: e.target.value })}>
                    <option value="">{ejeLocal ? 'Común a todos los locales' : 'Sin locales'}</option>
                    {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                  <select aria-label="Marca" disabled title="La marca no se guarda en el asiento de una emitida escrita aquí." value="">
                    <option value="">Sin repartir por marca</option>
                  </select>
                </div>
              </div>
              <div className="kf-bloque">
                {/* «Cómo se cobra» (Julio, 19/11): la cuenta del cobro. Vacía quiere decir pendiente de cobrar. En la hecha sola, el cobro
                    APUNTADO (o nada); en la a mano y la rellenada, lo que se propone, con su origen a la derecha, como una casilla. */}
                <h2 className="kf-titulo">Cómo se cobra
                  {modo !== 'hecha_sola' && origenCobro && <span className="kf-titulo-derecha kf-origen" data-prueba="origen-cobro">{origenCobro}</span>}
                </h2>
                <div className="kf-cobro">
                  {modo === 'hecha_sola' ? <input readOnly tabIndex={-1} id="kf-cobro" aria-label="La cuenta del cobro" value={cobroApuntado?.cuenta ?? ''} data-cuenta={cobroApuntado?.cuenta} />
                    : <Buscador id="kf-cobro" etiqueta="La cuenta del cobro" cargando={!emp} valor={textoCobro ?? be.cobroCuenta ?? ''} cuenta={be.cobroCuenta || null}
                        ponerTexto={(t) => { setTextoCobro(t); if (!t.trim()) ed.poner('cobroCuenta', '') }} lista={(t) => cuentasQueEncajan(t, cuentasCobro, 8)}
                        texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { ed.poner('cobroCuenta', c.codigo); setTextoCobro(null) }}
                        crear={crearCuenta((c) => { ed.poner('cobroCuenta', c.codigo); setTextoCobro(null) })} />}
                  {/* Sin cuenta, «Pendiente de cobrar» en la casilla ancha (en la de la cuenta no cabía entero). */}
                  <NombreDeCuenta etiqueta="Nombre de la cuenta del cobro" valor={nombreDelCobro} placeholder="Pendiente de cobrar" />
                </div>
                {(modo !== 'hecha_sola' || cobroApuntado) && (
                  <div className="kf-pareja">
                    {modo === 'hecha_sola'
                      ? <input readOnly tabIndex={-1} aria-label="La fecha del cobro" value={cobroApuntado ? cobroApuntado.fecha.split('-').reverse().join('/') : ''} />
                      : <CasillaFecha id="kf-cobro-fecha" etiqueta="La fecha del cobro" iso={be.cobroFecha ?? ''} hoy={hoy} poner={(x) => ed.poner('cobroFecha', x)} />}
                    <input className="kf-cifra" readOnly tabIndex={-1} aria-label="Importe del cobro" value={cifra(modo === 'hecha_sola' ? cobroApuntado?.importe ?? 0 : cobroImporte)} />
                  </div>
                )}
              </div>
            </div>

            {duda && (
              <Duda texto={duda.texto}
                principal={{ texto: `Dejar ${duda.dejar.cuenta}`, hacer: () => { ponerVenta(0, { cuenta: duda.dejar.cuenta }); setDecidida(`${claveFicha}:${b.clienteId}`) } }}
                secundario={{ texto: `Cambiar a ${duda.cambiar.cuenta}`, hacer: () => { ponerVenta(0, { cuenta: duda.cambiar.cuenta }); setDecidida(`${claveFicha}:${b.clienteId}`) } }} />
            )}

            <AsientoQueSale lineas={previa && total !== 0 ? previa.vista : []} etiqueta={etiqueta}
              editar={entryId ? { texto: 'Editar el asiento', hacer: () => navegar(rutaAsiento(entryId)) } : null} />
          </>}
        </div>
        <AyudaTeclas teclas={TECLAS_DE_LA_EMITIDA} />
        </div>
        <PanelDocumento documento={documento} acepta={ACEPTA_PAPEL} otraPrimero={modo !== 'a_mano'} raya={{ usuario: userId }}
          alElegir={modo === 'hecha_sola' && doc.datos ? undefined : (file) => setFichero({ file, url: URL.createObjectURL(file) })}
          otra={{ nombre: 'El mayor del cliente', contenido: (
            <MayorEnElPanel nombre={cliente?.nombre ?? null} subcuenta={sub?.codigo ?? ''} ejercicio={ejercicio} apuntes={mayor?.apuntes ?? (sub ? null : [])} hay={!!cliente}
              estaFactura={modo === 'hecha_sola' || !total ? null : { fecha: b.fecha, numero: b.numero, importe: total }} signo={1} queDebe="nos debe" sinElegir="Elige el cliente y sale su mayor." />
          ) }} />
      </div>
    </div>
  )
}

function Mas({ de, entryId, abrirCompleta }: { de: 'nueva' | 'factura' | 'asiento'; entryId: string; abrirCompleta: () => void }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="kf-mas">
      <button type="button" className="kf-boton-hueco" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>Más</button>
      {abierto && (
        <ul className="kf-mas-menu" onMouseLeave={() => setAbierto(false)}>
          {de === 'factura' && <li><button type="button" onClick={() => { setAbierto(false); abrirCompleta() }}>La ficha completa (cobros, PDF, corregir…)</button></li>}
          {entryId && <li><Link to={rutaAsiento(entryId)}>Su asiento</Link></li>}
          {de !== 'nueva' && <li><Link to={rutaNuevaFacturaVenta()}>Una nueva, a mano</Link></li>}
          <li><Link to={rutaFacturasVenta()}>Volver a la lista de emitidas</Link></li>
        </ul>
      )}
    </div>
  )
}
