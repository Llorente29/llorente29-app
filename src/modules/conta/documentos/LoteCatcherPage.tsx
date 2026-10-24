// src/modules/conta/documentos/LoteCatcherPage.tsx
//
// E05 · Una quincena de Catcher subida (S02 · PR 3: cuelga de Compras y gastos ›
// Liquidaciones, que es donde sale en la lista y donde se sube):
//   · bajo el título, solo «Cuadra con los pedidos salvo 1», y las cifras;
//   · «Por aclarar», cada cosa con su pedido, su porqué y sus botones: «Dar por
//     buena», «Reclamar» (diciendo qué) y «Volver a abrir». Lo ya decidido se
//     sigue viendo, con quién y qué (regla 7: nada se esconde);
//   · las facturas agrupadas por riders, flotas y Catcher, con su contador de
//     «Por aclarar»;
//   · el pago contra la 40700001 y el saldo prepago.
// Cada botón dice lo que ha hecho o por qué no (regla 8).
// Retoques de Julio (15/10): lo abierto y lo reclamado salen de UNA cuenta
// (catcherCuenta) en la tarjeta, cada bloque y cada fila; la comisión que no
// cuadra, en ámbar; «Volver a comprobar»; el pago propuesto, hecho y con su
// asiento; y nada dicho dos veces.

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rutaAsiento, rutaLiquidaciones, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { cuando } from '@/modules/conta/lib/catcherCruces'
import {
  apoyoDeLaTarjeta, contar, cuadraConLosPedidos, facturasPorGrupo, cuentaDeGrupo, diferenciaDeComision, estadoDeFactura, etiquetasDe, type Cuenta,
} from '@/modules/conta/lib/catcherCuenta'
import type { TipoFactura } from '@/modules/conta/lib/catcherQuincena'
import {
  aclarar, leerLote, volverAComprobarLote, proponerPagoLote, SALDO_PREPAGO, type CosaPorAclarar, type FacturaDeLote,
} from '@/modules/conta/services/catcherService'
import { SaldoPrepago } from '@/modules/conta/documentos/SaldoPrepago'

const GRUPOS: { tipo: TipoFactura; nombre: string }[] = [
  { tipo: 'rider', nombre: 'Riders' }, { tipo: 'flota', nombre: 'Flotas' }, { tipo: 'catcher', nombre: 'Catcher' },
]
const ESTADO: Record<CosaPorAclarar['estado'], string> = { abierta: 'Por aclarar', aceptada: 'Dada por buena', reclamada: 'Reclamada a Catcher' }

