// src/modules/conta/gestoria/r21/pagina.tsx
//
// R21 · «Facturar el mes» con sus datos. No hay motor nuevo: lee lo mismo que «Facturas del mes» (Q10) —lo cobrado por
// GoCardless (q10/datos.ts), lo leído de Cegid (leerGuardadoCegid), lo mandado (leerMandadoCegid) y lo cobrado por el
// banco y con tarjeta (leerBancoCegid, solo lee)— y lo ordena en cinco pasos (_shared/factura/facturarMes.ts) y en casos
// (armar.ts). Cada botón escribe donde escribe hoy «Facturas del mes»: atarFichaCegid, decidirBancoCegid,
// elegirConceptoCegid y el «Mandar» de hoy (mandarClienteCegid y mandarBancoCegid). El paso 5 comprueba contra
// conta_cegid_factura, después de leer de Cegid otra vez (solo lee).
// «Dejar para después» y el visto bueno de QBO se ven en la pantalla, pero aún no se guardan: se guardarán con sus dos
// tablas, en su PR con tanda (orden de Julio del 27/11). La pantalla lo dice cada vez (regla 8).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rutaFacturarMes } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { atarFichaCegid, decidirBancoCegid, elegirConceptoCegid, leerBancoCegid, leerGuardadoCegid, leerMandadoCegid, leerTodoCegid, mandarBancoCegid, mandarClienteCegid } from '@/modules/conta/services/cegidService'
import { leerGocardless } from '@/modules/conta/services/gestoriaService'
import { cuotasSinHasta, planMandar, proponerAtado, type CobroParaMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import { cuadreVias, esCobroDeCliente, planCobro } from '../../../../../supabase/functions/_shared/cegidBanco'
import { casosDelMes, cuadreDelMes, euros, mesLargo, pasoCinco, pasoCuatro, pasosDelMes, type MandadoCegid, type PendienteGuardado } from '../../../../../supabase/functions/_shared/factura/facturarMes'
import { facturasDelMes } from '../q10/facturasDelMes'
import { leerFacturasDelMes } from '../q10/datos'
import { codigosCegid } from '../q10/equivalencias'
import { armarCasos, CONCEPTOS, explicarDiferencia, mesesDelSelector, type Accion } from './armar'
import { darVistoBueno, dejarParaDespues, deshacerPendiente, leerPendientes, leerPrevistoGc, leerResueltosEnElMes, leerVistoBueno, resolverPendiente } from './datos'
import { FacturarMes, type CasoVista, type Frase } from './FacturarMes'

const VIVAS = ['mandando', 'mandada', 'facturada']
const hora = () => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date())
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function FacturarMesPage() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas, activa } = useEmpresas()
  const [params] = useSearchParams()
  const ir = useNavigate()
  const empresa = empresas.find((e) => e.id === params.get('empresa')) ?? activa
  const hoy = hoyEnMadrid()
  const meses = mesesDelSelector(hoy)
  const pedido = params.get('mes') ?? ''
  const mes = meses.some((m) => m.valor === pedido) ? pedido : meses.some((m) => m.valor === hoy.slice(0, 7)) ? hoy.slice(0, 7) : meses[0].valor
  const anio = Number(mes.slice(0, 4))
  const listo = !cargando && accountId && empresa
  const d = useLeer(listo ? () => leerFacturasDelMes(accountId, empresa.id, mes) : null, `${accountId}:${empresa?.id}:${mes}:r21`)
  const cg = useLeer(listo ? () => leerGuardadoCegid(empresa.id, anio) : null, `${empresa?.id}:${anio}:r21-cegid`)
  const md = useLeer(listo ? () => leerMandadoCegid(empresa.id, mes) : null, `${empresa?.id}:${mes}:r21-mandado`)
  const bk = useLeer(listo ? () => leerBancoCegid(empresa.id, mes) : null, `${empresa?.id}:${mes}:r21-banco`)
  // R21 · la 1826: lo dejado para después (de todos los meses), lo de antes resuelto este mes y el visto bueno de QBO.
  const pd = useLeer(listo ? () => leerPendientes(empresa.id) : null, `${empresa?.id}:r21-pendientes`)
  const rs = useLeer(listo ? () => leerResueltosEnElMes(empresa.id, mes) : null, `${empresa?.id}:${mes}:r21-resueltos`)
  const vbL = useLeer(listo ? () => leerVistoBueno(empresa.id, mes) : null, `${empresa?.id}:${mes}:r21-visto-bueno`)
  // R21e · Lo que GoCardless tiene previsto cobrar en el mes, para el mes que aún no tiene cobros.
  const pv = useLeer(listo ? () => leerPrevistoGc(empresa.id, mes) : null, `${empresa?.id}:${mes}:r21-previsto`)

  // Lo de esta visita (aún no se guarda: ver arriba).
  const clave = `${empresa?.id}:${mes}`
  const [resueltos, setResueltos] = useState<{ clave: string; casos: Map<string, { caso: CasoVista; frase: string }> }>({ clave: '', casos: new Map() })
  const [comprobado, setComprobado] = useState<string | null>(null)
  const [frases, setFrases] = useState<Record<string, Frase>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const misDejados = useMemo(() => (pd.datos ?? []).filter((p) => p.mes <= mes), [pd.datos, mes])
  const misResueltos = useMemo(() => (resueltos.clave === clave ? resueltos.casos : new Map<string, { caso: CasoVista; frase: string }>()), [resueltos, clave])
  const frase = (k: string, f: Frase | null) => setFrases((x) => { const y = { ...x }; if (f) y[`${clave}|${k}`] = f; else delete y[`${clave}|${k}`]; return y })
  const fraseDe = (k: string) => frases[`${clave}|${k}`] ?? null

  // Lo mismo que «Facturas del mes»: la ficha de cada cobro, su código de Cegid y el plan de lo que sale.
  const base = useMemo(() => {
    if (!d.datos || !empresa) return null
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene: false }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones: new Map(), cobroCliente: d.datos.cobroCliente })
  }, [d.datos, empresa, mes])
  const cegid = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !cg.datos.clientes.length) return null
    const conCobro = new Map([...base.facturas.map((f) => f.ficha), ...base.pendientes.map((p) => p.ficha).filter((f): f is NonNullable<typeof f> => !!f)].map((f) => [f.partyId, f]))
    const fichas = [...conCobro.values()].map((f) => ({ partyId: f.partyId, nif: f.nif, cuenta430: d.datos!.cuentas.get(f.partyId) ?? null, codigo: d.datos!.codigoCliente.get(f.partyId) ?? null }))
    const codigos = codigosCegid(fichas, cg.datos.clientes)
    const atables = cg.datos.clientes.map((c) => ({ codigo: c.codigo, nombre: c.nombre, nif: c.nif, email: c.email ?? null }))
    const sinCodigo = [...codigos].filter(([, c]) => c.codigo === null).map(([partyId, c]) => ({ partyId, nombre: conCobro.get(partyId)?.nombre ?? '', nif: conCobro.get(partyId)?.nif ?? null,
      porque: c.porque, propuestas: proponerAtado(conCobro.get(partyId)?.nombre ?? null, d.datos!.correos.get(partyId) ?? [], atables) }))
    return { codigos, sinCodigo }
  }, [d.datos, base, cg.datos])
  const cobrosMes = useMemo<CobroParaMandar[] | null>(() => {
    if (!d.datos || !base || !cegid) return null
    const sus = new Map(d.datos.suscripciones.map((s) => [s.gcId, s]))
    const fichaDe = new Map([...base.facturas.map((f) => [f.cobro.gcId, f.ficha] as const), ...base.pendientes.filter((p) => p.ficha).map((p) => [p.cobro.gcId, p.ficha!] as const),
      ...base.sinFactura.filter((x) => x.ficha).map((x) => [x.cobro.gcId, x.ficha!] as const)])
    return d.datos.cobros.filter((c) => c.fecha.slice(0, 7) === mes).map((c) => {
      const f = fichaDe.get(c.gcId) ?? null
      return { gcId: c.gcId, estado: c.estado, fecha: c.fecha, importe: c.importe, concepto: (c.suscripcionId ? sus.get(c.suscripcionId)?.nombre : null) ?? null,
        suscripcionId: c.suscripcionId, descripcion: c.descripcion,
        elegido: (c.suscripcionId ? d.datos!.elegidos.get(`suscripcion:${c.suscripcionId}`) : d.datos!.elegidos.get(`cobro:${c.gcId}`)) ?? null,
        partyId: f?.partyId ?? null, nombre: f?.nombre ?? null, codigoCegid: f ? cegid.codigos.get(f.partyId)?.codigo ?? null : null }
    })
  }, [d.datos, base, cegid, mes])
  const vivas = useMemo(() => (md.datos ?? []).filter((x) => VIVAS.includes(x.estado)), [md.datos])
  const plan = useMemo(() => cobrosMes && planMandar(mes, cobrosMes, new Set(vivas.map((x) => x.gcCobroId)), cuotasSinHasta(cg.datos?.clientes ?? [], cg.datos?.revisados ?? [])),
    [cobrosMes, vivas, mes, cg.datos])
  const facturasCruce = useMemo(() => {
    const nombres = new Map((cg.datos?.clientes ?? []).map((c) => [c.codigo, c.nombre]))
    return (cg.datos?.facturas ?? []).map((f) => ({ ejercicio: f.ejercicio, serie: f.serie, codigo: f.codigo, cliente: f.cliente, total: f.total, fecha: f.fecha, nombre: f.cliente != null ? nombres.get(f.cliente) ?? null : null }))
  }, [cg.datos])
  const planesBanco = useMemo(() => {
    if (!bk.datos) return null
    const v = new Set(vivas.map((m) => m.gcCobroId))
    return bk.datos.cobros.filter((c) => esCobroDeCliente(c.via)).map((c) => planCobro(mes, c, (cli, m) => (bk.datos!.facturados[String(cli)] ?? []).includes(m), v))
  }, [bk.datos, vivas, mes])

  const todo = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !md.datos || !planesBanco || !plan || !cobrosMes) return null
    // R21c · El nombre de GoCardless de cada cobro (por su mandato), para el cobro que no tiene ficha.
    const clienteDelMandato = new Map(d.datos.mandatos.map((m) => [m.gcId, m.gcClienteId]))
    const nombresGc = new Map(d.datos.cobros.flatMap((c) => {
      const n = c.mandatoId ? d.datos!.nombresGc.get(clienteDelMandato.get(c.mandatoId) ?? '') : undefined
      return n ? [[c.gcId, n] as const] : []
    }))
    const enCegid = new Set([...vivas.map((x) => x.gcCobroId), ...plan.vueltas['1'].listos.flatMap((k) => k.lineas.map((l) => l.gcId)), ...plan.vueltas['3'].listos.flatMap((k) => k.lineas.map((l) => l.gcId))])
    const entradas = armarCasos({ mes, plan, cobrosGc: d.datos.cobros.filter((c) => !enCegid.has(c.gcId)).map((c) => ({ gcId: c.gcId, partyId: base.facturas.find((f) => f.cobro.gcId === c.gcId)?.ficha.partyId
        ?? base.pendientes.find((p) => p.cobro.gcId === c.gcId)?.ficha?.partyId ?? null, nombre: null, importe: c.importe, fecha: c.fecha, estado: c.estado })),
      // Una ficha sin NIF no se puede facturar aunque se una a Cegid: sale una vez, como «Cliente sin datos».
      sinCodigo: (cegid?.sinCodigo ?? []).filter((f) => !base.pendientes.some((p) => p.motivo === 'sin_nif' && p.ficha?.partyId === f.partyId)),
      sinNif: base.pendientes.filter((p) => p.motivo === 'sin_nif' && p.ficha && !enCegid.has(p.cobro.gcId)).map((p) => ({ gcId: p.cobro.gcId, partyId: p.ficha!.partyId, nombre: p.ficha!.nombre, importe: p.cobro.importe, fecha: p.cobro.fecha })),
      clientesCegid: cg.datos.clientes.map((c) => ({ codigo: c.codigo, nombre: c.nombre, nif: c.nif })), planesBanco, facturasCegid: facturasCruce, nombresGc })
      .map((c) => ({ ...c, decidido: misResueltos.has(c.clave) }))
    // A un cliente cuya ficha de Cegid no tiene un NIF válido no se le manda nada: Verifactu no dejaría emitir su factura.
    // Queda en su caso (y en Pendientes, si se deja), no en lo que se manda.
    const sinNifCegid = new Set(entradas.filter((c) => c.tipo === 'falta_dato_cegid' && !c.decidido).map((c) => Number(c.clave.slice(6))))
    const listos1 = plan.vueltas['1'].listos.filter((k) => !sinNifCegid.has(k.codigo))
    const cobrosPorMandar = listos1.reduce((t, k) => t + k.lineas.length, 0) + planesBanco.filter((x) => x.estado === 'listo').length
    // Lo mandado antes de esta pantalla: lo que quedó fuera ya es un pendiente (no entró en lo mandado).
    const yaMandado = vivas.length > 0 && cobrosPorMandar === 0
    const dejadosVivos = misDejados.filter((p) => !misResueltos.has(p.clave))
    const dejadas = new Set(dejadosVivos.map((p) => p.clave))
    const fuera: PendienteGuardado[] = yaMandado ? entradas.filter((c) => !c.decidido && !dejadas.has(c.clave)).map((c) => ({ id: `fuera:${c.clave}`, clave: c.clave, tipo: c.tipo, mes,
      cliente: c.cliente, importeCent: c.importeCent, motivo: `${c.frase} Quedó fuera de lo mandado a Cegid.`, dejadoPor: null as unknown as string, dejadoAt: '' })) : []
    const pendientes = [...dejadosVivos, ...fuera]
    const casos = casosDelMes(mes, entradas, pendientes)
    const cv = cuadreVias(mes, cobrosMes, planesBanco, vivas.map((m) => ({ clave: m.gcCobroId, cliente: m.cliente, totalCent: Math.round(m.total * 100) })))
    // Antes de mandar, «Mandado a Cegid» es lo que quedará mandado: lo vivo más lo listo (así, «Mandar» se abre solo si,
    // mandándolo, la diferencia es 0,00 €).
    const porMandarCent = listos1.reduce((t, k) => t + k.totalCent, 0) + planesBanco.filter((x) => x.estado === 'listo').reduce((t, x) => t + x.lineas.reduce((u, l) => u + l.totalCent, 0), 0)
    // R21c · Cada cobro en una sola fila: la serie 3 (Contasimple) va aparte, los pendientes cuentan lo que está dentro de
    // lo cobrado (un pago con tarjeta sin abono en el banco aún no es cobrado), y lo que no está en ninguna fila se dice.
    const serie3 = new Map(plan.vueltas['3'].listos.flatMap((k) => k.lineas.map((l) => [l.gcId, l.totalCent] as const)))
    const ex = explicarDiferencia({ mes, gc: cobrosMes, planes: planesBanco,
      mandadas: new Map(vivas.map((m) => [m.gcCobroId, Math.round(m.total * 100)])),
      porMandarGc: new Set(listos1.flatMap((k) => k.lineas.map((l) => l.gcId))), serie3, pendientes, nombresGc,
      nombresCegid: new Map(cg.datos.clientes.map((c) => [c.codigo, c.nombre])) })
    const cuadre = cuadreDelMes(mes, { cobradoCent: cv.total.cobradoCent, noEsCobroCent: cv.total.noCobroCent, mandadoCent: cv.total.mandadoCent + porMandarCent, pagaFacturasCent: cv.total.pagaFacturaCent,
      despuesCent: ex.despuesCent, pendientesCent: ex.pendientesCent, sinExplicar: ex.sinExplicar,
      // Lo de meses de antes resuelto este mes se factura ahora: cuenta como cobrado del mes.
      deAntesResueltosCent: (rs.datos ?? []).reduce((t, x) => t + x.importeCent, 0) }, pendientes)
    const nombres = new Map(cg.datos.clientes.map((c) => [c.codigo, c.nombre]))
    const mandado: MandadoCegid[] = (md.datos ?? []).map((x) => ({ cliente: x.cliente, nombre: nombres.get(x.cliente) ?? null, serie: x.serie, totalCent: Math.round(x.total * 100), estado: x.estado }))
    const paso4 = vivas.length ? pasoCuatro(mandado) : null
    const paso5 = paso4 && comprobado === clave ? pasoCinco(mes, paso4, cg.datos.facturas.map((f) => {
      const m = `${String(f.fecha).slice(0, 4)}-${String(f.fecha).slice(4, 6)}`
      // Cegid puede fechar la factura de un mes en el mes siguiente: cuenta para este mes lo fechado en él o después.
      return { serie: f.serie, codigo: f.codigo, cliente: f.cliente, totalCent: Math.round(Number(f.total ?? 0) * 100), mes: m >= mes ? mes : m }
    })) : null
    const vb = vbL.datos ?? null
    const preparado = { cobradoCent: cuadre.cobradoCent, listos: cobrosPorMandar + vivas.length, casos: casos.length }
    const estado = { preparado, casos, cuadre, porMandar: cobrosPorMandar, mandados: vivas.length, paso4, vistoBueno: vb, paso5 }
    return { casos, pendientes, cuadre, paso4, paso5, pasos: pasosDelMes(estado), cobrosPorMandar, listos1, acciones: new Map(entradas.map((c) => [c.clave, c.acciones])) }
  }, [d.datos, base, cg.datos, md.datos, planesBanco, plan, cobrosMes, cegid, vivas, mes, facturasCruce, misDejados, misResueltos, vbL.datos, rs.datos, comprobado, clave])

  // R21e · Lo que quedó fuera de lo mandado se guarda en Pendientes (con su mes), una vez: así sale el primero en el mes
  // siguiente y no depende de volver a abrir este. El guardado no repite: la base no deja dos pendientes vivos de un caso.
  const guardados = useRef<Set<string>>(new Set())
  const recargarPendientes = pd.recargar
  useEffect(() => {
    if (!todo || !empresa) return
    const nuevos = todo.pendientes.filter((p) => p.id.startsWith('fuera:') && !guardados.current.has(`${empresa.id}|${p.clave}`))
    if (!nuevos.length) return
    for (const p of nuevos) guardados.current.add(`${empresa.id}|${p.clave}`)
    void (async () => {
      for (const p of nuevos) {
        try { await dejarParaDespues({ empresa: empresa.id, clave: p.clave, tipo: p.tipo, mes: p.mes, cliente: p.cliente, importeCent: p.importeCent, motivo: p.motivo }) }
        catch { /* ya estaba, o sin permiso: se queda como está y se vuelve a intentar al abrir otra vez */ }
      }
      recargarPendientes()
    })()
  }, [todo, empresa, recargarPendientes])

  const error = d.error ?? cg.error ?? bk.error ?? pd.error ?? rs.error ?? vbL.error
  if (error) return <ErrorConReintento mensaje={`No se ha podido leer lo del mes: ${error}`} reintentar={() => { d.recargar(); cg.recargar(); md.recargar(); bk.recargar(); pd.recargar(); rs.recargar(); vbL.recargar() }} />
  if (!empresa || !todo || !plan || !pd.datos || !rs.datos) return <TarjetaCargando />

  const recargar = () => { d.recargar(); cg.recargar(); md.recargar(); bk.recargar(); pd.recargar(); rs.recargar() }
  const resolver = (c: CasoVista, f: string) => setResueltos((r) => ({ clave, casos: new Map(r.clave === clave ? r.casos : []).set(c.clave, { caso: { ...c, resuelto: true, hecho: f, acciones: [] }, frase: f }) }))
  // «Dejar para después» se guarda (conta_factura_dejar, la 1826) con el mes que se está facturando.
  const dejar = (c: { clave: string; tipo: CasoVista['tipo']; cliente: string | null; importeCent: number }, motivo: string) =>
    dejarParaDespues({ empresa: empresa.id, clave: c.clave, tipo: c.tipo, mes, cliente: c.cliente, importeCent: c.importeCent, motivo })
  const guardadoDe = (k: string) => misDejados.find((p) => p.clave === k) ?? null
  const fechaHora = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  const vista = (c: (typeof todo.casos)[number]): CasoVista => {
    const acciones = armarAcciones(c.clave)
    const aMano = acciones.some((a) => a.efecto.que === 'facturar_a_mano' && a.efecto.cliente == null) ? 'concepto_cliente' as const
      : acciones.some((a) => a.efecto.que === 'facturar_a_mano' || a.efecto.que === 'concepto_a_mano') ? 'concepto' as const
      : acciones.some((a) => a.efecto.que === 'atar_a_mano') ? 'cliente' as const : null
    const g = guardadoDe(c.clave)
    return { ...c, acciones, resuelto: false, aMano, deshacer: !!g,
      hecho: c.estado === 'pendiente' ? (g ? `Dejado para después (${g.dejadoPor ?? 'sin nombre'}, ${fechaHora(g.dejadoAt)}). Queda en «Pendientes», fuera de esta factura. Cuando se resuelva, se factura en el mes en que se resuelva.`
        : 'Quedó fuera de lo mandado a Cegid: está en «Pendientes». Cuando se resuelva, se factura en el mes en que se resuelva.') : null }
  }
  const armarAcciones = (k: string) => todo.acciones.get(k) ?? []

  const casosVista: CasoVista[] = [...todo.casos.map(vista), ...[...misResueltos.values()].map((x) => x.caso)]
  const alAccion = async (k: string, a: Accion, aMano?: { concepto?: string; cliente?: number }) => {
    const c = casosVista.find((x) => x.clave === k)
    if (!c) return
    const e = a.efecto
    if (e.que === 'dejar') {
      setOcupado(k); frase(k, { estado: 'trabajando', frase: 'Guardando…' })
      try { const r = await dejar(c, e.motivo); frase(k, { estado: 'bien', frase: r.frase }); pd.recargar() }
      catch (er) { frase(k, { estado: 'mal', frase: msg(er) }) } finally { setOcupado(null) }
      return
    }
    const hacer = async (): Promise<string> => {
      switch (e.que) {
        case 'atar': return atarFichaCegid(empresa.id, e.partyId, e.codigo, e.como)
        case 'atar_a_mano': if (!aMano?.cliente) throw new Error('Escribe el número de cliente de Cegid.'); return atarFichaCegid(empresa.id, e.partyId, aMano.cliente, 'a_mano')
        case 'paga_factura': return decidirBancoCegid(empresa.id, e.clave, 'paga_factura', null, e.cliente, null, e.factura)
        case 'facturar': return decidirBancoCegid(empresa.id, e.clave, 'facturar', e.concepto, e.cliente, null, null)
        case 'facturar_a_mano': {
          const cli = aMano?.cliente ?? e.cliente
          if (!aMano?.concepto || !cli) throw new Error('Para facturar, elige el concepto y escribe el cliente de Cegid.')
          return decidirBancoCegid(empresa.id, e.clave, 'facturar', aMano.concepto, cli, null, null)
        }
        case 'concepto': return elegirConceptoCegid(empresa.id, e.elegir.que, e.elegir.gcId, e.concepto)
        case 'concepto_a_mano': if (!aMano?.concepto) throw new Error('Elige el concepto de Cegid.'); return elegirConceptoCegid(empresa.id, e.elegir.que, e.elegir.gcId, aMano.concepto)
        case 'releer': return leerTodoCegid(empresa.id, anio, (f) => frase(k, { estado: 'trabajando', frase: f }))
      }
    }
    setOcupado(k); frase(k, { estado: 'trabajando', frase: 'Apuntando…' })
    try {
      const f = await hacer()
      // Si estaba en Pendientes, sale de ahí y se factura en este mes (conta_factura_resolver_pendiente).
      const g = guardadoDe(k)
      const f2 = g ? `${f} ${await resolverPendiente(g.id, mes)}` : f
      frase(k, null)
      resolver(c, f2)
      recargar()
    } catch (er) { frase(k, { estado: 'mal', frase: msg(er) }) } finally { setOcupado(null) }
  }
  const dejarTodos = async () => {
    const quedan = todo.casos.filter((c) => c.estado === 'por_resolver')
    let hechos = 0
    setOcupado('casos')
    try {
      for (const c of quedan) { await dejar(c, c.frase); hechos += 1 }
      frase('casos', { estado: 'bien', frase: `Dejados para después ${hechos} ${hechos === 1 ? 'caso' : 'casos'}: quedan en «Pendientes», fuera de esta factura.` })
    } catch (er) { frase('casos', { estado: 'mal', frase: `Dejados ${hechos} de ${quedan.length}. Se ha parado: ${msg(er)}` }) } finally { setOcupado(null); pd.recargar() }
  }
  const preparar = async () => {
    frase('preparar', { estado: 'trabajando', frase: 'Leyendo GoCardless…' })
    try {
      await leerGocardless(empresa.id)
      const f = await leerTodoCegid(empresa.id, anio, (x) => frase('preparar', { estado: 'trabajando', frase: x }))
      frase('preparar', { estado: 'bien', frase: `Leído GoCardless y Cegid a las ${hora()}. ${f} Lo del banco y la tarjeta es de la lectura de esta noche.` })
    } catch (er) { frase('preparar', { estado: 'mal', frase: `No se ha podido preparar el mes: ${msg(er)}` }) } finally { recargar() }
  }
  const mandar = async () => {
    const listos = todo.listos1
    const banco = (planesBanco ?? []).filter((x) => x.estado === 'listo')
    let hechos = 0
    setOcupado('mandar')
    try {
      for (const x of listos) {
        frase('mandar', { estado: 'trabajando', frase: `Mandando a Cegid… (${hechos} de ${todo.cobrosPorMandar} cobros)` })
        await mandarClienteCegid(empresa.id, mes, x.codigo, x.lineas.map((l) => l.gcId), '1')
        hechos += x.lineas.length
      }
      for (const x of banco) {
        frase('mandar', { estado: 'trabajando', frase: `Mandando a Cegid… (${hechos} de ${todo.cobrosPorMandar} cobros)` })
        await mandarBancoCegid(empresa.id, mes, x.cobro.clave)
        hechos += 1
      }
      frase('mandar', { estado: 'bien', frase: `Mandados a Cegid ${hechos} cobros de la serie 1. Cegid aún no ha hecho ninguna factura.` })
    } catch (er) { frase('mandar', { estado: 'mal', frase: `Mandados ${hechos} de ${todo.cobrosPorMandar} cobros. Se ha parado: ${msg(er)}` }) } finally { setOcupado(null); recargar() }
  }
  const contasimple = async () => {
    const listos = plan.vueltas['3'].listos
    let hechos = 0
    frase('contasimple', { estado: 'trabajando', frase: 'Mandando Contasimple a Cegid…' })
    try {
      for (const x of listos) { await mandarClienteCegid(empresa.id, mes, x.codigo, x.lineas.map((l) => l.gcId), '3'); hechos += x.lineas.length }
      frase('contasimple', { estado: 'bien', frase: `Mandadas a Cegid ${hechos} cuotas de Contasimple (serie 3). Ahora, en Cegid, Precalcular y Generar la serie 3.` })
    } catch (er) { frase('contasimple', { estado: 'mal', frase: `Mandadas ${hechos} cuotas. Se ha parado: ${msg(er)}` }) } finally { recargar() }
  }
  const coincide = () => {
    if (!todo.paso4) return
    const s = todo.paso4.serie1
    frase('vb', { estado: 'trabajando', frase: 'Apuntando el visto bueno…' })
    // El visto bueno se guarda (conta_factura_visto_bueno_dar): uno vivo por mes y serie; el de antes queda guardado.
    darVistoBueno(empresa.id, mes, '1', s.totalCent, s.facturas)
      .then((f) => { frase('vb', { estado: 'bien', frase: `${f} Manda tú el listado en PDF a QBO: Sumied no manda correos.` }); vbL.recargar() })
      .catch((er: unknown) => frase('vb', { estado: 'mal', frase: msg(er) }))
  }
  const comprobar = async () => {
    frase('comprobar', { estado: 'trabajando', frase: 'Leyendo de Cegid las facturas emitidas…' })
    try {
      await leerTodoCegid(empresa.id, anio, (x) => frase('comprobar', { estado: 'trabajando', frase: x }))
      setComprobado(clave)
      frase('comprobar', null)
    } catch (er) { frase('comprobar', { estado: 'mal', frase: `No se ha podido leer de Cegid: ${msg(er)}` }) } finally { cg.recargar() }
  }
  // R21e · El mes aún sin cobros (diciembre antes del 4): se dice lo que GoCardless tiene previsto y se abre en el paso 1.
  const nombreDelMes = mesLargo(mes).split(' de ')[0]
  const sinCobros = todo.cuadre.cobradoCent === 0 && !todo.paso4
    ? `${nombreDelMes[0].toUpperCase()}${nombreDelMes.slice(1)} aún no tiene cobros.${pv.datos && pv.datos.cargos
      ? ` GoCardless tiene previsto cobrar ${euros(pv.datos.cent)} en ${pv.datos.cargos} ${pv.datos.cargos === 1 ? 'cargo' : 'cargos'}${pv.datos.primero ? `, el primero el ${pv.datos.primero.slice(8, 10)}/${pv.datos.primero.slice(5, 7)}` : ''}.` : ''} Cuando cobre, empieza por el paso 1.`
    : null
  const paso5Frase: Frase | null = fraseDe('comprobar') ?? (todo.paso5 ? (todo.paso5.faltan.length
    ? { estado: 'mal', frase: `Están ${todo.paso5.estan} facturas y faltan ${todo.paso5.faltan.length}: estas no están en Cegid con su cliente, su serie y su importe.` }
    : { estado: 'bien', frase: `Están las ${todo.paso5.estan} facturas en Cegid, cada una con su cliente, su serie y su importe.` }) : null)

  return (
    <FacturarMes empresa={empresa.nombre} mes={mes} meses={meses} alCambiarMes={(m) => ir(rutaFacturarMes(params.get('empresa'), m))}
      sinCobros={sinCobros}
      pasos={todo.pasos} preparar={{ frase: fraseDe('preparar'), alPulsar: () => void preparar() }}
      casos={casosVista} ocupado={ocupado} frases={Object.fromEntries(Object.entries(frases).filter(([k]) => k.startsWith(`${clave}|`)).map(([k, v]) => [k.slice(clave.length + 1), v]))}
      conceptos={CONCEPTOS} alAccion={(k, a, x) => void alAccion(k, a, x)}
      alDeshacer={(k) => {
        const g = guardadoDe(k)
        if (!g) return
        setOcupado(k)
        deshacerPendiente(g.id).then((f) => { frase(k, { estado: 'bien', frase: f }); pd.recargar() })
          .catch((er: unknown) => frase(k, { estado: 'mal', frase: msg(er) })).finally(() => setOcupado(null))
      }}
      alDejarTodos={() => void dejarTodos()}
      cuadre={todo.cuadre} mandar={{ cobros: todo.cobrosPorMandar, frase: fraseDe('mandar'), alPulsar: () => void mandar() }}
      serie1={todo.paso4?.serie1 ?? null} vistoBueno={fraseDe('vb')} alCoincide={coincide}
      serie3={todo.paso4?.serie3 ?? null}
      contasimple={{ cuotas: plan.vueltas['3'].lineas, cent: plan.vueltas['3'].cent, frase: fraseDe('contasimple'), alPulsar: () => void contasimple() }}
      comprobar={{ frase: paso5Frase, faltan: todo.paso5?.faltan ?? null, alPulsar: () => void comprobar() }}
      pendientes={todo.pendientes.map((p) => ({ clave: p.clave, mes: p.mes, cliente: p.cliente, importeCent: p.importeCent, motivo: p.motivo }))}
      alResolverPendiente={(k) => setTimeout(() => document.getElementById(`r21-caso-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)} />
  )
}
