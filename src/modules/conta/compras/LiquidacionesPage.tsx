// src/modules/conta/compras/LiquidacionesPage.tsx
//
// S02 · PR 3 · Compras y gastos › Liquidaciones, con la plantilla LISTA del
// patrón único (como Facturas recibidas y Facturas emitidas).
//
//   · Encabezado: migas del mapa, «Liquidaciones», su frase y UN principal:
//     «Subir quincena de Catcher» si la empresa trabaja con Catcher (abre la
//     zona de subir, que antes vivía al final de Facturas recibidas). La
//     mensual se sube desde su fila («Por llegar»): necesita su proveedor, su
//     local y su mes, y eso lo da la fila.
//   · Arriba, con Catcher, el saldo prepago de la 40700001 a la vista, con la
//     misma lectura que la quincena (catcherService.saldoPrepago).
//   · Pestañas que suman «Todas» (te tocan · en espera · hechas) y el tipo.
//   · La tabla: proveedor, periodo, importe y estado en palabras; cada fila
//     abre su ficha (la mensual, la quincena) o la de subir sus documentos.
// Regla 7: salen todas, también las del sistema anterior (sin ficha: al
// abrirlas se dice por qué). Regla 8: subir una quincena dice lo que ha hecho.
// Lo que se decide sin React, en liquidaciones.ts; lo que se lee, en
// liquidacionesService.ts.

