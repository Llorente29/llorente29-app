// src/modules/conta/puerta/PuertaPage.tsx
//
// V02 · Entrega 1 · LA PUERTA: Inicio › Documentos (tablero 19, aprobado por
// Julio el 25/10). Todo lo que entra en la empresa, por un solo sitio:
//
//   · Arriba, las cuatro cifras: lo que ha llegado esta semana, lo que necesita
//     que lo mires, lo que falta y ya debería estar, y lo que está por llegar.
//   · «Lo que falta»: el calendario de cada fuente (lib/puerta.ts), con «aún a
//     tiempo» o «N días tarde», «Subirla» y «Pedírsela» (el correo propuesto,
//     que se revisa y manda la persona desde el suyo). Se apaga por empresa y
//     por fuente. Sin fuentes todavía: «Aprenderlo de lo que ya pasa».
//   · Lo último, en tres pestañas (Lo último · Necesita que lo mires ·
//     Colocado): por dónde llegó, qué es, de quién, importe y dónde está. Lo
//     que no se reconoce, con «Dime qué es», que aprende el remitente.
//   · «Cómo te llegan los documentos»: la dirección única (con Copiar), el
//     móvil, arrastrar en cualquier pantalla y lo conectado.
//   · «Subir documentos» (el único principal): cada fichero va por su camino de
//     siempre — la factura a Compras, la quincena de Catcher a sus facturas, el
//     extracto a Bancos — y lo que no se sabe se queda aquí para «Dime qué es».
//     En el móvil, «Hacer una foto» abre la cámara.
//
// Regla 8: cada botón dice lo que ha hecho, con contenido. Regla 7: el aviso
// apagado no esconde nada que exista: la pestaña «Lo último» lo enseña todo.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaBancos, rutaDocumentos, rutaLiquidaciones, rutaLiquidacionesVentas, rutaLoteCatcher, rutaPuerta, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Chip, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import { PestanasEstado } from '@/modules/conta/diseno/plantillas'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { QuincenaCatcher } from '@/modules/conta/documentos/QuincenaCatcher'
import { contactoFacturacion, subirFacturas } from '@/modules/conta/services/documentosService'
import {
  aprenderFuentes, apagarFuente, dimeQueEs, direccionUnica, leerFuentes, leerPuerta, pedirla, ponerAjustes, ponerLocal, subirSinSaber,
} from '@/modules/conta/services/puertaService'
import {
  DONDE, ETIQUETA_QUE, POR, TONO_QUE, cifrasPuerta, clasificarSubida, correoPedirla, cuandoLlego, ddmm, deLaPestana, loQueFalta, necesitaMirarse,
  nombreDelLocal, type DatosFuentes, type DatosPuerta, type FilaFalta, type Fuente, type Local, type GrupoSubida, type PestanaPuerta, type QueEs, type Ultimo,
} from '@/modules/conta/lib/puerta'
import { dejarFicheros, mirarFicheros, tomarFicheros } from '@/modules/conta/puerta/entregas'

