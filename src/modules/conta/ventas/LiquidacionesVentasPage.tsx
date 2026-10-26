// src/modules/conta/ventas/LiquidacionesVentasPage.tsx
//
// V02 · Pantallas · Ventas › Liquidaciones, fiel a los tableros 28 (hostelería)
// y 29 (un negocio que no es de hostelería), aprobados por Julio el 25/10.
// Sustituye a la lista del V01 (tablero 20 y 21). Lo que te pagan quienes
// cobran por ti: cada periodo cuadra solo con cuatro piezas (lo vendido, la
// liquidación, su factura y el cobro en el banco). Lo decide el motor
// (conta_liquidaciones); lo que se enseña, lib/liquidacionesPantalla.ts.
//
//   · La banda del mes: «Cuadradas X de Y liquidaciones», la barra en tres
//     colores (cuadradas · les falta una pieza · no cuadran), «Te han pagado»,
//     lo vendido y las comisiones con su porcentaje, y el botón blanco: «Pedir
//     las N que faltan» (hostelería: el envío automático de correos aún no está
//     abierto, y lo dice) o «Ver las N pendientes».
//   · El aviso de tienda cambiada: «Sí, desde el día…» o «Cambiar».
//   · «Este mes»: una tarjeta por intermediario, tienda y periodo, primero lo
//     que necesita algo de ti; sus cuatro piezas como píldoras, una frase, el
//     importe, el estado y UN botón (Ver · Subirla · Ver por qué · Pedírsela)
//     más «⋯». Debajo, «Y N cuadradas más · Ver todas» (regla 7: nada se esconde).
//   · «Cuándo te pagan»: el ritmo de cada uno, el de su ficha de Contactos.
//   · «¿Prefieres apuntarla tú?»: el camino a mano, para cualquiera (Amazon,
//     Stripe, PayPal, el datáfono… entran así o con «Subir una liquidación»
//     hasta que tengan su lector: no hay «Conectar» que no haga nada).
// Las plataformas de reparto y los socios de marca, solo con «Vendo en hostelería».
// Regla 8: cada botón dice lo que ha hecho, con contenido.

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaFichaTercero, rutaLiquidacionPlataforma } from '@/config/navegacion'
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
import type { FilaMotor } from '@/modules/conta/lib/liquidacionesMotor'
import {
  NOMBRE_ACCION, NOMBRE_SITUACION, accion, accionPrincipal, banda, cadaCuanto, colorDe, cuandoPaga, delMes, esteMes, importe, inicial, mesDe,
  ordenar, periodoCorto, piezas, situacion, type Banda,
} from '@/modules/conta/lib/liquidacionesPantalla'
import {
  apuntarLiquidacion, darDeAltaIntermediario, decidirCambioTienda, leerFicherosLiquidacion, leerIntermediarios, leerLiquidacionesMotor, leerLocales,
  reclamacionLlegada, registrarLeidas, resolverDiferencia, type Intermediario,
} from '@/modules/conta/services/liquidacionesMotorService'
import { leerLiquidaciones } from '@/modules/conta/services/liquidacionesService'
import { Socios } from '@/modules/conta/ventas/SociosDeMarca'