import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaLiquidacion, rutaLiquidacionNueva, rutaLoteCatcher } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { mesLargo } from '@/modules/conta/lib/compras'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, Chip } from '@/modules/conta/diseno'
import { FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, escribirOrden, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import { QuincenaCatcher } from '@/modules/conta/documentos/QuincenaCatcher'
import { leerLiquidaciones } from '@/modules/conta/services/liquidacionesService'
import { saldoPrepago, usaCatcher, SALDO_PREPAGO } from '@/modules/conta/services/catcherService'
import {
  filasLiquidaciones, filtrarPorTipo, filtrosLiquidaciones, fraseSaldoPrepago, pestanasLiquidaciones, pieLiquidaciones, type FilaLiquidaciones,
} from '@/modules/conta/compras/liquidaciones'

const NOMBRE_TIPO = { mensual: 'Mensual', catcher: 'Quincena de Catcher' } as const

export default function LiquidacionesPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const hosteleria = useHosteleria()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const { search } = useLocation()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const f = filtrosLiquidaciones(query)
  const subirAbierto = query.get('subir') === 'catcher'
  const [vuelta, setVuelta] = useState(0)
  const [sinFicha, setSinFicha] = useState<string | null>(null)
  const datos = useLeer(accountId && activa ? () => leerLiquidaciones(accountId, activa.id, hoy) : null, `${accountId}:${activa?.id}:${hoy}:${vuelta}`)
  // Aparte de la lista: al subir una quincena la lista se vuelve a leer, y la zona de subir (con lo que ha hecho) no se va.
  const trabajaConCatcher = useLeer(accountId && activa ? () => usaCatcher(accountId, activa.id) : null, `${accountId}:${activa?.id}`)
  const conCatcher = hosteleria && trabajaConCatcher.datos === true
  const saldo = useLeer(conCatcher && activa ? () => saldoPrepago(activa.id) : null, `${activa?.id}:${vuelta}`)
  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(search, c)), { replace: true })

  const principal = conCatcher
    ? <Boton variante="principal" icono="subir" onClick={() => cambiar({ subir: subirAbierto ? null : 'catcher' })} aria-expanded={subirAbierto}>Subir quincena de Catcher</Boton>
    : undefined
  const encabezado = (
    <EncabezadoPagina titulo="Liquidaciones"
      frase="Los proveedores que no facturan cada entrega: las liquidaciones mensuales, local por local, y las quincenas de Catcher. Cada una con su estado."
      principal={principal} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus liquidaciones.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus liquidaciones.</p></div>

  const d = datos.datos
  const todas = d?.filas ?? []
  const deTipo = filtrarPorTipo(todas, f.tipo)
  const pestanas = pestanasLiquidaciones(deTipo)
  const filas = filasLiquidaciones(todas, f)
  const nombrePestana = pestanas.find((p) => p.id === f.pestana)?.etiqueta ?? 'Todas'
  const hayFiltro = f.pestana !== 'todas' || !!f.tipo

  const abrir = (x: FilaLiquidaciones) => {
    setSinFicha(null)
    const a = x.abrir
    if (a.a === 'liquidacion') navegar(rutaLiquidacion(a.id))
    else if (a.a === 'quincena') navegar(rutaLoteCatcher(a.id))
    else if (a.a === 'nueva') navegar(rutaLiquidacionNueva(a.proveedor, a.local, a.mes))
    else setSinFicha(a.porque)
  }
  const estado = (x: FilaLiquidaciones) => <Chip tono={x.estado.tono} titulo={x.estado.detalle}>{x.estado.texto}</Chip>
  const importe = (x: FilaLiquidaciones) => (
    <span className="s-lista-texto-doble">
      <strong className="s-cifra">{x.importe == null ? '—' : eurosExactos(x.importe)}</strong>
      <span className="s-tarjeta-apoyo">{x.apoyoImporte}</span>
    </span>
  )
  const columnas: ColumnaLista<FilaLiquidaciones>[] = [
    {
      id: 'proveedor', titulo: 'Proveedor', ordenable: true,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{x.proveedor}</span><span className="s-tarjeta-apoyo">{[NOMBRE_TIPO[x.tipo], x.local].filter(Boolean).join(' · ')}</span></span>,
    },
    {
      id: 'periodo', titulo: 'Periodo', ordenable: true,
      celda: (x) => <span className="s-lista-texto-doble"><span>{x.periodo}</span>{x.referencia && <span className="s-tarjeta-apoyo s-cifra">{x.referencia}</span>}</span>,
    },
    { id: 'importe', titulo: 'Importe', cifra: true, ordenable: true, celda: importe },
    { id: 'estado', titulo: 'Estado', celda: (x) => <span className="s-lista-texto-doble">{estado(x)}{x.estado.detalle && <span className="s-tarjeta-apoyo">{x.estado.detalle}</span>}</span> },
  ]
  const tarjeta = (x: FilaLiquidaciones) => (
    <>
      <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{x.proveedor}{x.local ? ` · ${x.local}` : ''}</span><strong className="s-cifra">{x.importe == null ? '—' : eurosExactos(x.importe)}</strong></span>
      <span className="s-tarjeta-apoyo">{[x.periodo, x.referencia, x.apoyoImporte].filter(Boolean).join(' · ')}</span>
      <span className="s-tarjeta-pie">{estado(x)}</span>
    </>
  )
  const s = saldo.datos ? fraseSaldoPrepago(saldo.datos) : null
  const [pasado, este] = d?.mesesPorLlegar ?? ['', '']

  return (
    <div className="s-pagina">
      {encabezado}
      {datos.error && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las liquidaciones: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>
      )}

      {conCatcher && (
        <p className="s-aviso-lista" data-tono={saldo.error ? 'falta' : undefined} role={saldo.error ? 'alert' : undefined} data-prueba="saldo-prepago" aria-busy={!saldo.datos && !saldo.error}>
          <strong>{saldo.datos?.nombre ?? SALDO_PREPAGO.nombre} · {SALDO_PREPAGO.cuenta}.</strong>{' '}
          {saldo.error ? <>No se ha podido leer: {saldo.error} <button type="button" className="s-boton s-boton-enlace" onClick={saldo.recargar}>Reintentar</button></>
            : s ? <>{s.frase}{s.sinValidar ? ` ${s.sinValidar}` : ''} Se compara con el portal desde cada quincena.</>
              : 'Leyendo el saldo…'}
        </p>
      )}
      {conCatcher && subirAbierto && accountId && (
        <QuincenaCatcher accountId={accountId} companyId={activa.id} quien={userName} alSubir={() => setVuelta((v) => v + 1)} />
      )}
      {hosteleria && trabajaConCatcher.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{trabajaConCatcher.error}</p>}
      {sinFicha && <p className="s-aviso-lista" data-tono="duda" role="status">{sinFicha}</p>}

      <PestanasEstado etiqueta="Estado de las liquidaciones" pestanas={pestanas} actual={f.pestana} alCambiar={(id) => cambiar({ ver: id === 'todas' ? null : id })} />
      <FiltrosLista etiqueta="Filtros de las liquidaciones">
        <FiltroSelector etiqueta="Tipo" valor={f.tipo} alCambiar={(tipo) => cambiar({ tipo: tipo || null })}
          opciones={[{ valor: '', texto: 'Todas' }, { valor: 'mensual', texto: 'Mensuales' }, { valor: 'catcher', texto: 'Quincenas de Catcher' }]} />
      </FiltrosLista>

      {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las liquidaciones"><div className="s-lista-cargando" /></div>}
      {d && (
        <TablaLista<FilaLiquidaciones>
          etiqueta={`Liquidaciones · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(x) => x.id} nombre={(x) => `${x.proveedor}${x.local ? ` ${x.local}` : ''} ${x.periodo}`}
          alAbrir={abrir} movil={movil} tarjeta={tarjeta}
          orden={f.orden} alOrdenar={(col) => cambiar({ orden: escribirOrden({ columna: col, sentido: f.orden.columna === col && f.orden.sentido === 'desc' ? 'asc' : 'desc' }) })}
          vacio={todas.length === 0
            ? <><strong>Aún no hay liquidaciones.</strong> Un proveedor que liquida cada mes se pone en su ficha, en «Cómo te factura»; las quincenas de Catcher salen aquí al subirlas.</>
            : hayFiltro
              ? <>Ninguna liquidación con estos filtros. <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ ver: null, tipo: null })}>Quitar los filtros</button></>
              : <>Ninguna liquidación.</>}
          pie={<span>{pieLiquidaciones(filas)}{pasado ? ` · las que faltan, de ${mesLargo(pasado)} y ${mesLargo(este)}` : ''}</span>}
        />
      )}

      {principal && <BotonPulgar>{principal}</BotonPulgar>}
    </div>
  )
}
