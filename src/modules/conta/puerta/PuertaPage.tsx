// src/modules/conta/puerta/PuertaPage.tsx
//
// V02d · Inicio › Documentos, rehecho para que se venda (tableros 22 y 24,
// aprobados por Julio el 25/10). Sustituye al tablero 19.
//
//   · La banda del mes: «Tienes X de Y documentos que esperas este mes», la
//     barra en tres colores (ya están · se retrasan · aún a tiempo) y «Pedir los
//     N que se retrasan». Mientras el envío automático de correos no esté
//     abierto, el botón lo dice al pulsarlo y no hace como que envía.
//   · «No sé qué es este documento»: una tarjeta por cada uno, con cuatro
//     botones y «Lo mismo la próxima vez que escriba este remitente».
//   · Dos columnas, según quién tiene que hacer algo (lib/documentosMes.ts):
//     «Te lo tienen que mandar» (Pedir) y «Lo tienes que subir tú» (Subir).
//     Se ven 3 filas por columna y «Ver todo» enseña el resto: nada se esconde.
//     «⋯»: «Ya lo tengo» y «No me avises de este».
//   · «Ha llegado esta semana» y «Tu correo de documentos».
//   · En el móvil (tablero 24): la banda compacta, las dos columnas una debajo
//     de otra y, abajo, «Hacer foto o subir».
//
// Lo aprendido que nadie ha tocado se pone al día solo al abrir la pantalla
// (conta_puerta_al_dia). Regla 8: cada botón dice lo que ha hecho, con contenido.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { rutaBancos, rutaDocumentos, rutaLiquidaciones, rutaLiquidacionesVentas, rutaLoteCatcher, rutaQueEsperas, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { QuincenaCatcher } from '@/modules/conta/documentos/QuincenaCatcher'
import { contactoFacturacion, subirFacturas } from '@/modules/conta/services/documentosService'
import { alDia, avisarDe, dimeQueEs, direccionUnica, leerFuentes, leerPuerta, pedirla, subirSinSaber, yaLoTengo } from '@/modules/conta/services/puertaService'
import {
  DONDE, clasificarSubida, correoPedirla, cuandoLlego, necesitaMirarse, queSeEspera,
  type DatosPuerta, type Fuente, type GrupoSubida, type QueEs, type Ultimo,
} from '@/modules/conta/lib/puerta'
import { cabeceraMes, filasDocumentos, nadaEnColumna, primeras, type CabeceraMes, type Columna, type FilaDoc } from '@/modules/conta/lib/documentosMes'
import { dejarFicheros, mirarFicheros, tomarFicheros } from '@/modules/conta/puerta/entregas'

const NOMBRE = MARCA.nombre
const ACEPTA = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.zip,.xlsx,.xls,.csv,.n43,.q43,.c43,.aeb,.txt,.xml,.xsig,application/pdf,image/*'
/** El envío automático de correos. Cerrado mientras no haya dominio de correo: «Pedir» abre el correo de la persona. */
const ENVIO_ABIERTO = false

type Aviso = { texto: ReactNode; tono?: 'falta' | 'duda' }