export default function LoteCatcherPage() {
  const { loteId = '' } = useParams()
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(accountId && loteId ? () => leerLote(accountId, loteId) : null, `${accountId}:${loteId}:${vuelta}`)
  const [paso, setPaso] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  async function hacer(que: string, f: () => Promise<string>) {
    setPaso(que); setHecho(null); setFallo(null)
    try { setHecho(await f()); setVuelta((v) => v + 1) } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setPaso(null) }
  }

  if (!activa || !accountId) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay ninguna empresa." explicacion="Da de alta tu empresa y aquí llegan sus facturas." /></div>
  const d = datos.datos
  const dif = d ? diferenciaDeComision(d.comision) : null

  return (
    <div className="cxl-pagina">
      <header className="cxl-cabeza">
        <div>
          <span className="cxl-ante">Compras y gastos</span>
          <h1 className="cxl-titulo">Liquidaciones</h1>
        </div>
      </header>
      {datos.error && <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />}
      {!d && !datos.error && <div className="cx-tarjeta" aria-busy="true"><Hueso ancho="60%" alto={22} /><Hueso /><Hueso /></div>}
      {d && (
        <>
          <div className="cxr-seccion">
            <div>
              <Migas migas={[{ etiqueta: 'Liquidaciones', ruta: rutaLiquidaciones() }, { etiqueta: 'Quincena de Catcher' }]} />
              <h2>{d.lote.etiqueta}</h2>
            </div>
            <div className="cxr-herramientas">
              <button type="button" className="cx-boton-sec" disabled={!!paso}
                onClick={() => void hacer('Volviendo a leer los PDF y a comprobar con los pedidos…', () => volverAComprobarLote(loteId, userName))}>Volver a comprobar</button>
              {d.lote.pago
                ? <Link to={rutaAsiento(d.lote.pago)} className="cxk-hecho-enlace">✓ Pago propuesto · Ver asiento</Link>
                : <button type="button" className="cx-boton" disabled={!!paso}
                    onClick={() => void hacer('Proponiendo el pago…', async () => (await proponerPagoLote(loteId, userName)).texto)}>
                    {`Proponer el pago desde la ${SALDO_PREPAGO.cuenta}`}
                  </button>}
            </div>
          </div>
          <p className="cxk-resumen" data-prueba="cuadra"><strong>{cuadraConLosPedidos(d.lote.cruzado, d.lote.cuenta)}</strong></p>

          <div role="status" aria-live="polite" data-prueba="hecho-quincena">
            {paso && <div className="cx-tarjeta">{paso}</div>}
            {hecho && <div className="cx-tarjeta cxr-hecho"><strong>{hecho}</strong></div>}
          </div>
          {fallo && <div className="cx-error" role="alert">{fallo}</div>}

          <div className="cxr-cifras cxk-cifras">
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Facturas</span><span className="cxr-cifra-valor">{d.lote.facturas}</span>
              <span className="cxr-cifra-apoyo">{facturasPorGrupo({ rider: d.facturas.filter((f) => f.tipo === 'rider').length, flota: d.facturas.filter((f) => f.tipo === 'flota').length, catcher: d.facturas.filter((f) => f.tipo === 'catcher').length })}</span></div>
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Total</span><span className="cxr-cifra-valor">{eurosExactos(d.lote.total)}</span>
              <span className="cxr-cifra-apoyo">lo que baja la {SALDO_PREPAGO.cuenta}</span></div>
            <div className="cxr-cifra" data-prueba="tarjeta-por-aclarar"><span className="cxr-cifra-etiqueta">Por aclarar</span><span className="cxr-cifra-valor">{d.lote.cuenta.abiertas}</span>
              <span className="cxr-cifra-apoyo">{apoyoDeLaTarjeta(d.lote.cruzado, d.lote.cuenta)}</span></div>
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Comisión de Catcher</span>
              <span className="cxr-cifra-valor">{d.comision ? eurosExactos(d.comision.cobrada) : '—'}</span>
              <span className="cxr-cifra-apoyo">{d.comision ? `por pedido entregado serían ${eurosExactos(d.comision.esperada)}` : 'sin cruzar todavía'}</span>
              {dif && <span className="cxk-diferencia">{eurosExactos(dif.centimos / 100)} {dif.sentido}</span>}</div>
          </div>

          <PorAclarar cosas={d.porAclarar} cuenta={d.lote.cuenta} ocupado={!!paso}
            alDecidir={(c, decision, nota) => void hacer('Guardando…', () => aclarar(c.id, decision, nota, userName))} />

          {GRUPOS.map((g) => <Grupo key={g.tipo} nombre={g.nombre} facturas={d.facturas.filter((f) => f.tipo === g.tipo)} porFactura={d.porFactura} movil={movil} />)}

          <SaldoPrepago key={vuelta} companyId={activa.id} quien={userName} />
        </>
      )}
    </div>
  )
}

