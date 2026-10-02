// src/modules/conta/ui/Icono.tsx
//
// Los iconos de línea fina de las maquetas del C00, con sus trazos tal cual
// (20 × 20, trazo 1,6). Son decorativos: el texto va siempre al lado.

import type { IconoConta } from '@/config/navegacion'

const TRAZOS: Record<IconoConta, string[]> = {
  inicio: ['M3 9l7-6 7 6v8H3z', 'M8 17v-5h4v5'],
  porHacer: ['M7 10l2 2 4-4'],
  documentos: ['M5 2h7l3 3v13H5z', 'M8 9h4M8 13h4'],
  bancos: ['M2 8l8-5 8 5H2zM4 8v7M8 8v7M12 8v7M16 8v7M2 17h16'],
  personas: ['M2 17c0-3 2-5 5-5s5 2 5 5M13 5a3 3 0 010 5M15 12c2 1 3 2 3 5'],
  pagos: ['M2 9h16'],
  facturas: ['M4 2h12v16l-3-2-3 2-3-2-3 2z', 'M7 7h6M7 11h4'],
  impuestos: ['M5 15L15 5'],
  negocio: ['M3 17V3M3 17h14M7 13V9M11 13V6M15 13v-3'],
  libros: ['M3 4c3-1 5-1 7 1 2-2 4-2 7-1v12c-3-1-5-1-7 1-2-2-4-2-7-1z', 'M10 5v12'],
  ajustes: ['M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4'],
  folvy: ['M12 4l-6 6 6 6'],
}

export function Icono({ nombre, tam = 20 }: { nombre: IconoConta; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {nombre === 'porHacer' && <rect x="3" y="3" width="14" height="14" rx="4" />}
      {nombre === 'personas' && <circle cx="7" cy="7" r="3" />}
      {nombre === 'pagos' && <rect x="2" y="5" width="16" height="11" rx="2" />}
      {nombre === 'impuestos' && (<><circle cx="6" cy="6" r="2" /><circle cx="14" cy="14" r="2" /></>)}
      {nombre === 'ajustes' && <circle cx="10" cy="10" r="3" />}
      {TRAZOS[nombre].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

/** El micrófono de la barra de la IA y de la barra inferior. */
export function Microfono() {
  return (
    <svg width="16" height="20" viewBox="0 0 18 22" aria-hidden="true" focusable="false">
      <rect x="5" y="1" width="8" height="13" rx="4" fill="currentColor" />
      <path d="M1.5 10.5a7.5 7.5 0 0 0 15 0M9 18v3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}
