// «Corregir ahora» (p21) y los porcentajes del §2, en una foto.
//
// Julio, 11/09 08:20: «Si hay una cantidad mala, desde oficina se llama a
// cocina, se cuenta en ese momento y se corrige.» Y 09:20: «El `window.prompt`
// de «No aplicar esta línea» se va en ese mismo paso» + el porcentaje sólo
// cuando lo esperado es positivo, y el color por el signo de la diferencia.
//
// Los datos NO son inventados (regla 31): son los de INV-00218 de Foodint
// Alcalá. La Coca-Cola que Pamela contó a 4 ud contra 240 esperadas es la fila
// que originó el encargo, y el Humus a −355 g es la que enseña el porcentaje
// sin sentido que el §2 quita.
//
// Usa los MISMOS componentes que la pantalla (`BotonCocina`, `PastillaCocina`)
// con el CSS del build: una foto que no se despliega no sirve para decidir.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BotonCocina, PastillaCocina, PanelCocina, RotuloDePanel } from '@/modules/kitchen/components/PatronDeKitchen'

const nb = ' '

it('genera la captura de «Corregir ahora» a 1280', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full flex flex-col gap-6">

      {/* ── 1 · EL DIÁLOGO ────────────────────────────────────────────── */}
      <div className="cocina-pagina">
        <h2 className="text-[15px] font-bold text-cocina-tinta">1 · «Corregir ahora»</h2>
        <p className="text-[12.5px] text-cocina-tinta-2 mt-1 mb-3">
          Las mismas casillas que la pantalla de contar. Lo esperado va en gris, abajo:
          lo ve quien llama, no quien cuenta.
        </p>
        <div className="w-full max-w-lg rounded-cocina-md bg-cocina-superficie shadow-xl border border-cocina-linea">
          <div className="px-5 pt-5 pb-3 border-b border-cocina-linea-suave">
            <div className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3">Corregir ahora</div>
            <div className="text-[19px] font-extrabold tracking-[-.01em] text-cocina-tinta leading-tight mt-0.5">
              Coca-Cola Original Lata
            </div>
            <div className="text-[12.5px] text-cocina-tinta-2 mt-1 leading-[1.45]">
              Llama a cocina, que lo cuente ahora y apunta lo que te diga. Queda a su nombre, no al tuyo.
            </div>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-cocina-tinta">¿Quién lo ha contado?</span>
              <select
                defaultValue="joh"
                className="h-10 px-2 rounded-cocina border border-cocina-linea bg-cocina-superficie text-[13.5px] text-cocina-tinta"
              >
                <option value="joh">Johanny Garzón Rodríguez</option>
              </select>
            </label>

            <div className="rounded-cocina-md border border-cocina-linea overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-cocina-tinta truncate">Caja</div>
                  <div className="text-[11.5px] text-cocina-tinta-3">24{nb}ud cada caja</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="h-9 w-9 rounded-cocina border border-cocina-linea text-[17px] leading-none text-cocina-tinta-2 inline-flex items-center justify-center">−</span>
                  <span className="num h-9 w-14 rounded-cocina border border-cocina-linea bg-cocina-superficie text-[15px] font-bold inline-flex items-center justify-center">9</span>
                  <span className="h-9 w-9 rounded-cocina border border-cocina-linea text-[17px] leading-none text-cocina-tinta-2 inline-flex items-center justify-center">+</span>
                </div>
              </div>
              <div className="px-3 py-2.5 bg-cocina-fondo/60">
                <div className="text-[13.5px] font-semibold text-cocina-tinta">Lo que está abierto</div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <BotonCocina peso="relleno">Pesado</BotonCocina>
                  <BotonCocina peso="borde">A ojo</BotonCocina>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="num h-10 w-28 px-2 rounded-cocina border border-cocina-linea bg-cocina-superficie text-right text-[14px] inline-flex items-center justify-end">20</span>
                  <span className="text-[13px] text-cocina-tinta-2">ud</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-cocina-tinta-2">Suma lo que te ha dicho</span>
                <span className="num text-[22px] font-bold text-cocina-tinta">236{nb}ud</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-[11.5px] text-cocina-tinta-3">
                  Folvy esperaba 240{nb}ud · estaba apuntado 4{nb}ud
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-cocina-linea-suave">
            <BotonCocina peso="fantasma">Cancelar</BotonCocina>
            <BotonCocina peso="relleno">Guardar 236{nb}ud a nombre de Johanny</BotonCocina>
          </div>
        </div>
      </div>

      {/* ── 2 · LA FILA, DESPUÉS ──────────────────────────────────────── */}
      <div className="cocina-pagina">
        <h2 className="text-[15px] font-bold text-cocina-tinta">2 · La fila, después de corregir</h2>
        <p className="text-[12.5px] text-cocina-tinta-2 mt-1 mb-3">
          Lo anterior no se borra: la cifra vieja queda tachada y la línea deja de pedir motivo.
        </p>
        <PanelCocina>
          <RotuloDePanel>Revisa antes de aprobar · 1</RotuloDePanel>
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-cocina-linea-suave">
                <td className="px-4 py-3 align-top">
                  <div className="text-[14px] font-bold text-cocina-tinta leading-tight">Coca-Cola Original Lata</div>
                  <div className="text-[12px] text-cocina-tinta-3 mt-0.5">Johanny Garzón Rodríguez · 08:10</div>
                </td>
                <td className="px-3 py-3 align-top text-[12.5px] text-cocina-tinta-2 max-w-[220px]">
                  <div>9 cajas de 24{nb}ud + 20{nb}ud pesados</div>
                </td>
                <td className="px-3 py-3 align-top num text-[13px] text-right text-cocina-tinta-2 whitespace-nowrap">240{nb}ud</td>
                <td className="px-3 py-3 align-top num text-[15px] text-right font-bold text-cocina-tinta whitespace-nowrap">236{nb}ud</td>
                <td className="px-3 py-3 align-top num text-[13px] text-right whitespace-nowrap text-cocina-rojo">−2 %</td>
                <td className="px-3 py-3 align-top num text-[13px] text-right text-cocina-tinta-2 whitespace-nowrap">2</td>
                <td className="px-3 py-3 align-top">
                  <span className="text-[12.5px] text-cocina-tinta-3">ya no pide motivo</span>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex gap-2 justify-end flex-wrap">
                    <BotonCocina peso="borde">Corregir ahora</BotonCocina>
                    <BotonCocina peso="borde">Pedir recuento</BotonCocina>
                    <BotonCocina peso="fantasma">No aplicar esta línea</BotonCocina>
                  </div>
                </td>
              </tr>
              <tr className="border-b border-cocina-linea-suave">
                <td colSpan={8} className="px-4 pb-3 pt-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11.5px] text-cocina-tinta-3">
                    <span className="whitespace-nowrap">
                      <span>Pamela contó </span>
                      <span className="num line-through text-cocina-tinta-3">4{nb}ud</span>
                      <span> a las 20:00</span>
                    </span>
                    <span className="whitespace-nowrap">
                      <span className="mr-2 text-cocina-tinta-3">·</span>
                      <span className="text-cocina-tinta-2">Johanny recontó </span>
                      <span className="num font-bold text-cocina-tinta">236{nb}ud</span>
                      <span> a las 08:10</span>
                      <span>, por teléfono</span>
                      <span>, apuntado por Julio</span>
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </PanelCocina>
      </div>

      {/* ── 3 · EL CAMPO EN LÍNEA ─────────────────────────────────────── */}
      <div className="cocina-pagina">
        <h2 className="text-[15px] font-bold text-cocina-tinta">3 · «No aplicar esta línea», sin el aviso del navegador</h2>
        <p className="text-[12.5px] text-cocina-tinta-2 mt-1 mb-3">
          El motivo se escribe en la propia fila, viendo la línea de la que habla.
        </p>
        <div className="flex flex-col gap-1.5 w-[300px] items-end">
          <span className="h-9 px-2 rounded-cocina border border-cocina-ambar bg-cocina-superficie text-[12.5px] text-cocina-tinta w-full inline-flex items-center">
            Se contó la nevera de arriba dos veces
          </span>
          <div className="flex gap-1.5">
            <BotonCocina peso="fantasma">Dejarlo</BotonCocina>
            <BotonCocina peso="borde">No aplicarla</BotonCocina>
          </div>
        </div>
      </div>

      {/* ── 4 · §2 · EL PORCENTAJE Y EL COLOR ─────────────────────────── */}
      <div className="cocina-pagina">
        <h2 className="text-[15px] font-bold text-cocina-tinta">4 · El porcentaje, cuando lo esperado no es positivo</h2>
        <p className="text-[12.5px] text-cocina-tinta-2 mt-1 mb-3">
          Humus, con el teórico en −355{nb}g. Un porcentaje contra un número negativo
          no mide nada y encima sale del revés.
        </p>
        <div className="flex gap-10 items-start">
          <div className="w-[220px] shrink-0 rounded-cocina border border-cocina-linea bg-cocina-superficie px-3 py-2.5">
            <div className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3 mb-2">Antes</div>
            <div className="num text-[13px] text-cocina-verde">+382 %</div>
            <div className="text-[10.5px] text-cocina-tinta-3 leading-tight mt-0.5">
              verde, como si sobrara 1&nbsp;kg de humus
            </div>
          </div>
          <div className="w-[220px] shrink-0 rounded-cocina border border-cocina-linea bg-cocina-superficie px-3 py-2.5">
            <div className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3 mb-2">Ahora</div>
            <div className="num text-[13px] text-cocina-verde">—</div>
            <div className="text-[10.5px] text-cocina-tinta-3 leading-tight mt-0.5">Folvy esperaba en negativo</div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <PastillaCocina tono="ambar">Folvy no tenía referencia</PastillaCocina>
        </div>
      </div>

    </div>,
  )

  const dist = resolve(__dirname, '../../../../dist/assets')
  if (!existsSync(dist)) {
    expect.fail('Falta `dist/assets`: ejecuta `npm run build` antes de generar las capturas.')
  }
  const css = readdirSync(dist).filter(f => f.startsWith('index-') && f.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${hoja}</style>
<style>html,body{margin:0;background:#EAEEF1}
.marco{width:1280px;background:#EAEEF1;padding:18px 0}</style></head>
<body><div class="marco">${cuerpo}</div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_corregir_ahora.html'), html)
})

// La foto no puede enseñar lo que la pantalla no tiene (B84.2).
describe('la captura y la pantalla dicen lo mismo', () => {
  const pantalla = () => readFileSync(
    resolve(__dirname, '../../../../src/modules/supply/components/AprobarRecuento.tsx'), 'utf8')
  const dialogo = () => readFileSync(
    resolve(__dirname, '../../../../src/modules/supply/components/CorregirAhoraModal.tsx'), 'utf8')
  const foto = () => readFileSync(resolve(__dirname, './capturaCorregirAhora.test.tsx'), 'utf8')

  it('el botón existe en la fila y en la foto', () => {
    expect(pantalla()).toContain('Corregir ahora')
    expect(foto()).toContain('Corregir ahora')
  })

  it('el diálogo pregunta quién ha contado, y lo mismo dice la foto', () => {
    expect(dialogo()).toContain('¿Quién lo ha contado?')
    expect(foto()).toContain('¿Quién lo ha contado?')
  })

  it('lo esperado sale en gris en el diálogo, no sólo en la foto', () => {
    expect(dialogo()).toContain('Folvy esperaba')
    expect(foto()).toContain('Folvy esperaba')
  })

  // La LLAMADA, no la palabra: el comentario que explica por qué se fue sí
  // tiene que quedarse, y buscar «window.prompt» a secas lo daría por vivo.
  it('ya no se LLAMA a window.prompt en la pantalla', () => {
    expect(pantalla()).not.toContain('window.prompt(')
  })

  it('la frase del §2 está en la pantalla, no inventada en la foto', () => {
    expect(pantalla()).toContain('Folvy esperaba en negativo')
    expect(foto()).toContain('Folvy esperaba en negativo')
  })
})
