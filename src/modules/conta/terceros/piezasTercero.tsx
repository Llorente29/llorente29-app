// src/modules/conta/terceros/piezasTercero.tsx
//
// C03 · Las tarjetas de la portada de la ficha de un tercero (maquetas N9 y
// N10): liquidaciones de la plataforma, «Cómo se calcula» y las anteriores del
// socio, «Lo que he aprendido de este cliente», «Con quién hablas» y «Sus
// cuentas». Cada una dice su estado vacío: qué llegará y cuándo.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaFichaProveedor, rutaMayor } from '@/config/navegacion'
import { Chip, Vacio } from '@/modules/conta/ui/piezas'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { calculosDelMes, papelesDe, useAprendido, useTercero } from '@/modules/conta/terceros/contextoTercero'
import { cuadre, estadoLiquidacion, periodo, type Estado } from '@/modules/conta/lib/liquidaciones'
import { liquidarMes, textoImporte } from '@/modules/conta/lib/liquidacionSocio'
import { diaMes, eurosExactos, iniciales } from '@/modules/conta/lib/formato'
import { MODELO_PLATAFORMA, linea347Plataforma, type ModeloPlataforma } from '@/modules/conta/lib/plataforma347'
import { parecido } from '@/modules/conta/lib/importarPlan'
import { apuntarCobro, confirmarPeriodo, crearCuentaCliente, enlazarCuentaCliente, guardarModeloPlataforma, quitarCobro, asegurarCuentaLiquidacion } from '@/modules/conta/services/tercerosService'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'

const TONO: Record<Estado['tono'], 'ia' | 'azul' | 'ambar' | 'neutro'> = { verde: 'ia', azul: 'azul', ambar: 'ambar', gris: 'neutro' }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesLargo = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1]
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── Liquidaciones de la plataforma ─────────────────────────────────────────

