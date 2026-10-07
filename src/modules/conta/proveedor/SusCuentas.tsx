// src/modules/conta/proveedor/SusCuentas.tsx
//
// C02, tarea 6 · Las dos tarjetas de la pestaña «Contabilidad» (maqueta
// N7FichaConta): «Sus cuentas» y «Saldo y movimientos», y el extracto en sus
// dos vistas. Lo que se enseña lo decide el núcleo (lib/cuentasProveedor.ts).
//
//   · Cada cuenta propia del proveedor se cambia aquí, con buscador por nombre
//     o número; el cambio va por company_account_link_set y queda en el
//     registro del plan. El IVA no: la cuenta de cada tipo es de la EMPRESA y
//     se cambia en el plan (se dice y se enlaza).
//   · «Sus facturas se apuntan en» se cambia SOLO aquí (respuesta 3): su tipo
//     de gasto (con la cuenta a la que lleva) o una cuenta para él, en el
//     mismo buscador. Su «Cambiar» lleva el id `campo-expenseCategoryId`:
//     ahí llevan «Falta: tipo de gasto» y «Lo que he aprendido».
//   · Cambiar dice qué ha pasado, con contenido (regla 8).
//   · Los apuntes los pone el libro diario (C04): el saldo, el último apunte y
//     el extracto leen los validados de su cuenta (si es la común de
//     proveedores, solo los suyos). Sin apuntes, lo dicen claro, sin ceros
//     que parezcan datos.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Chip, Dato, ErrorConReintento, Tarjeta, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { rutaMayor, rutaPlan, rutaTablasGenerales } from '@/config/navegacion'
import { cuentaEnLaFicha } from '@/modules/conta/lib/opcionesFicha'
import { porUso } from '@/modules/conta/lib/masUsados'
import { encaja } from '@/modules/conta/lib/planVista'
import { euros, fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ExtractoCuenta } from '@/modules/conta/plan/ExtractoCuenta'
import { apuntesDeCuentas, terceroDelProveedor } from '@/modules/conta/services/libroService'
import { rutaAsiento } from '@/config/navegacion'
import {
  cuentasDelProveedor, extracto, textoSaldo, vaAl347,
  type Apunte, type LineaCuenta,
} from '@/modules/conta/lib/cuentasProveedor'
import {
  cargarCuentasProveedor, cambiarCuentaProveedor, quitarCuentaProveedor, type DatosCuentasProveedor,
} from '@/modules/conta/services/cuentasProveedorService'

/** Los apuntes del proveedor en el libro (C04): los de su cuenta; si es la común, solo los suyos. */
function useApuntes(accountId: string, companyId: string | null, cuenta: { id: string; comun: boolean } | null, supplierId: string) {
  const [r, setR] = useState<{ clave: string; apuntes: Apunte[] }>({ clave: '', apuntes: [] })
  const clave = `${accountId}:${companyId}:${cuenta?.id}:${supplierId}`
  useEffect(() => {
    if (!companyId || !cuenta) return
    let vivo = true
    ;(async () => {
      const partyId = cuenta.comun ? await terceroDelProveedor(accountId, supplierId) : null
      // Común y sin tercero: no hay forma de separar sus apuntes; mejor ninguno que los de otros.
      if (cuenta.comun && !partyId) return []
      return apuntesDeCuentas(accountId, companyId, [cuenta.id], partyId)
    })().then((apuntes) => { if (vivo) setR({ clave, apuntes }) }, () => { if (vivo) setR({ clave, apuntes: [] }) })
    return () => { vivo = false }
  }, [accountId, companyId, cuenta, supplierId, clave])
  return r.clave === clave ? r.apuntes : []
}

const QUE_CAMBIA: Record<string, string> = {
  su_cuenta: 'Su cuenta es ahora', facturas: 'Sus facturas van ahora a', pago: 'Le pagas ahora desde', suplidos: 'Sus suplidos van ahora a',
}

/**
 * Lo último leído por empresa: si la pieza se vuelve a montar (al cambiar el
 * tamaño de la ventana, al volver a la pestaña), enseña lo que ya tenía
 * mientras lo vuelve a pedir, en vez del esqueleto.
 */
const ULTIMO = new Map<string, DatosCuentasProveedor>()
/** Los proveedores con el extracto abierto (misma razón). */
const EXTRACTO_ABIERTO = new Set<string>()

