// src/modules/conta/bancos/Movimientos.tsx
//
// B02 · Bancos › Movimientos, para conciliar (maqueta N17b, fiel). Arriba el
// cuadre —en el banco − en contabilidad = te falta por casar— y la barra de
// casados solos / para confirmar / por aclarar; la banda de lo que he hecho
// solo, con «Ver y deshacer lo que he hecho»; las bandejas con su número
// (Para confirmar · Por aclarar · Casados solos · Todos) y el buscador.
//
// Cifras, barra, banda y contadores salen de UNA lectura y de UNA cuenta
// (cuadreDe, lib/conciliarVista.ts): no pueden decir cosas distintas.
//
// Confirmar en bloque: lo de punto verde viene marcado («24 seguros
// seleccionados · Confirmar los 24»); las casillas quitan o añaden, y cada uno
// se confirma igual que si fuera solo. Filas por día; los iguales seguidos
// (las recargas) en una fila: «2 iguales · Confirmar las 2». Al elegir una
// fila se abre su panel lateral (PanelMovimiento). Teclado: ↑↓ para moverse,
// Intro confirma, espacio marca la casilla.
//
// S02 · PR 2: el título, el banco y el mes van en el encabezado de la página
// (BancosPage), con «Subir extracto» de principal. La lista se queda con su
// forma (filas por día, casillas, teclado y panel lateral: TablaLista no los
// tiene) y toma del patrón la altura de fila y las cifras tabulares.
//
// En el móvil, una tarjeta por movimiento, «Confirmar los N seguros» arriba,
// «Hacer foto del ticket» como botón principal cuando falta, y «Es el mismo /
// Son dos» en los posibles repetidos.
//
// S02 · PR 3 («las cifras»): las palabras del Inicio. «Según el banco, a
// dd/mm» es el extracto (antes «En el banco», que en el Inicio era el libro).
// «En contabilidad» sigue siendo la 572 con lo propuesto, porque lo casado
// crea su asiento propuesto y sin él el cuadre contaría lo ya casado como por
// casar; debajo, de conta_saldo_bancos, cuánto está validado y cuánto por
// validar (solo si suma lo mismo: desgloseContable).
//
// Todo lo que se pulsa confirma con contenido o dice el fallo (regla 8). Las
// bandejas filtran porque se piden; «Todos» enseña todas las filas (regla 7).

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaBancos } from '@/config/navegacion'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { useLeerConservando } from '@/modules/conta/bancos/useLeerConservando'
import { TEXTO_BOTON, filaDe, limitesMes, nombreMes, tarjetaPorAclarar, type Boton, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import {
  BANDEJAS, PILDORA, coincide, enBandeja, confirmable, cuadreDe, diaConNombre, porDia, preseleccionado, puntoDePartida, quienEs, textoBloque, textoDelBanco, type Bandeja, type Grupo,
} from '@/modules/conta/lib/conciliarVista'
import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import {
  facturasParaCasar, guardarRegla, ignorar, leerMovimientos, resolverRepetido, saldosContables, subirTicket, ultimaPasada, type FacturaPendiente,
} from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { DialogoCuenta, DialogoFactura, type Eleccion } from '@/modules/conta/bancos/dialogos'
import { nombreConCuenta } from '@/modules/conta/lib/validarBanco'
import { PanelMovimiento } from '@/modules/conta/bancos/PanelMovimiento'
import { casarRemesa, remesasParaCasar } from '@/modules/conta/services/pagosService'
import { casarAbono, cobrosParaCasar, reciboDevuelto } from '@/modules/conta/services/cobrosService'
import { PARAM_NUEVO, VALOR_NUEVO } from '@/modules/conta/bancos/bancoNuevo'
import { LO_HECHO } from '@/modules/conta/bancos/marca'
import { PorValidar } from '@/modules/conta/bancos/PorValidar'
import { conVeredicto, textoValidados } from '@/modules/conta/lib/validarBanco'
import { validar } from '@/modules/conta/services/diarioService'
import { leerEsperan } from '@/modules/conta/services/esperanService'
import { leerSaldoBancosSiEsta } from '@/modules/conta/services/cifrasService'
import { desgloseContable } from '@/modules/conta/lib/cifrasLibro'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'

const VISIBLES = 60
const euros = (c: number) => eurosExactos(c / 100)
const signo = (c: number) => (c > 0 ? `+${euros(c).replace(' €', '')}` : euros(c).replace(' €', ''))
const hoja = (nombres: Readonly<Record<string, string>>, prefijo: string, porDefecto: string) =>
  Object.keys(nombres).filter((c) => c.startsWith(prefijo) && c.length >= 8).sort()[0] ?? porDefecto

export function Movimientos() {
  const ctx = useBancos()
  const { accountId, companyId, banco, mes, movil, vuelta, recargar } = ctx
  const { userName } = useCuentaConta()
  const [query, setQuery] = useSearchParams()
  const navegar = useNavigate()
  const pedida = query.get('ver') === 'todo' ? 'todos' : query.get('ver')
  const bandeja = (BANDEJAS.some((b) => b.id === pedida) ? pedida : movil ? 'confirmar' : 'todos') as Bandeja
  const [busca, setBusca] = useState('')
  const [todas, setTodas] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<{ que: 'cuenta' | 'factura' | 'apartar'; m: MovimientoBanco } | null>(null)
  // El movimiento del panel va en la dirección (?mov=), como la bandeja: si algo de arriba vuelve a
  // montar la pantalla, el panel sigue abierto (lo cazó la e2e: se cerraba solo de vez en cuando).
  const elegido = query.get('mov')
  const setElegido = (id: string | null) => {
    const p = new URLSearchParams(query)
    if (id) p.set('mov', id); else p.delete('mov')
    setQuery(p, { replace: true })
  }
  const [foco, setFoco] = useState(0)
  // La selección es de la lectura en la que se hizo; con datos nuevos, vuelve lo de punto verde.
  const [marcado, setMarcado] = useState<{ de: unknown; ids: string[] } | null>(null)
  const fotoDe = useRef<string | null>(null)
  const inputFoto = useRef<HTMLInputElement>(null)

  const { desde, hasta } = limitesMes(mes)
  const corte = hasta < ctx.hoy ? hasta : ctx.hoy
  // Conserva lo leído mientras vuelve a leer (la pasada del agente recarga): la lista no se vacía.
  // Con fecha de corte (antes, la contabilidad está cerrada y casi sin conciliar), también la 572 a la víspera:
  // el cuadre parte del saldo del EXTRACTO ese día, no del contable (regla de Julio, 16/10).
  const fechaCorte = ctx.datos.corte
  const vispera = fechaCorte ? new Date(Date.parse(`${fechaCorte}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : null
  const lectura = useLeerConservando(banco ? async () => {
    const cuentas = banco.cuenta ? [banco.cuenta] : []
    const [movs, saldos, antes, pasada, facturas, esperan, unaFuente, remesas, cobros] = await Promise.all([
      leerMovimientos(accountId, banco.id, mes),
      saldosContables(companyId, corte, cuentas),
      vispera && corte >= (fechaCorte ?? '') ? saldosContables(companyId, vispera, cuentas) : Promise.resolve(null),
      ultimaPasada(accountId, companyId),
      facturasParaCasar(companyId),
      // S02 · PR 2: lo que la validación pararía (conta_esperan), para el veredicto de «Por validar».
      // Si no se puede leer, el veredicto no lo sabe y la validación lo dirá al pulsar.
      leerEsperan(companyId, desde, hasta).catch((e: unknown) => { console.warn('[bancos] no se pudo leer lo que espera', e); return new Map() }),
      // S02 · PR 3: la fila de este banco en conta_saldo_bancos, la misma que lee el Inicio.
      leerSaldoBancosSiEsta(companyId, corte),
      // PC01 · E2: las remesas de pagos que esperan su cargo (Compras › Pagos), para casar un cargo con ellas.
      remesasParaCasar(companyId).catch((e: unknown) => { console.warn('[bancos] no se pudieron leer las remesas que esperan su cargo', e); return [] }),
      // PC01 · E3: las remesas de recibos que esperan su abono y los recibos que pueden volver devueltos (Ventas › Cobros).
      cobrosParaCasar(companyId).catch((e: unknown) => { console.warn('[bancos] no se pudieron leer los cobros que esperan el banco', e); return { abonos: [], devoluciones: [] } }),
    ])
    const espera = new Map<string, string>([...esperan].map(([id, ms]) => [id, ms[0]?.motivo || 'La base no lo validaría todavía.']))
    const fila = unaFuente?.find((f) => (banco.cuenta && f.cuenta === banco.cuenta) || f.treasuryAccountId === banco.id) ?? null
    return { movs, libroCent: banco.cuenta ? saldos[banco.cuenta] ?? 0 : null, libroAntesCent: banco.cuenta && antes ? antes[banco.cuenta] ?? 0 : null, pasada, facturas, espera, fila, remesas, cobros }
  } : null, `${banco?.id}:${mes}`, String(vuelta))

  const movs = useMemo(() => lectura.datos?.movs ?? [], [lectura.datos])
  const porId = useMemo(() => new Map(movs.map((m) => [m.id, m])), [movs])
  // El saldo del banco: el último extracto con saldo hasta fin de mes.
  const extracto = banco ? ctx.datos.extractos.find((e) => e.cuentaId === banco.id && e.hasta <= hasta && e.saldoFinalCent !== null) ?? null : null
  const partida = useMemo(() => puntoDePartida(fechaCorte, corte, banco ? ctx.datos.extractos.filter((e) => e.cuentaId === banco.id) : [], lectura.datos?.libroAntesCent ?? null, lectura.datos?.libroCent ?? null),
    [fechaCorte, corte, banco, ctx.datos.extractos, lectura.datos])
  const cuadre = useMemo(() => cuadreDe(movs, extracto?.saldoFinalCent ?? null, partida.libroCent, mes), [movs, extracto, partida, mes])
  const seleccion = marcado && marcado.de === lectura.datos ? marcado.ids : cuadre.preseleccionados
  const desglose = partida.apertura ? null : desgloseContable(lectura.datos?.fila, cuadre.libroCent)

  const vistos = useMemo(() => movs.filter((m) => enBandeja(m, bandeja) && coincide(m, busca)), [movs, bandeja, busca])
  const dias = useMemo(() => porDia(todas ? vistos : vistos.slice(0, VISIBLES)), [vistos, todas])
  const grupos = useMemo(() => dias.flatMap((d) => d.grupos), [dias])

  if (!banco) {
    return <div className="cx-tarjeta"><p>No hay ningún banco dado de alta. <Link to={`${rutaBancos('cuentas')}?${PARAM_NUEVO}=${VALOR_NUEVO}`} className="cx-enlace">Dalo de alta</Link> y sube su extracto.</p></div>
  }
  if (lectura.error) return <ErrorConReintento mensaje={lectura.error} reintentar={lectura.recargar} />
  if (!lectura.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando los movimientos">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={44} />)}</div>

  const hecho = (texto: string) => { setAviso({ tipo: 'ok', texto }); refrescarCuentasMenu(); recargar(); lectura.recargar() }
  const fallo = (e: unknown) => setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) })
  const con = async (id: string, f: () => Promise<void>) => { setOcupado(id); setAviso(null); try { await f() } catch (e) { fallo(e) } finally { setOcupado(null) } }
  const quien = (m: MovimientoBanco) => `${diaMesCorto(m.fecha)} de ${euros(m.importeCent)}`
  const ir = (b: Bandeja) => { const p = new URLSearchParams(query); p.set('ver', b); p.delete('mov'); setQuery(p, { replace: true }); setFoco(0) }

  const confirmarPropuesta = async (m: MovimientoBanco) => {
    const p = m.propuesta!
    await nucleo.confirmar(m.id, m.porque ?? p.que ?? 'Confirmado', p.destino as unknown as Destino, (m.confianza ?? 'probable'), p.reglaId ?? null)
  }

  /** Confirmar varios: cada uno igual que si fuera solo; lo que falle se dice uno a uno. */
  const confirmarVarios = (ids: readonly string[], clave: string) => con(clave, async () => {
    const ms = ids.map((id) => porId.get(id)!).filter(confirmable)
    let bien = 0
    const mal: string[] = []
    for (const m of ms) {
      try { await confirmarPropuesta(m); bien++ } catch (e) { mal.push(`${quien(m)}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    if (mal.length) { setAviso({ tipo: 'error', texto: `Confirmados ${bien} de ${ms.length}. No he podido: ${mal.join(' · ')}` }); refrescarCuentasMenu(); recargar(); lectura.recargar() }
    else hecho(`Confirmados ${bien === 1 ? 'el 1' : `los ${bien}`}: sus asientos esperan en «Por validar».`)
  })

  const pulsar = (m: MovimientoBanco, b: Boton) => {
    switch (b) {
      case 'ver': if (m.casado?.asientoId) navegar(rutaAsiento(m.casado.asientoId)); return
      case 'deshacer': return deshacer(m)
      case 'si': case 'si-sin-ticket': return con(m.id, async () => {
        await confirmarPropuesta(m)
        hecho(`Casado: ${m.propuesta?.que ?? 'el movimiento'} (${quien(m)}). Su asiento espera en «Por validar»${b === 'si-sin-ticket' ? ', sin ticket' : ''}.`)
      })
      case 'subir-foto': fotoDe.current = m.id; inputFoto.current?.click(); return
      case 'otra-cosa': case 'decirlo-yo': setDialogo({ que: 'cuenta', m }); return
      case 'buscar-factura': setDialogo({ que: 'factura', m }); return
      case 'alta-tarjeta': navegar(`${rutaBancos('cuentas')}?banco=${banco.id}&tarjeta=${tarjetaPorAclarar(m.porque, m.propuesta) ?? ''}`); return
      case 'es-el-mismo': case 'son-dos': return con(m.id, async () => {
        await resolverRepetido(m.id, b === 'es-el-mismo')
        hecho(b === 'es-el-mismo'
          ? `Apartado: el movimiento del ${quien(m)} era el mismo que ya estaba; no cuenta dos veces.`
          : `Hecho: el movimiento del ${quien(m)} es otro distinto y queda para casar.`)
      })
    }
  }

  const deshacer = (m: MovimientoBanco) => con(m.id, async () => {
    await nucleo.deshacer(m.casado!.id, 'Deshecho desde Bancos › Movimientos')
    hecho(`Deshecho: el movimiento del ${quien(m)} vuelve a estar sin casar, y su asiento se ha quitado de contabilidad (o anulado, si estaba validado).`)
  })

  // S02 · PR 2: validar el asiento de lo casado, aquí («Por validar»), uno a uno o en bloque.
  const validarUno = async (m: MovimientoBanco): Promise<number | null> => {
    let ok: number | null = null
    await con(m.id, async () => {
      const r = await validar(m.casado!.asientoId!, userName)
      ok = r.numero
      hecho(`Validado: ${m.casado?.asientoConcepto ?? quien(m)} (${quien(m)}) es el asiento ${r.numero}. Ya está en el libro diario.`)
    })
    return ok
  }
  const validarLos = (ms: readonly MovimientoBanco[]) => con('validar-bloque', async () => {
    const numeros: number[] = []
    const mal: string[] = []
    for (const m of ms) {
      try { numeros.push((await validar(m.casado!.asientoId!, userName)).numero) } catch (e) { mal.push(`${quien(m)}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    setAviso(textoValidados(numeros, mal, ms.length)); refrescarCuentasMenu(); recargar(); lectura.recargar()
  })

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

  const elegirCuenta = (m: MovimientoBanco) => async (e: Eleccion) => {
    const destino: Destino = { tipo: 'cuenta', lineas: [{ cuenta: e.cuenta, importe: Math.abs(m.importeCent) / 100 }], concepto: e.concepto }
    const nombre = `${ctx.datos.nombres[e.cuenta] ?? e.cuenta} · ${e.cuenta}`
    await nucleo.confirmar(m.id, `Lo dijiste tú: ${nombre}.`, destino, 'probable', null)
    if (e.regla) await guardarRegla(companyId, { palabras: `Cuando el concepto tenga «${e.regla}» → ${nombre}`, contiene: e.regla, cuenta: e.cuenta, signo: m.importeCent < 0 ? -1 : 1, origen: 'persona' })
    hecho(`Casado con ${nombre} (${quien(m)})${e.regla ? `. Y desde ahora, lo que tenga «${e.regla}» irá ahí: está en Reglas` : ''}.`)
  }
  const apartar = (m: MovimientoBanco) => async (motivo: string) => {
    await ignorar(m.id, motivo)
    hecho(`Apartado el movimiento del ${quien(m)}: «${motivo}». No va a contabilidad.`)
  }
  const elegirFactura = (m: MovimientoBanco) => async (f: FacturaPendiente) => {
    const importe = Math.min(Math.abs(m.importeCent), f.pendienteCent) / 100
    const concepto = `Pago de la factura ${f.numero ?? ''} de ${f.proveedor}`.replace(/\s+/g, ' ')
    const destino: Destino = { tipo: 'factura_recibida', facturas: [{ id: f.id, importe }], cuenta_tercero: f.cuentaTercero ?? '', tercero_id: f.terceroId, concepto }
    await nucleo.confirmar(m.id, `Lo dijiste tú: paga la factura ${f.numero ?? ''} de ${f.proveedor}.`, destino, 'probable', null)
    hecho(`Casado: ${concepto} (${quien(m)}). ${importe * 100 < f.pendienteCent ? `A la factura le quedan ${euros(f.pendienteCent - importe * 100)} por pagar.` : 'La factura queda pagada.'}`)
  }

  const alternar = (ids: readonly string[]) => setMarcado({ de: lectura.datos,
    ids: ids.every((id) => seleccion.includes(id)) ? seleccion.filter((x) => !ids.includes(x)) : [...new Set([...seleccion, ...ids])] })
  const marcables = (g: Grupo) => g.ids.filter((id) => confirmable(porId.get(id)!))

  // ↑↓ para moverse, Intro confirma, espacio marca la casilla.
  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, button, a, select, textarea, summary')) return
    const g = grupos[foco]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = Math.max(0, Math.min(grupos.length - 1, foco + (e.key === 'ArrowDown' ? 1 : -1)))
      setFoco(n)
      if (!movil && grupos[n]) setElegido(grupos[n].m.id)
      document.getElementById(`cxn-fila-${grupos[n]?.m.id}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && g && marcables(g).length) {
      e.preventDefault(); void confirmarVarios(marcables(g), g.m.id)
    } else if (e.key === ' ' && g && marcables(g).length) {
      e.preventDefault(); alternar(marcables(g))
    }
  }

  const seleccionables = seleccion.filter((id) => porId.has(id) && confirmable(porId.get(id)!))
  const bloque = textoBloque(seleccionables, cuadre.preseleccionados)
  const elegidoM = elegido ? porId.get(elegido) ?? null : null
  const paraValidar = conVeredicto(vistos, lectura.datos.espera).map((x) => ({ ...x, espera: lectura.datos!.espera.has(x.m.casado!.asientoId!) }))
  // S01e: lo que queda por decidir en este banco, de todos los meses (la misma cuenta que la cinta: datos.dudas).
  const pendientesBanco = ctx.datos.dudas[banco.id] ?? 0
  const total = cuadre.cuenta.casados + cuadre.cuenta.confirmar + cuadre.cuenta.aclarar
  const ancho = (n: number) => `${total ? (n / total) * 100 : 0}%`
  const panel = elegidoM && (
    <PanelMovimiento key={elegidoM.id} m={elegidoM} facturas={lectura.datos.facturas} remesas={lectura.datos.remesas} cobros={lectura.datos.cobros} cuenta572={banco.cuenta} nombres={ctx.datos.nombres}
      otrosBancos={ctx.datos.bancos.filter((b) => b.id !== banco.id).map((b) => ({ id: b.id, nombre: b.nombre, cuenta: b.cuenta }))}
      cuentasDiferencia={{ c626: hoja(ctx.datos.nombres, '626', '62600000'), c669: hoja(ctx.datos.nombres, '669', '66900000'), c769: hoja(ctx.datos.nombres, '769', '76900000') }}
      ocupado={ocupado === elegidoM.id}
      alConfirmarPropuesta={() => pulsar(elegidoM, 'si')}
      alConfirmar={(d, porque, que) => con(elegidoM.id, async () => {
        await nucleo.confirmar(elegidoM.id, porque, d, 'probable', null)
        hecho(`Casado: ${que} (${quien(elegidoM)}). Su asiento espera en «Por validar».`)
      })}
      alCasarRemesa={(remesaId, lineas) => con(elegidoM.id, async () => { hecho((await casarRemesa(elegidoM.id, remesaId, lineas)).frase) })}
      alCasarAbono={(remesaId, lineas) => con(elegidoM.id, async () => { hecho((await casarAbono(elegidoM.id, remesaId, lineas)).frase) })}
      alDevuelto={(lineaId, motivo) => con(elegidoM.id, async () => { hecho((await reciboDevuelto(lineaId, elegidoM.id, motivo)).frase) })}
      alDeshacer={() => deshacer(elegidoM)}
      alVerAsiento={() => elegidoM.casado?.asientoId && navegar(rutaAsiento(elegidoM.casado.asientoId))}
      alBuscarFactura={() => setDialogo({ que: 'factura', m: elegidoM })}
      alApuntarSinFactura={() => setDialogo({ que: 'cuenta', m: elegidoM })}
      alApartar={() => setDialogo({ que: 'apartar', m: elegidoM })}
      alCerrar={() => setElegido(null)} />
  )

  return (
    <section className="cxb-movimientos cxn-conciliar" aria-label={`Movimientos de ${banco.nombre}`}>
      {/* S02 · PR 2: el título, el banco y el mes y «Subir extracto» van en el encabezado de la página (BancosPage). */}

      {/* El cuadre: en el banco − en contabilidad = te falta por casar, y la barra. */}
      <div className="cxn-cuadre" data-testid="cuadre">
        <div className="cxn-cuenta">
          <div className="cxn-cifra">
            <span className="cxb-cifra-etiqueta">Según el banco</span>
            <span className="cxb-cifra-valor">{cuadre.bancoCent === null ? '—' : euros(cuadre.bancoCent)}</span>
            <span className="cxb-cifra-pie">{extracto ? `a ${diaMesCorto(extracto.hasta)}, su extracto` : 'sube un extracto con saldos'}</span>
          </div>
          <span className="cxn-signo" aria-hidden="true">−</span>
          <div className="cxn-cifra">
            <span className="cxb-cifra-etiqueta">En contabilidad</span>
            <span className="cxb-cifra-valor">{cuadre.libroCent === null ? '—' : euros(cuadre.libroCent)}</span>
            <span className="cxb-cifra-pie">{cuadre.libroCent === null ? 'el banco no tiene su cuenta' : `a ${fechaLarga(corte)}`}</span>
            {desglose && <span className="cxb-cifra-pie" data-testid="desglose-contable">{eurosExactos(desglose.validado)} validado y {eurosExactos(desglose.propuesto)} por validar</span>}
            {partida.apertura && <span className="cxb-cifra-pie cxn-apertura" data-testid="apertura">{partida.apertura.frase}</span>}
          </div>
          <span className="cxn-signo" aria-hidden="true">=</span>
          <div className="cxn-cifra cxn-falta">
            <span className="cxb-cifra-etiqueta">Te falta por casar</span>
            <span className={`cxb-cifra-valor${cuadre.faltaCent === 0 ? ' cxb-verde' : ''}`}>{cuadre.faltaCent === null ? '—' : euros(cuadre.faltaCent)}</span>
            <span className={`cxb-cifra-pie${cuadre.faltaCent === 0 ? ' cxb-verde' : ''}`}>
              {cuadre.faltaCent === null ? 'falta un dato' : cuadre.faltaCent === 0 ? 'cuadra al céntimo'
                : cuadre.faltaCent === cuadre.sinCasarCent ? 'son justo los movimientos sin casar' : 'hay algo en contabilidad que no está en el banco'}
            </span>
          </div>
        </div>
        <div className="cxn-barra-bloque">
          <div className="cxn-barra" role="img" aria-label={`${cuadre.cuenta.casados} casados solos, ${cuadre.cuenta.confirmar} para confirmar y ${cuadre.cuenta.aclarar} por aclarar`}>
            <span className="cxn-tramo cxn-tramo-casados" style={{ width: ancho(cuadre.cuenta.casados) }} />
            <span className="cxn-tramo cxn-tramo-confirmar" style={{ width: ancho(cuadre.cuenta.confirmar) }} />
            <span className="cxn-tramo cxn-tramo-aclarar" style={{ width: ancho(cuadre.cuenta.aclarar) }} />
          </div>
          <div className="cxn-leyenda" data-testid="barra">
            <span><span className="cxb-punto cxb-punto-verde" aria-hidden="true" /> <b>{cuadre.cuenta.casados}</b> casados solos</span>
            <span><span className="cxb-punto cxb-punto-ambar" aria-hidden="true" /> <b>{cuadre.cuenta.confirmar}</b> para confirmar</span>
            <span><span className="cxb-punto" aria-hidden="true" /> <b>{cuadre.cuenta.aclarar}</b> por aclarar</span>
          </div>
        </div>
      </div>

      <div className="cxb-banda" role="note">
        <span className="cx-ia-punto" aria-hidden="true" />
        <div className="cxb-banda-texto">
          <strong data-testid="frase">{cuadre.frase}</strong>
          {lectura.datos.pasada && (
            <span className="cxb-pasada" data-testid="pasada-agente">
              {/* S01e: la pasada cuenta todos los bancos y todos los meses; se dice, para que no choque con la lista de este banco y mes. */}
              Mi última pasada por todos tus bancos y todos los meses, {cuandoPasada(lectura.datos.pasada.cuando, ctx.hoy)} ({lectura.datos.pasada.disparo === 'extracto' ? 'al subir un extracto' : 'la del día'}): {lectura.datos.pasada.resumen}
            </span>
          )}
          <span>Nada pasa a contabilidad sin que esté seguro o lo confirmes tú, y todo lo que hago solo se deshace.</span>
        </div>
        <button type="button" className="cx-boton-sec" onClick={() => ir('casados')}>Ver y deshacer lo que he hecho</button>
      </div>

      <div className="cxn-bandejas-fila">
        <div className="cxl-segmento" role="group" aria-label="Bandejas">
          {BANDEJAS.map((b) => (
            <button key={b.id} type="button" aria-pressed={bandeja === b.id} onClick={() => ir(b.id)}>
              {b.nombre} <span className="cxn-contador" data-testid={`contador-${b.id}`}>{cuadre.cuenta[b.id]}</span>
            </button>
          ))}
        </div>
        <label className="cxn-buscar">
          <span className="cx-oculto">Buscar movimientos</span>
          <input className="cx-input" type="search" value={busca} onChange={(e) => { setBusca(e.target.value); setFoco(0) }} placeholder="Busca por nombre, importe o concepto" />
        </label>
      </div>

      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}

      {bandeja !== 'casados' && bandeja !== 'aclarar' && bandeja !== 'validar' && seleccionables.length > 0 && (
        <div className="cxn-bloque-barra" role="region" aria-label="Confirmar en bloque">
          <span><strong>{bloque.etiqueta}</strong>{!movil && <span className="cx-ayuda"> · las casillas quitan o añaden; cada uno se confirma como si fuera solo</span>}</span>
          <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => confirmarVarios(seleccionables, 'bloque')}>
            {ocupado === 'bloque' ? 'Confirmando…' : movil && bloque.seguros ? `${bloque.boton} seguros` : bloque.boton}
          </button>
        </div>
      )}

      <div className={`cxn-cuerpo${panel && !movil ? ' cxn-con-panel' : ''}`}>
        {bandeja === 'validar' ? (
          <PorValidar key={`${banco.id}:${mes}`} filas={paraValidar} donde={`de ${nombreMes(mes).toLowerCase()} en ${banco.nombre}`} movil={movil} ocupado={ocupado}
            banco={nombreConCuenta(banco)}
            otros={ctx.datos.bancos.filter((b) => b.id !== banco.id).map((b) => ({ id: b.id, nombre: nombreConCuenta(b), n: ctx.datos.porValidar[b.id] ?? 0 }))}
            alSeguir={(id) => ctx.elegirBanco(id)}
            alValidar={validarUno} alValidarLos={validarLos} alDeshacer={deshacer}
            alVerAsiento={(m) => m.casado?.asientoId && navegar(rutaAsiento(m.casado.asientoId))} />
        ) : bandeja === 'casados' ? (
          <CasadosSolos movs={vistos} donde={`de ${nombreMes(mes).toLowerCase()} en ${banco.nombre}`} ocupado={ocupado} alAbrir={(m) => setElegido(m.id)} alDeshacer={deshacer}
            alVerAsiento={(m) => m.casado?.asientoId && navegar(rutaAsiento(m.casado.asientoId))} />
        ) : (
          <div className="cx-tarjeta cxn-lista" role="grid" tabIndex={0} aria-label={`Movimientos de ${nombreMes(mes).toLowerCase()} de ${banco.nombre}`}
            aria-keyshortcuts="ArrowUp ArrowDown Enter Space" onKeyDown={teclado}>
            {dias.map((d) => (
              <div key={d.fecha} role="rowgroup" className="cxn-dia">
                <div className="cxn-dia-cabeza" role="row"><span role="columnheader">{diaConNombre(d.fecha)}</span></div>
                {d.grupos.map((g) => {
                  const i = grupos.indexOf(g)
                  return (
                    <FilaMovimiento key={g.m.id} g={g} movil={movil} enfocada={i === foco} elegida={elegido === g.m.id} ocupado={ocupado}
                      marcadas={marcables(g).length > 0 && marcables(g).every((id) => seleccion.includes(id))} marcable={marcables(g).length > 0}
                      alMarcar={() => alternar(marcables(g))} alElegir={() => { setFoco(i); setElegido(g.m.id) }}
                      alPulsar={(b) => pulsar(g.m, b)} alConfirmarIguales={() => confirmarVarios(marcables(g), g.m.id)} />
                  )
                })}
              </div>
            ))}
            {vistos.length === 0 && (
              <p className="cxb-vacio">{movs.length === 0
                ? `No hay movimientos de ${nombreMes(mes).toLowerCase()} en ${banco.nombre}.${pendientesBanco ? ` En este banco quedan ${pendientesBanco} por decidir de otros meses: cambia el mes arriba.` : ''} Si te falta el extracto, suéltalo aquí o usa «Subir extracto».`
                : busca ? `Nada coincide con «${busca}».` : bandeja === 'confirmar' ? 'No te queda nada por confirmar.' : 'No te queda nada por aclarar.'}</p>
            )}
            <div className="cxb-pie">
              <span>Punto verde: lo casaría solo y viene marcado. Ámbar: lo propongo, confírmalo. Gris: falta algo y te digo qué. Cada movimiento se casa una sola vez.</span>
              {!todas && vistos.length > VISIBLES && <button type="button" className="cx-enlace cxb-enlace-boton" onClick={() => setTodas(true)}>Ver los {vistos.length}</button>}
            </div>
          </div>
        )}
        {panel && !movil && panel}
      </div>
      {panel && movil && <Dialogo titulo="El movimiento" alCerrar={() => setElegido(null)}>{panel}</Dialogo>}

      <input ref={inputFoto} type="file" accept="image/*,application/pdf" capture="environment" className="cx-oculto" aria-label="Foto del ticket"
        onChange={(e) => alFoto(e.target.files?.[0])} />
      {dialogo?.que === 'cuenta' && <DialogoCuenta m={dialogo.m} alCerrar={() => setDialogo(null)} alElegir={elegirCuenta(dialogo.m)} alApartar={apartar(dialogo.m)} />}
      {dialogo?.que === 'apartar' && <DialogoCuenta m={dialogo.m} apartando alCerrar={() => setDialogo(null)} alElegir={elegirCuenta(dialogo.m)} alApartar={apartar(dialogo.m)} />}
      {dialogo?.que === 'factura' && <DialogoFactura m={dialogo.m} alCerrar={() => setDialogo(null)} alElegir={elegirFactura(dialogo.m)} />}
    </section>
  )
}

/** Una fila (o los iguales seguidos): casilla · quién y el texto del banco · importe · lo que propongo · botones. */
function FilaMovimiento({ g, movil, enfocada, elegida, ocupado, marcadas, marcable, alMarcar, alElegir, alPulsar, alConfirmarIguales }: {
  g: Grupo; movil: boolean; enfocada: boolean; elegida: boolean; ocupado: string | null; marcadas: boolean; marcable: boolean
  alMarcar: () => void; alElegir: () => void; alPulsar: (b: Boton) => void; alConfirmarIguales: () => void
}) {
  const m = g.m
  const f = filaDe(m)
  const n = g.ids.length
  const verde = preseleccionado(m)
  const tono = m.estado === 'casado' ? 'casado' : verde ? 'verde' : f.tono
  const origen = m.estado === 'casado' ? null : m.propuesta?.origen ? PILDORA[m.propuesta.origen] ?? null : null
  const fotoPrincipal = f.botones.includes('subir-foto')
  const texto = (b: Boton) => (b === 'subir-foto' && movil ? 'Hacer foto del ticket' : TEXTO_BOTON[b])
  const principal = fotoPrincipal ? 'subir-foto' : f.principal
  return (
    <div id={`cxn-fila-${m.id}`} role="row" aria-selected={elegida} data-testid={`mov-${m.id}`}
      className={`cxn-fila cxn-fila-${tono}${enfocada ? ' cxn-enfocada' : ''}${elegida ? ' cxn-elegida' : ''}`} onClick={alElegir}>
      <span role="gridcell" className="cxn-casilla" onClick={(e) => e.stopPropagation()}>
        {marcable && <input type="checkbox" checked={marcadas} onChange={alMarcar} aria-label={`Marcar ${quienEs(m)} para confirmar en bloque`} />}
      </span>
      <span role="gridcell" className="cxn-quien">
        <strong>{quienEs(m)}{n > 1 && <span className="cxn-iguales"> · {n} iguales</span>}</strong>
        <span className="cxn-texto-banco">{textoDelBanco(m)}{m.tarjeta && ` · tarjeta de ${m.tarjeta.titular} (···${m.tarjeta.ultimos4})`}</span>
      </span>
      <span role="gridcell" className={`cxb-importe ${m.importeCent > 0 ? 'cxb-entra' : ''}`}>{signo(m.importeCent)}{n > 1 && <span className="cxn-por"> × {n}</span>}</span>
      <span role="gridcell" className="cxn-propongo">
        <span className="cxn-propongo-linea">
          <span className={`cxb-punto cxb-punto-${tono === 'casado' ? 'verde' : tono}`} title={verde ? 'Lo casaría solo' : f.estado} /><span className="cx-oculto">{verde ? 'Lo casaría solo' : f.estado}</span>
          {origen && <span className="cxn-pildora">{origen}</span>}
          <strong>{f.titulo}</strong>
          {m.propuesta?.facturaSinAprobar && m.estado !== 'casado' && <span className="cxn-pildora cxn-pildora-ambar">factura sin aprobar</span>}
        </span>
        <span className="cxn-porque">{f.porque}</span>
      </span>
      <span role="gridcell" className="cxb-botones" onClick={(e) => e.stopPropagation()}>
        {n > 1 && marcable ? (
          <button type="button" className="cx-boton" disabled={!!ocupado} onClick={alConfirmarIguales}>{ocupado === m.id ? '…' : `Confirmar las ${n}`}</button>
        ) : f.botones.map((b) => (
          <button key={b} type="button" className={b === principal ? 'cx-boton' : 'cx-boton-sec'} disabled={!!ocupado} onClick={() => alPulsar(b)}>
            {ocupado === m.id && (b === 'si' || b === 'deshacer' || b === 'si-sin-ticket' || b === 'subir-foto' || b === 'es-el-mismo' || b === 'son-dos') ? '…' : texto(b)}
          </button>
        ))}
      </span>
    </div>
  )
}

/** «Casados solos»: cada línea dice de qué movimiento habla, con qué se casó y por qué; se abre y se deshace desde ella. */
function CasadosSolos({ movs, donde, ocupado, alAbrir, alDeshacer, alVerAsiento }: {
  movs: readonly MovimientoBanco[]; donde: string; ocupado: string | null
  alAbrir: (m: MovimientoBanco) => void; alDeshacer: (m: MovimientoBanco) => void; alVerAsiento: (m: MovimientoBanco) => void
}) {
  // S01e: dice de qué banco y mes habla («Lo que he hecho» cuenta todos los bancos, por el día en que lo hice).
  if (!movs.length) return <div className="cx-tarjeta"><p className="cxb-vacio">Ningún movimiento {donde} está casado solo. Lo de todos tus bancos, en «{LO_HECHO}».</p></div>
  return (
    <div className="cx-tarjeta cxn-casados" role="list" aria-label="Casados solos">
      {movs.map((m) => (
        <div key={m.id} role="listitem" className="cxn-casado" data-testid={`casado-${m.id}`}>
          <span className="cxn-casado-que">
            <span className="cxn-casado-mov"><span className="cx-cifra">{diaMesCorto(m.fecha)}</span> · <strong>{quienEs(m)}</strong> · <span className={`cx-cifra${m.importeCent > 0 ? ' cxb-entra' : ''}`}>{euros(m.importeCent)}</span></span>
            <span>Casado con <strong>{m.casado?.asientoConcepto ?? m.propuesta?.que ?? 'su asiento'}</strong></span>
            <span className="cx-ayuda">{(m.casado?.porque ?? '').replace(/^casado solo\s*[:·]\s*/i, '')}</span>
          </span>
          <span className="cxb-botones">
            <button type="button" className="cx-boton-sec" onClick={() => alAbrir(m)}>Abrir</button>
            {m.casado?.asientoId && <button type="button" className="cx-boton-sec" onClick={() => alVerAsiento(m)}>Ver el asiento</button>}
            <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => alDeshacer(m)}>{ocupado === m.id ? 'Deshaciendo…' : 'Deshacer'}</button>
          </span>
        </div>
      ))}
    </div>
  )
}

/** «hoy a las 09:12» o «el 12/10 a las 23:40», en hora de Madrid. */
function cuandoPasada(iso: string, hoy: string): string {
  const d = new Date(iso)
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
  return dia === hoy ? `hoy a las ${hora}` : `el ${dia.slice(8, 10)}/${dia.slice(5, 7)} a las ${hora}`
}
