// src/shell/home/widgets/TarjetaInicio.tsx
//
// LA ANATOMÍA DE LA MAQUETA, escrita una vez.
//
// Las seis tarjetas aprobadas comparten la misma estructura, y por eso vive
// aquí en vez de repetirse seis veces:
//
//   título
//   CIFRA GRANDE            (+ delta contra su espejo, si lo hay)
//   filas por local         «Alcalá 1.450 € · 61 pedidos»
//   línea de consecuencia   «El más antiguo lleva 6 días agotado»
//   sello de frescura       «datos de las 08:18»
//   pie                     «Abrir Disponibilidad →»
//
// La ancha (la gráfica de 14 días) usa el mismo marco y mete su contenido por
// `children`: es la misma tarjeta con otro cuerpo, no otra tarjeta.
//
// ── UNA DESVIACIÓN DECLARADA SOBRE LA MAQUETA ──────────────────────────────
// La maqueta trae su propia paleta (#1E3A5F, #f4f4f1…) porque era un HTML
// suelto. Aquí se usan los tokens de la aplicación —`--color-bg-card`,
// `--color-accent`, `--font-display`— para que el Inicio no parezca una
// pantalla de otro producto metida dentro de Folvy. La ESTRUCTURA, el
// contenido y la escala tipográfica son los de la maqueta; los colores son los
// de la casa. Si se prefiere el hex literal de la maqueta, es un cambio de
// tokens en este fichero y en ningún otro.
//
// ── LO QUE NO HACE, Y ES A PROPÓSITO ───────────────────────────────────────
// La tarjeta ENTERA no es pulsable. Solo el pie. Una caja pulsable no dice a
// dónde lleva, y lo que no dice a dónde lleva no se pulsa.

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TonoDelta } from '../espejo'
import type { Sello } from '../sello'
import { decideContenido, fraseDeLasQueSobran } from './contenidoDeTarjeta'

export interface FilaDeTarjeta {
  /** «Foodint Alcalá». */
  etiqueta: string
  /** «1.450 € · 61 pedidos». Ya formateado: la tarjeta no calcula. */
  valor: string
  /** Color del valor, para estados («borrador» ámbar, «sin publicar» rojo). */
  tono?: 'neutral' | 'attention' | 'bad'
}

export interface TarjetaInicioProps {
  titulo: string
  icono?: LucideIcon
  /** La cifra grande. Undefined mientras carga. */
  cifra?: string
  /** Coletilla pequeña pegada a la cifra: «de 6». */
  cifraSufijo?: string
  delta?: { texto: string; tono: TonoDelta }
  filas?: FilaDeTarjeta[]
  /** La línea que dice la CONSECUENCIA, no el dato. Es la que se lee. */
  nota?: string
  sello?: Sello
  pie?: { etiqueta: string; onClick: () => void }
  cargando?: boolean
  /**
   * Fallo al refrescar. Se dice ARRIBA y el dato anterior se queda debajo: un
   * error no convierte el número en un cero ni hace desaparecer la tarjeta.
   */
  error?: string | null
  /**
   * GARANTÍA (d): ¿se ha llegado a LEER algo alguna vez?
   *
   * `false` + `error` = la tarjeta NO tiene dato y no ha podido comprobarlo. En
   * ese caso NO se pinta ni cifra ni filas: se dice que no se ha podido
   * comprobar. Un «0» ahí es la peor mentira posible, porque «cero agotados» y
   * «no he podido mirar si hay agotados» se leen igual y significan lo
   * contrario.
   *
   * Con `true` la tarjeta enseña lo último bueno con su sello, aunque el último
   * refresco fallara: ahí sí hay dato, solo que viejo, y el sello lo dice.
   */
  hayDato?: boolean
  /**
   * Tope de filas. Lo que sobra NO se esconde: se cuenta al pie («y 3 más»).
   * Un umbral ordena, no decide la existencia — regla 7.
   */
  maxFilas?: number
  children?: ReactNode
}

const COLOR_TONO: Record<NonNullable<FilaDeTarjeta['tono']>, string> = {
  neutral: 'var(--color-text-primary)',
  attention: 'var(--color-warning)',
  bad: 'var(--color-danger)',
}

