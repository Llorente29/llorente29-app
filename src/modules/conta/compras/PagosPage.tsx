// src/modules/conta/compras/PagosPage.tsx
//
// PC01 · Entrega 2 · Compras y gastos › Pagos (tablero 15, «pagos_1»,
// aprobado por Julio el 25/10), con la plantilla LISTA:
//
//   · Encabezado: «Pagos», su frase, «Remesas» y «Más acciones ▾» («Ya la he
//     pagado…» y «Ponerles vencimiento»). El botón principal es el de la barra
//     de abajo, «Pagar N facturas»: uno solo por pantalla.
//   · Cuatro cifras: Por pagar, Vence esta semana, Vencido (en rojo) y Pagado
//     en el mes.
//   · El aviso de las que no tienen vencimiento, con «Ponerles vencimiento».
//   · Pestañas: Por pagar (todas las que quedan: regla 7), Vencidas, Esta
//     semana, Sin vencimiento, En remesa y Pagadas.
//   · Filtros: buscar (proveedor, número o importe), Vence: hasta el…, Cómo se
//     paga y Local.
//   · La tabla: Vence · Proveedor · Factura · Cómo se paga · Total · Pendiente
//     · Estado, con casillas.
//   · B01·12 (03/11, Julio): SIN barra de abajo (no está en la maqueta v2). Al
//     marcar se abre el panel lateral (en el móvil, la hoja desde abajo), sin
//     velo: se puede seguir marcando. Con Revolut, «Aprobar y pagar»; el
//     fichero SEPA de otro banco va dentro del panel. Sin Revolut, el panel
//     prepara la remesa («Pagar N facturas», Intro). «Desde»: Revolut primero.
//   · La que no se puede pagar (domiciliada, sin IBAN, sin cuenta 400…) no se
//     deja marcar y dice por qué en su fila: nunca «0 seleccionadas» con una
//     marcada a la vista.
//   · PC01 · E2b · «Poner IBAN · proveedor» en el aviso de los que no lo
//     tienen. Al guardarlo, su factura ya se puede marcar.
//   · Debajo, los tres avisos del tablero: pagada sola, domiciliadas y con
//     tarjeta, y el IBAN que cambia.
// Lo que se decide sin React, en lib/pagos.ts; lo que se lee y escribe, en
// services/pagosService.ts (todo por funciones conta_*: dueño único, N8).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rutaPagos, rutaRemesaPagos, rutaRemesasPagos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto, eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { bancos } from '@/modules/conta/services/bancosService'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, BotonEnlace, Chip } from '@/modules/conta/diseno'
import { CifrasBandeja, FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import {
  PESTANAS_PAGOS, cambiarOrden, chipEstado, cifrasPagos, enPestana, estadoPago, filtrar, leerOrdenPagos, leerPestana, libre, llega, loDeEstaSemana, nombreForma,
  ordenarPagos, porQueNoEnRemesa, proximoLaborable, sinIbanParaPoner, type ColumnaOrdenPagos, type FilaPago, type FormaPago, type OrdenPagos,
} from '@/modules/conta/lib/pagos'
import { crearRemesa, leerPagos } from '@/modules/conta/services/pagosService'
import { DialogoPonerIban, DialogoPonerVencimiento, DialogoYaLaHePagado } from './DialogosPagos'
import { EsperanMiSegunda } from '@/modules/conta/pagos/PagarConRevolut'
import { DialogoPagarVarias, PanelFijo } from '@/modules/conta/pagos/PagarVarias'
import { ResultadoPago } from '@/modules/conta/pagos/ResultadoPago'
import { cuentasParaPagar } from '@/modules/conta/pagos/pagarService'
import { leerQuienPaga } from '@/modules/conta/bancos/revolut/pagosRevolut'

/** Cola 1d · El orden elegido se recuerda (solo en este navegador; si no se puede guardar, el de siempre). */
const CLAVE_ORDEN = 'sumied.pagos.orden'
function ordenGuardado(): OrdenPagos { try { return leerOrdenPagos(window.localStorage.getItem(CLAVE_ORDEN)) } catch { return leerOrdenPagos(null) } }
function guardarOrden(o: OrdenPagos) { try { window.localStorage.setItem(CLAVE_ORDEN, `${o.columna}:${o.sentido}`) } catch { /* sin almacenamiento: no se recuerda */ } }

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «Vence: hasta el…»: lo que vence de aquí a una fecha (y lo vencido, que ya ha pasado). */
function opcionesVence(hoy: string): { valor: string; texto: string }[] {
  const mas = (d: number) => { const x = new Date(`${hoy}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
  const finMes = (() => { const x = new Date(`${hoy}T12:00:00Z`); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) })()
  return [
    { valor: '', texto: 'Cuando sea' },
    { valor: mas(7), texto: `Hasta el ${diaMesCorto(mas(7))}` },
    { valor: mas(20), texto: `Hasta el ${diaMesCorto(mas(20))}` },
    { valor: finMes, texto: `Hasta el ${diaMesCorto(finMes)}` },
  ]
}

export default function PagosPage() {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const { local: ejeLocal } = useAnalitica()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(activa ? () => leerPagos(activa.id, hoy) : null, `${activa?.id}:${hoy}:${vuelta}:pagos`)
  const losBancos = useLeer(accountId && activa ? () => bancos.bancosDeLaEmpresa(accountId, activa.id) : null, `${accountId}:${activa?.id}:bancos-pagos`)
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}-local:locales`)
  // Sobre la dirección de ESE momento, no la del último pintado: si se pulsa una pestaña y enseguida se
  // escribe en el buscador, el buscador no puede devolver la pestaña de antes (e2e 945). setQuery con
  // función NO basta: recibe la dirección del último pintado. B01 · Cola 1e (02/11, medido en local con la
  // e2e 41528093606: 7 de 10 volvían a «Vencidas»): se lee la del navegador, que cambia al momento.
  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(window.location.search.replace(/^\?/, ''), c)), { replace: true })

  const pestana = leerPestana(query.get('pestana'))
  const fl = { buscar: query.get('q') ?? '', hasta: query.get('hasta') || null, forma: (query.get('forma') || 'todas') as FormaPago | 'todas', local: query.get('local') || null }
  const d = datos.datos
  const todas = useMemo(() => d?.filas ?? [], [d])
  const [orden, setOrden] = useState<OrdenPagos>(ordenGuardado)
  const ordenarPor = (c: string) => setOrden((o) => { const n = cambiarOrden(o, c as ColumnaOrdenPagos); guardarOrden(n); return n })
  const filas = useMemo(() => ordenarPagos(filtrar(todas, pestana, fl), orden), [todas, pestana, fl.buscar, fl.hasta, fl.forma, fl.local, orden]) // eslint-disable-line react-hooks/exhaustive-deps
  const cif = d ? cifrasPagos(todas, d.pagadoMes, d.pagadasMes) : null

  // La selección y el panel lateral.
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState(false)
  const deLaLista = new Set(filas.map((f) => f.id))
  const vivas = [...marcadas].filter((id) => deLaLista.has(id)).map((id) => todas.find((f) => f.id === id)!).filter(Boolean)
  const pagables = vivas.filter((f) => porQueNoEnRemesa(f) === null)
  // Los proveedores con facturas por pagar a los que solo les falta el IBAN: «Poner IBAN» en su aviso.
  const sinIban = useMemo(() => sinIbanParaPoner(todas), [todas])
  const [ponerIbanA, setPonerIbanA] = useState<{ id: string; nombre: string } | null>(null)
  const totalPagables = Math.round(pagables.reduce((t, f) => t + libre(f), 0) * 100) / 100
  const conIban = (losBancos.datos ?? []).filter((b) => b.kind === 'bank' && b.iban)
  const [bancoElegido, setBancoId] = useState<string>('')
  const [fechaPago, setFechaPago] = useState(proximoLaborable(hoy))
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'duda' | 'falta'; texto: string } | null>(null)
  const [dialogo, setDialogo] = useState<null | 'ya' | 'vencimiento'>(null)
  // B01 · PR 3b · Si «Desde» es una cuenta con la que se paga desde Sumied (Revolut) y puedes pagar,
  // la salida principal es pagarlas con el banco; el fichero de la remesa sigue como segunda.
  const cuentasBanco = useLeer(activa ? () => cuentasParaPagar(activa.id) : null, `${activa?.id}:cuentas-para-pagar`)
  const quienPaga = useLeer(activa && (cuentasBanco.datos ?? []).length > 0 ? () => leerQuienPaga(activa.id) : null, `${activa?.id}:quien-paga:${(cuentasBanco.datos ?? []).length}`)
  // B01·12 · «Desde»: Revolut por defecto (Julio, B01r·4). El fichero SEPA, de otro banco si lo hay.
  const revolut = new Set((cuentasBanco.datos ?? []).map((c) => c.id))
  const cuentaBanco = (cuentasBanco.datos ?? [])[0] ?? null
  const porBanco = !!cuentaBanco && quienPaga.datos?.yoPuedo === true
  const bancoId = bancoElegido && conIban.some((b) => b.id === bancoElegido) ? bancoElegido
    : ((porBanco ? conIban.find((b) => !revolut.has(b.id)) : conIban.find((b) => revolut.has(b.id))) ?? conIban[0])?.id ?? ''
  const otrosBancos = conIban.filter((b) => !revolut.has(b.id))
  // B01 · Cola 1e · El último pago mandado desde aquí: debajo de la frase, cómo va cada factura (maqueta v2, pantalla 4).
  const [loteHecho, setLoteHecho] = useState<string | null>(null)
  // B01 · Cola 1e · «Pagar lo de esta semana»: lo vencido y lo de esta semana que se puede pagar, marcado de una vez.
  const semana = useMemo(() => loDeEstaSemana(todas), [todas])
  const pagarLoDeEstaSemana = () => {
    cambiar({ pestana: null, q: null, hasta: null, forma: null, local: null })
    setMarcadas(new Set(semana.entran.map((f) => f.id)))
    setAviso(null)
    if (semana.entran.length > 0) setAbierto(true)
  }
  // El saldo de cada banco que paga, con «llega / no llega» para lo marcado (o para lo de esta semana, sin nada marcado).
  const paraSaldo = vivas.length > 0 ? totalPagables : semana.total

  const pagar = async () => {
    if (!activa || pagables.length === 0 || ocupado) return
    if (!bancoId) { setAviso({ tono: 'falta', texto: 'Elige desde qué banco se paga: ninguno de tus bancos tiene IBAN.' }); return }
    setOcupado(true); setAviso(null)
    try {
      const r = await crearRemesa(activa.id, bancoId, fechaPago, pagables.map((f) => ({ id: f.id, importe: libre(f) })))
      setMarcadas(new Set()); setAbierto(false)
      navegar(rutaRemesaPagos(r.remesa), { state: { frase: r.frase } })
    } catch (e) {
      setAviso({ tono: 'falta', texto: `No se ha preparado la remesa: ${(e as Error).message}` })
    } finally { setOcupado(false) }
  }

  // Intro paga (como en el tablero), si hay algo que pagar y no se está escribiendo en un campo.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Enter' || !pagables.length || dialogo || ponerIbanA || (t && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(t.tagName))) return
      e.preventDefault(); if (!abierto) setAbierto(true); else if (!porBanco) void pagar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  })

  const pestanas = PESTANAS_PAGOS.map((p) => ({ id: p.id, etiqueta: p.etiqueta, n: todas.filter((f) => enPestana(f, p.id)).length, siempre: true }))
  const mes = MES[Number(hoy.slice(5, 7)) - 1]
  const cifras = cif ? [
    { etiqueta: 'Vencido', valor: eurosExactos(cif.vencido.importe), apoyo: cif.vencido.n ? `${plural(cif.vencido.n, 'factura', 'facturas')} · ${plural(cif.vencido.dias ?? 0, 'día', 'días')}` : 'Nada vencido', a: rutaPagos('vencidas') },
    { etiqueta: 'Vence esta semana', valor: eurosExactos(cif.semana.importe), apoyo: plural(cif.semana.n, 'factura', 'facturas'), a: rutaPagos('semana') },
    { etiqueta: 'Por revisar', valor: eurosExactos(cif.porRevisar.importe), apoyo: cif.porRevisar.n ? `${plural(cif.porRevisar.n, 'factura', 'facturas')} · apruébalas para pagarlas` : 'Nada por revisar', a: rutaPagos('por_pagar') },
    { etiqueta: `Pagado en ${mes}`, valor: eurosExactos(cif.pagadoMes.importe), apoyo: plural(cif.pagadoMes.n, 'factura', 'facturas'), a: rutaPagos('pagadas') },
  ] : []

  const columnas: ColumnaLista<FilaPago>[] = [
    { id: 'vence', titulo: 'Vence', ancho: '84px', minimo: 72, ordenable: true, celda: (f) => {
      const e = estadoPago(f)
      if (!f.vence) return <span className="pg-vence-sin">{e === 'pagada' ? '—' : 'sin fecha'}</span>
      return <span className={e === 'vencida' ? 'pg-vence-rojo' : undefined}>{diaMesCorto(f.vence)}</span>
    } },
    { id: 'proveedor', titulo: 'Proveedor', celda: (f) => f.proveedor, minimo: 160, ordenable: true },
    { id: 'factura', titulo: 'Factura', celda: (f) => f.numero ?? 'sin número', prioridad: 3, minimo: 110 },
    { id: 'forma', titulo: 'Cómo se paga', celda: (f) => <Chip tono={f.forma === 'direct_debit' ? 'duda' : 'neutro'}>{nombreForma(f.forma)}</Chip>, prioridad: 4, minimo: 130 },
    { id: 'total', titulo: 'Total', cifra: true, celda: (f) => eurosExactos(f.total).replace(' €', ''), prioridad: 2, minimo: 90 },
    { id: 'pendiente', titulo: 'Pendiente', cifra: true, celda: (f) => <strong>{eurosExactos(f.pendiente).replace(' €', '')}</strong>, minimo: 90, ordenable: true },
    { id: 'estado', titulo: 'Estado', celda: (f) => { const c = chipEstado(f); return <Chip tono={c.tono}>{c.texto}</Chip> }, minimo: 150, ordenable: true },
  ]
  const tarjeta = (f: FilaPago) => {
    const c = chipEstado(f)
    return (
      <span className="pg-tarjeta">
        <span className="pg-tarjeta-fila"><strong>{f.proveedor}</strong><strong className="s-cifra">{eurosExactos(f.pendiente)}</strong></span>
        <span className="pg-tarjeta-fila cx-ayuda"><span>{f.numero ?? 'sin número'} · {f.vence ? `vence ${diaMesCorto(f.vence)}` : 'sin fecha'}</span><Chip tono={c.tono}>{c.texto}</Chip></span>
      </span>
    )
  }

  const pendienteFiltro = Math.round(filas.reduce((t, f) => t + f.pendiente, 0) * 100) / 100
  const sinPlazo = d?.sinPlazo ?? []
  const conPlazo = cif ? cif.sinVencimiento - todas.filter((f) => estadoPago(f) === 'sin_vencimiento' && sinPlazo.some((s) => s.id === f.proveedorId)).length : 0

  // «Desde» y el día del fichero, dentro del panel.
  const camposSepa = (lista: typeof conIban, fecha: string) => (
    <div className="pg-panel-campos">
      <label className="pg-panel-campo"><span className="s-apoyo">Desde</span>
        <select value={lista.some((b) => b.id === bancoId) ? bancoId : (lista[0]?.id ?? '')} onChange={(e) => setBancoId(e.target.value)} aria-label="Desde qué banco se paga">
          {lista.length === 0 && <option value="">Ningún banco con IBAN</option>}
          {lista.map((b) => <option key={b.id} value={b.id}>{b.alias ?? b.nombre}{b.iban ? ` ···${b.iban.replace(/\s/g, '').slice(-4)}` : ''}</option>)}
        </select>
      </label>
      <label className="pg-panel-campo"><span className="s-apoyo">{fecha}</span>
        <input type="date" value={fechaPago} min={hoy} onChange={(e) => setFechaPago(e.target.value || proximoLaborable(hoy))} aria-label="Fecha de pago" />
      </label>
    </div>
  )

  return (
    <div className="pg-pagina" data-panel={abierto && pagables.length > 0 ? 'si' : 'no'}>
      <EncabezadoPagina titulo="Pagos"
        frase="Lo que debes a tus proveedores y cuándo vence. Se paga una a una o todas juntas en una remesa para el banco, y se marca pagada sola cuando llega el cargo."
        secundarios={<>
          {(cuentasBanco.datos ?? []).map((c) => {
            const l = llega(c.saldo ?? null, paraSaldo)
            return (
              <span key={c.id} className="pg-saldo" data-prueba="saldo-banco" data-llega={l === null ? 'no-se' : l ? 'si' : 'no'}>
                <span>{c.nombre}</span>
                <strong className="s-cifra">{c.saldo === null || c.saldo === undefined ? 'sin saldo' : eurosExactos(c.saldo)}</strong>
                {l !== null && paraSaldo > 0 && <span className={l ? 'pg-saldo-llega' : 'pg-saldo-no'}>{l ? 'Llega' : 'No llega'} para {vivas.length > 0 ? 'lo marcado' : 'lo de esta semana'}</span>}
              </span>
            )
          })}
          <BotonEnlace a={rutaRemesasPagos()}>Remesas</BotonEnlace>
        </>}
        masAcciones={[{ titulo: 'Pagos', acciones: [
          { id: 'ya', etiqueta: 'Ya la he pagado…', alPulsar: () => setDialogo('ya'), grupo: 'Pagos', dato: 'Apunta el pago de una factura suelta que ya has hecho en tu banco' },
          { id: 'vencimiento', etiqueta: 'Ponerles vencimiento', alPulsar: () => setDialogo('vencimiento'), grupo: 'Pagos', aviso: (cif?.sinVencimiento ?? 0) > 0 },
        ] }]} />

      {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer los pagos: {datos.error}</p>}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="aviso-pagos">{aviso.texto}</p>}
      {loteHecho && activa && <ResultadoPago empresaId={activa.id} lote={loteHecho} />}
      {/* B01 · 2c-2 · Con dos o más personas que pagan: lo que espera tu segunda aprobación. */}
      {activa && <EsperanMiSegunda empresaId={activa.id} alCambiar={() => setVuelta((v) => v + 1)} />}
      {cif && (
        <section className="pg-toca" aria-label="Lo que toca pagar" data-prueba="lo-que-toca">
          <h2 className="pg-toca-titulo">Lo que toca pagar hoy, {DIA[new Date(`${hoy}T12:00:00Z`).getUTCDay()]} {hoy.slice(8, 10)}/{hoy.slice(5, 7)}</h2>
          <div className="pg-cifras" data-vencido={cif.vencido.n > 0 ? 'si' : 'no'}><CifrasBandeja cifras={cifras} /></div>
          {pagables.length > 0 && !abierto ? (
            <Boton variante="principal" className="pg-toca-boton" onClick={() => setAbierto(true)} data-prueba="abrir-panel">
              <span>Pagar las marcadas · {plural(pagables.length, 'factura', 'facturas')}</span><span className="s-cifra">{eurosExactos(totalPagables)}</span>
            </Boton>
          ) : semana.entran.length > 0 && (
            <Boton variante="principal" className="pg-toca-boton" onClick={pagarLoDeEstaSemana} data-prueba="pagar-lo-de-esta-semana">
              <span>Pagar lo de esta semana · {plural(semana.entran.length, 'factura', 'facturas')}</span><span className="s-cifra">{eurosExactos(semana.total)}</span>
            </Boton>
          )}
          {semana.entran.length > 0 && porBanco && cuentaBanco && <p className="cx-ayuda">Vencidas y de esta semana que se pueden pagar desde {cuentaBanco.banco}.</p>}
          {semana.fuera.length > 0 && (
            <p className="cx-ayuda" data-prueba="fuera-esta-semana">
              {semana.fuera.length === 1 ? `Se queda fuera ${semana.fuera[0].proveedor}: ${porQueNoEnRemesa(semana.fuera[0])}.` : `Se quedan fuera ${semana.fuera.length}: ${semana.fuera.map((f) => `${f.proveedor} (${porQueNoEnRemesa(f)})`).join('; ')}.`}
            </p>
          )}
        </section>
      )}
      {sinIban.length > 0 && (
        <div className="pg-aviso-ambar" role="status" data-prueba="sin-iban">
          <p><strong>{sinIban.length === 1 ? `${sinIban[0].nombre} no tiene IBAN` : `${plural(sinIban.length, 'proveedor no tiene', 'proveedores no tienen')} IBAN`}.</strong> Sus facturas no se pueden marcar para pagar hasta que lo pongas.</p>
          {sinIban.map((p) => <button key={p.id} type="button" className="pg-enlace" onClick={() => setPonerIbanA(p)} data-prueba="poner-iban">Poner IBAN · {p.nombre}</button>)}
        </div>
      )}
      {cif && cif.sinVencimiento > 0 && (
        <div className="pg-aviso-ambar" role="status" data-prueba="sin-vencimiento">
          <p>
            <strong>{plural(cif.sinVencimiento, 'factura no tiene vencimiento', 'facturas no tienen vencimiento')}.</strong>{' '}
            Se lo pongo con el plazo de pago de cada proveedor
            {sinPlazo.length > 0 ? ` (${plural(Math.max(conPlazo, 0), 'lo tiene', 'lo tienen')} en su ficha; a ${plural(sinPlazo.length, 'proveedor', 'proveedores')} te pregunto).` : '.'}
          </p>
          <button type="button" className="pg-enlace" onClick={() => setDialogo('vencimiento')}>Ponerles vencimiento</button>
        </div>
      )}

      <section className="pg-caja">
        <PestanasEstado etiqueta="Estado de los pagos" pestanas={pestanas} actual={pestana} alCambiar={(id) => cambiar({ pestana: id === 'por_pagar' ? null : id })} />
        <FiltrosLista etiqueta="Filtros de los pagos">
          <FiltroBuscar valor={fl.buscar} alCambiar={(q) => cambiar({ q: q || null })} placeholder="Buscar proveedor, número o importe" etiqueta="Buscar un pago" />
          <FiltroSelector etiqueta="Vence" valor={fl.hasta ?? ''} alCambiar={(v) => cambiar({ hasta: v || null })} opciones={opcionesVence(hoy)} />
          <FiltroSelector etiqueta="Cómo se paga" valor={fl.forma === 'todas' ? '' : fl.forma ?? ''} alCambiar={(v) => cambiar({ forma: v || null })}
            opciones={[{ valor: '', texto: 'Todas' }, { valor: 'transfer', texto: 'Transferencia' }, { valor: 'direct_debit', texto: 'Domiciliada' }, { valor: 'card', texto: 'Tarjeta' }, { valor: 'prepaid', texto: 'Saldo prepago' }]} />
          {ejeLocal && (locales.datos ?? []).length > 1 && (
            <FiltroSelector etiqueta={ejeLocal.nombre} valor={fl.local ?? ''} alCambiar={(v) => cambiar({ local: v || null })}
              opciones={[{ valor: '', texto: 'Todos' }, ...(locales.datos ?? []).map((l) => ({ valor: l.id, texto: l.nombre }))]} />
          )}
        </FiltrosLista>
        {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando los pagos"><div className="s-lista-cargando" /></div>}
        {d && (
          <TablaLista<FilaPago>
            etiqueta={`Pagos · ${PESTANAS_PAGOS.find((p) => p.id === pestana)!.etiqueta}`}
            columnas={columnas} filas={filas} clave={(f) => f.id} nombre={(f) => `${f.proveedor} ${f.numero ?? ''}`.trim()}
            alAbrir={(f) => navegar(f.remesa && estadoPago(f) === 'en_remesa' ? rutaRemesaPagos(f.remesa.id) : rutaRevisarFactura(f.id))}
            movil={movil} tarjeta={tarjeta} orden={orden} alOrdenar={ordenarPor}
            vacio={<p className="s-lista-vacia">{pestana === 'pagadas' ? 'Aún no hay facturas pagadas.' : 'No hay facturas en esta pestaña.'}</p>}
            pie={<div className="pg-pie"><span>{plural(filas.length, 'factura', 'facturas')}{filas.length !== todas.filter((f) => enPestana(f, pestana)).length ? ` de ${todas.filter((f) => enPestana(f, pestana)).length}` : ''}</span><span>Pendiente del filtro <strong className="s-cifra">{eurosExactos(pendienteFiltro)}</strong></span></div>}
            seleccion={pestana === 'pagadas' ? undefined : {
              marcadas: new Set(vivas.map((f) => f.id)),
              alMarcar: (id, m) => { setMarcadas((s) => { const n = new Set(s); if (m) n.add(id); else n.delete(id); return n }); if (m) { setAviso(null); setAbierto(true) } },
              alMarcarTodas: (m) => { const ids = filas.filter((f) => porQueNoEnRemesa(f) === null).map((f) => f.id); setMarcadas(m ? new Set(ids) : new Set()); if (m && ids.length) setAbierto(true) },
              bloqueo: (id) => { const f = todas.find((x) => x.id === id); return f ? porQueNoEnRemesa(f) : null },
            }} />
        )}
      </section>

      {abierto && pagables.length > 0 && activa && (porBanco && cuentaBanco ? (
        <DialogoPagarVarias fijo empresaId={activa.id} cuenta={cuentaBanco} facturas={pagables.map((f) => ({ id: f.id, proveedor: f.proveedor, numero: f.numero }))}
          extra={otrosBancos.length > 0 && (
            <details className="pg-panel-sepa" data-prueba="panel-sepa">
              <summary>Preparar el fichero SEPA</summary>
              <p className="s-apoyo">{otrosBancos.map((b) => `${b.alias ?? b.nombre}${b.iban ? ` ···${b.iban.replace(/\s/g, '').slice(-4)}` : ''}`).join(', ')} no {otrosBancos.length === 1 ? 'paga' : 'pagan'} desde Sumied: con {otrosBancos.length === 1 ? 'él' : 'ellos'}, el fichero para subir al banco.</p>
              {camposSepa(otrosBancos, 'Fecha del fichero SEPA')}
              <Boton onClick={() => void pagar()} disabled={ocupado || !bancoId} data-prueba="preparar-fichero">{ocupado ? 'Preparando…' : 'Preparar el fichero SEPA'}</Boton>
            </details>
          )}
          alCerrar={(a) => { setAbierto(false); if (a) { setAviso({ tono: a.tono === 'ok' ? 'seguro' : a.tono, texto: a.texto }); setLoteHecho(a.lote ?? null); setMarcadas(new Set()); setVuelta((v) => v + 1) } }} />
      ) : (
        <PanelFijo titulo={pagables.length === 1 ? 'Pagar 1 factura' : `Pagar ${pagables.length} facturas`} alCerrar={() => setAbierto(false)}
          acciones={<>
            <Boton onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton variante="principal" onClick={() => void pagar()} disabled={ocupado || !bancoId} data-prueba="preparar-remesa">
              {ocupado ? 'Preparando…' : pagables.length === 1 ? 'Pagar 1 factura' : `Pagar ${pagables.length} facturas`} <kbd className="pg-kbd">Intro</kbd>
            </Boton>
          </>}>
          <ul className="pg-panel-facturas" data-prueba="lista-remesa">
            {pagables.map((f) => (
              <li key={f.id} className="pg-panel-factura">
                <div className="pg-panel-par"><span className="pg-panel-quien">{f.proveedor} · {f.numero ?? 'sin número'}</span><span className="s-cifra">{eurosExactos(libre(f))}</span></div>
              </li>
            ))}
            <li className="pg-panel-par pg-panel-total"><strong>{pagables.length === 1 ? '1 transferencia' : `${pagables.length} transferencias, una por factura`}</strong><strong className="s-cifra">{eurosExactos(totalPagables)}</strong></li>
          </ul>
          {camposSepa(conIban, 'Fecha de pago')}
          <p className="s-apoyo">Te preparo la remesa (el fichero para subir al banco). Si pagas una sola, también puedes hacerlo a mano en tu banco: cuando llegue el cargo, la caso y la marco pagada.</p>
          {aviso?.tono === 'falta' && <p className="s-aviso-lista" data-tono="falta" role="alert">{aviso.texto}</p>}
        </PanelFijo>
      ))}
      {cuentasBanco.error && <p className="s-apoyo">No se ha podido saber si se puede pagar desde Sumied: {cuentasBanco.error}</p>}

      <div className="pg-notas">
        <p><strong>Pagada sola.</strong> Cuando el cargo llega al banco, Sumied lo casa con la factura o con la remesa entera, hace el asiento y la marca pagada. No hay que cambiar ningún estado a mano.</p>
        <p><strong>Domiciliadas y con tarjeta.</strong> No se pagan desde aquí: el banco las cobra solo. Salen para que sepas lo que va a salir de la cuenta, y se marcan pagadas con el cargo.</p>
        <p><strong>Un IBAN que cambia, se confirma.</strong> Si el IBAN de un proveedor ha cambiado hace poco, no entra en la remesa hasta que lo confirmes: es el engaño más común con facturas falsas.</p>
      </div>

      {dialogo === 'ya' && activa && (
        <DialogoYaLaHePagado empresaId={activa.id} hoy={hoy} bancos={(losBancos.datos ?? []).filter((b) => b.kind === 'bank')}
          facturas={todas.filter((f) => estadoPago(f) !== 'pagada' && libre(f) >= 0.005)} elegida={vivas.length === 1 ? vivas[0].id : null}
          alCerrar={(frase) => { setDialogo(null); if (frase) { setAviso({ tono: 'seguro', texto: frase }); setVuelta((v) => v + 1) } }} />
      )}
      {ponerIbanA && (
        <DialogoPonerIban proveedor={ponerIbanA}
          alCerrar={(frase) => { setPonerIbanA(null); if (frase) { setAviso({ tono: 'seguro', texto: frase }); setVuelta((v) => v + 1) } }} />
      )}
      {dialogo === 'vencimiento' && activa && (
        <DialogoPonerVencimiento empresaId={activa.id} sinPlazo={sinPlazo} sinVencimiento={cif?.sinVencimiento ?? 0}
          alCerrar={(frase) => { setDialogo(null); if (frase) { setAviso({ tono: 'seguro', texto: frase }); setVuelta((v) => v + 1) } }} />
      )}
    </div>
  )
}
