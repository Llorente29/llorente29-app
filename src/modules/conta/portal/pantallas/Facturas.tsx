// src/modules/conta/portal/pantallas/Facturas.tsx
//
// GP · Tarea 3 · Tus facturas: todas, con su estado y su PDF (el de Code 1),
// un buscador por número o concepto, el filtro por año y la descarga del año en
// un ZIP (los PDF con enlaces firmados de 5 minutos; el ZIP lo hace el
// navegador). Una sola lectura: conta_portal_facturas.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { zipSync } from 'fflate'
import { abrir, accion } from '../cliente'
import { Cargando, Chip, Fallo } from '../comun'
import { eurosDe, fecha, mes } from '../formato'
import type { Facturas as DatosFacturas } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'

export function Facturas({ cliente, avisar }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosFacturas>('conta_portal_facturas', cliente)
  const [buscar, setBuscar] = useState('')
  const [anio, setAnio] = useState<number | 'todas' | null>(null)
  const [zip, setZip] = useState(false)
  const anios = useMemo(() => [...new Set((datos?.facturas ?? []).map((f) => f.anio))].sort((a, b) => b - a), [datos])
  const elegido = anio ?? anios[0] ?? 'todas'
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (datos?.facturas ?? []).filter((f) => (elegido === 'todas' || f.anio === elegido)
      && (!q || `${f.numero} ${f.concepto ?? ''} ${f.recibo_mes ? mes(f.recibo_mes) : ''}`.toLowerCase().includes(q)))
  }, [datos, buscar, elegido])
  if (cargando && !datos) return <Cargando que="tus facturas" />
  if (error || !datos) return <Fallo texto={error ?? 'No se han podido cargar.'} otraVez={recargar} />

  const bajarZip = async () => {
    if (elegido === 'todas') return
    setZip(true)
    try {
      const r = await accion('archivos', { cliente, anio: elegido })
      const lista = (r.archivos as { nombre: string; url: string }[] | undefined) ?? []
      if (!r.ok || !lista.length) { avisar({ tipo: r.ok ? 'info' : 'mal', texto: r.frase ?? 'No hay facturas con PDF.' }); return }
      const ficheros: Record<string, Uint8Array> = {}
      for (const a of lista) {
        const b = await fetch(a.url)
        if (b.ok) ficheros[a.nombre] = new Uint8Array(await b.arrayBuffer())
      }
      const datosZip = zipSync(ficheros, { level: 0 })
      const url = URL.createObjectURL(new Blob([datosZip as BlobPart], { type: 'application/zip' }))
      const enlace = document.createElement('a')
      enlace.href = url; enlace.download = `Facturas ${elegido}.zip`
      document.body.appendChild(enlace); enlace.click(); enlace.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      avisar({ tipo: 'ok', texto: `Descargadas ${Object.keys(ficheros).length} facturas de ${elegido} en un ZIP.` })
    } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) } finally { setZip(false) }
  }

  return (
    <>
      <div className="pt-cabeza">
        <h1 className="pt-h1">Tus facturas</h1>
        {elegido !== 'todas' && <button type="button" className="pt-boton sec chico" disabled={zip} onClick={bajarZip}>{zip ? 'Preparando el ZIP…' : `Descargar las de ${elegido} (ZIP)`}</button>}
      </div>
      <div className="pt-botones">
        <label className="pt-buscar"><Search size={16} aria-hidden="true" /><span className="pt-oculto">Buscar</span>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por número o concepto" />
        </label>
        {anios.map((a) => <button type="button" key={a} className="pt-filtro" aria-pressed={elegido === a} onClick={() => setAnio(a)}>{a}</button>)}
        <button type="button" className="pt-filtro" aria-pressed={elegido === 'todas'} onClick={() => setAnio('todas')}>Todas</button>
      </div>
      <section className="pt-lista" aria-label="Facturas">
        {lista.length === 0 && <div className="pt-vacio">{datos.facturas.length ? 'Ninguna factura con esa búsqueda.' : 'Aún no tienes facturas. Te llega cada una por correo en cuanto se emite.'}</div>}
        {lista.map((f) => (
          <div className="pt-fila" key={f.id}>
            <div className="pt-fila-texto">
              <b>{f.tipo === 'rectificativa' ? 'Rectificativa' : 'Factura'} {f.numero}</b>
              <span>{f.recibo_mes ? `${mes(f.recibo_mes)} · ` : ''}{fecha(f.fecha)}{f.concepto && !f.recibo_mes ? ` · ${f.concepto}` : ''}</span>
            </div>
            <Chip texto={f.estado} />
            <b className="pt-importe">{eurosDe(f.total)}</b>
            <button type="button" className="pt-boton sec chico" disabled={!f.tiene_pdf} aria-label={`Descargar el PDF de la factura ${f.numero}`}
              onClick={() => abrir(cliente, 'factura', f.id).catch((e: Error) => avisar({ tipo: 'mal', texto: e.message }))}>{f.tiene_pdf ? 'PDF' : 'Sin PDF'}</button>
          </div>
        ))}
      </section>
      <div className="pt-nota">Todas con Verifactu: puedes comprobar cada una en la sede de la Agencia Tributaria con su código QR.</div>
    </>
  )
}
