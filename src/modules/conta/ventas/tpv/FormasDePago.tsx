// src/modules/conta/ventas/tpv/FormasDePago.tsx
//
// R06 · «A qué cuenta va cada forma de pago» (maqueta 3), con la factura del día del R07
// (maqueta 4, aprobada por Julio el 19/11). Se abre sola cuando un día trae una forma de
// pago sin cuenta (desde «Cuenta sin elegir» y desde el motivo que impide validar) y
// siempre desde Ajustes › Ventas por día.
//
//   · Arriba, en ámbar, la forma nueva.
//   · «La factura del día»: una fila, «La factura del día va a», con su cuenta (el buscador
//     de siempre; si no hay ninguna, Sumied propone la 430 que ya se llame «contado», o se
//     da de alta desde aquí) y lo que suma en el mes; y desde cuándo va cada día en dos.
//   · «Cómo se ha cobrado»: la forma como la escribe el TPV (Deliverect, partida por
//     plataforma), la cuenta y lo que suma en el mes.
//   · A la derecha, «Cómo quedan los asientos de un día», en vivo: la factura del día y su
//     cobro, uno debajo del otro, los propone la base (conta_tpv_dia_ejemplo →
//     _conta_tpv_propuesta) con las cuentas que se están eligiendo, sin guardar nada.
//   · «Guardar» no se enciende mientras falte una cuenta, y lo dice; al guardar, confirma
//     con contenido y los días que la llevaban pasan a «Listo para validar».

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Boton, Chip } from '@/modules/conta/diseno'
import { BuscarCuentaHoja } from '@/modules/conta/diseno/plantillas'
import {
  avisoFormasNuevas, cifra, desdeDosAsientos, diaCorto, enElMes, esDeliverect, faltaParaGuardar, nombreCanal, rangoTickets, saldoContado, type FormaCuenta,
} from '@/modules/conta/lib/subirTpv'
import {
  altaClientesDeContado, diaEjemplo, guardarFacturaDelDia, guardarFormas, leerCuentasEmpresa, leerFacturaDelDia, leerFormas,
  type AsientoDelDia, type CuentaElegible, type DiaEjemplo, type Eleccion, type FacturaDelDia, type Formas, type LineaDiaEjemplo,
} from '@/modules/conta/services/tpvSubirService'
import { VentanaAncha } from './VentanaAncha'
import { CrearDesdeBuscador } from '@/modules/conta/plan/CrearDesdeBuscador'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import type { CuentaHoja } from '@/modules/conta/diseno/plantillas/valores'

const clave = (f: Pick<FormaCuenta, 'forma' | 'canal'>) => `${f.forma.trim().toLowerCase()}|${f.canal ?? ''}`
const FACTURA = '__factura_del_dia__'

/** Como en la maqueta: lo del local, las plataformas, lo que no tiene cuenta, «Clientes de contado», y después ventas e IVA. */
function ordenAsiento(l: LineaDiaEjemplo): number {
  if (l.contado) return l.debe !== 0 ? 0 : 6
  if (l.debe === 0 && l.haber !== 0) return l.tipo != null ? 5 : 4
  if (l.sin_cuenta) return 3
  return l.forma && esDeliverect(l.forma) ? 2 : 1
}

/** El tipo de IVA detrás del nombre de la cuenta, si el nombre no lo dice ya («IVA repercutido 10 %»). */
function conTipo(nombre: string | null, tipo: number | null | undefined): string {
  if (tipo == null) return ''
  const t = `${Number(tipo).toLocaleString('es-ES')} %`
  return (nombre ?? '').replace(/\s+/g, ' ').includes(t) ? '' : ` ${t}`
}

