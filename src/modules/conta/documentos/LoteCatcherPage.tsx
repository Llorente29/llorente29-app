// src/modules/conta/documentos/LoteCatcherPage.tsx
//
// E05 · Una quincena de Catcher subida, dentro de Documentos y con su estilo:
//   · el resumen en una línea («2.ª quincena de septiembre de 2026 · 58
//     facturas · 1.062,25 € · cuadra con los pedidos salvo 1») y sus cifras;
//   · «Por aclarar», cada cosa con su pedido, su porqué y sus botones: «Dar por
//     buena», «Reclamar» (diciendo qué) y «Volver a abrir». Lo ya decidido se
//     sigue viendo, con quién y qué (regla 7: nada se esconde);
//   · las facturas agrupadas por riders, flotas y Catcher, con su contador de
//     «Por aclarar»;
//   · el pago contra la 40700001 y el saldo prepago.
// Cada botón dice lo que ha hecho o por qué no (regla 8).

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rutaDocumentos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { cuando, resumenLote } from '@/modules/conta/lib/catcherCruces'
import type { TipoFactura } from '@/modules/conta/lib/catcherQuincena'
import {
  aclarar, cruzarLote, leerLote, proponerPagoLote, SALDO_PREPAGO, type CosaPorAclarar, type FacturaDeLote,
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
  const datos = useLeer(accountId && loteId ? () => leerLote(accountId, loteId) : null, `${loteId}:${vuelta}`)
  const [paso, setPaso] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  async function hacer(que: string, f: () => Promise<string>) {
    setPaso(que); setHecho(null); setFallo(null)
    try { setHecho(await f()); setVuelta((v) => v + 1) } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setPaso(null) }
  }

  if (!activa || !accountId) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay ninguna empresa." explicacion="Da de alta tu empresa y aquí llegan sus facturas." /></div>
  const d = datos.datos
  const abiertas = d ? d.porAclarar.filter((x) => x.estado === 'abierta') : []

  return (
    <div className="cxl-pagina">
      <header className="cxl-cabeza">
        <div>
          <span className="cxl-ante">Contabilidad</span>
          <h1 className="cxl-titulo">Documentos</h1>
        </div>
      </header>
      {datos.error && <ErrorConReintento mensaje={datos.error} reintentar={datos.recargar} />}
      {!d && !datos.error && <div className="cx-tarjeta" aria-busy="true"><Hueso ancho="60%" alto={22} /><Hueso /><Hueso /></div>}
      {d && (
        <>
          <div className="cxr-seccion">
            <div>
              <Migas migas={[{ etiqueta: 'Documentos', ruta: rutaDocumentos() }, { etiqueta: 'Facturas de Catcher' }]} />
              <h2>{d.lote.etiqueta}</h2>
            </div>
            <div className="cxr-herramientas">
              <button type="button" className="cx-boton-sec" disabled={!!paso}
                onClick={() => void hacer('Cruzando con los pedidos…', async () => (await cruzarLote(accountId, activa.id, loteId, userName)).texto)}>Cruzar otra vez</button>
              <button type="button" className="cx-boton" disabled={!!paso || !!d.lote.pago}
                onClick={() => void hacer('Proponiendo el pago…', async () => (await proponerPagoLote(loteId, userName)).texto)}>
                {d.lote.pago ? 'Pago propuesto' : `Proponer el pago desde la ${SALDO_PREPAGO.cuenta}`}
              </button>
            </div>
          </div>
          <p className="cxk-resumen"><strong>{resumenLote({ etiqueta: d.lote.etiqueta, facturas: d.lote.facturas, total: d.lote.total, cruzado: d.lote.cruzado, abiertas: d.lote.abiertas })}</strong></p>

          <div role="status" aria-live="polite" data-prueba="hecho-quincena">
            {paso && <div className="cx-tarjeta">{paso}</div>}
            {hecho && <div className="cx-tarjeta cxr-hecho"><strong>{hecho}</strong></div>}
          </div>
          {fallo && <div className="cx-error" role="alert">{fallo}</div>}

          <div className="cxr-cifras cxk-cifras">
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Facturas</span><span className="cxr-cifra-valor">{d.lote.facturas}</span>
              <span className="cxr-cifra-apoyo">{GRUPOS.map((g) => `${d.facturas.filter((f) => f.tipo === g.tipo).length} ${g.nombre.toLowerCase()}`).join(' · ')}</span></div>
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Total</span><span className="cxr-cifra-valor">{eurosExactos(d.lote.total)}</span>
              <span className="cxr-cifra-apoyo">lo que baja la {SALDO_PREPAGO.cuenta}</span></div>
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Por aclarar</span><span className="cxr-cifra-valor">{abiertas.length}</span>
              <span className="cxr-cifra-apoyo">{d.lote.cruzado ? `${d.porAclarar.length - abiertas.length} ya decididas` : 'sin cruzar todavía'}</span></div>
            <div className="cxr-cifra"><span className="cxr-cifra-etiqueta">Comisión de Catcher</span>
              <span className="cxr-cifra-valor">{d.comision ? eurosExactos(d.comision.cobrada) : '—'}</span>
              <span className="cxr-cifra-apoyo">{d.comision ? `por pedido entregado serían ${eurosExactos(d.comision.esperada)}` : 'sin cruzar todavía'}</span></div>
          </div>

          <PorAclarar cosas={d.porAclarar} ocupado={!!paso}
            alDecidir={(c, decision, nota) => void hacer('Guardando…', () => aclarar(c.id, decision, nota, userName))} />

          {GRUPOS.map((g) => <Grupo key={g.tipo} nombre={g.nombre} facturas={d.facturas.filter((f) => f.tipo === g.tipo)} movil={movil} />)}

          <SaldoPrepago key={vuelta} companyId={activa.id} quien={userName} />
        </>
      )}
    </div>
  )
}