export default function PuertaPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const hosteleria = useHosteleria()
  const navegar = useNavigate()
  const hoy = hoyEnMadrid()
  const quien = userName ?? null
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [subida, setSubida] = useState<File[] | null>(() => { const fs = mirarFicheros('puerta'); return fs.length ? fs : null })
  const [pidiendo, setPidiendo] = useState<FilaDoc | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const elegir = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)
  const puestaAlDia = useRef<string | null>(null)

  const clave = `${accountId}:${activa?.id}:${vuelta}`
  const puerta = useLeer(activa ? () => leerPuerta(activa.id, 7) : null, clave)
  const fuentes = useLeer(activa ? () => leerFuentes(activa.id) : null, clave)

  // Lo que se soltó en otra pantalla llega aquí, una vez.
  useEffect(() => { tomarFicheros('puerta') }, [])
  // Lo aprendido que nadie ha tocado, al día (una vez por empresa); si cambia algo, se vuelve a leer.
  useEffect(() => {
    if (!activa || puestaAlDia.current === activa.id) return
    puestaAlDia.current = activa.id
    alDia(activa.id).then((cambio) => { if (cambio) setVuelta((v) => v + 1) }, () => null)
  }, [activa])

  const recargar = () => setVuelta((v) => v + 1)
  const conAviso = async (hacer: () => Promise<ReactNode>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ texto: await hacer() }); recargar() } catch (e) { setAviso({ texto: e instanceof Error ? e.message : String(e), tono: 'falta' }) } finally { setOcupado(false) }
  }

  const principal = <Boton variante="principal" tecla="U" onClick={() => elegir.current?.click()}>Subir documentos</Boton>
  const mas: GrupoDeAcciones[] = [{
    titulo: 'Documentos',
    acciones: [
      { id: 'esperas', etiqueta: 'Qué esperas cada mes', dato: 'Lo que te tiene que llegar, cada cuánto y de qué local', alPulsar: () => navegar(rutaQueEsperas()), grupo: '' },
      ...(movil ? [{ id: 'foto', etiqueta: 'Hacer una foto', dato: 'Abre la cámara del móvil', alPulsar: () => camara.current?.click(), grupo: '' }] : []),
    ],
  }]
  const encabezado = (
    <EncabezadoPagina titulo="Documentos" frase="Todo lo que te llega se coloca solo. Aquí solo ves lo que necesita algo de ti."
      principal={movil ? undefined : principal} masAcciones={activa ? mas : []} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus documentos.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí entra todo lo suyo.</p></div>

  const p = puerta.datos
  const d = fuentes.datos
  const cab = d ? cabeceraMes(d, hoy) : null
  const filas = d ? filasDocumentos(d, hoy) : null
  const porPedir = filas?.mandar.filter((x) => x.dias > 0) ?? []
  const noSe = (p?.ultimos ?? []).filter(necesitaMirarse)
  const direccion = p?.direcciones.find((x) => x.tipo === 'documentos') ?? null
  const fuentesDe = (x: FilaDoc): Fuente[] => (d?.fuentes ?? []).filter((f) => x.fuentes.some((y) => y.id === f.id))

  const alElegir = (fs: FileList | null) => { const a = Array.from(fs ?? []); if (a.length) setSubida(a); if (elegir.current) elegir.current.value = ''; if (camara.current) camara.current.value = '' }
  const pedirTodos = () => {
    const nombres = porPedir.map((x) => x.nombre)
    setAviso(ENVIO_ABIERTO ? null : {
      tono: 'duda',
      texto: <>El envío automático de correos aún no está abierto: <strong>no he mandado nada</strong>. Pídeselos uno a uno con «Pedir»: se abre tu correo con el mensaje ya escrito. {nombres.length === 1 ? 'Es' : `Son ${nombres.length}`}: {lista(nombres)}.</>,
    })
  }

  return (
    <div className="s-pagina cxdo" data-movil={movil || undefined}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { const fs = Array.from(e.dataTransfer.files ?? []); if (fs.length) { e.preventDefault(); setSubida(fs) } }}>
      {encabezado}
      <input ref={elegir} type="file" multiple accept={ACEPTA} className="s-oculto" aria-label="Elegir los documentos" onChange={(e) => alElegir(e.target.files)} />
      <input ref={camara} type="file" accept="image/*,application/pdf" capture="environment" className="s-oculto" aria-label="Hacer una foto" onChange={(e) => alElegir(e.target.files)} />

      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono ? 'alert' : 'status'} data-prueba="puerta-aviso">{aviso.texto}</p>}
      {(puerta.error || fuentes.error) && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer tus documentos: {puerta.error ?? fuentes.error} <button type="button" className="s-boton s-boton-enlace" onClick={recargar}>Reintentar</button></p>
      )}

      {subida && accountId && (
        <Subida ficheros={subida} accountId={accountId} companyId={activa.id} quien={quien}
          alTerminar={() => recargar()} alCerrar={() => setSubida(null)}
          aBancos={(f) => { dejarFicheros('bancos', [f]); navegar(rutaBancos('subir')) }} />
      )}

      <BandaMes cab={cab} apagado={d?.ajustes.lo_que_falta === false} nPedir={porPedir.length} movil={movil} alPedir={pedirTodos} />

      {noSe.map((u) => (
        <NoSeQueEs key={u.id} u={u} hoy={hoy} ocupado={ocupado}
          alDecir={(tipo, recordar) => void conAviso(() => dimeQueEs(u.id, tipo, recordar, quien))} />
      ))}

      <div className="cxdo-columnas">
        <ColumnaDocs columna="mandar" titulo="Te lo tienen que mandar" frase="Proveedores, gestoría y suministros. Un clic y se lo pedimos."
          filas={filas?.mandar ?? null} movil={movil} ocupado={ocupado}
          alBoton={(x) => setPidiendo(x)}
          alYaLoTengo={(x) => void conAviso(async () => { await yaLoTengo(x.fuentes, quien); return <>Apuntado: ya tienes <strong>{x.nombre}</strong> · {x.que.toLowerCase()}. Deja de avisar.</> })}
          alNoAvisar={(x) => void conAviso(async () => { await avisarDe(activa.id, x.fuentes.map((y) => y.id), false, quien); return <><strong>{x.nombre}</strong> ya no avisa. Lo vuelves a encender en «<Link to={rutaQueEsperas()}>Qué esperas cada mes</Link>».</> })} />
        <ColumnaDocs columna="subir" titulo="Lo tienes que subir tú" frase="Cosas que solo puedes descargar tú: portales y banco."
          filas={filas?.subir ?? null} movil={movil} ocupado={ocupado}
          alBoton={() => elegir.current?.click()}
          alYaLoTengo={(x) => void conAviso(async () => { await yaLoTengo(x.fuentes, quien); return <>Apuntado: ya tienes <strong>{x.nombre}</strong> · {x.que.toLowerCase()}. Deja de avisar.</> })}
          alNoAvisar={(x) => void conAviso(async () => { await avisarDe(activa.id, x.fuentes.map((y) => y.id), false, quien); return <><strong>{x.nombre}</strong> ya no avisa. Lo vuelves a encender en «<Link to={rutaQueEsperas()}>Qué esperas cada mes</Link>».</> })}
          pie={filas && filas.subir.some((x) => x.familia === 'banco') && p && p.conectados.bancos.length === 0
            ? <p className="cxdo-truco"><strong>Truco:</strong> conecta el banco y {NOMBRE} trae los movimientos solo. <Link to={rutaBancos()}>Conectar {bancoDe(filas.subir)}</Link></p>
            : null} />
      </div>

      {!movil && (
        <div className="cxdo-abajo">
          <HaLlegado p={p} hoy={hoy} hosteleria={hosteleria} />
          <TuCorreo p={p} direccion={direccion?.direccion ?? null} encendida={direccion?.activa ?? false} ocupado={ocupado}
            alCrear={() => void conAviso(() => direccionUnica(activa.id, quien).then((r) => <>Tu dirección es <strong>{r.direccion}</strong>{r.yaEstaba ? ' (ya la tenías)' : ''}. Reenvía ahí lo que te manden: {NOMBRE} lo lleva a su sitio.</>))}
            alCopiar={(t) => void navigator.clipboard?.writeText(t).then(() => setAviso({ texto: <>Copiada: <strong>{t}</strong>. Pégala en tus proveedores o en el reenvío de tu correo.</> }), () => setAviso({ texto: `No se ha podido copiar: selecciónala y cópiala a mano (${t}).`, tono: 'duda' }))} />
        </div>
      )}

      {pidiendo && (
        <Pedir fila={pidiendo} fuentes={fuentesDe(pidiendo)} empresa={activa.razonSocial || activa.nombre || 'Tu empresa'} direccion={direccion?.activa ? direccion.direccion : null}
          alCerrar={() => setPidiendo(null)}
          alPedir={async (f, dia, email, asunto, cuerpo) => {
            const r = await pedirla(f.id, dia, email, asunto, cuerpo, quien)
            window.location.href = r.mailto
            return r.yaEstaba
              ? `Ya estaba pedida este mes a ${email}. Se abre tu correo por si quieres volver a mandarla.`
              : `Apuntado que se la pides a ${email}. Se abre tu correo con el mensaje escrito y la mandas tú: el envío automático aún no está abierto.`
          }}
          alTerminar={(textos) => { setPidiendo(null); if (textos.length) { setAviso({ texto: textos.join(' ') }); recargar() } }} />
      )}

      <BotonPulgar><Boton variante="principal" ancho onClick={() => elegir.current?.click()}>Hacer foto o subir</Boton></BotonPulgar>
    </div>
  )
}

