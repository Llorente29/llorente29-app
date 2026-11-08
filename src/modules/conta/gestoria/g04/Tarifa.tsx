// src/modules/conta/gestoria/g04/Tarifa.tsx
//
// G04 · Tarea 4 · «Tarifa y paquetes», fiel al tablero Tarifa de la maqueta
// del 08/11 (versión 17): a la izquierda los servicios y los paquetes; a la
// derecha el elegido (niveles en tarjetas; cómo se cobra con sus tramos y
// «Pruébalo»; el paquete con lo que incluye, su precio, lo que ahorra y el
// exceso) y sus clientes con precio especial. «Cambiar precios» se abre al
// final, y sin ver antes a quién afecta no se aplica nada.
//
// No lee nada: todo llega por props (paginas.tsx), y así se captura con datos
// inventados. Cada botón que guarda dice en pantalla lo que ha hecho o por qué
// no (regla 8). En la cuenta real de QBO la base no deja cambiar la tarifa
// hasta que Julio lo diga (ajuste «cambios_de_tarifa»): el porqué sale aquí.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { euros, type Forma, type Objetivo, type Tramo } from '../../../../../supabase/functions/_shared/tarifa/precio'
import type { CambioDePrecios, Ensayo } from '../../../../../supabase/functions/_shared/tarifa/cambioPrecios'
import { pruebalo, reglasDe, type DetalleTarifa, type FormaTipo, type ModeloTarifa } from './modeloTarifa'
import { mesEnPalabras } from './enlaces'

export interface AccionesTarifa {
  guardarPrecio: (o: Objetivo, f: Forma, desde: string) => Promise<string>
  guardarNivel: (servicioId: string, nombre: string, orden: number, incluye: string[], precio: Forma | null, desde: string) => Promise<string>
  guardarPaquete: (paqueteId: string | null, nombre: string, descripcion: string | null, excesoCent: number | null,
    lineas: { servicio: string; nivel: string | null; limiteTrabajadores: number | null }[], precio: Forma | null, desde: string) => Promise<string>
  /** Guarda el ensayo (lo que se ha visto) y lo aplica. */
  aplicarCambio: (op: Omit<CambioDePrecios, 'empresaId'>, ensayo: Ensayo) => Promise<{ frase: string; id: string | null }>
  deshacerCambio: (id: string) => Promise<string>
}

export interface PropsTarifa {
  modelo: ModeloTarifa
  empresa: string
  hoy: string
  rutaFicha: (clienteId: string) => string
  rutaClientes: string
  /** Los servicios de la empresa con sus niveles, para «+ Añadir un servicio al paquete» y «+ Crear › Paquete». */
  servicios: { id: string; nombre: string; niveles: { id: string; nombre: string }[]; porTrabajador: boolean }[]
  acciones: AccionesTarifa
  alDescargar: (que: 'excel' | 'pdf' | 'tarifa') => { ok: boolean; texto: string }
  /** Para abrir la pantalla con algo elegido (capturas y enlaces). */
  elegidaInicial?: string
  cambioAbierto?: boolean
}