const NOMBRE = MARCA.nombre
const ACEPTA = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.zip,.xlsx,.xls,.csv,.n43,.q43,.c43,.aeb,.txt,.xml,.xsig,application/pdf,image/*'
const TIPOS_DIME: QueEs[] = ['factura', 'ticket', 'liquidacion', 'extracto', 'nomina', 'riders', 'otro']

export default function PuertaPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const hosteleria = useHosteleria()
  const navegar = useNavigate()
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<{ texto: ReactNode; tono?: 'falta' | 'duda' } | null>(null)
  const [subida, setSubida] = useState<File[] | null>(() => { const fs = mirarFicheros('puerta'); return fs.length ? fs : null })
  const [dime, setDime] = useState<Ultimo | null>(null)
  const [pidiendo, setPidiendo] = useState<FilaFalta | null>(null)
  const [ajustes, setAjustes] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const elegir = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)

  const clave = `${accountId}:${activa?.id}:${vuelta}`
  const puerta = useLeer(activa ? () => leerPuerta(activa.id) : null, clave)
  const fuentes = useLeer(activa ? () => leerFuentes(activa.id) : null, clave)
  const pestana: PestanaPuerta = query.get('ver') === 'mirar' ? 'mirar' : query.get('ver') === 'colocado' ? 'colocado' : 'ultimo'

  // Lo que se soltó en otra pantalla llega aquí, una vez (se mira al abrir y se vacía el buzón).
  useEffect(() => { tomarFicheros('puerta') }, [])

  const recargar = () => setVuelta((v) => v + 1)
  const conAviso = async (hacer: () => Promise<ReactNode>) => {
    setOcupado(true); setAviso(null)
    try { setAviso({ texto: await hacer() }); recargar() } catch (e) { setAviso({ texto: e instanceof Error ? e.message : String(e), tono: 'falta' }) } finally { setOcupado(false) }
  }

  const principal = <Boton variante="principal" icono="subir" tecla="U" onClick={() => elegir.current?.click()}>Subir documentos</Boton>
  const mas: GrupoDeAcciones[] = [{
    titulo: 'La puerta',
    acciones: [
      ...(movil ? [{ id: 'foto', etiqueta: 'Hacer una foto', dato: 'Abre la cámara del móvil', alPulsar: () => camara.current?.click(), grupo: '' }] : []),
      { id: 'aprender', etiqueta: 'Aprender lo que te tiene que llegar', dato: 'De tus facturas, liquidaciones, extractos y nóminas de los últimos meses', alPulsar: () => void conAviso(() => aprenderFuentes(activa!.id, userName ?? null).then((r) => r.texto)), grupo: '' },
      { id: 'ajustes', etiqueta: 'Ajustes de «Lo que falta»', dato: 'Encenderlo o apagarlo, el margen y cada fuente', alPulsar: () => setAjustes(true), grupo: '' },
    ],
  }]
  const encabezado = (
    <EncabezadoPagina titulo="Documentos"
      frase={`Todo lo que entra en tu empresa, por una sola puerta. ${NOMBRE} reconoce qué es cada cosa y la lleva a su sitio; aquí solo te pide lo que necesita una decisión tuya.`}
      principal={principal} masAcciones={activa ? mas : []} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus documentos.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí entra todo lo suyo.</p></div>

  const p = puerta.datos
  const d = fuentes.datos
  const c = p ? cifrasPuerta(p, d, hoy) : null
  const falta = d ? loQueFalta(d, hoy) : []
  const direccion = p?.direcciones.find((x) => x.tipo === 'documentos') ?? null

  const alElegir = (fs: FileList | null) => { const a = Array.from(fs ?? []); if (a.length) setSubida(a); if (elegir.current) elegir.current.value = ''; if (camara.current) camara.current.value = '' }

  return (
    <div className="s-pagina cxpu-puerta"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { const fs = Array.from(e.dataTransfer.files ?? []); if (fs.length) { e.preventDefault(); setSubida(fs) } }}>
      {encabezado}
      <input ref={elegir} type="file" multiple accept={ACEPTA} className="s-oculto" aria-label="Elegir los documentos" onChange={(e) => alElegir(e.target.files)} />
      <input ref={camara} type="file" accept="image/*,application/pdf" capture="environment" className="s-oculto" aria-label="Hacer una foto" onChange={(e) => alElegir(e.target.files)} />

      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono ? 'alert' : 'status'} data-prueba="puerta-aviso">{aviso.texto}</p>}
      {(puerta.error || fuentes.error) && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer la puerta: {puerta.error ?? fuentes.error} <button type="button" className="s-boton s-boton-enlace" onClick={recargar}>Reintentar</button></p>
      )}

      {subida && accountId && (
        <Subida ficheros={subida} accountId={accountId} companyId={activa.id} quien={userName ?? null}
          alTerminar={(texto) => { if (texto) setAviso({ texto }); recargar() }}
          alCerrar={() => setSubida(null)}
          aBancos={(f) => { dejarFicheros('bancos', [f]); navegar(rutaBancos('subir')) }} />
      )}

      {/* Las cuatro cifras de arriba. */}
      <div className="cxpu-cifras" aria-busy={!c}>
        <Cifra etiqueta="Ha llegado esta semana" n={c?.llegado.n} apoyo={c?.llegado.apoyo} />
        <Cifra etiqueta="Necesita que lo mires" n={c?.mirar.n} apoyo={c?.mirar.apoyo} tono={c && c.mirar.n > 0 ? 'duda' : undefined} a={rutaPuerta('mirar')} />
        <Cifra etiqueta="Falta y ya debería estar" n={c?.falta.n} apoyo={c?.falta.apoyo} tono={c && c.falta.n > 0 ? 'falta' : undefined} />
        <Cifra etiqueta="Por llegar este mes" n={c?.porLlegar.n} apoyo={c?.porLlegar.apoyo} />
      </div>

      <LoQueFalta d={d} filas={falta} movil={movil} ocupado={ocupado}
        alSubir={() => elegir.current?.click()} alPedir={setPidiendo}
        alAprender={() => void conAviso(() => aprenderFuentes(activa.id, userName ?? null).then((r) => r.texto))}
        alEncender={() => void conAviso(() => ponerAjustes(activa.id, true, d?.ajustes.margen ?? 5, userName ?? null))} />

      <div className="cxpu-dos">
        <LoUltimo ultimos={p?.ultimos ?? null} pestana={pestana} hoy={hoy} movil={movil} hosteleria={hosteleria}
          alPestana={(id) => { const q = new URLSearchParams(query); if (id === 'ultimo') q.delete('ver'); else q.set('ver', id); setQuery(q, { replace: true }) }}
          alDime={setDime} />
        <div className="cxpu-lado">
          <ComoTeLlegan p={p} direccion={direccion?.direccion ?? null} encendida={direccion?.activa ?? false} ocupado={ocupado}
            alCrear={() => void conAviso(() => direccionUnica(activa.id, userName ?? null).then((r) => <>Tu dirección es <strong>{r.direccion}</strong>{r.yaEstaba ? ' (ya la tenías)' : ''}. Reenvía ahí lo que te manden: {NOMBRE} lo lleva a su sitio.</>))}
            alCopiar={(t) => void navigator.clipboard?.writeText(t).then(() => setAviso({ texto: <>Copiada: <strong>{t}</strong></> }), () => setAviso({ texto: `No se ha podido copiar: selecciónala y cópiala a mano (${t}).`, tono: 'duda' }))} />
          <Tarjeta compacta>
            <p className="cxpu-nota"><strong>Para cualquier negocio.</strong> Lo que se espera sale de lo que ya pasa en tu empresa: tus proveedores de cada mes, tu banco, tu gestoría, tus alquileres y, si los tienes, el datáfono, Amazon, Stripe o las plataformas de reparto. Cada cosa con el día en que suele llegar.</p>
          </Tarjeta>
        </div>
      </div>

      {dime && (
        <DimeQueEs u={dime} alCerrar={() => setDime(null)}
          alGuardar={(tipo, recordar) => { const id = dime.id; setDime(null); void conAviso(() => dimeQueEs(id, tipo, recordar, userName ?? null)) }} />
      )}
      {pidiendo && (
        <Pedirsela fila={pidiendo} empresa={activa.razonSocial || activa.nombre || 'Tu empresa'} direccion={direccion?.direccion ?? null}
          alCerrar={() => setPidiendo(null)}
          alPedir={(email, asunto, cuerpo) => {
            const f = pidiendo; setPidiendo(null)
            void conAviso(async () => {
              const r = await pedirla(f.id, f.hacia, email, asunto, cuerpo, userName ?? null)
              window.location.href = r.mailto
              return r.yaEstaba ? `${f.de}: ya estaba pedida este mes. Se abre tu correo por si quieres volver a mandarla.` : r.texto
            })
          }} />
      )}
      {ajustes && d && (
        <AjustesFalta d={d} alCerrar={() => setAjustes(false)}
          alPoner={(on, margen) => void conAviso(() => ponerAjustes(activa.id, on, margen, userName ?? null))}
          alFuente={(id, activaF) => void conAviso(() => apagarFuente(activa.id, id, activaF, userName ?? null))}
          alLocal={(f, local) => void conAviso(() => ponerLocal(activa.id, f, local, userName ?? null))} />
      )}

      <BotonPulgar>{principal}</BotonPulgar>
    </div>
  )
}