export function TarjetaLiquidaciones({ todas = false }: { todas?: boolean }) {
  const { ficha, hoy, rutaApartado, recargar, avisar } = useTercero()
  const { userName } = useCuentaConta()
  const [cobro, setCobro] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const liqs = todas ? ficha.liquidaciones : ficha.liquidaciones.slice(0, 4)
  const enCuenta = ficha.cuentas.find((c) => c.papel === 'cliente') ?? ficha.cuentas.find((c) => c.papel === 'pago') ?? null

  if (ficha.liquidaciones.length === 0) {
    return (
      <section className="cx-tarjeta" aria-label="Liquidaciones">
        <h2 className="cx-tarjeta-titulo">Liquidaciones</h2>
        <Vacio titulo="Aún no hay liquidaciones suyas."
          explicacion="Con «Subir liquidación» lees el fichero que te manda la plataforma: ventas, comisiones y neto, y aquí verás cuándo llega cada cobro y si cuadra con el banco." />
      </section>
    )
  }
  return (
    <section className="cx-tarjeta" aria-label="Liquidaciones">
      <div className="cxt-tarjeta-cabeza">
        <h2 className="cx-tarjeta-titulo">Liquidaciones</h2>
        {!todas && <Link to={rutaApartado('liquidaciones')}>Ver todas</Link>}
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cxt-liq cxt-liq-cabeza" aria-hidden="true">
        <span>FECHA</span><span>PERIODO · ventas − comisiones = neto</span><span style={{ textAlign: 'right' }}>NETO</span><span />
      </div>
      {liqs.map((l) => {
        const e = estadoLiquidacion(l, hoy)
        const p = periodo(l)
        const c = cuadre(l)
        return (
          <div key={l.id} className="cxt-liq" data-testid={`liq-${l.id}`}>
            <span className="cxt-liq-fecha">{l.fecha ? diaMes(l.fecha) : '—'}</span>
            <span className="cxt-liq-cuenta">
              <span>{p.texto}{p.porConfirmar && <> <Chip tono="ambar">por confirmar</Chip></>} · {c.frase}</span>
              <span className={`cxt-liq-explica${e.tono === 'ambar' ? ' cxt-ambar' : e.tono === 'verde' ? ' cxt-verde' : ''}`}>
                {e.explica}{l.paraRevisar && l.motivoRevisar ? ` · para revisar: ${l.motivoRevisar}` : ''}
                {c.descuadre != null && c.descuadre !== 0 ? ` · el fichero no cuadra por ${eurosExactos(Math.abs(c.descuadre))}` : ''}
              </span>
              {p.porConfirmar && todas && (
                <span className="cxt-liq-explica">{l.notaPeriodo} <button type="button" className="cx-enlace" onClick={async () => {
                  setFallo(null)
                  try { const r = await confirmarPeriodo(l.id); avisar(`Periodo confirmado: del ${diaMes(r.desde)} al ${diaMes(r.hasta)}. Ya cuenta en Ventas.`); recargar() }
                  catch (er) { setFallo(er instanceof Error ? er.message : 'No se pudo confirmar.') }
                }}>Confirmar periodo</button></span>
              )}
              <span className="cxt-liq-acciones">
                {l.cobradoEn
                  ? <button type="button" className="cx-enlace" onClick={async () => {
                      setFallo(null)
                      try { await quitarCobro(l.id); avisar(`Quitado el cobro de la liquidación del ${p.texto}: vuelve a estar pendiente.`); recargar() }
                      catch (er) { setFallo(er instanceof Error ? er.message : 'No se pudo quitar.') }
                    }}>Quitar cobro</button>
                  : <button type="button" className="cx-enlace" onClick={() => setCobro(l.id)}>Apuntar cobro</button>}
                </span>
            </span>
            <span className="cxt-liq-neto">{l.neto != null ? eurosExactos(l.neto) : '—'}</span>
            <span><Chip tono={TONO[e.tono]}>{e.etiqueta}</Chip></span>
          </div>
        )
      })}
      <p className="cx-ayuda" style={{ margin: '10px 0 0' }}>
        Cada liquidación se asienta en el libro diario: ventas a tu 700, comisiones a tu 623 con su IVA y el neto a su cuenta
        {enCuenta ? <> <Link to={rutaMayor(enCuenta.code)}>{enCuenta.code}</Link></> : ' de cliente (aún sin cuenta)'}. «Subir liquidación» lee el fichero de la plataforma.
      </p>
      {cobro && <ApuntarCobro id={cobro} alCerrar={() => setCobro(null)} alHecho={(t) => { setCobro(null); avisar(t); recargar() }} quien={userName} />}
    </section>
  )
}

function ApuntarCobro({ id, alCerrar, alHecho, quien }: { id: string; alCerrar: () => void; alHecho: (t: string) => void; quien: string | null }) {
  const { ficha, hoy } = useTercero()
  const l = ficha.liquidaciones.find((x) => x.id === id)!
  const [fecha, setFecha] = useState(hoy)
  const [importe, setImporte] = useState(l.neto != null ? String(l.neto).replace('.', ',') : '')
  const [nota, setNota] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const valor = Number(importe.replace(/\./g, '').replace(',', '.'))
  return (
    <Dialogo titulo={`Cobro de la liquidación del ${periodo(l).texto}`} alCerrar={alCerrar}>
      <form className="cx-formulario" onSubmit={async (e) => {
        e.preventDefault()
        if (!fecha || !Number.isFinite(valor)) { setFallo('Pon la fecha y lo que llegó al banco.'); return }
        setOcupado(true); setFallo(null)
        try {
          const r = await apuntarCobro(id, fecha, valor, nota.trim() || null, quien)
          const d = r.diferencia
          alHecho(d == null ? `Cobro apuntado: ${eurosExactos(valor)} el ${diaMes(fecha)}. El fichero no trae el neto para comprobarlo.`
            : d === 0 ? `Cobrada: ${eurosExactos(valor)} el ${diaMes(fecha)}, cuadra con el neto al céntimo.`
            : d < 0 ? `Apuntado con diferencia: faltan ${eurosExactos(-d)} en el banco. Queda como «con diferencia» para que lo mires.`
            : `Apuntado con diferencia: llegaron ${eurosExactos(d)} de más. Queda como «con diferencia».`)
        } catch (er) { setFallo(er instanceof Error ? er.message : 'No se pudo apuntar.'); setOcupado(false) }
      }}>
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
        <p className="cx-ayuda" style={{ margin: 0 }}>Neto de la liquidación: {l.neto != null ? eurosExactos(l.neto) : 'el fichero no lo trae'}. Pon lo que llegó de verdad: si no es el neto, se queda «con diferencia».</p>
        <div className="cx-campo"><label htmlFor="cobro-fecha">Llegó el</label><input id="cobro-fecha" className="cx-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="cx-campo"><label htmlFor="cobro-importe">Lo que llegó al banco (€)</label><input id="cobro-importe" className="cx-input" inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} /></div>
        <div className="cx-campo"><label htmlFor="cobro-nota">Nota (opcional)</label><input id="cobro-nota" className="cx-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Descontaron un reembolso" /></div>
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="cx-boton" disabled={ocupado}>{ocupado ? 'Apuntando…' : 'Apuntar cobro'}</button>
        </div>
      </form>
    </Dialogo>
  )
}