function TablaAsiento({ a, etiqueta, prueba, pie }: { a: AsientoDelDia; etiqueta: string; prueba: string; pie: ReactNode }) {
  const lineas = a.lineas.map((l, i) => ({ l, i })).sort((x, y) => ordenAsiento(x.l) - ordenAsiento(y.l) || x.i - y.i).map(({ l }) => l)
  return (
    <div className="tpv-tabla-caja tpv-caja-abierta">
      <table className="tpv-asiento" aria-label={etiqueta} data-prueba={prueba}>
        <thead><tr><th>Cuenta</th><th className="tpv-cifra">Debe</th><th className="tpv-cifra">Haber</th></tr></thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i} data-sin-cuenta={l.sin_cuenta ? '' : undefined} data-contado={l.contado ? '' : undefined}>
              <td>{l.sin_cuenta ? `${l.forma ?? ''}${l.canal && l.canal !== 'local' ? ` · ${nombreCanal(l.canal)}` : ''} · sin cuenta`
                : `${l.cuenta} · ${l.nombre ?? ''}${conTipo(l.nombre, l.tipo)}`}</td>
              <td className="tpv-cifra">{l.debe ? cifra(l.debe) : ''}</td>
              <td className="tpv-cifra">{l.haber ? cifra(l.haber) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>{pie}</td><td className="tpv-cifra" colSpan={2}>Debe <strong>{cifra(a.debe)}</strong> · Haber <strong>{cifra(a.haber)}</strong></td></tr></tfoot>
      </table>
    </div>
  )
}

