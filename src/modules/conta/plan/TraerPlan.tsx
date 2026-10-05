// src/modules/conta/plan/TraerPlan.tsx
//
// C02c · «Traer tu plan de otro programa» (maqueta N8Importar), dentro de
// Ajustes › Plan contable mientras el plan no está activado. Tres pasos:
//
//   1. Tu fichero: ¿de qué programa vienes? (o «No, empiezo de cero» → la
//      activación normal). Se suelta el fichero; se lee AQUÍ, en el navegador
//      (nada sale del dispositivo), y se resume en una frase. Si la longitud
//      no es la de la empresa, o algo no cuelga del plan, se para y se dice.
//   2. Revisa lo que no está claro: cuatro cifras, píldoras, buscador y una
//      fila por cuenta (NÚMERO que se conserva · cómo se llamaba allí · cómo
//      queda aquí, con el porqué · confianza · acciones). Lo seguro ya viene
//      marcado; solo «Decide tú» sin contestar impide seguir. «Guardar y seguir
//      luego» guarda la revisión en la base.
//   3. Traer el plan: lo que va a pasar en palabras, y un botón. Al terminar,
//      la pantalla dice lo que ha hecho (regla 8) y enseña el plan.
//
// El núcleo (importarPlan.ts, propuestaImportacion.ts) decide; la base
// (company_chart_import_apply) lo vuelve a comprobar todo y lo hace todo o nada.

import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Chip } from '@/modules/conta/ui/piezas'
import { Resultado } from '@/modules/conta/empresa/campos'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import {
  adivinarColumnas, juntar, leerTabla, nombreCorto, programa as datosPrograma, PROGRAMAS, resumir,
  type Columnas, type Lectura, type Programa, type ResumenLectura,
} from '@/modules/conta/lib/importarPlan'
import {
  cifras as contar, decidir, filtrar, planTraer, proponer, resumenTraer, validar,
  type Decision, type FichaBanco, type FichaProveedor, type FilaRevision, type Filtro,
} from '@/modules/conta/lib/propuestaImportacion'
import { ACEPTA, abrir, FicheroNoValido, type FicheroAbierto } from '@/modules/conta/plan/leerFicheros'
import { fichasParaCasar, guardarImportacion, huellaDe, tirarImportacion, traerPlan } from '@/modules/conta/services/importarService'
import type { DatosPlan } from '@/modules/conta/services/planService'

type Paso = 1 | 2 | 3

/** Lo que se guarda en company_chart_import.review para seguir luego. */
interface Revision { version: 1; programa: Programa; ficheros: string[]; huella: string; lectura: Lectura; filas: FilaRevision[] }

const corto = nombreCorto

function Pasos({ paso }: { paso: Paso }) {
  const nombres = ['Tu fichero', 'Revisa lo que no está claro', 'Traer el plan']
  return (
    <ol className="cx-traer-pasos" aria-label="Pasos">
      {nombres.map((n, i) => {
        const k = (i + 1) as Paso
        const estado = k < paso ? 'hecho' : k === paso ? 'actual' : 'falta'
        return (
          <li key={n} className={`cx-traer-paso cx-traer-paso-${estado}`} aria-current={k === paso ? 'step' : undefined}>
            <span className="cx-traer-bola" aria-hidden="true">{estado === 'hecho' ? '✓' : k}</span>{n}
          </li>
        )
      })}
    </ol>
  )
}

// ── Paso 1 ──────────────────────────────────────────────────────────────────

interface TablaAbierta { fichero: FicheroAbierto; columnas: Columnas | null; cabecera: boolean }

function columnasDe(t: TablaAbierta): string[] {
  const ancho = Math.max(...t.fichero.filas.slice(0, 20).map((f) => f.length))
  return Array.from({ length: ancho }, (_, i) => (t.cabecera ? (t.fichero.filas[0][i] ?? '').trim() : '') || `Columna ${i + 1}`)
}

