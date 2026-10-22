// src/modules/conta/documentos/DocumentosPage.tsx
//
// S02 · Compras y gastos › Facturas recibidas, con la plantilla LISTA del
// patrón único (tablero 2; en el móvil, tablero 4). La primera pantalla que se
// muda al patrón: el ejemplo para las demás.
//
//   · Encabezado: migas, «Facturas recibidas», su frase; «Exportar» en blanco y
//     UN principal, «Subir factura» (el único de Compras: regla 1 del patrón);
//     lo demás en «Más acciones ▾».
//   · Pestañas de estado con su número, que suman «Todas» (recibidas.ts), y a
//     la derecha «Revisarlas de una en una →».
//   · Una fila de filtros: buscar, fecha, proveedor, local y «Más filtros»
//     (cómo llegó). La fecha es un filtro de la lista: esta pantalla no lee el
//     periodo contable, así que no pone el botón del periodo en la cabecera
//     (decisión 3 de Julio, 22/10).
//   · La tabla, y abajo «9 facturas por revisar · Base … · IVA … · Total …».
//   · Al volver de una ficha, la lista está igual: los filtros, el orden y la
//     fila donde ibas (?fila=) en la dirección, y la última lista recordada en
//     la pestaña del navegador para «Volver», las migas y Esc.
// En el móvil: la tabla en tarjetas y, abajo, «Revisar de una en una» y
// «Subir factura».
//
// Regla 7: «Todas» trae todas, también las repetidas y las descartadas; un
// filtro ordena y etiqueta, nunca decide qué existe. Regla 8: subir dice qué
// ha entrado y qué no.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CONSULTA_RECIBIDA_A_MANO, rutaCompras, rutaRecibidaEnAsientos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { diaMes, entendido, meses, productoDeDocumentos, type FilaDocumento } from '@/modules/conta/documentos/documentos'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { leerDocumentos, leerExtrasFacturas, subirFacturas, urlDeLlegada, urlDePapelDeRecepcion, type ExtraFactura, type Subida } from '@/modules/conta/services/documentosService'
import { Pedirselas } from '@/modules/conta/documentos/Pedirselas'
import { QuincenaCatcher } from '@/modules/conta/documentos/QuincenaCatcher'
import { usaCatcher } from '@/modules/conta/services/catcherService'
import { useAnalitica, useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Chip, Icono } from '@/modules/conta/diseno'
import {
  FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, escribirOrden, recordarLista, type ColumnaLista,
} from '@/modules/conta/diseno/plantillas'
import {
  LISTA_RECIBIDAS, NOMBRE_CANAL, colaDeFacturas, estadoDeFila, filasDeLaLista, filtrarSinPestana, filtrosDe, fraseDeLaLista, localDeFila, pestanasConNumero, totales,
  ventanaDe,
} from '@/modules/conta/documentos/recibidas'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