const lista = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
const bancoDe = (xs: readonly FilaDoc[]) => xs.find((x) => x.familia === 'banco')?.nombre.split(/\s+/)[0] ?? 'tu banco'

// ── La banda del mes ────────────────────────────────────────────────────────

function BandaMes({ cab, apagado, nPedir, movil, alPedir }: { cab: CabeceraMes | null; apagado: boolean; nPedir: number; movil: boolean; alPedir: () => void }) {
  if (!cab) return <section className="cxdo-banda" aria-busy="true" aria-label="Este mes"><p className="cxdo-banda-mes">Este mes</p></section>
  const pct = (n: number) => (cab.total ? `${(100 * n) / cab.total}%` : '0%')
  const boton = nPedir > 0 && (
    <button type="button" className="cxdo-banda-boton" onClick={alPedir}>{nPedir === 1 ? 'Pedir el que se retrasa' : `Pedir los ${nPedir} que se retrasan`}</button>
  )
  return (
    <section className="cxdo-banda" aria-label={`Documentos de ${cab.mes}`} data-prueba="banda-mes">
      <div className="cxdo-banda-cuerpo">
        <p className="cxdo-banda-mes">{cab.mes}</p>
        {apagado
          ? <h2 className="cxdo-banda-titulo">El aviso de lo que se retrasa está apagado</h2>
          : <h2 className="cxdo-banda-titulo">{movil ? `${cab.ya} de ${cab.total} documentos` : `Tienes ${cab.ya} de ${cab.total} documentos que esperas este mes`}</h2>}
        <div className="cxdo-barra" role="img" aria-label={`${cab.ya} ya están, ${cab.retrasan} se retrasan y ${cab.aTiempo} aún a tiempo`}>
          <span className="cxdo-barra-ya" style={{ width: pct(cab.ya) }} />
          <span className="cxdo-barra-tarde" style={{ width: pct(cab.retrasan) }} />
          <span className="cxdo-barra-tiempo" style={{ width: pct(cab.aTiempo) }} />
        </div>
        {movil
          ? <p className="cxdo-leyenda-corta">{cab.retrasan} se retrasan · {cab.aTiempo} aún a tiempo</p>
          : (
            <ul className="cxdo-leyenda">
              <li data-tono="ya"><strong>{cab.ya}</strong> ya están, en su sitio</li>
              <li data-tono="tarde"><strong>{cab.retrasan}</strong> se retrasan</li>
              <li data-tono="tiempo"><strong>{cab.aTiempo}</strong> aún a tiempo</li>
            </ul>
          )}
      </div>
      {boton && (
        <div className="cxdo-banda-pedir">
          {boton}
          {!movil && <p className="cxdo-banda-nota">Un correo amable a cada uno, en tu nombre y con lo que falta. Tú no escribes nada.</p>}
        </div>
      )}
    </section>
  )
}

