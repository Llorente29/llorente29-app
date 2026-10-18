// src/modules/conta/estilo/index.ts
//
// Carga el estilo del módulo: letras, colores y piezas. Se importa una vez,
// desde el módulo (src/modules/conta/module.tsx).
//
// Las letras van DENTRO de la app (Fontsource, licencia OFL 1.1), no desde
// Google Fonts. Vite deja las reglas @font-face en el CSS común, pero el
// navegador solo descarga una letra cuando algo en pantalla la usa, y
// 'Geist Variable' solo se usa dentro de `.cx`: el resto de Folvy no descarga
// nada (comprobación previa 7 del C00).

import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../../../marca/tema.css' // Inter, para las marcas con tema (Sumied)
import './tokens.css'
import '../diseno/tokens.css' // S01 · el sistema de diseño (--s-*)
import './componentes.css'
import './proveedor.css'
import './traer.css'
import './tercero.css'
import './diario.css'
import './libros.css'
import './compras.css'
import './documentos.css'
import './bancos.css'
import './impuestos.css'
import './inicio.css'
import './marco.css'
import './piezas.css'
import './libroMarco.css'
import '../diseno/diseno.css'
import '../esqueleto/esqueleto.css' // S01 · el esqueleto (barra, cabecera, cinta)