/** El envío automático de correos. Cerrado mientras no haya dominio de correo (el mismo que en Documentos). */
const ENVIO_ABIERTO = false
const ACEPTA = '.csv,.xlsx,.xls,.pdf,text/csv,application/pdf'
const euros = (x: number | null | undefined) => (x === null || x === undefined ? '—' : eurosExactos(x))
const lista = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
/** Quién y dónde: «Uber Eats · Meraki Pita · Alcalá» (la marca es la tienda; sin local, «todos los locales»). */
const quienDonde = (f: FilaMotor) => [f.intermediario, f.marca, f.local ?? (f.canalId ? null : 'todos los locales')].filter(Boolean).join(' · ')

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
  const ver = query.get('ver') === 'socios' && hosteleria ? 'socios' : query.get('ver') === 'todas' ? 'todas' : 'mes'
  const mes = mesDe(hoy)
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [abierta, setAbierta] = useState<FilaMotor | null>(null)
  const [pidiendo, setPidiendo] = useState<FilaMotor | null>(null)
  const [cambiando, setCambiando] = useState<{ fila: FilaMotor; cambioId: string; texto: string } | null>(null)
  const [aMano, setAMano] = useState(false)
  const elegir = useRef<HTMLInputElement>(null)
  const listaMes = useRef<HTMLElement>(null)

  // Los tres últimos meses: el de este y los dos de antes (una quincena o una semana pueden empezar en el anterior).
  const desde = useMemo(() => { const d = new Date(`${mes.desde}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 10) }, [mes.desde])
  const clave = `${accountId}:${activa?.id}:${hosteleria}:${desde}:${vuelta}`
  const motor = useLeer(accountId && activa && ver !== 'socios' ? () => leerLiquidacionesMotor(activa.id, desde, hoy) : null, `${clave}:motor`)
  const quienes = useLeer(accountId ? () => leerIntermediarios(accountId) : null, `${clave}:quienes`)
  const socios = useLeer(accountId && activa && hosteleria && ver === 'socios' ? () => leerLiquidaciones(accountId, activa.id, hoy) : null, `${clave}:socios`)

  const recargar = () => setVuelta((v) => v + 1)
  const conAviso = async (hacer: () => Promise<ReactNode>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ texto: await hacer() }); recargar() } catch (e) { setAviso({ texto: e instanceof Error ? e.message : String(e), tono: 'falta' }) } finally { setOcupado(false) }
  }
  const cambiarVer = (v: 'mes' | 'todas' | 'socios') => setQuery(v === 'mes' ? new URLSearchParams() : new URLSearchParams({ ver: v }), { replace: false })

  const frase = hosteleria
    ? 'Lo que te pagan quienes cobran por ti. Cada periodo cuadra solo con cuatro piezas: lo vendido, la liquidación, su factura y el cobro en el banco.'
    : 'Lo que te pagan quienes cobran por ti: el datáfono, Amazon, Stripe, PayPal… Cada periodo cuadra solo con cuatro piezas.'
  const mas: GrupoDeAcciones[] = activa ? [{
    titulo: 'Liquidaciones',
    acciones: [
      { id: 'a-mano', etiqueta: 'Apuntar a mano', dato: 'El periodo, lo vendido, la comisión y lo cobrado', alPulsar: () => setAMano(true), grupo: '' },
      { id: 'todas', etiqueta: 'Ver todas', dato: 'Las de los tres últimos meses, también las cuadradas', alPulsar: () => cambiarVer('todas'), grupo: '' },
      ...(hosteleria ? [{ id: 'socios', etiqueta: 'Socios de marca', dato: 'Lo que liquidas cada mes con el socio de las marcas cedidas', alPulsar: () => cambiarVer('socios'), grupo: '' }] : []),
    ],
  }] : []
  const encabezado = (
    <EncabezadoPagina titulo={ver === 'socios' ? 'Liquidaciones de los socios de marca' : 'Liquidaciones'} frase={ver === 'socios' ? 'Lo que liquidas cada mes con el socio de las marcas cedidas, local por local.' : frase}
      principal={movil ? undefined : <Boton variante="principal" tecla="U" onClick={() => elegir.current?.click()} disabled={ocupado}>Subir una liquidación</Boton>}
      masAcciones={mas} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus liquidaciones.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus liquidaciones.</p></div>
  if (ver === 'socios') {
    return (
      <div className="s-pagina">
        {encabezado}
        <p className="s-apoyo"><button type="button" className="s-boton s-boton-enlace" onClick={() => cambiarVer('mes')}>‹ Volver a Liquidaciones</button></p>
        <Socios datos={socios.datos?.filas ?? null} error={socios.error} recargar={socios.recargar} movil={movil} navegar={navegar} />
      </div>
    )
  }

  const todas = motor.datos ?? null
  const filasMes = todas ? delMes(todas, mes) : null
  const b = filasMes ? banda(filasMes) : null
  const intermediarios = quienes.datos ?? []
  const partyDe = (f: FilaMotor) => intermediarios.find((i) => i.id === f.intermediarioId)?.partyId ?? null
  // Los avisos de tienda cambiada, uno por cambio.
  const cambios = new Map<string, { fila: FilaMotor; texto: string }>()
  for (const f of filasMes ?? []) for (const a of f.avisos) if (a.tipo === 'tienda_cambiada' && a.cambioId && !cambios.has(a.cambioId)) cambios.set(a.cambioId, { fila: f, texto: a.texto })
  const cerrados = [...new Set((filasMes ?? []).flatMap((f) => f.avisos.filter((a) => a.tipo === 'local_cerrado').map((a) => a.texto)))]

  const subir = async (fs: FileList | null) => {
    const ficheros = Array.from(fs ?? [])
    if (elegir.current) elegir.current.value = ''
    if (!ficheros.length) return
    await conAviso(async () => {
      const { datos, noReconocidos } = await leerFicherosLiquidacion(ficheros)
      if (!datos.length) {
        throw new Error(`No reconozco ${ficheros.length === 1 ? 'este fichero' : 'estos ficheros'} (${lista(noReconocidos)}). Leo el informe «Detalles del pago» de Uber (CSV) y el Excel y el PDF de Glovo; Just Eat llega solo por correo. Lo demás, con «Apuntar a mano».`)
      }
      const hechas = await registrarLeidas(activa.id, datos, quien)
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
  const pedirTodas = () => {
    const faltan = (filasMes ?? []).filter((f) => f.estado === 'falta_liquidacion' || f.estado === 'falta_factura')
    const nombres = [...new Set(faltan.map((f) => f.intermediario))]
    setAviso(ENVIO_ABIERTO ? null : {
      tono: 'duda',
      texto: <>El envío automático de correos aún no está abierto: <strong>no he mandado nada</strong>. Pídeselas una a una con «Pedírsela» (se abre tu correo con el mensaje escrito) o súbelas con «Subirla». {faltan.length === 1 ? 'Es' : `Son ${faltan.length}`}, de {lista(nombres)}.</>,
    })
  }
  const verPendientes = () => listaMes.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const alBoton = (f: FilaMotor) => {
    const a = accion(f)
    if (a === 'subirla') elegir.current?.click()
    else if (a === 'pedirsela') setPidiendo(f)
    else setAbierta(f)
  }

  return (
    <div className="s-pagina cxdo cxlq" data-movil={movil || undefined}>
      {encabezado}
      <input ref={elegir} type="file" multiple accept={ACEPTA} className="s-oculto" aria-label="Elegir la liquidación" onChange={(e) => void subir(e.target.files)} />

      {aviso && <div className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono ? 'alert' : 'status'} data-prueba="liquidaciones-aviso">{aviso.texto}</div>}
      {(motor.error || quienes.error) && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer tus liquidaciones: {motor.error ?? quienes.error} <button type="button" className="s-boton s-boton-enlace" onClick={recargar}>Reintentar</button></p>
      )}

      {ver === 'todas' ? (
        <TodasLasFilas filas={todas} movil={movil} ocupado={ocupado} alVolver={() => cambiarVer('mes')} alBoton={alBoton} alVer={setAbierta} />
      ) : (
        <>
          <BandaMes b={b} mes={mes.nombre} hosteleria={hosteleria} movil={movil} alPedir={pedirTodas} alVerPendientes={verPendientes} />

          {[...cambios.entries()].map(([id, c]) => (
            <TiendaCambiada key={id} fila={c.fila} texto={c.texto} ocupado={ocupado}
              alConfirmar={() => void conAviso(async () => `${await decidirCambioTienda(id, true, { desde: c.fila.desde }, quien)} Lo vendido antes se queda con su marca y su local.`)}
              alCambiar={() => setCambiando({ fila: c.fila, cambioId: id, texto: c.texto })} />
          ))}
          {cerrados.map((t) => <p key={t} className="s-aviso-lista" data-tono="duda">{t}</p>)}

          <div className="cxlq-columnas">
            <EsteMes refLista={listaMes} filas={filasMes} movil={movil} ocupado={ocupado} alBoton={alBoton} alVer={setAbierta} alVerTodas={() => cambiarVer('todas')} />
            <div className="cxlq-lado">
              <CuandoTePagan quienes={quienes.datos ?? null} hosteleria={hosteleria} />
              <section className="cxlq-amano" aria-label="¿Prefieres apuntarla tú?">
                <h2 className="cxlq-amano-titulo">¿Prefieres apuntarla tú?</h2>
                <p className="cxlq-amano-frase">Periodo, lo vendido, la comisión y lo cobrado. Se cuadra igual que lo que llega solo.</p>
                <button type="button" className="cxdo-boton-blanco" onClick={() => setAMano(true)} disabled={ocupado}>Apuntar a mano</button>
              </section>
            </div>
          </div>
        </>
      )}

      <BotonPulgar><Boton variante="principal" ancho onClick={() => elegir.current?.click()} disabled={ocupado}>Subir una liquidación</Boton></BotonPulgar>

      {abierta && (
        <VerFila f={abierta} hosteleria={hosteleria} alCerrar={() => setAbierta(null)}
          alResolver={(x) => conAviso(async () => { const t = await resolverDiferencia(accountId!, activa.id, abierta, partyDe(abierta), x, quien); setAbierta(null); return t })}
          alLlegada={(id, importeLlegado) => conAviso(async () => { const t = await reclamacionLlegada(id, hoy, importeLlegado, null, quien); setAbierta(null); return t })} />
      )}
      {pidiendo && (
        <PedirFactura f={pidiendo} empresa={activa.razonSocial || activa.nombre || 'Tu empresa'} alCerrar={() => setPidiendo(null)}
          alPedir={(email, asunto, cuerpo) => {
            window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
            setPidiendo(null)
            setAviso({ texto: <>Se abre tu correo con el mensaje a <strong>{email}</strong>: mándalo desde ahí. El envío automático aún no está abierto. Cuando llegue la factura a Compras, se engancha sola.</> })
          }} />
      )}
      {cambiando && (
        <CambiarTienda texto={cambiando.texto} partyId={partyDe(cambiando.fila)} alCerrar={() => setCambiando(null)}
          alNoEsLaMisma={() => { const id = cambiando.cambioId; setCambiando(null); void conAviso(() => decidirCambioTienda(id, false, {}, quien)) }} />
      )}
      {aMano && accountId && (
        <ApuntarAMano accountId={accountId} quienes={intermediarios} hosteleria={hosteleria} hoy={hoy} alCerrar={() => setAMano(false)}
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

// ── La banda del mes ────────────────────────────────────────────────────────

function BandaMes({ b, mes, hosteleria, movil, alPedir, alVerPendientes }: {
  b: Banda | null; mes: string; hosteleria: boolean; movil: boolean; alPedir: () => void; alVerPendientes: () => void
}) {
  if (!b) return <section className="cxdo-banda" aria-busy="true" aria-label="Este mes"><p className="cxdo-banda-mes">{mes}</p></section>
  const pct = (n: number) => (b.total ? `${(100 * n) / b.total}%` : '0%')
  const pendientes = b.falta + b.noCuadran
  const boton = hosteleria
    ? b.porPedir > 0 && <button type="button" className="cxdo-banda-boton" onClick={alPedir}>{b.porPedir === 1 ? 'Pedir la que falta' : `Pedir las ${b.porPedir} que faltan`}</button>
    : pendientes > 0 && <button type="button" className="cxdo-banda-boton" onClick={alVerPendientes}>{pendientes === 1 ? 'Ver la pendiente' : `Ver las ${pendientes} pendientes`}</button>
  return (
    <section className="cxdo-banda" aria-label={`Liquidaciones de ${mes}`} data-prueba="banda-liquidaciones">
      <div className="cxdo-banda-cuerpo">
        <p className="cxdo-banda-mes">{mes}</p>
        <h2 className="cxdo-banda-titulo">{b.total === 0 ? 'Ninguna liquidación este mes todavía' : `Cuadradas ${b.cuadradas} de ${b.total} ${b.total === 1 ? 'liquidación' : 'liquidaciones'}`}</h2>
        <div className="cxdo-barra cxlq-barra" role="img" aria-label={`${b.cuadradas} cuadradas, ${b.falta} les falta una pieza y ${b.noCuadran} no cuadran`}>
          <span className="cxdo-barra-ya" style={{ width: pct(b.cuadradas) }} />
          <span className="cxdo-barra-tarde" style={{ width: pct(b.falta) }} />
          <span className="cxlq-barra-mal" style={{ width: pct(b.noCuadran) }} />
        </div>
        <ul className="cxdo-leyenda cxlq-leyenda">
          <li data-tono="ya"><strong>{b.cuadradas}</strong> {b.cuadradas === 1 ? 'cuadrada' : 'cuadradas'}</li>
          <li data-tono="tarde"><strong>{b.falta}</strong> {b.falta === 1 ? 'le falta una pieza' : 'les falta una pieza'}</li>
          <li data-tono="mal"><strong>{b.noCuadran}</strong> {b.noCuadran === 1 ? 'no cuadra' : 'no cuadran'}</li>
        </ul>
      </div>
      <div className="cxdo-banda-pedir cxlq-pagado">
        <p className="cxdo-banda-nota">Te han pagado</p>
        <p className="cxlq-pagado-cifra s-cifra">{eurosExactos(b.pagado)}</p>
        {!movil && (
          <p className="cxdo-banda-nota">
            {hosteleria ? `de ${eurosExactos(b.vendido)} vendidos por plataformas` : `de ${eurosExactos(b.vendido)} cobrados por quienes te pagan`}
            {b.comision > 0 ? ` · comisiones ${eurosExactos(b.comision)}${b.pct !== null ? ` (${b.pct.toLocaleString('es-ES')} %)` : ''}` : ''}
          </p>
        )}
        {boton}
      </div>
    </section>
  )
}

// ── Tienda cambiada ─────────────────────────────────────────────────────────

function TiendaCambiada({ fila, texto, ocupado, alConfirmar, alCambiar }: { fila: FilaMotor; texto: string; ocupado: boolean; alConfirmar: () => void; alCambiar: () => void }) {
  return (
    <section className="cxlq-cambio" aria-label="Una tienda ha cambiado" data-prueba="tienda-cambiada">
      <span className="cxdo-inicial" data-color={colorDe(fila.intermediario)} aria-hidden="true">{inicial(fila.intermediario)}</span>
      <div className="cxlq-cambio-texto">
        <p className="cxlq-cambio-titulo">{fila.intermediario} dice que una tienda ha cambiado</p>
        <p className="cxlq-cambio-dato">{texto.replace(/: confírmalo con un clic\.$/, '.')} Lo vendido antes se queda con su marca y su local.</p>
      </div>
      <div className="cxlq-cambio-botones">
        <button type="button" className="cxdo-boton-azul" disabled={ocupado} onClick={alConfirmar}>Sí, desde el {ddmm(fila.desde)}</button>
        <button type="button" className="cxdo-boton-blanco" disabled={ocupado} onClick={alCambiar}>Cambiar</button>
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

// ── Este mes ────────────────────────────────────────────────────────────────

function EsteMes({ refLista, filas, movil, ocupado, alBoton, alVer, alVerTodas }: {
  refLista: RefObject<HTMLElement | null>; filas: FilaMotor[] | null; movil: boolean; ocupado: boolean
  alBoton: (f: FilaMotor) => void; alVer: (f: FilaMotor) => void; alVerTodas: () => void
}) {
  const e = filas ? esteMes(filas) : null
  return (
    <section ref={refLista} className="cxdo-columna cxlq-mes" aria-label="Este mes" data-prueba="este-mes">
      <header className="cxdo-columna-cabeza">
        <h2 className="cxdo-columna-titulo">Este mes</h2>
        <p className="cxdo-columna-frase">Primero lo que necesita algo de ti.</p>
      </header>
      {!filas && <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo las liquidaciones" />}
      {filas && filas.length === 0 && <p className="cxdo-vacio">Aún no hay ninguna liquidación este mes. Llegan solas por correo, o súbela con «Subir una liquidación».</p>}
      {e && e.vistas.length > 0 && <ul className="cxdo-filas">{e.vistas.map((f) => <Tarjeta key={f.clave} f={f} movil={movil} ocupado={ocupado} alBoton={alBoton} alVer={alVer} />)}</ul>}
      {e && (e.cuadradasMas > 0 || (filas?.length ?? 0) > 0) && (
        <p className="cxdo-columna-pie">
          <span>{e.cuadradasMas > 0 ? `Y ${e.cuadradasMas} ${e.cuadradasMas === 1 ? 'cuadrada' : 'cuadradas'} más` : 'Están todas'}</span>
          <button type="button" className="cxdo-enlace" onClick={alVerTodas}>Ver todas</button>
        </p>
      )}
    </section>
  )
}

function Tarjeta({ f, movil, ocupado, alBoton, alVer }: { f: FilaMotor; movil: boolean; ocupado: boolean; alBoton: (f: FilaMotor) => void; alVer: (f: FilaMotor) => void }) {
  const [menu, setMenu] = useState(false)
  const s = situacion(f)
  const a = accion(f)
  const ps = piezas(f)
  return (
    <li className="cxlq-tarjeta" data-prueba="tarjeta-liquidacion" data-situacion={s}>
      <span className="cxdo-inicial" data-color={colorDe(f.intermediario)} aria-hidden="true">{inicial(f.intermediario)}</span>
      <div className="cxlq-tarjeta-cuerpo">
        <p className="cxlq-tarjeta-quien"><strong>{quienDonde(f)}</strong> · {periodoCorto(f.desde, f.hasta)}</p>
        <ul className="cxlq-piezas" aria-label="Las cuatro piezas">
          {ps.map((p) => <li key={p.id} className="cxlq-pieza" data-tono={p.tono}><span aria-hidden="true">{p.tono === 'ok' ? '✓' : p.tono === 'mal' ? '≠' : '·'}</span> {p.texto}<span className="s-oculto">{p.tono === 'ok' ? ': está' : p.tono === 'mal' ? ': no cuadra' : ': falta'}</span></li>)}
        </ul>
        {s !== 'cuadrada' && <p className="cxlq-frase">{f.frase}</p>}
      </div>
      <div className="cxlq-tarjeta-cifra">
        <strong className="s-cifra">{euros(importe(f))}</strong>
        <span className="cxlq-estado" data-situacion={s}>{NOMBRE_SITUACION[s]}</span>
      </div>
      <div className="cxlq-tarjeta-botones">
        <button type="button" className={accionPrincipal(a) ? 'cxdo-boton-azul' : 'cxdo-boton-blanco'} disabled={ocupado} onClick={() => alBoton(f)}>{NOMBRE_ACCION[a]}</button>
        {!movil && (
          <span className="cxdo-mas" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(false) }}>
            <button type="button" className="cxdo-mas-boton" aria-label={`Más de ${quienDonde(f)}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
            {menu && (
              <span className="cxdo-mas-menu" role="menu">
                {a !== 'ver' && <button type="button" role="menuitem" onClick={() => { setMenu(false); alVer(f) }}>Ver sus cuatro piezas</button>}
                {f.canalId && f.localId && <Link role="menuitem" className="cxlq-menu-enlace" to={rutaLiquidacionPlataforma(claveGrupo(f.canalId, f.localId, f.desde, f.hasta))}>Casar el cobro con el banco</Link>}
              </span>
            )}
          </span>
        )}
      </div>
    </li>
  )
}

