// src/modules/conta/ventas/FacturaVentaPage.tsx
//
// V01 · Entrega 1 · La ficha de una factura de venta (tablero 11), con la
// plantilla FICHA: los datos a la izquierda y el PDF a la derecha.
//
//   · NUEVA o BORRADOR: se escribe. El cliente (de Contactos, o uno nuevo sin
//     salir, con su NIF comprobado), las líneas (concepto, cantidad, precio,
//     descuento, IVA y cuenta), la retención si la hay, la serie, la fecha, el
//     vencimiento, la forma de cobro y el local. Nada se guarda solo: «Guardar
//     cambios» (la barra de cambios y el aviso al salir, D03). A la derecha,
//     cómo quedará el PDF. Abajo, «El asiento que se crea».
//     El principal es «Emitir»: guarda lo que falte, da el número, hace el
//     asiento y el PDF, lo manda a Diez y, si se pide, por correo. Dice qué ha
//     pasado en cada paso (regla 8).
//   · EMITIDA: se lee. Su asiento, su cobro y su historial; a la derecha, su
//     PDF. El principal es «Registrar cobro» (también una parte); además
//     «Corregir» (la rectificativa), «Enviar de nuevo» y «Más acciones».
//   · RECTIFICATIVA (borrador de la serie R): dice cuál corrige y por qué. De
//     importes, se cambian las líneas a lo que debía ser y la diferencia es lo
//     que se emite; para anular, no hay nada que cambiar; de datos, solo el
//     cliente.
// Lo que se decide sin React, en lib/facturasVenta.ts; lo que se lee y se
// escribe, en services/ventasService.ts.