// ── El socio de marca: cómo se calcula y las anteriores ────────────────────

export function ComoSeCalcula() {
  const { mesSocio, rutaApartado } = useTercero()
  if (!mesSocio) return null
  const m = liquidarMes(calculosDelMes(mesSocio.porLocal))
  return (
    <section className="cx-tarjeta" aria-label="Cómo se calcula la liquidación">
      <div className="cxt-tarjeta-cabeza">
        <h2 className="cx-tarjeta-titulo">Cómo se calcula la liquidación</h2>
        <Link to={rutaApartado('cobro')}>Ver contrato</Link>
      </div>
      {m.lineas.map((l) => (
        <div key={l.texto} className="cxt-linea"><span>{l.texto}</span><span className="cx-cifra">{l.importe < 0 ? `−${eurosExactos(-l.importe)}` : l.texto.startsWith('+') ? `+${eurosExactos(l.importe)}` : eurosExactos(l.importe)}</span></div>
      ))}
      <div className="cxt-linea cxt-linea-total"><span>= Liquidación de {mesSocio.mes.nombre}</span><span className="cx-cifra">{textoImporte(m)}</span></div>
      {m.porLocal.length > 1 && (
        <div className="cxt-locales" aria-label="Por local">
          {m.porLocal.map((l) => (
            <div key={l.localId} className="cxt-linea cxt-linea-local">
              <span>{l.local} · {eurosExactos(l.compras)} − {eurosExactos(l.aportaciones)} + {eurosExactos(l.comision)}</span>
              <span className="cx-cifra">{textoImporte(l)}</span>
            </div>
          ))}
        </div>
      )}
      {m.faltan.length > 0 && <div className="cx-aviso" role="status">No se puede cerrar todavía: {m.faltan.join(' ')}</div>}
      <p className="cx-ayuda" style={{ margin: '10px 0 0' }}>Las tres líneas salen de Folvy: los albaranes de Cocina, las aportaciones que registras y las ventas por marca, en cada local. Al cerrar, Folvy prepara la liquidación de cada local y tú confirmas.</p>
    </section>
  )
}

