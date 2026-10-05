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
//   · Cambiar dice qué ha pasado, con contenido (regla 8).
//   · Los apuntes llegan con el C04: hasta entonces el saldo y el extracto lo
//     dicen claro, sin ceros que parezcan datos.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Chip, Dato, ErrorConReintento, Tarjeta, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { rutaPlan } from '@/config/navegacion'
import { encaja } from '@/modules/conta/lib/planVista'
import { euros, eurosExactos, fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  cuentasDelProveedor, extracto, saldosPorMes, textoSaldo, vaAl347,
  type Apunte, type LineaCuenta,
} from '@/modules/conta/lib/cuentasProveedor'
import {
  cargarCuentasProveedor, cambiarCuentaProveedor, quitarCuentaProveedor, type DatosCuentasProveedor,
} from '@/modules/conta/services/cuentasProveedorService'

/** Los apuntes del proveedor. Vacío hasta el C04, que es quien los crea. */
const APUNTES: readonly Apunte[] = []

const QUE_CAMBIA: Record<string, string> = {
  su_cuenta: 'Su cuenta es ahora', facturas: 'Sus facturas van ahora a', pago: 'Le pagas ahora desde', suplidos: 'Sus suplidos van ahora a',
}

/**
 * Lo último leído por empresa: si la pieza se vuelve a montar (al cambiar el
 * tamaño de la ventana, al volver a la pestaña), enseña lo que ya tenía
 * mientras lo vuelve a pedir, en vez del esqueleto.
 */
const ULTIMO = new Map<string, DatosCuentasProveedor>()

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

