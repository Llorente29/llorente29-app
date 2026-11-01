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
// S02 · PR 3: las quincenas de Catcher ya no salen al final: son liquidaciones
// y viven en Compras y gastos › Liquidaciones (cada cosa en un sitio).
//
// Regla 7: «Todas» trae todas, también las repetidas y las descartadas; un
// filtro ordena y etiqueta, nunca decide qué existe. Regla 8: subir dice qué
// ha entrado y qué no.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaCompras, rutaFichaProveedor, rutaRecibidaAMano, rutaRevisarFactura } from '@/config/navegacion'
import { leerApuntadasSolas, deshacerApuntadaSola } from '@/modules/conta/services/apuntaSoloService'
import { SIN_APUNTADAS, lineaDeArriba, motivoDeRevisar } from '@/modules/conta/lib/apuntaSolo'
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
import { leerParaValidar, validarEnBloque, type ResultadoBloque } from '@/modules/conta/documentos/paraValidarService'
import { BarraMarcadas, ConfirmarBloque, ResultadoDelBloque } from '@/modules/conta/documentos/ValidarEnBloque'
import { useEnvioDiez } from '@/modules/conta/services/envioDiezService'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Chip, Icono } from '@/modules/conta/diseno'
import { LoQueNoHePodido } from '@/modules/conta/ui/LoQueNoHePodido'
import { AsientosDeCompras } from '@/modules/conta/documentos/AsientosDeCompras'
import { DONDE } from '@/modules/conta/lib/noPropuesto'
import {
  FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, escribirOrden, recordarLista, type ColumnaLista,
} from '@/modules/conta/diseno/plantillas'
import {
  LISTA_RECIBIDAS, NOMBRE_CANAL, colaDeFacturas, estadoDeFila, filasDeLaLista, filtrarSinPestana, filtrosDe, fraseDeLaLista, localDeFila, opcionesOtras, pestanasConNumero, totales,
  ventanaDe,
} from '@/modules/conta/documentos/recibidas'
import { FichaSoporte } from '@/modules/conta/documentos/FichaSoporte'
import { AclararDocumento } from '@/modules/conta/documentos/AclararDocumento'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

