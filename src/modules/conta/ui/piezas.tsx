// src/modules/conta/ui/piezas.tsx
//
// Las piezas que se repiten en el módulo (encargo C00 §7), una vez. Botones y
// enlaces de verdad, foco visible, zonas de 44 px, etiquetas en los campos.
// Los estilos están en ../estilo/componentes.css y los colores en tokens.css.

import { useId, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { entradaActiva, entradasVisibles, type EntradaMenuConta } from '@/config/navegacion'
import { rutaConta } from '@/config/navegacion'

/** Cabecera de página: antetítulo pequeño y título grande. */
export function Cabecera({ antetitulo, titulo, derecha }: { antetitulo?: string; titulo: string; derecha?: ReactNode }) {
  return (
    <header className="cx-cabecera">
      <div className="cx-cabecera-titulos">
        {antetitulo && <span className="cx-antetitulo">{antetitulo}</span>}
        <h1 className="cx-titulo">{titulo}</h1>
      </div>
      {derecha && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{derecha}</div>}
    </header>
  )
}

/**
 * Pestañas en forma de píldora, sacadas de la configuración de navegación.
 * Son enlaces (cada pestaña tiene su dirección): se marca la activa con
 * aria-current, no con role=tab, porque cambian de página.
 */
export function PestanasPildora({ entradas, etiqueta }: { entradas: EntradaMenuConta[]; etiqueta: string }) {
  const { pathname } = useLocation()
  const activa = entradaActiva(pathname, entradas)
  return (
    <nav aria-label={etiqueta}>
      <div className="cx-pestanas">
        {entradasVisibles(entradas).map((e) => (
          <Link key={e.id} to={rutaConta(e.ruta)} className="cx-pestana" aria-current={activa === e.id ? 'page' : undefined}>
            {e.etiqueta}
          </Link>
        ))}
      </div>
    </nav>
  )
}

/** Tarjeta blanca con título y, opcional, una acción a la derecha. */
export function Tarjeta({ titulo, accion, children, etiquetaId }: {
  titulo?: string; accion?: ReactNode; children: ReactNode; etiquetaId?: string
}) {
  const auto = useId()
  const id = etiquetaId ?? `t-${auto}`
  return (
    <section className="cx-tarjeta" aria-labelledby={titulo ? id : undefined}>
      {(titulo || accion) && (
        <div className="cx-tarjeta-cabeza">
          {titulo && <h2 id={id} className="cx-tarjeta-titulo">{titulo}</h2>}
          {accion}
        </div>
      )}
      {children}
    </section>
  )
}

/** Una fila «etiqueta · valor» de una tarjeta. `vacio` se enseña si no hay valor. */
export function Dato({ etiqueta, children, vacio = 'Sin poner' }: { etiqueta: string; children?: ReactNode; vacio?: string }) {
  const hay = children !== null && children !== undefined && children !== '' && children !== false
  return (
    <div className="cx-dato">
      <span className="cx-dato-etiqueta">{etiqueta}</span>
      <span className="cx-dato-valor">{hay ? children : <span className="cx-dato-vacio">{vacio}</span>}</span>
    </div>
  )
}

/** Píldora de estado. */
export function Chip({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'neutro' | 'ia' | 'blanco' | 'ambar' | 'azul' }) {
  const clase = tono === 'neutro' ? 'cx-chip' : `cx-chip cx-chip-${tono}`
  return <span className={clase}>{children}</span>
}

/** Inicial de color (o texto corto, «21», «UE»). El color sale del texto: el mismo texto, el mismo color. */
export function Inicial({ texto, redonda = false, tono }: { texto: string; redonda?: boolean; tono?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const t = tono ?? (((Array.from(texto).reduce((s, c) => s + c.charCodeAt(0), 0) % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6)
  return <span className={`cx-inicial cx-inicial-${t}${redonda ? ' cx-inicial-redonda' : ''}`} aria-hidden="true">{texto}</span>
}

/** Fila con inicial de color, título, apoyo y cifra. */
export function FilaInicial({ inicial, titulo, apoyo, cifra, redonda, tono }: {
  inicial: string; titulo: ReactNode; apoyo?: ReactNode; cifra?: ReactNode; redonda?: boolean; tono?: 1 | 2 | 3 | 4 | 5 | 6
}) {
  return (
    <div className="cx-fila">
      <Inicial texto={inicial} redonda={redonda} tono={tono} />
      <div className="cx-fila-texto">
        <span className="cx-fila-titulo">{titulo}</span>
        {apoyo && <span className="cx-fila-apoyo">{apoyo}</span>}
      </div>
      {cifra !== undefined && <span className="cx-cifra" style={{ fontSize: 15 }}>{cifra}</span>}
    </div>
  )
}

/**
 * Bloque verde suave: lo que la IA propone o ha hecho. Dice qué y por qué
 * (regla 2 de la IA) y, si propone, trae sus dos respuestas.
 */
export function BloqueIA({ titulo, porque, acciones }: { titulo: ReactNode; porque?: ReactNode; acciones?: ReactNode }) {
  return (
    <section className="cx-ia-bloque" aria-label="Lo que propone Folvy">
      <span className="cx-ia-punto" aria-hidden="true" />
      <div className="cx-ia-texto">
        <span className="cx-ia-titulo">{titulo}</span>
        {porque && <span className="cx-ia-porque">{porque}</span>}
      </div>
      {acciones && <div className="cx-ia-acciones">{acciones}</div>}
    </section>
  )
}

/**
 * La marca «IA» de un dato que puso la IA. Al tocarla enseña el motivo
 * (encargo C00 §6.1). Es un botón: se alcanza con teclado.
 */
export function MarcaIA({ motivo }: { motivo: string }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="cx-marca-ia" aria-expanded={abierta} aria-controls={id}
        aria-label="Lo puso Folvy. Ver por qué" onClick={() => setAbierta((v) => !v)}>IA</button>
      {abierta && (
        <span id={id} role="note" className="cx-ia-porque" style={{
          position: 'absolute', right: 0, top: 30, zIndex: 5, width: 260, padding: '10px 12px', borderRadius: 12,
          background: 'var(--cx-verde-suave)', border: '1px solid var(--cx-ia-borde)', fontWeight: 400, textAlign: 'left',
        }}>{motivo}</span>
      )}
    </span>
  )
}

/** Hueso del esqueleto de carga. */
export function Hueso({ ancho = '100%', alto = 16 }: { ancho?: number | string; alto?: number }) {
  return <span className="cx-hueso" style={{ width: ancho, height: alto }} aria-hidden="true" />
}

/** Esqueleto de una tarjeta: título y cuatro filas. */
export function TarjetaCargando() {
  return (
    <div className="cx-tarjeta" aria-hidden="true">
      <Hueso ancho="40%" alto={20} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
        <Hueso /><Hueso ancho="85%" /><Hueso ancho="70%" /><Hueso ancho="90%" />
      </div>
    </div>
  )
}

/** Error con «Reintentar». Dice qué ha fallado, no solo que algo falló. */
export function ErrorConReintento({ mensaje, reintentar }: { mensaje: string; reintentar: () => void }) {
  return (
    <div className="cx-tarjeta" role="alert">
      <div className="cx-vacio">
        <span style={{ color: 'var(--cx-texto)', fontWeight: 600 }}>No se ha podido cargar.</span>
        <span>{mensaje}</span>
        <button type="button" className="cx-boton" onClick={reintentar}>Reintentar</button>
      </div>
    </div>
  )
}

/** Vacío con su explicación (y, si toca, qué hacer). */
export function Vacio({ titulo, explicacion, accion }: { titulo: string; explicacion: string; accion?: ReactNode }) {
  return (
    <div className="cx-vacio">
      <span style={{ color: 'var(--cx-texto)', fontWeight: 600, fontSize: 16 }}>{titulo}</span>
      <span>{explicacion}</span>
      {accion}
    </div>
  )
}

/** «Guardado» con contenido (regla 8): se anuncia a los lectores de pantalla. */
export function Guardado({ texto }: { texto: string | null }) {
  return (
    <div role="status" aria-live="polite">
      {texto && <div className="cx-guardado">{texto}</div>}
    </div>
  )
}