function useCuentas(accountId: string, companyId: string | null) {
  const clave = `${accountId}:${companyId ?? ''}`
  const [datos, setDatos] = useState<DatosCuentasProveedor | null>(() => ULTIMO.get(clave) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    if (!companyId) return
    let vivo = true
    cargarCuentasProveedor(accountId, companyId)
      .then((d) => { ULTIMO.set(clave, d); if (vivo) { setDatos(d); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se han podido leer sus cuentas.') })
    return () => { vivo = false }
  }, [accountId, companyId, clave, vuelta])
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  return { datos, error, recargar }
}

export interface TipoElegible { id: string; titulo: string; code: string }

function FilaCuenta({ l, cambiar, quitar, tipos, elegirTipo, idCambiar }: {
  l: LineaCuenta; cambiar: (cuentaId: string) => Promise<void>; quitar: () => Promise<void>
  /** Solo «Sus facturas»: elegir su tipo de gasto, en el mismo buscador. */
  tipos?: readonly TipoElegible[]; elegirTipo?: (id: string) => Promise<void>; idCambiar?: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const opciones = useMemo(() => l.opciones.filter((o) => encaja(busca, { code: o.code, name: o.titulo, plainName: null })), [l.opciones, busca])
  const deTipo = useMemo(() => (tipos ?? []).filter((t) => encaja(busca, { code: t.code, name: t.titulo, plainName: null })), [tipos, busca])
  const total = opciones.length + deTipo.length
  const valor = l.cuentas.length
    // Pinchar en una cuenta lleva a su Mayor (respuesta 5), como en Diez, Holded o QuickBooks.
    ? <>{l.cuentas.map((c, i) => <span key={c.id}>{i > 0 && <span className="cx-dato-vacio"> y </span>}<Link to={rutaMayor(c.code)} className="cxp-cuenta-mayor" aria-label={`Mayor de la cuenta ${c.titulo}`}>{c.titulo}</Link></span>)}</>
    : null
  return (
    <div className="cxp-cuenta">
      <Dato etiqueta={l.etiqueta}>
        {valor ? <>{valor}{l.texto && <span className="cx-dato-vacio">· {l.texto}</span>}</> : <span>{l.texto ?? 'Sin poner'}</span>}
        {l.ia && <Chip tono="ia">IA</Chip>}
        {l.papel && (l.opciones.length > 0 || (tipos?.length ?? 0) > 0) && (
          <button type="button" id={idCambiar} className="cx-enlace" aria-expanded={abierta} aria-label={`Cambiar: ${l.etiqueta}`} onClick={() => setAbierta((a) => !a)}>
            {abierta ? 'Cerrar' : 'Cambiar'}
          </button>
        )}
        {l.clave === 'iva' && <Link to={rutaPlan()} className="cx-enlace">En el plan</Link>}
      </Dato>
      {l.nota && <div className="cx-ayuda cxp-cuenta-nota">{l.nota}</div>}
      {abierta && (
        <div className="cxp-cuenta-elegir">
          <input className="cx-input" placeholder="Busca por nombre o número" aria-label={`Buscar cuenta: ${l.etiqueta}`} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="cx-input" aria-label={`Cuenta: ${l.etiqueta}`} value="" disabled={ocupado}
            onChange={async (e) => {
              const v = e.target.value
              if (!v) return
              setOcupado(true)
              try {
                if (v.startsWith('tipo:') && elegirTipo) await elegirTipo(v.slice(5))
                else await cambiar(v)
                setAbierta(false); setBusca('')
              } finally { setOcupado(false) }
            }}>
            <option value="">{total ? `Elige entre ${total}` : 'Ninguna encaja'}</option>
            {deTipo.length > 0 ? (
              <>
                <optgroup label="Por su tipo de gasto">
                  {deTipo.map((t) => <option key={t.id} value={`tipo:${t.id}`}>{t.titulo}</option>)}
                </optgroup>
                <optgroup label="Una cuenta solo para él">
                  {opciones.map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
                </optgroup>
              </>
            ) : opciones.map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
          </select>
          {l.propia && (
            <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={async () => { setOcupado(true); try { await quitar(); setAbierta(false) } finally { setOcupado(false) } }}>
              {l.clave === 'facturas' ? 'Volver a la de su tipo de gasto' : 'Quitar'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Extracto({ ejercicios, apuntes, alCerrar }: { ejercicios: DatosCuentasProveedor['ejercicios']; apuntes: readonly Apunte[]; alCerrar: () => void }) {
  const { rutaApartado } = useFicha()
  return (
    <ExtractoCuenta ejercicios={ejercicios} apuntes={apuntes}
      accion={<button type="button" className="cx-enlace" onClick={alCerrar}>Cerrar</button>}
      vacio={(ej) => ({
        titulo: 'Aún no hay apuntes con este proveedor.',
        explicacion: `Sus facturas y sus pagos entran en el libro diario al validar sus asientos. Cuando los haya, aquí verás cada apunte con su saldo y, por meses, el debe, el haber y el saldo del ejercicio ${ej}, con su apertura y su cierre.`,
      })}
      documento={(a) => (a.enlace?.tipo === 'asiento'
        ? <Link to={rutaAsiento(a.enlace.id)} aria-label={`Ver el asiento ${a.documento}`}>{a.documento}</Link>
        : a.enlace ? <Link to={rutaApartado('facturas')} aria-label={`${a.enlace.tipo === 'pago' ? 'Ver el pago' : 'Ver la factura'} ${a.documento}`}>{a.documento}</Link> : a.documento)} />
  )
}

export function SusCuentas() {
  const { datos, repetidas, actor, movil, guardar } = useFicha()
  const f = datos.ficha
  const empresaId = datos.opciones.empresa?.id ?? null
  const { datos: d, error, recargar } = useCuentas(f.accountId, empresaId)
  const cuentaSuya = useMemo(() => {
    if (!d?.activo) return null
    const l = d.enlaces.find((x) => x.entity === 'supplier' && x.entityId === f.id && x.role === 'principal')
    const c = l ? d.cuentas.find((x) => x.id === l.companyAccountId) : undefined
    return c ? { id: c.id, comun: c.isCommon } : null
  }, [d, f.id])
  const apuntesLibro = useApuntes(f.accountId, empresaId, cuentaSuya, f.id)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  // Si la pieza se vuelve a montar, el extracto sigue como estaba (abierto o cerrado).
  const [verExtracto, setVer] = useState(() => EXTRACTO_ABIERTO.has(f.id))
  const setVerExtracto = (v: boolean | ((x: boolean) => boolean)) => setVer((x) => {
    const n = typeof v === 'function' ? v(x) : v
    if (n) EXTRACTO_ABIERTO.add(f.id); else EXTRACTO_ABIERTO.delete(f.id)
    return n
  })

  if (!empresaId) {
    return <div className="cx-tarjeta"><Vacio titulo="Sus cuentas salen del plan contable de tu empresa." explicacion="Primero da de alta tu empresa en contabilidad." /></div>
  }
  if (error) return <ErrorConReintento mensaje={error} reintentar={recargar} />
  if (!d) return <TarjetaCargando />
  if (!d.activo) {
    return (
      <div className="cx-tarjeta">
        <Vacio titulo="Tu empresa aún no tiene el plan contable activado."
          explicacion="Al activarlo, cada proveedor recibe su cuenta (400 si te vende mercancía, 410 si te presta servicios) y aquí verás dónde va cada cosa."
          accion={<Link to={rutaPlan()} className="cx-boton">Ir al plan contable</Link>} />
      </div>
    )
  }

  const proveedor = {
    id: f.id, name: f.name, entityKind: f.entityKind, taxIdType: f.taxIdType, countryCode: f.countryCode, vatRegime: f.vatRegime,
    usualTaxRateIds: f.usualTaxRateIds, irpfWithholdingPct: f.irpfWithholdingPct, expenseCategoryId: f.expenseCategoryId,
  }
  const { lineas, datos: extra } = cuentasDelProveedor({ ...d, proveedor })
  const año = Number(hoyEnMadrid().slice(0, 4))
  // Las repetidas no cuentan en ninguna cifra (C01b §4). Un abono llega con el total en negativo.
  const delAño = datos.facturas.filter((x) => !repetidas.has(x.id) && x.invoiceDate?.startsWith(`${año}-`) && x.grandTotal !== null)
  const r347 = vaAl347({ año, perfil: d.perfil, proveedor, facturas: delAño.map((x) => ({ fecha: x.invoiceDate!, total: x.grandTotal!, abono: x.grandTotal! < 0 })) })
  const saldo = apuntesLibro.length ? textoSaldo(extracto(apuntesLibro).at(-1)!.saldo) : null
  const ultimo = apuntesLibro.length ? [...apuntesLibro].sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1)! : null

  // Los tipos de gasto que se pueden elegir: los no ocultos (y el suyo aunque lo esté, regla 30), los más usados primero.
  const tipos: TipoElegible[] = porUso(
    datos.tiposGasto.filter((t) => !t.oculto || t.id === f.expenseCategoryId), (t) => t.id, datos.otros.map((o) => o.expenseCategoryId),
  ).map((t) => ({ id: t.id, code: t.pgcAccountHint, titulo: `${t.name} → ${cuentaEnLaFicha(datos.opciones, t.pgcAccountHint)}${t.oculto ? ' (oculto en tu cuenta)' : ''}` }))
  const facturas = lineas.find((l) => l.clave === 'facturas')
  const elegirTipo = (id: string) => hacer(facturas!, async () => {
    const r = await guardar({ expenseCategoryId: id })
    if (r.errores.length) throw new Error(r.errores.map((e) => e.mensaje).join(' '))
    // Si tenía una cuenta suya, vuelve a la de su tipo.
    if (facturas?.propia) await quitarCuentaProveedor(empresaId, f.id, 'gasto', actor.name)
  }, `Sus facturas van ahora a ${cuentaEnLaFicha(datos.opciones, datos.tiposGasto.find((x) => x.id === id)?.pgcAccountHint ?? '')}, por su tipo de gasto «${datos.tiposGasto.find((x) => x.id === id)?.name ?? ''}».`)

  const hacer = async (l: LineaCuenta, que: () => Promise<void>, frase: string) => {
    setHecho(null); setFallo(null)
    try { await que(); setHecho(frase); recargar() } catch (e) { setFallo(e instanceof Error ? e.message : `No se ha podido cambiar: ${l.etiqueta}.`) }
  }

  return (
    <>
      <div className={movil ? 'cx-columna' : 'cx-rejilla-2'}>
        <Tarjeta titulo="Sus cuentas">
          {lineas.map((l) => (
            <FilaCuenta key={l.clave} l={l}
              {...(l.clave === 'facturas' ? { tipos, elegirTipo, idCambiar: 'campo-expenseCategoryId' } : {})}
              cambiar={(id) => hacer(l, () => cambiarCuentaProveedor(empresaId, f.id, l.papel!, id, actor.name),
                `${QUE_CAMBIA[l.clave] ?? l.etiqueta} ${l.opciones.find((o) => o.id === id)?.titulo ?? ''}. Queda en el historial del plan.`)}
              quitar={() => hacer(l, () => quitarCuentaProveedor(empresaId, f.id, l.papel!, actor.name),
                l.clave === 'facturas' ? 'Sus facturas vuelven a la cuenta de su tipo de gasto.' : `${l.etiqueta}: quitado. Queda en el historial del plan.`)} />
          ))}
          {extra.map((x) => (
            <div key={x.clave} className="cxp-cuenta">
              <Dato etiqueta={x.etiqueta}>{x.valor}</Dato>
              {x.fuente && <div className="cx-ayuda cxp-cuenta-nota">{x.fuente}</div>}
            </div>
          ))}
          <div role="status" aria-live="polite">{hecho && <div className="cx-guardado">{hecho}</div>}</div>
          {fallo && <div className="cx-error" role="alert">{fallo}</div>}
          <p className="cx-ayuda cxp-cuentas-pie">
            Cada línea se cambia con las cuentas de tu plan; las marcadas IA salen de lo que Folvy ha aprendido de sus facturas.{' '}
            <Link to={rutaTablasGenerales('tipos-de-gasto')}>Qué tipos de gasto usa tu negocio</Link>
          </p>
        </Tarjeta>
        <Tarjeta titulo="Saldo y movimientos" accion={<button type="button" className="cx-enlace" aria-expanded={verExtracto} onClick={() => setVerExtracto((v) => !v)}>Ver extracto</button>}>
          <Dato etiqueta="Saldo con él" vacio="Sin apuntes todavía">{saldo && <>{saldo.importe} <span className="cx-dato-vacio">{saldo.lado}</span></>}</Dato>
          <Dato etiqueta="Este año" vacio="Ninguna factura">{delAño.length > 0 && `${euros(r347.importe)} en ${delAño.length} ${delAño.length === 1 ? 'factura' : 'facturas'}`}</Dato>
          <Dato etiqueta="Último apunte" vacio="Sin apuntes todavía">{ultimo && `${fechaLarga(ultimo.fecha)} · ${ultimo.documento}`}</Dato>
          <div className="cxp-cuenta">
            <Dato etiqueta="Va al 347 este año">{r347.texto}</Dato>
            <div className="cx-ayuda cxp-cuenta-nota">{r347.fuente}</div>
          </div>
          <Dato etiqueta="Registro sanitario" vacio="Sin poner">{f.healthRegistryNo && `RGSEAA ${f.healthRegistryNo}`}</Dato>
        </Tarjeta>
      </div>
      {verExtracto && <Extracto ejercicios={d.ejercicios} apuntes={apuntesLibro} alCerrar={() => setVerExtracto(false)} />}
    </>
  )
}