export default function DocumentosPage() {
  const { accountId, cargando, userName, userId } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const solo = useProductoSolo()
  const producto = productoDeDocumentos(solo, MARCA.nombre)
  const { local: ejeLocal } = useAnalitica()
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
  // S01o · Lo que Sumied apuntó solo (con su porqué) y por qué se quedaron las demás. Si no se puede leer, la lista sale igual y lo dice.
  const solas = useLeer(activa ? () => leerApuntadasSolas(activa.id) : null, `${activa?.id}:${vuelta}:apuntadas-solas`)
  const sol = solas.datos ?? SIN_APUNTADAS
  const mapa = useMemo(() => {
    const m = new Map(extras.datos ?? (new Map() as Map<string, ExtraFactura>))
    const porque = new Map(sol.filas.map((x) => [x.id, x.porque]))
    const vacia: ExtraFactura = { base: null, iva: null, pagada: null, comoPagada: null, localId: null, local: null }
    // También las que no tienen fila en extras (aún sin leer, o si falló su lectura): su porqué o su motivo no se pierden.
    for (const id of new Set([...m.keys(), ...porque.keys(), ...Object.keys(sol.motivos)])) {
      m.set(id, { ...(m.get(id) ?? vacia), sola: porque.get(id) ?? null, motivo: sol.motivos[id] ?? null })
    }
    return m
  }, [extras.datos, sol])
  const [deshaciendo, setDeshaciendo] = useState<string | null>(null)
  // D06 · Validar en bloque (tablero 2b): en «Por revisar», el veredicto de cada fila (el de su ficha), y las que se marcan.
  const enBloque = f.pestana === 'por-revisar'
  const listas = useLeer(enBloque && accountId && activa && datos.datos && extras.datos
    ? () => leerParaValidar(accountId, activa.id, datos.datos!.filas, extras.datos!, desde, hasta) : null,
  // La clave cambia cuando llegan las filas y sus importes: useLeer solo vuelve a leer si cambia la clave.
  `${activa?.id}:${desde}:${hasta}:${vuelta}:${ids.join(',')}:${extras.datos ? 'con-importes' : 'sin-importes'}:validar`)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [validando, setValidando] = useState<{ hechas: number; de: number } | null>(null)
  const [resultado, setResultado] = useState<ResultadoBloque | null>(null)
  const envioDiez = useEnvioDiez(accountId, activa?.id)

  const ficheros = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState<{ i: number; de: number } | null>(null)
  const [subidas, setSubidas] = useState<Subida[] | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [masFiltros, setMasFiltros] = useState(!!f.canal)
  // S01g · La fila de «Por aclarar» que se está aclarando (sus acciones), y lo que dijo la última.
  const [aclarando, setAclarando] = useState<FilaDocumento | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

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
  const pv = listas.datos
  const deLaLista = new Set(filas.map((x) => x.id))
  const marcadasVivas = [...marcadas].filter((id) => deLaLista.has(id))
  const marcadasListas = marcadasVivas.filter((id) => pv?.get(id)?.lista)
  const totalMarcadas = marcadasVivas.reduce((t, id) => t + (filas.find((x) => x.id === id)?.total ?? 0), 0)
  const listasEnLaLista = filas.filter((x) => pv?.get(x.id)?.lista).map((x) => x.id)
  const marcarListas = () => setMarcadas(new Set(listasEnLaLista))
  async function validarMarcadas() {
    if (!accountId) return
    setConfirmando(false); setResultado(null)
    const nombres = new Map(filas.map((x) => [x.id, `${nombre(x)}${x.numero ? ` ${x.numero}` : ''}`]))
    setValidando({ hechas: 0, de: marcadasListas.length })
    try {
      const r = await validarEnBloque(accountId, marcadasListas, nombres, userName, userId, (hechas) => setValidando({ hechas, de: marcadasListas.length }))
      setResultado(r)
      setMarcadas(new Set(r.mal.map((m) => m.id)))
    } finally {
      setValidando(null)
      refrescarCuentasMenu()
      setVuelta((v) => v + 1)
    }
  }

  /** Abrir una fila: se apunta la fila en la lista (para volver a ella) y se va a su ficha con la lista detrás. */
  const abrir = (x: FilaDocumento) => {
    // S01g · El soporte de una liquidación abre su ficha; lo que está por aclarar, sus acciones (regla 8).
    if (x.estado === 'soporte') { navegar(`${pathname}${conCambio(search, { recepcion: x.id, fila: x.id })}`); return }
    if (x.tipo !== 'factura' && x.estado === 'por_aclarar') { setAclarando(x); return }
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
  async function deshacer(x: FilaDocumento) {
    setDeshaciendo(x.id); setFallo(null); setHecho(null)
    try {
      setHecho(await deshacerApuntadaSola(x.id, userName ?? null))
      setVuelta((v) => v + 1); refrescarCuentasMenu()
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setDeshaciendo(null) }
  }
  const arriba = lineaDeArriba(sol)

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
  // N5 · La regla de anchos: sin sitio, se ocultan primero el local, la base y el IVA, luego el número; nunca la fecha, el proveedor ni el total.
  const columnas: ColumnaLista<FilaDocumento>[] = [
    { id: 'fecha', titulo: 'Fecha', ordenable: true, ancho: '80px', prioridad: 1, minimo: 80, celda: (x) => <span className="s-cifra">{diaMes(x.fecha ?? x.llego.slice(0, 10))}</span> },
    {
      id: 'proveedor', titulo: 'Proveedor', ordenable: true, prioridad: 1, minimo: 200,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{nombre(x)}</span>{propuesto(x)}</span>,
    },
    { id: 'numero', titulo: 'Nº de factura', ordenable: true, prioridad: 3, minimo: 130, celda: (x) => <span className="s-cifra">{x.numero ?? '—'}</span> },
    ...(ejeLocal ? [{ id: 'local', titulo: ejeLocal.nombre, prioridad: 5, minimo: 120, celda: (x: FilaDocumento) => localDeFila(x, mapa.get(x.id)) ?? 'Común' }] : []),
    { id: 'base', titulo: 'Base', cifra: true, prioridad: 4, minimo: 100, celda: (x) => euro(mapa.get(x.id)?.base) },
    { id: 'iva', titulo: 'IVA', cifra: true, prioridad: 4, minimo: 90, celda: (x) => euro(mapa.get(x.id)?.iva) },
    { id: 'total', titulo: 'Total', cifra: true, ordenable: true, prioridad: 1, minimo: 110, celda: (x) => <strong>{euro(x.total)}</strong> },
    ...(f.pestana === 'solas' ? [{
      id: 'porque', titulo: 'Por qué se apuntó sola', prioridad: 2, minimo: 260,
      celda: (x: FilaDocumento) => <span className="s-lista-texto-doble"><span>{mapa.get(x.id)?.sola}</span>
        <button type="button" className="s-boton s-boton-enlace" disabled={deshaciendo === x.id} data-prueba="deshacer-sola"
          onClick={(ev) => { ev.stopPropagation(); void deshacer(x) }}>{deshaciendo === x.id ? 'Deshaciendo…' : 'Deshacer'}</button></span>,
    }] : []),
    ...(enBloque && filas.some((x) => mapa.get(x.id)?.motivo) ? [{
      id: 'motivo', titulo: 'Por qué la miras tú', prioridad: 3, minimo: 220, celda: (x: FilaDocumento) => <MotivoRevisar x={x} motivo={mapa.get(x.id)?.motivo} />,
    }] : []),
    enBloque
      ? { id: 'lista', titulo: '¿Lista para validar?', prioridad: 2, minimo: 170, celda: (x) => <ListaParaValidar p={pv?.get(x.id)} cargando={!pv && !listas.error} /> }
      : { id: 'estado', titulo: 'Estado', prioridad: 2, minimo: 150, celda: (x) => { const e = estadoDeFila(x, mapa.get(x.id)); return <Chip tono={e.tono}>{e.texto}</Chip> } },
  ]
  const tarjeta = (x: FilaDocumento) => {
    const e = estadoDeFila(x, mapa.get(x.id))
    const l = ejeLocal ? localDeFila(x, mapa.get(x.id)) ?? 'Común' : null
    return (
      <>
        <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{nombre(x)}</span><strong className="s-cifra">{euro(x.total)}</strong></span>
        <span className="s-tarjeta-apoyo">{[x.numero ?? 'sin número', diaMes(x.fecha ?? x.llego.slice(0, 10)), l].filter(Boolean).join(' · ')}</span>
        <span className="s-tarjeta-pie">{enBloque ? <ListaParaValidar p={pv?.get(x.id)} cargando={!pv && !listas.error} /> : <Chip tono={e.tono}>{e.texto}</Chip>}{propuesto(x)}</span>
        {enBloque && mapa.get(x.id)?.motivo && <span className="s-tarjeta-apoyo"><MotivoRevisar x={x} motivo={mapa.get(x.id)?.motivo} /></span>}
        {f.pestana === 'solas' && (
          <span className="s-tarjeta-apoyo">{mapa.get(x.id)?.sola}{' '}
            <button type="button" className="s-boton s-boton-enlace" disabled={deshaciendo === x.id} data-prueba="deshacer-sola"
              onClick={(ev) => { ev.stopPropagation(); void deshacer(x) }}>{deshaciendo === x.id ? 'Deshaciendo…' : 'Deshacer'}</button></span>
        )}
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
  const filaNoEsta = fila && d && !filas.some((x) => x.id === fila) && !query.get('recepcion')
  const otras = f.pestana === 'otras' ? opcionesOtras(base, mapa) : []
  const faltan = (d?.esperadas ?? []).filter((e) => !e.pedida)

  const mas: GrupoDeAcciones[] = [{
    titulo: 'Otras formas de traerlas',
    acciones: [
      { id: 'a-mano', etiqueta: 'Escribir una a mano', dato: 'Sin fichero: proveedor, número, fecha, base e IVA', a: rutaRecibidaAMano(), grupo: '' },
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

  // S01g · La ficha de una recepción de soporte (?recepcion=), con la lista detrás para volver.
  const recepcion = query.get('recepcion')
  const filaSoporte = recepcion ? todasLasFilas.find((x) => x.id === recepcion && x.estado === 'soporte') ?? null : null
  if (recepcion && filaSoporte && accountId) {
    return <FichaSoporte accountId={accountId} fila={filaSoporte} alVolver={`${pathname}${conCambio(search, { recepcion: null })}`}
      alCambiar={(m) => { setHecho(m); setVuelta((v) => v + 1); refrescarCuentasMenu(); navegar(`${pathname}${conCambio(search, { recepcion: null, ver: 'por-aclarar' })}`) }} />
  }

  const botonSubir = (
    <Boton variante="principal" icono="nuevo" onClick={() => ficheros.current?.click()} disabled={!!subiendo}>Subir factura</Boton>
  )
  return (
    <div className="s-pagina cxso-documentos">
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
      {hecho && <p className="s-aviso-lista" data-tono="seguro" role="status">{hecho}</p>}
      {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las facturas: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>}
      {extras.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{extras.error}. La base, el IVA y si están pagadas salen con «—». <button type="button" className="s-boton s-boton-enlace" onClick={extras.recargar}>Reintentar</button></p>}

      {arriba && f.pestana !== 'solas' && (
        <p className="s-aviso-lista" data-tono="seguro" data-prueba="apuntadas-solas-arriba">{arriba} · <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ ver: 'solas' })}>Ver</button></p>
      )}
      {f.pestana === 'solas' && (
        <p className="s-aviso-lista">Lo que Sumied tenía seguro al 100 %: su asiento está validado por «Folvy (apunta solo)». Si alguna no es así, deshazla: su asiento se anula con su contraasiento y vuelve a «Por revisar».</p>
      )}
      {solas.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No he podido leer las que apuntó Sumied sola: {solas.error} <button type="button" className="s-boton s-boton-enlace" onClick={solas.recargar}>Reintentar</button></p>}
      <AsientosDeCompras />
      <LoQueNoHePodido donde={DONDE.recibidas} />

      <PestanasEstado etiqueta="Estado de las facturas" pestanas={pestanas} actual={f.pestana} alCambiar={(id) => cambiar({ ver: id })} sinNumeros={!d}
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

      {otras.length > 1 && (
        <div className="cxso-que" role="group" aria-label="Qué es">
          <span>Qué es:</span>
          <button type="button" className="cxso-que-chip" aria-pressed={!f.que} onClick={() => cambiar({ que: null })}>Todas · {otras.reduce((t, o) => t + o.n, 0)}</button>
          {otras.map((o) => (
            <button key={o.etiqueta} type="button" className="cxso-que-chip" aria-pressed={f.que === o.etiqueta} onClick={() => cambiar({ que: o.etiqueta })}>{o.etiqueta} · {o.n}</button>
          ))}
        </div>
      )}

      {faltan.length > 0 && f.pestana !== 'pagadas' && (
        <p className="s-aviso-lista" data-tono="duda">
          {faltan.length === 1 ? 'Falta la factura de' : 'Faltan las facturas de'} {faltan.slice(0, 3).map((e) => (e.label ?? e.supplier_name).toLowerCase()).join(', ')}{faltan.length > 3 ? ` y ${faltan.length - 3} más` : ''}: el mes pasado ya {faltan.length === 1 ? 'había' : 'habían'} llegado.
          {' '}<button type="button" className="s-boton s-boton-enlace" onClick={() => setPidiendo(true)}>Pedírselas</button>
        </p>
      )}
      {filaNoEsta && (
        <p className="s-aviso-lista" role="status">La factura que mirabas ya no sale en «{nombrePestana}» con estos filtros{f.pestana === 'por-revisar' ? ': la validaste o cambió de estado' : ''}. La tienes en «Todas».</p>
      )}

      {enBloque && d && filas.length > 0 && (
        <div className="s-bloque-acciones">
          {listas.error && <span className="s-aviso-lista" data-tono="falta" role="alert">No he podido comprobar cuáles están listas: {listas.error} <button type="button" className="s-boton s-boton-enlace" onClick={listas.recargar}>Reintentar</button></span>}
          {pv && <Boton icono="ok" onClick={marcarListas} disabled={listasEnLaLista.length === 0 || !!validando}>Marcar las que están listas ({listasEnLaLista.length})</Boton>}
        </div>
      )}
      {resultado && <ResultadoDelBloque r={resultado} />}
      {enBloque && marcadasVivas.length > 0 && (
        <BarraMarcadas marcadas={marcadasVivas.length} total={totalMarcadas} listas={marcadasListas.length} validando={validando}
          alQuitar={() => setMarcadas(new Set())} alValidar={() => setConfirmando(true)} />
      )}
      {confirmando && (
        <ConfirmarBloque enviaADiez={envioDiez.envio?.alMomento === true} noListas={marcadasVivas.length - marcadasListas.length}
          facturas={marcadasListas.map((id) => { const x = filas.find((y) => y.id === id)!; return { cuenta: pv?.get(id)?.cuenta ?? null, base: mapa.get(id)?.base ?? null, total: x.total, local: localDeFila(x, mapa.get(id)) } })}
          alCancelar={() => setConfirmando(false)} alValidar={() => void validarMarcadas()} />
      )}
      {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando las facturas"><div className="s-lista-cargando" /></div>}
      {d && (
        <TablaLista<FilaDocumento>
          etiqueta={`Facturas recibidas · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(x) => x.id} nombre={(x) => `${nombre(x)}${x.numero ? ` ${x.numero}` : ''}`}
          alAbrir={abrir} filaActual={fila} movil={movil} tarjeta={tarjeta}
          seleccion={enBloque ? {
            marcadas: new Set(marcadasVivas),
            alMarcar: (id, si) => setMarcadas((m) => { const n = new Set(m); if (si) n.add(id); else n.delete(id); return n }),
            alMarcarTodas: (si) => setMarcadas(si ? new Set(filas.map((x) => x.id)) : new Set()),
          } : undefined}
          orden={f.orden} alOrdenar={(c) => cambiar({ orden: escribirOrden({ columna: c, sentido: f.orden.columna === c && f.orden.sentido === 'desc' ? 'asc' : 'desc' }) })}
          vacio={f.pestana === 'por-revisar' && !f.q && !f.prov && !f.local && !f.canal
            ? <><strong>Todo al día.</strong> No queda ninguna factura por revisar{f.mes ? ' este mes' : ''}. <button type="button" className="s-boton s-boton-enlace" onClick={() => ficheros.current?.click()}>Subir factura</button></>
            : <>Ninguna factura con estos filtros. <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ q: null, prov: null, local: null, canal: null, que: null })}>Quitar los filtros</button></>}
          pie={pie}
        />
      )}

      <BotonPulgar>
        {porRevisar > 0 && <Boton onClick={revisarUnaAUna}>Revisar de una en una</Boton>}
        <Boton variante="principal" icono="subir" onClick={() => camara.current?.click()} disabled={!!subiendo}>Subir factura</Boton>
      </BotonPulgar>

      {aclarando && accountId && (
        <AclararDocumento fila={aclarando} accountId={accountId} quien={userName ?? null} alCerrar={() => setAclarando(null)}
          alSubirFactura={() => { setAclarando(null); ficheros.current?.click() }}
          alHecho={(m) => { setAclarando(null); setHecho(m); setVuelta((v) => v + 1); refrescarCuentasMenu() }} />
      )}
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

/** D06 · «¿Lista para validar?» de una fila: «Lista», o «No está lista.» con su motivo (el de su ficha). */
function ListaParaValidar({ p, cargando }: { p: { lista: boolean; motivo: string; comprobando?: boolean } | undefined; cargando: boolean }) {
  // En un chip, como el estado de las demás pestañas: cada fila dice qué le pasa.
  // D07b · Mientras se prepara su asiento, «Comprobando…» en gris: aún no se sabe si está lista.
  if (!p || p.comprobando) return <span className="s-apoyo"><Chip>{cargando || p?.comprobando ? 'Comprobando…' : 'Sin comprobar'}</Chip></span>
  if (p.lista) return <span className="s-lista-para-validar" data-lista=""><Chip tono="seguro">✓ Lista</Chip></span>
  return <span className="s-lista-para-validar" data-tono="duda"><Chip tono="duda">No está lista.</Chip> {p.motivo}</span>
}

/** S01o · Por qué la miras tú: la frase de la base; si lo que falta es la cuenta de la ficha, el enlace para ponerla. */
function MotivoRevisar({ x, motivo }: { x: FilaDocumento; motivo: string | null | undefined }) {
  const m = motivoDeRevisar(motivo)
  if (!m) return null
  return (
    <span className="s-apoyo" data-prueba="motivo-revisar">{m.frase}
      {m.ponerEnFicha && x.proveedor.id && <>{' · '}<Link to={rutaFichaProveedor(x.proveedor.id)} onClick={(ev) => ev.stopPropagation()}>Ponerla</Link></>}
    </span>
  )
}
