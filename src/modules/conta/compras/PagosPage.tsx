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
//   · Al marcar, la barra de abajo: el total, desde qué banco y qué día, y
//     «Pagar N facturas» (Intro) prepara la remesa y abre su ficha. Las que no
//     se pagan por remesa (domiciliada, tarjeta, sin IBAN…) se dicen en la
//     barra, con su porqué, y no entran.
//   · PC01 · E2b · En la misma barra, «Poner IBAN · proveedor» para cada
//     proveedor de las marcadas al que solo le falta el IBAN (las domiciliadas
//     y las de tarjeta no cuentan como «sin IBAN»). Al guardarlo, su factura
//     entra en la remesa sin desmarcar nada.
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
  PESTANAS_PAGOS, chipEstado, cifrasPagos, enPestana, estadoPago, filtrar, leerPestana, libre, nombreForma, ordenarPagos, porQueNoEnRemesa,
  proximoLaborable, seCargaSola, sinIbanParaPoner, type FilaPago, type FormaPago,
} from '@/modules/conta/lib/pagos'
import { crearRemesa, leerPagos } from '@/modules/conta/services/pagosService'
import { DialogoPonerIban, DialogoPonerVencimiento, DialogoYaLaHePagado } from './DialogosPagos'
import { EsperanMiSegunda } from '@/modules/conta/pagos/PagarConRevolut'
import { DialogoPagarVarias } from '@/modules/conta/pagos/PagarVarias'
import { cuentasParaPagar, textoPagarVarias } from '@/modules/conta/pagos/pagarService'
import { leerQuienPaga } from '@/modules/conta/bancos/revolut/pagosRevolut'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
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
  // Sobre la dirección de ESE momento (setQuery con función), no la del último pintado: si se pulsa una
  // pestaña y enseguida se escribe en el buscador, el buscador no puede devolver la pestaña de antes (e2e 945).
  const cambiar = (c: Record<string, string | null>) => setQuery((antes) => new URLSearchParams(conCambio(antes.toString(), c)), { replace: true })

  const pestana = leerPestana(query.get('pestana'))
  const fl = { buscar: query.get('q') ?? '', hasta: query.get('hasta') || null, forma: (query.get('forma') || 'todas') as FormaPago | 'todas', local: query.get('local') || null }
  const d = datos.datos
  const todas = useMemo(() => d?.filas ?? [], [d])
  const filas = useMemo(() => ordenarPagos(filtrar(todas, pestana, fl)), [todas, pestana, fl.buscar, fl.hasta, fl.forma, fl.local]) // eslint-disable-line react-hooks/exhaustive-deps
  const cif = d ? cifrasPagos(todas, d.pagadoMes, d.pagadasMes) : null

  // La selección y la barra de abajo.
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const deLaLista = new Set(filas.map((f) => f.id))
  const vivas = [...marcadas].filter((id) => deLaLista.has(id)).map((id) => todas.find((f) => f.id === id)!).filter(Boolean)
  const pagables = vivas.filter((f) => porQueNoEnRemesa(f) === null)
  const noPagables = vivas.filter((f) => porQueNoEnRemesa(f) !== null)
  const sinIban = sinIbanParaPoner(vivas)
  const [ponerIbanA, setPonerIbanA] = useState<{ id: string; nombre: string } | null>(null)
  const totalPagables = Math.round(pagables.reduce((t, f) => t + libre(f), 0) * 100) / 100
  const conIban = (losBancos.datos ?? []).filter((b) => b.kind === 'bank' && b.iban)
  const [bancoElegido, setBancoId] = useState<string>('')
  const [fechaPago, setFechaPago] = useState(proximoLaborable(hoy))
  // Sin elegir, el primero de los bancos con IBAN.
  const bancoId = bancoElegido || (conIban[0]?.id ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'duda' | 'falta'; texto: string } | null>(null)
  const [dialogo, setDialogo] = useState<null | 'ya' | 'vencimiento'>(null)
  // B01 · PR 3b · Si «Desde» es una cuenta con la que se paga desde Sumied (Revolut) y puedes pagar,
  // la salida principal es pagarlas con el banco; el fichero de la remesa sigue como segunda.
  const cuentasBanco = useLeer(activa ? () => cuentasParaPagar(activa.id) : null, `${activa?.id}:cuentas-para-pagar`)
  const quienPaga = useLeer(activa && (cuentasBanco.datos ?? []).length > 0 ? () => leerQuienPaga(activa.id) : null, `${activa?.id}:quien-paga:${(cuentasBanco.datos ?? []).length}`)
  const cuentaBanco = (cuentasBanco.datos ?? []).find((c) => c.id === bancoId) ?? null
  const porBanco = !!cuentaBanco && quienPaga.datos?.yoPuedo === true
  const [varias, setVarias] = useState(false)

  const pagar = async () => {
    if (!activa || pagables.length === 0 || ocupado) return
    if (!bancoId) { setAviso({ tono: 'falta', texto: 'Elige desde qué banco se paga: ninguno de tus bancos tiene IBAN.' }); return }
    setOcupado(true); setAviso(null)
    try {
      const r = await crearRemesa(activa.id, bancoId, fechaPago, pagables.map((f) => ({ id: f.id, importe: libre(f) })))
      setMarcadas(new Set())
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
      e.preventDefault(); if (porBanco) setVarias(true); else void pagar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  })

  const pestanas = PESTANAS_PAGOS.map((p) => ({ id: p.id, etiqueta: p.etiqueta, n: todas.filter((f) => enPestana(f, p.id)).length, siempre: true }))
  const mes = MES[Number(hoy.slice(5, 7)) - 1]
  const cifras = cif ? [
    { etiqueta: 'Por pagar', valor: eurosExactos(cif.porPagar.importe), apoyo: plural(cif.porPagar.n, 'factura', 'facturas'), a: rutaPagos('por_pagar') },
    { etiqueta: 'Vence esta semana', valor: eurosExactos(cif.semana.importe), apoyo: plural(cif.semana.n, 'factura', 'facturas'), a: rutaPagos('semana') },
    { etiqueta: 'Vencido', valor: eurosExactos(cif.vencido.importe), apoyo: cif.vencido.n ? `${plural(cif.vencido.n, 'factura', 'facturas')} · ${plural(cif.vencido.dias ?? 0, 'día', 'días')}` : 'Nada vencido', a: rutaPagos('vencidas') },
    { etiqueta: `Pagado en ${mes}`, valor: eurosExactos(cif.pagadoMes.importe), apoyo: plural(cif.pagadoMes.n, 'factura', 'facturas'), a: rutaPagos('pagadas') },
  ] : []

  const columnas: ColumnaLista<FilaPago>[] = [
    { id: 'vence', titulo: 'Vence', ancho: '84px', minimo: 72, celda: (f) => {
      const e = estadoPago(f)
      if (!f.vence) return <span className="pg-vence-sin">{e === 'pagada' ? '—' : 'sin fecha'}</span>
      return <span className={e === 'vencida' ? 'pg-vence-rojo' : undefined}>{diaMesCorto(f.vence)}</span>
    } },
    { id: 'proveedor', titulo: 'Proveedor', celda: (f) => f.proveedor, minimo: 160 },
    { id: 'factura', titulo: 'Factura', celda: (f) => f.numero ?? 'sin número', prioridad: 3, minimo: 110 },
    { id: 'forma', titulo: 'Cómo se paga', celda: (f) => <Chip tono={f.forma === 'direct_debit' ? 'duda' : 'neutro'}>{nombreForma(f.forma)}</Chip>, prioridad: 4, minimo: 130 },
    { id: 'total', titulo: 'Total', cifra: true, celda: (f) => eurosExactos(f.total).replace(' €', ''), prioridad: 2, minimo: 90 },
    { id: 'pendiente', titulo: 'Pendiente', cifra: true, celda: (f) => <strong>{eurosExactos(f.pendiente).replace(' €', '')}</strong>, minimo: 90 },
    { id: 'estado', titulo: 'Estado', celda: (f) => { const c = chipEstado(f); return <Chip tono={c.tono}>{c.texto}</Chip> }, minimo: 150 },
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

  return (
    <div className="pg-pagina">
      <EncabezadoPagina titulo="Pagos"
        frase="Lo que debes a tus proveedores y cuándo vence. Se paga una a una o todas juntas en una remesa para el banco, y se marca pagada sola cuando llega el cargo."
        secundarios={<BotonEnlace a={rutaRemesasPagos()}>Remesas</BotonEnlace>}
        masAcciones={[{ titulo: 'Pagos', acciones: [
          { id: 'ya', etiqueta: 'Ya la he pagado…', alPulsar: () => setDialogo('ya'), grupo: 'Pagos', dato: 'Apunta el pago de una factura suelta que ya has hecho en tu banco' },
          { id: 'vencimiento', etiqueta: 'Ponerles vencimiento', alPulsar: () => setDialogo('vencimiento'), grupo: 'Pagos', aviso: (cif?.sinVencimiento ?? 0) > 0 },
        ] }]} />

      {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer los pagos: {datos.error}</p>}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="aviso-pagos">{aviso.texto}</p>}
      {/* B01 · 2c-2 · Con dos o más personas que pagan: lo que espera tu segunda aprobación. */}
      {activa && <EsperanMiSegunda empresaId={activa.id} alCambiar={() => setVuelta((v) => v + 1)} />}
      {cif && <div className="pg-cifras" data-vencido={cif.vencido.n > 0 ? 'si' : 'no'}><CifrasBandeja cifras={cifras} /></div>}
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
            movil={movil} tarjeta={tarjeta}
            vacio={<p className="s-lista-vacia">{pestana === 'pagadas' ? 'Aún no hay facturas pagadas.' : 'No hay facturas en esta pestaña.'}</p>}
            pie={<div className="pg-pie"><span>{plural(filas.length, 'factura', 'facturas')}{filas.length !== todas.filter((f) => enPestana(f, pestana)).length ? ` de ${todas.filter((f) => enPestana(f, pestana)).length}` : ''}</span><span>Pendiente del filtro <strong className="s-cifra">{eurosExactos(pendienteFiltro)}</strong></span></div>}
            seleccion={pestana === 'pagadas' ? undefined : {
              marcadas: new Set(vivas.map((f) => f.id)),
              alMarcar: (id, m) => setMarcadas((s) => { const n = new Set(s); if (m) n.add(id); else n.delete(id); return n }),
              alMarcarTodas: (m) => setMarcadas(m ? new Set(filas.filter((f) => !seCargaSola(f)).map((f) => f.id)) : new Set()),
            }} />
        )}
      </section>

      {vivas.length > 0 && (
        <div className="pg-barra" role="region" aria-label="Pagar las seleccionadas" data-prueba="barra-pagar">
          <span className="pg-barra-total"><strong>{plural(pagables.length, 'seleccionada', 'seleccionadas')} · <span className="s-cifra">{eurosExactos(totalPagables)}</span></strong>
            {noPagables.length > 0 && <span className="pg-barra-fuera">{noPagables.length === 1 ? `1 no entra: ${porQueNoEnRemesa(noPagables[0])}` : `${noPagables.length} no entran (${noPagables.map((f) => `${f.proveedor}: ${porQueNoEnRemesa(f)}`).join('; ')})`}</span>}
          </span>
          {sinIban.map((p) => (
            <Boton key={p.id} onClick={() => setPonerIbanA(p)} data-prueba="poner-iban">Poner IBAN · {p.nombre}</Boton>
          ))}
          <label className="pg-barra-campo"><span>Desde</span>
            <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} aria-label="Desde qué banco se paga">
              {conIban.length === 0 && <option value="">Ningún banco con IBAN</option>}
              {conIban.map((b) => <option key={b.id} value={b.id}>{b.alias ?? b.nombre}{b.iban ? ` ···${b.iban.replace(/\s/g, '').slice(-4)}` : ''}</option>)}
            </select>
          </label>
          <label className="pg-barra-campo"><span>Fecha de pago</span>
            <input type="date" value={fechaPago} min={hoy} onChange={(e) => setFechaPago(e.target.value || proximoLaborable(hoy))} aria-label="Fecha de pago" />
          </label>
          {porBanco && cuentaBanco ? <>
            <Boton onClick={() => void pagar()} disabled={pagables.length === 0 || ocupado} data-prueba="preparar-fichero">{ocupado ? 'Preparando…' : 'Preparar el fichero SEPA'}</Boton>
            <Boton variante="principal" onClick={() => { setAviso(null); setVarias(true) }} disabled={pagables.length === 0 || ocupado} data-prueba="pagar-con-banco">
              {textoPagarVarias(pagables.length, cuentaBanco.banco)} <kbd className="pg-kbd">Intro</kbd>
            </Boton>
          </> : (
            <Boton variante="principal" onClick={() => void pagar()} disabled={pagables.length === 0 || ocupado || !bancoId}>
              {ocupado ? 'Preparando…' : pagables.length === 1 ? 'Pagar 1 factura' : `Pagar ${pagables.length} facturas`} <kbd className="pg-kbd">Intro</kbd>
            </Boton>
          )}
        </div>
      )}
      {vivas.length > 0 && (porBanco && cuentaBanco
        ? <p className="cx-ayuda pg-barra-nota">Desde {cuentaBanco.nombre} pagas con {cuentaBanco.banco} desde aquí: salen al momento, con una sola aprobación, y cuando llega su cargo lo caso solo con cada factura. Si prefieres el fichero para subir al banco, «Preparar el fichero SEPA».</p>
        : <p className="cx-ayuda pg-barra-nota">Te preparo la remesa (el fichero para subir al banco). Si pagas una sola, también puedes hacerlo a mano en tu banco: cuando llegue el cargo, la caso y la marco pagada.</p>)}
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
      {varias && activa && cuentaBanco && (
        <DialogoPagarVarias empresaId={activa.id} cuenta={cuentaBanco} facturas={pagables.map((f) => ({ id: f.id, proveedor: f.proveedor, numero: f.numero }))}
          alCerrar={(a) => { setVarias(false); if (a) { setAviso({ tono: a.tono === 'ok' ? 'seguro' : a.tono, texto: a.texto }); setMarcadas(new Set()); setVuelta((v) => v + 1) } }} />
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
