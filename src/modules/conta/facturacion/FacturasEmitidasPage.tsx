// src/modules/conta/facturacion/FacturasEmitidasPage.tsx
//
// S02 · PR 2 · Facturación › Facturas emitidas, con la plantilla LISTA del
// patrón único (como Compras › Facturas recibidas, su ejemplo).
//
//   · Encabezado: migas del mapa, «Facturas emitidas», su frase y UN
//     principal, «Nueva factura emitida» (la hoja del asiento con su factura).
//   · Pestañas de estado que suman «Todas»; una fila de filtros: buscar
//     (cliente, NIF, número o importe) y fecha (un mes o los últimos 12).
//   · La tabla: fecha, número, cliente, base, IVA, total y estado; cada fila
//     abre su asiento. Abajo, «N facturas · Base … · IVA … · Total …».
//   · Las facturas son las del libro registro de expedidas, leídas con su
//     servicio (librosService.leerLibroRegistro, con account_id y company_id):
//     lo mismo que Libros › Facturas expedidas, sin copiarlo. Lo que se decide
//     sin React, en emitidas.ts.
// Los filtros viven en la dirección (se recarga y queda igual). Regla 7: un
// filtro ordena y etiqueta; las anuladas salen, con su chip, y el pie dice que
// no suman. Si un mes llega al tope de filas de la base, se dice.

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaNuevaEmitida } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { diaMes, eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { limites, meses, ventanaParaRevisar } from '@/modules/conta/documentos/documentos'
import { leerLibroRegistro } from '@/modules/conta/services/librosService'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { BotonEnlace, Chip } from '@/modules/conta/diseno'
import { FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, escribirOrden, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import {
  MAX_FILAS, NOMBRE_ESTADO, facturasDeAnotaciones, filasEmitidas, filtrarSinPestana, filtrosEmitidas, mesesDeLaVentana, pestanasEmitidas, totalesEmitidas,
  type FacturaEmitida,
} from '@/modules/conta/facturacion/emitidas'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

/** El libro de expedidas de la ventana, mes a mes (cada consulta, por debajo del tope de filas). */
async function leerEmitidas(accountId: string, companyId: string, desde: string, hasta: string) {
  const porMes = await Promise.all(mesesDeLaVentana(desde, hasta).map(async (m) => ({ m, anot: await leerLibroRegistro(accountId, companyId, ['issued'], m.desde, m.hasta) })))
  return {
    facturas: facturasDeAnotaciones(porMes.flatMap((x) => x.anot)),
    // Un mes que llega al tope puede tener más: se dice cuál (regla 7).
    alTope: porMes.filter((x) => x.anot.length >= MAX_FILAS).map((x) => x.m.desde.slice(0, 7)),
  }
}

export default function FacturasEmitidasPage() {
  const { accountId, cargando } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const { search } = useLocation()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const f = filtrosEmitidas(query)
  const { desde, hasta } = f.mes ? limites(f.mes) : ventanaParaRevisar(hoy)
  const datos = useLeer(accountId && activa ? () => leerEmitidas(accountId, activa.id, desde, hasta) : null, `${accountId}:${activa?.id}:${desde}:${hasta}`)
  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(search, c)), { replace: true })

  const nueva = <BotonEnlace a={rutaNuevaEmitida()} variante="principal" icono="nuevo">Nueva factura emitida</BotonEnlace>
  const encabezado = (
    <EncabezadoPagina titulo="Facturas emitidas"
      frase="Las facturas que has emitido: las que escribes aquí y las que llegan solas de tus ventas (los resúmenes de tiques del día y las de las plataformas)."
      principal={nueva} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus facturas.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus facturas emitidas.</p></div>

  const d = datos.datos
  const todas = d?.facturas ?? []
  const pestanas = pestanasEmitidas(filtrarSinPestana(todas, f))
  const filas = filasEmitidas(todas, f)
  const t = totalesEmitidas(filas)
  const nombrePestana = pestanas.find((p) => p.id === f.pestana)?.etiqueta ?? 'Todas'
  const mesesSelector = meses(hoy)
  const nombreMes = (m: string) => mesesSelector.find((x) => x.valor === m)?.nombre ?? m
  const hayFiltro = !!f.q || f.pestana !== 'todas'

  const cliente = (x: FacturaEmitida) => x.cliente ?? 'Sin cliente'
  const estado = (x: FacturaEmitida) => {
    const e = NOMBRE_ESTADO[x.estado]
    return <span title={x.falta.length ? `Falta: ${x.falta.join(', ')}` : undefined}><Chip tono={e.tono}>{e.texto}</Chip></span>
  }
  const columnas: ColumnaLista<FacturaEmitida>[] = [
    { id: 'fecha', titulo: 'Fecha', ordenable: true, ancho: '80px', celda: (x) => <span className="s-cifra">{diaMes(x.fecha)}</span> },
    { id: 'numero', titulo: 'Número', ordenable: true, celda: (x) => <span className="s-lista-texto-doble"><span className="s-cifra">{x.numero ?? 'sin número'}</span><span className="s-tarjeta-apoyo">{x.tipo}</span></span> },
    { id: 'cliente', titulo: 'Cliente', ordenable: true, celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{cliente(x)}</span>{x.nif && <span className="s-tarjeta-apoyo">{x.nif}</span>}</span> },
    { id: 'base', titulo: 'Base', cifra: true, celda: (x) => eurosExactos(x.base) },
    { id: 'iva', titulo: 'IVA', cifra: true, celda: (x) => eurosExactos(x.iva) },
    { id: 'total', titulo: 'Total', cifra: true, ordenable: true, celda: (x) => <strong>{eurosExactos(x.total)}</strong> },
    { id: 'estado', titulo: 'Estado', celda: estado },
  ]
  const tarjeta = (x: FacturaEmitida) => (
    <>
      <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{cliente(x)}</span><strong className="s-cifra">{eurosExactos(x.total)}</strong></span>
      <span className="s-tarjeta-apoyo">{[x.numero ?? 'sin número', diaMes(x.fecha), x.tipo].join(' · ')}</span>
      <span className="s-tarjeta-pie">{estado(x)}</span>
    </>
  )
  const pie = (
    <>
      <span>{plural(t.n, 'factura', 'facturas')}{t.anuladas ? ` · ${plural(t.anuladas, 'anulada, que no suma', 'anuladas, que no suman')}` : ''}</span>
      <span className="s-lista-pie-totales">
        <span>Base <strong className="s-cifra">{eurosExactos(t.base)}</strong></span>
        <span>IVA <strong className="s-cifra">{eurosExactos(t.iva)}</strong></span>
        <span>Total <strong className="s-cifra">{eurosExactos(t.total)}</strong></span>
      </span>
    </>
  )
  const periodo = f.mes ? `en ${nombreMes(f.mes).toLowerCase()}` : 'en los últimos 12 meses'

  return (
    <div className="s-pagina">
      {encabezado}
      {datos.error && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las facturas emitidas: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>
      )}
      {d && d.alTope.length > 0 && (
        <p className="s-aviso-lista" data-tono="duda" role="status">
          {d.alTope.length === 1 ? 'En' : 'En los meses de'} {d.alTope.map((m) => nombreMes(m).toLowerCase()).join(', ')} hay {MAX_FILAS.toLocaleString('es-ES')} anotaciones o más y solo he podido leer {MAX_FILAS.toLocaleString('es-ES')} por mes: puede que falten facturas de {d.alTope.length === 1 ? 'ese mes' : 'esos meses'}. El libro de Libros › Facturas expedidas las tiene todas.
        </p>
      )}

      <PestanasEstado etiqueta="Estado de las facturas" pestanas={pestanas} actual={f.pestana} alCambiar={(id) => cambiar({ ver: id === 'todas' ? null : id })} />
      <FiltrosLista etiqueta="Filtros de las facturas">
        <FiltroBuscar valor={f.q} alCambiar={(q) => cambiar({ q })} placeholder="Cliente, NIF, número o importe" etiqueta="Buscar factura" />
        <FiltroSelector etiqueta="Fecha" valor={f.mes} alCambiar={(mes) => cambiar({ mes })}
          opciones={[{ valor: '', texto: 'Últimos 12 meses' }, ...mesesSelector.map((m) => ({ valor: m.valor, texto: m.nombre }))]} />
      </FiltrosLista>

      {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las facturas emitidas"><div className="s-lista-cargando" /></div>}
      {d && (
        <TablaLista<FacturaEmitida>
          etiqueta={`Facturas emitidas · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(x) => x.id} nombre={(x) => `${cliente(x)}${x.numero ? ` ${x.numero}` : ''}`}
          alAbrir={(x) => navegar(rutaAsiento(x.entryId))} movil={movil} tarjeta={tarjeta}
          orden={f.orden} alOrdenar={(col) => cambiar({ orden: escribirOrden({ columna: col, sentido: f.orden.columna === col && f.orden.sentido === 'desc' ? 'asc' : 'desc' }) })}
          vacio={todas.length === 0
            ? <><strong>Aún no hay facturas emitidas {periodo}.</strong> Las que escribas aquí, y las que lleguen de tus ventas, salen en esta lista. <BotonEnlace a={rutaNuevaEmitida()} variante="enlace">Nueva factura emitida</BotonEnlace></>
            : hayFiltro
              ? <>Ninguna factura con estos filtros {periodo}. <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ q: null, ver: null })}>Quitar los filtros</button></>
              : <>Ninguna factura {periodo}.</>}
          pie={pie}
        />
      )}

      <BotonPulgar>{nueva}</BotonPulgar>
    </div>
  )
}