// ── Las piezas ──────────────────────────────────────────────────────────────

function Cifra({ etiqueta, n, apoyo, tono, a }: { etiqueta: string; n: number | undefined; apoyo: string | undefined; tono?: 'duda' | 'falta'; a?: string }) {
  const cuerpo = (
    <>
      <span className="cxpu-cifra-etiqueta">{etiqueta}</span>
      <span className="cxpu-cifra-valor s-cifra" data-tono={tono}>{n ?? '—'}</span>
      <span className="cxpu-cifra-apoyo">{apoyo ?? ' '}</span>
    </>
  )
  return a ? <Link to={a} className="cxpu-cifra">{cuerpo}</Link> : <div className="cxpu-cifra">{cuerpo}</div>
}

function LoQueFalta({ d, filas, movil, ocupado, alSubir, alPedir, alAprender, alEncender }: {
  d: DatosFuentes | null; filas: FilaFalta[]; movil: boolean; ocupado: boolean
  alSubir: () => void; alPedir: (f: FilaFalta) => void; alAprender: () => void; alEncender: () => void
}) {
  const acciones = (f: FilaFalta) => (
    <span className="cxpu-acciones">
      <button type="button" className="s-boton s-boton-enlace" onClick={alSubir}>{f.tipo === 'nominas' || f.n > 1 || f.tipo === 'riders' ? 'Subirlas' : 'Subirla'}</button>
      {f.estado.que === 'tarde' && f.n === 1 && <button type="button" className="s-boton s-boton-enlace" onClick={() => alPedir(f)}>Pedírsela</button>}
    </span>
  )
  const chip = (f: FilaFalta) => <Chip tono={f.estado.que === 'tarde' ? (f.estado.grave ? 'falta' : 'duda') : 'neutro'}>{f.estado.texto}</Chip>
  let cuerpo: ReactNode
  if (!d) cuerpo = <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo lo que te tiene que llegar" />
  else if (!d.ajustes.lo_que_falta) cuerpo = <p className="cxpu-vacio">El aviso está apagado en esta empresa: no te digo lo que falta. <button type="button" className="s-boton s-boton-enlace" disabled={ocupado} onClick={alEncender}>Encenderlo</button></p>
  else if (d.fuentes.length === 0) cuerpo = <p className="cxpu-vacio">Aún no sé qué te tiene que llegar. <button type="button" className="s-boton s-boton-enlace" disabled={ocupado} onClick={alAprender}>Aprenderlo de lo que ya pasa</button>: tus proveedores de cada mes, tu banco, tus liquidaciones y tus nóminas.</p>
  else if (filas.length === 0) cuerpo = <p className="cxpu-vacio">Todo lo que te tenía que llegar ha llegado, y nada más se espera en los próximos 14 días.</p>
  else if (movil) cuerpo = (
    <ul className="cxpu-tarjetas" aria-label="Lo que falta">
      {filas.map((f) => (
        <li key={f.id} className="cxpu-tarjeta">
          <span className="cxpu-tarjeta-cabeza"><strong>{f.de}</strong>{chip(f)}</span>
          <span className="s-tarjeta-apoyo">{f.que} · hacia el {ddmm(f.hacia)}</span>
          {acciones(f)}
        </li>
      ))}
    </ul>
  )
  else cuerpo = (
    <table className="s-tabla cxpu-tabla" aria-label="Lo que falta">
      <thead><tr><th>De quién</th><th>Qué</th><th>Cuándo suele llegar</th><th>Estado</th><th><span className="s-oculto">Acciones</span></th></tr></thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.id}>
            <td><strong>{f.de}</strong></td><td>{f.que}</td><td>hacia el {ddmm(f.hacia)}</td><td>{chip(f)}</td><td className="s-tabla-cifra">{acciones(f)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return <Tarjeta titulo="Lo que falta" accion={<span className="s-tarjeta-apoyo">{NOMBRE} sabe qué te tiene que llegar y cuándo</span>} compacta>{cuerpo}</Tarjeta>
}

function DondeEsta({ u, hosteleria, alDime }: { u: Ultimo; hosteleria: boolean; alDime: (u: Ultimo) => void }) {
  if (necesitaMirarse(u)) return <button type="button" className="s-boton s-boton-enlace" onClick={() => alDime(u)}>Dime qué es</button>
  if (!u.donde) return <span className="s-tarjeta-apoyo">{u.estado === 'repetida' ? 'Repetido: ya estaba' : '—'}</span>
  const a = u.donde === 'factura' ? (u.factura_id ? rutaRevisarFactura(u.factura_id) : rutaDocumentos())
    : u.donde === 'bancos' ? rutaBancos()
      : u.donde === 'liquidaciones' ? (hosteleria ? rutaLiquidacionesVentas() : rutaLiquidaciones())
        : u.donde === 'riders' ? (u.fuente === 'catcher' ? rutaLoteCatcher(u.id) : rutaLiquidaciones())
          : null
  return a ? <Link to={a} className="s-boton s-boton-enlace">{DONDE[u.donde]}</Link> : <span>{DONDE[u.donde]}</span>
}

function QueEsChip({ u }: { u: Ultimo }) {
  if (!u.que) return <span className="cxpu-no-se">No sé qué es</span>
  return <Chip tono={TONO_QUE[u.que]}>{ETIQUETA_QUE[u.que]}</Chip>
}

function LoUltimo({ ultimos, pestana, hoy, movil, hosteleria, alPestana, alDime }: {
  ultimos: Ultimo[] | null; pestana: PestanaPuerta; hoy: string; movil: boolean; hosteleria: boolean
  alPestana: (id: string) => void; alDime: (u: Ultimo) => void
}) {
  const us = ultimos ?? []
  const pestanas = [
    { id: 'ultimo', etiqueta: 'Lo último', n: us.length, siempre: true },
    { id: 'mirar', etiqueta: 'Necesita que lo mires', n: deLaPestana(us, 'mirar').length, siempre: true },
    { id: 'colocado', etiqueta: 'Colocado', n: deLaPestana(us, 'colocado').length, siempre: true },
  ]
  const filas = deLaPestana(us, pestana)
  const de = (u: Ultimo) => u.de ?? u.nombre ?? '—'
  const importe = (u: Ultimo) => (u.importe == null ? '—' : eurosExactos(u.importe))
  let cuerpo: ReactNode
  if (!ultimos) cuerpo = <div className="s-lista-cargando" aria-busy="true" aria-label="Leyendo lo último" />
  else if (filas.length === 0) cuerpo = <p className="cxpu-vacio">{pestana === 'mirar' ? 'Nada que mirar: todo lo que ha llegado sé qué es.' : 'En los últimos 30 días no ha llegado nada. Reenvía a tu dirección o sube lo que tengas.'}</p>
  else if (movil) cuerpo = (
    <ul className="cxpu-tarjetas" aria-label="Lo que ha llegado">
      {filas.map((u) => (
        <li key={`${u.fuente}:${u.id}`} className="cxpu-tarjeta">
          <span className="cxpu-tarjeta-cabeza"><span>{de(u)}</span><strong className="s-cifra">{importe(u)}</strong></span>
          <span className="s-tarjeta-apoyo">{cuandoLlego(u.cuando, hoy)} · {POR[u.por]}</span>
          <span className="cxpu-tarjeta-cabeza"><QueEsChip u={u} /><DondeEsta u={u} hosteleria={hosteleria} alDime={alDime} /></span>
        </li>
      ))}
    </ul>
  )
  else cuerpo = (
    <table className="s-tabla cxpu-tabla" aria-label="Lo que ha llegado">
      <thead><tr><th>Llegó</th><th>Por dónde</th><th>Qué es</th><th>De quién</th><th className="s-tabla-cifra">Importe</th><th>Dónde está</th></tr></thead>
      <tbody>
        {filas.map((u) => (
          <tr key={`${u.fuente}:${u.id}`}>
            <td>{cuandoLlego(u.cuando, hoy)}</td><td>{POR[u.por]}</td><td><QueEsChip u={u} /></td>
            <td className="cxpu-de" title={de(u)}>{de(u)}</td><td className="s-tabla-cifra s-cifra">{importe(u)}</td>
            <td><DondeEsta u={u} hosteleria={hosteleria} alDime={alDime} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <Tarjeta compacta>
      <PestanasEstado etiqueta="Lo que ha llegado" pestanas={pestanas} actual={pestana} alCambiar={alPestana} />
      {cuerpo}
    </Tarjeta>
  )
}

function ComoTeLlegan({ p, direccion, encendida, ocupado, alCrear, alCopiar }: {
  p: DatosPuerta | null; direccion: string | null; encendida: boolean; ocupado: boolean
  alCrear: () => void; alCopiar: (t: string) => void
}) {
  const conectados = [
    ...(p?.conectados.bancos ?? []).map((b) => `${b.proveedor}${b.estado === 'activo' || b.estado === 'active' ? '' : ` (${b.estado})`}`),
    ...(p?.conectados.uber_por_correo ? ['Uber Eats (por correo)'] : []),
  ]
  return (
    <Tarjeta titulo="Cómo te llegan los documentos" compacta>
      <dl className="cxpu-como">
        <dt>Correo</dt>
        <dd>{direccion
          ? <><strong className="cxpu-direccion">{direccion}</strong>
              {!encendida && <span className="cxpu-no-se" data-prueba="direccion-apagada">Apagada: aún no recibe correos.</span>}
              <button type="button" className="s-boton s-boton-enlace" onClick={() => alCopiar(direccion)}>Copiar</button></>
          : <button type="button" className="s-boton s-boton-enlace" disabled={ocupado || !p} onClick={alCrear}>Crear tu dirección</button>}</dd>
        <dt>Desde el móvil</dt><dd>foto o PDF, con la cámara o desde el correo</dd>
        <dt>Arrastrar</dt><dd>en cualquier pantalla de {NOMBRE}</dd>
        <dt>Conectados</dt><dd>{conectados.length ? conectados.map((x) => <span key={x} className="cxpu-conectado">✓ {x}</span>) : 'nada todavía'}</dd>
      </dl>
      <p className="cxpu-nota">Reenvía a tu correo de {NOMBRE} lo que te mandan tus proveedores, tus plataformas, tu banco y tu gestoría. Lo demás lo hace {NOMBRE}.</p>
    </Tarjeta>
  )
}

/** Lo que se ha soltado o elegido: qué es cada cosa y su camino de siempre. */
function Subida({ ficheros, accountId, companyId, quien, alTerminar, alCerrar, aBancos }: {
  ficheros: File[]; accountId: string; companyId: string; quien: string | null
  alTerminar: (texto: ReactNode | null) => void; alCerrar: () => void; aBancos: (f: File) => void
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
    alTerminar(null)
  }
  const automaticos = grupos?.filter((g) => g.camino === 'facturas' || g.camino === 'sin_saber') ?? []
  return (
    <Tarjeta titulo="Subir documentos" apoyo={`${ficheros.length} ${ficheros.length === 1 ? 'fichero' : 'ficheros'}: cada uno va por su camino de siempre.`}
      accion={<Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton>}>
      {!grupos && <p className="s-apoyo" aria-busy="true">Mirando qué es cada cosa…</p>}
      {grupos && (
        <ul className="cxpu-grupos" data-prueba="puerta-grupos">
          {grupos.map((g) => (
            <li key={g.camino} className="cxpu-grupo">
              <p><strong>{g.texto}</strong> <span className="s-tarjeta-apoyo">{g.ficheros.map((x) => x.nombre).join(' · ')}</span></p>
              {g.camino === 'catcher' && <QuincenaCatcher accountId={accountId} companyId={companyId} quien={quien} iniciales={de(g)} alSubir={() => alTerminar(null)} />}
              {g.camino === 'extracto' && de(g).map((f) => <Boton key={f.name} variante="secundario" onClick={() => aBancos(f)}>Importar «{f.name}» en Bancos</Boton>)}
            </li>
          ))}
        </ul>
      )}
      {automaticos.length > 0 && hechos.length === 0 && (
        <Boton variante="principal" disabled={subiendo} onClick={() => void llevar()}>{subiendo ? 'Llevándolos a su sitio…' : 'Llevarlos a su sitio'}</Boton>
      )}
      {hechos.length > 0 && (
        <ul className="cxpu-hechos" role="status" data-prueba="puerta-hechos">
          {hechos.map((h, i) => <li key={i} data-tono={h.bien ? undefined : 'falta'}>{h.texto}</li>)}
        </ul>
      )}
    </Tarjeta>
  )
}

function DimeQueEs({ u, alCerrar, alGuardar }: { u: Ultimo; alCerrar: () => void; alGuardar: (t: QueEs, recordar: boolean) => void }) {
  const [tipo, setTipo] = useState<QueEs | null>(null)
  const porCorreo = u.por === 'correo' && !!u.de
  const [recordar, setRecordar] = useState(porCorreo)
  return (
    <Dialogo titulo="Dime qué es" explicacion={<>{u.nombre ?? u.de ?? 'Este documento'}{u.por === 'correo' && u.de ? <> · llegó por correo de {u.de}</> : null}</>}
      alCerrar={alCerrar}
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!tipo} onClick={() => tipo && alGuardar(tipo, porCorreo && recordar)}>Apuntarlo</Boton></>}>
      <fieldset className="cxpu-dime">
        <legend className="s-oculto">Qué es</legend>
        {TIPOS_DIME.map((t) => (
          <label key={t} className="cxpu-dime-opcion">
            <input type="radio" name="dime" value={t} checked={tipo === t} onChange={() => setTipo(t)} /> {ETIQUETA_QUE[t]}
          </label>
        ))}
      </fieldset>
      {porCorreo && (
        <label className="cxpu-dime-recordar">
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} /> Lo que llegue de este remitente, igual la próxima vez
        </label>
      )}
    </Dialogo>
  )
}

function Pedirsela({ fila, empresa, direccion, alCerrar, alPedir }: {
  fila: FilaFalta; empresa: string; direccion: string | null; alCerrar: () => void; alPedir: (email: string, asunto: string, cuerpo: string) => void
}) {
  const propuesto = useMemo(() => correoPedirla({ empresa, que: fila.que, hacia: fila.hacia, direccion }), [empresa, fila, direccion])
  const [email, setEmail] = useState(fila.pedida?.a ?? '')
  const [asunto, setAsunto] = useState(propuesto.asunto)
  const [cuerpo, setCuerpo] = useState(propuesto.cuerpo)
  useEffect(() => {
    if (email || !fila.proveedorId) return
    let vivo = true
    contactoFacturacion(fila.proveedorId).then((c) => { if (vivo && c) setEmail(c.email) }, () => null)
    return () => { vivo = false }
  }, [fila.proveedorId]) // eslint-disable-line react-hooks/exhaustive-deps
  const vale = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  return (
    <Dialogo titulo={`Pedírsela a ${fila.de}`} explicacion="Revisa el correo: se abre en el tuyo y lo mandas tú. Queda apuntado que la has pedido."
      alCerrar={alCerrar}
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!vale} onClick={() => alPedir(email.trim(), asunto, cuerpo)}>Abrir el correo</Boton></>}>
      <label className="s-campo"><span className="s-campo-etiqueta">A</span><input className="s-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="facturacion@proveedor.es" /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Asunto</span><input className="s-control" value={asunto} onChange={(e) => setAsunto(e.target.value)} /></label>
      <label className="s-campo"><span className="s-campo-etiqueta">Texto</span><textarea className="s-control cxpu-texto" rows={8} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} /></label>
    </Dialogo>
  )
}

