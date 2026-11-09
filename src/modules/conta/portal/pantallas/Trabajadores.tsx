// src/modules/conta/portal/pantallas/Trabajadores.tsx
//
// GP · Tarea 3 · Tus trabajadores: los de alta, «Pedir un alta» (nombre, DNI o
// NIE, fecha, tipo de contrato y horas) y «Pedir la baja». La petición llega a
// la gestoría, que la da por hecha desde la ficha (06/11: el cliente pide y la
// gestoría hace); al hacerla, cambia la línea del recibo. Una sola lectura:
// conta_portal_trabajadores.

import { useState, type ChangeEvent } from 'react'
import { leer } from '../cliente'
import { Cargando, Chip, Dialogo, Fallo } from '../comun'
import { documentoLimpio, fecha } from '../formato'
import type { Trabajadores as DatosTrab } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'

const hoy = () => new Date().toISOString().slice(0, 10)

export function Trabajadores({ cliente, abrir: pedido, avisar }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosTrab>('conta_portal_trabajadores', cliente)
  const [alta, setAlta] = useState(pedido.alta === '1')
  const [baja, setBaja] = useState<string | null>(null)
  if (cargando && !datos) return <Cargando que="tus trabajadores" />
  if (error || !datos) return <Fallo texto={error ?? 'No se han podido cargar.'} otraVez={recargar} />
  const pedidas = datos.peticiones.filter((p) => p.estado === 'pedida')
  const bajaPedida = (n: string) => pedidas.some((p) => p.tipo === 'baja' && p.nombre.toUpperCase() === n.toUpperCase())

  return (
    <>
      <div className="pt-cabeza">
        <h1 className="pt-h1">Tus trabajadores</h1>
        <button type="button" className="pt-boton" onClick={() => setAlta((x) => !x)} aria-expanded={alta}>Pedir un alta</button>
      </div>
      {alta && <PedirAlta cliente={cliente} cerrar={() => setAlta(false)} hecho={(t) => { setAlta(false); avisar({ tipo: 'ok', texto: t }); recargar() }} avisar={avisar} />}
      {pedidas.length > 0 && (
        <section className="pt-tarjeta" aria-label="Lo que has pedido">
          <h2 className="pt-h2">Lo que has pedido</h2>
          <div>{pedidas.map((p) => (
            <div className="pt-fila" key={p.id}>
              <div className="pt-fila-texto"><b>{p.tipo === 'alta' ? 'Alta' : 'Baja'} de {p.nombre}</b><span>{p.tipo === 'alta' ? 'Desde' : 'Hasta'} el {fecha(p.fecha)} · pedida el {fecha(p.pedida)}</span></div>
              <Chip texto="Pedida" tono="info" />
            </div>))}</div>
        </section>
      )}
      <section className="pt-lista" aria-label="Trabajadores de alta">
        {datos.trabajadores.length === 0 && <div className="pt-vacio">Tu gestoría no tiene ningún trabajador tuyo de alta en tu recibo.</div>}
        {datos.trabajadores.map((w) => (
          <div className="pt-fila" key={w.linea_id}>
            <div className="pt-fila-texto"><b>{w.nombre}</b><span>{w.nuevo ? `Alta el ${fecha(w.desde)}` : `Desde ${fecha(w.desde)}`}{w.hasta ? ` · baja en ${fecha(w.hasta)}` : ''}</span></div>
            <Chip texto={w.nuevo ? 'Alta nueva' : 'De alta'} tono={w.nuevo ? 'info' : 'ok'} />
            <button type="button" className="pt-boton sec chico" disabled={bajaPedida(w.nombre)} onClick={() => setBaja(w.nombre)}>{bajaPedida(w.nombre) ? 'Baja pedida' : 'Pedir la baja'}</button>
          </div>
        ))}
      </section>
      {datos.peticiones.filter((p) => p.estado !== 'pedida').length > 0 && (
        <section className="pt-tarjeta" aria-label="Lo que ha hecho tu gestoría">
          <h2 className="pt-h2">Lo que ha hecho tu gestoría</h2>
          <div>{datos.peticiones.filter((p) => p.estado !== 'pedida').map((p) => (
            <div className="pt-fila" key={p.id}>
              <div className="pt-fila-texto"><b>{p.tipo === 'alta' ? 'Alta' : 'Baja'} de {p.nombre}</b><span>{p.estado === 'hecha' ? `Hecha el ${fecha(p.resuelta)}` : `No hecha: ${p.motivo ?? ''}`}</span></div>
              <Chip texto={p.estado === 'hecha' ? 'Hecha' : 'Rechazada'} />
            </div>))}</div>
        </section>
      )}
      {baja && <PedirBaja cliente={cliente} nombre={baja} cerrar={() => setBaja(null)} hecho={(t) => { setBaja(null); avisar({ tipo: 'ok', texto: t }); recargar() }} avisar={avisar} />}
    </>
  )
}

