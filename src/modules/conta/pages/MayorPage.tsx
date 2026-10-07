// src/modules/conta/pages/MayorPage.tsx
//
// Una cuenta del plan, en /conta/plan/<código> (respuesta 5 del C02). Lo que
// se abre al pinchar en ella, como en Diez, Holded, Pennylane o QuickBooks: la
// cuenta lleva a su Mayor; editar es secundario.
//
//   · Cuenta de apunte o subcuenta (40000002, 47200010, 57200001, 62100000):
//     «Mayor de la cuenta». Cabecera con código, nombre, «qué se apunta aquí»,
//     saldo y ejercicio, y los enlaces según de quién es la cuenta (proveedor →
//     su ficha; banco → Bancos y cajas; subcuenta tuya → Cambiar nombre y
//     Ocultar; de serie → nada que editar). Debajo, el extracto en sus dos
//     vistas: la MISMA pieza que la ficha del proveedor (ExtractoCuenta).
//   · Cuenta con hijas (400, 472, el grupo 4): «Sumas y saldos» de ese nivel,
//     una fila por hija con debe, haber y saldo del ejercicio.
//
// Los apuntes los pone el libro diario (C04): el Mayor lee los asientos
// validados de la cuenta y las sumas y saldos de su nivel. Sin apuntes, el
// saldo, el extracto y las sumas lo dicen, sin ceros que parezcan datos.
// Impuestos › IVA aún no tiene pantalla: su enlace no se enseña hasta que la tenga.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rutaFichaProveedor, rutaFichaTercero, rutaMayor, rutaPlan, rutaTablasGenerales } from '@/config/navegacion'
import { Chip, Dato, ErrorConReintento, Tarjeta, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'
import { CampoTexto, Resultado } from '@/modules/conta/empresa/campos'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { ejercicioActual } from '@/modules/conta/empresa/datosEmpresa'
import { arbolPlan, cuentasDentro, duenoDeCuenta, ejemplosDeIva, hijasDe, resumenNodo, type NodoPlan } from '@/modules/conta/lib/planArbol'
import { ocultarCuenta, renombrarCuenta, type DatosPlan } from '@/modules/conta/services/planService'
import { ExtractoCuenta } from '@/modules/conta/plan/ExtractoCuenta'
import { RegistroPlan } from '@/modules/conta/plan/RegistroPlan'
import { extracto, type Apunte } from '@/modules/conta/lib/cuentasProveedor'
import { apuntesDeCuentas, sumasYSaldos, type SumaCuenta } from '@/modules/conta/services/libroService'
import { eurosExactos } from '@/modules/conta/lib/formato'

/** Lo que se lee del libro, con su estado de carga. */
function useDelLibro<T>(leer: (() => Promise<T>) | null, clave: string): { datos: T | null; error: string | null; recargar: () => void } {
  const [r, setR] = useState<{ clave: string; datos: T | null; error: string | null }>({ clave: '', datos: null, error: null })
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    if (!leer) return
    let vivo = true
    leer().then((datos) => { if (vivo) setR({ clave, datos, error: null }) },
      (e: unknown) => { if (vivo) setR({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clave` resume lo que se lee
  }, [clave, vuelta])
  const vale = r.clave === clave
  return { datos: vale ? r.datos : null, error: vale ? r.error : null, recargar: () => setVuelta((v) => v + 1) }
}

/** Saldo de una cuenta en el Mayor: deudor o acreedor, nunca un signo suelto. */
function textoSaldoMayor(saldo: number): string {
  if (Math.round(saldo * 100) === 0) return 'Saldada · 0,00 €'
  return `${eurosExactos(Math.abs(saldo))} ${saldo > 0 ? 'deudor' : 'acreedor'}`
}

function Pgc() {
  return <> <span className="cx-plan-pgc" title="Definición del Plan General de Contabilidad (BOE, quinta parte)">(PGC)</span></>
}

function Volver() {
  return <Link to={rutaPlan()} className="cx-enlace cx-mayor-volver">‹ Plan contable</Link>
}

// ── Mayor de una cuenta ─────────────────────────────────────────────────────

function Mayor({ n, p }: { n: NodoPlan; p: DatosPlan }) {
  const { plan, datos, hoy, movil, quien } = useAjustes()
  const libro = useDelLibro<Apunte[]>(n.cuentaId ? () => apuntesDeCuentas(quien.accountId, quien.companyId, [n.cuentaId!]) : null,
    `${quien.accountId}:${quien.companyId}:${n.cuentaId}`)
  const apuntes = libro.datos ?? []
  const saldo = apuntes.length ? extracto(apuntes, 0, 'deudora').at(-1)!.saldo : null
  const h = useHacer(plan.recargar)
  const [renombrando, setRenombrando] = useState(false)
  const c = p.cuentas.find((x) => x.id === n.cuentaId)!
  const [nombre, setNombre] = useState(c.name)
  const dueno = duenoDeCuenta(c, p.enlaces)
  const ejercicios = (datos.datos?.ejercicios ?? []).map((e) => ({ code: e.code, inicio: e.startsOn, fin: e.endsOn }))
  const ej = ejercicioActual(datos.datos?.ejercicios ?? [], hoy)
  const propia = c.kind === 'own'
  const enlaces = [
    dueno?.tipo === 'proveedor' && (
      <Link key="p" to={rutaFichaProveedor(dueno.id, 'contabilidad')} className="cx-boton-sec">
        Ficha del proveedor{p.proveedores.find((x) => x.id === dueno.id) ? ` · ${p.proveedores.find((x) => x.id === dueno.id)!.name}` : ''}
      </Link>
    ),
    // C03: una cuenta de cliente es de un tercero (party): abre su ficha.
    dueno?.tipo === 'cliente' && (
      <Link key="c" to={rutaFichaTercero(dueno.id, 'contabilidad')} className="cx-boton-sec">Ficha del cliente</Link>
    ),
    dueno?.tipo === 'banco' && (
      <Link key="b" to={rutaTablasGenerales('bancos-y-cajas')} className="cx-boton-sec">
        Banco{p.bancos.find((x) => x.id === dueno.id) ? ` · ${p.bancos.find((x) => x.id === dueno.id)!.name}` : ''}
      </Link>
    ),
    propia && c.status !== 'cerrada' && (
      <button key="r" type="button" className="cx-boton-sec" aria-expanded={renombrando} onClick={() => { setNombre(c.name); setRenombrando((v) => !v) }}>Cambiar nombre</button>
    ),
    // Con algo enlazado no se deja ocultar (lo dice la base): el botón no se enseña para fallar.
    propia && c.status !== 'cerrada' && !n.lleva && (
      <button key="o" type="button" className="cx-boton-sec" disabled={h.guardando}
        onClick={() => void h.hacer(async () => { await ocultarCuenta(c.id, c.status === 'activa', null) },
          c.status === 'activa' ? `${c.code} oculta: no sale en listas ni en sugerencias.` : `${c.code} vuelve a verse.`)}>
        {c.status === 'activa' ? 'Ocultar' : 'Volver a enseñar'}
      </button>
    ),
  ].filter(Boolean)
  return (
    <>
      <section className="cx-tarjeta cx-mayor" aria-label="Mayor de la cuenta">
        {!movil && (
          <div className="cx-mayor-cabeza">
            <Volver />
            <span className="cx-mayor-ante">Mayor de la cuenta</span>
            <h2 className="cx-ajustes-panel-titulo"><span className="cx-cifra">{c.code}</span> · {c.name}</h2>
          </div>
        )}
        {n.plain && <p className="cx-ayuda" style={{ margin: 0 }}>Qué se apunta aquí: {n.plain}{n.plainPgc && <Pgc />}</p>}
        <div className="cx-mayor-datos">
          <Dato etiqueta="Saldo" vacio={libro.datos ? 'Sin apuntes todavía' : 'Leyendo…'}>{saldo === null ? null : textoSaldoMayor(saldo)}</Dato>
          <Dato etiqueta="Ejercicio" vacio="Sin abrir">{ej?.code}</Dato>
          <Dato etiqueta="Lo que lleva" vacio="Nada enlazado">{n.lleva}</Dato>
          <Dato etiqueta="Origen">{propia ? <Chip tono="azul">Tuya</Chip> : <Chip tono="ia">De serie</Chip>}</Dato>
        </div>
        {enlaces.length > 0 ? <div className="cx-mayor-enlaces">{enlaces}</div>
          : !propia && <p className="cx-ayuda" style={{ margin: 0 }}>Es de serie: su título es el oficial y no se cambia.</p>}
        {renombrando && (
          <form className="cx-formulario" aria-label={`Cambiar el nombre de ${c.code}`} onSubmit={(e) => {
            e.preventDefault()
            let queda = ''
            void h.hacer(async () => { queda = await renombrarCuenta(c.id, nombre, null) }, () => `${c.code} se llama ahora ${queda}. Queda en el historial del plan.`)
              .then((ok) => { if (ok) setRenombrando(false) })
          }}>
            <CampoTexto etiqueta="Nombre" valor={nombre} cambiar={setNombre} deshabilitado={h.guardando} />
            <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
              <button type="submit" className="cx-boton" disabled={h.guardando}>{h.guardando ? 'Guardando…' : 'Guardar el nombre'}</button>
              <button type="button" className="cx-boton-sec" onClick={() => setRenombrando(false)}>Cancelar</button>
            </div>
          </form>
        )}
        <Resultado hecho={h.hecho} fallo={h.fallo} />
      </section>
      {libro.error ? <ErrorConReintento mensaje={libro.error} reintentar={libro.recargar} /> : (
        <ExtractoCuenta ejercicios={ejercicios} apuntes={apuntes} naturaleza="deudora"
          vacio={(e) => ({
            titulo: libro.datos ? 'Aún no hay apuntes en esta cuenta.' : 'Leyendo los apuntes…',
            explicacion: `Cuando se valide un asiento que la use, aquí verás cada apunte con su saldo y, por meses, el debe, el haber y el saldo del ejercicio ${e}, con su apertura y su cierre.`,
          })}
          documento={(a) => (a.asiento
            ? <span>{a.documento} <span className="cx-cifra">· {a.asiento.serie}/{a.asiento.numero}</span>{a.asiento.anulado && <> <Chip>Anulado</Chip></>}</span>
            : a.documento)} />
      )}
      <RegistroPlan registro={p.registro.filter((r) => r.code === c.code)} titulo={`Historial de ${c.code}`} movil={movil} />
    </>
  )
}

// ── Sumas y saldos de un nivel ──────────────────────────────────────────────

function SumasYSaldos({ n, hijas, dentro }: { n: NodoPlan; hijas: NodoPlan[]; dentro: (x: NodoPlan) => Set<string> }) {
  const { datos, hoy, movil, quien } = useAjustes()
  const ej = ejercicioActual(datos.datos?.ejercicios ?? [], hoy)
  const desde = ej?.startsOn ?? `${hoy.slice(0, 4)}-01-01`
  const hasta = ej?.endsOn ?? `${hoy.slice(0, 4)}-12-31`
  const libro = useDelLibro<SumaCuenta[]>(() => sumasYSaldos(quien.companyId, desde, hasta), `${quien.companyId}:${desde}:${hasta}`)
  // Cada hija suma su cuenta y todas las que cuelgan de ella (las subcuentas
  // de la 40000000 van en la fila de la 40000000).
  const deHija = (x: NodoPlan) => {
    const ids = dentro(x)
    const filas = (libro.datos ?? []).filter((s) => ids.has(s.companyAccountId))
    return filas.length ? { debe: filas.reduce((t, s) => t + s.debe, 0), haber: filas.reduce((t, s) => t + s.haber, 0) } : null
  }
  const conApuntes = hijas.some((x) => deHija(x))
  return (
    <section className="cx-tarjeta cx-mayor" aria-label="Sumas y saldos">
      {!movil && (
        <div className="cx-mayor-cabeza">
          <Volver />
          <span className="cx-mayor-ante">Sumas y saldos</span>
          <h2 className="cx-ajustes-panel-titulo"><span className="cx-cifra">{n.numero}</span> · {n.titulo}</h2>
        </div>
      )}
      <p className="cx-ayuda" style={{ margin: 0 }}>{[resumenNodo(n), ej ? `ejercicio ${ej.code}` : null].filter(Boolean).join(' · ')}</p>
      {libro.error && <ErrorConReintento mensaje={libro.error} reintentar={libro.recargar} />}
      {!libro.error && !conApuntes && (
        <Vacio titulo={libro.datos ? 'Aún no hay apuntes en este nivel.' : 'Leyendo las sumas…'}
          explicacion={`Cuando se valide un asiento que use alguna de sus cuentas, aquí verás, por cada cuenta, el debe, el haber y el saldo del ejercicio${ej ? ` ${ej.code}` : ''}.`} />
      )}
      <table className="cxp-extracto cx-sumas" aria-label={`Sumas y saldos de ${n.numero}`}>
        <thead><tr><th>Cuenta</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
        <tbody>
          {hijas.map((x) => {
            const s = deHija(x)
            return (
              <tr key={x.clave}>
                <td><Link to={rutaMayor(x.numero)}><span className="cx-cifra">{x.numero}</span> · {x.titulo}</Link></td>
                <td>{s ? eurosExactos(s.debe) : '—'}</td><td>{s ? eurosExactos(s.haber) : '—'}</td><td>{s ? textoSaldoMayor(s.debe - s.haber) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function Contenido() {
  const { plan, movil } = useAjustes()
  const { codigo = '' } = useParams()
  const p = plan.datos
  const arbol = useMemo(() => (p ? arbolPlan({
    serie: p.serie, cuentas: p.cuentas, enlaces: p.enlaces, plainDe: ejemplosDeIva(p.cuentas, p.enlaces, p.paraPropuestas.tiposIva),
  }) : null), [p])
  const n = arbol ? (arbol.porCodigo.get(codigo) ?? arbol.nodos.get(codigo) ?? null) : null
  const cabezaMovil = movil && (
    <CabeceraEntradaMovil titulo={n ? `${n.numero} · ${n.titulo}` : codigo} antetitulo={n && !n.cuentaId ? 'Sumas y saldos' : 'Mayor de la cuenta'} atras={rutaPlan()} />
  )
  if (plan.cargando) return <>{cabezaMovil}<TarjetaCargando /></>
  if (plan.error || !p || !arbol) return <>{cabezaMovil}<ErrorConReintento mensaje={plan.error ?? 'No se ha podido leer.'} reintentar={plan.recargar} /></>
  if (!n) {
    return (
      <>
        {cabezaMovil}
        <Tarjeta titulo="Esa cuenta no está en tu plan">
          <Vacio titulo={`No encuentro la ${codigo} en el plan de tu empresa.`} explicacion="Puede que no se haya activado el plan o que el número esté mal escrito." accion={<Link to={rutaPlan()} className="cx-boton">Ir al plan contable</Link>} />
        </Tarjeta>
      </>
    )
  }
  return <>{cabezaMovil}{n.cuentaId ? <Mayor n={n} p={p} /> : <SumasYSaldos n={n} hijas={hijasDe(arbol, n.clave)} dentro={(x) => cuentasDentro(arbol, x.clave)} />}</>
}

export default function MayorPage() {
  return <MarcoAjustes entrada="plan"><Contenido /></MarcoAjustes>
}