type Aviso = { ok: boolean; texto: string } | null
const numero = (s: string): number | null => {
  const t = s.trim().replace(/\./g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const aCent = (s: string) => { const n = numero(s); return n === null ? null : Math.round(n * 100) }
const siguientes = (hoy: string, n: number) => {
  const out: string[] = []
  let a = Number(hoy.slice(0, 4)); let m = Number(hoy.slice(5, 7))
  for (let i = 0; i < n; i++) { m += 1; if (m > 12) { m = 1; a += 1 } out.push(`${a}-${String(m).padStart(2, '0')}`) }
  return out
}
const mesMayuscula = (m: string) => { const t = mesEnPalabras(`${m}-01`); return t.charAt(0).toUpperCase() + t.slice(1) }

async function conAviso(set: (a: Aviso) => void, f: () => Promise<string>) {
  try { set({ ok: true, texto: await f() }) } catch (e) { set({ ok: false, texto: e instanceof Error ? e.message : String(e) }) }
}
function Hecho({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null
  return <p className="g4-hecho" data-ok={aviso.ok ? '' : undefined} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>
}
function Desde({ hoy, valor, alCambiar, etiqueta = 'Desde' }: { hoy: string; valor: string; alCambiar: (m: string) => void; etiqueta?: string }) {
  return (
    <label className="g4-tf-campo">{etiqueta}
      <select value={valor} onChange={(e) => alCambiar(e.target.value)}>
        {siguientes(hoy, 6).map((m) => <option key={m} value={m}>{mesMayuscula(m)}</option>)}
      </select>
    </label>
  )
}

const FORMAS: { tipo: FormaTipo; titulo: string; texto: string }[] = [
  { tipo: 'fijo', titulo: 'Precio fijo', texto: 'Lo mismo cada vez' },
  { tipo: 'por_trabajador', titulo: 'Por trabajador', texto: 'Un precio por cada trabajador de alta' },
  { tipo: 'tramos', titulo: 'Por tramos', texto: 'Un precio según cuántos trabajadores tenga' },
  { tipo: 'tramo_y_por_trabajador', titulo: 'Tramo y después por trabajador', texto: 'Precio cerrado hasta N, y a partir de ahí, por cada uno' },
]
const TITULO_REGLAS: Record<FormaTipo, string> = { fijo: 'Precio', por_trabajador: 'Precio por trabajador', tramos: 'Tramos', tramo_y_por_trabajador: 'Tramo cerrado y después por trabajador' }

/** Al cambiar de forma, se parte de lo que había (el primer importe) para no empezar de cero. */
function formaNueva(tipo: FormaTipo, antes: Forma | null): Forma {
  const base = antes ? (antes.tipo === 'fijo' || antes.tipo === 'por_trabajador' ? antes.importeCent : antes.tramos[0]?.importeCent ?? 0) : 0
  switch (tipo) {
    case 'fijo': return { tipo: 'fijo', periodo: antes?.tipo === 'fijo' ? antes.periodo : 'mes', importeCent: base }
    case 'por_trabajador': return { tipo: 'por_trabajador', importeCent: base }
    case 'tramos': return { tipo: 'tramos', tramos: [{ desde: 1, hasta: 5, importeCent: base, porUnidad: false }, { desde: 6, hasta: null, importeCent: base, porUnidad: false }] }
    case 'tramo_y_por_trabajador': return { tipo: 'tramo_y_por_trabajador', tramos: [{ desde: 1, hasta: 5, importeCent: base, porUnidad: false }, { desde: 6, hasta: null, importeCent: 0, porUnidad: true }] }
  }
}
const ordenados = (ts: Tramo[]) => [...ts].sort((a, b) => a.desde - b.desde)
function conImporte(f: Forma, i: number, cent: number): Forma {
  if (f.tipo === 'fijo' || f.tipo === 'por_trabajador') return { ...f, importeCent: cent }
  return { ...f, tramos: ordenados(f.tramos).map((t, j) => (j === i ? { ...t, importeCent: cent } : t)) }
}
function sinTramo(f: Forma, i: number): Forma {
  if (f.tipo === 'fijo' || f.tipo === 'por_trabajador') return f
  const ts = ordenados(f.tramos).filter((_, j) => j !== i)
  if (!ts.length) return f
  ts[ts.length - 1] = { ...ts[ts.length - 1], hasta: null }
  return { ...f, tramos: ts }
}
function conTramoMas(f: Forma): Forma {
  if (f.tipo === 'fijo' || f.tipo === 'por_trabajador') return f
  const ts = ordenados(f.tramos)
  const ultimo = ts[ts.length - 1]
  const hasta = ultimo.desde + 4
  ts[ts.length - 1] = { ...ultimo, hasta }
  ts.push({ desde: hasta + 1, hasta: null, importeCent: ultimo.importeCent, porUnidad: ultimo.porUnidad })
  return { ...f, tramos: ts }
}

export function Tarifa(p: PropsTarifa) {
  const { modelo } = p
  const [sel, setSel] = useState(p.elegidaInicial && modelo.entradas.some((e) => e.id === p.elegidaInicial) ? p.elegidaInicial : modelo.entradas[0]?.id ?? '')
  const [menu, setMenu] = useState<'opciones' | 'crear' | null>(null)
  const [cambio, setCambio] = useState(!!p.cambioAbierto)
  const [crear, setCrear] = useState<'servicio' | 'paquete' | null>(null)
  const [aviso, setAviso] = useState<Aviso>(null)
  const detalle = sel ? modelo.detalle(sel) : null
  const servicios = modelo.entradas.filter((e) => e.tipo === 'servicio')
  const paquetes = modelo.entradas.filter((e) => e.tipo === 'paquete')
  const item = (e: (typeof modelo.entradas)[number]) => (
    <button key={e.id} type="button" className="g4-tf-item" aria-current={sel === e.id ? 'true' : 'false'} onClick={() => { setSel(e.id); setAviso(null) }}>
      <span className="g4-tf-item-textos"><span className="g4-tf-item-nombre">{e.nombre}</span><span className="g4-tf-item-resumen">{e.resumen}</span></span>
      <span className="g4-tf-item-clientes">{e.clientes ? `${e.clientes} ${e.clientes === 1 ? 'cliente' : 'clientes'}` : 'Ningún cliente'}</span>
    </button>
  )
  return (
    <div className="g4" data-pantalla="tarifa-g04">
      <header className="g4-cabecera">
        <div className="g4-cabecera-textos">
          <div className="g4-antetitulo">{p.empresa}</div>
          <h1 className="g4-titulo">Tarifa y paquetes</h1>
          <div className="g4-tf-subtitulo">Lo que ofreces y lo que cuesta. Cada cliente tiene asignados sus servicios en su ficha, y los recibos se calculan solos.</div>
        </div>
        <div className="g4-cabecera-acciones g4-tf-menus">
          <button type="button" className="g4-boton" aria-expanded={menu === 'opciones'} onClick={() => setMenu(menu === 'opciones' ? null : 'opciones')}>Más opciones ▾</button>
          <button type="button" className="g4-boton" data-tipo="primario" aria-expanded={menu === 'crear'} onClick={() => setMenu(menu === 'crear' ? null : 'crear')}>+ Crear ▾</button>
          {menu === 'opciones' && (
            <div role="menu" className="g4-tf-menu">
              <Opcion titulo="Cambiar precios" texto="Subir o bajar a varios clientes a la vez" alPulsar={() => { setCambio(true); setMenu(null) }} />
              <Opcion titulo="Descargar clientes y precios · Excel" texto="Cada cliente con sus servicios, nivel y lo que paga" alPulsar={() => { setAviso(p.alDescargar('excel')); setMenu(null) }} />
              <Opcion titulo="Descargar clientes y precios · PDF" texto="El mismo listado, listo para imprimir" alPulsar={() => { setAviso(p.alDescargar('pdf')); setMenu(null) }} />
              <Opcion titulo="Tarifa para enseñar a clientes · PDF" texto="Tus niveles y paquetes, con tu logo, para enviar a quien pida precio" alPulsar={() => { setAviso(p.alDescargar('tarifa')); setMenu(null) }} />
            </div>
          )}
          {menu === 'crear' && (
            <div role="menu" className="g4-tf-menu">
              <Opcion titulo="Servicio" texto="Algo que haces, con su precio. Puede tener niveles." alPulsar={() => { setCrear('servicio'); setMenu(null) }} />
              <Opcion titulo="Paquete" texto="Varios servicios juntos por un precio cerrado" alPulsar={() => { setCrear('paquete'); setMenu(null) }} />
            </div>
          )}
        </div>
      </header>

      {!detalle && <Hecho aviso={aviso} />}
      {crear === 'servicio' && (
        <section className="g4-tf-crear" aria-label="Crear un servicio">
          <p className="g4-hecho" role="alert">Crear un servicio nuevo aún no se puede desde aquí: la base no tiene todavía la función que lo guarda. Mientras tanto, los servicios son los que ya tiene la empresa; a cada uno se le pueden poner niveles y precio.</p>
          <button type="button" className="g4-boton" onClick={() => setCrear(null)}>Cerrar</button>
        </section>
      )}
      {crear === 'paquete' && <CrearPaquete {...p} alCerrar={() => setCrear(null)} />}

      <div className="g4-tf-cuerpo">
        <nav aria-label="Servicios y paquetes" className="g4-tf-lista">
          <div className="g4-tf-grupo">SERVICIOS</div>
          {servicios.length ? servicios.map(item) : <p className="g4-tf-vacio">Esta empresa aún no tiene servicios.</p>}
          <div className="g4-tf-grupo" data-segundo="">PAQUETES</div>
          {paquetes.length ? paquetes.map(item) : <p className="g4-tf-vacio">Aún no hay paquetes. Se crean en «+ Crear › Paquete».</p>}
        </nav>
        {detalle ? <Detalle key={detalle.entrada.id} {...p} d={detalle} aviso={aviso} setAviso={setAviso} /> : (
          <section className="g4-tf-detalle"><p className="g4-tf-vacio">Elige un servicio o un paquete.</p></section>
        )}
      </div>

      {cambio && <CambiarPrecios {...p} actual={detalle} alCerrar={() => setCambio(false)} />}
    </div>
  )
}

function Opcion({ titulo, texto, alPulsar }: { titulo: string; texto: string; alPulsar: () => void }) {
  return (
    <button type="button" role="menuitem" className="g4-tf-opcion" onClick={alPulsar}>
      <span className="g4-tf-opcion-titulo">{titulo}</span><span className="g4-tf-opcion-texto">{texto}</span>
    </button>
  )
}

function Detalle(p: PropsTarifa & { d: DetalleTarifa; aviso: Aviso; setAviso: (a: Aviso) => void }) {
  const { d } = p
  const esPaquete = d.entrada.tipo === 'paquete'
  const sid = d.entrada.id.replace(/^servicio:/, '')
  return (
    <section aria-labelledby="g4-tf-nombre" className="g4-tf-detalle">
      <div className="g4-tf-detalle-cabeza">
        <div className="g4-tf-detalle-textos">
          <div className="g4-tf-detalle-titulo">
            <h2 id="g4-tf-nombre">{d.entrada.nombre}</h2>
            <span className="g4-tf-tipo" data-paquete={esPaquete ? '' : undefined}>{d.tipoTexto}</span>
          </div>
          {d.descripcion && <div className="g4-tf-descripcion">{d.descripcion}</div>}
        </div>
        {d.entrada.clientes > 0 && <Link className="g4-boton g4-tf-ver" to={p.rutaClientes}>Ver sus {d.entrada.clientes} clientes</Link>}
      </div>
      <Hecho aviso={p.aviso} />
      {d.niveles.length > 0 && <Niveles {...p} servicioId={sid} />}
      {!esPaquete && !d.niveles.length && <ComoSeCobra {...p} servicioId={sid} />}
      {esPaquete && d.paquete && <ElPaquete {...p} />}
      <Especiales d={d} rutaFicha={p.rutaFicha} />
    </section>
  )
}

function Niveles(p: PropsTarifa & { d: DetalleTarifa; servicioId: string; setAviso: (a: Aviso) => void }) {
  const { d } = p
  const [precios, setPrecios] = useState<Record<string, string>>(() => Object.fromEntries(d.niveles.map((n) => [n.id, n.precio ?? ''])))
  const [desde, setDesde] = useState(siguientes(p.hoy, 1)[0])
  const [nuevo, setNuevo] = useState<{ nombre: string; precio: string; incluye: string } | null>(null)
  const cambiados = d.niveles.filter((n) => (precios[n.id] ?? '') !== (n.precio ?? ''))
  const malos = cambiados.filter((n) => aCent(precios[n.id] ?? '') === null)
  return (
    <div className="g4-tf-bloque">
      <div className="g4-tf-bloque-cabeza">
        <div className="g4-tf-bloque-titulo">Niveles</div>
        <div className="g4-tf-nota">Cada cliente está en un nivel. Cambiarlo de nivel se hace desde su ficha.</div>
      </div>
      <div className="g4-tf-niveles">
        {d.niveles.map((n) => (
          <div key={n.id} className="g4-tf-nivel" data-top={n.masElegido ? '' : undefined}>
            <div className="g4-tf-nivel-cabeza"><div className="g4-tf-nivel-nombre">{n.nombre}</div>{n.masElegido && <span className="g4-tf-top">EL MÁS ELEGIDO</span>}</div>
            <div className="g4-tf-precio">
              <input aria-label={`Precio de ${n.nombre}`} inputMode="decimal" value={precios[n.id] ?? ''} placeholder="Sin precio" onChange={(e) => setPrecios({ ...precios, [n.id]: e.target.value })} />
              <span>€ al mes</span>
            </div>
            <div className="g4-tf-incluye">{n.incluye.map((x) => <div key={x}><span aria-hidden="true">✓</span><span>{x}</span></div>)}</div>
            <div className="g4-tf-nivel-pie"><span>Clientes</span><b>{n.clientes}</b></div>
          </div>
        ))}
      </div>
      {cambiados.length > 0 && (
        <div className="g4-tf-guardar">
          <Desde hoy={p.hoy} valor={desde} alCambiar={setDesde} />
          <button type="button" className="g4-boton" data-tipo="primario" disabled={malos.length > 0} onClick={() => conAviso(p.setAviso, async () => {
            const frases: string[] = []
            for (const n of cambiados) frases.push(await p.acciones.guardarPrecio({ tipo: 'nivel', servicioId: p.servicioId, nivelId: n.id }, { tipo: 'fijo', periodo: 'mes', importeCent: aCent(precios[n.id])! }, desde))
            return frases.join(' ')
          })}>Guardar {cambiados.length === 1 ? 'el precio' : `${cambiados.length} precios`} desde {mesEnPalabras(`${desde}-01`).toLowerCase()}</button>
          {malos.length > 0 && <span className="g4-tf-nota">Escribe el precio en euros, por ejemplo 60,50.</span>}
        </div>
      )}
      {nuevo ? (
        <div className="g4-tf-formulario" aria-label="Añadir nivel">
          <label className="g4-tf-campo">Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
          <label className="g4-tf-campo">Precio (€ al mes)<input inputMode="decimal" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} /></label>
          <label className="g4-tf-campo g4-tf-ancho">Qué incluye (uno por línea)<textarea rows={3} value={nuevo.incluye} onChange={(e) => setNuevo({ ...nuevo, incluye: e.target.value })} /></label>
          <Desde hoy={p.hoy} valor={desde} alCambiar={setDesde} etiqueta="Su precio, desde" />
          <div className="g4-tf-botones">
            <button type="button" className="g4-boton" onClick={() => setNuevo(null)}>Cancelar</button>
            <button type="button" className="g4-boton" data-tipo="primario" disabled={!nuevo.nombre.trim()} onClick={() => conAviso(p.setAviso, async () => {
              const c = aCent(nuevo.precio)
              const r = await p.acciones.guardarNivel(p.servicioId, nuevo.nombre.trim(), d.niveles.length + 1, nuevo.incluye.split('\n').map((x) => x.trim()).filter(Boolean),
                c === null ? null : { tipo: 'fijo', periodo: 'mes', importeCent: c }, desde)
              setNuevo(null)
              return r
            })}>Crear el nivel</button>
          </div>
        </div>
      ) : <button type="button" className="g4-tf-anadir" onClick={() => setNuevo({ nombre: '', precio: '', incluye: '' })}>+ Añadir nivel</button>}
    </div>
  )
}

function ComoSeCobra(p: PropsTarifa & { d: DetalleTarifa; servicioId: string; setAviso: (a: Aviso) => void }) {
  const { d } = p
  const inicial: Forma | null = d.general?.forma ?? null
  const [forma, setForma] = useState<Forma | null>(inicial)
  const [textos, setTextos] = useState<Record<number, string>>({})
  const [n, setN] = useState(12)
  const [desde, setDesde] = useState(siguientes(p.hoy, 1)[0])
  const reglas = forma ? reglasDe(forma) : []
  const cambiado = JSON.stringify(forma) !== JSON.stringify(inicial)
  const conTrab = forma ? forma.tipo !== 'fijo' : d.porTrabajador
  const prueba = forma && conTrab ? pruebalo(forma, n) : null
  const fijoSinTrab = forma?.tipo === 'fijo' ? { total: euros(forma.importeCent), cuenta: 'Precio fijo, tenga los trabajadores que tenga' } : null
  const malo = Object.values(textos).some((t) => aCent(t) === null)
  return (
    <div className="g4-tf-bloque" data-ancho="">
      {d.sinPrecioGeneral && !forma && (
        <p className="g4-tf-sin-precio">Este servicio no tiene precio de tarifa: cada cliente paga el suyo (abajo). Elige cómo se cobra para ponerle uno.</p>
      )}
      <div className="g4-tf-bloque">
        <div className="g4-tf-bloque-titulo">Cómo se cobra</div>
        <div role="radiogroup" aria-label="Cómo se cobra" className="g4-tf-formas">
          {FORMAS.map((f) => (
            <button key={f.tipo} type="button" role="radio" aria-checked={forma?.tipo === f.tipo} className="g4-tf-forma"
              onClick={() => { if (forma?.tipo !== f.tipo) { setForma(f.tipo === inicial?.tipo ? inicial : formaNueva(f.tipo, forma)); setTextos({}) } }}>
              <span className="g4-tf-forma-titulo">{f.titulo}</span><span className="g4-tf-forma-texto">{f.texto}</span>
            </button>
          ))}
        </div>
      </div>
      {forma && (
        <div className="g4-tf-bloque">
          <div className="g4-tf-bloque-titulo">{TITULO_REGLAS[forma.tipo]}</div>
          {reglas.map((r, i) => (
            <div key={`${forma.tipo}-${i}-${r.tramo}`} className="g4-tf-regla">
              <div className="g4-tf-regla-tramo">{r.tramo}</div>
              <input aria-label={`Importe · ${r.tramo}`} inputMode="decimal" value={textos[i] ?? r.importe} onChange={(e) => {
                setTextos({ ...textos, [i]: e.target.value })
                const c = aCent(e.target.value)
                if (c !== null) setForma(conImporte(forma, i, c))
              }} />
              <div className="g4-tf-regla-unidad">{r.unidad}</div>
              {reglas.length > 1 ? <button type="button" className="g4-tf-quitar" onClick={() => { setForma(sinTramo(forma, i)); setTextos({}) }}>Quitar</button> : <span />}
            </div>
          ))}
          {(forma.tipo === 'tramos' || forma.tipo === 'tramo_y_por_trabajador') && (
            <button type="button" className="g4-tf-anadir" onClick={() => { setForma(conTramoMas(forma)); setTextos({}) }}>+ Añadir tramo</button>
          )}
          {forma.tipo === 'fijo' && (
            <label className="g4-tf-campo g4-tf-periodo">Cada cuánto
              <select value={forma.periodo} onChange={(e) => setForma({ ...forma, periodo: e.target.value as 'mes' | 'anio' | 'vez' })}>
                <option value="mes">Cada mes</option><option value="anio">Cada año</option><option value="vez">Cada vez (trabajo suelto)</option>
              </select>
            </label>
          )}
        </div>
      )}
      {forma && conTrab && prueba && (
        <div className="g4-tf-pruebalo">
          <div className="g4-tf-pruebalo-izq">
            <div className="g4-tf-pruebalo-titulo">Pruébalo:</div>
            <button type="button" aria-label="Un trabajador menos" className="g4-tf-mas" onClick={() => setN(Math.max(1, n - 1))}>−</button>
            <div className="g4-tf-pruebalo-n"><b>{n}</b> {n === 1 ? 'trabajador' : 'trabajadores'}</div>
            <button type="button" aria-label="Un trabajador más" className="g4-tf-mas" onClick={() => setN(n + 1)}>+</button>
          </div>
          <div className="g4-tf-pruebalo-der"><div className="g4-tf-pruebalo-total">{prueba.total} al mes</div><div className="g4-tf-nota">{prueba.cuenta}</div></div>
        </div>
      )}
      {forma && !conTrab && d.porTrabajador && fijoSinTrab && (
        <div className="g4-tf-pruebalo"><div className="g4-tf-pruebalo-titulo">{fijoSinTrab.cuenta}</div><div className="g4-tf-pruebalo-total">{fijoSinTrab.total}</div></div>
      )}
      {forma && cambiado && (
        <div className="g4-tf-guardar">
          <Desde hoy={p.hoy} valor={desde} alCambiar={setDesde} />
          <button type="button" className="g4-boton" data-tipo="primario" disabled={malo} onClick={() => conAviso(p.setAviso,
            () => p.acciones.guardarPrecio({ tipo: 'servicio', servicioId: p.servicioId }, forma, desde))}>Guardar el precio desde {mesEnPalabras(`${desde}-01`).toLowerCase()}</button>
          <button type="button" className="g4-boton" onClick={() => { setForma(inicial); setTextos({}) }}>Dejarlo como estaba</button>
          {malo && <span className="g4-tf-nota">Escribe los importes en euros, por ejemplo 18,00.</span>}
        </div>
      )}
    </div>
  )
}

function ElPaquete(p: PropsTarifa & { d: DetalleTarifa; setAviso: (a: Aviso) => void }) {
  const pq = p.d.paquete!
  const pid = p.d.entrada.id.replace(/^paquete:/, '')
  const [precio, setPrecio] = useState(pq.precio ?? '')
  const [desde, setDesde] = useState(siguientes(p.hoy, 1)[0])
  const [anadir, setAnadir] = useState<{ clave: string; limite: string } | null>(null)
  const opciones = p.servicios.flatMap((s) => (s.niveles.length ? s.niveles.map((n) => ({ clave: `${s.id}|${n.id}`, nombre: `${s.nombre} · ${n.nombre}`, porTrabajador: s.porTrabajador }))
    : [{ clave: `${s.id}|`, nombre: s.nombre, porTrabajador: s.porTrabajador }]))
  const elegida = anadir ? opciones.find((o) => o.clave === anadir.clave) : undefined
  const lineas = pq.lineas.map((l) => ({ servicio: l.objetivo.tipo === 'paquete' ? '' : l.objetivo.servicioId, nivel: l.objetivo.tipo === 'nivel' ? l.objetivo.nivelId : null, limiteTrabajadores: l.limite }))
  return (
    <div className="g4-tf-bloque" data-ancho="">
      <div className="g4-tf-paquete">
        <div className="g4-tf-incluye-caja">
          <div className="g4-tf-bloque-titulo">Qué incluye</div>
          {pq.lineas.map((l) => (
            <div key={l.texto} className="g4-tf-incluye-linea">
              <div><div className="g4-tf-incluye-nombre">{l.texto}</div><div className="g4-tf-nota">{l.detalle}</div></div>
              <div className="g4-tf-suelto">{l.suelto ?? 'sin precio suelto'}</div>
            </div>
          ))}
          {anadir ? (
            <div className="g4-tf-formulario">
              <label className="g4-tf-campo g4-tf-ancho">Servicio
                <select value={anadir.clave} onChange={(e) => setAnadir({ ...anadir, clave: e.target.value })}>
                  <option value="">Elige un servicio</option>
                  {opciones.map((o) => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}
                </select>
              </label>
              {elegida?.porTrabajador && <label className="g4-tf-campo">Hasta cuántos trabajadores<input inputMode="numeric" value={anadir.limite} onChange={(e) => setAnadir({ ...anadir, limite: e.target.value })} /></label>}
              <div className="g4-tf-botones">
                <button type="button" className="g4-boton" onClick={() => setAnadir(null)}>Cancelar</button>
                <button type="button" className="g4-boton" data-tipo="primario" disabled={!elegida} onClick={() => conAviso(p.setAviso, async () => {
                  const [servicio, nivel] = elegida!.clave.split('|')
                  const limite = elegida!.porTrabajador && anadir.limite.trim() ? Number(anadir.limite) : null
                  const r = await p.acciones.guardarPaquete(pid, p.d.entrada.nombre, p.d.descripcion, p.d.excesoCent ?? null,
                    [...lineas, { servicio, nivel: nivel || null, limiteTrabajadores: Number.isFinite(limite) ? limite : null }], null, desde)
                  setAnadir(null)
                  return r
                })}>Añadirlo al paquete</button>
              </div>
            </div>
          ) : <button type="button" className="g4-enlace" onClick={() => setAnadir({ clave: '', limite: '' })}>+ Añadir un servicio al paquete</button>}
        </div>
        <div className="g4-tf-precio-paquete">
          <div className="g4-tf-claro">Precio del paquete</div>
          <div className="g4-tf-precio">
            <input aria-label="Precio del paquete" inputMode="decimal" value={precio} placeholder="Sin precio" onChange={(e) => setPrecio(e.target.value)} />
            <span className="g4-tf-claro">€ al mes</span>
          </div>
          {pq.porSeparado && <div className="g4-tf-claro">Por separado: <s>{pq.porSeparado}</s></div>}
          {pq.ahorro && <div className="g4-tf-ahorro">El cliente ahorra {pq.ahorro}</div>}
          {precio !== (pq.precio ?? '') && (
            <div className="g4-tf-guardar" data-oscuro="">
              <Desde hoy={p.hoy} valor={desde} alCambiar={setDesde} />
              <button type="button" className="g4-boton" data-tipo="primario" disabled={aCent(precio) === null} onClick={() => conAviso(p.setAviso,
                () => p.acciones.guardarPrecio({ tipo: 'paquete', paqueteId: pid }, { tipo: 'fijo', periodo: 'mes', importeCent: aCent(precio)! }, desde))}>Guardar desde {mesEnPalabras(`${desde}-01`).toLowerCase()}</button>
            </div>
          )}
        </div>
      </div>
      <div className="g4-tf-exceso">
        <div className="g4-tf-bloque-titulo">Si el cliente se pasa de lo que incluye</div>
        <div>{pq.exceso}</div>
      </div>
    </div>
  )
}

function Especiales({ d, rutaFicha }: { d: DetalleTarifa; rutaFicha: (id: string) => string }) {
  const propio = d.especiales[0]?.palabra === 'Precio de este cliente'
  return (
    <div className="g4-tf-especiales">
      <div className="g4-tf-bloque-cabeza">
        <div className="g4-tf-bloque-titulo">{propio ? 'Clientes con su propio precio' : 'Clientes con precio especial'} · {d.especiales.length}</div>
        <div className="g4-pequeno">{propio ? 'Sin precio de tarifa, cada uno paga el suyo: «Precio de este cliente»' : 'El precio especial se pone en la ficha de cada cliente'}</div>
      </div>
      {!d.especiales.length && <div className="g4-tf-nota">Todos pagan el precio de tu tarifa.</div>}
      {d.especiales.map((e) => (
        <div key={`${e.clienteId}-${e.precio}`} className="g4-tf-especial">
          <Link to={rutaFicha(e.clienteId)}>{e.cliente}</Link>
          <div className="g4-tf-nota">{e.precio}</div>
          <div className="g4-pequeno">{e.desde}</div>
        </div>
      ))}
    </div>
  )
}

function CrearPaquete(p: PropsTarifa & { alCerrar: () => void }) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [marcados, setMarcados] = useState<Record<string, string>>({})
  const [precio, setPrecio] = useState('')
  const [desde, setDesde] = useState(siguientes(p.hoy, 1)[0])
  const [aviso, setAviso] = useState<Aviso>(null)
  const opciones = p.servicios.flatMap((s) => (s.niveles.length ? s.niveles.map((n) => ({ clave: `${s.id}|${n.id}`, nombre: `${s.nombre} · ${n.nombre}`, porTrabajador: s.porTrabajador }))
    : [{ clave: `${s.id}|`, nombre: s.nombre, porTrabajador: s.porTrabajador }]))
  const elegidas = opciones.filter((o) => o.clave in marcados)
  return (
    <section className="g4-tf-crear" aria-label="Crear un paquete">
      <div className="g4-tf-cambio-titulo">Nuevo paquete</div>
      <div className="g4-tf-formulario">
        <label className="g4-tf-campo">Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="g4-tf-campo">Precio (€ al mes)<input inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} /></label>
        <label className="g4-tf-campo g4-tf-ancho">Para quién es<input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></label>
      </div>
      <div className="g4-tf-bloque-titulo">Qué incluye</div>
      <div className="g4-tf-chips">
        {opciones.map((o) => (
          <span key={o.clave} className="g4-tf-chip-caja">
            <button type="button" className="g4-tf-chip" aria-pressed={o.clave in marcados} onClick={() => {
              const m = { ...marcados }
              if (o.clave in m) delete m[o.clave]; else m[o.clave] = ''
              setMarcados(m)
            }}>{o.clave in marcados ? '✓ ' : ''}{o.nombre}</button>
            {o.clave in marcados && o.porTrabajador && <input aria-label={`Hasta cuántos trabajadores · ${o.nombre}`} placeholder="hasta N trabajadores" inputMode="numeric"
              value={marcados[o.clave]} onChange={(e) => setMarcados({ ...marcados, [o.clave]: e.target.value })} />}
          </span>
        ))}
      </div>
      <Hecho aviso={aviso} />
      <div className="g4-tf-guardar">
        <Desde hoy={p.hoy} valor={desde} alCambiar={setDesde} etiqueta="Su precio, desde" />
        <button type="button" className="g4-boton" onClick={p.alCerrar}>Cancelar</button>
        <button type="button" className="g4-boton" data-tipo="primario" disabled={!nombre.trim() || !elegidas.length} onClick={() => conAviso(setAviso, async () => {
          const c = aCent(precio)
          return p.acciones.guardarPaquete(null, nombre.trim(), descripcion.trim() || null, null, elegidas.map((o) => {
            const [servicio, nivel] = o.clave.split('|')
            const l = Number(marcados[o.clave])
            return { servicio, nivel: nivel || null, limiteTrabajadores: marcados[o.clave].trim() && Number.isFinite(l) ? l : null }
          }), c === null ? null : { tipo: 'fijo', periodo: 'mes', importeCent: c }, desde)
        })}>Crear el paquete</button>
      </div>
    </section>
  )
}

type Quien = 'todos' | 'elegidos' | 'filtro'
type Trab = 'cualquiera' | 'mas10' | 'uno5'

function CambiarPrecios(p: PropsTarifa & { actual: DetalleTarifa | null; alCerrar: () => void }) {
  const { modelo } = p
  const inicial = () => {
    const a = p.actual
    if (!a) return new Set<string>()
    return new Set(modelo.opciones.filter((o) => (a.entrada.tipo === 'paquete' ? o.objetivo.tipo === 'paquete' && `paquete:${o.objetivo.paqueteId}` === a.entrada.id
      : o.objetivo.tipo !== 'paquete' && `servicio:${o.objetivo.servicioId}` === a.entrada.id)).map((o) => o.clave))
  }
  const [dir, setDir] = useState<'subir' | 'bajar'>('subir')
  const [cuanto, setCuanto] = useState('3')
  const [unidad, setUnidad] = useState<'%' | '€'>('%')
  const [desde, setDesde] = useState(siguientes(p.hoy, 2)[1])
  const [delCliente, setDelCliente] = useState<'cambian' | 'se_quedan'>('cambian')
  const [marcados, setMarcados] = useState<Set<string>>(inicial)
  const [quien, setQuien] = useState<Quien>('todos')
  const [elegidos, setElegidos] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [queTengan, setQueTengan] = useState('')
  const [trab, setTrab] = useState<Trab>('cualquiera')
  const [visto, setVisto] = useState<{ op: Omit<CambioDePrecios, 'empresaId'>; ensayo: Ensayo } | null>(null)
  const [aviso, setAviso] = useState<Aviso>(null)
  const [aplicado, setAplicado] = useState<string | null>(null)
  const todos = modelo.opciones.length > 0 && modelo.opciones.every((o) => marcados.has(o.clave))
  const cantidad = numero(cuanto)
  const op = useMemo((): Omit<CambioDePrecios, 'empresaId'> | null => {
    if (cantidad === null || cantidad === 0 || !marcados.size) return null
    const que = todos ? null : modelo.opciones.filter((o) => marcados.has(o.clave)).map((o) => o.objetivo)
    const filtroObj = modelo.opciones.find((o) => o.clave === queTengan)?.objetivo
    const aQuien: CambioDePrecios['aQuien'] = quien === 'todos' ? { tipo: 'todos' } : quien === 'elegidos' ? { tipo: 'elegidos', clienteIds: elegidos }
      : { tipo: 'filtro', ...(filtroObj ? { queTengan: filtroObj } : {}), ...(trab === 'mas10' ? { trabajadoresDesde: 11 } : trab === 'uno5' ? { trabajadoresDesde: 1, trabajadoresHasta: 5 } : {}) }
    return { sentido: dir, cantidad: unidad === '%' ? { tipo: 'porcentaje', valor: cantidad } : { tipo: 'euros', cent: Math.round(cantidad * 100) }, desde, que, aQuien, preciosDelCliente: delCliente }
  }, [cantidad, marcados, todos, modelo, queTengan, quien, elegidos, trab, dir, unidad, desde, delCliente])
  const nombres = modelo.opciones.filter((o) => marcados.has(o.clave)).map((o) => o.nombre)
  const qs = quien === 'todos' ? 'a todos los clientes que lo tienen' : quien === 'elegidos' ? `solo a ${elegidos.length === 1 ? 'el cliente elegido' : `los ${elegidos.length} clientes elegidos`}` : 'a los clientes que cumplen el filtro'
  const resumen = !marcados.size ? 'Marca al menos un servicio, nivel o paquete.'
    : cantidad === null || cantidad === 0 ? 'Escribe cuánto sube o baja.'
      : quien === 'elegidos' && !elegidos.length ? 'Elige al menos un cliente.'
        : `${dir === 'subir' ? 'Sube' : 'Baja'} ${unidad === '%' ? `un ${String(cantidad).replace('.', ',')} %` : `${euros(Math.round(cantidad * 100))}`} ${todos ? 'toda la tarifa' : nombres.join(', ')}, ${qs}, desde ${mesEnPalabras(`${desde}-01`).toLowerCase()}. Antes de aplicarlo verás cada cliente con su precio de antes y el nuevo.`
  const sugeridos = busca.trim().length >= 2
    ? modelo.clientes.filter((c) => !elegidos.includes(c.id) && `${c.nombre} ${c.nif ?? ''}`.toLowerCase().includes(busca.trim().toLowerCase())).slice(0, 8) : []
  const nombreObj = (o: Objetivo) => modelo.opciones.find((x) => JSON.stringify(x.objetivo) === JSON.stringify(o))?.nombre ?? '—'
  const segun = (c: number | null) => (c === null ? '—' : euros(c))
  const reset = () => { setVisto(null); setAviso(null) }
  return (
    <section aria-label="Cambiar precios" className="g4-tf-cambio">
      <div className="g4-tf-cambio-cabeza">
        <div className="g4-tf-cambio-titulo">Cambiar precios</div>
        <div role="radiogroup" aria-label="Subir o bajar" className="g4-segmentos">
          <button type="button" role="radio" aria-checked={dir === 'subir'} className="g4-segmento" onClick={() => { setDir('subir'); reset() }}>Subir</button>
          <button type="button" role="radio" aria-checked={dir === 'bajar'} className="g4-segmento" onClick={() => { setDir('bajar'); reset() }}>Bajar</button>
        </div>
      </div>
      <div className="g4-tf-tres">
        <label className="g4-tf-campo">Cuánto
          <span className="g4-tf-cuanto">
            <input inputMode="decimal" value={cuanto} onChange={(e) => { setCuanto(e.target.value); reset() }} />
            <select aria-label="En % o en €" value={unidad} onChange={(e) => { setUnidad(e.target.value as '%' | '€'); reset() }}><option>%</option><option>€</option></select>
          </span>
        </label>
        <Desde hoy={p.hoy} valor={desde} alCambiar={(m) => { setDesde(m); reset() }} />
        <label className="g4-tf-campo">Clientes con precio especial
          <select value={delCliente} onChange={(e) => { setDelCliente(e.target.value as 'cambian' | 'se_quedan'); reset() }}><option value="cambian">También cambian</option><option value="se_quedan">Se quedan como están</option></select>
        </label>
      </div>
      <div className="g4-tf-bloque">
        <div className="g4-tf-etiqueta">Qué cambia <span>· servicios, niveles o paquetes; uno, varios o todos</span></div>
        <div className="g4-tf-chips">
          <button type="button" className="g4-tf-chip" aria-pressed={todos} onClick={() => { setMarcados(todos ? new Set() : new Set(modelo.opciones.map((o) => o.clave))); reset() }}>Todo</button>
          {modelo.opciones.map((o) => (
            <button key={o.clave} type="button" className="g4-tf-chip" aria-pressed={marcados.has(o.clave)} onClick={() => {
              const m = new Set(marcados); if (m.has(o.clave)) m.delete(o.clave); else m.add(o.clave); setMarcados(m); reset()
            }}>{marcados.has(o.clave) ? '✓ ' : ''}{o.nombre}</button>
          ))}
          {!modelo.opciones.length && <span className="g4-tf-nota">Nada tiene precio de tarifa todavía: no hay qué subir ni bajar.</span>}
        </div>
      </div>
      <div className="g4-tf-bloque">
        <div className="g4-tf-etiqueta">A qué clientes</div>
        <div role="radiogroup" aria-label="A qué clientes" className="g4-tf-chips">
          {([['todos', 'Todos los que lo tienen'], ['elegidos', 'Solo los clientes que yo elija'], ['filtro', 'Los que cumplan un filtro']] as [Quien, string][]).map(([q, t]) => (
            <button key={q} type="button" role="radio" aria-checked={quien === q} className="g4-tf-chip" onClick={() => { setQuien(q); reset() }}>{t}</button>
          ))}
        </div>
        {quien === 'elegidos' && (
          <div className="g4-tf-caja">
            <input placeholder="Busca un cliente por nombre o NIF" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {sugeridos.length > 0 && <div className="g4-tf-sugeridos">{sugeridos.map((c) => (
              <button key={c.id} type="button" className="g4-tf-sugerido" onClick={() => { setElegidos([...elegidos, c.id]); setBusca(''); reset() }}>{c.nombre}{c.nif ? ` · ${c.nif}` : ''}</button>
            ))}</div>}
            <div className="g4-tf-chips">{elegidos.map((id) => (
              <span key={id} className="g4-tf-elegido">{modelo.nombreDeCliente(id)} <button type="button" aria-label={`Quitar ${modelo.nombreDeCliente(id)}`} onClick={() => { setElegidos(elegidos.filter((x) => x !== id)); reset() }}>×</button></span>
            ))}</div>
          </div>
        )}
        {quien === 'filtro' && (
          <div className="g4-tf-caja g4-tf-dos">
            <label className="g4-tf-campo">Que tengan
              <select value={queTengan} onChange={(e) => { setQueTengan(e.target.value); reset() }}>
                <option value="">Cualquier servicio</option>
                {modelo.opciones.map((o) => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}
              </select>
            </label>
            <label className="g4-tf-campo">Trabajadores
              <select value={trab} onChange={(e) => { setTrab(e.target.value as Trab); reset() }}><option value="mas10">Más de 10</option><option value="uno5">De 1 a 5</option><option value="cualquiera">Cualquiera</option></select>
            </label>
          </div>
        )}
      </div>
      <div className="g4-tf-resumen">
        <div>{resumen}</div>
        <div className="g4-tf-botones">
          <button type="button" className="g4-boton" onClick={p.alCerrar}>Cancelar</button>
          <button type="button" className="g4-boton" data-tipo="primario" disabled={!op || (quien === 'elegidos' && !elegidos.length)}
            onClick={() => { if (op) { setVisto({ op, ensayo: modelo.ensayar(op) }); setAviso(null); setAplicado(null) } }}>Ver a quién afecta</button>
        </div>
      </div>
      {visto && (
        <div className="g4-tf-ensayo" aria-label="A quién afecta">
          <div className="g4-tf-bloque-titulo">{visto.ensayo.frase}</div>
          {visto.ensayo.enCero > 0 && <div className="g4-tf-nota">{visto.ensayo.enCero === 1 ? 'Un importe' : `${visto.ensayo.enCero} importes`} quedaría por debajo de 0: se queda en 0 €.</div>}
          {visto.ensayo.lineas.length > 0 ? (
            <div className="g4-tabla-caja">
              <table className="g4-tf-tabla">
                <thead><tr><th>Cliente</th><th>Qué</th><th>Cómo le llega</th><th className="g4-derecha">Antes</th><th className="g4-derecha">Después</th></tr></thead>
                <tbody>{visto.ensayo.lineas.map((l, i) => (
                  <tr key={`${l.clienteId}-${i}`}>
                    <td><Link to={p.rutaFicha(l.clienteId)}>{modelo.nombreDeCliente(l.clienteId)}</Link></td>
                    <td>{nombreObj(l.objetivo)}</td>
                    <td>{l.como === 'tarifa' ? 'Por la tarifa' : l.como === 'suyo' ? 'Su precio cambia' : 'Pasa a precio especial'}</td>
                    <td className="g4-derecha">{segun(l.antesCent)}</td>
                    <td className="g4-derecha"><b>{segun(l.despuesCent)}</b></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="g4-tf-nota">No le cambia el precio a ningún cliente.</div>}
          <Hecho aviso={aviso} />
          <div className="g4-tf-botones">
            {aplicado ? (
              <button type="button" className="g4-boton" onClick={() => conAviso(setAviso, async () => { const r = await p.acciones.deshacerCambio(aplicado); setAplicado(null); return r })}>Deshacer el cambio</button>
            ) : (
              <button type="button" className="g4-boton" data-tipo="primario" disabled={!visto.ensayo.lineas.length && !visto.ensayo.guardar.nuevos.length}
                onClick={() => conAviso(setAviso, async () => { const r = await p.acciones.aplicarCambio(visto.op, visto.ensayo); setAplicado(r.id); return r.frase })}>
                Aplicar el cambio a {visto.ensayo.clientes} {visto.ensayo.clientes === 1 ? 'cliente' : 'clientes'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