function PorAclarar({ cosas, ocupado, alDecidir }: {
  cosas: CosaPorAclarar[]; ocupado: boolean
  alDecidir: (c: CosaPorAclarar, decision: 'aceptada' | 'reclamada' | 'abierta', nota: string | null) => void
}) {
  const [reclamando, setReclamando] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const orden = [...cosas].sort((a, b) => Number(a.estado !== 'abierta') - Number(b.estado !== 'abierta'))
  return (
    <section className="cx-tarjeta cxk-aclarar" aria-labelledby="cxk-aclarar-titulo">
      <h3 id="cxk-aclarar-titulo">Por aclarar <span className="cxk-contador">{cosas.filter((c) => c.estado === 'abierta').length}</span></h3>
      {cosas.length === 0 && <p className="cxr-apoyo">Nada: todos los pedidos, la tarifa, la comisión y los totales cuadran.</p>}
      <ul className="cxk-cosas">
        {orden.map((c) => (
          <li key={c.id} className={`cxk-cosa cxk-cosa-${c.estado}`} data-prueba="cosa-por-aclarar">
            <div className="cxk-cosa-cabeza">
              <span className="cxk-pedido">{c.codigo ? `${c.codigo} · ${cuando(c.momento)}` : 'Toda la quincena'}</span>
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

const estadoFactura = (f: FacturaDeLote) =>
  f.sinProveedor ? 'Sin ficha del proveedor' : f.aclarar > 0 ? `Por aclarar (${f.aclarar})` : f.confianza === 'seguro' ? 'Cuadra' : 'Por mirar'

function Grupo({ nombre, facturas, movil }: { nombre: string; facturas: FacturaDeLote[]; movil: boolean }) {
  if (!facturas.length) return null
  const total = facturas.reduce((t, f) => t + Math.round(f.total * 100), 0) / 100
  const porAclarar = facturas.filter((f) => f.aclarar > 0 || f.confianza !== 'seguro').length
  return (
    <section className="cx-tarjeta cxk-grupo" aria-label={nombre}>
      <h3>{nombre} <span className="cxr-apoyo">· {facturas.length} {facturas.length === 1 ? 'factura' : 'facturas'} · {eurosExactos(total)}</span>
        {porAclarar > 0 && <span className="cxk-contador">{porAclarar} por aclarar</span>}</h3>
      {movil ? (
        <div className="cxr-tarjetas">
          {facturas.map((f) => (
            <Link key={f.id} to={rutaRevisarFactura(f.id)} className="cxr-tarjeta cxk-tarjeta">
              <span className="cxr-nombre">{f.emisor ?? 'Sin emisor'}</span>
              <span className="cxr-apoyo cxr-mono">{f.numero}</span>
              <span className="cxr-apoyo">{f.local ?? 'Varios locales'} · {eurosExactos(f.total)}</span>
              <span className={`cxk-estado ${f.aclarar > 0 || f.confianza !== 'seguro' ? 'cxk-estado-abierta' : 'cxk-estado-aceptada'}`}>{estadoFactura(f)}</span>
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
                <td><span className={`cxk-estado ${f.aclarar > 0 || f.confianza !== 'seguro' ? 'cxk-estado-abierta' : 'cxk-estado-aceptada'}`}>{estadoFactura(f)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
