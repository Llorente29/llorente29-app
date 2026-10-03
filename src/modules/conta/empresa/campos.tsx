// src/modules/conta/empresa/campos.tsx
//
// Los campos de los formularios de «Tu empresa»: cada uno con su etiqueta, su
// ayuda y su fallo debajo, anunciado (accesible como en el C01).

import { useId, type ReactNode } from 'react'

interface Base {
  etiqueta: string
  ayuda?: string
  fallo?: string
  deshabilitado?: boolean
}

function Envoltura({ id, etiqueta, ayuda, fallo, children }: Base & { id: string; children: ReactNode }) {
  return (
    <div className="cx-campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {ayuda && <span id={`${id}-ayuda`} className="cx-ayuda">{ayuda}</span>}
      {fallo && <span id={`${id}-fallo`} className="cx-error" role="alert">{fallo}</span>}
    </div>
  )
}

const describe = (id: string, b: Base) => [b.ayuda ? `${id}-ayuda` : '', b.fallo ? `${id}-fallo` : ''].filter(Boolean).join(' ') || undefined

export function CampoTexto(p: Base & { valor: string; cambiar: (v: string) => void; tipo?: 'text' | 'date'; modo?: 'numeric' | 'decimal' }) {
  const id = useId()
  return (
    <Envoltura id={id} {...p}>
      <input id={id} className="cx-input" type={p.tipo ?? 'text'} inputMode={p.modo} value={p.valor} disabled={p.deshabilitado}
        aria-invalid={p.fallo ? true : undefined} aria-describedby={describe(id, p)} autoComplete="off"
        onChange={(e) => p.cambiar(e.target.value)} />
    </Envoltura>
  )
}

export function CampoLista(p: Base & { valor: string; cambiar: (v: string) => void; opciones: { valor: string; texto: string }[] }) {
  const id = useId()
  return (
    <Envoltura id={id} {...p}>
      <select id={id} className="cx-input" value={p.valor} disabled={p.deshabilitado}
        aria-invalid={p.fallo ? true : undefined} aria-describedby={describe(id, p)} onChange={(e) => p.cambiar(e.target.value)}>
        {p.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </Envoltura>
  )
}

export function CampoSiNo(p: Base & { valor: boolean; cambiar: (v: boolean) => void }) {
  return (
    <CampoLista {...p} valor={p.valor ? 'si' : 'no'} cambiar={(v) => p.cambiar(v === 'si')}
      opciones={[{ valor: 'no', texto: 'No' }, { valor: 'si', texto: 'Sí' }]} />
  )
}

/** Guardar y Cancelar, al pie de un formulario. */
export function PieFormulario({ guardando, cancelar, textoGuardar = 'Guardar' }: { guardando: boolean; cancelar: () => void; textoGuardar?: string }) {
  return (
    <div className="cx-pie">
      <button type="button" className="cx-boton-sec" onClick={cancelar} disabled={guardando}>Cancelar</button>
      <button type="submit" className="cx-boton" disabled={guardando}>{guardando ? 'Guardando…' : textoGuardar}</button>
    </div>
  )
}

/** Lo que ha pasado al guardar: confirmación con contenido o fallo (regla 8). */
export function Resultado({ hecho, fallo }: { hecho: string | null; fallo: string | null }) {
  return (
    <>
      <div role="status" aria-live="polite">{hecho && <div className="cx-guardado">{hecho}</div>}</div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </>
  )
}

/**
 * La tarjeta de un apartado. En el móvil el título lo pone la cabecera de la
 * pantalla del apartado, así que aquí no se repite (sí la acción).
 */
export function TarjetaApartado({ titulo, accion, movil, children, etiqueta }: {
  titulo: string; accion?: ReactNode; movil: boolean; children: ReactNode; etiqueta?: string
}) {
  const id = useId()
  return (
    <section className="cx-tarjeta cx-apartado" aria-labelledby={movil ? undefined : id} aria-label={movil ? (etiqueta ?? titulo) : undefined}>
      {(!movil || accion) && (
        <div className="cx-tarjeta-cabeza">
          {!movil && <h2 id={id} className="cx-tarjeta-titulo">{titulo}</h2>}
          {accion}
        </div>
      )}
      {children}
    </section>
  )
}
