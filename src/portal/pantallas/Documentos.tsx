// src/portal/pantallas/Documentos.tsx
//
// GP · Tarea 3 · Documentos: subir facturas y tickets (también con una foto
// desde el móvil, o arrastrando) al buzón de su cuenta en Sumied, y ver lo que
// la gestoría le deja: impuestos presentados con su justificante, nóminas y
// seguros sociales, y lo que ha subido. Una sola lectura: conta_portal_documentos.

import { useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { abrir, accion, subirFichero } from '../cliente'
import { Cargando, Chip, Fallo } from '../comun'
import { eurosDe, fecha, nombreImpuesto, puedeSubirse } from '../formato'
import type { Documentos as DatosDocs } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'

type Tipo = 'impuestos' | 'nominas' | 'subidas'

export function Documentos({ cliente, permiso, abrir: pedido, avisar }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosDocs>('conta_portal_documentos', cliente)
  const [tipo, setTipo] = useState<Tipo>('impuestos')
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [encima, setEncima] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  if (cargando && !datos) return <Cargando que="tus documentos" />
  if (error || !datos) return <Fallo texto={error ?? 'No se han podido cargar.'} otraVez={recargar} />

  const subir = async (lista: FileList | null) => {
    const ficheros = [...(lista ?? [])]
    if (!ficheros.length) return
    const hechos: string[] = []
    for (const f of ficheros) {
      const mal = puedeSubirse(f)
      if (mal) { avisar({ tipo: 'mal', texto: mal }); continue }
      setSubiendo(f.name)
      try {
        const ruta = await subirFichero(cliente, f, 'subidas')
        const r = await accion('subir', { cliente, ruta, nombre: f.name, tipo: f.type || 'image/heic', bytes: f.size, peticion: pedido.peticion ?? null })
        if (!r.ok) { avisar({ tipo: 'mal', texto: r.frase ?? `No se ha podido subir «${f.name}».` }); continue }
        hechos.push(f.name)
      } catch (e) { avisar({ tipo: 'mal', texto: (e as Error).message }) }
    }
    setSubiendo(null)
    if (entrada.current) entrada.current.value = ''
    if (hechos.length) {
      avisar({ tipo: 'ok', texto: hechos.length === 1 ? `Recibido: ${hechos[0]}. Tu gestoría ya lo tiene.` : `Recibidos ${hechos.length} documentos. Tu gestoría ya los tiene.` })
      setTipo('subidas'); recargar()
    }
  }

  const tipos: { id: Tipo; label: string; n: number }[] = [
    { id: 'impuestos', label: 'Impuestos presentados', n: datos.impuestos.length },
    ...(permiso === 'todo' ? [{ id: 'nominas' as Tipo, label: 'Nóminas', n: datos.nominas.length }] : []),
    { id: 'subidas', label: 'Lo que has subido', n: datos.subidas.length },
  ]
  const abrirDoc = (t: string, id: string) => abrir(cliente, t, id).catch((e: Error) => avisar({ tipo: 'mal', texto: e.message }))

  return (
    <>
      <h1 className="pt-h1">Documentos</h1>
      {datos.puede_subir ? (
        <section className={`pt-subir${encima ? ' encima' : ''}`} aria-label="Subir un documento"
          onDragOver={(e) => { e.preventDefault(); setEncima(true) }} onDragLeave={() => setEncima(false)}
          onDrop={(e) => { e.preventDefault(); setEncima(false); void subir(e.dataTransfer.files) }}>
          <span className="pt-icono" aria-hidden="true" style={{ width: 44, height: 44, background: 'var(--azul-claro)', color: 'var(--azul-oscuro)' }}><ArrowUp /></span>
          <b style={{ fontSize: 15 }}>Sube una factura, un ticket o cualquier documento</b>
          <span className="pt-nota" style={{ fontSize: 13 }}>Arrástralo aquí o haz una foto con el móvil. Tu gestoría lo recibe al momento.</span>
          <input ref={entrada} id="pt-fichero" type="file" className="pt-oculto" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic" onChange={(e) => void subir(e.target.files)} />
          <button type="button" className="pt-boton" disabled={!!subiendo} onClick={() => entrada.current?.click()}>{subiendo ? `Subiendo ${subiendo}…` : 'Elegir o hacer foto'}</button>
        </section>
      ) : (
        <div className="pt-aviso info" role="status"><span>Para subir documentos desde aquí, tu gestoría tiene que tener tu empresa dada de alta en Sumied. Mientras, mándaselos por Mensajes.</span></div>
      )}
      <div className="pt-botones" role="group" aria-label="Qué documentos ver">
        {tipos.map((t) => <button type="button" key={t.id} className="pt-filtro" aria-pressed={tipo === t.id} onClick={() => setTipo(t.id)}>{t.label}{t.n ? ` · ${t.n}` : ''}</button>)}
      </div>
      <section className="pt-lista" aria-label={tipos.find((t) => t.id === tipo)?.label}>
        {tipo === 'impuestos' && (datos.impuestos.length === 0 ? <div className="pt-vacio">Aún no hay impuestos presentados aquí. Cuando tu gestoría presente uno, sale con su justificante.</div>
          : datos.impuestos.map((t) => (
            <div className="pt-fila" key={t.id}>
              <span className="pt-icono" aria-hidden="true">{t.modelo}</span>
              <div className="pt-fila-texto"><b>{nombreImpuesto(t.modelo, t.periodo, t.ejercicio)}</b>
                <span>Presentado el {fecha(t.presentado)}{t.importe != null ? ` · ${t.resultado === 'a_devolver' ? 'a devolver' : t.resultado === 'a_ingresar' ? 'a ingresar' : ''} ${eurosDe(t.importe)}`.replace(/\s+/g, ' ') : ''}</span></div>
              <button type="button" className="pt-boton sec chico" disabled={!t.justificante} onClick={() => abrirDoc('impuesto', t.id)}>{t.justificante ? 'Justificante' : 'Sin justificante'}</button>
            </div>)))}
        {tipo === 'nominas' && (datos.nominas.length === 0 ? <div className="pt-vacio">Aún no hay nóminas aquí.</div>
          : datos.nominas.map((n) => (
            <div className="pt-fila" key={n.id}>
              <span className="pt-icono" aria-hidden="true">{n.carpeta === 'ss_sepe' ? 'SS' : 'NÓM'}</span>
              <div className="pt-fila-texto"><b>{n.nombre}</b><span>{n.trabajador} · {fecha(n.fecha)}</span></div>
              <button type="button" className="pt-boton sec chico" onClick={() => abrirDoc('nomina', n.id)}>Descargar</button>
            </div>)))}
        {tipo === 'subidas' && (datos.subidas.length === 0 ? <div className="pt-vacio">Aún no has subido nada.</div>
          : datos.subidas.map((s) => (
            <div className="pt-fila" key={s.id}>
              <span className="pt-icono" aria-hidden="true">{/\.pdf$/i.test(s.nombre) ? 'PDF' : 'IMG'}</span>
              <div className="pt-fila-texto"><b>{s.nombre}</b><span>Subido el {fecha(s.subida)}</span></div>
              <Chip texto={s.contabilizada ? 'Ya contabilizado' : 'Recibido'} tono={s.contabilizada ? 'ok' : 'info'} />
              <button type="button" className="pt-boton sec chico" onClick={() => abrirDoc('subida', s.id)}>Ver</button>
            </div>)))}
      </section>
    </>
  )
}
