// La captura de «Recibido» (Compras · N21), para ponerla al lado de la maqueta
// Recepcion.dc.html. El MISMO MÉTODO que capturaConteoMovil: la pieza REAL
// (RecepcionHecha) con el CSS del build, a 390 px, nunca un HTML escrito para
// la foto. El e2e de compras no escribe nada en staging, y «Recibido» solo
// sale después de recibir de verdad: por eso esta pantalla se captura aquí.
//
// Los datos: la recepción de Verduras de la semilla de compras (un albarán,
// 191,00 € de base y 210,10 € con su IVA) y la frase que devuelve
// compras_camino_de (0170) para un albarán, tal cual.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import RecepcionHecha from '@/modules/supply/components/RecepcionHecha'

const FRASE_ALBARAN = 'Este papel es un albarán. La oficina esperará la factura.'

const pantalla = (frase: string | null, aviso: string | null = null) => renderToStaticMarkup(
  <RecepcionHecha local="Norte Centro"
    datos={{ proveedor: 'Verduras del Huerto Prueba, S.L.', productos: 1, total: 210.1, frase, aviso, mensaje: '' }}
    onRecibirOtro={() => {}} onVolver={() => {}} />,
)

describe('«Recibido» (N21)', () => {
  it('la frase va en su tarjeta, con la primera oración en negrita, y los dos botones', () => {
    const html = pantalla(FRASE_ALBARAN)
    expect(html).toContain('<strong class="font-semibold text-text-primary">Este papel es un albarán.</strong> La oficina esperará la factura.')
    expect(html).toContain('Recibido')
    // «· 1 producto» no se parte: espacios duros (en la primera captura «producto» bajó solo de línea).
    expect(html).toContain('Verduras del Huerto Prueba, S.L. ·\u00A01\u00A0producto')
    expect(html).toMatch(/210,10\s€/)
    expect(html).toContain('Recibir otro')
    // El botón principal es el azul del estilo nuevo, no el negro de Cocina (respuesta 2, 11/10).
    expect(html).toMatch(/class="[^"]*bg-\[#2F5BFF\][^"]*">Recibir otro</)
    expect(html).not.toContain('bg-accent')
    expect(html).toContain('Volver')
  })
  it('sin frase, sin tarjeta: la recepción no depende de ella', () => {
    expect(pantalla(null)).not.toContain('<strong')
  })
  it('lo que hay que revisar se dice, aunque la pantalla sea de éxito (regla 8)', () => {
    expect(pantalla(FRASE_ALBARAN, '1 línea no ha entrado al almacén: hay que revisarla.')).toContain('1 línea no ha entrado al almacén')
  })
  it('escribe el HTML a 390 px con el CSS del build (si hay build)', () => {
    const raiz = resolve(__dirname, '../../../..')
    const dist = resolve(raiz, 'dist/assets')
    // Sin build no hay CSS de verdad, y una captura con otro CSS enseñaría una
    // pantalla que no se despliega: entonces no se escribe nada.
    if (!existsSync(dist)) return
    const cssFichero = readdirSync(dist).find((f) => f.startsWith('index-') && f.endsWith('.css'))
    if (!cssFichero) return
    const css = readFileSync(resolve(dist, cssFichero), 'utf8')
    const salida = resolve(raiz, 'dist/capturas-recepcion')
    mkdirSync(salida, { recursive: true })
    writeFileSync(resolve(salida, 'recibido.html'), `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>${css}</style><style>html,body{margin:0}.movil{width:390px;height:844px;overflow:hidden}</style></head>
<body class="bg-page"><div class="movil bg-page">${pantalla(FRASE_ALBARAN)}</div></body></html>`)
  })
})