function PorAclarar({ cosas, cuenta, ocupado, alDecidir }: {
  cosas: CosaPorAclarar[]; cuenta: Cuenta; ocupado: boolean
  alDecidir: (c: CosaPorAclarar, decision: 'aceptada' | 'reclamada' | 'abierta', nota: string | null) => void
}) {
  const [reclamando, setReclamando] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const orden = [...cosas].sort((a, b) => Number(a.estado !== 'abierta') - Number(b.estado !== 'abierta'))
  return (
    <section className="cx-tarjeta cxk-aclarar" aria-labelledby="cxk-aclarar-titulo">
      <h3 id="cxk-aclarar-titulo">Por aclarar <span className="cxk-contador">{cuenta.abiertas}</span></h3>
      {cosas.length === 0 && <p className="cxr-apoyo">Nada: todos los pedidos, la tarifa, la comisión y los totales cuadran.</p>}
      <ul className="cxk-cosas">
        {orden.map((c) => (
          <li key={c.id} className={`cxk-cosa cxk-cosa-${c.estado}`} data-prueba="cosa-por-aclarar">
            <div className="cxk-cosa-cabeza">
              {/* Retoque 6: si la frase ya nombra el pedido, el título lo diría dos veces. */}
              {!(c.codigo && c.texto.includes(c.codigo)) && <span className="cxk-pedido">{c.codigo ? `${c.codigo} · ${cuando(c.momento)}` : 'Toda la quincena'}</span>}
              {c.factura && <span className="cxr-apoyo cxr-mono">{c.factura}</span>}
              <span className={`cxk-estado cxk-estado-${c.estado}`}>{ESTADO[c.estado]}</span>
            </div>
            <p className="cxk-porque">{c.texto}</p>
            {c.estado !== 'abierta' && <p className="cxr-apoyo">{c.quien ?? 'Alguien'}{c.nota ? `: «${c.nota}»` : ''}</p>}
            {reclamando === c.id ? (
              <form className="cxk-reclamar" onSubmit={(e) => { e.preventDefault(); alDecidir(c, 'reclamada', nota.trim()); setReclamando(null); setNota('') }}>
                <label className="cxk-campo"><span>Qué se reclama a Catcher</span>
                  <input className="cx-input" value={nota} onChange={(e) => setNota(e.target.value)} autoFocus /></label>
                <button type="submit" className="cx-boton" disabled={ocupado || !nota.trim()}>Apuntar la reclamación</button>
                <button type="button" className="cx-boton-sec" onClick={() => { setReclamando(null); setNota('') }}>Cancelar</button>
              </form>
            ) : (
              <div className="cxk-acciones">
                {c.estado !== 'aceptada' && <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => alDecidir(c, 'aceptada', null)}>Dar por buena</button>}
                {c.estado !== 'reclamada' && <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => { setReclamando(c.id); setNota('') }}>Reclamar</button>}
                {c.estado !== 'abierta' && <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => alDecidir(c, 'abierta', null)}>Volver a abrir</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Grupo({ nombre, facturas, porFactura, movil }: { nombre: string; facturas: FacturaDeLote[]; porFactura: Map<string, Cuenta>; movil: boolean }) {
  if (!facturas.length) return null
  const total = facturas.reduce((t, f) => t + Math.round(f.total * 100), 0) / 100
  const etiquetas = etiquetasDe(cuentaDeGrupo(facturas.map((f) => f.id), porFactura))
  const estado = (f: FacturaDeLote) => {
    const e = estadoDeFactura(porFactura.get(f.id), f)
    return <span className={`cxk-estado cxk-estado-${e.tono}`}>{e.texto}</span>
  }
  return (
    <section className="cx-tarjeta cxk-grupo" aria-label={nombre}>
      <h3>{nombre} <span className="cxr-apoyo">· {contar(facturas.length, 'factura', 'facturas')} · {eurosExactos(total)}</span>
        {etiquetas.map((e) => <span key={e.tono} className={`cxk-contador cxk-contador-${e.tono}`}>{e.texto}</span>)}</h3>
      {movil ? (
        <div className="cxr-tarjetas">
          {facturas.map((f) => (
            <Link key={f.id} to={rutaRevisarFactura(f.id)} className="cxr-tarjeta cxk-tarjeta">
              <span className="cxr-nombre">{f.emisor ?? 'Sin emisor'}</span>
              <span className="cxr-apoyo cxr-mono">{f.numero}</span>
              <span className="cxr-apoyo">{f.local ?? 'Varios locales'} · {eurosExactos(f.total)}</span>
              {estado(f)}
            </Link>
          ))}
        </div>
      ) : (
        <table className="cxr-tabla">
          <thead><tr><th>Emisor</th><th>Factura</th><th>Local</th><th className="cxr-der">Total</th><th>Estado</th></tr></thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id}>
                <td><Link to={rutaRevisarFactura(f.id)} className="cxr-nombre">{f.emisor ?? 'Sin emisor'}</Link>{f.nif && <span className="cxr-apoyo"> · {f.nif}</span>}</td>
                <td className="cxr-mono">{f.numero}</td>
                <td>{f.local ?? 'Varios locales'}</td>
                <td className="cxr-der cxr-mono">{eurosExactos(f.total)}</td>
                <td>{estado(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