export default function DocumentosPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const solo = useProductoSolo()
  const producto = productoDeDocumentos(solo, MARCA.nombre)
  const { local: ejeLocal } = useAnalitica()
  const hosteleria = useHosteleria()
  const navegar = useNavigate()
  const { pathname, search } = useLocation()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const f = filtrosDe(query)
  const fila = query.get('fila')
  const { desde, hasta } = ventanaDe(f.mes, hoy)
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(activa ? () => leerDocumentos(activa.id, desde, hasta) : null, `${activa?.id}:${desde}:${hasta}:${vuelta}`)
  const ids = useMemo(() => (datos.datos?.filas ?? []).filter((x) => x.tipo === 'factura').map((x) => x.id), [datos.datos])
  const extras = useLeer(accountId && ids.length ? () => leerExtrasFacturas(accountId, ids) : null, `${accountId}:${ids.join(',')}`)
  const mapa = extras.datos ?? (new Map() as Map<string, ExtraFactura>)
  const conCatcher = useLeer(accountId && activa ? () => usaCatcher(accountId, activa.id) : null, `${accountId}:${activa?.id}`)

  const ficheros = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState<{ i: number; de: number } | null>(null)
  const [subidas, setSubidas] = useState<Subida[] | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [masFiltros, setMasFiltros] = useState(!!f.canal)

  // La lista se recuerda tal cual está (filtros, orden y fila), para volver a ella.
  useEffect(() => { recordarLista(LISTA_RECIBIDAS, `${pathname}${search}`) }, [pathname, search])

  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(search, { ...c, fila: null })), { replace: true })

  async function subir(lista: FileList | null) {
    const fs = lista ? [...lista] : []
    if (!fs.length || !accountId || !activa) return
    setSubidas(null); setFallo(null); setSubiendo({ i: 0, de: fs.length })
    try {
      const r = await subirFacturas(accountId, activa.id, fs, userName, (i) => setSubiendo({ i, de: fs.length }))
      setSubidas(r)
      setVuelta((v) => v + 1)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally {
      setSubiendo(null)
      if (ficheros.current) ficheros.current.value = ''
      if (camara.current) camara.current.value = ''
    }
  }

  async function abrirLlegada(x: FilaDocumento) {
    try {
      const url = x.tipo === 'recepcion' ? await urlDePapelDeRecepcion(x.papel) : await urlDeLlegada(x.id)
      if (!url) { setFallo('Ese documento no tiene fichero que enseñar.'); return }
      window.open(url, '_blank', 'noopener')
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) }
  }

  if (!accountId && !cargando) return <div className="s-pagina"><p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus facturas.</p></div>
  if (!activa) return <div className="s-pagina"><p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí llegan sus facturas.</p></div>

  const d = datos.datos
  const todasLasFilas = d?.filas ?? []
  const base = filtrarSinPestana(todasLasFilas, mapa, f)
  const pestanas = pestanasConNumero(base, mapa)
  const filas = filasDeLaLista(todasLasFilas, mapa, f)
  const t = totales(filas, mapa)
  const nombrePestana = pestanas.find((p) => p.id === f.pestana)?.etiqueta ?? 'Todas'

  /** Abrir una fila: se apunta la fila en la lista (para volver a ella) y se va a su ficha con la lista detrás. */
  const abrir = (x: FilaDocumento) => {
    if (x.tipo !== 'factura') { void abrirLlegada(x); return }
    const conFila = conCambio(search, { fila: x.id })
    setQuery(new URLSearchParams(conFila), { replace: true })
    recordarLista(LISTA_RECIBIDAS, `${pathname}${conFila}`)
    navegar(`${rutaRevisarFactura(x.id)}${conFila}`)
  }
  const revisarUnaAUna = () => {
    const q = conCambio(search, { ver: 'por-revisar', fila: null })
    const primera = colaDeFacturas(filasDeLaLista(todasLasFilas, mapa, { ...f, pestana: 'por-revisar' }))[0]
    if (primera) navegar(`${rutaRevisarFactura(primera)}${q}`)
  }
  const porRevisar = pestanas.find((p) => p.id === 'por-revisar')?.n ?? 0

  // Los filtros: proveedores y locales de las filas que hay (la lista con la que se elige es la que se lee: regla 30).
  const proveedores = [...new Map(todasLasFilas.filter((x) => x.proveedor.id).map((x) => [x.proveedor.id!, x.proveedor.nombre ?? '—'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'es'))
  const locales = [...new Set(todasLasFilas.map((x) => localDeFila(x, mapa.get(x.id))).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es'))
  const canales = [...new Set(todasLasFilas.map((x) => x.canal))]

  const nombre = (x: FilaDocumento) => x.proveedor.nombre ?? (x.tipo === 'llegada' ? 'Documento sin leer' : 'No reconozco el emisor')
  const euro = (n: number | null | undefined) => (n === null || n === undefined ? '—' : eurosExactos(n))
  const propuesto = (x: FilaDocumento) => {
    if (x.tipo !== 'factura' || !x.entendido) return null
    const apuntada = x.estado === 'apuntada'
    return (
      <span className="s-lista-propuesto" title={entendido(x, producto.solo).porque ?? undefined}>
        {!apuntada && <Icono nombre="ia" />}{apuntada ? '' : 'Propuesto: '}{x.entendido.nombre}
      </span>
    )
  }
  const columnas: ColumnaLista<FilaDocumento>[] = [
    { id: 'fecha', titulo: 'Fecha', ordenable: true, ancho: '80px', celda: (x) => <span className="s-cifra">{diaMes(x.fecha ?? x.llego.slice(0, 10))}</span> },
    {
      id: 'proveedor', titulo: 'Proveedor', ordenable: true,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{nombre(x)}</span>{propuesto(x)}</span>,
    },
    { id: 'numero', titulo: 'Nº de factura', ordenable: true, celda: (x) => <span className="s-cifra">{x.numero ?? '—'}</span> },
    ...(ejeLocal ? [{ id: 'local', titulo: ejeLocal.nombre, celda: (x: FilaDocumento) => localDeFila(x, mapa.get(x.id)) ?? 'Común' }] : []),
    { id: 'base', titulo: 'Base', cifra: true, celda: (x) => euro(mapa.get(x.id)?.base) },
    { id: 'iva', titulo: 'IVA', cifra: true, celda: (x) => euro(mapa.get(x.id)?.iva) },
    { id: 'total', titulo: 'Total', cifra: true, ordenable: true, celda: (x) => <strong>{euro(x.total)}</strong> },
    { id: 'estado', titulo: 'Estado', celda: (x) => { const e = estadoDeFila(x, mapa.get(x.id)); return <Chip tono={e.tono}>{e.texto}</Chip> } },
  ]
  const tarjeta = (x: FilaDocumento) => {
    const e = estadoDeFila(x, mapa.get(x.id))
    const l = ejeLocal ? localDeFila(x, mapa.get(x.id)) ?? 'Común' : null
    return (
      <>
        <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{nombre(x)}</span><strong className="s-cifra">{euro(x.total)}</strong></span>
        <span className="s-tarjeta-apoyo">{[x.numero ?? 'sin número', diaMes(x.fecha ?? x.llego.slice(0, 10)), l].filter(Boolean).join(' · ')}</span>
        <span className="s-tarjeta-pie"><Chip tono={e.tono}>{e.texto}</Chip>{propuesto(x)}</span>
      </>
    )
  }
  const pie = (
    <>
      <span>{plural(t.n, nombrePestana === 'Todas' ? 'factura' : 'factura', 'facturas')}{f.pestana !== 'todas' ? ` ${nombrePestana.toLowerCase()}` : ''}{t.sinImporte ? ` (${plural(t.sinImporte, 'sin importe todavía', 'sin importe todavía')})` : ''}</span>
      <span className="s-lista-pie-totales">
        <span>Base <strong className="s-cifra">{eurosExactos(t.base)}</strong></span>
        <span>IVA <strong className="s-cifra">{eurosExactos(t.iva)}</strong></span>
        <span>Total <strong className="s-cifra">{eurosExactos(t.total)}</strong></span>
      </span>
    </>
  )
  const filaNoEsta = fila && d && !filas.some((x) => x.id === fila)
  const faltan = (d?.esperadas ?? []).filter((e) => !e.pedida)

  const mas: GrupoDeAcciones[] = [{
    titulo: 'Otras formas de traerlas',
    acciones: [
      { id: 'a-mano', etiqueta: 'Escribir una a mano', dato: 'Sin fichero: proveedor, número, fecha, base e IVA', a: `${rutaRecibidaEnAsientos()}?${CONSULTA_RECIBIDA_A_MANO}`, grupo: '' },
      ...(faltan.length > 0 ? [{ id: 'pedir', etiqueta: `Pedir las que faltan (${faltan.length})`, dato: 'Las que el mes pasado ya habían llegado', alPulsar: () => setPidiendo(true), aviso: true, grupo: '' }] : []),
      ...(d?.recibe_mercancia && !producto.solo ? [{ id: 'recepciones', etiqueta: 'Recepciones del local que esperan factura', a: rutaCompras(), grupo: '' }] : []),
    ],
  }]
  const exportar = () => {
    const filasCsv = [['Fecha', 'Proveedor', 'Nº de factura', 'Local', 'Base', 'IVA', 'Total', 'Estado'],
      ...filas.map((x) => {
        const e = mapa.get(x.id)
        return [x.fecha ?? '', nombre(x), x.numero ?? '', localDeFila(x, e) ?? '', e?.base ?? '', e?.iva ?? '', x.total ?? '', estadoDeFila(x, e).texto].map(String)
      })]
    const csv = filasCsv.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `facturas-recibidas-${f.mes || 'ultimos-12-meses'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const botonSubir = (
    <Boton variante="principal" icono="nuevo" onClick={() => ficheros.current?.click()} disabled={!!subiendo}>Subir factura</Boton>
  )
  return (
    <div className="s-pagina">
      <EncabezadoPagina
        titulo="Facturas recibidas"
        frase={fraseDeLaLista({ correo: !!d?.correo.activo, recibeMercancia: !!d?.recibe_mercancia, solo: producto.solo })}
        secundarios={!movil && <Boton icono="descargar" onClick={exportar} disabled={filas.length === 0}>Exportar</Boton>}
        masAcciones={mas}
        principal={botonSubir}
      />
      <input ref={ficheros} type="file" multiple accept={ACEPTA} className="s-oculto" aria-label="Elegir facturas para subir"
        onChange={(e) => void subir(e.target.files)} data-prueba="subir-ficheros" />
      <input ref={camara} type="file" accept="image/*" capture="environment" className="s-oculto" aria-label="Hacer una foto a una factura"
        onChange={(e) => void subir(e.target.files)} />

      <div role="status" aria-live="polite">
        {subiendo && <p className="s-aviso-lista">Subiendo y leyendo {subiendo.de === 1 ? 'la factura' : `${subiendo.i + 1} de ${subiendo.de}`}…</p>}
        {subidas && <ResultadoSubida subidas={subidas} />}
        {query.get('subir') !== null && !subidas && !subiendo && (
          <p className="s-aviso-lista">Elige el PDF o la foto de la factura con «Subir factura»{movil ? ', o hazle una foto' : ''}: la leo y la pongo aquí, en «Por revisar».</p>
        )}
      </div>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
      {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las facturas: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>}
      {extras.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{extras.error}. La base, el IVA y si están pagadas salen con «—». <button type="button" className="s-boton s-boton-enlace" onClick={extras.recargar}>Reintentar</button></p>}

      <PestanasEstado etiqueta="Estado de las facturas" pestanas={pestanas} actual={f.pestana} alCambiar={(id) => cambiar({ ver: id })}
        derecha={!movil && porRevisar > 0 && <button type="button" className="s-boton s-boton-enlace" onClick={revisarUnaAUna}>Revisarlas de una en una <Icono nombre="siguiente" /></button>} />

      <FiltrosLista etiqueta="Filtros de las facturas">
        <FiltroBuscar valor={f.q} alCambiar={(q) => cambiar({ q })} placeholder="Proveedor, número o importe" etiqueta="Buscar factura" />
        <FiltroSelector etiqueta="Fecha" valor={f.mes} alCambiar={(mes) => cambiar({ mes })}
          opciones={[{ valor: '', texto: 'Últimos 12 meses' }, ...meses(hoy).map((m) => ({ valor: m.valor, texto: m.nombre }))]} />
        <FiltroSelector etiqueta="Proveedor" valor={f.prov} alCambiar={(prov) => cambiar({ prov })}
          opciones={[{ valor: '', texto: 'Todos' }, ...proveedores.map(([id, n]) => ({ valor: id, texto: n }))]} />
        {ejeLocal && (
          <FiltroSelector etiqueta={ejeLocal.nombre} valor={f.local} alCambiar={(local) => cambiar({ local })}
            opciones={[{ valor: '', texto: 'Todos' }, { valor: 'comun', texto: 'Común' }, ...locales.map((l) => ({ valor: l, texto: l }))]} />
        )}
        {masFiltros
          ? <FiltroSelector etiqueta="Cómo llegó" valor={f.canal} alCambiar={(canal) => cambiar({ canal })}
              opciones={[{ valor: '', texto: 'De cualquier forma' }, ...canales.map((c) => ({ valor: c, texto: NOMBRE_CANAL[c] ?? c }))]} />
          : <button type="button" className="s-boton s-boton-enlace" onClick={() => setMasFiltros(true)}>Más filtros</button>}
      </FiltrosLista>

      {faltan.length > 0 && f.pestana !== 'pagadas' && (
        <p className="s-aviso-lista" data-tono="duda">
          {faltan.length === 1 ? 'Falta la factura de' : 'Faltan las facturas de'} {faltan.slice(0, 3).map((e) => (e.label ?? e.supplier_name).toLowerCase()).join(', ')}{faltan.length > 3 ? ` y ${faltan.length - 3} más` : ''}: el mes pasado ya {faltan.length === 1 ? 'había' : 'habían'} llegado.
          {' '}<button type="button" className="s-boton s-boton-enlace" onClick={() => setPidiendo(true)}>Pedírselas</button>
        </p>
      )}
      {filaNoEsta && (
        <p className="s-aviso-lista" role="status">La factura que mirabas ya no sale en «{nombrePestana}» con estos filtros{f.pestana === 'por-revisar' ? ': la validaste o cambió de estado' : ''}. La tienes en «Todas».</p>
      )}

      {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las facturas"><div className="s-lista-cargando" /></div>}
      {d && (
        <TablaLista<FilaDocumento>
          etiqueta={`Facturas recibidas · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(x) => x.id} nombre={(x) => `${nombre(x)}${x.numero ? ` ${x.numero}` : ''}`}
          alAbrir={abrir} filaActual={fila} movil={movil} tarjeta={tarjeta}
          orden={f.orden} alOrdenar={(c) => cambiar({ orden: escribirOrden({ columna: c, sentido: f.orden.columna === c && f.orden.sentido === 'desc' ? 'asc' : 'desc' }) })}
          vacio={f.pestana === 'por-revisar' && !f.q && !f.prov && !f.local && !f.canal
            ? <><strong>Todo al día.</strong> No queda ninguna factura por revisar{f.mes ? ' este mes' : ''}. <button type="button" className="s-boton s-boton-enlace" onClick={() => ficheros.current?.click()}>Subir factura</button></>
            : <>Ninguna factura con estos filtros. <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ q: null, prov: null, local: null, canal: null })}>Quitar los filtros</button></>}
          pie={pie}
        />
      )}

      {accountId && hosteleria && conCatcher.datos === true && <QuincenaCatcher accountId={accountId} companyId={activa.id} quien={userName} />}
      {hosteleria && conCatcher.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{conCatcher.error}</p>}

      <BotonPulgar>
        {porRevisar > 0 && <Boton onClick={revisarUnaAUna}>Revisar de una en una</Boton>}
        <Boton variante="principal" icono="subir" onClick={() => camara.current?.click()} disabled={!!subiendo}>Subir factura</Boton>
      </BotonPulgar>

      {pidiendo && d && (
        <Pedirselas companyId={activa.id} esperadas={faltan} quien={userName}
          alCerrar={() => setPidiendo(false)} alPedir={() => setVuelta((v) => v + 1)} />
      )}
    </div>
  )
}

function ResultadoSubida({ subidas }: { subidas: Subida[] }) {
  const bien = subidas.filter((s) => s.bien).length
  return (
    <div className="s-aviso-lista" data-tono={bien === subidas.length ? 'ok' : 'duda'}>
      <strong>{bien === subidas.length
        ? `${subidas.length === 1 ? 'Subida y leída' : `Subidas y leídas las ${subidas.length}`}: las tienes en «Por revisar».`
        : `${bien} de ${subidas.length} han entrado.`}</strong>
      <ul>{subidas.map((s, i) => <li key={i}>{s.texto}</li>)}</ul>
    </div>
  )
}