function AjustesFalta({ d, alCerrar, alPoner, alFuente, alLocal }: {
  d: DatosFuentes; alCerrar: () => void; alPoner: (on: boolean, margen: number) => void; alFuente: (id: string, activa: boolean) => void
  alLocal: (f: Fuente, local: Local | null) => void
}) {
  // Con un solo local (o ninguno) no se pide nada.
  const locales = (d.locales ?? []).length > 1 ? d.locales ?? [] : []
  const [on, setOn] = useState(d.ajustes.lo_que_falta)
  const [margen, setMargen] = useState(d.ajustes.margen)
  return (
    <Dialogo titulo="Ajustes de «Lo que falta»" explicacion="Apagarlo no borra nada: solo deja de avisar." alCerrar={alCerrar}
      acciones={<><Boton onClick={alCerrar}>Cerrar</Boton><Boton variante="principal" onClick={() => { alPoner(on, margen); alCerrar() }}>Guardar</Boton></>}>
      <label className="cxpu-dime-recordar"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Avisar de lo que falta en esta empresa</label>
      <label className="s-campo"><span className="s-campo-etiqueta">Margen, en días después del día en que suele llegar</span>
        <input className="s-control" type="number" min={0} max={60} value={margen} onChange={(e) => setMargen(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} /></label>
      {d.fuentes.length > 0 && (
        <ul className="cxpu-fuentes" aria-label="Las fuentes">
          {d.fuentes.map((f) => <FilaFuente key={f.id} f={f} locales={locales} alFuente={alFuente} alLocal={alLocal} />)}
        </ul>
      )}
    </Dialogo>
  )
}

/**
 * Una fuente en los ajustes, con su local o centro de trabajo si la empresa
 * tiene más de uno. Aquí sale el nombre de quien factura (es donde se dice de
 * qué local es cada uno); en «Lo que falta», los alquileres salen por local, sin él.
 */
function FilaFuente({ f, locales, alFuente, alLocal }: {
  f: Fuente; locales: readonly Local[]; alFuente: (id: string, activa: boolean) => void; alLocal: (f: Fuente, local: Local | null) => void
}) {
  return (
    <li className="cxpu-fuente">
      <span className="cxpu-fuente-cabeza">
        <span>{f.nombre}{f.tipo === 'alquiler' ? <span className="s-tarjeta-apoyo"> · alquiler</span> : f.grupo ? <span className="s-tarjeta-apoyo"> · {f.grupo}</span> : null}
          {f.cubierta && <span className="s-tarjeta-apoyo"> · la cubre una recurrente</span>}</span>
        <button type="button" className="s-boton s-boton-enlace" onClick={() => alFuente(f.id, !f.activa)}>{f.activa ? 'No avisar' : 'Avisar'}</button>
      </span>
      {locales.length > 0 && (
        <label className="s-campo cxpu-fuente-local"><span className="s-campo-etiqueta">Local</span>
          <select className="s-control" value={f.local?.id ?? ''} aria-label={`Local de ${f.nombre}`}
            onChange={(e) => alLocal(f, locales.find((l) => l.id === e.target.value) ?? null)}>
            <option value="">Sin local</option>
            {locales.map((l) => <option key={l.id} value={l.id}>{nombreDelLocal(l)}{l.nombre && l.direccion ? ` (${l.nombre})` : ''}</option>)}
          </select>
        </label>
      )}
    </li>
  )
}
