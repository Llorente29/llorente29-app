// src/marca/PiezasMarca.tsx
//
// Las piezas que pintan la marca (C06): el logo (cuadrado con la inicial y el
// nombre, como la maqueta N18, mientras no haya logo dibujado), el pie de las
// pantallas de entrada y los enlaces legales. Con Folvy, lo de siempre.
//
// Enlaces legales: si la marca aún no los tiene (los redacta y aprueba Julio,
// encargo C06 «Norma»), se enseña el texto sin enlace y lo dice al pasar por
// encima. No se inventa un texto legal ni se apunta a una página vacía.

import type { CSSProperties } from 'react'
import { MARCA, type Marca } from '@/marca/marca'

export function CuadradoMarca({ marca = MARCA, lado = 44 }: { marca?: Marca; lado?: number }) {
  // C06b: la marca con isotipo dibujado (Sumied) lo enseña en vez del cuadrado.
  if (marca.logo) return <img src={marca.logo} alt="" aria-hidden="true" width={Math.round(lado * 120 / 140)} height={lado} style={{ flexShrink: 0, display: 'block' }} />
  const estilo: CSSProperties = {
    width: lado, height: lado, borderRadius: Math.round(lado * 0.32), background: marca.colorLogo, color: '#FFFFFF',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: Math.round(lado * 0.45), fontWeight: 700, flexShrink: 0,
  }
  return <span aria-hidden="true" style={estilo}>{marca.inicial}</span>
}

/** Logo con nombre: el de la maqueta N18 (cuadrado azul con la inicial y el nombre al lado). */
export function LogoMarca({ marca = MARCA, lado = 44, className = '' }: { marca?: Marca; lado?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: 12 }} role="img" aria-label={marca.nombre}>
      <CuadradoMarca marca={marca} lado={lado} />
      <span aria-hidden="true" style={marca.tema
        // Sumied: «SUMIED» en mayúsculas muy gruesas, como el lienzo de la identidad.
        ? { fontSize: Math.round(lado * 0.5), fontWeight: 900, letterSpacing: '-0.03em', color: marca.tema.tinta, textTransform: 'uppercase', fontFamily: marca.tema.letra }
        : { fontSize: Math.round(lado * 0.5), fontWeight: 700, letterSpacing: '-0.6px', color: '#0E1A2B' }}>
        {marca.nombre}
      </span>
    </span>
  )
}

export function EnlaceLegal({ href, children }: { href: string | null; children: string }) {
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  return <span title="Aún no publicado" aria-disabled="true">{children}</span>
}

/** «Marca · dirección · Aviso legal · Privacidad» (pie de N18). */
export function PieLegal({ marca = MARCA, className, style }: { marca?: Marca; className?: string; style?: CSSProperties }) {
  const partes = [marca.nombre, marca.direccionVisible].filter(Boolean) as string[]
  return (
    <span className={className} style={style}>
      {partes.join(' · ')}{' · '}
      <EnlaceLegal href={marca.avisoLegal}>Aviso legal</EnlaceLegal>{' · '}
      <EnlaceLegal href={marca.privacidad}>Privacidad</EnlaceLegal>
    </span>
  )
}

/** El pie de las pantallas de entrada y contraseña: con Folvy, el de siempre. */
export function PieEntrada({ className = 'text-center text-xs text-text-secondary mt-4' }: { className?: string }) {
  if (MARCA.id === 'folvy') return <p className={className}>Folvy · Restauración Profesional</p>
  return <p className={className}><PieLegal /></p>
}

/** El lado menta de la entrada (N18): antetítulo, lema y las frases de la marca. Lo comparten la entrada y la bienvenida. */
export function LadoMarca({ marca = MARCA }: { marca?: Marca }) {
  return (
    <aside className="mx-derecha" aria-label={marca.entrar.antetitulo.toLowerCase() || 'Lo que hay dentro'}>
      <span className="mx-antetitulo">{marca.entrar.antetitulo}</span>
      <span className="mx-lema">{marca.entrar.lema}</span>
      <ul className="mx-frases">{marca.entrar.frases.map((f) => <li key={f}>{f}</li>)}</ul>
    </aside>
  )
}