function PedirAlta({ cliente, cerrar, hecho, avisar }: { cliente: string; cerrar: () => void; hecho: (t: string) => void; avisar: Pantalla['avisar'] }) {
  const [f, setF] = useState({ nombre: '', documento: '', fecha: hoy(), contrato: 'Indefinido', horas: '40' })
  const [enviando, setEnviando] = useState(false)
  const pon = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const enviar = async () => {
    if (!f.nombre.trim()) { avisar({ tipo: 'mal', texto: 'Escribe el nombre y los apellidos.' }); return }
    if (!documentoLimpio(f.documento)) { avisar({ tipo: 'mal', texto: 'El DNI o NIE no tiene la forma de uno (8 cifras y una letra, o X, Y o Z al principio).' }); return }
    setEnviando(true)
    try {
      const r = await leer<{ frase: string }>('conta_portal_solicitud_pedir', { p_party: cliente, p_tipo: 'alta', p_nombre: f.nombre, p_documento: f.documento, p_fecha: f.fecha, p_contrato: f.contrato, p_horas: Number(f.horas) || null })
      hecho(r.frase)
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setEnviando(false) }
  }
  return (
    <section className="pt-tarjeta" aria-label="Pedir el alta de un trabajador">
      <b style={{ fontSize: 15 }}>Pedir el alta de un trabajador</b>
      <div className="pt-nota" style={{ fontSize: 13 }}>Tu gestoría hace el alta en la Seguridad Social y te avisa cuando esté. Desde ese mes se cobra en tu recibo.</div>
      <div className="pt-rejilla">
        <label className="pt-campo">Nombre y apellidos<input value={f.nombre} onChange={pon('nombre')} autoComplete="off" /></label>
        <label className="pt-campo">DNI o NIE<input value={f.documento} onChange={pon('documento')} autoComplete="off" inputMode="text" /></label>
        <label className="pt-campo">Fecha de alta<input type="date" value={f.fecha} onChange={pon('fecha')} /></label>
        <label className="pt-campo">Tipo de contrato
          <select value={f.contrato} onChange={pon('contrato')}>{['Indefinido', 'Temporal', 'Fijo discontinuo', 'Prácticas', 'Formación'].map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="pt-campo">Horas a la semana<input type="number" min={1} max={60} value={f.horas} onChange={pon('horas')} /></label>
      </div>
      <div className="pt-botones">
        <button type="button" className="pt-boton" disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar la petición'}</button>
        <button type="button" className="pt-boton enlace" onClick={cerrar}>Cancelar</button>
      </div>
    </section>
  )
}

function PedirBaja({ cliente, nombre, cerrar, hecho, avisar }: { cliente: string; nombre: string; cerrar: () => void; hecho: (t: string) => void; avisar: Pantalla['avisar'] }) {
  const [dia, setDia] = useState(hoy())
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const enviar = async () => {
    setEnviando(true)
    try {
      const r = await leer<{ frase: string }>('conta_portal_solicitud_pedir', { p_party: cliente, p_tipo: 'baja', p_nombre: nombre, p_documento: null, p_fecha: dia, p_contrato: null, p_horas: null, p_nota: nota || null })
      hecho(r.frase)
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setEnviando(false) }
  }
  return (
    <Dialogo titulo={`Pedir la baja de ${nombre}`} cerrar={cerrar}>
      <div className="pt-nota" style={{ fontSize: 13 }}>Tu gestoría la tramita y te avisa. El mes de la baja se cobra entero.</div>
      <label className="pt-campo">Último día<input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
      <label className="pt-campo">Algo más que deba saber (opcional)<textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} /></label>
      <div className="pt-botones"><button type="button" className="pt-boton" disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Pedir la baja'}</button></div>
    </Dialogo>
  )
}