// ── «No sé qué es este documento» ──────────────────────────────────────────

const BOTONES_NO_SE: { tipo: QueEs; etiqueta: string }[] = [
  { tipo: 'factura', etiqueta: 'Factura de gasto' }, { tipo: 'extracto', etiqueta: 'Extracto del banco' },
  { tipo: 'nomina', etiqueta: 'Nómina' }, { tipo: 'otro', etiqueta: 'Otra cosa' },
]
const extension = (n: string | null | undefined) => (n?.match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? 'doc').toUpperCase()
/** «hoy a las 10:02», «ayer a las 19:05», «el 22/10 a las 10:02». */
const cuandoFrase = (ts: string, hoy: string) => cuandoLlego(ts, hoy).replace(/^(hoy|ayer) /, '$1 a las ').replace(/^(\d\d\/\d\d) /, 'el $1 a las ')

function NoSeQueEs({ u, hoy, ocupado, alDecir }: { u: Ultimo; hoy: string; ocupado: boolean; alDecir: (t: QueEs, recordar: boolean) => void }) {
  const remitente = u.por === 'correo' && !!u.de
  const [recordar, setRecordar] = useState(true)
  const como = u.por === 'correo' ? 'llegó por correo' : u.por === 'subido' ? 'lo subiste' : 'llegó'
  return (
    <section className="cxdo-nose" aria-label="No sé qué es este documento" data-prueba="no-se-que-es">
      <div className="cxdo-nose-fila">
        <span className="cxdo-miniatura" aria-hidden="true">{extension(u.nombre)}</span>
        <div className="cxdo-nose-texto">
          <p className="cxdo-nose-titulo">No sé qué es este documento</p>
          <p className="cxdo-nose-dato">{u.nombre ?? 'Sin nombre'} · {como} {cuandoFrase(u.cuando, hoy)}{u.de ? ` · de ${u.de}` : ''}</p>
        </div>
        <div className="cxdo-nose-botones">
          {BOTONES_NO_SE.map((b) => (
            <button key={b.tipo} type="button" className="cxdo-boton-blanco" disabled={ocupado} onClick={() => alDecir(b.tipo, remitente && recordar)}>{b.etiqueta}</button>
          ))}
        </div>
      </div>
      {remitente && (
        <label className="cxdo-nose-recordar">
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} /> Lo mismo la próxima vez que escriba este remitente
        </label>
      )}
    </section>
  )
}