function Asignar({ t, cambiar }: { t: TablaAbierta; cambiar: (c: Columnas) => void }) {
  const cols = columnasDe(t)
  const c = t.columnas ?? { codigo: -1, nombre: -1, nif: null }
  const sel = (etiqueta: string, valor: number | null, poner: (v: number | null) => void, opcional = false) => (
    <label className="cx-campo cx-traer-columna">
      <span className="cx-etiqueta">{etiqueta}</span>
      <select className="cx-input" value={valor ?? -1} onChange={(e) => poner(Number(e.target.value) < 0 ? null : Number(e.target.value))}>
        <option value={-1}>{opcional ? 'No lo trae' : 'Elige la columna'}</option>
        {cols.map((n, i) => <option key={i} value={i}>{n}</option>)}
      </select>
    </label>
  )
  return (
    <fieldset className="cx-traer-asignar">
      <legend className="cx-ayuda">«{t.fichero.nombre}»: ¿qué columna es cada cosa?</legend>
      {sel('Código de la cuenta', c.codigo, (v) => cambiar({ ...c, codigo: v ?? -1 }))}
      {sel('Nombre', c.nombre, (v) => cambiar({ ...c, nombre: v ?? -1 }))}
      {sel('NIF', c.nif, (v) => cambiar({ ...c, nif: v }), true)}
    </fieldset>
  )
}

