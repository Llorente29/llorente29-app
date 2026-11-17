// src/modules/conta/ventas/tpv/FormasDePago.tsx
//
// R06 · «A qué cuenta va cada forma de pago» (maqueta 3). Se abre sola cuando un
// día trae una forma de pago sin cuenta (desde «Cuenta sin elegir» y desde el
// motivo que impide validar) y siempre desde Ajustes › Ventas por día.
//
//   · Arriba, en ámbar, la forma nueva.
//   · La tabla: la forma como la escribe el TPV (Deliverect, partida por
//     plataforma), la cuenta (el buscador de siempre, BuscarCuentaHoja) y lo que
//     suma en el mes.
//   · A la derecha, «Cómo queda el asiento de un día», en vivo: lo propone la
//     base (conta_tpv_asiento_ejemplo → _conta_tpv_propuesta) con las cuentas que
//     se están eligiendo, sin guardar nada.
//   · «Guardar» no se enciende mientras falte una cuenta, y lo dice; al guardar,
//     confirma con contenido y los días que la llevaban pasan a «Listo para validar».

import { useEffect, useMemo, useState } from 'react'
import { Boton, Chip } from '@/modules/conta/diseno'
import { BuscarCuentaHoja } from '@/modules/conta/diseno/plantillas'
import { avisoFormasNuevas, cifra, diaCorto, enElMes, esDeliverect, faltanCuentas, nombreCanal, type FormaCuenta } from '@/modules/conta/lib/subirTpv'
import {
  asientoEjemplo, guardarFormas, leerCuentasEmpresa, leerFormas,
  type AsientoEjemplo, type CuentaElegible, type Eleccion, type Formas, type LineaEjemplo,
} from '@/modules/conta/services/tpvSubirService'
import { VentanaAncha } from './VentanaAncha'

const clave = (f: Pick<FormaCuenta, 'forma' | 'canal'>) => `${f.forma.trim().toLowerCase()}|${f.canal ?? ''}`

/** Como en la maqueta: los cobros (lo del local, las plataformas, lo que no tiene cuenta), y después ventas e IVA. */
function ordenAsiento(l: LineaEjemplo): number {
  if (l.debe === 0 && l.haber !== 0) return l.tipo != null ? 5 : 4
  if (l.sin_cuenta) return 3
  return l.forma && esDeliverect(l.forma) ? 2 : 1
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
  const [ejemplo, setEjemplo] = useState<AsientoEjemplo | null>(null)
  const [buscando, setBuscando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([leerFormas(companyId, diaId), leerCuentasEmpresa(companyId)])
      .then(([f, c]) => {
        if (!vivo) return
        setDatos(f); setCuentas(c)
        setEleccion(Object.fromEntries(f.formas.map((x) => [clave(x), x.cuenta_id])))
      })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [companyId, diaId])

  const formas = useMemo(() => datos?.formas ?? [], [datos])
  const elecciones: Eleccion[] = useMemo(() => formas.map((f) => ({ forma: f.forma, canal: f.canal, cuenta_id: eleccion[clave(f)] ?? null })), [formas, eleccion])
  const faltan = elecciones.filter((x) => !x.cuenta_id).length
  const nuevas = formas.filter((f) => f.nueva)

  // El asiento de ejemplo, en vivo (lo propone la base con lo que se está eligiendo).
  const ejemploDia = datos?.ejemplo ?? null
  const firma = JSON.stringify(elecciones)
  useEffect(() => {
    if (!ejemploDia) return
    let vivo = true
    const t = setTimeout(() => {
      asientoEjemplo(ejemploDia, elecciones.filter((x) => x.cuenta_id))
        .then((r) => { if (vivo) setEjemplo(r) })
        .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    }, 150)
    return () => { vivo = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `firma` resume `elecciones`
  }, [ejemploDia, firma])

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      const cambiadas = elecciones.filter((x) => x.cuenta_id && x.cuenta_id !== formas.find((f) => clave(f) === clave(x))?.cuenta_id)
      const r = await guardarFormas(companyId, cambiadas.length ? cambiadas : elecciones, quien)
      setHecho(r.texto)
      alGuardar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  const nombreCuenta = (id: string | null) => { const c = cuentas.find((x) => x.id === id); return c ? `${c.codigo} · ${c.nombre}` : null }
  const lineas = [...(ejemplo?.lineas ?? [])].map((l, i) => ({ l, i })).sort((a, b) => ordenAsiento(a.l) - ordenAsiento(b.l) || a.i - b.i).map(({ l }) => l)
  const hayDeliverect = formas.some((f) => esDeliverect(f.forma))
  const plataformas = [...new Set(formas.filter((f) => esDeliverect(f.forma) && f.canal).map((f) => nombreCanal(f.canal)))]

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
                          alElegir={(c) => { const x = cuentas.find((y) => y.codigo === c.codigo); setEleccion((e) => ({ ...e, [k]: x?.id ?? null })); setBuscando(null); setHecho(null) }}
                          alCerrar={() => setBuscando(null)} />
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
      <h3 className="tpv-der-titulo">Cómo queda el asiento de un día</h3>
      {!ejemploDia && datos && <p className="tpv-nota">Cuando haya un día subido, aquí sale su asiento.</p>}
      {ejemplo?.motivo && <div className="tpv-aviso" data-tono="duda"><p>{ejemplo.motivo}</p></div>}
      {ejemplo && !ejemplo.motivo && (
        <div className="tpv-tabla-caja tpv-caja-abierta">
          <table className="tpv-asiento" aria-label="Cómo queda el asiento de un día" data-prueba="asiento-ejemplo">
            <thead><tr><th>Cuenta</th><th className="tpv-cifra">Debe</th><th className="tpv-cifra">Haber</th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} data-sin-cuenta={l.sin_cuenta ? '' : undefined}>
                  <td>{l.sin_cuenta ? `${l.forma}${l.canal && l.canal !== 'local' ? ` · ${nombreCanal(l.canal)}` : ''} · sin cuenta`
                    : `${l.cuenta} · ${l.nombre ?? ''}${l.tipo != null ? ` ${Number(l.tipo).toLocaleString('es-ES')} %` : ''}`}</td>
                  <td className="tpv-cifra">{l.debe ? cifra(l.debe) : ''}</td>
                  <td className="tpv-cifra">{l.haber ? cifra(l.haber) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td>Ejemplo: el {diaCorto(ejemplo.dia)}</td>
              <td className="tpv-cifra" colSpan={2}>Debe <strong>{cifra(ejemplo.debe)}</strong> · Haber <strong>{cifra(ejemplo.haber)}</strong></td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="tpv-nota">Se puede cambiar cuando quieras en Ajustes › Ventas por día. El cambio vale para los días que aún no están validados.</p>
    </>
  )

  return (
    <VentanaAncha titulo="A qué cuenta va cada forma de pago" alCerrar={alCerrar} reparto="formas"
      izquierda={izquierda} derecha={derecha}
      frase={hecho ? null : faltanCuentas(faltan)}
      acciones={hecho
        ? <Boton variante="principal" data-autofocus onClick={alCerrar}>Ver la lista</Boton>
        : <>
            <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
            <Boton variante="principal" disabled={faltan > 0 || !formas.length || guardando} onClick={() => void guardar()}
              title={faltan > 0 ? faltanCuentas(faltan) ?? undefined : undefined}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
          </>} />
  )
}