function TodasLasFilas({ filas, movil, ocupado, alVolver, alBoton, alVer }: {
  filas: FilaMotor[] | null; movil: boolean; ocupado: boolean; alVolver: () => void; alBoton: (f: FilaMotor) => void; alVer: (f: FilaMotor) => void
}) {
  const o = filas ? ordenar(filas) : null
  return (
    <section className="cxdo-columna cxlq-mes" aria-label="Todas las liquidaciones" data-prueba="todas">
      <header className="cxdo-columna-cabeza">
        <h2 className="cxdo-columna-titulo">Todas · los tres últimos meses</h2>
        <p className="cxdo-columna-frase">{o ? `${o.length} ${o.length === 1 ? 'liquidación' : 'liquidaciones'}, primero lo que necesita algo de ti.` : 'Leyendo…'} <button type="button" className="cxdo-enlace" onClick={alVolver}>Volver a este mes</button></p>
      </header>
      {!o && <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo las liquidaciones" />}
      {o && o.length === 0 && <p className="cxdo-vacio">Ninguna en los tres últimos meses.</p>}
      {o && o.length > 0 && <ul className="cxdo-filas">{o.map((f) => <Tarjeta key={f.clave} f={f} movil={movil} ocupado={ocupado} alBoton={alBoton} alVer={alVer} />)}</ul>}
    </section>
  )
}

// ── Cuándo te pagan ─────────────────────────────────────────────────────────

function CuandoTePagan({ quienes, hosteleria }: { quienes: Intermediario[] | null; hosteleria: boolean }) {
  // Sin hostelería, las plataformas de reparto no salen (no venden por ellas).
  const vistos = (quienes ?? []).filter((q) => hosteleria || !q.canalId)
  return (
    <section className="cxdo-tarjeta cxlq-cuando" aria-label="Cuándo te pagan">
      <header className="cxdo-columna-cabeza">
        <h2 className="cxdo-columna-titulo">Cuándo te pagan</h2>
        <p className="cxdo-columna-frase">Lo que dice la ficha de cada uno. Si cambia, se cambia allí.</p>
      </header>
      {!quienes && <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo quién te paga" />}
      {quienes && vistos.length === 0 && <p className="cxdo-vacio">Aún nadie. Quien te paga se da de alta solo con su primera liquidación.</p>}
      {vistos.length > 0 && (
        <ul className="cxdo-filas">
          {vistos.map((q) => (
            <li key={q.id} className="cxdo-fila">
              <span className="cxdo-inicial" data-color={colorDe(q.nombre)} aria-hidden="true">{inicial(q.nombre)}</span>
              <span className="cxdo-fila-texto">
                <Link className="cxdo-fila-nombre cxlq-enlace-nombre" to={rutaFichaTercero(q.partyId, 'cobro')}>{q.nombre}</Link>
                <span className="cxdo-fila-que">{cadaCuanto(q)}</span>
              </span>
              <span className="cxlq-cuando-dia">{cuandoPaga(q)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Ver una fila: sus cuatro piezas, y resolver la diferencia ───────────────

function VerFila({ f, hosteleria, alCerrar, alResolver, alLlegada }: {
  f: FilaMotor; hosteleria: boolean; alCerrar: () => void
  alResolver: (x: { tipo: 'gasto' | 'reclamacion'; importe: number; frase: string }) => Promise<void>
  alLlegada: (resolucionId: string, importe: number | null) => Promise<void>
}) {
  const dif = f.estado === 'diferencia' ? f.diferencia ?? 0 : 0
  const [tipo, setTipo] = useState<'gasto' | 'reclamacion'>('reclamacion')
  const [frase, setFrase] = useState('')
  const l = f.liquidacion
  const pendientes = f.resoluciones.filter((r) => r.tipo === 'reclamacion' && !r.llegoEl)
  return (
    <Dialogo titulo={`${quienDonde(f)} · ${periodoCorto(f.desde, f.hasta)}`} alCerrar={alCerrar}
      explicacion={f.frase}
      acciones={dif !== 0
        ? <><Boton onClick={alCerrar}>Cerrar</Boton><Boton variante="principal" disabled={!frase.trim()} onClick={() => void alResolver({ tipo, importe: Math.abs(dif), frase })}>Apuntarlo</Boton></>
        : <Boton onClick={alCerrar}>Cerrar</Boton>}>
      <dl className="cxlq-detalle">
        <dt>Lo vendido</dt>
        <dd>{euros(f.vendido.total)}{f.vendido.via === 'pedidos' && f.vendido.pedidos !== null ? ` · ${f.vendido.pedidos} ${f.vendido.pedidos === 1 ? 'pedido' : 'pedidos'}${hosteleria && f.marca ? ` de ${f.marca}` : ''}` : ''}</dd>
        <dt>La liquidación</dt>
        <dd>{l.n === 0 ? 'No ha llegado.' : <>sus pedidos suman {euros(l.pedidosTotal)}{l.ventas !== l.pedidosTotal ? ` (${euros(l.ventas)} a precio de carta, antes de promociones)` : ''} · comisión {euros(l.comision)} · te paga {euros(l.pagan)}{l.referencia ? ' · de antes del cierre, de referencia' : ''}</>}</dd>
        <dt>Su factura</dt>
        <dd>{l.n === 0 ? '—' : f.faltanFacturas > 0 ? `Falta${f.faltanFacturas > 1 ? `n ${f.faltanFacturas}` : ''}: cuando llegue a Compras, se engancha sola.` : 'Está, o no lleva.'}</dd>
        <dt>El cobro</dt>
        <dd>{l.n === 0 ? '—' : f.cobro.llegado !== null ? `Llegaron ${euros(f.cobro.llegado)} al banco` : f.cobro.porCobrar > 0 ? `Esperando ${euros(f.cobro.esperado)}` : 'Nada que cobrar.'}</dd>
      </dl>
      {f.liquidaciones.length > 0 && (
        <ul className="cxlq-liqs">
          {f.liquidaciones.map((x) => <li key={x.id}>{x.tienda ?? 'Sin tienda'}{x.ref ? ` · ${x.ref}` : ''}{x.pedidos !== null ? ` · ${x.pedidos} pedidos` : ''} · te paga {euros(x.neto)}</li>)}
        </ul>
      )}
      {f.resoluciones.map((r) => (
        <p key={r.id} className="s-apoyo">{r.tipo === 'gasto' ? 'Gasto' : 'Reclamado'}: {euros(Math.abs(r.importe))} · «{r.frase}»{r.llegoEl ? ` · llegó el ${ddmm(r.llegoEl)}` : ''}</p>
      ))}
      {pendientes.map((r) => (
        <p key={`l-${r.id}`}><Boton onClick={() => void alLlegada(r.id, Math.abs(r.importe))}>Ha llegado lo reclamado ({euros(Math.abs(r.importe))})</Boton></p>
      ))}
      {dif !== 0 && (
        <fieldset className="cxlq-resolver">
          <legend>¿Qué es esta diferencia de {euros(Math.abs(dif))}?</legend>
          <label className="cxlq-opcion"><input type="radio" name="tipo" checked={tipo === 'reclamacion'} onChange={() => setTipo('reclamacion')} /> Lo reclamo: te lo recuerdo hasta que llegue</label>
          {dif > 0 && <label className="cxlq-opcion"><input type="radio" name="tipo" checked={tipo === 'gasto'} onChange={() => setTipo('gasto')} /> Es un gasto (una devolución a un cliente, un ajuste): va con su asiento</label>}
          <label className="s-campo"><span className="s-campo-etiqueta">En una frase, por qué</span><input className="s-control" value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="Un pedido que Uber pagó y en caja está cancelado" /></label>
        </fieldset>
      )}
    </Dialogo>
  )
}

// ── Pedírsela ───────────────────────────────────────────────────────────────

function PedirFactura({ f, empresa, alCerrar, alPedir }: { f: FilaMotor; empresa: string; alCerrar: () => void; alPedir: (email: string, asunto: string, cuerpo: string) => void }) {
  const que = `${f.marca ? `${f.marca}, ` : ''}${f.local ?? ''}`.replace(/, $/, '')
  const [email, setEmail] = useState('')
  const [asunto, setAsunto] = useState(`Factura de comisiones · ${periodoCorto(f.desde, f.hasta)}`)
  const [cuerpo, setCuerpo] = useState(`Hola:\n\nNos falta la factura de comisiones del ${ddmm(f.desde)} al ${ddmm(f.hasta)}${que ? ` (${que})` : ''}. ¿Nos la podéis mandar?\n\nGracias.\n${empresa}`)
  const vale = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  return (
    <Dialogo titulo={`Pedírsela · ${f.intermediario}`} alCerrar={alCerrar}
      explicacion="Se abre tu correo con el mensaje escrito y lo mandas tú: el envío automático aún no está abierto."
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!vale} onClick={() => alPedir(email.trim(), asunto, cuerpo)}>Abrir el correo</Boton></>}>
      <label className="s-campo"><span className="s-campo-etiqueta">A</span><input className="s-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="facturacion@plataforma.com" /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Asunto</span><input className="s-control" value={asunto} onChange={(e) => setAsunto(e.target.value)} /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Texto</span><textarea className="s-control cxdo-texto" rows={7} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} /></label>
    </Dialogo>
  )
}

// ── Apuntar a mano ──────────────────────────────────────────────────────────

type Apunte = { intermediarioId: string | null; nuevo: string | null; localId: string | null; desde: string; hasta: string; vendido: number; comision: number; cobrado: number; pedidos: number | null; referencia: string | null }
const OTRO = '__otro__'
const numero = (t: string) => { const n = Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }

function ApuntarAMano({ accountId, quienes, hosteleria, hoy, alCerrar, alApuntar }: {
  accountId: string; quienes: Intermediario[]; hosteleria: boolean; hoy: string; alCerrar: () => void; alApuntar: (x: Apunte) => Promise<void>
}) {
  const locales = useLeer(hosteleria ? () => leerLocales(accountId) : null, `${accountId}:locales`)
  const opciones = quienes.filter((q) => hosteleria || !q.canalId)
  const [quien, setQuien] = useState(opciones[0]?.id ?? OTRO)
  const [nuevo, setNuevo] = useState('')
  const [local, setLocal] = useState('')
  const [desde, setDesde] = useState(mesDe(hoy).desde)
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
          {opciones.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
          <option value={OTRO}>Otro (Amazon, Stripe, PayPal, el datáfono…)</option>
        </select>
      </label>
      {quien === OTRO && <label className="s-campo"><span className="s-campo-etiqueta">Su nombre</span><input className="s-control" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Stripe" /></label>}
      {hosteleria && (
        <label className="s-campo"><span className="s-campo-etiqueta">Local (si es de uno)</span>
          <select className="s-control" value={local} onChange={(e) => setLocal(e.target.value)}>
            <option value="">Todos los locales</option>
            {(locales.datos ?? []).map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.abierto ? '' : ' (cerrado)'}</option>)}
          </select>
        </label>
      )}
      <div className="cxlq-dos">
        <label className="s-campo"><span className="s-campo-etiqueta">Desde</span><input className="s-control" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Hasta</span><input className="s-control" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <div className="cxlq-dos">
        <label className="s-campo"><span className="s-campo-etiqueta">Lo vendido (€)</span><input className="s-control s-cifra" inputMode="decimal" value={vendido} onChange={(e) => setVendido(e.target.value)} /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Comisión (€)</span><input className="s-control s-cifra" inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="0" /></label>
      </div>
      <div className="cxlq-dos">
        <label className="s-campo"><span className="s-campo-etiqueta">Te paga (€)</span><input className="s-control s-cifra" inputMode="decimal" value={cobrado} onChange={(e) => setCobrado(e.target.value)} /></label>
        <label className="s-campo"><span className="s-campo-etiqueta">Pedidos (si lo dice)</span><input className="s-control s-cifra" inputMode="numeric" value={pedidos} onChange={(e) => setPedidos(e.target.value)} /></label>
      </div>
      <label className="s-campo"><span className="s-campo-etiqueta">Su referencia (si la tiene)</span><input className="s-control" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
    </Dialogo>
  )
}
