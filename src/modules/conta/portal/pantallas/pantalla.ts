// src/modules/conta/portal/pantallas/pantalla.ts
//
// GP · Tarea 3 · Lo que recibe cada pantalla del portal: el cliente, cómo ir a
// otra pestaña (con lo que tiene que abrir) y cómo decir lo que ha pasado.

import type { Aviso } from '../comun'
import type { Pestana } from '../tipos'

export interface Pantalla {
  cliente: string
  permiso: 'todo' | 'facturas_documentos'
  ir: (p: Pestana, abrir?: Record<string, string>) => void
  abrir: Record<string, string>
  avisar: (a: Aviso) => void
  /** El nombre de la persona, para la cabecera (lo trae Inicio). */
  ponerNombre?: (n: string) => void
}