// ── Las dos columnas ────────────────────────────────────────────────────────

function ColumnaDocs({ columna, titulo, frase, filas, movil, ocupado, alBoton, alYaLoTengo, alNoAvisar, pie }: {
  columna: Columna; titulo: string; frase: string; filas: FilaDoc[] | null; movil: boolean; ocupado: boolean
  alBoton: (x: FilaDoc) => void; alYaLoTengo: (x: FilaDoc) => void; alNoAvisar: (x: FilaDoc) => void; pie?: ReactNode
}) {
  const [todo, setTodo] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const p = filas ? primeras(filas) : null
  const vistas = !filas ? [] : todo ? filas : p!.vistas
  return (
    <section className="cxdo-columna" aria-label={titulo} data-columna={columna}>
      <header className="cxdo-columna-cabeza">
        <h2 className="cxdo-columna-titulo">{titulo}</h2>
        {!movil && <p className="cxdo-columna-frase">{frase}</p>}
      </header>
      {!filas && <div className="s-lista-cargando" aria-busy="true" aria-label={`Leyendo «${titulo}»`} />}
      {filas && filas.length === 0 && <p className="cxdo-vacio">{nadaEnColumna(columna)}</p>}
      {vistas.length > 0 && (
        <ul className="cxdo-filas">
          {vistas.map((x) => (
            <li key={x.clave} className="cxdo-fila" data-prueba="fila-doc">
              <span className="cxdo-inicial" data-color={colorDe(x.nombre)} aria-hidden="true">{x.inicial}</span>
              <span className="cxdo-fila-texto">
                <span className="cxdo-fila-nombre">{x.nombre}</span>
                <span className="cxdo-fila-que">{x.que}</span>
                {movil && <span className="cxdo-aviso" data-tono={x.aviso.tono}>{x.aviso.texto}</span>}
              </span>
              {!movil && <span className="cxdo-aviso" data-tono={x.aviso.tono}>{x.aviso.texto}</span>}
              <button type="button" className={columna === 'mandar' ? 'cxdo-boton-blanco' : 'cxdo-boton-azul'} disabled={ocupado} onClick={() => alBoton(x)}>
                {columna === 'mandar' ? 'Pedir' : x.familia === 'banco' ? 'Subir' : 'Subirla'}
              </button>
              {!movil && (
                <span className="cxdo-mas" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(null) }}>
                  <button type="button" className="cxdo-mas-boton" aria-label={`Más de ${x.nombre}`} aria-expanded={menu === x.clave} onClick={() => setMenu(menu === x.clave ? null : x.clave)}>⋯</button>
                  {menu === x.clave && (
                    <span className="cxdo-mas-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMenu(null); alYaLoTengo(x) }}>Ya lo tengo</button>
                      <button type="button" role="menuitem" onClick={() => { setMenu(null); alNoAvisar(x) }}>No me avises de este</button>
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {p && p.resto > 0 && (
        <p className="cxdo-columna-pie">
          {todo ? <span /> : <span>{p.texto}</span>}
          <button type="button" className="cxdo-enlace" onClick={() => setTodo(!todo)}>{todo ? 'Ver menos' : 'Ver todo'}</button>
        </p>
      )}
      {pie}
    </section>
  )
}

/** El color del círculo: siempre el mismo para el mismo nombre. */
const colorDe = (n: string) => String([...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6)

// ── Ha llegado esta semana ──────────────────────────────────────────────────

const ICONO: Record<QueEs, string> = { factura: 'F', ticket: 'T', liquidacion: '€', extracto: '⇄', nomina: 'N', riders: 'R', otro: '·' }
const QUE_CORTO: Record<QueEs, string> = { factura: 'factura', ticket: 'ticket', liquidacion: 'liquidación', extracto: 'movimientos', nomina: 'nómina', riders: 'facturas de los riders', otro: 'documento' }

function HaLlegado({ p, hoy, hosteleria }: { p: DatosPuerta | null; hoy: string; hosteleria: boolean }) {
  const [todo, setTodo] = useState(false)
  const us = useMemo(() => (p?.ultimos ?? []).filter((u) => u.cuando.slice(0, 10) >= sumar(hoy, -6)), [p, hoy])
  const colocados = us.filter((u) => u.donde !== null).length
  const vistas = todo ? us : us.slice(0, 4)
  return (
    <section className="cxdo-tarjeta" aria-label="Ha llegado esta semana">
      <header className="cxdo-columna-cabeza">
        <h2 className="cxdo-columna-titulo">Ha llegado esta semana</h2>
        <p className="cxdo-columna-frase">
          {!p ? 'Leyendo…' : us.length === 0 ? 'Nada todavía esta semana.'
            : `${us.length} ${us.length === 1 ? 'documento' : 'documentos'}, ${colocados === us.length ? (us.length === 1 ? 'colocado' : 'todos colocados') : `${colocados} colocados`}. ${todo ? 'Todos:' : 'Estos son los últimos.'}`}
        </p>
      </header>
      {vistas.length > 0 && (
        <ul className="cxdo-filas">
          {vistas.map((u) => (
            <li key={`${u.fuente}:${u.id}`} className="cxdo-llegada">
              <span className="cxdo-icono" aria-hidden="true">{u.que ? ICONO[u.que] : '?'}</span>
              <span className="cxdo-llegada-texto"><strong>{u.de ?? u.nombre ?? 'Sin remitente'}</strong> · {u.que ? QUE_CORTO[u.que] : 'sin saber qué es'}{u.facturas ? ` · ${u.facturas} facturas` : ''}</span>
              <span className="cxdo-importe s-cifra">{u.importe == null ? '—' : eurosExactos(u.importe)}</span>
              <DondeQuedo u={u} hosteleria={hosteleria} />
            </li>
          ))}
        </ul>
      )}
      {us.length > 4 && <p className="cxdo-columna-pie"><button type="button" className="cxdo-enlace" onClick={() => setTodo(!todo)}>{todo ? 'Ver menos' : `Ver los ${us.length}`}</button></p>}
    </section>
  )
}
const sumar = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

function DondeQuedo({ u, hosteleria }: { u: Ultimo; hosteleria: boolean }) {
  if (!u.donde) return <span className="cxdo-donde" data-tono="duda">{u.estado === 'repetida' ? 'repetido' : 'por mirar'}</span>
  const a = u.donde === 'factura' ? (u.factura_id ? rutaRevisarFactura(u.factura_id) : rutaDocumentos())
    : u.donde === 'bancos' ? rutaBancos()
      : u.donde === 'liquidaciones' ? (hosteleria ? rutaLiquidacionesVentas() : rutaLiquidaciones())
        : u.donde === 'riders' ? (u.fuente === 'catcher' ? rutaLoteCatcher(u.id) : rutaLiquidaciones())
          : null
  const texto = <>✓ en {DONDE[u.donde]}</>
  return a ? <Link to={a} className="cxdo-donde">{texto}</Link> : <span className="cxdo-donde">{texto}</span>
}

// ── Tu correo de documentos ─────────────────────────────────────────────────

function TuCorreo({ p, direccion, encendida, ocupado, alCrear, alCopiar }: {
  p: DatosPuerta | null; direccion: string | null; encendida: boolean; ocupado: boolean; alCrear: () => void; alCopiar: (t: string) => void
}) {
  const marcas = [
    ...(p?.conectados.uber_por_correo ? ['Uber Eats manda solo sus liquidaciones'] : []),
    ...(p?.conectados.bancos ?? []).slice(0, 1).map((b) => `${b.proveedor} trae sus movimientos solo`),
    'Arrastra un fichero a cualquier pantalla',
    'Haz una foto con el móvil',
  ].slice(0, 3)
  return (
    <section className="cxdo-tarjeta" aria-label="Tu correo de documentos">
      <header className="cxdo-columna-cabeza"><h2 className="cxdo-columna-titulo">Tu correo de documentos</h2></header>
      <div className="cxdo-correo-cuerpo">
        {direccion ? (
          <div className="cxdo-correo">
            <strong className="cxdo-correo-dir" data-prueba="direccion-documentos">{direccion}</strong>
            <button type="button" className="cxdo-boton-blanco" onClick={() => alCopiar(direccion)}>Copiar</button>
          </div>
        ) : (
          <div className="cxdo-correo"><span className="cxdo-correo-dir">Aún no tienes tu dirección</span><button type="button" className="cxdo-boton-blanco" disabled={ocupado || !p} onClick={alCrear}>Crear tu dirección</button></div>
        )}
        <p className="cxdo-correo-nota">Dáselo a tus proveedores o reenvía aquí lo que te mandan. Facturas, liquidaciones, extractos o nóminas: {NOMBRE} sabe qué es cada cosa.</p>
        {direccion && !encendida
          ? <p className="cxdo-apagada" data-prueba="direccion-apagada">Apagada: aún no recibe correos.</p>
          : <ul className="cxdo-marcas">{marcas.map((m) => <li key={m}>{m}</li>)}</ul>}
      </div>
    </section>
  )
}

// ── Subir ───────────────────────────────────────────────────────────────────

/** Lo que se ha soltado o elegido: qué es cada cosa y su camino de siempre. */
function Subida({ ficheros, accountId, companyId, quien, alTerminar, alCerrar, aBancos }: {
  ficheros: File[]; accountId: string; companyId: string; quien: string | null
  alTerminar: () => void; alCerrar: () => void; aBancos: (f: File) => void
}) {
  const [grupos, setGrupos] = useState<GrupoSubida[] | null>(null)
  const [hechos, setHechos] = useState<{ texto: string; bien: boolean }[]>([])
  const [subiendo, setSubiendo] = useState(false)
  useEffect(() => {
    let vivo = true
    void Promise.all(ficheros.map(async (f) => ({ nombre: f.name, tipo: f.type, bytes: /\.zip$/i.test(f.name) ? new Uint8Array(await f.arrayBuffer()) : null })))
      .then((xs) => { if (vivo) setGrupos(clasificarSubida(xs)) })
    return () => { vivo = false }
  }, [ficheros])
  const de = (g: GrupoSubida) => g.ficheros.map((x) => ficheros[x.i])
  const llevar = async () => {
    if (!grupos) return
    setSubiendo(true)
    const out: { texto: string; bien: boolean }[] = []
    for (const g of grupos) {
      if (g.camino === 'facturas') {
        for (const s of await subirFacturas(accountId, companyId, de(g), quien)) out.push({ texto: s.texto, bien: s.bien })
      } else if (g.camino === 'sin_saber') {
        for (const f of de(g)) {
          try { out.push({ texto: (await subirSinSaber(accountId, companyId, f, quien)).texto, bien: true }) } catch (e) { out.push({ texto: e instanceof Error ? e.message : String(e), bien: false }) }
        }
      }
    }
    setHechos(out); setSubiendo(false)
    alTerminar()
  }
  const automaticos = grupos?.filter((g) => g.camino === 'facturas' || g.camino === 'sin_saber') ?? []
  return (
    <Tarjeta titulo="Subir documentos" apoyo={`${ficheros.length} ${ficheros.length === 1 ? 'fichero' : 'ficheros'}: cada uno va a su sitio.`}
      accion={<Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton>}>
      {!grupos && <p className="s-apoyo" aria-busy="true">Mirando qué es cada cosa…</p>}
      {grupos && (
        <ul className="cxdo-grupos" data-prueba="puerta-grupos">
          {grupos.map((g) => (
            <li key={g.camino}>
              <p><strong>{g.texto}</strong> <span className="s-tarjeta-apoyo">{g.ficheros.map((x) => x.nombre).join(' · ')}</span></p>
              {g.camino === 'catcher' && <QuincenaCatcher accountId={accountId} companyId={companyId} quien={quien} iniciales={de(g)} alSubir={() => alTerminar()} />}
              {g.camino === 'extracto' && de(g).map((f) => <Boton key={f.name} variante="secundario" onClick={() => aBancos(f)}>Importar «{f.name}» en Bancos</Boton>)}
            </li>
          ))}
        </ul>
      )}
      {automaticos.length > 0 && hechos.length === 0 && (
        <Boton variante="principal" disabled={subiendo} onClick={() => void llevar()}>{subiendo ? 'Llevándolos a su sitio…' : 'Llevarlos a su sitio'}</Boton>
      )}
      {hechos.length > 0 && (
        <ul className="cxdo-hechos" role="status" data-prueba="puerta-hechos">
          {hechos.map((h, i) => <li key={i} data-tono={h.bien ? undefined : 'falta'}>{h.texto}</li>)}
        </ul>
      )}
    </Tarjeta>
  )
}

// ── Pedir ───────────────────────────────────────────────────────────────────

/**
 * «Pedir» una fila: el correo propuesto a cada fuente de la fila (un alquiler
 * de tres personas son tres correos), que la persona revisa y manda desde el
 * suyo. Queda apuntado que lo ha pedido; dice a quién.
 */
function Pedir({ fila, fuentes, empresa, direccion, alCerrar, alPedir, alTerminar }: {
  fila: FilaDoc; fuentes: Fuente[]; empresa: string; direccion: string | null; alCerrar: () => void
  alPedir: (f: Fuente, dia: string, email: string, asunto: string, cuerpo: string) => Promise<string>
  alTerminar: (textos: string[]) => void
}) {
  const [i, setI] = useState(0)
  const [hechos, setHechos] = useState<string[]>([])
  const f = fuentes[i] ?? null
  if (!f) return null
  const dia = fila.fuentes.find((y) => y.id === f.id)?.dia ?? fila.hacia
  const que = fuentes.length > 1 ? queSeEspera(f, { dia, desde: null, hasta: null }) : fila.que
  const siguiente = (texto: string | null) => {
    const hs = texto ? [...hechos, texto] : hechos
    setHechos(hs)
    if (i + 1 < fuentes.length) setI(i + 1); else alTerminar(hs)
  }
  return (
    <PedirUno key={f.id} f={f} titulo={fila.nombre} cuenta={fuentes.length > 1 ? `${i + 1} de ${fuentes.length}. ` : ''} varias={fuentes.length > 1}
      propuesto={correoPedirla({ empresa, que, hacia: dia, direccion })}
      alCerrar={() => (hechos.length ? alTerminar(hechos) : alCerrar())}
      alSaltar={() => siguiente(null)}
      alPedir={(email, asunto, cuerpo) => alPedir(f, dia, email, asunto, cuerpo).then(siguiente)} />
  )
}

function PedirUno({ f, titulo, cuenta, varias, propuesto, alCerrar, alSaltar, alPedir }: {
  f: Fuente; titulo: string; cuenta: string; varias: boolean; propuesto: { asunto: string; cuerpo: string }
  alCerrar: () => void; alSaltar: () => void; alPedir: (email: string, asunto: string, cuerpo: string) => Promise<void>
}) {
  const [email, setEmail] = useState(f.correo ?? f.pedida?.a ?? '')
  const [asunto, setAsunto] = useState(propuesto.asunto)
  const [cuerpo, setCuerpo] = useState(propuesto.cuerpo)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (f.correo || f.pedida?.a || !f.proveedor_id) return
    let vivo = true
    contactoFacturacion(f.proveedor_id).then((c) => { if (vivo && c) setEmail(c.email) }, () => null)
    return () => { vivo = false }
  }, [f])
  const vale = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  return (
    <Dialogo titulo={`Pedir · ${titulo}`}
      explicacion={<>{cuenta}Revisa el correo: se abre en el tuyo y lo mandas tú. Queda apuntado que lo has pedido.</>}
      alCerrar={alCerrar}
      acciones={<>
        {varias && <Boton onClick={alSaltar}>Saltar</Boton>}
        <Boton onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!vale} onClick={() => void alPedir(email.trim(), asunto, cuerpo).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}>Abrir el correo</Boton>
      </>}>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
      <label className="s-campo"><span className="s-campo-etiqueta">A</span><input className="s-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="facturacion@proveedor.es" /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Asunto</span><input className="s-control" value={asunto} onChange={(e) => setAsunto(e.target.value)} /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Texto</span><textarea className="s-control cxdo-texto" rows={8} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} /></label>
    </Dialogo>
  )
}
