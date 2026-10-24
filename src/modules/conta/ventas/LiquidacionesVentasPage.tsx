// src/modules/conta/ventas/LiquidacionesVentasPage.tsx
//
// V01 · Entrega 3 · Ventas › Hostelería › Liquidaciones (captura ventas_5),
// con la plantilla LISTA. Solo con «Vendo en hostelería». Dos vistas:
//
//   · Plataformas: una fila por periodo, plataforma y local (Uber liquida por
//     tienda: se suman las tiendas del mismo local), con Ventas · Comisión ·
//     Otros · Pagan · Banco · su factura de comisión y el estado (Diferencia ·
//     Falta su factura · Por cobrar · Cuadra). Pestañas que suman «Todas»
//     (regla 7). Cada fila abre su ficha, donde se resuelve una diferencia en
//     una frase (gasto o reclamación) y se casa el cobro.
//   · Socios de marca: las liquidaciones mensuales del socio (CTB), por mes y
//     por local, también las que se esperan y aún no han llegado. Cada una abre
//     su ficha (subir sus documentos, sus albaranes del mes como soporte, su
//     factura, sus asientos y su cobro).
// Lo que se decide sin React, en lib/liquidacionesPlataforma.ts; lo que se
// lee, en services/liquidacionesVentasService.ts y liquidacionesService.ts.

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaFacturasVenta, rutaLiquidacion, rutaLiquidacionNueva, rutaLiquidacionPlataforma } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { BotonEnlace, Chip } from '@/modules/conta/diseno'
import { FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import {
  NOMBRE_ESTADO, cifras, estado, filtrar, fraseEstado, periodo, pestanaDe, pestanas, type GrupoPlataforma,
} from '@/modules/conta/lib/liquidacionesPlataforma'
import { leerPlataformas } from '@/modules/conta/services/liquidacionesVentasService'
import { leerLiquidaciones } from '@/modules/conta/services/liquidacionesService'
import type { FilaLiquidaciones } from '@/modules/conta/compras/liquidaciones'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
const euros = (x: number | null) => (x === null ? '—' : eurosExactos(x))

/** Desde cuándo: los tres últimos meses (de serie), este año o todas. */
function desdeDe(v: string | null, hoy: string): { valor: string; desde: string | null } {
  if (v === 'todas') return { valor: 'todas', desde: null }
  if (v === 'ano') return { valor: 'ano', desde: `${hoy.slice(0, 4)}-01-01` }
  const d = new Date(`${hoy.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 2)
  return { valor: '', desde: d.toISOString().slice(0, 10) }
}

export default function LiquidacionesVentasPage() {
  const { accountId, cargando } = useCuentaConta()
  const { activa } = useEmpresas()
  const hosteleria = useHosteleria()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const { search } = useLocation()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const ver = query.get('ver') === 'socios' ? 'socios' : 'plataformas'
  const pestana = pestanaDe(query.get('estado'))
  const q = query.get('q') ?? ''
  const desde = desdeDe(query.get('desde'), hoy)
  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(search, c)), { replace: true })

  const plataformas = useLeer(accountId && activa && hosteleria && ver === 'plataformas' ? () => leerPlataformas(activa.id, desde.desde, null) : null,
    // La clave lleva hostelería y la vista: si no, al saberse que es de hostelería (después de pintar) no se volvía a leer y se quedaba cargando.
    `${accountId}:${activa?.id}:${hosteleria}:${ver}:plataformas:${desde.desde}`)
  const socios = useLeer(accountId && activa && hosteleria && ver === 'socios' ? () => leerLiquidaciones(accountId, activa.id, hoy) : null,
    `${accountId}:${activa?.id}:${hosteleria}:${ver}:socios:${hoy}`)

  const encabezado = (
    <EncabezadoPagina titulo="Liquidaciones"
      frase={ver === 'plataformas'
        ? 'Lo que te liquidan las plataformas, por periodo y local, comparado con tus cierres y con el banco. La comisión y su IVA van como gasto con su factura; aquí se comprueba y se casa el cobro.'
        : 'Lo que liquidas cada mes con el socio de las marcas cedidas, local por local: sus documentos, los albaranes que pagó y los asientos.'} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus liquidaciones.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus liquidaciones.</p></div>
  if (!hosteleria) {
    return (
      <div className="s-pagina">
        <EncabezadoPagina titulo="Liquidaciones" />
        <p className="s-apoyo">Las liquidaciones de plataformas y de socios de marca son de las empresas que venden en hostelería (Ajustes › Tu empresa). Tus ventas están en <BotonEnlace a={rutaFacturasVenta()} variante="enlace">Facturas</BotonEnlace>.</p>
      </div>
    )
  }

  const filtros = (
    <FiltrosLista etiqueta="Qué liquidaciones">
      <FiltroSelector etiqueta="Ver" valor={ver} alCambiar={(v) => cambiar({ ver: v === 'socios' ? 'socios' : null, estado: null, q: null })}
        opciones={[{ valor: 'plataformas', texto: 'Plataformas' }, { valor: 'socios', texto: 'Socios de marca' }]} />
      {ver === 'plataformas' && (
        <>
          <FiltroSelector etiqueta="Desde" valor={desde.valor} alCambiar={(v) => cambiar({ desde: v || null })}
            opciones={[{ valor: '', texto: 'Los tres últimos meses' }, { valor: 'ano', texto: 'Este año' }, { valor: 'todas', texto: 'Todas' }]} />
          <FiltroBuscar valor={q} alCambiar={(v) => cambiar({ q: v || null })} placeholder="Plataforma, local, tienda o fecha" />
        </>
      )}
    </FiltrosLista>
  )

  if (ver === 'socios') return <div className="s-pagina">{encabezado}{filtros}<Socios datos={socios.datos?.filas ?? null} error={socios.error} recargar={socios.recargar} movil={movil} navegar={navegar} /></div>

  const todos = plataformas.datos ?? []
  const ps = pestanas(todos)
  const filas = filtrar(todos, pestana, q)
  const nombrePestana = ps.find((p) => p.id === pestana)?.etiqueta ?? 'Todas'
  const chip = (g: GrupoPlataforma) => { const e = NOMBRE_ESTADO[estado(g)]; return <Chip tono={e.tono}>{e.texto}</Chip> }
  const columnas: ColumnaLista<GrupoPlataforma>[] = [
    {
      id: 'plataforma', titulo: 'Plataforma', prioridad: 1, minimo: 190,
      celda: (g) => (
        <span className="s-lista-texto-doble">
          <span className="s-lista-principal">{g.canal} · {g.local ?? 'sin local'}</span>
          <span className="s-tarjeta-apoyo">{periodo(g.desde, g.hasta)} · {plural(g.liquidaciones.length, 'liquidación', 'liquidaciones')}</span>
        </span>
      ),
    },
    { id: 'ventas', titulo: 'Ventas', cifra: true, prioridad: 2, minimo: 100, celda: (g) => euros(cifras(g).ventas) },
    { id: 'comision', titulo: 'Comisión', cifra: true, prioridad: 4, minimo: 100, celda: (g) => euros(cifras(g).comision) },
    { id: 'otros', titulo: 'Otros', cifra: true, prioridad: 5, minimo: 90, celda: (g) => euros(cifras(g).otros) },
    { id: 'pagan', titulo: 'Pagan', cifra: true, prioridad: 1, minimo: 100, celda: (g) => <strong>{euros(cifras(g).pagan)}</strong> },
    { id: 'banco', titulo: 'Banco', cifra: true, prioridad: 3, minimo: 100, celda: (g) => euros(cifras(g).banco) },
    {
      id: 'factura', titulo: 'Su factura', prioridad: 5, minimo: 120,
      celda: (g) => {
        const fs = g.liquidaciones.map((l) => l.factura?.numero).filter(Boolean)
        const c = cifras(g)
        return fs.length ? <span className="s-cifra">{[...new Set(fs)].join(', ')}</span> : <span className="s-tarjeta-apoyo">{c.faltanFacturas ? 'Falta' : '—'}</span>
      },
    },
    { id: 'estado', titulo: 'Estado', prioridad: 2, minimo: 150, celda: (g) => <span className="s-lista-texto-doble">{chip(g)}<span className="s-tarjeta-apoyo">{fraseEstado(g)}</span></span> },
  ]
  const tarjeta = (g: GrupoPlataforma) => {
    const c = cifras(g)
    return (
      <>
        <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{g.canal} · {g.local ?? 'sin local'}</span><strong className="s-cifra">{euros(c.pagan)}</strong></span>
        <span className="s-tarjeta-apoyo">{periodo(g.desde, g.hasta)} · ventas {euros(c.ventas)} · banco {euros(c.banco)}</span>
        <span className="s-tarjeta-pie">{chip(g)}<span className="s-tarjeta-apoyo">{fraseEstado(g)}</span></span>
      </>
    )
  }
  const suma = (k: 'ventas' | 'pagan' | 'banco') => Math.round(filas.reduce((t, g) => t + (cifras(g)[k] ?? 0), 0) * 100) / 100

  return (
    <div className="s-pagina">
      {encabezado}
      {plataformas.error && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las liquidaciones: {plataformas.error} <button type="button" className="s-boton s-boton-enlace" onClick={plataformas.recargar}>Reintentar</button></p>
      )}
      <PestanasEstado etiqueta="Estado de las liquidaciones" pestanas={ps} actual={pestana} alCambiar={(id) => cambiar({ estado: id === 'todas' ? null : id })} />
      {filtros}
      {!plataformas.datos && !plataformas.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las liquidaciones"><div className="s-lista-cargando" /></div>}
      {plataformas.datos && (
        <TablaLista<GrupoPlataforma>
          etiqueta={`Liquidaciones de plataforma · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(g) => g.clave} nombre={(g) => `${g.canal} ${g.local ?? 'sin local'} ${periodo(g.desde, g.hasta)}`}
          alAbrir={(g) => navegar(`${rutaLiquidacionPlataforma(g.clave)}${search}`)} movil={movil} tarjeta={tarjeta}
          vacio={todos.length === 0
            ? <><strong>Aún no hay liquidaciones de plataforma{desde.desde ? ' en estos meses' : ''}.</strong> Llegan por correo a la dirección de liquidaciones de tu empresa, o se suben en Contactos › Plataformas.</>
            : <>Ninguna con estos filtros. <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ estado: null, q: null })}>Quitar los filtros</button></>}
          pie={<span>{plural(filas.length, 'fila', 'filas')} · ventas {eurosExactos(suma('ventas'))} · pagan {eurosExactos(suma('pagan'))} · banco {eurosExactos(suma('banco'))}</span>}
        />
      )}
    </div>
  )
}