function FilaCuenta({ l, cambiar, quitar }: { l: LineaCuenta; cambiar: (cuentaId: string) => Promise<void>; quitar: () => Promise<void> }) {
  const [abierta, setAbierta] = useState(false)
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const opciones = useMemo(() => l.opciones.filter((o) => encaja(busca, { code: o.code, name: o.titulo, plainName: null })), [l.opciones, busca])
  const valor = l.cuentas.length
    ? <>{l.cuentas.map((c, i) => <span key={c.id}>{i > 0 && <span className="cx-dato-vacio"> y </span>}{c.titulo}</span>)}</>
    : null
  return (
    <div className="cxp-cuenta">
      <Dato etiqueta={l.etiqueta}>
        {valor ? <>{valor}{l.texto && <span className="cx-dato-vacio">· {l.texto}</span>}</> : <span>{l.texto ?? 'Sin poner'}</span>}
        {l.ia && <Chip tono="ia">IA</Chip>}
        {l.papel && l.opciones.length > 0 && (
          <button type="button" className="cx-enlace" aria-expanded={abierta} aria-label={`Cambiar: ${l.etiqueta}`} onClick={() => setAbierta((a) => !a)}>
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
              if (!e.target.value) return
              setOcupado(true)
              try { await cambiar(e.target.value); setAbierta(false); setBusca('') } finally { setOcupado(false) }
            }}>
            <option value="">{opciones.length ? `Elige entre ${opciones.length}` : 'Ninguna encaja'}</option>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
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

function Extracto({ ejercicios, alCerrar }: { ejercicios: DatosCuentasProveedor['ejercicios']; alCerrar: () => void }) {
  const { rutaApartado } = useFicha()
  const hoy = hoyEnMadrid()
  const [vista, setVista] = useState<'apuntes' | 'meses'>('apuntes')
  const deHoy = ejercicios.find((e) => e.inicio <= hoy && e.fin >= hoy) ?? ejercicios[0] ?? null
  const [code, setCode] = useState(deHoy?.code ?? '')
  const ej = ejercicios.find((e) => e.code === code) ?? deHoy
  const rango = ej ?? { code: hoy.slice(0, 4), inicio: `${hoy.slice(0, 4)}-01-01`, fin: `${hoy.slice(0, 4)}-12-31` }
  const delEjercicio = APUNTES.filter((a) => a.fecha >= rango.inicio && a.fecha <= rango.fin)
  const anteriores = APUNTES.filter((a) => a.fecha < rango.inicio)
  const apertura = extracto(anteriores).at(-1)?.saldo ?? 0
  const filas = extracto(delEjercicio, apertura)
  const meses = saldosPorMes(APUNTES, rango)
  return (
    <Tarjeta titulo="Extracto" accion={<button type="button" className="cx-enlace" onClick={alCerrar}>Cerrar</button>}>
      <div className="cx-chips cxp-extracto-barra">
        <button type="button" className="cx-pildora" aria-pressed={vista === 'apuntes'} onClick={() => setVista('apuntes')}>Apunte a apunte</button>
        <button type="button" className="cx-pildora" aria-pressed={vista === 'meses'} onClick={() => setVista('meses')}>Saldos por mes</button>
        {ejercicios.length > 1 && (
          <select className="cx-input" aria-label="Ejercicio" value={rango.code} onChange={(e) => setCode(e.target.value)} style={{ width: 'auto' }}>
            {ejercicios.map((e) => <option key={e.code} value={e.code}>Ejercicio {e.code}</option>)}
          </select>
        )}
      </div>
      {APUNTES.length === 0 ? (
        <Vacio titulo="Aún no hay apuntes con este proveedor."
          explicacion={`Los asientos de sus facturas y de sus pagos llegan con la contabilidad de facturas recibidas. Cuando los haya, aquí verás cada apunte con su saldo y, por meses, el debe, el haber y el saldo del ejercicio ${rango.code}, con su apertura y su cierre.`} />
      ) : vista === 'apuntes' ? (
        <table className="cxp-extracto">
          <thead><tr><th>Fecha</th><th>Documento</th><th>Concepto</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
          <tbody>
            <tr><td colSpan={5}>Apertura</td><td>{eurosExactos(apertura)}</td></tr>
            {filas.map((a, i) => (
              <tr key={`${a.documento}-${i}`}>
                <td>{fechaLarga(a.fecha)}</td><td>{a.enlace ? <Link to={rutaApartado('facturas')} aria-label={`${a.enlace.tipo === 'pago' ? 'Ver el pago' : 'Ver la factura'} ${a.documento}`}>{a.documento}</Link> : a.documento}</td><td>{a.concepto}</td>
                <td>{a.debe ? eurosExactos(a.debe) : ''}</td><td>{a.haber ? eurosExactos(a.haber) : ''}</td><td>{eurosExactos(a.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="cxp-extracto">
          <thead><tr><th>Mes</th><th>Debe</th><th>Haber</th><th>Saldo</th><th>Acumulado</th></tr></thead>
          <tbody>
            <tr><td>Apertura</td><td /><td /><td /><td>{eurosExactos(meses.apertura)}</td></tr>
            {meses.meses.map((m) => (
              <tr key={m.mes}><td>{m.mes}</td><td>{eurosExactos(m.debe)}</td><td>{eurosExactos(m.haber)}</td><td>{eurosExactos(m.saldo)}</td><td>{eurosExactos(m.acumulado)}</td></tr>
            ))}
            <tr><td>Total del año</td><td>{eurosExactos(meses.debe)}</td><td>{eurosExactos(meses.haber)}</td><td /><td>Cierre {eurosExactos(meses.cierre)}</td></tr>
          </tbody>
        </table>
      )}
    </Tarjeta>
  )
}

export function SusCuentas() {
  const { datos, repetidas, actor, movil } = useFicha()
  const f = datos.ficha
  const empresaId = datos.opciones.empresa?.id ?? null
  const { datos: d, error, recargar } = useCuentas(f.accountId, empresaId)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [verExtracto, setVerExtracto] = useState(false)

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
  const saldo = APUNTES.length ? textoSaldo(extracto(APUNTES).at(-1)!.saldo) : null
  const ultimo = APUNTES.length ? [...APUNTES].sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1)! : null

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
          <p className="cx-ayuda" style={{ margin: '8px 0 0' }}>Cada línea se cambia con las cuentas de tu plan; las marcadas IA salen de lo que Folvy ha aprendido de sus facturas.</p>
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
      {verExtracto && <Extracto ejercicios={d.ejercicios} alCerrar={() => setVerExtracto(false)} />}
    </>
  )
}