const COLOR_DELTA: Record<TonoDelta, string> = {
  positive: 'var(--color-success)',
  attention: 'var(--color-terracota)',
  neutral: 'var(--color-text-secondary)',
}

const TOPE_DE_FILAS = 5

export default function TarjetaInicio({
  titulo, icono: Icono, cifra, cifraSufijo, delta, filas, nota,
  sello, pie, cargando = false, error = null, hayDato = true,
  maxFilas = TOPE_DE_FILAS, children,
}: TarjetaInicioProps) {
  // La decisión vive en `contenidoDeTarjeta.ts`, que es puro y está probado:
  // aquí solo se pinta lo que allí se decide.
  const { sinComprobar, visibles, ocultas } = decideContenido(error, hayDato, filas, maxFilas)
  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: '0.9375rem 1.0625rem',
        display: 'flex', flexDirection: 'column', height: '100%',
      }}
    >
      <p
        className="flex items-center"
        style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0 0 0.375rem', gap: 6 }}
      >
        {Icono ? <Icono size={15} /> : null} {titulo}
      </p>

      {error ? (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-danger)', margin: '0 0 0.375rem' }}>
          {sinComprobar
            ? `No se ha podido comprobar: ${error}`
            : `No se ha podido actualizar: ${error}`}
        </p>
      ) : null}

      {sinComprobar ? (
        // El texto que sustituye a la cifra. Dice lo que pasa —no se sabe— y no
        // deja al lector deduciendo de un hueco.
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0 }}>
          Sin dato: no se ha podido leer esta tarjeta. Vuelve a cargar la
          pantalla; si sigue igual, el dato no está disponible ahora mismo.
        </p>
      ) : null}

      {!sinComprobar && cifra !== undefined ? (
        <p style={{
          fontSize: '1.75rem', fontWeight: 500, color: 'var(--color-accent)',
          margin: 0, fontFamily: 'var(--font-display)', lineHeight: 1.1,
        }}>
          {cargando ? '…' : cifra}
          {cifraSufijo ? (
            <span style={{ fontSize: '1rem', color: 'var(--color-text-secondary)', marginLeft: 6 }}>
              {cifraSufijo}
            </span>
          ) : null}
        </p>
      ) : null}

      {!sinComprobar && delta ? (
        <p style={{ fontSize: '0.75rem', color: COLOR_DELTA[delta.tono], margin: '0.25rem 0 0' }}>
          {delta.texto}
        </p>
      ) : null}

      {!sinComprobar && visibles.length > 0 ? (
        <div style={{ marginTop: '0.625rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {visibles.map((f, i) => (
            <div key={`${f.etiqueta}-${i}`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8125rem' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>{f.etiqueta}</span>
              <span style={{ fontWeight: 600, color: COLOR_TONO[f.tono ?? 'neutral'] }}>{f.valor}</span>
            </div>
          ))}
          {/* LO QUE NO CABE SE CUENTA. Nunca se corta en silencio: una lista
              recortada sin decirlo es la nota al pie que confiesa el escondite
              — regla 7. */}
          {fraseDeLasQueSobran(ocultas) ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: '0.125rem 0 0' }}>
              {fraseDeLasQueSobran(ocultas)}
            </p>
          ) : null}
        </div>
      ) : null}

      {!sinComprobar && children}

      {/* LA CONSECUENCIA. No es un subtítulo decorativo: es la frase por la que
          alguien hace algo («el más antiguo lleva 6 días agotado»). */}
      {!sinComprobar && nota ? (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: '0.625rem 0 0' }}>
          {nota}
        </p>
      ) : null}

      <div style={{ flex: 1 }} />

      {sello ? (
        <p style={{
          fontSize: '0.6875rem', margin: '0.625rem 0 0',
          color: sello.caducado ? 'var(--color-terracota)' : 'var(--color-text-secondary)',
        }}>
          {sello.texto}
        </p>
      ) : null}

      {pie ? (
        <button
          type="button"
          onClick={pie.onClick}
          style={{
            marginTop: '0.5rem', padding: 0, border: 0, background: 'none',
            font: 'inherit', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
            color: 'var(--color-accent)', textAlign: 'left',
          }}
        >
          {pie.etiqueta}
        </button>
      ) : null}
    </div>
  )
}
