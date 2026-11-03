// src/modules/conta/ventas/LiquidacionesVentasPage.tsx
//
// S01q · PR C · Ventas › Liquidaciones, un mes en una pantalla, fiel a las
// maquetas aprobadas por Julio (S01q·1, 02/11; scratchpad s01q_maquetas.html):
//   · arriba, el mes con ‹ ›, «Exportar a Excel» y «Ver el recorrido»;
//   · el resumen: una frase («Octubre: 30 de 42 completas · 6 aún no toca ·
//     6 te necesitan») y la barra en cuatro colores con su leyenda;
//   · «¿Cómo funciona?», plegado: las cuatro piezas y los cuatro estados;
//   · los filtros: plataforma, local (también «Tienda sin local») y «Solo lo
//     que te necesita»;
//   · una caja por plataforma y, dentro, una por tienda (su nombre en la
//     plataforma, su marca y su local), con sus periodos: las cuatro piezas,
//     lo que te pagan, el estado y UN botón (Pídela · Súbela · Ver por qué…);
//   · la fila se abre ahí mismo: por qué no cuadra, la liquidación desglosada,
//     lo vendido, su factura de comisión y el cobro;
//   · la tienda sin local pregunta «¿De qué local es esta tienda?» y vale para
//     todas sus liquidaciones;
//   · las marcas cedidas, aparte: «Marcas cedidas · se cuadran con <socio>».
// Lo decide la base (conta_liquidaciones_mes); lo que se enseña,
// lib/liquidacionesMes.ts. «Lo que no he podido proponer» ya no sale aquí (S01q·1).
// Regla 7: los filtros eligen lo que se ve; la frase y la barra cuentan siempre
// el mes entero, y si un filtro deja la lista vacía, lo dice con su número.
// Regla 8: cada botón dice lo que ha hecho, con contenido.

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  rutaFichaTercero, rutaLiquidacion, rutaLiquidacionFicha, rutaLiquidacionPlataforma, rutaRevisarFactura,
} from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Dialogo } from '@/modules/conta/diseno'
import { claveGrupo } from '@/modules/conta/lib/liquidacionesPlataforma'
import {
  NOMBRE_ACCION, NOMBRE_ESTADO, SIN_LOCAL, agrupar, barra, cuenta, filasExcel, fraseResumen, importe, mesInicial, moverMes, nombreMes, opciones,
  periodoCorto, piezas, type CedidaMes, type EstadoMes, type FilaMes, type Filtros, type GrupoTienda, type MesLiquidaciones,
} from '@/modules/conta/lib/liquidacionesMes'
import {
  apuntarLiquidacion, darDeAltaIntermediario, darLocalATienda, decidirCambioTienda, leerFicherosLiquidacion, leerIntermediarios, leerLiquidacionesMes,
  leerLocales, reclamacionLlegada, registrarLeidas, resolverDiferencia, type Intermediario,
} from '@/modules/conta/services/liquidacionesMotorService'
import { leerLiquidaciones } from '@/modules/conta/services/liquidacionesService'
import { leerCorreoFacturas } from '@/modules/conta/services/comprasService'
import { subirFacturas } from '@/modules/conta/services/documentosService'
import { exportarTabla } from '@/modules/conta/ui/tabla/exportar'
import { leerNoPropuestoPorOrigen, type SinPropuesta } from '@/modules/conta/services/noPropuestoService'
import { Socios } from '@/modules/conta/ventas/SociosDeMarca'

const ACEPTA = '.csv,.xlsx,.xls,.pdf,text/csv,application/pdf'
const ACEPTA_FACTURA = '.pdf,image/*,application/pdf'
const euros = (x: number | null | undefined) => (x === null || x === undefined ? '—' : eurosExactos(x))
const lista = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
/** El tono del chip y de la barra de cada estado. */
const TONO: Record<EstadoMes, 'ok' | 'gr' | 'am' | 'rd'> = { completa: 'ok', aun_no_toca: 'gr', te_necesita: 'am', no_cuadra: 'rd' }
const LEYENDA: Record<EstadoMes, string> = { completa: 'Completas', aun_no_toca: 'Aún no toca', te_necesita: 'Te necesitan', no_cuadra: 'No cuadran' }
const pideAlgo = (f: FilaMes) => f.estado === 'te_necesita' || f.estado === 'no_cuadra'

type Aviso = { texto: ReactNode; tono?: 'falta' | 'duda' }

