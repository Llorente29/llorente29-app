// src/modules/conta/diseno/Icono.tsx
//
// S01 · Los iconos del sistema de diseño: lucide-react (el mismo juego que el
// resto de la aplicación), siempre con el mismo tamaño y el mismo trazo, y por
// NOMBRE: una pantalla pide «recibida», no elige un dibujo. Así no aparecen
// iconos sueltos y cambiar uno es cambiarlo aquí. Son decorativos: el texto va
// siempre al lado, o el botón lleva su aria-label.

import { ICONOS, TAM_ICONO, TAM_ICONO_PESTANA, TRAZO_ICONO, type NombreIcono } from './iconos'

export function Icono({ nombre, grande = false, pestana = false }: { nombre: NombreIcono; grande?: boolean; /** S01f · 14 px: los de la cabecera de pestañas. */ pestana?: boolean }) {
  const Dibujo = ICONOS[nombre]
  const tam = grande ? 20 : pestana ? TAM_ICONO_PESTANA : TAM_ICONO
  return <Dibujo className="s-icono" size={tam} strokeWidth={TRAZO_ICONO} aria-hidden="true" focusable="false" />
}