export function LiquidacionesAnteriores({ todas = false }: { todas?: boolean }) {
  const { ficha, rutaApartado } = useTercero()
  const meses = useMemo(() => {
    const porMes = new Map<string, typeof ficha.liquidacionesSocio>()
    for (const l of ficha.liquidacionesSocio) porMes.set(l.desde.slice(0, 7), [...(porMes.get(l.desde.slice(0, 7)) ?? []), l])
    return [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [ficha])
  const local = (id: string | null) => ficha.locales.find((l) => l.id === id)?.name ?? 'Sin local'
  if (meses.length === 0) {
    return (
      <section className="cx-tarjeta" aria-label="Liquidaciones anteriores">
        <h2 className="cx-tarjeta-titulo">Liquidaciones anteriores</h2>
        <Vacio titulo="Aún no hay liquidaciones suyas." explicacion="Cuando prepares y confirmes la primera, sale aquí con su desglose por local." />
      </section>
    )
  }
  return (
    <section className="cx-tarjeta" aria-label="Liquidaciones anteriores">
      <div className="cxt-tarjeta-cabeza">
        <h2 className="cx-tarjeta-titulo">Liquidaciones anteriores</h2>
        {!todas && <Link to={rutaApartado('liquidaciones')}>Ver todas</Link>}
      </div>
      {(todas ? meses : meses.slice(0, 3)).map(([mes, ls]) => {
        const anterior = ls.every((l) => l.formula === 'anterior')
        const total = ls.reduce((s, l) => s + (anterior ? (l.netoAnterior ?? 0) : (l.importe ?? 0)), 0)
        const estado = ls.every((l) => l.estado === 'saldada') ? 'Cobrada' : ls.every((l) => l.estado === 'confirmada' || l.estado === 'saldada') ? 'Confirmada' : anterior ? 'Fórmula anterior' : 'Borrador'
        return (
          <div key={mes} className="cxt-anterior">
            <div className="cxt-linea">
              <span>{capital(mesLargo(`${mes}-01`))} · {diaMes(ls[0].hasta)}</span>
              <span className="cxt-anterior-derecha"><span className="cx-cifra">{eurosExactos(Math.abs(total))}</span>
                <Chip tono={estado === 'Cobrada' ? 'ia' : estado === 'Confirmada' ? 'azul' : 'neutro'}>{estado}</Chip></span>
            </div>
            {todas && ls.map((l) => (
              <div key={l.id} className="cxt-linea cxt-linea-local">
                <span>{local(l.localId)}{l.formula === 'anterior' ? ' · calculada con la fórmula anterior (sin recalcular)' : ` · ${eurosExactos(l.compras ?? 0)} − ${eurosExactos(l.aportaciones ?? 0)} + ${eurosExactos(l.comision ?? 0)}`}</span>
                <span className="cx-cifra">{l.formula === 'anterior' ? eurosExactos(l.netoAnterior ?? 0) : textoImporte({ importe: l.importe ?? 0, sentido: (l.importe ?? 0) > 0 ? 'a su favor' : (l.importe ?? 0) < 0 ? 'a tu favor' : 'a cero' })}</span>
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}

// ── Lo aprendido, con quién hablas, sus cuentas ────────────────────────────

export function Aprendido() {
  const { rutaApartado } = useTercero()
  const a = useAprendido()
  return (
    <section className="cx-tarjeta cxt-aprendido" aria-label="Lo que he aprendido de este cliente">
      <h2 className="cx-tarjeta-titulo"><span className="cx-chip cx-chip-ia">IA</span> Lo que he aprendido de este cliente</h2>
      {a.length === 0 && <p className="cx-ayuda" style={{ margin: 0 }}>Aún nada: con tres liquidaciones o cobros iguales te digo cuándo suele pagar, qué comisión ves y dónde cobra.</p>}
      {a.map((x) => (
        <div key={x.campo} className="cxt-aprendido-fila">
          <span><strong>{x.texto}</strong><span className="cx-ayuda">{x.porque}</span></span>
          <Link to={rutaApartado('cobro')}>Cambiar</Link>
        </div>
      ))}
    </section>
  )
}

export function ConQuienHablas() {
  const { ficha } = useTercero()
  const ROL: Record<string, string> = { orders: 'Pedidos', sales: 'Comercial', admin: 'Gestora de cuenta', delivery: 'Reparto', other: 'Otro' }
  return (
    <section className="cx-tarjeta" aria-label="Con quién hablas">
      <div className="cxt-tarjeta-cabeza">
        <h2 className="cx-tarjeta-titulo">Con quién hablas</h2>
        {ficha.tercero.supplierId && <Link to={rutaFichaProveedor(ficha.tercero.supplierId, 'contactos')}>+ Añadir</Link>}
      </div>
      {ficha.contactos.length === 0 && (
        <p className="cx-ayuda" style={{ margin: 0 }}>
          {ficha.tercero.supplierId ? 'Aún no hay contactos. Se añaden en su ficha de proveedor y salen aquí también.' : 'Los contactos de un cliente que no es proveedor llegan en un encargo propio (pendiente en el PR).'}
        </p>
      )}
      {ficha.contactos.map((c) => (
        <div key={c.id} className="cxt-contacto">
          <span className="cxt-contacto-inicial" aria-hidden="true">{iniciales(c.name)}</span>
          <span><strong>{c.name}</strong><span className="cx-ayuda">{ROL[c.role] ?? c.role}{c.email ? ' · ' : ''}{c.email && <a href={`mailto:${c.email}`}>Escribir</a>}{c.phone ? ' · ' : ''}{c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>Llamar</a>}</span></span>
        </div>
      ))}
    </section>
  )
}

/** Lo vendido por la plataforma en el año y lo que cobró de comisión (sin IVA), por sus liquidaciones. */
function delAnio(f: ReturnType<typeof useTercero>['ficha'], hoy: string): { ventas: number; comisiones: number } {
  const anio = hoy.slice(0, 4)
  const ls = f.liquidaciones.filter((l) => (l.hasta ?? l.fecha ?? '').startsWith(anio))
  return { ventas: ls.reduce((s, l) => s + (l.ventas ?? 0), 0), comisiones: ls.reduce((s, l) => s + Math.abs(l.comision ?? 0), 0) }
}

/** La línea «347» de una plataforma: según cómo vende (su contrato); si no se ha dicho, lo pregunta. */
function Linea347Plataforma() {
  const { ficha, hoy, recargar, avisar } = useTercero()
  const { rolPlataforma } = papelesDe(ficha)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const modelo = rolPlataforma?.platformModel ?? null
  const { ventas, comisiones } = delAnio(ficha, hoy)
  const l = linea347Plataforma(modelo, ventas, comisiones)
  async function decir(m: ModeloPlataforma | null) {
    setOcupado(true); setFallo(null)
    try {
      await guardarModeloPlataforma(ficha.tercero.id, m)
      const nueva = linea347Plataforma(m, ventas, comisiones)
      avisar(m ? `${ficha.tercero.nombre}: ${MODELO_PLATAFORMA[m].corto.toLowerCase()}. ${nueva.texto}.` : `${ficha.tercero.nombre}: sin decir si es comisionista o revendedor.`)
      recargar()
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo guardar.') }
    setOcupado(false)
  }
  return (
    <span className="cxt-347">
      <span>{l.texto}</span>
      {l.pregunta && (
        <span className="cxt-347-pregunta" role="group" aria-label="Cómo vende según su contrato">
          <button type="button" className="cx-enlace" disabled={ocupado} onClick={() => void decir('comisionista')} title={MODELO_PLATAFORMA.comisionista.largo}>Vende en mi nombre (comisionista)</button>
          <button type="button" className="cx-enlace" disabled={ocupado} onClick={() => void decir('revendedor')} title={MODELO_PLATAFORMA.revendedor.largo}>Me compra y revende</button>
        </span>
      )}
      {!l.pregunta && <button type="button" className="cx-enlace cxt-347-cambiar" disabled={ocupado} onClick={() => void decir(null)}>Cambiar</button>}
      <span className="cxt-cita">{l.cita}</span>
      {fallo && <span className="cx-error" role="alert">{fallo}</span>}
    </span>
  )
}

export function SusCuentas({ completa = false }: { completa?: boolean }) {
  const { ficha, companyId, recargar, avisar, rutaApartado } = useTercero()
  const { userName } = useCuentaConta()
  const { cliente, proveedor, socio } = papelesDe(ficha)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const comoCliente = ficha.cuentas.find((c) => c.papel === 'cliente') ?? ficha.cuentas.find((c) => c.papel === 'pago') ?? null
  const comoProveedor = ficha.cuentas.find((c) => c.papel === 'proveedor') ?? null
  const deLiquidacion = ficha.cuentas.find((c) => c.papel === 'liquidacion') ?? null
  const propuesta = !comoCliente ? ficha.cuentas430SinDueno.find((c) => parecido(c.name.replace(/^Clientes · /, ''), ficha.tercero.nombre)) ?? null : null
  const fila = (et: string, valor: React.ReactNode) => <div className="cxt-linea"><span className="cx-ayuda">{et}</span><span className="cxt-cuenta">{valor}</span></div>
  const enlace = (c: { code: string; name: string }) => <Link to={rutaMayor(c.code)}>{c.code} · {c.name}</Link>

  async function hacer(fn: () => Promise<unknown>, texto: string) {
    setOcupado(true); setFallo(null)
    try { await fn(); avisar(texto); recargar() } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo.') }
    setOcupado(false)
  }

  return (
    <section className="cx-tarjeta" aria-label="Sus cuentas">
      <div className="cxt-tarjeta-cabeza">
        <h2 className="cx-tarjeta-titulo">Sus cuentas</h2>
        {!completa && <Link to={rutaApartado('contabilidad')}>Contabilidad</Link>}
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {!ficha.planActivo && <p className="cx-ayuda" style={{ margin: 0 }}>Se asignan al activar el plan contable (Ajustes › Plan contable).</p>}
      {ficha.planActivo && <>
        {(cliente || socio) && fila('Como cliente', comoCliente ? enlace(comoCliente) : (
          <span className="cxt-sin-cuenta">
            <span>Sin cuenta de cliente</span>
            {propuesta && companyId && <button type="button" className="cx-enlace" disabled={ocupado}
              onClick={() => void hacer(() => enlazarCuentaCliente(companyId, ficha.tercero.id, propuesta.id, userName), `${propuesta.code} es ahora su cuenta de cliente.`)}>
              Es la {propuesta.code}{propuesta.traida ? ' (traída)' : ''}</button>}
            {companyId && <button type="button" className="cx-enlace" disabled={ocupado}
              onClick={() => void hacer(async () => { const r = await crearCuentaCliente(companyId, ficha.tercero.id, ficha.tercero.nombre, userName); avisar(`Creada su subcuenta ${r.code} bajo la 4300.`) }, 'Cuenta de cliente creada.')}>
              Crear su subcuenta 4300</button>}
          </span>
        ))}
        {proveedor && fila('Como proveedor', comoProveedor ? enlace(comoProveedor) : 'Sin subcuenta de proveedor')}
        {socio && fila('Lo que cobras por su cuenta', deLiquidacion ? enlace(deLiquidacion) : (
          <span className="cxt-sin-cuenta">
            <span>Sin cuenta de liquidación</span>
            {companyId && <button type="button" className="cx-enlace" disabled={ocupado}
              onClick={() => void hacer(async () => { const r = await asegurarCuentaLiquidacion(companyId, ficha.tercero.id, ficha.tercero.nombre, userName); if (r) avisar(`Creada su cuenta ${r.code} «Liquidación pendiente con ${ficha.tercero.nombre}», bajo la 410.`) }, 'Cuenta de liquidación creada.')}>
              Crear su cuenta de liquidación</button>}
          </span>
        ))}
        {(cliente || socio) && fila('Sus ventas van a', socio ? '70500000 · Prestaciones de servicios (comisión) · 70000000 · Ventas' : '70000000 · Ventas de mercaderías (705 si son servicios)')}
        {socio && fila('Sus marcas', ficha.acuerdos.length ? <span>{ficha.acuerdos.map((a) => a.marca).join(', ')} · ventas separadas <span className="cx-chip cx-chip-ia">IA</span></span> : 'Ningún acuerdo de cesión enlazado')}
        {papelesDe(ficha).plataforma
          ? fila('347', ficha.fiscal?.exclude347 ? `Excluido: ${ficha.fiscal.exclude347Reason}` : <Linea347Plataforma />)
          : (cliente || socio) && fila('347', ficha.fiscal?.exclude347 ? `Excluido: ${ficha.fiscal.exclude347Reason}`
            : 'Se calcula con las facturas que emites (llegan con Facturación)')}
      </>}
    </section>
  )
}