export function FormasDePago({ companyId, quien, diaId = null, alCerrar, alGuardar }: {
  companyId: string
  quien: string | null
  /** El día de ejemplo (el que ha pedido la cuenta); si no, el último sin validar. */
  diaId?: string | null
  alCerrar: () => void
  /** Después de guardar: la lista de detrás se vuelve a leer. */
  alGuardar: () => void
}) {
  const [datos, setDatos] = useState<Formas | null>(null)
  const [cuentas, setCuentas] = useState<CuentaElegible[]>([])
  const [eleccion, setEleccion] = useState<Record<string, string | null>>({})
  /** La factura del día: lo guardado y lo que se elige (el código de la cuenta). */
  const [factura, setFactura] = useState<FacturaDelDia | null>(null)
  const [facturaElegida, setFacturaElegida] = useState<string | null>(null)
  const [ejemplo, setEjemplo] = useState<DiaEjemplo | null>(null)
  const [buscando, setBuscando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [dandoDeAlta, setDandoDeAlta] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const { accountId } = useCuentaConta()
  // X20 · Lo que no está en el buscador se crea aquí mismo (código y nombre) y queda elegido.
  const crear = (q: string, elegir: (c: CuentaHoja) => void) => (
    <CrearDesdeBuscador accountId={accountId} companyId={companyId} q={q} quien={quien}
      alCrear={(c) => { const nueva: CuentaElegible = { id: c.id, codigo: c.code, nombre: c.name }; setCuentas((xs) => [...xs, nueva]); elegir(nueva) }} />
  )
  /** La cuenta elegida en el buscador, por su id (una recién creada aún no está en `cuentas`). */
  const idDe = (c: CuentaHoja) => ('id' in c ? (c as CuentaElegible).id : cuentas.find((y) => y.codigo === c.codigo)?.id ?? null)

  useEffect(() => {
    let vivo = true
    Promise.all([leerFormas(companyId, diaId), leerCuentasEmpresa(companyId)])
      .then(async ([f, c]) => {
        const fd = await leerFacturaDelDia(companyId, f.mes)
        if (!vivo) return
        setDatos(f); setCuentas(c); setFactura(fd)
        setEleccion(Object.fromEntries(f.formas.map((x) => [clave(x), x.cuenta_id])))
        // Sin ninguna elegida, Sumied propone la 430 que ya se llama «contado».
        setFacturaElegida(fd.factura?.cuenta ?? fd.propuesta?.cuenta ?? null)
      })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [companyId, diaId])

  const formas = useMemo(() => datos?.formas ?? [], [datos])
  const elecciones: Eleccion[] = useMemo(() => formas.map((f) => ({ forma: f.forma, canal: f.canal, cuenta_id: eleccion[clave(f)] ?? null })), [formas, eleccion])
  const faltan = elecciones.filter((x) => !x.cuenta_id).length
  const nuevas = formas.filter((f) => f.nueva)
  const facturaId = cuentas.find((x) => x.codigo === facturaElegida)?.id ?? null

  // Los dos asientos de ejemplo, en vivo (los propone la base con lo que se está eligiendo).
  const ejemploDia = datos?.ejemplo ?? null
  const firma = JSON.stringify([elecciones, facturaId])
  useEffect(() => {
    if (!ejemploDia) return
    let vivo = true
    const t = setTimeout(() => {
      diaEjemplo(ejemploDia, elecciones.filter((x) => x.cuenta_id), facturaId)
        .then((r) => { if (vivo) setEjemplo(r) })
        .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    }, 150)
    return () => { vivo = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `firma` resume `elecciones` y la factura
  }, [ejemploDia, firma])

  // Hasta que la base no parte el día en dos (antes de aplicar el R07), la factura del día no se exige.
  const partido = !!ejemplo?.cobro || !!factura?.factura
  const sinFactura = partido && !facturaElegida
  const facturaCambia = !!facturaElegida && facturaElegida !== (factura?.factura?.cuenta ?? null)
  const falta = faltaParaGuardar(faltan, sinFactura)

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      const textos: string[] = []
      const cambiadas = elecciones.filter((x) => x.cuenta_id && x.cuenta_id !== formas.find((f) => clave(f) === clave(x))?.cuenta_id)
      if (formas.length && (cambiadas.length || !facturaCambia)) textos.push((await guardarFormas(companyId, cambiadas.length ? cambiadas : elecciones, quien)).texto)
      if (facturaCambia && facturaElegida) {
        textos.push((await guardarFacturaDelDia(companyId, facturaElegida, quien)).texto)
        setFactura(await leerFacturaDelDia(companyId, datos?.mes ?? null))
      }
      setHecho(textos.join(' '))
      alGuardar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  async function darDeAlta() {
    setDandoDeAlta(true); setError(null)
    try {
      const codigo = await altaClientesDeContado(companyId, quien)
      setCuentas(await leerCuentasEmpresa(companyId))
      setFacturaElegida(codigo); setHecho(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDandoDeAlta(false)
    }
  }

  const nombreCuenta = (id: string | null) => { const c = cuentas.find((x) => x.id === id); return c ? `${c.codigo} · ${c.nombre}` : null }
  const nombreFactura = facturaElegida ? (cuentas.find((x) => x.codigo === facturaElegida)?.nombre ?? factura?.propuesta?.nombre ?? '') : null
  const hayDeliverect = formas.some((f) => esDeliverect(f.forma))
  const plataformas = [...new Set(formas.filter((f) => esDeliverect(f.forma) && f.canal).map((f) => nombreCanal(f.canal)))]
  const rango = ejemplo ? rangoTickets(ejemplo.primero, ejemplo.ultimo) : null

  const izquierda = (
    <>
      {error && <div className="tpv-aviso" role="alert"><p>{error}</p></div>}
      {hecho && <div className="tpv-aviso" data-tono="ok" role="status" data-prueba="resultado-formas"><p>{hecho}</p></div>}
      {!hecho && nuevas.length > 0 && (
        <div className="tpv-aviso" data-tono="duda" data-prueba="aviso-forma-nueva">
          <p><strong>{avisoFormasNuevas(nuevas)}</strong> {nuevas.length === 1
            ? 'Dime a qué cuenta va y no te lo vuelvo a preguntar. Hasta entonces, los días que la llevan no se pueden validar.'
            : 'Dime a qué cuenta va cada una y no te lo vuelvo a preguntar. Hasta entonces, los días que las llevan no se pueden validar.'}</p>
        </div>
      )}

      {factura && (
        <section className="tpv-seccion" aria-label="La factura del día" data-prueba="factura-del-dia">
          <h3 className="tpv-seccion-titulo">La factura del día</h3>
          <div className="tpv-tabla-caja tpv-caja-abierta">
            <table className="tpv-formas" aria-label="A qué cuenta va la factura del día">
              <colgroup><col className="tpv-col-forma" /><col className="tpv-col-cuenta" /><col className="tpv-col-mes" /></colgroup>
              <tbody>
                <tr data-prueba="fila-factura-del-dia">
                  <td><span className="tpv-forma-nombre">La factura del día va a</span>
                    {!factura.factura && facturaElegida && facturaElegida === factura.propuesta?.cuenta && <> <Chip tono="duda">Propuesta</Chip></>}</td>
                  <td className="tpv-elegir">
                    <button type="button" className="tpv-elegir-boton" data-falta={facturaElegida ? undefined : ''} aria-label="Cuenta de la factura del día"
                      onClick={() => setBuscando(buscando === FACTURA ? null : FACTURA)}>
                      <span>{facturaElegida ? `${facturaElegida} · ${nombreFactura}` : 'Elige una cuenta'}</span><span aria-hidden="true">▾</span>
                    </button>
                    {buscando === FACTURA && (
                      <BuscarCuentaHoja cuentas={cuentas} inicial=""
                        alElegir={(c) => { setFacturaElegida(c.codigo); setBuscando(null); setHecho(null) }}
                        alCerrar={() => setBuscando(null)} crear={crear} />
                    )}
                  </td>
                  <td className="tpv-cifra">{cifra(factura.factura?.mes ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="tpv-nota">Cada día, todos los tickets de un local se apuntan en una sola factura, con su primer y su último número. Así lo pide Hacienda y así lo hace ERP10.</p>
          {factura.factura
            ? <p className="tpv-nota" data-prueba="desde-dos-asientos">{desdeDosAsientos(factura.factura.desde)} Los días ya validados se quedan como están.</p>
            : partido && <p className="tpv-nota">Al guardar, desde hoy cada día va en dos asientos: la factura del día y su cobro. Los días ya validados se quedan como están.</p>}
          {!factura.factura && !factura.propuesta && !facturaElegida && (
            <p className="tpv-nota">No hay ninguna «Clientes de contado» en el plan de la empresa. Elige una cuenta, o{' '}
              <Boton variante="enlace" disabled={dandoDeAlta} onClick={() => void darDeAlta()}>{dandoDeAlta ? 'dando de alta…' : 'da de alta «Clientes de contado»'}</Boton>.</p>
          )}
        </section>
      )}

      <h3 className="tpv-seccion-titulo">Cómo se ha cobrado</h3>
      {datos && formas.length === 0 && <p className="tpv-nota">Todavía no hay ninguna forma de pago: salen aquí cuando subes las ventas de un día.</p>}
      {formas.length > 0 && (
        <div className="tpv-tabla-caja tpv-caja-abierta">
          <table className="tpv-formas" aria-label="A qué cuenta va cada forma de pago">
            <colgroup><col className="tpv-col-forma" /><col className="tpv-col-cuenta" /><col className="tpv-col-mes" /></colgroup>
            <thead><tr>
              <th>Forma de pago <span className="tpv-fila-apoyo">· como la escribe Revo</span></th>
              <th>Va a la cuenta</th>
              <th className="tpv-cifra">{datos ? enElMes(datos.mes) : 'En el mes'}</th>
            </tr></thead>
            <tbody>
              {formas.map((f) => {
                const k = clave(f)
                const elegida = eleccion[k] ?? null
                const etiqueta = esDeliverect(f.forma) ? `${f.forma} · pedidos de ${nombreCanal(f.canal)}` : f.forma
                return (
                  <tr key={k} data-prueba={`forma-${f.forma}${f.canal ? `-${f.canal}` : ''}`}>
                    <td>
                      <span className="tpv-forma-nombre">{f.forma}</span>
                      {esDeliverect(f.forma) && <span className="tpv-fila-apoyo"> · pedidos de {nombreCanal(f.canal)}</span>}
                      {f.nueva && <> <Chip tono="duda">Nueva</Chip></>}
                    </td>
                    <td className="tpv-elegir">
                      <button type="button" className="tpv-elegir-boton" data-falta={elegida ? undefined : ''} aria-label={`Cuenta de ${etiqueta}`}
                        onClick={() => setBuscando(buscando === k ? null : k)}>
                        <span>{nombreCuenta(elegida) ?? 'Elige una cuenta'}</span><span aria-hidden="true">▾</span>
                      </button>
                      {buscando === k && (
                        <BuscarCuentaHoja cuentas={cuentas} inicial=""
                          alElegir={(c) => { setEleccion((e) => ({ ...e, [k]: idDe(c) })); setBuscando(null); setHecho(null) }}
                          alCerrar={() => setBuscando(null)} crear={crear} />
                      )}
                    </td>
                    <td className="tpv-cifra">{cifra(f.en_mes)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {hayDeliverect && (
        <p className="tpv-nota">«Deliverect» no es quien paga: junta los pedidos de las plataformas. Por eso Sumied lo reparte{plataformas.length > 1 ? ` entre ${plataformas.slice(0, -1).join(', ')} y ${plataformas.at(-1)}` : ''}, y cada una va a su cuenta, que es la que luego se cuadra con su liquidación.</p>
      )}
    </>
  )

  const derecha = (
    <>
      <h3 className="tpv-der-titulo">{ejemplo && !ejemplo.cobro && !ejemplo.motivo ? 'Cómo queda el asiento de un día' : 'Cómo quedan los asientos de un día'}</h3>
      {!ejemploDia && datos && <p className="tpv-nota">Cuando haya un día subido, aquí salen sus asientos.</p>}
      {ejemplo?.motivo && <div className="tpv-aviso" data-tono="duda"><p>{ejemplo.motivo}</p></div>}
      {ejemplo?.factura && !ejemplo.motivo && (
        <>
          {ejemplo.cobro && <h4 className="tpv-asiento-titulo">1 · La factura del día{rango ? <span className="tpv-fila-apoyo"> · {rango}</span> : null}</h4>}
          <TablaAsiento a={ejemplo.factura} etiqueta={ejemplo.cobro ? 'La factura del día' : 'Cómo queda el asiento de un día'}
            prueba={ejemplo.cobro ? 'asiento-factura' : 'asiento-ejemplo'} pie={`Ejemplo: el ${diaCorto(ejemplo.dia)}`} />
        </>
      )}
      {ejemplo?.cobro && !ejemplo.motivo && (
        <>
          <h4 className="tpv-asiento-titulo">2 · El cobro del día</h4>
          <TablaAsiento a={ejemplo.cobro} etiqueta="El cobro del día" prueba="asiento-cobro"
            pie={<span data-prueba="contado-a-cero">Clientes de contado queda a {cifra(saldoContado(ejemplo.factura, ejemplo.cobro))}</span>} />
          <p className="tpv-nota">Así sale también a ERP10: la factura del día, con su primer y su último ticket, y el cobro aparte, el mismo día.</p>
        </>
      )}
      <p className="tpv-nota">Se puede cambiar cuando quieras en Ajustes › Ventas por día. El cambio vale para los días que aún no están validados.</p>
    </>
  )

  const cambiaAlgo = facturaCambia || elecciones.some((x) => x.cuenta_id !== formas.find((f) => clave(f) === clave(x))?.cuenta_id) || formas.length > 0
  return (
    <VentanaAncha titulo="A qué cuenta va cada forma de pago" alCerrar={alCerrar} reparto="formas"
      izquierda={izquierda} derecha={derecha}
      frase={hecho ? null : falta}
      acciones={hecho
        ? <Boton variante="principal" data-autofocus onClick={alCerrar}>Ver la lista</Boton>
        : <>
            <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
            <Boton variante="principal" disabled={!!falta || !cambiaAlgo || guardando} onClick={() => void guardar()}
              title={falta ?? undefined}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
          </>} />
  )
}
