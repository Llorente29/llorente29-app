// src/modules/conta/pages/PlanContablePage.tsx
//
// Ajustes › Plan contable (C02 §5c, maqueta N5Plan dentro del marco de N6:
// el contenido de N5 —buscador, filtros, tabla, origen— con el índice lateral
// de N6 en vez de sus pestañas, D7).
//
// Ordenador: cabecera con la línea del plan y «Qué va a cada sitio» / «+ Añadir
// subcuenta»; píldoras por grupo y buscador; la tabla (NÚMERO en Geist Mono,
// CUENTA con «qué se apunta aquí», LO QUE LLEVAS, ORIGEN, Abrir). Abrir
// despliega la cuenta en su sitio. Móvil: lista por grupos con el buscador
// arriba; cada cuenta abre su pantalla; «+ Añadir subcuenta» es la acción.
//
// Sin plan activado: se activa aquí, eligiendo subcuenta por proveedor o
// cuenta común, y la pantalla dice lo que ha creado (regla 8).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaFichaProveedor, rutaMayor, rutaPlan, rutaPlanSitio, rutaTablasGenerales } from '@/config/navegacion'
import { Chip, ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { CampoLista, CampoTexto, Resultado } from '@/modules/conta/empresa/campos'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { cuentasPorGrupo, encaja, lineaDelPlan, type CuentaPlan } from '@/modules/conta/lib/planVista'
import {
  abiertosPorDefecto, arbolPlan, duenoDeCuenta, ejemplosDeIva, estaAbierto, filasBuscadas, filasVisibles, resumenNodo, textoRuta, tieneHijos, type NodoPlan,
} from '@/modules/conta/lib/planArbol'
import { limpiarPalabras, siguienteLibre, type Entidad } from '@/modules/conta/lib/planEmpresa'
import { activarPlan, anadirSubcuenta, deshacerSubcuenta, ocultarCuenta, ponerPalabras, renombrarCuenta, type DatosPlan } from '@/modules/conta/services/planService'
import { RegistroPlan } from '@/modules/conta/plan/RegistroPlan'
import { PropuestasPlan } from '@/modules/conta/plan/PropuestasPlan'
import { propuestasDelPlan } from '@/modules/conta/lib/propuestasPlan'
import { nombreCorto } from '@/modules/conta/lib/importarPlan'
import { TraerPlan } from '@/modules/conta/plan/TraerPlan'
import { DeshacerTraido } from '@/modules/conta/plan/DeshacerTraido'

const GRUPOS: Record<number, string> = {
  1: 'Financiación básica', 2: 'Inmovilizado', 3: 'Existencias', 4: 'Acreedores y deudores', 5: 'Cuentas financieras',
  6: 'Compras y gastos', 7: 'Ventas e ingresos', 8: 'Gastos imputados al patrimonio neto', 9: 'Ingresos imputados al patrimonio neto',
}


// ── Activar ─────────────────────────────────────────────────────────────────

function Activar({ p }: { p: DatosPlan }) {
  const { quien, plan } = useAjustes()
  const [comun, setComun] = useState(false)
  const h = useHacer(plan.recargar)
  const resultado = useRef('')
  return (
    <section className="cx-tarjeta cx-apartado" aria-labelledby="activar-titulo">
      <h2 id="activar-titulo" className="cx-tarjeta-titulo">Activar el plan contable</h2>
      <p className="cx-ayuda">
        Folvy copia las cuentas del plan de {p.plan === 'pymes' ? 'pymes' : 'general'} (las del BOE, con su título oficial) con {p.digitos} dígitos,
        y crea las subcuentas que ya se pueden crear: las del IVA por cada tipo, una por cada banco y una por cada proveedor
        ({p.proveedores.length} {p.proveedores.length === 1 ? 'proveedor' : 'proveedores'}, {p.bancos.length} {p.bancos.length === 1 ? 'banco' : 'bancos'}).
        Los que te venden mercancía van a 400 y los que te prestan servicios, a 410.
      </p>
      <CampoLista etiqueta="Tus proveedores" valor={comun ? 'comun' : 'cada'} cambiar={(v) => setComun(v === 'comun')} deshabilitado={h.guardando}
        opciones={[{ valor: 'cada', texto: 'Una subcuenta para cada proveedor (para ver el extracto de cada uno)' }, { valor: 'comun', texto: 'Una cuenta común para todos' }]} />
      <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="cx-boton" disabled={h.guardando}
          onClick={() => void h.hacer(async () => {
            const r = await activarPlan(quien.companyId, comun, null)
            resultado.current = `Plan activado: ${r.cuentas} cuentas de serie, ${r.subcuentas} subcuentas y ${r.enlaces} enlaces.${r.avisos.length ? ` Ojo: ${r.avisos.join(' ')}` : ''}`
          }, () => resultado.current)}>
          {h.guardando ? 'Activando…' : 'Activar el plan'}
        </button>
      </div>
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </section>
  )
}

// ── Añadir subcuenta ────────────────────────────────────────────────────────

function AnadirSubcuenta({ p, cerrar }: { p: DatosPlan; cerrar: () => void }) {
  const { quien, plan } = useAjustes()
  const hojas = useMemo(() => p.serie.filter((s) => s.isLeaf), [p.serie])
  const [buscar, setBuscar] = useState('')
  const [hoja, setHoja] = useState('')
  const [nombre, setNombre] = useState('')
  const [plain, setPlain] = useState('')
  const [enlace, setEnlace] = useState('')
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const [creada, setCreada] = useState<{ id: string; code: string } | null>(null)
  const h = useHacer(plan.recargar)
  const candidatas = hojas.filter((s) => encaja(buscar, s)).slice(0, 40)
  const siguiente = hoja ? siguienteLibre(hoja, p.digitos, new Set(p.cuentas.map((c) => c.code))) : null
  const opcionesEnlace = [{ valor: '', texto: 'Ninguno' },
    ...p.proveedores.map((x) => ({ valor: `supplier:${x.id}`, texto: `Proveedor · ${x.name}` })),
    ...p.bancos.map((x) => ({ valor: `bank_account:${x.id}`, texto: `Banco · ${x.name}` }))]
  return (
    <form className="cx-tarjeta cx-tablas-abierta cx-formulario" aria-label="Añadir subcuenta" noValidate onSubmit={(e) => {
      e.preventDefault()
      const f: Record<string, string> = {}
      if (!hoja) f.hoja = 'Elige de qué cuenta cuelga.'
      if (!nombre.trim()) f.nombre = 'Ponle un nombre.'
      if (hoja && !siguiente) f.hoja = `Ya no quedan subcuentas libres en ${hoja}.`
      setFallos(f)
      if (Object.keys(f).length) return
      const [entity, id] = enlace ? enlace.split(':') as [Entidad, string] : [null, null]
      let hecha: { id: string; code: string } | null = null
      void h.hacer(async () => {
        hecha = await anadirSubcuenta(quien.companyId, hoja, nombre.trim(), plain.trim() || null, entity && id ? { entity, id } : null, null)
        setCreada(hecha)
      }, () => `Creada ${hecha?.code} · ${nombre.trim()}, bajo la ${hoja}.`)
    }}>
      <h2 className="cx-tarjeta-titulo">Añadir subcuenta</h2>
      <CampoTexto etiqueta="De qué cuenta cuelga (busca por nombre o número)" valor={buscar} cambiar={setBuscar} deshabilitado={h.guardando} />
      <CampoLista etiqueta="Cuenta" valor={hoja} cambiar={setHoja} fallo={fallos.hoja} deshabilitado={h.guardando}
        opciones={[{ valor: '', texto: 'Elige una' }, ...candidatas.map((s) => ({ valor: s.code, texto: `${s.code} · ${s.name}` }))]} />
      {siguiente && <p className="cx-ayuda">Será la <span className="cx-cifra">{siguiente}</span>: el siguiente número libre.</p>}
      <CampoTexto etiqueta="Nombre" valor={nombre} cambiar={setNombre} fallo={fallos.nombre} deshabilitado={h.guardando} />
      <CampoTexto etiqueta="Qué se apunta aquí (si quieres)" valor={plain} cambiar={setPlain} deshabilitado={h.guardando} />
      <CampoLista etiqueta="Es de un proveedor o un banco (si quieres)" valor={enlace} cambiar={setEnlace} opciones={opcionesEnlace} deshabilitado={h.guardando} />
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={cerrar} disabled={h.guardando}>Cerrar</button>
        {creada && (
          <button type="button" className="cx-boton-sec" disabled={h.guardando}
            onClick={() => void h.hacer(async () => { await deshacerSubcuenta(creada.id, null); setCreada(null) }, `Deshecho: ya no está la ${creada.code}.`)}>
            Deshacer
          </button>
        )}
        <button type="submit" className="cx-boton" disabled={h.guardando}>{h.guardando ? 'Guardando…' : 'Añadir'}</button>
      </div>
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </form>
  )
}

// ── Una cuenta, desde su «···» ──────────────────────────────────────────────

/** Marca de la reserva del BOE (respuesta 4): la definición del PGC, no un texto escrito para hostelería. */
function Pgc() {
  return <> <span className="cx-plan-pgc" title="Definición del Plan General de Contabilidad (BOE, quinta parte)">(PGC)</span></>
}

type Modo = 'nombre' | 'palabras'

/** Lo que se edita desde el «···» de una fila: el nombre (si es tuya) o sus palabras clave. Debajo de la fila. */
function PanelCuenta({ c, modo, cerrar }: { c: CuentaPlan; modo: Modo; cerrar: () => void }) {
  const { plan } = useAjustes()
  const h = useHacer(plan.recargar)
  const [palabras, setPalabras] = useState(c.keywords.join(', '))
  const [nombre, setNombre] = useState(c.name)
  return (
    <div className="cx-tablas-detalle">
      {modo === 'nombre' ? (
        <form className="cx-formulario" aria-label={`Cambiar el nombre de ${c.code}`} onSubmit={(e) => {
          e.preventDefault()
          let queda = ''
          void h.hacer(async () => { queda = await renombrarCuenta(c.id, nombre, null) }, () => `${c.code} se llama ahora ${queda}. Queda en el historial del plan.`)
        }}>
          <CampoTexto etiqueta="Nombre" valor={nombre} cambiar={setNombre} deshabilitado={h.guardando} />
          <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="cx-boton-sec" disabled={h.guardando}>Guardar el nombre</button>
            <button type="button" className="cx-enlace" onClick={cerrar}>Cerrar</button>
          </div>
        </form>
      ) : (
        <form className="cx-formulario" aria-label={`Palabras clave de ${c.code}`} onSubmit={(e) => {
          e.preventDefault()
          const v = limpiarPalabras(palabras.split(','))
          void h.hacer(async () => { await ponerPalabras(c.id, v, null) }, v.length ? `Palabras clave de ${c.code}: ${v.join(', ')}.` : `${c.code} ya no tiene palabras clave.`)
        }}>
          <CampoTexto etiqueta="Palabras clave (separadas por comas): para que el buscador la encuentre con tus palabras" valor={palabras} cambiar={setPalabras} deshabilitado={h.guardando} />
          <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="cx-boton-sec" disabled={h.guardando}>Guardar palabras</button>
            <button type="button" className="cx-enlace" onClick={cerrar}>Cerrar</button>
          </div>
        </form>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </div>
  )
}

/** «···» de una cuenta: el Mayor, la ficha de su dueño, cambiar nombre, palabras clave y ocultar. */
function MenuCuenta({ n, c, p, abrirPanel, ocultar }: {
  n: NodoPlan; c: CuentaPlan; p: DatosPlan; abrirPanel: (m: Modo) => void; ocultar: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  const dueno = duenoDeCuenta(c, p.enlaces)
  const elige = (f: () => void) => () => { setAbierto(false); f() }
  return (
    <div className="cx-plan-mas" ref={caja}>
      <button type="button" className="cx-boton-sec cx-mas" aria-haspopup="menu" aria-expanded={abierto} tabIndex={-1}
        aria-label={`Más de ${n.numero} · ${n.titulo}`} onClick={() => setAbierto((v) => !v)}>···</button>
      {abierto && (
        <div className="cxp-menu" role="menu" aria-label={`Acciones de ${n.numero}`}>
          <Link role="menuitem" to={rutaMayor(n.numero)}>Ver el Mayor</Link>
          {dueno?.tipo === 'proveedor' && <Link role="menuitem" to={rutaFichaProveedor(dueno.id, 'contabilidad')}>Ficha del proveedor</Link>}
          {dueno?.tipo === 'banco' && <Link role="menuitem" to={rutaTablasGenerales('bancos-y-cajas')}>Banco</Link>}
          {c.kind === 'own' && c.status !== 'cerrada' && <button type="button" role="menuitem" onClick={elige(() => abrirPanel('nombre'))}>Cambiar nombre</button>}
          <button type="button" role="menuitem" onClick={elige(() => abrirPanel('palabras'))}>Palabras clave</button>
          {/* Con algo enlazado la base no la deja ocultar: el botón no se enseña para fallar (respuesta 6). */}
          {c.status !== 'cerrada' && !n.lleva && <button type="button" role="menuitem" onClick={elige(ocultar)}>{c.status === 'activa' ? 'Ocultar' : 'Volver a enseñar'}</button>}
        </div>
      )}
    </div>
  )
}

// ── El árbol ────────────────────────────────────────────────────────────────

/** de: el programa del que se trajo el plan («Diez»), para las cuentas traídas (C02c). */
function Origen({ n, de }: { n: NodoPlan; de: string | null }) {
  if (!n.origen) return null
  if (n.origen === 'traida') return <Chip tono="azul">{de ? `Tuya · de ${de}` : 'Tuya · traída'}</Chip>
  return n.origen === 'tuya' ? <Chip tono="azul">Tuya</Chip> : n.origen === 'propuesta' ? <Chip tono="ia">Propuesta</Chip> : <Chip tono="ia">De serie</Chip>
}

const esRama = (n: NodoPlan) => !n.cuentaId

/**
 * El plan como árbol (respuesta 5), con las columnas de siempre. Las ramas
 * (grupo, subgrupo, cuenta del cuadro) se abren y se cierran pinchando en la
 * fila, y su «Abrir» lleva a Sumas y saldos. Las cuentas de apunte y las
 * subcuentas son un enlace a su Mayor, toda la fila; su ▸ despliega las
 * subcuentas. Teclado como un árbol: ↑ ↓ para moverse, → abre o baja, ← cierra
 * o sube, Intro abre la fila. `buscando`: lista plana, con la ruta encima.
 */
function Arbol({ p, filas, abierto, alternar, buscando, panel, abrirPanel, ocultar }: {
  p: DatosPlan; filas: NodoPlan[]; abierto: (clave: string) => boolean; alternar: (clave: string, abrir?: boolean) => void
  buscando: boolean; panel: { id: string; modo: Modo } | null; abrirPanel: (p: { id: string; modo: Modo } | null) => void; ocultar: (c: CuentaPlan) => void
}) {
  const navigate = useNavigate()
  const [foco, setFoco] = useState<string | null>(null)
  const filasRef = useRef(new Map<string, HTMLDivElement>())
  const actual = filas.find((f) => f.clave === foco) ?? filas[0] ?? null
  if (filas.length === 0) return <p className="cx-vacio">Ninguna cuenta encaja con lo que buscas.</p>
  const ir = (clave: string | null | undefined) => {
    if (!clave) return
    setFoco(clave)
    filasRef.current.get(clave)?.focus()
  }
  const activar = (n: NodoPlan) => (esRama(n) ? alternar(n.clave) : navigate(rutaMayor(n.numero)))
  const teclado = (e: React.KeyboardEvent, n: NodoPlan) => {
    const i = filas.findIndex((f) => f.clave === n.clave)
    const conHijos = !buscando && tieneHijos(n)
    switch (e.key) {
      case 'ArrowDown': ir(filas[i + 1]?.clave); break
      case 'ArrowUp': ir(filas[i - 1]?.clave); break
      case 'Home': ir(filas[0]?.clave); break
      case 'End': ir(filas.at(-1)?.clave); break
      case 'ArrowRight':
        if (conHijos && !abierto(n.clave)) alternar(n.clave, true)
        else if (conHijos) ir(filas[i + 1]?.clave)
        break
      case 'ArrowLeft':
        if (conHijos && abierto(n.clave)) alternar(n.clave, false)
        else if (!buscando && n.padre && filas.some((f) => f.clave === n.padre)) ir(n.padre)
        break
      case 'Enter': activar(n); break
      default: return
    }
    e.preventDefault()
  }
  return (
    <div className="cx-rejilla cx-plan-rejilla" role="treegrid" aria-label="Plan contable">
      <div className="cx-rejilla-cabeza cx-plan-columnas" role="row">
        <span role="columnheader">NÚMERO</span><span role="columnheader">CUENTA · qué se apunta aquí</span>
        <span role="columnheader">LO QUE LLEVAS</span><span role="columnheader">ORIGEN</span><span role="columnheader"><span className="cx-oculto">Acción</span></span>
      </div>
      {filas.map((n) => {
        const conHijos = !buscando && tieneHijos(n)
        const abierta = conHijos && abierto(n.clave)
        const c = n.cuentaId ? p.cuentas.find((x) => x.id === n.cuentaId) ?? null : null
        const resumen = conHijos && !abierta ? resumenNodo(n) : null
        const nivel = buscando ? 1 : n.nivel
        return (
          <div key={n.clave} className={`cx-plan-fila cx-plan-${n.tipo}${c && !n.usada ? ' cx-plan-sin-uso' : ''}${n.estado === 'oculta' ? ' cx-plan-oculta' : ''}${panel?.id === n.clave ? ' cx-plan-abierta' : ''}`}>
            <div className="cx-rejilla-fila cx-plan-columnas cx-plan-nodo" role="row" aria-level={nivel} aria-expanded={conHijos ? abierta : undefined}
              tabIndex={actual?.clave === n.clave ? 0 : -1} ref={(el) => { if (el) filasRef.current.set(n.clave, el); else filasRef.current.delete(n.clave) }}
              style={{ ['--nivel' as string]: nivel - 1 }} data-numero={n.numero}
              onFocus={() => setFoco(n.clave)} onKeyDown={(e) => { if (e.target === e.currentTarget) teclado(e, n) }}
              onClick={(e) => { if ((e.target as HTMLElement).closest('a, button, input, form')) return; activar(n) }}>
              <span role="gridcell" className="cx-cifra cx-plan-numero">
                {conHijos ? (
                  <button type="button" className="cx-plan-flecha" tabIndex={-1} aria-label={`${abierta ? 'Cerrar' : 'Abrir'} ${n.numero} · ${n.titulo}`}
                    onClick={() => alternar(n.clave)}>{abierta ? '▾' : '▸'}</button>
                ) : <span className="cx-plan-flecha" aria-hidden="true" />}
                {n.numero}
              </span>
              <span role="gridcell" className="cx-plan-cuenta">
                {buscando && n.ruta.length > 0 && <span className="cx-plan-ruta">{textoRuta(n)}</span>}
                {esRama(n)
                  ? <span className={n.tipo === 'cuenta' ? 'cx-plan-titulo' : 'cx-plan-titulo-cabecera'}>{n.titulo}{resumen && <span className="cx-plan-resumen"> · {resumen}</span>}</span>
                  : <Link to={rutaMayor(n.numero)} className="cx-plan-titulo cx-plan-enlace" tabIndex={-1}>{n.titulo}{n.estado === 'oculta' ? ' · oculta' : ''}{resumen && <span className="cx-plan-resumen"> · {resumen}</span>}</Link>}
                {n.plain && <span className="cx-plan-plain">{n.plain}{n.plainPgc && <Pgc />}</span>}
              </span>
              <span role="gridcell" className="cx-rejilla-apoyo">{n.lleva ?? ''}</span>
              <span role="gridcell"><Origen n={n} de={p.importacion ? nombreCorto(p.importacion.programa) : null} /></span>
              <span role="gridcell" className="cx-plan-accion">
                {esRama(n)
                  ? <Link to={rutaMayor(n.numero)} className="cx-enlace" tabIndex={-1} aria-label={`Sumas y saldos de ${n.numero} · ${n.titulo}`}>Abrir</Link>
                  : c && <MenuCuenta n={n} c={c} p={p} abrirPanel={(m) => abrirPanel({ id: n.clave, modo: m })} ocultar={() => ocultar(c)} />}
              </span>
            </div>
            {panel?.id === n.clave && c && <PanelCuenta key={panel.modo} c={c} modo={panel.modo} cerrar={() => abrirPanel(null)} />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Móvil (respuesta 5): cada nivel es una pantalla. La fila de una rama abre el
 * siguiente nivel (con «atrás» al de arriba); la de una cuenta abre su Mayor,
 * y si tiene subcuentas, «N subcuentas tuyas ›» las enseña. Buscar aplana.
 */
function ListaMovil({ filas, buscando, nivel }: { filas: NodoPlan[]; buscando: boolean; nivel: (n: NodoPlan) => string }) {
  if (filas.length === 0) return <p className="cx-vacio">Ninguna cuenta encaja con lo que buscas.</p>
  return (
    <div className="cx-lista" aria-label="Plan contable">
      {filas.map((n) => (
        <div key={n.clave} className={`cx-plan-movil-fila${!n.usada ? ' cx-plan-sin-uso' : ''}`}>
          <Link to={esRama(n) ? nivel(n) : rutaMayor(n.numero)} className="cx-lista-fila">
            <span className="cx-lista-fila-texto">
              {buscando && n.ruta.length > 0 && <span className="cx-plan-ruta">{textoRuta(n)}</span>}
              <span className="cx-lista-fila-titulo"><span className="cx-cifra">{n.numero}</span> · {n.titulo}</span>
              {esRama(n)
                ? resumenNodo(n) && <span className="cx-lista-fila-apoyo">{resumenNodo(n)}</span>
                : (n.plain || n.lleva) && <span className="cx-lista-fila-apoyo">{[n.lleva, n.plain].filter(Boolean).join(' · ')}{n.plain && n.plainPgc && <Pgc />}</span>}
            </span>
            <span className="cx-flecha" aria-hidden="true">›</span>
          </Link>
          {!esRama(n) && !buscando && n.subcuentas > 0 && (
            <Link to={nivel(n)} className="cx-enlace cx-plan-movil-subs">{resumenNodo(n)} ›</Link>
          )}
        </div>
      ))}
    </div>
  )
}

function Pie({ p }: { p: DatosPlan }) {
  return (
    <p className="cx-ayuda cx-plan-pie">
      Cuentas del cuadro del {p.plan === 'pymes' ? 'RD 1515/2007 (plan de pymes)' : 'RD 1514/2007 (plan general, con el RD 1/2021)'}, del texto consolidado del BOE,
      con su título oficial; las erratas del propio BOE van corregidas con la cita que lo justifica. La longitud de las subcuentas queda fija con el primer asiento.
    </p>
  )
}

/**
 * Lo abierto y cerrado se recuerda por persona y empresa mientras dura la
 * sesión del navegador (sessionStorage), no en la base. Sin almacenamiento
 * (navegación privada, bloqueado), funciona igual y olvida al recargar.
 */
const leerAbiertos = (clave: string): Map<string, boolean> => {
  try { return new Map(Object.entries(JSON.parse(sessionStorage.getItem(clave) ?? '{}') as Record<string, boolean>)) } catch { return new Map() }
}
function useAbiertos(clave: string) {
  const [estado, setEstado] = useState(() => ({ clave, tocados: leerAbiertos(clave) }))
  // Otra empresa u otra persona: se lee lo suyo (ajuste durante el render, sin efecto).
  if (estado.clave !== clave) setEstado({ clave, tocados: leerAbiertos(clave) })
  const poner = (k: string, v: boolean) => setEstado((e) => {
    const tocados = new Map(e.tocados).set(k, v)
    try { sessionStorage.setItem(e.clave, JSON.stringify(Object.fromEntries(tocados))) } catch { /* sin almacenamiento: se olvida al recargar */ }
    return { clave: e.clave, tocados }
  })
  return { tocados: estado.tocados, poner }
}

function Contenido() {
  const { plan, movil, quien, hoy } = useAjustes()
  const [params] = useSearchParams()
  const [grupo, setGrupo] = useState<string>('4')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<'usadas' | 'todas'>('usadas')
  const [panel, setPanel] = useState<{ id: string; modo: Modo } | null>(null)
  const [anadiendo, setAnadiendo] = useState(false)
  // C02c: «No, empiezo de cero» (la activación normal) en vez de traer el plan; y lo que se ha traído o deshecho, en una frase.
  const [deCero, setDeCero] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const accion = useHacer(plan.recargar)
  const p = plan.datos
  const { tocados, poner } = useAbiertos(`conta.plan.abiertos.${quien.userId ?? 'anon'}.${quien.companyId}`)
  const arbol = useMemo(() => (p ? arbolPlan({
    serie: p.serie, cuentas: p.cuentas, enlaces: p.enlaces, plainDe: ejemplosDeIva(p.cuentas, p.enlaces, p.paraPropuestas.tiposIva),
  }) : null), [p])
  const porDefecto = useMemo(() => (arbol ? abiertosPorDefecto(arbol, grupo, orden) : new Set<string>()), [arbol, grupo, orden])
  const abierto = (k: string) => estaAbierto(k, tocados, porDefecto)
  const alternar = (k: string, abrir?: boolean) => poner(k, abrir ?? !abierto(k))
  const buscando = busqueda.trim() !== ''
  const filas = !arbol ? [] : buscando ? filasBuscadas(arbol, p!.cuentas, p!.serie, busqueda) : filasVisibles(arbol, grupo, abierto, orden)
  // Lo que propone la IA (tarea 5). Los apuntes llegan con el C04: sin ellos no hay «sin uso».
  const propuestas = useMemo(() => (p && p.activo ? propuestasDelPlan({
    digitos: p.digitos, serie: p.serie, cuentas: p.cuentas, enlaces: p.enlaces,
    proveedores: p.paraPropuestas.proveedores, bancos: p.bancos, gastos: p.paraPropuestas.gastos, tiposIva: p.paraPropuestas.tiposIva,
    ultimoApunte: new Map(), hoy, contestadas: new Set(p.paraPropuestas.contestadas),
  }) : []), [p, hoy])

  // Móvil: el nivel que se está mirando (?n=400) y el de arriba, para «atrás».
  const nivelMovil = params.get('n')
  const nodoMovil = arbol && nivelMovil ? (arbol.nodos.get(nivelMovil) ?? arbol.porCodigo.get(nivelMovil) ?? null) : null
  const rutaNivel = (n: NodoPlan) => `${rutaPlan()}?n=${encodeURIComponent(n.numero)}`
  const arriba = nodoMovil?.padre && arbol?.nodos.get(nodoMovil.padre)
  const cabezaMovil = (derecha?: ReactNode) => nodoMovil
    ? <CabeceraEntradaMovil titulo={`${nodoMovil.numero} · ${nodoMovil.titulo}`} antetitulo="Plan contable" atras={arriba && arriba.tipo !== 'grupo' ? rutaNivel(arriba) : rutaPlan()} />
    : <CabeceraEntradaMovil titulo="Plan contable" derecha={derecha} />
  if (plan.cargando) return <>{movil && cabezaMovil()}<TarjetaCargando /></>
  if (plan.error || !p || !arbol) return <>{movil && cabezaMovil()}<ErrorConReintento mensaje={plan.error ?? 'No se ha podido leer.'} reintentar={plan.recargar} /></>

  const botones = p.activo && (
    <div className="cx-plan-botones">
      <Link to={rutaPlanSitio()} className="cx-boton-sec">Qué va a cada sitio</Link>
      <button type="button" className="cx-boton" onClick={() => setAnadiendo(true)} aria-label="Añadir subcuenta">{movil ? '+' : '+ Añadir subcuenta'}</button>
    </div>
  )
  const cabeza = movil ? cabezaMovil(p.activo ? <button type="button" className="cx-boton cx-mas" onClick={() => setAnadiendo(true)} aria-label="Añadir subcuenta">+</button> : undefined) : (
    <div className="cx-ajustes-panel-cabeza cx-plan-cabeza">
      <div>
        <h2 className="cx-ajustes-panel-titulo">Plan contable</h2>
        <p className="cx-ayuda" style={{ margin: 0 }}>{lineaDelPlan(p)}</p>
      </div>
      {botones}
    </div>
  )
  const avisoTraer = aviso && <Resultado hecho={aviso} fallo={null} />
  if (!p.activo) {
    return (
      <>
        {cabeza}
        {avisoTraer}
        {deCero
          ? <><button type="button" className="cx-enlace cx-traer-volver" onClick={() => setDeCero(false)}>‹ Vengo de otro programa</button><Activar p={p} /></>
          : <TraerPlan p={p} empezarDeCero={() => setDeCero(true)} alTraer={(f) => { setAviso(f); setDeCero(false) }} />}
        <Pie p={p} />
      </>
    )
  }
  const deshacer = (r: { que?: string }) => (r.que === 'importado' && p.importacion
    ? <DeshacerTraido importacion={p.importacion} alDeshacer={(f) => { setAviso(f); plan.recargar() }} /> : null)

  const porGrupo = cuentasPorGrupo(p.cuentas)
  const grupos = [...porGrupo.keys()].sort()
  const ocultar = (c: CuentaPlan) => void accion.hacer(async () => { await ocultarCuenta(c.id, c.status === 'activa', null) },
    c.status === 'activa' ? `${c.code} oculta: no sale en listas ni en sugerencias.` : `${c.code} vuelve a verse.`)
  // En el móvil, con un nivel abierto, se ven sus hijas; sin él, las del grupo elegido.
  const filasMovil = buscando ? filas : (nodoMovil ? nodoMovil.hijos : arbol.nodos.get(grupo)?.hijos ?? []).map((k) => arbol.nodos.get(k)!)
  return (
    <>
      {cabeza}
      {avisoTraer}
      {movil && !nodoMovil && <p className="cx-ayuda" style={{ margin: 0 }}>{lineaDelPlan(p)}</p>}
      {!nodoMovil && <PropuestasPlan propuestas={propuestas} companyId={quien.companyId} quien={null} alCambiar={plan.recargar} />}
      {anadiendo && <AnadirSubcuenta p={p} cerrar={() => setAnadiendo(false)} />}
      <section className="cx-tarjeta cx-plan" aria-label="Cuentas">
        <div className="cx-tablas-barra">
          <input className="cx-input cx-buscar" type="search" aria-label="Buscar una cuenta" placeholder="Busca: «alquiler», «472», «Glovo»"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {!(movil && nodoMovil) && (
            <div className="cx-tablas-filtros" role="group" aria-label="Orden">
              <button type="button" className="cx-pildora" aria-pressed={orden === 'usadas'} onClick={() => setOrden('usadas')}>Las que usas</button>
              <button type="button" className="cx-pildora" aria-pressed={orden === 'todas'} onClick={() => setOrden('todas')}>Todas</button>
            </div>
          )}
        </div>
        {!(movil && nodoMovil) && (
          <div className="cx-tablas-filtros" role="group" aria-label="Grupo del plan">
            {grupos.map((g) => (
              <button key={g} type="button" className="cx-pildora" aria-pressed={grupo === String(g) && !buscando} onClick={() => { setGrupo(String(g)); setBusqueda('') }}>
                {g} · {GRUPOS[g]} <span className="cx-tablas-cuenta">{porGrupo.get(g)}</span>
              </button>
            ))}
          </div>
        )}
        {buscando && <p className="cx-ayuda" style={{ margin: 0 }}>Buscando en todo el plan.</p>}
        <Resultado hecho={accion.hecho} fallo={accion.fallo} />
        {movil
          ? <ListaMovil filas={filasMovil} buscando={buscando} nivel={rutaNivel} />
          : <Arbol p={p} filas={filas} abierto={abierto} alternar={alternar} buscando={buscando} panel={panel} abrirPanel={setPanel} ocultar={ocultar} />}
      </section>
      {!nodoMovil && <RegistroPlan registro={p.registro.slice(0, 10)} titulo="Historial de cambios" movil={movil} accion={deshacer} />}
      {!nodoMovil && <Pie p={p} />}
    </>
  )
}

export default function PlanContablePage() {
  return <MarcoAjustes entrada="plan"><Contenido /></MarcoAjustes>
}