export default function LiquidacionesVentasPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const hosteleria = useHosteleria()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const quien = userName ?? null
  const ver = query.get('ver') === 'socios' && hosteleria ? 'socios' : 'mes'
  const qMes = query.get('mes') ?? ''
  const mesHoy = `${hoy.slice(0, 7)}-01`
  const mes = /^\d{4}-\d{2}$/.test(qMes) && `${qMes}-01` <= mesHoy ? `${qMes}-01` : mesInicial(hoy)
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [filtros, setFiltros] = useState<Filtros>({ plataforma: null, local: null, soloTeNecesita: false })
  const [abierta, setAbierta] = useState<string | null>(null)
  const [pidiendo, setPidiendo] = useState<FilaMes | null>(null)
  const [cambiando, setCambiando] = useState<{ fila: FilaMes; cambioId: string; texto: string } | null>(null)
  const [aMano, setAMano] = useState(false)
  const elegir = useRef<HTMLInputElement>(null)
  const elegirFactura = useRef<HTMLInputElement>(null)

  const clave = `${accountId}:${activa?.id}:${hosteleria}:${vuelta}`
  const datos = useLeer(accountId && activa && ver === 'mes' ? () => leerLiquidacionesMes(activa.id, mes) : null, `${clave}:mes:${mes}`)
  const quienes = useLeer(accountId ? () => leerIntermediarios(accountId) : null, `${clave}:quienes`)
  const locales = useLeer(accountId && hosteleria ? () => leerLocales(accountId) : null, `${accountId}:locales`)
  const sinPropuesta = useLeer(accountId && activa && ver === 'mes' ? () => leerNoPropuestoPorOrigen(accountId, activa.id) : null, `${clave}:sin-propuesta`)
  const socios = useLeer(accountId && activa && hosteleria && ver === 'socios' ? () => leerLiquidaciones(accountId, activa.id, hoy) : null, `${clave}:socios`)

  const recargar = () => setVuelta((v) => v + 1)
  const conAviso = async (hacer: () => Promise<ReactNode>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ texto: await hacer() }); recargar() } catch (e) { setAviso({ texto: e instanceof Error ? e.message : String(e), tono: 'falta' }) } finally { setOcupado(false) }
  }
  const irAMes = (m: string) => { setAbierta(null); setQuery(new URLSearchParams({ mes: m.slice(0, 7) }), { replace: false }) }

  const frase = hosteleria
    ? 'Lo que te pagan las plataformas, tienda a tienda y periodo a periodo.'
    : 'Lo que te pagan quienes cobran por ti (el datáfono, Amazon, Stripe, PayPal…), periodo a periodo.'
  const mas: GrupoDeAcciones[] = activa ? [{
    titulo: 'Liquidaciones',
    acciones: [
      { id: 'subir', etiqueta: 'Subir una liquidación', dato: 'El informe de Uber, el Excel y el PDF de Glovo', alPulsar: () => elegir.current?.click(), grupo: '' },
      { id: 'a-mano', etiqueta: 'Apuntar a mano', dato: 'El periodo, lo vendido, la comisión y lo cobrado', alPulsar: () => setAMano(true), grupo: '' },
      ...(hosteleria ? [{ id: 'socios', etiqueta: 'Socios de marca', dato: 'Lo que liquidas cada mes con el socio de las marcas cedidas', alPulsar: () => setQuery(new URLSearchParams({ ver: 'socios' })), grupo: '' }] : []),
    ],
  }] : []
  const encabezado = (
    <EncabezadoPagina titulo={ver === 'socios' ? 'Liquidaciones de los socios de marca' : 'Liquidaciones'}
      frase={ver === 'socios' ? 'Lo que liquidas cada mes con el socio de las marcas cedidas, local por local.' : frase} masAcciones={mas} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus liquidaciones.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus liquidaciones.</p></div>
  if (ver === 'socios') {
    return (
      <div className="s-pagina">
        {encabezado}
        <p className="s-apoyo"><button type="button" className="s-boton s-boton-enlace" onClick={() => setQuery(new URLSearchParams())}>‹ Volver a Liquidaciones</button></p>
        <Socios datos={socios.datos?.filas ?? null} error={socios.error} recargar={socios.recargar} movil={movil} navegar={navegar} />
      </div>
    )
  }

  const m = datos.datos ?? null
  const intermediarios = quienes.datos ?? []
  const partyDe = (f: FilaMes) => intermediarios.find((i) => i.id === f.motor.intermediarioId)?.partyId ?? null
  const grupos = m ? agrupar(m.filas, filtros) : null
  const vistas = grupos ? grupos.reduce((t, g) => t + g.filas.length, 0) : 0
  // El recorrido: lo que te necesita, en el orden de la pantalla.
  const recorrido = (grupos ?? []).flatMap((g) => g.filas).filter(pideAlgo)
  const siguiente = (clave: string | null) => {
    const i = clave ? recorrido.findIndex((f) => f.clave === clave) : -1
    return recorrido[i + 1] ?? null
  }
  const abrir = (f: FilaMes | null) => {
    setAbierta(f?.clave ?? null)
    if (f) setTimeout(() => document.getElementById(`fila-${f.clave}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  // Los avisos de tienda cambiada, uno por cambio.
  const cambios = new Map<string, { fila: FilaMes; texto: string }>()
  for (const f of m?.filas ?? []) for (const a of f.motor.avisos) if (a.tipo === 'tienda_cambiada' && a.cambioId && !cambios.has(a.cambioId)) cambios.set(a.cambioId, { fila: f, texto: a.texto })

  const subir = async (fs: FileList | null) => {
    const ficheros = Array.from(fs ?? [])
    if (elegir.current) elegir.current.value = ''
    if (!ficheros.length) return
    await conAviso(async () => {
      const { datos: leidas, noReconocidos } = await leerFicherosLiquidacion(ficheros)
      if (!leidas.length) {
        throw new Error(`No reconozco ${ficheros.length === 1 ? 'este fichero' : 'estos ficheros'} (${lista(noReconocidos)}). Leo el informe «Detalles del pago» de Uber (CSV) y el Excel y el PDF de Glovo; Just Eat llega solo por correo. Lo demás, con «Apuntar a mano».`)
      }
      const hechas = await registrarLeidas(activa.id, leidas, quien)
      const nuevas = hechas.filter((h) => !h.yaEstaba).length
      return (
        <>
          <strong>{nuevas === hechas.length ? `${nuevas === 1 ? 'Registrada 1 liquidación' : `Registradas ${nuevas} liquidaciones`}.` : `${nuevas} nuevas de ${hechas.length}; las demás ya estaban.`}</strong>
          {noReconocidos.length > 0 && <> No reconozco {lista(noReconocidos)}: apúntala a mano.</>}
          <ul>{hechas.map((h) => <li key={h.liquidacionId}>{h.tienda ? `${h.tienda}: ` : ''}{h.texto}</li>)}</ul>
        </>
      )
    })
  }
  const subirFactura = async (fs: FileList | null) => {
    const ficheros = Array.from(fs ?? [])
    if (elegirFactura.current) elegirFactura.current.value = ''
    if (!ficheros.length || !accountId) return
    await conAviso(async () => {
      const hechas = await subirFacturas(accountId, activa.id, ficheros, quien)
      const bien = hechas.filter((h) => h.bien).length
      return (
        <>
          <strong>{bien === hechas.length ? `${bien === 1 ? 'Subida la factura' : `Subidas ${bien} facturas`}: cuando sea la de comisión de su liquidación, se engancha sola.` : `${bien} de ${hechas.length} han entrado.`}</strong>
          <ul>{hechas.map((h) => <li key={h.archivo}>{h.texto}</li>)}</ul>
        </>
      )
    })
  }
  const alBoton = (f: FilaMes) => {
    if (f.accion === 'pidela') setPidiendo(f)
    else if (f.accion === 'subela') elegirFactura.current?.click()
    else if (f.accion === 'elige_marca') {
      const p = partyDe(f)
      if (p) navegar(rutaFichaTercero(p, 'liquidaciones'))
      else setAbierta(abierta === f.clave ? null : f.clave)
    } else setAbierta(abierta === f.clave ? null : f.clave)
  }
  const exportar = (x: MesLiquidaciones) => {
    const [cab, ...filas] = filasExcel(x)
    const fichero = exportarTabla('xlsx', {
      nombre: `Liquidaciones ${nombreMes(x.mes)}`, titulo: `Liquidaciones · ${nombreMes(x.mes)}`, subtitulo: fraseResumen(x.mes, x.resumen),
      columnas: cab.map((t) => ({ titulo: String(t), cifra: t === 'Lo que te pagan (€)' })), filas,
    })
    setAviso(fichero ? { texto: <>Bajado <strong>{fichero}</strong>: {filas.length} {filas.length === 1 ? 'fila' : 'filas'}, todas las del mes (los filtros no quitan ninguna).</> }
      : { texto: `${nombreMes(x.mes)} no tiene ningún periodo: no hay nada que bajar.`, tono: 'duda' })
  }
  const op = m ? opciones(m.filas) : null

  return (
    <div className="s-pagina cxlm" data-movil={movil || undefined}>
      {encabezado}
      <input ref={elegir} type="file" multiple accept={ACEPTA} className="s-oculto" aria-label="Elegir la liquidación" onChange={(e) => void subir(e.target.files)} />
      <input ref={elegirFactura} type="file" multiple accept={ACEPTA_FACTURA} className="s-oculto" aria-label="Elegir la factura de comisión" onChange={(e) => void subirFactura(e.target.files)} />

      <div className="cxlm-cab">
        <div className="cxlm-mes" data-prueba="mes-liquidaciones">
          <button type="button" className="cxlm-ico" aria-label="Mes anterior" onClick={() => irAMes(moverMes(mes, -1))}>‹</button>
          <strong>{nombreMes(mes)}</strong>
          <button type="button" className="cxlm-ico" aria-label="Mes siguiente" disabled={mes >= mesHoy} onClick={() => irAMes(moverMes(mes, 1))}>›</button>
        </div>
        <span className="cxlm-hueco" />
        <Boton variante="secundario" disabled={!m} onClick={() => m && exportar(m)}>Exportar a Excel</Boton>
        <Boton variante="secundario" disabled={!m}
          onClick={() => { const p = siguiente(null); if (p) abrir(p); else setAviso({ texto: m && m.resumen.total > 0 ? 'No hay nada que te necesite este mes: no hay recorrido.' : 'Este mes aún no tiene ningún periodo.' }) }}>
          Ver el recorrido
        </Boton>
      </div>

      {aviso && <div className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono ? 'alert' : 'status'} data-prueba="liquidaciones-aviso">{aviso.texto}</div>}
      {(datos.error || quienes.error || sinPropuesta.error) && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer tus liquidaciones: {datos.error ?? quienes.error ?? sinPropuesta.error} <button type="button" className="s-boton s-boton-enlace" onClick={recargar}>Reintentar</button></p>
      )}

      <Resumen m={m} mes={mes} />
      <Ayuda />

      {[...cambios.entries()].map(([id, c]) => (
        <TiendaCambiada key={id} fila={c.fila} texto={c.texto} ocupado={ocupado}
          alConfirmar={() => void conAviso(async () => `${await decidirCambioTienda(id, true, { desde: c.fila.motor.desde }, quien)} Lo vendido antes se queda con su marca y su local.`)}
          alCambiar={() => setCambiando({ fila: c.fila, cambioId: id, texto: c.texto })} />
      ))}

      {op && m && m.filas.length > 0 && (
        <div className="cxlm-filtros" data-prueba="filtros-liquidaciones">
          <select className="s-control" aria-label="Plataforma" value={filtros.plataforma ?? ''} onChange={(e) => setFiltros({ ...filtros, plataforma: e.target.value || null })}>
            <option value="">Todas las plataformas</option>
            {op.plataformas.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {hosteleria && (
            <select className="s-control" aria-label="Local" value={filtros.local ?? ''} onChange={(e) => setFiltros({ ...filtros, local: e.target.value || null })}>
              <option value="">Todos los locales</option>
              {op.locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              {op.haySinLocal && <option value={SIN_LOCAL}>Tienda sin local</option>}
            </select>
          )}
          <label className="cxlm-solo"><input type="checkbox" checked={filtros.soloTeNecesita} onChange={(e) => setFiltros({ ...filtros, soloTeNecesita: e.target.checked })} /> Solo lo que te necesita</label>
        </div>
      )}

      {!m && !datos.error && <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo las liquidaciones" />}
      {m && m.filas.length === 0 && m.cedidas.length === 0 && (
        <p className="cxlm-vacio">{nombreMes(mes)} aún no tiene ningún periodo. Las liquidaciones llegan solas por correo, o súbelas con «Subir una liquidación» (en ⋯).</p>
      )}
      {m && m.filas.length > 0 && vistas === 0 && (
        <p className="cxlm-vacio" data-prueba="filtro-vacio">
          Con estos filtros no queda ninguna de las {m.filas.length} del mes. <button type="button" className="s-boton s-boton-enlace" onClick={() => setFiltros({ plataforma: null, local: null, soloTeNecesita: false })}>Quitar los filtros</button>
        </p>
      )}

      {(grupos ?? []).map((g) => (
        <details key={g.canal} className="cxlm-grupo" open data-prueba="grupo-plataforma">
          <summary><span>{g.canal}</span><span className="cxlm-cuenta">{cuenta(g.filas, true)}</span></summary>
          {g.tiendas.map((t) => (
            <Tienda key={t.clave} t={t} sinPropuesta={sinPropuesta.datos ?? null} abierta={abierta} ocupado={ocupado} locales={locales.datos ?? []} hayRecorrido={recorrido.length > 0}
              alBoton={alBoton} alAbrir={(f) => setAbierta(abierta === f.clave ? null : f.clave)} alSiguiente={(f) => abrir(siguiente(f.clave))}
              alGuardarLocal={(storeId, localId) => void conAviso(() => darLocalATienda(accountId!, storeId, localId, quien))}
              alResolver={(f, x) => conAviso(async () => { const r = await resolverDiferencia(accountId!, activa.id, f.motor, partyDe(f), x, quien); setAbierta(null); return r })}
              alLlegada={(id, imp) => conAviso(() => reclamacionLlegada(id, hoy, imp, null, quien))} />
          ))}
        </details>
      ))}

      {m && m.cedidas.length > 0 && !filtros.plataforma && !filtros.soloTeNecesita && <Cedidas cedidas={m.cedidas} local={filtros.local} sinPropuesta={sinPropuesta.datos ?? null} />}
      {m && m.cedidas.length > 0 && (filtros.plataforma || filtros.soloTeNecesita) && (
        <p className="cxlm-vacio">Las marcas cedidas ({m.cedidas.length}) no salen con estos filtros: se cuadran con su socio, no con una plataforma.</p>
      )}

      {m && sinPropuesta.datos && <SinFila m={m} sinPropuesta={sinPropuesta.datos} />}

      <BotonPulgar><Boton variante="principal" ancho onClick={() => elegir.current?.click()} disabled={ocupado}>Subir una liquidación</Boton></BotonPulgar>

      {pidiendo && (
        <PedirLiquidacion f={pidiendo} companyId={activa.id} empresa={activa.razonSocial || activa.nombre || 'Tu empresa'} alCerrar={() => setPidiendo(null)}
          alPedir={(email, asunto, cuerpo) => {
            window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
            setPidiendo(null)
            setAviso({ texto: <>Se abre tu correo con el mensaje a <strong>{email}</strong>: mándalo desde ahí. Cuando llegue la liquidación a tu buzón de Sumied, esta fila se cuadra sola.</> })
          }} />
      )}
      {cambiando && (
        <CambiarTienda texto={cambiando.texto} partyId={partyDe(cambiando.fila)} alCerrar={() => setCambiando(null)}
          alNoEsLaMisma={() => { const id = cambiando.cambioId; setCambiando(null); void conAviso(() => decidirCambioTienda(id, false, {}, quien)) }} />
      )}
      {aMano && accountId && (
        <ApuntarAMano quienes={intermediarios} locales={locales.datos ?? []} hosteleria={hosteleria} hoy={hoy} alCerrar={() => setAMano(false)}
          alApuntar={(x) => conAviso(async () => {
            const id = x.intermediarioId ?? await darDeAltaIntermediario(activa.id, x.nuevo ?? '', quien)
            const r = await apuntarLiquidacion(activa.id, { ...x, intermediarioId: id }, quien)
            setAMano(false)
            return x.intermediarioId ? r.texto : `${x.nuevo} dado de alta en Contactos como quien te paga. ${r.texto}`
          })} />
      )}
    </div>
  )
}

// ── El resumen y la ayuda ───────────────────────────────────────────────────

function Resumen({ m, mes }: { m: MesLiquidaciones | null; mes: string }) {
  if (!m) return <section className="cxlm-resumen" aria-busy="true" aria-label="El mes"><p className="cxlm-frase">{nombreMes(mes)}</p></section>
  const r = m.resumen
  const b = barra(r)
  const cifra: Record<EstadoMes, number> = { completa: r.completa, aun_no_toca: r.aunNoToca, te_necesita: r.teNecesita, no_cuadra: r.noCuadra }
  return (
    <section className="cxlm-resumen" aria-label={`Liquidaciones de ${nombreMes(m.mes)}`} data-prueba="resumen-liquidaciones">
      <p className="cxlm-frase">{fraseResumen(m.mes, r)}</p>
      <div className="cxlm-barra" role="img" aria-label={(Object.keys(cifra) as EstadoMes[]).map((e) => `${cifra[e]} ${LEYENDA[e].toLowerCase()}`).join(', ')}>
        {b.map((x) => <i key={x.estado} data-tono={TONO[x.estado]} style={{ width: `${(100 * x.n) / r.total}%` }} />)}
      </div>
      <ul className="cxlm-leyenda">
        {(Object.keys(LEYENDA) as EstadoMes[]).map((e) => <li key={e} data-tono={TONO[e]}>{LEYENDA[e]}<span className="s-oculto">: {cifra[e]}</span></li>)}
      </ul>
    </section>
  )
}

function Ayuda() {
  return (
    <details className="cxlm-ayuda" data-prueba="ayuda-liquidaciones">
      <summary>¿Cómo funciona?</summary>
      <p><strong>Una liquidación</strong> es el documento con el que la plataforma te dice lo que vendiste por ella, lo que se queda y lo que te paga.</p>
      <p><strong>Cada periodo tiene cuatro piezas:</strong> lo que vendiste (tus pedidos), la liquidación, su factura de comisión (lo que se queda la plataforma) y el cobro que llega a tu banco.</p>
      <p><strong>Completa:</strong> están las cuatro y cuadran. <strong>Aún no toca:</strong> todavía no ha llegado su fecha. <strong>Te necesita:</strong> falta algo y te decimos qué. <strong>No cuadra:</strong> las cifras no coinciden y te decimos por qué.</p>
      <details className="cxlm-como">
        <summary>▶ Ver cómo se hace</summary>
        <ol>
          <li>Pulsa «Ver el recorrido»: se abre la primera que te necesita.</li>
          <li>Haz lo que dice su botón: «Pídela» abre tu correo con el mensaje escrito; «Súbela» sube la factura de comisión; «Ver por qué» te enseña la diferencia y cómo resolverla.</li>
          <li>Pulsa «Siguiente que te necesita ›» hasta que no quede ninguna.</li>
          <li>Lo que llega solo por correo se cuadra solo: no tienes que volver a mirarlo.</li>
        </ol>
      </details>
    </details>
  )
}

// ── Una tienda y sus periodos ───────────────────────────────────────────────

type Resolver = (f: FilaMes, x: { tipo: 'gasto' | 'reclamacion'; importe: number; frase: string }) => Promise<void>

function Tienda({ t, sinPropuesta, abierta, ocupado, locales, hayRecorrido, alBoton, alAbrir, alSiguiente, alGuardarLocal, alResolver, alLlegada }: {
  t: GrupoTienda; sinPropuesta: Map<string, SinPropuesta> | null; abierta: string | null; ocupado: boolean; locales: { id: string; nombre: string; abierto: boolean }[]; hayRecorrido: boolean
  alBoton: (f: FilaMes) => void; alAbrir: (f: FilaMes) => void; alSiguiente: (f: FilaMes) => void
  alGuardarLocal: (storeId: string, localId: string) => void; alResolver: Resolver; alLlegada: (id: string, importe: number | null) => Promise<void>
}) {
  // Plegada si está todo completo (maqueta «Mes completo»); abierta si algo te necesita.
  const completa = t.filas.every((f) => f.estado === 'completa')
  const tiendaSinLocal = t.sinLocal ? t.filas.find((f) => f.tiendas.some((x) => !x.localId))?.tiendas.find((x) => !x.localId) ?? null : null
  return (
    <details className="cxlm-tienda" open={!completa || t.filas.some((f) => f.clave === abierta)} data-prueba="tienda">
      <summary>
        <span><span className="cxlm-tn">{t.nombre}</span><br /><span className="cxlm-tp">{t.sinLocal ? <>{t.marcaLocal.split(' · ')[0]} · <strong>Tienda sin local</strong></> : t.marcaLocal}</span></span>
        <span className="cxlm-cuenta">{cuenta(t.filas)}</span>
      </summary>
      {t.filas.map((f, i) => (
        <Fila key={f.clave} f={f} sinPropuesta={[...new Set(f.motor.liquidaciones.map((x) => sinPropuesta?.get(x.id)?.porque).filter((x): x is string => !!x))]} abierta={abierta === f.clave} ocupado={ocupado} hayRecorrido={hayRecorrido}
          alBoton={alBoton} alAbrir={alAbrir} alSiguiente={alSiguiente} alResolver={alResolver} alLlegada={alLlegada}
          pregunta={i === 0 && tiendaSinLocal ? <PreguntaLocal tienda={tiendaSinLocal.nombre} canal={f.canal} locales={locales} ocupado={ocupado} alGuardar={(l) => alGuardarLocal(tiendaSinLocal.id, l)} /> : null} />
      ))}
    </details>
  )
}

function Fila({ f, sinPropuesta, abierta, ocupado, hayRecorrido, pregunta, alBoton, alAbrir, alSiguiente, alResolver, alLlegada }: {
  f: FilaMes; sinPropuesta: string[]; abierta: boolean; ocupado: boolean; hayRecorrido: boolean; pregunta: ReactNode
  alBoton: (f: FilaMes) => void; alAbrir: (f: FilaMes) => void; alSiguiente: (f: FilaMes) => void; alResolver: Resolver; alLlegada: (id: string, importe: number | null) => Promise<void>
}) {
  const tono = TONO[f.estado]
  // La tienda sin local ya pregunta arriba: su botón «Elige el local» sobra en la fila que lleva la pregunta.
  const boton = f.accion && !(f.accion === 'elige_local' && pregunta)
  const nota = f.estado === 'completa' ? null : f.frase
  return (
    <div className="cxlm-fila" id={`fila-${f.clave}`} data-estado={f.estado} data-abierta={abierta || undefined} data-prueba="fila-liquidacion">
      <button type="button" className="cxlm-per" aria-expanded={abierta} onClick={() => alAbrir(f)} title="Ver sus cuatro piezas">{periodoCorto(f.motor.desde, f.motor.hasta)}</button>
      <ul className="cxlm-piezas" aria-label="Las cuatro piezas">
        {piezas(f).map((p) => <li key={p.nombre} className="cxlm-pz" data-tono={p.tono || undefined} title={p.explicacion}>{p.nombre} {p.valor}<span className="s-oculto">: {p.explicacion}</span></li>)}
      </ul>
      <span className="cxlm-imp s-cifra">{euros(importe(f))}</span>
      <span className="cxlm-est">
        <span className="cxlm-chip" data-tono={tono}>{NOMBRE_ESTADO[f.estado]}</span>
        {boton && f.accion && (
          <button type="button" className={pideAlgo(f) ? 'cxlm-btn cxlm-btn-pri' : 'cxlm-btn'} disabled={ocupado} onClick={() => alBoton(f)}>{NOMBRE_ACCION[f.accion]}</button>
        )}
      </span>
      {nota && <p className="cxlm-nota">{nota}</p>}
      {/* Lo que no se ha podido apuntar solo, con sus palabras (Julio, S01q·10: «la pantalla tiene que decirlo con esas palabras»). */}
      {sinPropuesta.map((t) => <p key={t} className="cxlm-nota cxlm-sin-propuesta" data-prueba="sin-propuesta">{t}</p>)}
      {pregunta}
      {abierta && <Abierta f={f} ocupado={ocupado} hayRecorrido={hayRecorrido} alSiguiente={() => alSiguiente(f)} alResolver={alResolver} alLlegada={alLlegada} />}
    </div>
  )
}

function PreguntaLocal({ tienda, canal, locales, ocupado, alGuardar }: {
  tienda: string; canal: string; locales: { id: string; nombre: string; abierto: boolean }[]; ocupado: boolean; alGuardar: (localId: string) => void
}) {
  const [local, setLocal] = useState('')
  return (
    <div className="cxlm-preg" data-prueba="pregunta-local">
      <strong>¿De qué local es esta tienda?</strong> {canal} la llama «{tienda}».
      <select className="s-control" aria-label="Local de la tienda" value={local} onChange={(e) => setLocal(e.target.value)}>
        <option value="">Elige el local…</option>
        {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.abierto ? '' : ' (cerrado)'}</option>)}
      </select>
      <button type="button" className="cxlm-btn cxlm-btn-pri" disabled={!local || ocupado} onClick={() => alGuardar(local)}>Guardar</button>
      <span className="cxlm-tp cxlm-preg-pie">Vale para todas sus liquidaciones, las de antes y las que vengan. Mientras tanto se cuadra igual: por tienda, con su liquidación, su factura y su cobro.</span>
    </div>
  )
}

// ── La fila abierta ─────────────────────────────────────────────────────────

function Abierta({ f, ocupado, hayRecorrido, alSiguiente, alResolver, alLlegada }: {
  f: FilaMes; ocupado: boolean; hayRecorrido: boolean; alSiguiente: () => void; alResolver: Resolver; alLlegada: (id: string, importe: number | null) => Promise<void>
}) {
  const m = f.motor
  const l = m.liquidacion
  const dif = f.estado === 'no_cuadra' ? f.diferencia ?? m.diferencia ?? 0 : 0
  const [tipo, setTipo] = useState<'gasto' | 'reclamacion' | null>(null)
  const [frase, setFrase] = useState('')
  const pendientes = m.resoluciones.filter((r) => r.tipo === 'reclamacion' && !r.llegoEl)
  const facturas = m.liquidaciones.filter((x) => x.factura)
  const otros = l.otros ?? (l.pagan !== null ? Math.round((l.pagan - l.ventas + l.comision + (f.comparado?.promociones ?? 0)) * 100) / 100 : null)
  return (
    <div className="cxlm-abierta" data-prueba="fila-abierta">
      {f.estado === 'no_cuadra' && (
        <div className="cxlm-causa">
          <p><strong>Por qué no cuadra:</strong> {f.frase}</p>
          {dif !== 0 && (
            <>
              <p><strong>Qué hacer:</strong> mira esos pedidos. Si te pagan de menos, reclámaselo a {f.canal}{dif > 0 ? '; si es una devolución a un cliente o un ajuste, es un gasto' : ''}.</p>
              <div className="cxlm-botones">
                <button type="button" className={tipo === 'reclamacion' ? 'cxlm-btn cxlm-btn-pri' : 'cxlm-btn'} onClick={() => setTipo('reclamacion')}>Lo reclamo a {f.canal}</button>
                {dif > 0 && <button type="button" className={tipo === 'gasto' ? 'cxlm-btn cxlm-btn-pri' : 'cxlm-btn'} onClick={() => setTipo('gasto')}>Es un gasto</button>}
              </div>
              {tipo && (
                <div className="cxlm-resolver">
                  <label className="s-campo"><span className="s-campo-etiqueta">En una frase, por qué ({euros(Math.abs(dif))})</span>
                    <input className="s-control" value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={tipo === 'gasto' ? 'Una devolución a un cliente' : `Tres pedidos que ${f.canal} no ha pagado`} />
                  </label>
                  <button type="button" className="cxlm-btn cxlm-btn-pri" disabled={!frase.trim() || ocupado} onClick={() => void alResolver(f, { tipo, importe: Math.abs(dif), frase })}>
                    {tipo === 'gasto' ? 'Apuntarlo como gasto' : 'Apuntar la reclamación'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="cxlm-blq">
        <h4>La liquidación</h4>
        {l.n === 0 ? <p>Aún no ha llegado.</p> : (
          <table className="cxlm-tabla">
            <tbody>
              <tr><td>Pedidos<small>Cuántos pedidos te pagan</small></td><td>{m.liquidaciones.some((x) => x.pedidos !== null) ? m.liquidaciones.reduce((t, x) => t + (x.pedidos ?? 0), 0) : '—'}</td></tr>
              <tr><td>Ventas<small>Lo que pagaron tus clientes{l.ventas !== l.pedidosTotal ? `, a precio de carta (con promociones: ${euros(l.pedidosTotal)})` : ''}</small></td><td>{euros(l.ventas)}</td></tr>
              <tr><td>Comisión<small>Lo que se queda {f.canal}</small></td><td>{euros(-l.comision)}</td></tr>
              {f.comparado && f.comparado.promociones !== 0 && <tr><td>Promociones<small>Descuentos que pagas tú</small></td><td>{euros(-f.comparado.promociones)}</td></tr>}
              <tr><td>Otros<small>Publicidad, envíos, ajustes y devoluciones</small></td><td>{euros(otros)}</td></tr>
              <tr><td><strong>Lo que te pagan</strong></td><td><strong>{euros(l.pagan)}</strong></td></tr>
            </tbody>
          </table>
        )}
        {l.referencia && <p className="cxlm-tp">De antes del cierre: de referencia, no se contabiliza.</p>}
        {m.liquidaciones.map((x) => <p key={x.id} className="cxlm-tp"><Link to={rutaLiquidacionFicha(x.id)}>Ver la liquidación{x.ref ? ` ${x.ref}` : ''}</Link>{x.porAclarar ? ` · ${x.porAclarar}` : ''}</p>)}
      </div>
      <div className="cxlm-blq">
        <h4>Lo que vendiste</h4>
        <p>{f.sinLocal ? 'No sé de qué local es esta tienda: aún no puedo mirar lo que vendiste.'
          : <>{m.vendido.pedidos !== null ? `${m.vendido.pedidos} ${m.vendido.pedidos === 1 ? 'pedido' : 'pedidos'} · ` : ''}{euros(m.vendido.total)}{f.comparado ? ` · en productos a precio de carta, ${euros(f.comparado.vendido)}` : ''}</>}</p>
        <h4>La factura de comisión</h4>
        {l.n === 0 ? <p>Llega con su liquidación.</p>
          : facturas.length === 0 ? <p>{m.faltanFacturas > 0 ? 'Aún no ha llegado. Cuando llegue a Compras, se engancha sola.' : 'Esta liquidación no lleva factura de comisión.'}</p>
            : facturas.map((x) => <p key={x.id}>{x.factura!.numero ?? 'Sin número'} · {euros(x.factura!.total)}<br /><Link to={rutaRevisarFactura(x.factura!.id)}>Ver la factura</Link></p>)}
        <h4>El cobro</h4>
        <p>{l.n === 0 ? 'Llega después de su liquidación.'
          : m.cobro.llegado !== null ? <>Llegaron {euros(m.cobro.llegado)} al banco{m.liquidaciones.some((x) => x.cobradoEl) ? ` el ${ddmm(m.liquidaciones.find((x) => x.cobradoEl)!.cobradoEl!)}` : ''}{m.liquidaciones.every((x) => x.casadaEnBanco) ? ' ✓' : ''}</>
            : m.cobro.porCobrar > 0 ? `Esperando ${euros(m.cobro.esperado)}.` : 'Nada que cobrar.'}
          {m.canalId && <><br /><Link to={rutaLiquidacionPlataforma(claveGrupo(m.canalId, m.localId, m.desde, m.hasta))}>Casar el cobro con el banco</Link></>}
        </p>
      </div>
      {(m.resoluciones.length > 0 || pendientes.length > 0) && (
        <div className="cxlm-blq cxlm-ancho">
          {m.resoluciones.map((r) => <p key={r.id}>{r.tipo === 'gasto' ? 'Gasto' : 'Reclamado'}: {euros(Math.abs(r.importe))} · «{r.frase}»{r.llegoEl ? ` · llegó el ${ddmm(r.llegoEl)}` : ''}</p>)}
          {pendientes.map((r) => <button key={`l-${r.id}`} type="button" className="cxlm-btn" disabled={ocupado} onClick={() => void alLlegada(r.id, Math.abs(r.importe))}>Ha llegado lo reclamado ({euros(Math.abs(r.importe))})</button>)}
        </div>
      )}
      {hayRecorrido && <div className="cxlm-ancho cxlm-sig"><button type="button" className="cxlm-btn" onClick={alSiguiente}>Siguiente que te necesita ›</button></div>}
    </div>
  )
}

// ── Lo que no se pudo apuntar y no tiene fila en el mes ─────────────────────

/**
 * Regla 7: lo que no se ha podido apuntar solo y cuya liquidación no sale en
 * ninguna fila del mes (una de referencia, por ejemplo) no se esconde: sale
 * aquí, en el mes en que acaba su periodo, con sus palabras.
 */
function SinFila({ m, sinPropuesta }: { m: MesLiquidaciones; sinPropuesta: Map<string, SinPropuesta> }) {
  const enFila = new Set([...m.filas.flatMap((f) => f.motor.liquidaciones.map((x) => x.id)), ...m.cedidas.flatMap((c) => (c.liquidacion ? [c.liquidacion.id] : []))])
  const sueltas = [...sinPropuesta.values()].filter((x) => !enFila.has(x.origenId) && x.hasta !== null && x.hasta >= m.desde && x.hasta <= m.hasta)
  if (!sueltas.length) return null
  return (
    <section className="cxlm-grupo cxlm-sin-fila" aria-label="Sin apuntar, y sin su fila en este mes" data-prueba="sin-fila">
      <h2 className="cxlm-sin-fila-titulo">Sin apuntar, y sin su fila en este mes · {sueltas.length}</h2>
      <ul>{sueltas.map((x) => <li key={x.origenId}><strong>{x.que}</strong>: <span data-prueba="sin-propuesta">{x.porque}</span></li>)}</ul>
    </section>
  )
}

// ── Las marcas cedidas ──────────────────────────────────────────────────────

function Cedidas({ cedidas, local, sinPropuesta }: { cedidas: CedidaMes[]; local: string | null; sinPropuesta: Map<string, SinPropuesta> | null }) {
  const vistas = cedidas.filter((c) => !local || (local !== SIN_LOCAL && c.localId === local))
  const socios = [...new Set(cedidas.map((c) => c.socio))]
  const n = { completa: 0, aun_no_toca: 0, te_necesita: 0, no_cuadra: 0 } as Record<EstadoMes, number>
  for (const c of vistas) n[c.estado]++
  return (
    <details className="cxlm-grupo" open data-prueba="grupo-cedidas">
      <summary><span>Marcas cedidas · se cuadran con {lista(socios)}</span>
        <span className="cxlm-cuenta">{(Object.keys(n) as EstadoMes[]).filter((e) => n[e]).map((e) => `${n[e]} ${NOMBRE_ESTADO[e].toLowerCase()}`).join(' · ') || 'ninguna aquí'}</span>
      </summary>
      {vistas.map((c) => (
        <div key={`${c.socioId}:${c.localId}`} className="cxlm-tienda-plana">
          <div className="cxlm-tienda-cab"><span className="cxlm-tn">{c.marcas.join(', ')}</span><br /><span className="cxlm-tp">{c.socio} · {(c.local ?? 'Sin local').replace(/^Foodint\s+/i, '')}</span></div>
          <div className="cxlm-fila" data-estado={c.estado} data-prueba="fila-cedida">
            <span className="cxlm-per cxlm-per-texto">El mes</span>
            <ul className="cxlm-piezas" aria-label="Sus piezas">
              <li className="cxlm-pz" data-tono={c.vendido.total > 0 ? 'si' : undefined}>Vendido {c.vendido.total > 0 ? '✓' : '—'}</li>
              <li className="cxlm-pz" data-tono={c.liquidacion ? 'si' : c.estado === 'te_necesita' ? 'no' : undefined}>Liquidación {c.liquidacion ? '✓' : c.estado === 'te_necesita' ? 'falta' : '—'}</li>
            </ul>
            <span className="cxlm-imp s-cifra">{euros(c.liquidacion?.total ?? null)}</span>
            <span className="cxlm-est"><span className="cxlm-chip" data-tono={TONO[c.estado]}>{NOMBRE_ESTADO[c.estado]}</span>
              {c.liquidacion && <Link className="cxlm-btn" to={rutaLiquidacion(c.liquidacion.id)}>Ver</Link>}
            </span>
            {c.liquidacion && sinPropuesta?.get(c.liquidacion.id) && <p className="cxlm-nota cxlm-sin-propuesta" data-prueba="sin-propuesta">{sinPropuesta.get(c.liquidacion.id)!.porque}</p>}
            <p className="cxlm-nota">Vendiste {c.vendido.pedidos} {c.vendido.pedidos === 1 ? 'pedido' : 'pedidos'} ({euros(c.vendido.total)}). {c.frase}</p>
          </div>
        </div>
      ))}
    </details>
  )
}

// ── Tienda cambiada ─────────────────────────────────────────────────────────

function TiendaCambiada({ fila, texto, ocupado, alConfirmar, alCambiar }: { fila: FilaMes; texto: string; ocupado: boolean; alConfirmar: () => void; alCambiar: () => void }) {
  return (
    <section className="cxlm-cambio" aria-label="Una tienda ha cambiado" data-prueba="tienda-cambiada">
      <div className="cxlm-cambio-texto">
        <p className="cxlm-tn">{fila.canal} dice que una tienda ha cambiado</p>
        <p className="cxlm-tp">{texto.replace(/: confírmalo con un clic\.$/, '.')} Lo vendido antes se queda con su marca y su local.</p>
      </div>
      <div className="cxlm-botones">
        <button type="button" className="cxlm-btn cxlm-btn-pri" disabled={ocupado} onClick={alConfirmar}>Sí, desde el {ddmm(fila.motor.desde)}</button>
        <button type="button" className="cxlm-btn" disabled={ocupado} onClick={alCambiar}>Cambiar</button>
      </div>
    </section>
  )
}

function CambiarTienda({ texto, partyId, alCerrar, alNoEsLaMisma }: { texto: string; partyId: string | null; alCerrar: () => void; alNoEsLaMisma: () => void }) {
  return (
    <Dialogo titulo="Cambiar la tienda" alCerrar={alCerrar}
      explicacion={<>{texto.replace(/: confírmalo con un clic\.$/, '.')}</>}
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton onClick={alNoEsLaMisma}>No es la misma tienda</Boton></>}>
      <p className="s-apoyo">Si es la misma tienda pero con otra marca u otro local, cámbialo desde el día que toque en {partyId ? <Link to={rutaFichaTercero(partyId, 'liquidaciones')}>Sus tiendas</Link> : 'Contactos › Sus tiendas'}: lo vendido antes se queda donde estaba.</p>
      <p className="s-apoyo">Si no es la misma, se queda como una tienda nueva, sin marca ni local hasta que se los des.</p>
    </Dialogo>
  )
}

// ── Pídela ──────────────────────────────────────────────────────────────────

function PedirLiquidacion({ f, companyId, empresa, alCerrar, alPedir }: {
  f: FilaMes; companyId: string; empresa: string; alCerrar: () => void; alPedir: (email: string, asunto: string, cuerpo: string) => void
}) {
  const buzon = useLeer(() => leerCorreoFacturas(companyId), `${companyId}:buzon`)
  const direccion = buzon.datos?.direccion ?? null
  const tienda = f.tiendas[0]?.nombre ?? [f.motor.marca, f.motor.local].filter(Boolean).join(', ')
  const [email, setEmail] = useState('')
  const [asunto, setAsunto] = useState(`Liquidación · ${tienda} · ${periodoCorto(f.motor.desde, f.motor.hasta)}`)
  const [tocado, setTocado] = useState(false)
  const cuerpoBase = useMemo(() => `Hola:\n\nNo nos ha llegado la liquidación del ${ddmm(f.motor.desde)} al ${ddmm(f.motor.hasta)}${tienda ? ` de la tienda «${tienda}»` : ''}. `
    + `${direccion ? `¿Podéis mandarla, y las siguientes, también a ${direccion}?` : '¿Nos la podéis mandar?'}\n\nGracias.\n${empresa}`, [f, tienda, direccion, empresa])
  const [cuerpo, setCuerpo] = useState('')
  const texto = tocado ? cuerpo : cuerpoBase
  const vale = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  return (
    <Dialogo titulo={`Pídela · ${f.canal}`} alCerrar={alCerrar}
      explicacion={direccion ? <>Se abre tu correo con el mensaje escrito y lo mandas tú. Pide que la manden a tu buzón de Sumied (<strong>{direccion}</strong>): así llega sola.</>
        : 'Se abre tu correo con el mensaje escrito y lo mandas tú.'}
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!vale} onClick={() => alPedir(email.trim(), asunto, texto)}>Abrir el correo</Boton></>}>
      <label className="s-campo"><span className="s-campo-etiqueta">A</span><input className="s-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="soporte@plataforma.com" /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Asunto</span><input className="s-control" value={asunto} onChange={(e) => setAsunto(e.target.value)} /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Texto</span><textarea className="s-control cxlm-texto" rows={7} value={texto} onChange={(e) => { setTocado(true); setCuerpo(e.target.value) }} /></label>
    </Dialogo>
  )
}

// ── Apuntar a mano ──────────────────────────────────────────────────────────

type Apunte = { intermediarioId: string | null; nuevo: string | null; localId: string | null; desde: string; hasta: string; vendido: number; comision: number; cobrado: number; pedidos: number | null; referencia: string | null }
const OTRO = '__otro__'
const numero = (t: string) => { const n = Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }

function ApuntarAMano({ quienes, locales, hosteleria, hoy, alCerrar, alApuntar }: {
  quienes: Intermediario[]; locales: { id: string; nombre: string; abierto: boolean }[]; hosteleria: boolean; hoy: string; alCerrar: () => void; alApuntar: (x: Apunte) => Promise<void>
}) {
  const opcionesQuien = quienes.filter((q) => hosteleria || !q.canalId)
  const [quien, setQuien] = useState(opcionesQuien[0]?.id ?? OTRO)
  const [nuevo, setNuevo] = useState('')
  const [local, setLocal] = useState('')
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`)
  const [hasta, setHasta] = useState(hoy)
  const [vendido, setVendido] = useState('')
  const [comision, setComision] = useState('')
  const [cobrado, setCobrado] = useState('')
  const [pedidos, setPedidos] = useState('')
  const [referencia, setReferencia] = useState('')
  const v = numero(vendido); const c = comision.trim() ? numero(comision) : 0; const k = numero(cobrado)
  const vale = (quien !== OTRO || nuevo.trim()) && desde && hasta && hasta >= desde && Number.isFinite(v) && Number.isFinite(c) && c >= 0 && Number.isFinite(k)
  return (
    <Dialogo titulo="Apuntar a mano una liquidación" alCerrar={alCerrar}
      explicacion="Periodo, lo vendido, la comisión y lo cobrado. Se cuadra igual que lo que llega solo."
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!vale}
        onClick={() => void alApuntar({ intermediarioId: quien === OTRO ? null : quien, nuevo: quien === OTRO ? nuevo.trim() : null, localId: local || null, desde, hasta,
          vendido: v, comision: c, cobrado: k, pedidos: pedidos.trim() ? Math.round(numero(pedidos)) : null, referencia: referencia.trim() || null })}>Apuntarla</Boton></>}>
      <label className="s-campo"><span className="s-campo-etiqueta">Quién te paga</span>
        <select className="s-control" value={quien} onChange={(e) => setQuien(e.target.value)}>
          {opcionesQuien.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
          <option value={OTRO}>Otro (Amazon, Stripe, PayPal, el datáfono…)</option>
        </select>
      </label>
      {quien === OTRO && <label className="s-campo"><span className="s-campo-etiqueta">Su nombre</span><input className="s-control" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Stripe" /></label>}
      {hosteleria && (
        <label className="s-campo"><span className="s-campo-etiqueta">Local (si es de uno)</span>
          <select className="s-control" value={local} onChange={(e) => setLocal(e.target.value)}>
            <option value="">Todos los locales</option>
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.abierto ? '' : ' (cerrado)'}</option>)}
          </select>
        </label>
      )}
      <div className="cxlm-dos">
        <label className="s-campo"><span className="s-campo-etiqueta">Desde</span><input className="s-control" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Hasta</span><input className="s-control" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <div className="cxlm-dos">
        <label className="s-campo"><span className="s-campo-etiqueta">Lo vendido (€)</span><input className="s-control s-cifra" inputMode="decimal" value={vendido} onChange={(e) => setVendido(e.target.value)} /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Comisión (€)</span><input className="s-control s-cifra" inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="0" /></label>
      </div>
      <div className="cxlm-dos">
        <label className="s-campo"><span className="s-campo-etiqueta">Te paga (€)</span><input className="s-control s-cifra" inputMode="decimal" value={cobrado} onChange={(e) => setCobrado(e.target.value)} /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Pedidos (si lo dice)</span><input className="s-control s-cifra" inputMode="numeric" value={pedidos} onChange={(e) => setPedidos(e.target.value)} /></label>
      </div>
      <label className="s-campo"><span className="s-campo-etiqueta">Su referencia (si la tiene)</span><input className="s-control" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
    </Dialogo>
  )
}