import { useMemo, useState, useEffect } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { rutaAsiento, rutaFacturaVenta, rutaFacturasVenta, rutaLiquidacionesVentas, rutaNuevaFacturaVenta } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica, useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { BloqueHistorial } from '@/modules/conta/documentos/FichaRecibidaBloques'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Campo, Dialogo, Fecha, Selector, Texto } from '@/modules/conta/diseno'
import {
  AsientoQueSeCrea, BarraCambios, BloqueFicha, CampoFicha, DocumentoFicha, Ficha, FilaCampos, useAvisoSalir, useCambiosSinGuardar,
  type MensajeGuardado, type ResultadoGuardar,
} from '@/modules/conta/diseno/plantillas'
import { leerAsiento, localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { enviarADiez } from '@/modules/conta/services/conDiezService'
import { useEnvioDiez } from '@/modules/conta/services/envioDiezService'
import {
  borrarBorrador, catalogosFactura, cobrarFactura, corregirFactura, datosDelPdf, direccion, emitirFactura, empresaDelPdf, enviarPorCorreo, guardarBorrador, guardarPdf, leerFactura, urlDelPdf,
  type Catalogos, type FacturaGuardada,
} from '@/modules/conta/services/ventasService'
import {
  ETIQUETAS_BORRADOR, NOMBRE_CORRECCION, NOMBRE_ESTADO, asientoPrevio, cifrasDe, cifrasGuardadas, diferenciaDe, textoTraspaso, estadoDe, faltaParaEmitir, lineaVacia, lineasLeidas, textoDeNumero, venceCon,
  type BorradorVenta, type LineaEnEdicion,
} from '@/modules/conta/lib/facturasVenta'
import { MENCION_SIN_IVA, porqueNoVale, zonaDelCliente } from '@/modules/conta/lib/ventasSinIva'
import { BandaPruebas } from '@/modules/conta/verifactu/BandaPruebas'
import { HaciendaDeFactura } from '@/modules/conta/verifactu/HaciendaDeFactura'
import { facturaVentaPdf, type DatosFacturaPdf } from '../../../../supabase/functions/_shared/facturaVentaPdf.ts'
import { BloqueCobro, DialogoClienteNuevo, DialogoCobro, DialogoCorregir, DialogoEmitir, LineasEditables, LineasLeer, PorqueSinIva, Totales } from './FacturaVentaBloques'

const importeEs = (n: number) => textoDeNumero(n)

function borradorDe(f: FacturaGuardada | null, hoy: string, c: Catalogos | null): BorradorVenta {
  const tipo = c?.tipos.find((t) => t.tipo === 21)?.id ?? c?.tipos[0]?.id ?? ''
  const cuenta = c?.cuentas.find((x) => x.code.startsWith('705'))?.id ?? c?.cuentas[0]?.id ?? ''
  if (!f) {
    return { clienteId: null, fecha: hoy, vence: null, serie: 'F', formaCobroId: null, localId: null, notas: '', correo: '', retencionId: null, motivo: '', lineas: [lineaVacia(tipo, cuenta)], porque: null }
  }
  return {
    clienteId: f.clienteId, fecha: f.fecha, vence: f.vence, serie: f.serie, formaCobroId: f.formaCobroId, localId: f.localId, notas: f.notas ?? '',
    correo: f.correo ?? '', retencionId: f.retencionId, motivo: f.corrige?.motivo ?? '', porque: f.porque,
    lineas: f.lineas.length
      ? f.lineas.map((l): LineaEnEdicion => ({ concepto: l.concepto, cantidad: textoDeNumero(l.cantidad, 3).replace(/,00$/, ''), precio: importeEs(l.precio), descuento: l.descuento ? textoDeNumero(l.descuento, 0) : '', tipoId: l.tipoId, cuentaId: l.cuentaId }))
      : (f.corrige?.tipo === 'anular' ? [] : [lineaVacia(tipo, cuenta)]),
  }
}

/** El paso a paso de emitir, en frases (regla 8: dice qué ha pasado en cada uno). */
interface ResultadoEmitir { numero: string; total: number; pasos: { ok: boolean; texto: string }[] }

export default function FacturaVentaPage() {
  const { facturaId } = useParams()
  const [query] = useSearchParams()
  const nueva = !facturaId
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const { local: ejeLocal } = useAnalitica()
  const marco = useMarco()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const location = useLocation()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  const companyId = activa?.id ?? null

  const catalogos = useLeer(accountId && companyId ? () => catalogosFactura(accountId, companyId) : null, `${accountId}:${companyId}:catalogos-venta:${vuelta}`)
  const leida = useLeer(accountId && facturaId ? () => leerFactura(accountId, facturaId) : null, `${accountId}:${facturaId}:factura-venta:${vuelta}`)
  // «Hacer una nueva bien hecha» (después de anular): la nueva sale con lo de la anulada.
  const copia = query.get('copia')
  const deCopia = useLeer(accountId && nueva && copia ? () => leerFactura(accountId, copia) : null, `${accountId}:${copia}:copia`)
  const f = leida.datos ?? null
  const original = useLeer(accountId && f?.corrige ? () => leerFactura(accountId, f.corrige!.id) : null, `${accountId}:${f?.corrige?.id}:original:${vuelta}`)
  const empresa = useLeer(accountId && companyId ? () => empresaDelPdf(accountId, companyId) : null, `${accountId}:${companyId}:empresa-pdf`)
  // V01c: en traspaso mensual nada va a Diez suelto: va en el traspaso del mes de su fecha (Contabilidad › Cierre).
  const mensual = useEnvioDiez(accountId, companyId).envio?.mensual === true
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}-local:locales`)
  const asiento = useLeer(accountId && f?.entryId ? () => leerAsiento(accountId, f.entryId!) : null, `${accountId}:${f?.entryId}:asiento`)
  const pdfUrl = useLeer(f?.pdf ? () => urlDelPdf(f.pdf!.ruta) : null, `${f?.pdf?.ruta}:url`)

  const cat = catalogos.datos
  const base = useMemo(() => {
    const b = borradorDe(f, hoy, cat)
    if (nueva && deCopia.datos) {
      const c = borradorDe(deCopia.datos, hoy, cat)
      return { ...c, fecha: hoy, vence: null, serie: 'F', motivo: '' }
    }
    // Desde la ficha de un cliente (Contactos): la nueva, con él puesto.
    const delCliente = nueva ? cat?.clientes.find((c) => c.id === query.get('cliente')) : null
    if (delCliente) return { ...b, clienteId: delCliente.id, correo: delCliente.correo ?? '', retencionId: delCliente.retencionId, vence: venceCon(hoy, delCliente.dias) }
    return b
  }, [f, hoy, cat, nueva, deCopia.datos, query])
  const formato = useMemo(() => (campo: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (campo === 'clienteId') return cat?.clientes.find((c) => c.id === v)?.nombre ?? 'otro cliente'
    if (campo === 'retencionId') return cat?.retenciones.find((r) => r.id === v)?.nombre ?? 'otra'
    if (campo === 'formaCobroId') return cat?.formas.find((r) => r.id === v)?.nombre ?? 'otra'
    if (campo === 'lineas') return `${(v as unknown[]).length} líneas`
    if (campo === 'fecha' || campo === 'vence') return String(v).split('-').reverse().join('/')
    return String(v)
  }, [cat])
  const ed = useCambiosSinGuardar<BorradorVenta>(base, ETIQUETAS_BORRADOR, formato)
  const b = ed.valor

  // Una nueva se guarda y se abre su ficha: el mensaje viaja con la navegación (regla 8).
  const [mensaje, setMensaje] = useState<MensajeGuardado | null>(() => (location.state as { mensaje?: MensajeGuardado } | null)?.mensaje ?? null)
  const [guardando, setGuardando] = useState(false)
  const [dialogo, setDialogo] = useState<null | 'cliente' | 'emitir' | 'cobro' | 'corregir' | 'borrar'>(null)
  const [resultado, setResultado] = useState<ResultadoEmitir | null>(() => (location.state as { resultado?: ResultadoEmitir } | null)?.resultado ?? null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [conRetencion, setConRetencion] = useState(false)
  const [borrada, setBorrada] = useState(false)

  const estado = f ? f.estado : 'borrador'
  const editable = estado === 'borrador' && !borrada
  const corrige = f?.corrige ?? null
  // V01 · Entrega 2: la factura resumen de un cierre (y su rectificativa) no lleva cliente: son ventas a consumidor final.
  const deCierre = f?.origen === 'cierre_dia'
  const tipos = cat?.tipos ?? []
  const leidas = lineasLeidas(b.lineas, tipos)
  const retPct = cat?.retenciones.find((r) => r.id === b.retencionId)?.tipo ?? 0
  const cifrasNuevas = cifrasDe(leidas.lineas, false, retPct)
  // V01b: la corregida ya está emitida: su IVA es el guardado, no uno recalculado.
  const cifrasViejas = original.datos ? cifrasGuardadas(original.datos.lineas, retPct) : null
  // Lo que se emite: una rectificativa, la diferencia; si no, lo escrito.
  const cifras = corrige && cifrasViejas
    ? diferenciaDe(corrige.tipo === 'anular' ? cifrasDe([], false, retPct) : corrige.tipo === 'datos' ? cifrasViejas : cifrasNuevas, cifrasViejas)
    : cifrasNuevas
  const cliente = cat?.clientes.find((c) => c.id === b.clienteId) ?? null
  // V03 E2 · Una línea sin IVA necesita su porqué, según dónde está el cliente
  // (tablero 27). La rectificativa lo hereda de la que corrige: no se elige.
  const zona = zonaDelCliente(cliente?.pais ?? f?.cliente.pais)
  const haySinIva = !corrige && leidas.sinIva
  const noVale = haySinIva ? porqueNoVale(b.porque, zona) : null
  // La emitida, con su porqué si tiene líneas sin IVA; la rectificativa, el de la que corrige.
  const porqueLeido = f?.porque && f.lineas.some((l) => l.tipo === 0) ? f.porque : null
  const porqueHeredado = corrige ? f?.porque ?? original.datos?.porque ?? null : null
  const falta = editable ? [...faltaParaEmitir({ clienteId: deCierre ? 'cierre' : b.clienteId, nif: deCierre ? 'consumidor final' : cliente?.nif ?? null, lineas: corrige?.tipo === 'anular' || corrige?.tipo === 'datos' ? [{ concepto: 'x', tipoId: 'x', cuentaId: 'x' }] : b.lineas.filter((l) => l.concepto.trim() || l.precio.trim()).map((l) => ({ concepto: l.concepto, tipoId: l.tipoId, cuentaId: l.cuentaId })),
    sinIva: { hay: haySinIva, porque: b.porque, noVale } }), ...leidas.mal] : []

  const que = corrige ? 'la rectificativa' : 'la factura'
  const donde = f?.numero ?? (cliente ? `la factura de ${cliente.nombre}` : 'la factura nueva')

  // ── Guardar el borrador ──────────────────────────────────────────────────────
  /** Guarda el borrador. Con `abrir` (de serie), una nueva abre su ficha; emitir la abre al acabar. */
  const guardarDevolviendoId = async (abrir = true): Promise<{ id: string } | string> => {
    if (!companyId) return 'No hay empresa activa.'
    if (leidas.mal.length) { const t = `Revisa ${leidas.mal.join(', ')}.`; setMensaje({ tono: 'falta', texto: t }); return t }
    setGuardando(true); setMensaje(null)
    try {
      const r = await guardarBorrador(companyId, facturaId ?? null, {
        clienteId: b.clienteId, fecha: b.fecha, vence: b.vence, serie: b.serie, formaCobroId: b.formaCobroId, localId: b.localId,
        notas: b.notas.trim() || null, correo: b.correo.trim() || null, retencionId: b.retencionId, recargo: false, motivo: b.motivo.trim() || null,
        porque: corrige ? undefined : haySinIva ? b.porque : null,
      }, leidas.lineas, userName)
      ed.reiniciar(b)
      const hecho: MensajeGuardado = { tono: 'ok', texto: `Guardado el borrador: ${r.lineas} ${r.lineas === 1 ? 'línea' : 'líneas'}, ${eurosExactos(r.total)}.` }
      setMensaje(hecho)
      if (nueva && abrir) navegar(rutaFacturaVenta(r.id), { replace: true, state: { mensaje: hecho } })
      else if (!nueva) setVuelta((x) => x + 1)
      return { id: r.id }
    } catch (e) {
      const t = e instanceof Error ? e.message : String(e)
      setMensaje({ tono: 'falta', texto: `No se ha guardado: ${t}` })
      return t
    } finally { setGuardando(false) }
  }
  const guardar = async (): Promise<ResultadoGuardar> => { const r = await guardarDevolviendoId(); return typeof r === 'string' ? r : true }
  const salida = useAvisoSalir({ hay: ed.hay && editable, cambios: ed.cambios, donde, onGuardar: guardar, onDescartar: ed.descartar })

  // ── Emitir: guardar lo que falte, número + asiento, PDF, Diez y el correo ────
  const emitir = async (enviar: boolean, para: string) => {
    setDialogo(null); setResultado(null); setAviso(null)
    if (!accountId || !companyId) return
    let id = facturaId ?? null
    if (ed.hay || !id) {
      const g = await guardarDevolviendoId(false)
      if (typeof g === 'string') return
      id = g.id
    }
    const pasos: ResultadoEmitir['pasos'] = []
    try {
      const r = await emitirFactura(id!, userName)
      const numero = r.numero
      pasos.push({ ok: true, texto: `Número ${r.numero} y su asiento${r.numero_asiento ? ` (el ${r.numero_asiento})` : ''}, validado.` })
      const guardada = await leerFactura(accountId, id!)
      if (guardada) {
        try {
          const orig = guardada.corrige ? await leerFactura(accountId, guardada.corrige.id) : null
          const emp = empresa.datos ?? await empresaDelPdf(accountId, companyId)
          await guardarPdf(accountId, guardada, datosDelPdf(emp, guardada, orig, cat?.formas.find((x) => x.id === guardada.formaCobroId)?.nombre ?? null))
          pasos.push({ ok: true, texto: 'Su PDF, hecho y guardado.' })
        } catch (e) {
          pasos.push({ ok: false, texto: `Su PDF no se ha podido hacer: ${e instanceof Error ? e.message : String(e)} Pulsa «Hacer el PDF» para reintentarlo.` })
        }
        if (r.asiento && mensual) {
          pasos.push({ ok: true, texto: `${textoTraspaso(guardada.fecha)} a Diez, con el resto del mes (Contabilidad › Cierre).` })
        } else if (r.asiento) {
          const d = await enviarADiez(r.asiento)
          pasos.push({ ok: d.estado === 'en_diez', texto: d.texto })
        }
        if (enviar) {
          const c = await enviarPorCorreo(id!, para, userName)
          pasos.push(c.enviado ? { ok: true, texto: c.texto } : { ok: false, texto: c.texto })
        }
      }
      acabar({ numero, total: r.total, pasos }, id!)
    } catch (e) {
      acabar({ numero: '', total: 0, pasos: [{ ok: false, texto: `No se ha emitido: ${e instanceof Error ? e.message : String(e)} No se ha gastado ningún número.` }] }, id!)
    }
  }
  /** El resultado, en esta ficha; si era nueva, en la suya (se lo lleva la navegación). */
  const acabar = (r: ResultadoEmitir, id?: string) => {
    if (nueva && id) { navegar(rutaFacturaVenta(id), { replace: true, state: { resultado: r } }); return }
    setResultado(r); setVuelta((x) => x + 1)
  }

  const hacerPdf = async () => {
    if (!accountId || !companyId || !f) return
    setAviso(null)
    try {
      const emp = empresa.datos ?? await empresaDelPdf(accountId, companyId)
      await guardarPdf(accountId, f, datosDelPdf(emp, f, original.datos ?? null, cat?.formas.find((x) => x.id === f.formaCobroId)?.nombre ?? null))
      setAviso({ ok: true, texto: `Hecho el PDF de la ${f.numero}.` })
      setVuelta((x) => x + 1)
    } catch (e) { setAviso({ ok: false, texto: `No se ha podido hacer el PDF: ${e instanceof Error ? e.message : String(e)}` }) }
  }
  const mandarDeNuevo = async () => {
    if (!f) return
    const para = (f.correo ?? cliente?.correo ?? '').trim()
    if (!para) { setAviso({ ok: false, texto: 'No sé a qué correo mandarla: escríbelo en «Correo del cliente» de una factura nueva o de su rectificativa.' }); return }
    setAviso(null)
    const r = await enviarPorCorreo(f.id, para, userName)
    setAviso({ ok: r.enviado, texto: r.texto })
    setVuelta((x) => x + 1)
  }
  const reenviarDiez = async () => {
    if (!f?.entryId) return
    const r = await enviarADiez(f.entryId)
    setAviso({ ok: r.estado === 'en_diez', texto: r.texto })
  }

  // ── El PDF de la derecha: el guardado, o cómo quedará el borrador ─────────────
  // V03 E2: por qué va sin IVA (el elegido; en una rectificativa, el de la que corrige).
  const porqueVista = corrige ? porqueHeredado : haySinIva ? b.porque : null
  const mencionVista = porqueVista && leidas.sinIva ? MENCION_SIN_IVA[porqueVista] : null
  const datosVista: DatosFacturaPdf | null = useMemo(() => {
    if (!empresa.datos || !editable) return null
    const c = cliente
    return {
      empresa: empresa.datos, numero: corrige ? 'R · borrador' : 'Borrador', fecha: b.fecha, vence: b.vence,
      formaCobro: cat?.formas.find((x) => x.id === b.formaCobroId)?.nombre ?? null,
      cliente: { nombre: c?.nombre ?? '(sin cliente)', nif: c?.nif ?? '(sin NIF)', direccion: f ? direccion(f.cliente) : null },
      lineas: leidas.lineas.map((l) => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento, tipo: l.tipo, importe: Math.round(l.cantidad * l.precio * (1 - l.descuento / 100) * 100) / 100 })),
      porTipo: cifras.porTipo, base: cifras.base, iva: cifras.iva, recargo: 0,
      retencion: cifras.retencion ? { pct: retPct, importe: cifras.retencion } : null, total: cifras.total, notas: b.notas.trim() || null,
      rectifica: corrige ? { numero: corrige.numero ?? '', motivo: b.motivo || corrige.motivo || '', que: NOMBRE_CORRECCION[corrige.tipo].titulo.toLowerCase() } : null,
      sinIva: mencionVista,
    }
  }, [empresa.datos, editable, cliente, corrige, b, cat, f, leidas.lineas, cifras, retPct, mencionVista])
  const vistaUrl = useMemo(() => {
    if (!datosVista) return null
    try { return URL.createObjectURL(new Blob([facturaVentaPdf(jsPDF, datosVista) as BlobPart], { type: 'application/pdf' })) } catch { return null }
  }, [datosVista])
  useEffect(() => () => { if (vistaUrl) URL.revokeObjectURL(vistaUrl) }, [vistaUrl])

  // ── Lo que se pinta ──────────────────────────────────────────────────────────
  if (borrada) {
    return (
      <div className="s-pagina">
        <EncabezadoPagina titulo="Borrador borrado" principal={<Link to={rutaFacturasVenta()} className="s-boton s-boton-principal">Volver a Facturas</Link>} />
        <p className="s-aviso-lista" data-tono="ok" role="status">Borrado el borrador{cliente ? ` de ${cliente.nombre}` : ''}. No tenía número: no deja hueco.</p>
      </div>
    )
  }
  if (leida.error || (facturaId && leida.datos === null && !leida.error && catalogos.datos && false)) {
    return <div className="s-pagina"><EncabezadoPagina titulo="Factura" /><p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer la factura: {leida.error} <button type="button" className="s-boton s-boton-enlace" onClick={leida.recargar}>Reintentar</button></p></div>
  }
  if (!cat || (facturaId && !f)) {
    return (
      <div className="s-pagina">
        <EncabezadoPagina titulo={nueva ? 'Nueva factura' : 'Factura'} />
        {catalogos.error ? <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido preparar la factura: {catalogos.error}</p>
          : <div className="s-lista" aria-busy="true" aria-label="Cargando la factura"><div className="s-lista-cargando" /></div>}
      </div>
    )
  }

  const vista = f ? { ...f, cobrado: f.cobros.reduce((t, c) => t + c.importe, 0), fuente: 'sumied' as const, guardado: f.estado, enviada: !!f.enviadaEl, diez: null, origen: f.origen, localId: f.localId, entryId: f.entryId, serie: f.serie, nif: f.cliente.nif, cliente: f.cliente.nombre } : null
  const est = vista ? NOMBRE_ESTADO[estadoDe(vista, hoy)] : NOMBRE_ESTADO.borrador
  const queda = f ? Math.max(0, Math.round(f.total * 100) - f.cobros.reduce((t, c) => t + Math.round(c.importe * 100), 0)) / 100 : 0
  const titulo = f?.numero ? `${f.rectificativa ? 'Rectificativa' : 'Factura'} ${f.numero}` : corrige ? `Rectificativa de la ${corrige.numero ?? ''}` : nueva ? 'Nueva factura' : 'Factura sin emitir'
  const nombreCliente = (editable ? cliente?.nombre : f?.cliente.nombre) ?? null

  const botonEmitir = editable
    ? <Boton variante="principal" disabled={falta.length > 0 || guardando} onClick={() => setDialogo('emitir')} title={falta.length ? `Falta ${falta.join(', ')}` : undefined}>{nueva ? 'Guardar y emitir' : 'Emitir'}</Boton>
    : null
  const botonCobro = !editable && f && f.estado === 'emitida' && queda > 0
    ? <Boton variante="principal" onClick={() => setDialogo('cobro')}>Registrar cobro</Boton>
    : null
  const principal = botonEmitir ?? botonCobro ?? <Link to={rutaFacturasVenta()} className="s-boton s-boton-secundario">Volver a la lista</Link>
  const secundarios = !editable && f && f.estado === 'emitida' ? (
    <>
      {!f.rectificativa && <Boton variante="secundario" onClick={() => setDialogo('corregir')}>Corregir</Boton>}
      {!deCierre && <Boton variante="secundario" onClick={() => void mandarDeNuevo()}>{f.enviadaEl ? 'Enviar de nuevo' : 'Enviar por correo'}</Boton>}
    </>
  ) : null
  const mas: GrupoDeAcciones[] = [{
    titulo: 'Más acciones',
    acciones: [
      ...(f?.entryId ? [{ id: 'asiento', etiqueta: 'Ver el asiento', a: rutaAsiento(f.entryId), grupo: '' }] : []),
      ...(f?.entryId && !mensual ? [{ id: 'diez', etiqueta: 'Enviar a Diez', dato: 'Si no llegó', alPulsar: () => void reenviarDiez(), grupo: '' }] : []),
      ...(f && f.estado !== 'borrador' && !f.pdf ? [{ id: 'pdf', etiqueta: 'Hacer el PDF', alPulsar: () => void hacerPdf(), grupo: '' }] : []),
      ...(pdfUrl.datos ? [{ id: 'abrir', etiqueta: 'Abrir el PDF aparte', alPulsar: () => window.open(pdfUrl.datos!, '_blank', 'noopener'), grupo: '' }] : []),
      ...(f?.estado === 'anulada' || f?.corrige?.tipo === 'anular' ? [{ id: 'nueva', etiqueta: 'Hacer una nueva bien hecha', dato: 'Con lo de la anulada', a: `${rutaNuevaFacturaVenta()}?copia=${f.corrige?.id ?? f.id}`, grupo: '' }] : []),
      ...(editable && !nueva ? [{ id: 'borrar', etiqueta: 'Borrar el borrador', dato: 'No tiene número: no deja hueco', alPulsar: () => setDialogo('borrar'), grupo: '' }] : []),
      { id: 'historial', etiqueta: 'Ver el historial', alPulsar: () => { const h = document.getElementById('historial'); h?.scrollIntoView({ behavior: 'smooth', block: 'start' }); h?.focus() }, grupo: '' },
    ],
  }]

  const frase = f?.estado === 'emitida' || f?.estado === 'anulada'
    ? `${nombreCliente ?? ''}${f.emitidaPor ? ` · emitida por ${f.emitidaPor}` : ''}${f.emitidaEl ? ` el ${f.emitidaEl.slice(8, 10)}/${f.emitidaEl.slice(5, 7)}/${f.emitidaEl.slice(0, 4)}` : ''}`
    : corrige ? `Corrige la ${corrige.numero} (${NOMBRE_CORRECCION[corrige.tipo].titulo.toLowerCase()}). Sin número hasta que se emita.` : 'Un borrador: sin número hasta que se emita. Se guarda con «Guardar cambios».'

  // El asiento: el suyo, o cómo quedará.
  const lineasAsiento = f?.entryId
    ? (asiento.datos?.apuntes ?? []).map((x) => ({ nombre: x.nombreCuenta, codigo: x.cuenta, debe: x.debe ? importeEs(x.debe) : null, haber: x.haber ? importeEs(x.haber) : null }))
    : asientoPrevio(cifras, leidas.lineas, nombreCliente, cat.cuentas).map((x) => ({ ...x, debe: x.debe === null ? null : importeEs(x.debe), haber: x.haber === null ? null : importeEs(x.haber) }))
  const notaAsiento = f?.entryId
    ? <><Link to={rutaAsiento(f.entryId)}>Ver el asiento{asiento.datos?.numero ? ` ${asiento.datos.numero}` : ''}</Link> · Validado. {mensual ? `${textoTraspaso(f.fecha)} a Diez, con el resto del mes.` : 'Va a Diez como cualquier asiento validado.'}</>
    : <>Así quedará al emitir. La subcuenta 430 del cliente y la 477 de cada tipo las pone tu plan; si al cliente le falta su 430, se le crea.{ed.hay ? ' Con cambios sin guardar, es la vista previa.' : ''}</>

  const hechos = f ? f.eventos.map((e) => ({ cuando: e.cuando, texto: `${e.texto}${e.quien ? ` · ${e.quien}` : ''}` })) : []
  const opcionesCliente = [{ valor: '', texto: 'Elige el cliente' }, ...cat.clientes.map((c) => ({ valor: c.id, texto: `${c.nombre}${c.nif ? ` · ${c.nif}` : ' · sin NIF'}` }))]
  const soloCliente = corrige?.tipo === 'datos'
  const sinLineas = corrige?.tipo === 'anular'

  const datos = (
    <>
      {editable && <div className="cxf-barra"><BarraCambios cambios={ed.cambios} onDescartar={() => { ed.descartar(); setMensaje(null) }} onGuardar={() => void guardar()} guardando={guardando} mensaje={mensaje} /></div>}
      <div role="status" aria-live="polite">
        {resultado && (
          <div className="s-aviso-lista" data-tono={resultado.pasos.every((p) => p.ok) ? 'ok' : resultado.numero ? 'duda' : 'falta'} data-prueba="resultado-emitir">
            {resultado.numero && <p><strong>Emitida la {resultado.numero} · {eurosExactos(resultado.total)}.</strong></p>}
            <ul>{resultado.pasos.map((p, i) => <li key={i}>{p.ok ? '✓' : '✕'} {p.texto}</li>)}</ul>
          </div>
        )}
        {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'}>{aviso.texto}</p>}
      </div>
      {corrige && (
        <BloqueFicha titulo="Qué corrige">
          <p>Rectifica la <Link to={rutaFacturaVenta(corrige.id)}>{corrige.numero}</Link> · {NOMBRE_CORRECCION[corrige.tipo].titulo}. {NOMBRE_CORRECCION[corrige.tipo].texto}</p>
          {editable
            ? <Campo etiqueta="Motivo">{(p) => <Texto {...p} valor={b.motivo} alCambiar={(v) => ed.poner('motivo', v)} maxLength={300} />}</Campo>
            : <p className="s-apoyo">Motivo: {corrige.motivo}</p>}
        </BloqueFicha>
      )}
      {vista && estadoDe(vista, hoy) === 'falta_liquidacion' && (
        <p className="s-aviso-lista" data-tono="duda" data-prueba="falta-su-liquidacion">
          Se ha pasado su día de pago{f?.vence ? ` (vencía el ${f.vence.slice(8, 10)}/${f.vence.slice(5, 7)})` : ''} y no ha llegado la liquidación de la plataforma que la cubre. No la doy por vencida: sube la liquidación en <Link to={rutaLiquidacionesVentas('plataformas')}>Ventas › Liquidaciones</Link> y queda cobrada por sus pedidos.
        </p>
      )}
      {f && f.rectificativas.length > 0 && (
        <p className="s-aviso-lista" data-tono="duda">Corregida por {f.rectificativas.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<Link to={rutaFacturaVenta(r.id)}>{r.numero ?? 'una rectificativa sin emitir'}</Link></span>)}.</p>
      )}

      <BloqueFicha titulo="Cliente" accion={editable && !sinLineas && !deCierre ? <Boton variante="enlace" icono="nuevo" onClick={() => setDialogo('cliente')}>Cliente nuevo</Boton> : undefined}>
        {editable && !sinLineas && !deCierre ? (
          <>
            <Campo etiqueta="Cliente" error={b.clienteId && cliente && !cliente.nif ? 'Este cliente no tiene NIF en su ficha: la factura no se puede emitir sin él.' : null}>
              {(p) => <Selector {...p} valor={b.clienteId ?? ''} opciones={opcionesCliente} alCambiar={(v) => {
                const c = cat.clientes.find((x) => x.id === v)
                ed.poner('clienteId', v || null)
                if (c?.correo && !b.correo) ed.poner('correo', c.correo)
                if (c?.retencionId && !b.retencionId) { ed.poner('retencionId', c.retencionId); setConRetencion(true) }
                if (c?.dias != null && !b.vence) ed.poner('vence', venceCon(b.fecha, c.dias))
                if (c?.formaCobro && !b.formaCobroId) { const fm = cat.formas.find((x) => x.code === c.formaCobro); if (fm) ed.poner('formaCobroId', fm.id) }
              }} />}
            </Campo>
            {soloCliente && <p className="s-apoyo">Corrige los datos del cliente en su ficha de Contactos y vuelve: la rectificativa los toma al guardarla.</p>}
            <Campo etiqueta="Correo del cliente" ayuda="Para mandarle la factura con el PDF (opcional).">{(p) => <Texto {...p} type="email" valor={b.correo} alCambiar={(v) => ed.poner('correo', v)} maxLength={200} />}</Campo>
          </>
        ) : (
          <FilaCampos columnas={2}>
            <CampoFicha etiqueta="Cliente" valor={f?.cliente.nombre ?? '—'} />
            <CampoFicha etiqueta="NIF" valor={f?.cliente.nif ?? (deCierre ? 'Consumidor final (factura resumen)' : '—')} />
            <CampoFicha etiqueta="Dirección" valor={f ? direccion(f.cliente) ?? '—' : '—'} ancho={2} />
          </FilaCampos>
        )}
      </BloqueFicha>

      <BloqueFicha titulo="Datos">
        {editable ? (
          <div className="cxv-datos">
            <Campo etiqueta="Fecha">{(p) => <Fecha {...p} valor={b.fecha} alCambiar={(v) => { ed.poner('fecha', v); if (cliente?.dias != null) ed.poner('vence', venceCon(v, cliente.dias)) }} />}</Campo>
            <Campo etiqueta="Vence">{(p) => <Fecha {...p} valor={b.vence ?? ''} alCambiar={(v) => ed.poner('vence', v || null)} />}</Campo>
            {!corrige && <Campo etiqueta="Serie" ayuda="La F, si no usas otra.">{(p) => <Texto {...p} valor={b.serie} alCambiar={(v) => ed.poner('serie', v.toUpperCase())} maxLength={10} />}</Campo>}
            <Campo etiqueta="Forma de cobro">{(p) => <Selector {...p} valor={b.formaCobroId ?? ''} alCambiar={(v) => ed.poner('formaCobroId', v || null)} opciones={[{ valor: '', texto: 'Sin decir' }, ...cat.formas.map((x) => ({ valor: x.id, texto: x.nombre }))]} />}</Campo>
            {ejeLocal && <Campo etiqueta={ejeLocal.nombre}>{(p) => <Selector {...p} valor={b.localId ?? ''} alCambiar={(v) => ed.poner('localId', v || null)} opciones={[{ valor: '', texto: 'Común' }, ...(locales.datos ?? []).map((l) => ({ valor: l.id, texto: l.nombre }))]} />}</Campo>}
          </div>
        ) : f && (
          <FilaCampos columnas={4}>
            <CampoFicha etiqueta="Fecha" valor={f.fecha.split('-').reverse().join('/')} cifra />
            <CampoFicha etiqueta="Vence" valor={f.vence ? f.vence.split('-').reverse().join('/') : '—'} cifra />
            <CampoFicha etiqueta="Forma de cobro" valor={cat.formas.find((x) => x.id === f.formaCobroId)?.nombre ?? '—'} />
            {ejeLocal && <CampoFicha etiqueta={ejeLocal.nombre} valor={f.localId ? (locales.datos ?? []).find((l) => l.id === f.localId)?.nombre ?? '—' : 'Común'} />}
          </FilaCampos>
        )}
      </BloqueFicha>

      <BloqueFicha titulo={corrige?.tipo === 'importes' ? 'Líneas: lo que debía ser' : 'Líneas'}>
        {sinLineas && <p className="s-apoyo">Anula la factura entera: va por el total, en negativo. No hay líneas que cambiar.</p>}
        {!sinLineas && (editable && !soloCliente
          ? <LineasEditables lineas={b.lineas} catalogos={cat} alCambiar={(ls) => ed.poner('lineas', ls)} soloImportes={corrige?.tipo === 'importes'} />
          : <LineasLeer lineas={editable ? leidas.lineas : (f?.lineas ?? []).map((l) => ({ ...l, recargo: null }))} debiaSer={!!corrige && corrige.tipo !== 'datos'} />)}
        {editable && haySinIva && <PorqueSinIva zona={zona} porque={b.porque} noVale={noVale} alElegir={(p) => ed.poner('porque', p)} />}
        {!editable && porqueLeido && <p className="s-apoyo" data-prueba="porque-sin-iva-leer">Sin IVA: {MENCION_SIN_IVA[porqueLeido]}</p>}
        {editable && porqueHeredado && <p className="s-apoyo">Sin IVA, como la que corrige: {MENCION_SIN_IVA[porqueHeredado]}</p>}
        {editable && !corrige && (conRetencion || b.retencionId ? (
          <Campo etiqueta="Retención (IRPF)" ayuda="La que te hace el cliente: va a la 473, como pago a cuenta tuyo.">
            {(p) => <Selector {...p} valor={b.retencionId ?? ''} alCambiar={(v) => ed.poner('retencionId', v || null)} opciones={[{ valor: '', texto: 'Sin retención' }, ...cat.retenciones.map((r) => ({ valor: r.id, texto: r.nombre }))]} />}
          </Campo>
        ) : <Boton variante="enlace" icono="nuevo" onClick={() => setConRetencion(true)}>Retención (IRPF)</Boton>)}
        {editable && <Campo etiqueta="Notas" ayuda="Salen al pie del PDF.">{(p) => <Texto {...p} valor={b.notas} alCambiar={(v) => ed.poner('notas', v)} maxLength={500} />}</Campo>}
        <Totales cifras={editable ? cifras : { base: f!.base, iva: f!.iva, recargo: f!.recargoImporte, retencion: f!.retencion, total: f!.total, porTipo: (f!.rectificativa ? cifras : cifrasGuardadas(f!.lineas)).porTipo }}
          retencionPct={editable ? retPct : f!.base ? Math.round(f!.retencion / f!.base * 10000) / 100 : 0} diferencia={!!corrige} />
        {editable && falta.length > 0 && <p className="s-apoyo" data-prueba="falta-para-emitir">Para emitirla falta {falta.join(', ')}.</p>}
      </BloqueFicha>

      {/* V03 E2 · Con Hacienda (tablero 27): la rechazada, «Corregir y reenviar» y cómo va. */}
      {f && f.estado !== 'borrador' && accountId && (
        <HaciendaDeFactura accountId={accountId} quien={userName ?? null} alCambiar={() => setVuelta((x) => x + 1)}
          factura={{ id: f.id, numero: f.numero, emitidaEl: f.emitidaEl, porque: f.porque, sinIva: f.lineas.some((l) => l.tipo === 0), pais: f.cliente.pais }} />
      )}
      {f && f.estado !== 'borrador' && <BloqueCobro total={f.total} cobros={f.cobros} anulada={f.estado === 'anulada'} alRegistrar={botonCobro ? () => setDialogo('cobro') : null} />}

      <AsientoQueSeCrea titulo={f?.entryId ? 'Su asiento' : 'El asiento que se crea'} lineas={lineasAsiento} nota={notaAsiento}
        vacio={f?.entryId ? (asiento.error ? `No se ha podido leer su asiento: ${asiento.error}` : 'Leyendo su asiento…') : 'Escribe las líneas y aquí sale el asiento.'} />
      {movil && <BloqueHistorial hechos={f ? hechos : []} error={leida.error} />}
    </>
  )

  const documento = (
    <div className="cxf-derecha">
      <DocumentoFicha titulo={f?.numero ? `${f.numero}.pdf` : 'Cómo quedará'} descargar={pdfUrl.datos ?? null}
        oculto={marco?.documentoOculto ?? false} alOcultar={(x) => marco?.ocultarDocumento(x)}>
        {pdfUrl.datos && <PapelPdf url={pdfUrl.datos} titulo={`La factura ${f?.numero ?? ''}`} />}
        {!pdfUrl.datos && editable && vistaUrl && <PapelPdf url={vistaUrl} titulo="Cómo quedará la factura" />}
        {!pdfUrl.datos && editable && !vistaUrl && <p className="s-apoyo">Cuando las líneas cuadren, aquí sale cómo quedará.</p>}
        {!editable && f && !f.pdf && <p className="s-apoyo">Aún no tiene su PDF. <Boton variante="enlace" onClick={() => void hacerPdf()}>Hacer el PDF</Boton></p>}
      </DocumentoFicha>
      {!movil && <BloqueHistorial hechos={f ? hechos : []} error={leida.error} />}
    </div>
  )

  return (
    <div className="s-pagina" data-prueba="ficha-venta" data-estado={estado}>
      <BandaPruebas />
      <EncabezadoPagina titulo={titulo} estado={{ texto: est.texto, tono: est.tono }} frase={frase}
        migasExtra={[{ etiqueta: f?.numero ?? (nueva ? 'Nueva' : 'Borrador') }]}
        principal={principal} secundarios={secundarios} masAcciones={mas} />
      <Ficha datos={datos} documento={documento} documentoOculto={marco?.documentoOculto ?? false} reglaAnchos />
      <BotonPulgar>{principal}</BotonPulgar>
      {salida.aviso}
      {dialogo === 'cliente' && accountId && (
        <DialogoClienteNuevo accountId={accountId} quien={userName} alCerrar={() => setDialogo(null)}
          alGuardar={(id) => { setDialogo(null); setVuelta((x) => x + 1); ed.poner('clienteId', id) }} />
      )}
      {dialogo === 'emitir' && (
        <DialogoEmitir que={que} total={cifras.total} correo={b.correo || cliente?.correo || ''} hayCambios={ed.hay || nueva} alCerrar={() => setDialogo(null)} alEmitir={(e, p) => void emitir(e, p)}
          traspaso={mensual ? textoTraspaso(b.fecha).replace(/^En/, 'en') : null} />
      )}
      {dialogo === 'cobro' && f && (
        <DialogoCobro numero={f.numero ?? ''} queda={queda} hoy={hoy} formas={cat.formas} alCerrar={() => setDialogo(null)}
          alCobrar={async (c) => {
            try {
              const r = await cobrarFactura(f.id, c.fecha, c.importe, c.forma, c.nota, userName)
              setDialogo(null)
              setAviso({ ok: true, texto: `Cobro registrado: ${eurosExactos(c.importe)}${r.numeroAsiento ? `, en efectivo, con su asiento nº ${r.numeroAsiento.toLocaleString('es-ES')} (570 a 430)` : ''}. ${r.queda > 0 ? `Quedan ${eurosExactos(r.queda)}.` : 'Cobrada entera.'}` })
              setVuelta((x) => x + 1)
              return null
            } catch (e) { return e instanceof Error ? e.message : String(e) }
          }} />
      )}
      {dialogo === 'corregir' && f && (
        <DialogoCorregir numero={f.numero ?? ''} sinDatos={deCierre} traspaso={mensual ? 'en el traspaso de su mes' : null} alCerrar={() => setDialogo(null)}
          alCorregir={async (tipo, motivo) => {
            try {
              const r = await corregirFactura(f.id, tipo, motivo, userName)
              setDialogo(null)
              navegar(rutaFacturaVenta(r.id))
              return null
            } catch (e) { return e instanceof Error ? e.message : String(e) }
          }} />
      )}
      {dialogo === 'borrar' && f && (
        <DialogoBorrar alCerrar={() => setDialogo(null)} alBorrar={async () => {
          try { await borrarBorrador(f.id); ed.reiniciar(b); setBorrada(true); setDialogo(null); return null } catch (e) { return e instanceof Error ? e.message : String(e) }
        }} />
      )}
    </div>
  )
}

function DialogoBorrar({ alCerrar, alBorrar }: { alCerrar: () => void; alBorrar: () => Promise<string | null> }) {
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  return (
    <Dialogo titulo="Borrar el borrador" alCerrar={alCerrar} explicacion="No tiene número, así que no deja hueco en la numeración. No se puede deshacer."
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={ocupado} onClick={() => { setOcupado(true); void alBorrar().then((e) => { setFallo(e); setOcupado(false) }) }}>{ocupado ? 'Borrando…' : 'Borrar'}</Boton>
      </>}>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </Dialogo>
  )
}
