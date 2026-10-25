// src/modules/conta/ventas/FacturasPage.tsx
//
// V01 · Entrega 1 · Ventas › Facturas (tablero 10), con la plantilla LISTA.
// Es la de antes (Facturación › Facturas emitidas, S02 · PR 2) crecida: ahora
// las facturas de venta son un documento propio, con su borrador, su cobro y
// su envío a Diez, y siguen saliendo las que ya estaban en el libro.
//
//   · Encabezado: «Facturas», su frase y UN principal, «Nueva factura».
//   · Cuatro cifras: Por cobrar, Vencido, Cobrado en el mes y Borradores; cada
//     una lleva a su pestaña.
//   · Pestañas que suman «Todas» (regla 7): Borradores, Por cobrar, Vencidas,
//     Cobradas, Anuladas; y, solo si las hay, Rectificativas (en negativo) y
//     Del libro (las del cierre del día y las traídas de Diez, que no se cobran
//     aquí).
//   · Filtros: buscar (cliente, NIF, número o importe), fecha (un mes o los
//     últimos 12), origen, serie y local; solo salen los que tienen algo que
//     elegir.
//   · La tabla, con la regla de anchos (N5): Número · Fecha · Cliente · Origen
//     · Base · Total · Vence · Estado · Diez. Una de Sumied abre su ficha; una
//     del libro, su asiento.
// Lo que se decide sin React, en lib/facturasVenta.ts; lo que se lee, en
// services/ventasService.ts (con account_id y company_id, regla 9).

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaFacturaVenta, rutaNuevaFacturaVenta, rutaConta, CONTA } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { diaMes, eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { limites, meses, ventanaParaRevisar } from '@/modules/conta/documentos/documentos'
import { leerFacturasVenta } from '@/modules/conta/services/ventasService'
import { PdfsQueFaltan } from './PdfsQueFaltan'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { MAX_FILAS } from '@/modules/conta/facturacion/emitidas'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { BotonEnlace, Chip } from '@/modules/conta/diseno'
import { CifrasBandeja, FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, escribirOrden, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import {
  NOMBRE_ESTADO, NOMBRE_ORIGEN, TONO_ORIGEN, cifrasFacturas, estadoDe, filasFacturas, filtrarSinPestana, filtrosFacturas, origenesQueHay, pestanasFacturas, quedaPorCobrar,
  seriesQueHay, totalDelFiltro, type DiezFactura, type FacturaVenta,
} from '@/modules/conta/lib/facturasVenta'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

const DIEZ: Record<Exclude<DiezFactura, null>, { texto: string; tono: 'seguro' | 'neutro' | 'falta' | 'duda' }> = {
  enviada: { texto: '✓ Diez', tono: 'seguro' },
  en_cola: { texto: 'En cola', tono: 'duda' },
  error: { texto: 'No llegó', tono: 'falta' },
  sin_envio: { texto: 'Apagado', tono: 'neutro' },
}

export default function FacturasPage() {
  const { accountId, cargando } = useCuentaConta()
  const { activa } = useEmpresas()
  const { local: ejeLocal } = useAnalitica()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const { search } = useLocation()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const f = filtrosFacturas(query)
  const { desde, hasta } = f.mes ? limites(f.mes) : ventanaParaRevisar(hoy)
  const datos = useLeer(accountId && activa ? () => leerFacturasVenta(accountId, activa.id, desde, hasta) : null, `${accountId}:${activa?.id}:${desde}:${hasta}:ventas`)
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}-local:locales`)
  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(search, c)), { replace: true })

  const nueva = <BotonEnlace a={rutaNuevaFacturaVenta()} variante="principal" icono="nuevo">Nueva factura</BotonEnlace>
  const encabezado = (
    <EncabezadoPagina titulo="Facturas"
      frase="Las facturas que haces a tus clientes: las que escribes aquí, sus cobros y su envío a Diez, y las que ya estaban en tu libro."
      principal={nueva} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus facturas.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus facturas.</p></div>

  const d = datos.datos
  const todas = d?.facturas ?? []
  const pestanas = pestanasFacturas(filtrarSinPestana(todas, f), hoy)
  const filas = filasFacturas(todas, f, hoy)
  const nombrePestana = pestanas.find((p) => p.id === f.pestana)?.etiqueta ?? 'Todas'
  const mesesSelector = meses(hoy)
  const nombreMes = (m: string) => mesesSelector.find((x) => x.valor === m)?.nombre ?? m
  const hayFiltro = !!f.q || f.pestana !== 'todas' || !!f.origen || !!f.serie || !!f.local
  const origenes = origenesQueHay(todas)
  const series = seriesQueHay(todas)
  const nombreLocal = new Map((locales.datos ?? []).map((l) => [l.id, l.nombre]))

  const lista = rutaConta(CONTA.rutas.facturasVenta)
  const cif = d ? cifrasFacturas(todas, d.cobros, hoy) : null
  const cifras = cif ? [
    {
      etiqueta: 'Por cobrar', valor: eurosExactos(cif.porCobrar.total),
      apoyo: `${plural(cif.porCobrar.n, 'factura', 'facturas')}${cif.porCobrar.esperando ? ` · ${cif.porCobrar.esperando} esperando liquidación` : ''}`,
      a: `${lista}?ver=por-cobrar`,
    },
    {
      etiqueta: 'Vencido', valor: eurosExactos(cif.vencido.total),
      apoyo: cif.vencido.masAntigua ? `${plural(cif.vencido.n, 'factura', 'facturas')} · la más antigua, ${cif.vencido.masAntigua.dias} días` : 'Ninguna vencida',
      a: `${lista}?ver=vencidas`,
    },
    { etiqueta: 'Cobrado en el mes', valor: eurosExactos(cif.cobradoMes.total), apoyo: plural(cif.cobradoMes.n, 'cobro', 'cobros'), a: `${lista}?ver=cobradas` },
    { etiqueta: 'Borradores', valor: eurosExactos(cif.borradores.total), apoyo: cif.borradores.n ? `${plural(cif.borradores.n, 'sin emitir', 'sin emitir')}` : 'Ninguno', a: `${lista}?ver=borradores` },
  ] : []

  const cliente = (x: FacturaVenta) => x.cliente ?? (x.fuente === 'libro' ? 'Ventas a consumidor final' : 'Sin cliente')
  const estado = (x: FacturaVenta) => {
    const e = NOMBRE_ESTADO[estadoDe(x, hoy)]
    return <Chip tono={e.tono}>{e.texto}</Chip>
  }
  const vence = (x: FacturaVenta) => {
    if (!x.vence || x.fuente === 'libro') return <span className="s-tarjeta-apoyo">—</span>
    const atrasada = estadoDe(x, hoy) === 'vencida'
    return <span className="s-cifra" data-tono={atrasada ? 'falta' : undefined}>{diaMes(x.vence)}</span>
  }
  const diez = (x: FacturaVenta) => (x.diez ? <Chip tono={DIEZ[x.diez].tono}>{DIEZ[x.diez].texto}</Chip> : <span className="s-tarjeta-apoyo">—</span>)
  const columnas: ColumnaLista<FacturaVenta>[] = [
    {
      id: 'numero', titulo: 'Número', ordenable: true, prioridad: 1, minimo: 120,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-cifra">{x.numero ?? 'Borrador'}</span>{x.rectificativa && <span className="s-tarjeta-apoyo">Rectificativa</span>}</span>,
    },
    { id: 'fecha', titulo: 'Fecha', ordenable: true, ancho: '80px', prioridad: 2, minimo: 80, celda: (x) => <span className="s-cifra">{diaMes(x.fecha)}</span> },
    {
      id: 'cliente', titulo: 'Cliente', ordenable: true, prioridad: 1, minimo: 200,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{cliente(x)}</span>{(x.nif || (x.localId && nombreLocal.get(x.localId))) && <span className="s-tarjeta-apoyo">{[x.nif, x.localId ? nombreLocal.get(x.localId) : null].filter(Boolean).join(' · ')}</span>}</span>,
    },
    { id: 'origen', titulo: 'Origen', prioridad: 5, minimo: 130, celda: (x) => <Chip tono={TONO_ORIGEN[x.origen]}>{NOMBRE_ORIGEN[x.origen]}</Chip> },
    { id: 'base', titulo: 'Base', cifra: true, prioridad: 4, minimo: 100, celda: (x) => eurosExactos(x.base) },
    { id: 'total', titulo: 'Total', cifra: true, ordenable: true, prioridad: 1, minimo: 110, celda: (x) => <strong>{eurosExactos(x.total)}</strong> },
    { id: 'vence', titulo: 'Vence', ordenable: true, prioridad: 3, minimo: 80, celda: vence },
    { id: 'estado', titulo: 'Estado', prioridad: 2, minimo: 140, celda: estado },
    { id: 'diez', titulo: 'Diez', prioridad: 4, minimo: 90, celda: diez },
  ]
  const tarjeta = (x: FacturaVenta) => {
    const queda = x.fuente === 'sumied' && x.guardado === 'emitida' && x.total > 0 ? quedaPorCobrar(x) : 0
    return (
      <>
        <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{cliente(x)}</span><strong className="s-cifra">{eurosExactos(x.total)}</strong></span>
        <span className="s-tarjeta-apoyo">{[x.numero ?? 'Borrador', diaMes(x.fecha), NOMBRE_ORIGEN[x.origen], x.vence && x.fuente === 'sumied' ? `vence ${diaMes(x.vence)}` : null].filter(Boolean).join(' · ')}</span>
        <span className="s-tarjeta-pie">{estado(x)}{queda > 0 && queda !== x.total && <span className="s-tarjeta-apoyo">Quedan {eurosExactos(queda)}</span>}{x.diez && diez(x)}</span>
      </>
    )
  }
  const anuladas = filas.filter((x) => x.guardado === 'anulada').length
  const pie = (
    <>
      <span>{plural(filas.length, 'factura', 'facturas')}{anuladas ? ` · ${plural(anuladas, 'anulada, que no suma', 'anuladas, que no suman')}` : ''}</span>
      <span className="s-lista-pie-totales"><span>Total <strong className="s-cifra">{eurosExactos(totalDelFiltro(filas))}</strong></span></span>
    </>
  )
  const periodo = f.mes ? `en ${nombreMes(f.mes).toLowerCase()}` : 'en los últimos 12 meses'

  return (
    <div className="s-pagina">
      {encabezado}
      {datos.error && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las facturas: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>
      )}
      {d && d.alTope.length > 0 && (
        <p className="s-aviso-lista" data-tono="duda" role="status">
          {d.alTope.length === 1 ? 'En' : 'En los meses de'} {d.alTope.map((m) => nombreMes(m).toLowerCase()).join(', ')} hay {MAX_FILAS.toLocaleString('es-ES')} anotaciones o más en tu libro y solo he podido leer {MAX_FILAS.toLocaleString('es-ES')} por mes: puede que falten facturas del libro de {d.alTope.length === 1 ? 'ese mes' : 'esos meses'}. Libros › Facturas expedidas las tiene todas.
        </p>
      )}
      {cif && <CifrasBandeja cifras={cifras} />}
      {/* V01 · El histórico: las emitidas sin su PDF (los traídos de Diez), para hacerlos aquí. */}
      {accountId && <PdfsQueFaltan accountId={accountId} companyId={activa.id} />}

      <PestanasEstado etiqueta="Estado de las facturas" pestanas={pestanas} actual={f.pestana} alCambiar={(id) => cambiar({ ver: id === 'todas' ? null : id })} />
      <FiltrosLista etiqueta="Filtros de las facturas">
        <FiltroBuscar valor={f.q} alCambiar={(q) => cambiar({ q })} placeholder="Cliente, número o importe" etiqueta="Buscar factura" />
        <FiltroSelector etiqueta="Fecha" valor={f.mes} alCambiar={(mes) => cambiar({ mes })}
          opciones={[{ valor: '', texto: 'Últimos 12 meses' }, ...mesesSelector.map((m) => ({ valor: m.valor, texto: m.nombre }))]} />
        {origenes.length > 1 && (
          <FiltroSelector etiqueta="Origen" valor={f.origen} alCambiar={(origen) => cambiar({ origen })}
            opciones={[{ valor: '', texto: 'Todos los orígenes' }, ...origenes.map((o) => ({ valor: o, texto: NOMBRE_ORIGEN[o] }))]} />
        )}
        {series.length > 1 && (
          <FiltroSelector etiqueta="Serie" valor={f.serie} alCambiar={(serie) => cambiar({ serie })}
            opciones={[{ valor: '', texto: 'Todas las series' }, ...series.map((x) => ({ valor: x, texto: `Serie ${x}` }))]} />
        )}
        {ejeLocal && (locales.datos ?? []).length > 1 && (
          <FiltroSelector etiqueta={ejeLocal.nombre} valor={f.local} alCambiar={(local) => cambiar({ local })}
            opciones={[{ valor: '', texto: `Todos los ${ejeLocal.plural.toLowerCase()}` }, ...(locales.datos ?? []).map((l) => ({ valor: l.id, texto: l.nombre }))]} />
        )}
      </FiltrosLista>

      {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las facturas"><div className="s-lista-cargando" /></div>}
      {d && (
        <TablaLista<FacturaVenta>
          etiqueta={`Facturas · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(x) => x.id} nombre={(x) => `${cliente(x)}${x.numero ? ` ${x.numero}` : ' borrador'}`}
          alAbrir={(x) => navegar(x.fuente === 'sumied' ? rutaFacturaVenta(x.id) : rutaAsiento(x.entryId ?? ''))} movil={movil} tarjeta={tarjeta}
          orden={f.orden} alOrdenar={(col) => cambiar({ orden: escribirOrden({ columna: col, sentido: f.orden.columna === col && f.orden.sentido === 'desc' ? 'asc' : 'desc' }) })}
          vacio={todas.length === 0
            ? <><strong>Aún no hay facturas {periodo}.</strong> Las que escribas aquí, y las que lleguen de tus ventas, salen en esta lista. <BotonEnlace a={rutaNuevaFacturaVenta()} variante="enlace">Nueva factura</BotonEnlace></>
            : hayFiltro
              ? <>Ninguna factura con estos filtros {periodo}. <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ q: null, ver: null, origen: null, serie: null, local: null })}>Quitar los filtros</button></>
              : <>Ninguna factura {periodo}.</>}
          pie={pie}
        />
      )}

      <BotonPulgar>{nueva}</BotonPulgar>
    </div>
  )
}
