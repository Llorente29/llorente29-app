// src/modules/conta/portal/pantallas/Inicio.tsx
//
// GP · Tarea 3 · Inicio del portal del cliente, fiel a la maqueta: lo que pide
// la gestoría (firmar, subir, contestar), el aviso rojo de un devuelto con sus
// formas de pagar (las que la gestoría deja en Ajustes), el próximo recibo con
// su desglose, por qué cambia y «No estoy de acuerdo», los atajos y lo último.
// Una sola lectura: conta_portal_inicio.

import { useState, type ReactNode } from 'react'
import { ArrowUp, CircleCheck, Euro, FileText, MessageCircle, PenLine, Plus, Receipt, Users } from 'lucide-react'
import { accion } from '../cliente'
import { Cargando, Chip, Fallo } from '../comun'
import { diferencia, euros, eurosDe, fecha, lineasDelRecibo, mes, nombreDePila, nombreImpuesto, porQueCambia } from '../formato'
import type { Inicio as DatosInicio, Novedad, Peticion } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'
import { Firmar } from './Firmar'

export function Inicio({ cliente, ir, avisar }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosInicio>('conta_portal_inicio', cliente)
  const [firmando, setFirmando] = useState<Peticion | null>(null)
  if (cargando && !datos) return <Cargando que="tu espacio" />
  if (error || !datos) return <Fallo texto={error ?? 'No se ha podido cargar.'} otraVez={recargar} />
  const d = datos
  const todo = d.yo.permiso === 'todo'
  const pendientes = d.peticiones.length

  const hacer = (q: Peticion) => {
    if (q.tipo === 'firmar') setFirmando(q)
    else if (q.tipo === 'subir') ir('documentos', { peticion: q.id })
    else ir('mensajes', { contestar: q.id, pregunta: q.titulo })
  }

  return (
    <>
      <h1 className="pt-h1">{nombreDePila(d.yo.nombre) ? `Hola, ${nombreDePila(d.yo.nombre)}` : 'Hola'}</h1>

      {todo && (
        <section className="pt-tarjeta" aria-labelledby="pt-piden">
          <div className="pt-cabeza">
            <h2 className="pt-h2" id="pt-piden">Lo que te pide tu gestoría</h2>
            <Chip texto={pendientes ? `${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}` : 'Todo hecho'} tono={pendientes ? 'aviso' : 'ok'} />
          </div>
          {pendientes === 0 && <div className="pt-nota">No tienes nada pendiente. Cuando tu gestoría te pida algo, sale aquí y te llega un correo.</div>}
          <div>
            {d.peticiones.map((q) => (
              <div className="pt-fila" key={q.id}>
                <span className="pt-icono" aria-hidden="true" style={tonoPeticion(q.tipo)}>{q.tipo === 'firmar' ? <PenLine /> : q.tipo === 'subir' ? <ArrowUp /> : <MessageCircle />}</span>
                <div className="pt-fila-texto">
                  <b>{q.titulo}</b>
                  <span>{q.fecha_limite ? `Antes del ${fecha(q.fecha_limite)}` : 'Sin fecha límite'}{q.detalle ? ` · ${q.detalle}` : ''}</span>
                </div>
                <button type="button" className="pt-boton chico" onClick={() => hacer(q)}>{q.tipo === 'firmar' ? 'Firmar' : q.tipo === 'subir' ? 'Subirlo' : 'Contestar'}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {d.devueltos.map((v) => <Devuelto key={v.recibo_id} cliente={cliente} v={v} formas={d.pagar_devuelto} avisar={avisar} recargar={recargar} />)}

      {todo && d.proximo && <ProximoRecibo cliente={cliente} p={d.proximo} avisar={avisar} recargar={recargar} />}

      <section className="pt-atajos" aria-label="Atajos">
        {d.puede_subir && <Atajo icono={<ArrowUp />} t="Subir una factura" d="O un ticket, con una foto" pick={() => ir('documentos')} />}
        {todo && <Atajo icono={<Plus />} t="Pedir un alta" d="De un trabajador nuevo" pick={() => ir('trabajadores', { alta: '1' })} />}
        <Atajo icono={<Euro />} t="Tus facturas" d="Todas, en PDF" pick={() => ir('facturas')} />
        {todo && <Atajo icono={<MessageCircle />} t="Escribir a tu gestoría" d={d.mensajes_sin_leer ? `${d.mensajes_sin_leer} sin leer` : 'Contesta en el día'} pick={() => ir('mensajes')} />}
      </section>

      <section className="pt-tarjeta" aria-labelledby="pt-ultimo">
        <h2 className="pt-h2" id="pt-ultimo">Lo último de tu gestoría</h2>
        {d.novedades.length === 0 && <div className="pt-nota">Aún no hay nada. Aquí salen tus facturas, los impuestos que te presentan y las altas que te hacen.</div>}
        <div>{d.novedades.map((n) => <FilaNovedad key={`${n.tipo}-${n.id}`} n={n} ir={ir} />)}</div>
      </section>

      {firmando && <Firmar cliente={cliente} peticion={firmando} cerrar={() => setFirmando(null)} hecho={(t) => { setFirmando(null); avisar({ tipo: 'ok', texto: t }); recargar() }} />}
    </>
  )
}

function tonoPeticion(t: Peticion['tipo']) {
  return t === 'firmar' ? { background: '#F3E8FD', color: '#6B2BAE' } : t === 'subir' ? { background: '#FFF1DE', color: '#8A4B08' } : { background: '#E3ECFD', color: '#1747AE' }
}

function Atajo({ icono, t, d, pick }: { icono: ReactNode; t: string; d: string; pick: () => void }) {
  return (
    <button type="button" className="pt-atajo" onClick={pick}>
      <span className="pt-icono" aria-hidden="true">{icono}</span>
      <b>{t}</b><span>{d}</span>
    </button>
  )
}

function FilaNovedad({ n, ir }: { n: Novedad; ir: Pantalla['ir'] }) {
  const v = n.tipo === 'factura' ? { ico: <Receipt />, t: `${n.titulo}${n.total != null ? ` · ${eurosDe(n.total)}` : ''}`, d: fecha(n.cuando), b: 'Ver', go: () => ir('facturas') }
    : n.tipo === 'impuesto' ? { ico: <FileText />, t: `${nombreImpuesto(n.titulo, n.periodo ?? null, n.ejercicio ?? null)} presentado`, d: `${fecha(n.cuando)}${n.importe != null ? ` · ${eurosDe(n.importe)}` : ''}`, b: 'Ver', go: () => ir('documentos') }
    : n.tipo === 'alta' ? { ico: <Users />, t: `${n.alta === 'baja' ? 'Baja' : 'Alta'} de ${n.titulo} ${n.estado === 'hecha' ? 'hecha' : 'no hecha'}`, d: n.desde ? `Desde el ${fecha(n.desde)}` : '', b: 'Ver', go: () => ir('trabajadores') }
    : { ico: <MessageCircle />, t: n.titulo || 'Mensaje de tu gestoría', d: fecha(n.cuando), b: 'Leer', go: () => ir('mensajes') }
  return (
    <div className="pt-fila">
      <span className="pt-icono" aria-hidden="true">{v.ico}</span>
      <div className="pt-fila-texto"><b>{v.t}</b><span>{v.d}</span></div>
      <button type="button" className="pt-boton enlace" onClick={v.go}>{v.b}</button>
    </div>
  )
}

function Devuelto({ cliente, v, formas, avisar, recargar }: { cliente: string; v: DatosInicio['devueltos'][number]; formas: DatosInicio['pagar_devuelto']; avisar: Pantalla['avisar']; recargar: () => void }) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const ir = async (que: 'banco_pagar' | 'tarjeta' | 'reintentar') => {
    setOcupado(que)
    try {
      const r = await accion(que, { cliente, recibo: v.recibo_id })
      if (r.ok && typeof r.url === 'string') { window.location.href = r.url; return }
      avisar({ tipo: r.ok ? 'ok' : 'mal', texto: r.frase ?? 'Hecho.' })
      if (r.ok) recargar()
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setOcupado(null) }
  }
  return (
    <section className="pt-devuelto" aria-labelledby={`pt-dev-${v.recibo_id}`}>
      <div id={`pt-dev-${v.recibo_id}`} style={{ fontSize: 13, color: '#A11B12', fontWeight: 700 }}>Tienes un recibo devuelto</div>
      <div className="pt-cifra">{euros(v.importe_cent)}</div>
      <div style={{ color: '#7A140D' }}>
        El de {mes(v.mes).toLowerCase()}. {v.devuelto_el ? `Tu banco lo devolvió el ${fecha(v.devuelto_el)}. ` : 'Tu banco lo devolvió. '}Puedes pagarlo ahora y queda todo al día.
      </div>
      {v.en_marcha && <div className="pt-nota" style={{ color: '#7A140D' }}>Empezaste a pagarlo el {fecha(v.en_marcha.creada)}: si no lo terminaste, vuelve a pulsar.</div>}
      <div className="pt-botones">
        {formas.includes('banco') && <button type="button" className="pt-boton peligro" disabled={!!ocupado} onClick={() => ir('banco_pagar')}>{ocupado === 'banco_pagar' ? 'Abriendo tu banco…' : 'Pagar ahora desde tu banco'}</button>}
        {formas.includes('tarjeta') && <button type="button" className="pt-boton peligro" disabled={!!ocupado} onClick={() => ir('tarjeta')}>{ocupado === 'tarjeta' ? 'Abriendo el pago…' : 'Pagar con tarjeta o Bizum'}</button>}
        <button type="button" className="pt-boton peligro-sec" disabled={!!ocupado} onClick={() => ir('reintentar')}>{ocupado === 'reintentar' ? 'Pidiéndolo…' : 'Que lo pasen de nuevo'}</button>
      </div>
    </section>
  )
}

function ProximoRecibo({ cliente, p, avisar, recargar }: { cliente: string; p: NonNullable<DatosInicio['proximo']>; avisar: Pantalla['avisar']; recargar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const lineas = lineasDelRecibo(p.lineas)
  const cambio = diferencia(p.total_cent, p.anterior_cent)
  const porque = porQueCambia(p.cambios)
  const enviar = async () => {
    if (!texto.trim()) { avisar({ tipo: 'mal', texto: 'Cuéntanos qué no cuadra.' }); return }
    setEnviando(true)
    try {
      const r = await accion('no_de_acuerdo', { cliente, recibo: p.recibo_id, texto })
      avisar({ tipo: r.ok ? 'ok' : 'mal', texto: r.frase ?? 'Enviado.' })
      if (r.ok) { setAbierto(false); setTexto(''); recargar() }
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setEnviando(false) }
  }
  return (
    <section className="pt-tarjeta" aria-labelledby="pt-proximo">
      <div className="pt-cabeza" style={{ alignItems: 'flex-start' }}>
        <div>
          <div id="pt-proximo" style={{ fontSize: 13, color: 'var(--suave)', fontWeight: 600 }}>
            Tu próximo recibo · {mes(p.mes)}{p.cargo_el ? ` · se carga el ${fecha(p.cargo_el)}` : ''}
          </div>
          <div className="pt-cifra">{euros(p.total_cent)}</div>
        </div>
        {cambio && <Chip texto={cambio.texto} tono={cambio.tono} />}
      </div>
      {porque && <div style={{ background: '#FFF8EE', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#6B3A06' }}>Por qué cambia: {porque}</div>}
      <div>
        {lineas.map((l, i) => (
          <div className="pt-datos" key={i}>
            <span style={{ color: 'var(--tinta)' }}>{l.texto}{l.detalle && <span className="pt-nota" style={{ display: 'block' }}>{l.detalle}</span>}</span>
            <b style={{ fontWeight: 600 }}>{l.importe}</b>
          </div>
        ))}
      </div>
      <div className="pt-nota" style={{ fontSize: 13 }}>Se carga en tu cuenta de cargo (la ves en «Tu cuenta»). La factura te llega por correo en cuanto se cobre.</div>
      {p.incidencia ? (
        <div className="pt-aviso info" role="status">
          <span><CircleCheck size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Le dijiste a tu gestoría que no estás de acuerdo el {fecha(p.incidencia.creada)}{p.incidencia.parado ? ': el recibo está parado hasta que lo revise' : ': lo está revisando'}.</span>
        </div>
      ) : (
        <div className="pt-botones"><button type="button" className="pt-boton sec" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}>No estoy de acuerdo</button></div>
      )}
      {abierto && !p.incidencia && (
        <div style={{ border: '1px solid var(--borde)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b>Cuéntanos qué no cuadra</b>
          <div className="pt-nota" style={{ fontSize: 13 }}>Tu recibo se para hasta que tu gestoría lo revise. Los demás cargos no cambian.</div>
          <label className="pt-oculto" htmlFor="pt-desacuerdo">Qué no cuadra</label>
          <textarea id="pt-desacuerdo" className="pt-texto" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={3000} placeholder="Por ejemplo: el trabajador nuevo empezó el día 20" />
          <div className="pt-botones"><button type="button" className="pt-boton" disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar a mi gestoría'}</button></div>
        </div>
      )}
    </section>
  )
}