function PasoFichero({ p, empezarDeCero, seguir }: {
  p: DatosPlan
  empezarDeCero: () => void
  seguir: (programa: Programa, lectura: Lectura, resumen: ResumenLectura, nombres: string[], huella: string) => Promise<void>
}) {
  const [programa, setPrograma] = useState<Programa | null>(null)
  const [tablas, setTablas] = useState<TablaAbierta[]>([])
  const [huella, setHuella] = useState<string>('')
  const [leyendo, setLeyendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [sobre, setSobre] = useState(false)
  const [siguiendo, setSiguiendo] = useState(false)
  const hojas = useMemo(() => new Set(p.serie.filter((s) => s.isLeaf).map((s) => s.code)), [p.serie])

  const lectura = useMemo<Lectura | null>(() => {
    if (!programa || !tablas.length || tablas.some((t) => !t.columnas || t.columnas.codigo < 0 || t.columnas.nombre < 0)) return null
    return juntar(programa, tablas.map((t) => leerTabla(programa, t.fichero.filas, t.columnas!, t.cabecera)))
  }, [programa, tablas])
  const resumen = useMemo(() => (lectura ? resumir(lectura, { plan: p.plan, digitos: p.digitos }, hojas) : null), [lectura, p.plan, p.digitos, hojas])

  async function cargar(lista: FileList | File[]) {
    const fs = [...lista]
    if (!fs.length || !programa) return
    setLeyendo(true); setFallo(null)
    try {
      const abiertos = await Promise.all(fs.map(abrir))
      if (abiertos.some((a) => a.clase === 'pdf')) {
        throw new FicheroNoValido(programa === 'diez'
          ? 'Folvy aún no lee el PDF de Diez en esta versión de prueba. En Diez, exporta los mismos listados a Excel («Plan de cuentas» y los de proveedores y clientes) y suéltalos aquí.'
          : 'De este programa Folvy lee Excel o CSV, no PDF: expórtalo a Excel y suéltalo aquí.')
      }
      setTablas(abiertos.map((f) => { const a = adivinarColumnas(f.filas); return { fichero: f, columnas: a.columnas, cabecera: a.cabecera } }))
      setHuella(await huellaDe(abiertos.map((a) => a.bytes)))
    } catch (e) {
      setTablas([]); setFallo(e instanceof Error ? e.message : String(e))
    } finally { setLeyendo(false) }
  }
  const soltar = (e: DragEvent) => { e.preventDefault(); setSobre(false); void cargar(e.dataTransfer.files) }

  if (!programa) {
    return (
      <section className="cx-tarjeta cx-traer" aria-labelledby="traer-titulo">
        <h2 id="traer-titulo" className="cx-tarjeta-titulo">¿Vienes de otro programa?</h2>
        <p className="cx-ayuda" style={{ margin: 0 }}>
          Si llevabas la contabilidad en otro programa, trae tu plan: tus cuentas se quedan con el mismo número que tenían allí,
          enlazadas a tus proveedores y bancos de Folvy. Tu asesor podrá comparar y nada cambia de número.
        </p>
        <div className="cx-traer-programas" role="group" aria-label="De qué programa vienes">
          {PROGRAMAS.map((x) => (
            <button key={x.id} type="button" className="cx-traer-programa" onClick={() => setPrograma(x.id)}>
              <span className="cx-fila-titulo">{x.nombre}</span>
              <span className="cx-fila-apoyo">{x.lee === 'pdf_diez' ? 'Sus listados en PDF o Excel' : 'Excel o CSV'}</span>
            </button>
          ))}
          <button type="button" className="cx-traer-programa cx-traer-cero" onClick={empezarDeCero}>
            <span className="cx-fila-titulo">No, empiezo de cero</span>
            <span className="cx-fila-apoyo">Folvy pone el plan del BOE con su numeración</span>
          </button>
        </div>
      </section>
    )
  }
  const info = datosPrograma(programa)
  return (
    <section className="cx-tarjeta cx-traer" aria-labelledby="traer-titulo">
      <div className="cx-traer-cabeza">
        <div>
          <button type="button" className="cx-enlace cx-traer-volver" onClick={() => { setPrograma(null); setTablas([]); setFallo(null) }}>‹ Elegir otro programa</button>
          <h2 id="traer-titulo" className="cx-ajustes-panel-titulo">Traer tu plan de {info.nombre}</h2>
        </div>
        <Pasos paso={1} />
      </div>
      <p className="cx-ayuda" style={{ margin: 0 }}>{info.ficheros}</p>
      <label className={`cx-traer-soltar${sobre ? ' cx-traer-soltar-sobre' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSobre(true) }} onDragLeave={() => setSobre(false)} onDrop={soltar}>
        <input type="file" multiple accept={ACEPTA} className="cx-oculto" aria-label="Elegir los ficheros" onChange={(e) => e.target.files && void cargar(e.target.files)} />
        <span className="cx-fila-titulo">{leyendo ? 'Leyendo el fichero…' : 'Suelta aquí tus ficheros o toca para elegirlos'}</span>
        <span className="cx-fila-apoyo">Se leen en tu dispositivo: no se sube el fichero, solo las cuentas que tiene.</span>
      </label>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {tablas.map((t, i) => (
        <Asignar key={t.fichero.nombre + i} t={t} cambiar={(c) => setTablas((ts) => ts.map((x, j) => (j === i ? { ...x, columnas: c } : x)))} />
      ))}
      {tablas.length > 0 && !lectura && <p className="cx-ayuda" role="status">Dime qué columna lleva el código y cuál el nombre de cada fichero.</p>}
      {resumen && (resumen.ok
        ? <p className="cx-traer-frase" role="status"><Chip tono="ia">Leído</Chip> «{tablas.map((t) => t.fichero.nombre).join('», «')}» · {resumen.frase}</p>
        : <div className="cx-error" role="alert">{resumen.motivo}</div>)}
      {lectura && lectura.avisos.length > 0 && resumen?.ok && (
        <details className="cx-ayuda"><summary>{lectura.avisos.length} {lectura.avisos.length === 1 ? 'línea no es una cuenta' : 'líneas no son cuentas'} (cabeceras, totales…): no se usan</summary>
          <ul>{lectura.avisos.slice(0, 50).map((a, i) => <li key={i}>{a}</li>)}</ul></details>
      )}
      <div className="cx-pie" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="cx-boton" disabled={!resumen?.ok || siguiendo}
          onClick={() => { setSiguiendo(true); void seguir(programa, lectura!, resumen!, tablas.map((t) => t.fichero.nombre), huella).catch((e) => setFallo(e instanceof Error ? e.message : String(e))).finally(() => setSiguiendo(false)) }}>
          {siguiendo ? 'Preparando la revisión…' : 'Siguiente: revisar →'}
        </button>
      </div>
    </section>
  )
}

// ── Paso 2 ──────────────────────────────────────────────────────────────────

function enFolvy(f: FilaRevision, filas: readonly FilaRevision[]): string {
  const d = f.decision
  switch (d.tipo) {
    case 'enlazar': return `${d.nombreFicha} · ${d.entity === 'bank_account' ? 'banco' : d.papel === 'pago' ? 'su cuenta como cliente' : f.clase === 'acreedor' ? 'acreedor' : 'proveedor'}`
    case 'enlazar_creada': {
      const creadora = filas.find((x) => x.code === d.codigoCreadora)
      return `${creadora?.decision.tipo === 'crear_proveedor' ? creadora.decision.nombre : d.codigoCreadora} · su cuenta como cliente`
    }
    case 'crear_proveedor': return `${d.nombre} · ficha nueva, por completar`
    case 'sin_ficha': return d.nota === 'cliente_c03' ? 'Cliente · su ficha llega con los clientes' : 'Cuenta tuya, sin ficha'
    case 'retencion': return d.modelo ? `Retenciones del ${d.modelo}` : 'Cuenta tuya, sin modelo'
    case 'serie': return f.hoja === '472' ? 'IVA soportado, ahora por tipo' : 'IVA repercutido, ahora por tipo'
    case 'pendiente': return 'Falta que digas qué es'
  }
}

const CONFIANZA: Record<FilaRevision['confianza'], { texto: string; tono: 'ia' | 'azul' | 'ambar' }> = {
  seguro: { texto: 'Seguro', tono: 'ia' }, probable: { texto: 'Probable', tono: 'azul' }, decide: { texto: 'Decide tú', tono: 'ambar' },
}

function Cambiar({ f, fichas, poner, cerrar }: { f: FilaRevision; fichas: { proveedores: FichaProveedor[]; bancos: FichaBanco[] }; poner: (d: Decision, porque: string) => void; cerrar: () => void }) {
  const [q, setQ] = useState('')
  const banco = f.clase === 'banco'
  const pago = f.clase === 'cliente'
  const lista = (banco ? fichas.bancos : fichas.proveedores).filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30)
  return (
    <div className="cx-traer-cambiar" role="group" aria-label={`Cambiar ${f.code}`}>
      {f.clase !== 'retencion' && f.clase !== 'iva' && f.clase !== 'otra' && (
        <>
          <input className="cx-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={banco ? 'Busca un banco de Folvy' : 'Busca una ficha de proveedor'} aria-label="Buscar ficha" autoFocus />
          <ul className="cx-traer-fichas">
            {lista.map((x) => (
              <li key={x.id}><button type="button" className="cx-enlace"
                onClick={() => poner({ tipo: 'enlazar', entity: banco ? 'bank_account' : 'supplier', entityId: x.id, nombreFicha: x.name, papel: pago ? 'pago' : 'principal' }, `lo has enlazado tú con ${x.name}`)}>
                Es {x.name}</button></li>
            ))}
            {!lista.length && <li className="cx-ayuda">Ninguna ficha se llama así.</li>}
          </ul>
        </>
      )}
      <div className="cx-traer-acciones">
        {f.opciones.map((o) => <button key={o.id} type="button" className="cx-boton-sec" onClick={() => poner(o.decision, 'lo has decidido tú')}>{o.texto}</button>)}
        {(f.clase === 'proveedor' || f.clase === 'acreedor') && !f.opciones.some((o) => o.id === 'sin_ficha') && (
          <button type="button" className="cx-boton-sec" onClick={() => poner({ tipo: 'sin_ficha', nota: 'cuenta' }, 'lo has decidido tú')}>Cuenta mía sin ficha</button>
        )}
        <button type="button" className="cx-enlace" onClick={cerrar}>Cancelar</button>
      </div>
    </div>
  )
}

function FilaTabla({ f, filas, fichas, poner, movil }: {
  f: FilaRevision; filas: readonly FilaRevision[]; fichas: { proveedores: FichaProveedor[]; bancos: FichaBanco[] }; movil: boolean
  poner: (code: string, d: Decision, porque: string) => void
}) {
  const [cambiando, setCambiando] = useState(false)
  const c = CONFIANZA[f.confianza]
  const ponerAqui = (d: Decision, porque: string) => { poner(f.code, d, porque); setCambiando(false) }
  const acciones = (
    <span className="cx-traer-acciones">
      {f.confianza === 'probable' && <button type="button" className="cx-enlace" onClick={() => ponerAqui(f.decision, 'lo has confirmado tú')}>Es este</button>}
      {f.confianza === 'decide' && f.opciones.slice(0, 3).map((o) => (
        <button key={o.id} type="button" className="cx-enlace" onClick={() => ponerAqui(o.decision, 'lo has decidido tú')}>{o.texto}</button>
      ))}
      {!f.cambia && <button type="button" className="cx-enlace" aria-expanded={cambiando} onClick={() => setCambiando((v) => !v)}>Cambiar</button>}
    </span>
  )
  return (
    <div role="row" className={`cx-traer-fila${f.confianza === 'decide' ? ' cx-traer-fila-decide' : ''}${movil ? ' cx-traer-fila-movil' : ''}`}>
      <span role="cell" className="cx-cifra">{f.code}</span>
      <span role="cell" className="cx-fila-texto"><span className="cx-fila-titulo">{f.enOrigen}</span>{f.nif && <span className="cx-fila-apoyo">NIF {f.nif}</span>}</span>
      {!movil && <span role="cell" aria-hidden="true" className="cx-traer-flecha">→</span>}
      <span role="cell" className="cx-fila-texto"><span className="cx-fila-titulo">{enFolvy(f, filas)}</span><span className="cx-fila-apoyo">{f.porque}</span></span>
      <span role="cell"><Chip tono={c.tono}>{c.texto}</Chip></span>
      <span role="cell">{acciones}</span>
      {cambiando && <div className="cx-traer-fila-cambiar"><Cambiar f={f} fichas={fichas} poner={ponerAqui} cerrar={() => setCambiando(false)} /></div>}
    </div>
  )
}

function PasoRevisar({ revision, fichas, nombreFichero, cambiar, guardar, tirar, seguir, movil, accion }: {
  revision: Revision; fichas: { proveedores: FichaProveedor[]; bancos: FichaBanco[] }; nombreFichero: string; movil: boolean
  cambiar: (filas: FilaRevision[]) => void; guardar: () => void; tirar: () => void; seguir: () => void
  accion: { guardando: boolean; hecho: string | null; fallo: string | null }
}) {
  const filas = revision.filas
  const k = contar(filas)
  const [filtro, setFiltro] = useState<Filtro>(k.revisar ? 'revisar' : 'todas')
  const [q, setQ] = useState('')
  const vistas = filtrar(filas, filtro, q)
  const problemas = validar(filas)
  const p = corto(revision.programa)
  const pildora = (id: Filtro, texto: string) => (
    <button type="button" className="cx-pildora" aria-pressed={filtro === id} onClick={() => setFiltro(id)}>{texto}</button>
  )
  return (
    <section className="cx-tarjeta cx-traer" aria-labelledby="traer-titulo">
      <div className="cx-traer-cabeza">
        <div>
          <h2 id="traer-titulo" className="cx-ajustes-panel-titulo">Traer tu plan de {datosPrograma(revision.programa).nombre}</h2>
          <p className="cx-ayuda" style={{ margin: 0 }}>{nombreFichero}</p>
        </div>
        <Pasos paso={2} />
      </div>
      <div className="cx-traer-cifras">
        <div className="cx-traer-cifra"><span className="cx-fila-apoyo">Entran tal cual</span><span className="cx-cifra cx-traer-numero">{k.tal}</span><span className="cx-traer-nota cx-traer-nota-verde">proveedores, bancos, clientes y gastos con su número de {p}</span></div>
        <div className="cx-traer-cifra"><span className="cx-fila-apoyo">Para revisar</span><span className="cx-cifra cx-traer-numero">{k.revisar}</span><span className="cx-traer-nota cx-traer-nota-ambar">{k.pendientes ? `${k.pendientes} sin decidir: nombres parecidos, iguales o sin NIF` : 'nombres parecidos o sin NIF: compruébalos'}</span></div>
        <div className="cx-traer-cifra"><span className="cx-fila-apoyo">Cambian</span><span className="cx-cifra cx-traer-numero">{k.cambian}</span><span className="cx-traer-nota cx-traer-nota-azul">472 y 477: aquí van por tipo de IVA; el 303 suma igual</span></div>
        <div className="cx-traer-cifra"><span className="cx-fila-apoyo">Nuevas en Folvy</span><span className="cx-cifra cx-traer-numero">{k.nuevas}</span><span className="cx-traer-nota">fichas de proveedor que se crean, por completar</span></div>
      </div>
      <div className="cx-tablas-barra">
        <div className="cx-tablas-filtros" role="group" aria-label="Qué filas ver">
          {pildora('revisar', `Para revisar · ${k.revisar}`)}{pildora('todas', `Todas · ${k.todas}`)}{pildora('proveedores', 'Proveedores')}{pildora('clientes', 'Clientes')}{pildora('bancos', 'Bancos')}
        </div>
        <input className="cx-input cx-buscar" type="search" aria-label="Buscar en la revisión" placeholder="Busca: «Glovo», «410»" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div role="table" className="cx-traer-tabla" aria-label="Cuentas que se traen">
        {!movil && (
          <div role="row" className="cx-traer-fila cx-traer-titulos">
            <span role="columnheader">NÚMERO (se conserva)</span><span role="columnheader">EN {p.toUpperCase()}</span><span aria-hidden="true" />
            <span role="columnheader">EN FOLVY</span><span role="columnheader">CONFIANZA</span><span role="columnheader"><span className="cx-oculto">Acciones</span></span>
          </div>
        )}
        {vistas.map((f) => <FilaTabla key={f.code} f={f} filas={filas} fichas={fichas} movil={movil} poner={(code, d, porque) => cambiar(decidir(filas, code, d, porque))} />)}
        {!vistas.length && <p className="cx-ayuda">{filtro === 'revisar' && !q ? 'No queda nada por revisar: todo entra con su número.' : 'Nada que enseñar con este filtro.'}</p>}
      </div>
      {problemas.length > 0 && (
        <div className="cx-aviso" role="status">
          {k.pendientes ? `Faltan ${k.pendientes} ${k.pendientes === 1 ? 'cuenta' : 'cuentas'} por decidir («Decide tú»).` : ''}
          {problemas.filter((x) => !/falta decir/.test(x.texto)).slice(0, 3).map((x) => <div key={x.code}>{x.texto}</div>)}
          {movil && k.pendientes > 0 && <div>Si te es más cómodo, guarda y decídelas en el ordenador.</div>}
        </div>
      )}
      <Resultado hecho={accion.hecho} fallo={accion.fallo} />
      <div className="cx-pie">
        <button type="button" className="cx-enlace" onClick={tirar} disabled={accion.guardando}>Tirar y empezar de nuevo</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="cx-boton-sec" onClick={guardar} disabled={accion.guardando}>Guardar y seguir luego</button>
        <button type="button" className="cx-boton" onClick={seguir} disabled={problemas.length > 0 || accion.guardando}>Siguiente: traer el plan →</button>
      </div>
    </section>
  )
}

// ── El asistente ────────────────────────────────────────────────────────────

/** alTraer: lo que se ha traído, en una frase; la página lo enseña encima del plan ya activado (regla 8). */
export function TraerPlan({ p, empezarDeCero, alTraer }: { p: DatosPlan; empezarDeCero: () => void; alTraer: (frase: string) => void }) {
  const { quien, plan, movil } = useAjustes()
  const h = useHacer(() => {})
  const [trayendo, setTrayendo] = useState(false)
  const [falloTraer, setFalloTraer] = useState<string | null>(null)
  const guardada = p.importacion?.estado === 'revision' ? (p.importacion.revision as Partial<Revision>) : null
  const [revision, setRevision] = useState<Revision | null>(guardada?.version === 1 && guardada.filas ? guardada as Revision : null)
  const [importId, setImportId] = useState<string | null>(p.importacion?.estado === 'revision' ? p.importacion.id : null)
  const [paso, setPaso] = useState<Paso>(revision ? 2 : 1)
  const [fichas, setFichas] = useState<{ proveedores: FichaProveedor[]; bancos: FichaBanco[] } | null>(null)
  const hojas = useMemo(() => new Set(p.serie.filter((s) => s.isLeaf).map((s) => s.code)), [p.serie])
  const nombreFichero = (r: Revision) => `«${r.ficheros.join('», «')}» · ${resumir(r.lectura, { plan: p.plan, digitos: p.digitos }, hojas).frase}`

  async function verFichas() {
    if (fichas) return fichas
    const f = await fichasParaCasar(quien.accountId, quien.companyId)
    setFichas(f)
    return f
  }
  // Una revisión guardada vuelve con sus fichas para «Cambiar».
  useEffect(() => {
    if (!revision || fichas) return
    let vivo = true
    fichasParaCasar(quien.accountId, quien.companyId).then((f) => { if (vivo) setFichas(f) }).catch(() => {})
    return () => { vivo = false }
  }, [revision, fichas, quien.accountId, quien.companyId])

  async function empezar(programa: Programa, lectura: Lectura, resumen: ResumenLectura, nombres: string[], huella: string) {
    const f = await verFichas()
    const filas = proponer({ cuentas: resumen.cuentas, terceros: lectura.terceros, proveedores: f.proveedores, bancos: f.bancos, programa: datosPrograma(programa).nombre })
    const r: Revision = { version: 1, programa, ficheros: nombres, huella, lectura, filas }
    const id = await guardarImportacion(quien.companyId, programa, nombres, huella, r as unknown as Record<string, unknown>, null)
    setImportId(id); setRevision(r)
    // Nada que revisar: directo al 3 (encargo §5).
    setPaso(contar(filas).revisar === 0 ? 3 : 2)
  }

  if (paso === 1 || !revision) return <><Resultado hecho={h.hecho} fallo={h.fallo} /><PasoFichero p={p} empezarDeCero={empezarDeCero} seguir={empezar} /></>

  const guardar = () => void h.hacer(async () => {
    setImportId(await guardarImportacion(quien.companyId, revision.programa, revision.ficheros, revision.huella, revision as unknown as Record<string, unknown>, null))
  }, () => `Guardado. Te quedan ${contar(revision.filas).pendientes} por decidir; vuelve cuando quieras a Ajustes › Plan contable y sigues aquí.`)
  const tirar = () => {
    if (!window.confirm('¿Tiras esta revisión? No se ha traído nada: vuelves a elegir el fichero.')) return
    void h.hacer(async () => { if (importId) await tirarImportacion(importId); setRevision(null); setImportId(null); setPaso(1) }, 'Revisión tirada: elige otra vez el fichero.')
  }

  if (paso === 2) {
    return <PasoRevisar revision={revision} fichas={fichas ?? { proveedores: [], bancos: [] }} nombreFichero={nombreFichero(revision)} movil={movil} accion={h}
      cambiar={(filas) => { h.limpiar(); setRevision({ ...revision, filas }) }} guardar={guardar} tirar={tirar}
      seguir={() => void h.hacer(async () => {
        setImportId(await guardarImportacion(quien.companyId, revision.programa, revision.ficheros, revision.huella, revision as unknown as Record<string, unknown>, null))
        setPaso(3)
      }, 'Revisión guardada.')} />
  }

  const r = resumir(revision.lectura, { plan: p.plan, digitos: p.digitos }, hojas)
  const plan3 = planTraer(revision.filas, r.cuentas, revision.lectura.terceros)
  const ivaCambia = revision.filas.some((f) => f.cambia)
  const texto = resumenTraer(plan3, corto(revision.programa), ivaCambia)
  return (
    <section className="cx-tarjeta cx-traer" aria-labelledby="traer-titulo">
      <div className="cx-traer-cabeza">
        <div>
          <button type="button" className="cx-enlace cx-traer-volver" onClick={() => setPaso(2)} disabled={trayendo}>‹ Volver a la revisión</button>
          <h2 id="traer-titulo" className="cx-ajustes-panel-titulo">Traer tu plan de {datosPrograma(revision.programa).nombre}</h2>
        </div>
        <Pasos paso={3} />
      </div>
      <p className="cx-traer-frase">{texto}.</p>
      <ul className="cx-ayuda">
        <li>Cada cuenta conserva su número de {corto(revision.programa)}; el nombre de allí se guarda aparte para comparar.</li>
        <li>Se activa el plan de {p.plan === 'pymes' ? 'pymes' : 'general'} con {p.digitos} dígitos: las cuentas del BOE que falten, el IVA por tipo y tus retenciones y tipos de gasto, enlazados.</li>
        {plan3.crear.length > 0 && <li>Se crean {plan3.crear.length} {plan3.crear.length === 1 ? 'ficha' : 'fichas'} de proveedor «Traída de {corto(revision.programa)} · por completar».</li>}
        <li>Si algo no te convence, en «Lo que ha hecho Folvy» lo deshaces entero mientras no haya asientos.</li>
      </ul>
      <Resultado hecho={null} fallo={falloTraer} />
      <div className="cx-pie" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="cx-boton" disabled={trayendo || !importId}
          onClick={() => {
            setTrayendo(true); setFalloTraer(null)
            traerPlan(importId!, plan3, null)
              .then((x) => {
                alTraer(`Plan traído de ${datosPrograma(revision.programa).nombre}: ${x.cuentas} cuentas con su número de ${corto(revision.programa)}, ${x.fichas} ${x.fichas === 1 ? 'ficha nueva' : 'fichas nuevas'} por completar y ${x.serie} cuentas del BOE; el IVA ya va por tipo.${x.avisos.length ? ` Ojo: ${x.avisos.join(' ')}` : ''}`)
                plan.recargar()
              })
              .catch((e) => setFalloTraer(e instanceof Error ? e.message : String(e)))
              .finally(() => setTrayendo(false))
          }}>
          {trayendo ? 'Trayendo el plan…' : 'Traer el plan'}
        </button>
      </div>
    </section>
  )
}