/** Las mensuales del socio de marca: las guardadas y las que se esperan del mes pasado y de este. */
function Socios({ datos, error, recargar, movil, navegar }: {
  datos: FilaLiquidaciones[] | null; error: string | null; recargar: () => void; movil: boolean; navegar: (a: string) => void
}) {
  const filas = (datos ?? []).filter((x) => x.tipo === 'mensual')
  const abrir = (x: FilaLiquidaciones) => {
    const a = x.abrir
    if (a.a === 'liquidacion') navegar(rutaLiquidacion(a.id))
    else if (a.a === 'nueva') navegar(rutaLiquidacionNueva(a.proveedor, a.local, a.mes))
  }
  const chip = (x: FilaLiquidaciones) => <Chip tono={x.estado.tono} titulo={x.estado.detalle}>{x.estado.texto}</Chip>
  const columnas: ColumnaLista<FilaLiquidaciones>[] = [
    { id: 'socio', titulo: 'Socio', prioridad: 1, minimo: 200,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{x.proveedor}</span><span className="s-tarjeta-apoyo">{x.local ?? 'sin local'}</span></span> },
    { id: 'periodo', titulo: 'Mes', prioridad: 2, minimo: 150,
      celda: (x) => <span className="s-lista-texto-doble"><span>{x.periodo}</span>{x.referencia && <span className="s-tarjeta-apoyo s-cifra">{x.referencia}</span>}</span> },
    { id: 'importe', titulo: 'Saldo', cifra: true, prioridad: 1, minimo: 120,
      celda: (x) => <span className="s-lista-texto-doble"><strong className="s-cifra">{x.importe == null ? '—' : eurosExactos(x.importe)}</strong><span className="s-tarjeta-apoyo">{x.apoyoImporte}</span></span> },
    { id: 'estado', titulo: 'Estado', prioridad: 3, minimo: 160,
      celda: (x) => <span className="s-lista-texto-doble">{chip(x)}{x.estado.detalle && <span className="s-tarjeta-apoyo">{x.estado.detalle}</span>}</span> },
  ]
  return (
    <>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las liquidaciones: {error} <button type="button" className="s-boton s-boton-enlace" onClick={recargar}>Reintentar</button></p>}
      {!datos && !error && <div className="s-lista" aria-busy="true" aria-label="Cargando las liquidaciones"><div className="s-lista-cargando" /></div>}
      {datos && (
        <TablaLista<FilaLiquidaciones>
          etiqueta="Liquidaciones de los socios de marca" columnas={columnas} filas={filas} clave={(x) => x.id}
          nombre={(x) => `${x.proveedor}${x.local ? ` ${x.local}` : ''} ${x.periodo}`} alAbrir={abrir} movil={movil}
          tarjeta={(x) => (
            <>
              <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{x.proveedor}{x.local ? ` · ${x.local}` : ''}</span><strong className="s-cifra">{x.importe == null ? '—' : eurosExactos(x.importe)}</strong></span>
              <span className="s-tarjeta-apoyo">{[x.periodo, x.referencia, x.apoyoImporte].filter(Boolean).join(' · ')}</span>
              <span className="s-tarjeta-pie">{chip(x)}</span>
            </>
          )}
          vacio={<><strong>Aún no hay liquidaciones de socios de marca.</strong> El socio que liquida cada mes se pone en su ficha de proveedor, en «Cómo te factura»; cada mes sale aquí, local por local, hasta que llegan sus documentos.</>}
          pie={<span>{plural(filas.length, 'liquidación', 'liquidaciones')}, también las del sistema anterior, que se conservan como estaban.</span>}
        />
      )}
    </>
  )
}
