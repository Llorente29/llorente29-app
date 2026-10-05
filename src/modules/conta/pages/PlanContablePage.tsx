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

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rutaPlan, rutaPlanCuenta, rutaPlanSitio } from '@/config/navegacion'
import { Chip, ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { CampoLista, CampoTexto, Resultado } from '@/modules/conta/empresa/campos'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { cuentasPorGrupo, encaja, filasPlan, lineaDelPlan, type CuentaPlan, type FilaPlan } from '@/modules/conta/lib/planVista'
import { limpiarPalabras, siguienteLibre, type Entidad } from '@/modules/conta/lib/planEmpresa'
import { activarPlan, anadirSubcuenta, deshacerSubcuenta, ocultarCuenta, ponerPalabras, type DatosPlan } from '@/modules/conta/services/planService'
import { RegistroPlan } from '@/modules/conta/plan/RegistroPlan'
import { PropuestasPlan } from '@/modules/conta/plan/PropuestasPlan'
import { propuestasDelPlan } from '@/modules/conta/lib/propuestasPlan'

const GRUPOS: Record<number, string> = {
  1: 'Financiación básica', 2: 'Inmovilizado', 3: 'Existencias', 4: 'Acreedores y deudores', 5: 'Cuentas financieras',
  6: 'Compras y gastos', 7: 'Ventas e ingresos', 8: 'Gastos imputados al patrimonio neto', 9: 'Ingresos imputados al patrimonio neto',
}
const NOMBRE_ENTIDAD: Record<Entidad, string> = {
  supplier: 'Proveedor', customer: 'Cliente', bank_account: 'Banco', expense_category: 'Tipo de gasto', tax_rate: 'Tipo de IVA', withholding_rate: 'Retención',
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

// ── Una cuenta abierta ──────────────────────────────────────────────────────

function CuentaAbierta({ c, p }: { c: CuentaPlan; p: DatosPlan }) {
  const { plan } = useAjustes()
  const h = useHacer(plan.recargar)
  const [palabras, setPalabras] = useState(c.keywords.join(', '))
  const enlaces = p.enlaces.filter((l) => l.companyAccountId === c.id)
  const nombreDe = (entity: Entidad, id: string) =>
    entity === 'supplier' ? p.proveedores.find((x) => x.id === id)?.name ?? id : entity === 'bank_account' ? p.bancos.find((x) => x.id === id)?.name ?? id : id
  const historial = p.registro.filter((r) => r.code === c.code)
  return (
    <div className="cx-tablas-detalle">
      {c.plainName && <p className="cx-ayuda" style={{ margin: 0 }}>Qué se apunta aquí: {c.plainName}</p>}
      <div className="cx-seccion-titulo">Enlaces</div>
      {enlaces.length === 0 ? <p className="cx-vacio">Nada apunta a esta cuenta.</p> : (
        <ul className="cx-registro" aria-label={`Lo que apunta a ${c.code}`}>
          {enlaces.map((l) => <li key={`${l.entity}:${l.entityId}:${l.role}`}><span className="cx-fila-titulo">{NOMBRE_ENTIDAD[l.entity]} · {nombreDe(l.entity, l.entityId)}{l.role !== 'principal' ? ` (${l.role})` : ''}</span></li>)}
        </ul>
      )}
      <form className="cx-formulario" aria-label={`Palabras clave de ${c.code}`} onSubmit={(e) => {
        e.preventDefault()
        const v = limpiarPalabras(palabras.split(','))
        void h.hacer(async () => { await ponerPalabras(c.id, v, null) }, v.length ? `Palabras clave de ${c.code}: ${v.join(', ')}.` : `${c.code} ya no tiene palabras clave.`)
      }}>
        <CampoTexto etiqueta="Palabras clave (separadas por comas): para que el buscador la encuentre con tus palabras" valor={palabras} cambiar={setPalabras} deshabilitado={h.guardando} />
        <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
          <button type="submit" className="cx-boton-sec" disabled={h.guardando}>Guardar palabras</button>
          {c.status !== 'cerrada' && (
            <button type="button" className="cx-boton-sec" disabled={h.guardando}
              onClick={() => void h.hacer(async () => { await ocultarCuenta(c.id, c.status === 'activa', null) },
                c.status === 'activa' ? `${c.code} oculta: no sale en listas ni en sugerencias.` : `${c.code} vuelve a verse.`)}>
              {c.status === 'activa' ? 'Ocultar' : 'Volver a enseñar'}
            </button>
          )}
        </div>
      </form>
      {c.kind === 'template' && <p className="cx-ayuda" style={{ margin: 0 }}>Es de serie: su título es el oficial y no se cambia; se puede ocultar y darle palabras clave.</p>}
      {historial.length > 0 && <RegistroPlan registro={historial} titulo={`Historial de ${c.code}`} />}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </div>
  )
}

// ── La tabla ────────────────────────────────────────────────────────────────

function Origen({ f }: { f: FilaPlan }) {
  if (!f.origen) return null
  return f.origen === 'tuya' ? <Chip tono="azul">Tuya</Chip> : f.origen === 'propuesta' ? <Chip tono="ia">Propuesta</Chip> : <Chip tono="ia">De serie</Chip>
}

function Tabla({ p, filas, abierta, abrir }: { p: DatosPlan; filas: FilaPlan[]; abierta: string | null; abrir: (id: string | null) => void }) {
  if (filas.length === 0) return <p className="cx-vacio">Ninguna cuenta encaja con lo que buscas.</p>
  return (
    <div className="cx-rejilla cx-plan-rejilla" role="table" aria-label="Plan contable">
      <div className="cx-rejilla-cabeza cx-plan-columnas" role="row">
        <span role="columnheader">NÚMERO</span><span role="columnheader">CUENTA · qué se apunta aquí</span>
        <span role="columnheader">LO QUE LLEVAS</span><span role="columnheader">ORIGEN</span><span role="columnheader"><span className="cx-oculto">Acción</span></span>
      </div>
      {filas.map((f) => {
        if (f.tipo === 'subgrupo') return <h3 key={f.clave} className="cx-tablas-grupo" role="row"><span role="cell">{f.numero} · {f.titulo}</span></h3>
        const c = f.cuentaId ? p.cuentas.find((x) => x.id === f.cuentaId)! : null
        const abiertaEsta = c !== null && abierta === c.id
        return (
          <div key={f.clave} className={`cx-plan-fila${f.tipo === 'subcuenta' ? ' cx-plan-sub' : ''}${c && !f.usada ? ' cx-plan-sin-uso' : ''}${abiertaEsta ? ' cx-plan-abierta' : ''}${f.estado === 'oculta' ? ' cx-plan-oculta' : ''}`}>
            <div className="cx-rejilla-fila cx-plan-columnas" role="row">
              <span role="cell" className="cx-cifra cx-plan-numero">{f.numero}</span>
              <span role="cell" className="cx-plan-cuenta">
                <span className={f.tipo === 'cabecera' ? 'cx-plan-titulo-cabecera' : 'cx-plan-titulo'}>{f.titulo}{f.estado === 'oculta' ? ' · oculta' : ''}</span>
                {f.plain && <span className="cx-plan-plain">{f.plain}</span>}
              </span>
              <span role="cell" className="cx-rejilla-apoyo">{f.lleva ?? ''}</span>
              <span role="cell"><Origen f={f} /></span>
              <span role="cell">
                {c && (
                  <button type="button" className="cx-enlace" aria-expanded={abiertaEsta} aria-label={`${abiertaEsta ? 'Cerrar' : 'Abrir'} ${f.numero} · ${f.titulo}`}
                    onClick={() => abrir(abiertaEsta ? null : c.id)}>{abiertaEsta ? 'Cerrar' : 'Abrir'}</button>
                )}
              </span>
            </div>
            {abiertaEsta && c && <CuentaAbierta c={c} p={p} />}
          </div>
        )
      })}
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

function Contenido() {
  const { plan, movil, quien, hoy } = useAjustes()
  const { codigo } = useParams()
  const [grupo, setGrupo] = useState<number | null>(4)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<'usadas' | 'todas'>('usadas')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [anadiendo, setAnadiendo] = useState(false)
  const p = plan.datos
  const filas = useMemo(() => (p ? filasPlan({ serie: p.serie, cuentas: p.cuentas, enlaces: p.enlaces, grupo, busqueda, orden }) : []), [p, grupo, busqueda, orden])
  // Lo que propone la IA (tarea 5). Los apuntes llegan con el C04: sin ellos no hay «sin uso».
  const propuestas = useMemo(() => (p && p.activo ? propuestasDelPlan({
    digitos: p.digitos, serie: p.serie, cuentas: p.cuentas, enlaces: p.enlaces,
    proveedores: p.paraPropuestas.proveedores, bancos: p.bancos, gastos: p.paraPropuestas.gastos, tiposIva: p.paraPropuestas.tiposIva,
    ultimoApunte: new Map(), hoy, contestadas: new Set(p.paraPropuestas.contestadas),
  }) : []), [p, hoy])

  const cabezaMovil = (derecha?: ReactNode) => <CabeceraEntradaMovil titulo="Plan contable" derecha={derecha} />
  if (plan.cargando) return <>{movil && cabezaMovil()}<TarjetaCargando /></>
  if (plan.error || !p) return <>{movil && cabezaMovil()}<ErrorConReintento mensaje={plan.error ?? 'No se ha podido leer.'} reintentar={plan.recargar} /></>

  // Móvil: una cuenta en su pantalla.
  if (movil && codigo) {
    const c = p.cuentas.find((x) => x.code === codigo)
    return (
      <>
        <CabeceraEntradaMovil titulo={c ? `${c.code} · ${c.name}` : codigo} antetitulo="Plan contable" atras={rutaPlan()} />
        {c ? <section className="cx-tarjeta"><CuentaAbierta c={c} p={p} /></section> : <p className="cx-vacio">Esa cuenta no está en tu plan.</p>}
      </>
    )
  }

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
  if (!p.activo) return <>{cabeza}<Activar p={p} /><Pie p={p} /></>

  const porGrupo = cuentasPorGrupo(p.cuentas)
  const grupos = [...porGrupo.keys()].sort()
  return (
    <>
      {cabeza}
      {movil && <p className="cx-ayuda" style={{ margin: 0 }}>{lineaDelPlan(p)}</p>}
      <PropuestasPlan propuestas={propuestas} companyId={quien.companyId} quien={null} alCambiar={plan.recargar} />
      {anadiendo && <AnadirSubcuenta p={p} cerrar={() => setAnadiendo(false)} />}
      <section className="cx-tarjeta cx-plan" aria-label="Cuentas">
        <div className="cx-tablas-barra">
          <input className="cx-input cx-buscar" type="search" aria-label="Buscar una cuenta" placeholder="Busca: «alquiler», «472», «Glovo»"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <div className="cx-tablas-filtros" role="group" aria-label="Orden">
            <button type="button" className="cx-pildora" aria-pressed={orden === 'usadas'} onClick={() => setOrden('usadas')}>Las que usas</button>
            <button type="button" className="cx-pildora" aria-pressed={orden === 'todas'} onClick={() => setOrden('todas')}>Todas</button>
          </div>
        </div>
        <div className="cx-tablas-filtros" role="group" aria-label="Grupo del plan">
          {grupos.map((g) => (
            <button key={g} type="button" className="cx-pildora" aria-pressed={grupo === g && !busqueda} onClick={() => { setGrupo(g); setBusqueda('') }}>
              {g} · {GRUPOS[g]} <span className="cx-tablas-cuenta">{porGrupo.get(g)}</span>
            </button>
          ))}
        </div>
        {busqueda && <p className="cx-ayuda" style={{ margin: 0 }}>Buscando en todo el plan.</p>}
        {movil ? (
          <div className="cx-lista" aria-label="Plan contable">
            {filas.map((f) => f.cuentaId ? (
              <Link key={f.clave} to={rutaPlanCuenta(f.numero)} className={`cx-lista-fila${f.tipo === 'subcuenta' ? ' cx-plan-sub' : ''}${!f.usada ? ' cx-plan-sin-uso' : ''}`}>
                <span className="cx-lista-fila-texto">
                  <span className="cx-lista-fila-titulo"><span className="cx-cifra">{f.numero}</span> · {f.titulo}</span>
                  {(f.plain || f.lleva) && <span className="cx-lista-fila-apoyo">{[f.lleva, f.plain].filter(Boolean).join(' · ')}</span>}
                </span>
                <span className="cx-flecha" aria-hidden="true">›</span>
              </Link>
            ) : (
              <div key={f.clave} className="cx-lista-fila cx-plan-cabecera-movil"><span className="cx-cifra">{f.numero}</span> · {f.titulo}</div>
            ))}
          </div>
        ) : <Tabla p={p} filas={filas} abierta={abierta} abrir={setAbierta} />}
      </section>
      <RegistroPlan registro={p.registro.slice(0, 10)} titulo="Historial de cambios" movil={movil} />
      <Pie p={p} />
    </>
  )
}

export default function PlanContablePage() {
  return <MarcoAjustes entrada="plan"><Contenido /></MarcoAjustes>
}
