// GD · nº96, fase 3, y nº98 · El vídeo de Sumied para gestorías con la máquina del V01:
//   · cada frase aprobada tiene su gesto en el guion (di), y las tarjetas (portada y cierre) las pone el montaje;
//   · en ensayo no escribe: lo que escribe pasa por pulsaQueEscribe, y Stripe, la validación y el envío, solo grabando;
//   · los subtítulos, dos líneas como mucho (se ve en el móvil);
//   · «Volver a empezar» deja también el acceso de Felipe Herrera para Electricidad Voltio (el devuelto del portal).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FRASES } from '../../../../../scripts/video/gd/locucion.mjs'
import { trozos } from '../../../../../scripts/video/subtitulos.mjs'
import { ACCESOS_DE_LA_DEMO, PORTAL_DEL_DEVUELTO } from '../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos'

const g = readFileSync('scripts/video/gd/sumied.mjs', 'utf8')

describe('GD · el vídeo de Sumied para gestorías', () => {
  it('cada frase tiene su gesto en el guion; portada y cierre, en el montaje', () => {
    for (const id of Object.keys(FRASES)) {
      if (id === 'portada' || id === 'cierre') continue
      const pegada = g.includes(`di('${id}'`) || new RegExp(`\\['\\d', '${id.replace('.', '\\.')}'\\]`).test(g)
      expect(pegada, `la frase ${id} no tiene gesto`).toBe(true)
    }
    expect(g).toContain("tarjeta(navegador, join(salida, 'portada.png'), 'Sumied para gestorías')")
    expect(g).toContain("tarjeta(navegador, join(salida, 'cierre.png'), 'Sumied para gestorías')")
  })

  it('en ensayo no escribe nada', () => {
    expect(g).toMatch(/async function pulsaQueEscribe[\s\S]*?if \(!GRABA\) \{ await ra\.a\(l, ms\); return \}\s*await ra\.clic\(l, ms\)/)
    for (const b of ['Preparar el cobro', 'Este mes no', '/^Aprobar']) expect(g).toMatch(new RegExp(`pulsaQueEscribe\\([^\\n]*${b.replace(/[/^]/g, (c) => `\\${c}`)}`))
    expect(g).toMatch(/if \(GRABA && enviado\) \{\s*await R\.sinVer\(async \(\) => \{[\s\S]*?validarIngresosFacturados/)
    expect(g).toMatch(/if \(GRABA\) \{\s*\/\/ Julio \(nº98\): se paga con la tarjeta de pruebas de Stripe/)
    expect(g).toMatch(/await di\('06\.10', async \(\) => \{\s*if \(!GRABA\) return/)
  })

  it('subtítulos de dos líneas como mucho, con todas las frases', () => {
    for (const t of Object.values(FRASES)) {
      const ts = trozos(t)
      for (const x of ts) expect(x.texto.length).toBeLessThanOrEqual(94)
      expect(ts.map((x) => x.texto).join(' ')).toBe(t.split(/\s+/).join(' '))
      expect(ts[0].a).toBe(0); expect(ts.at(-1)?.b).toBe(1)
    }
  })

  it('«Volver a empezar» deja el acceso de Felipe Herrera, con su usuario', () => {
    expect(ACCESOS_DE_LA_DEMO.map((a) => a.persona)).toEqual(['Tomás Ruiz', 'Felipe Herrera'])
    expect(PORTAL_DEL_DEVUELTO.correo).toMatch(/\.example$/)
    const f = readFileSync('supabase/functions/conta-gd-volver-a-empezar/index.ts', 'utf8')
    expect(f).toContain('admin.auth.admin.createUser({ email: a.correo, email_confirm: true')
    expect(f).toContain("for (const a of ACCESOS_DE_LA_DEMO)")
  })
})

describe('GD · nº99 · la voz elegida y la pronunciación', () => {
  it('la voz de los vídeos es Julio Clon, con el modelo v4, en su único sitio', () => {
    const v = readFileSync('scripts/video/voz-elevenlabs.txt', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    expect(v).toEqual(['TbcXaMnSerONT83CTICz', 'modelo: v4'])
  })

  it('a la voz va «GoCardless» como suena; los subtítulos dicen GoCardless', async () => {
    const { paraLaVoz, FRASES: F, PRONUNCIA } = await import('../../../../../scripts/video/gd/locucion.mjs')
    expect(PRONUNCIA.GoCardless).toBe('Gou Cárdles')
    expect(paraLaVoz(F['06.10'])).toContain('Gou Cárdles pasa los cargos')
    expect(paraLaVoz(F['06.10'])).not.toContain('GoCardless')
    expect(F['06.10']).toContain('GoCardless')
    expect(readFileSync('scripts/video/voz_nube.py', 'utf8')).toContain('habla = lambda x: x.get("voz") or x["texto"]')
  })

  it('la prueba de 01, 02 y 03: cada escena se puede pedir sola', () => {
    for (const e of ['01', '02', '03', '04', '05', '06', '07', '07b', '08', '09', '10', '11']) expect(g).toContain(`if (pide('${e}')) {`)
    const w = readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')
    expect(w.slice(w.indexOf('  video:'))).toContain('ESCENAS: ${{ inputs.escenas }}')
  })
})

describe('GD · nº100 · la demo cobra el mes en curso y deja preparado el siguiente', () => {
  it('el mes del cobro, el en curso salvo que se pida otro', () => {
    for (const f of ['scripts/video/gd/sumied.mjs', 'scripts/video/gd/comprobar.mjs', 'scripts/video/gd/qbo.mjs']) {
      expect(readFileSync(f, 'utf8')).toContain("new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7)")
    }
    expect(readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')).toContain("default: 'este'")
  })
  it('después de enviar, prepara (sin enviar) el recibo del mes siguiente', () => {
    expect(g).toMatch(/if \(enviado\) await R\.sinVer\(async \(\) => \{\s*const siguiente = mesSiguiente\(MES\)[\s\S]*?accion: 'preparar', empresa: SOCIEDAD, mes: siguiente/)
    expect(g).not.toMatch(/accion: 'enviar'/)
  })
})

describe('GD · nº100 · nunca se graba una pantalla cargando', () => {
  it('cada salto de página espera, dentro del corte, a que no quede nada «Cargando…»', () => {
    expect(g).toMatch(/async function ir\([\s\S]*?await sinCargar\(\)\s*\}\)\s*\}/)
    expect(g).toContain('|Entrando…/.test(document.body')
    expect((g.match(/await sinCargar\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

describe('GD · nº116 · el trabajador nuevo y el portal de Tomás Ruiz', () => {
  it('02.4: el zoom va a Lucas Ferrer Gil en «Ver trabajadores» (sale siempre), no al «Alta en…» del recibo', async () => {
    const { CAMBIOS_DEL_MES } = await import('../../../../../supabase/functions/conta-gd-volver-a-empezar/pasos')
    expect(g).toContain(`const TRABAJADOR_NUEVO = '${CAMBIOS_DEL_MES.alta.trabajador}'`)
    expect(g).toContain("di('02.4', () => a(page.locator('.g4-cliente-textos').filter({ hasText: TRABAJADOR_NUEVO })))")
    expect(g).not.toContain('/^Alta (en|el)/')
  })
  it('11: después de guardar la sesión, recarga (cambiar solo el «#» no recarga) y dice si no ha entrado quien toca', () => {
    const entra = g.slice(g.indexOf('const comoEnElPortal'), g.indexOf('const pestanaPortal'))
    expect(entra.indexOf("localStorage.setItem('sumied-portal'")).toBeLessThan(entra.indexOf('page.reload('))
    expect(entra).toContain('el portal no ha entrado como ${u.nombre}')
    expect(g).toContain("correo: 'tomas.ruiz@talleresruiz.example', nombre: 'Tomás'")
  })
})

describe('GD · nº118 · la primera pantalla no depende de la suerte', () => {
  const ir = g.slice(g.indexOf('async function ir('), g.indexOf('async function sinCargar'))
  it('ir: hasta 3 intentos, recargando, dentro del corte (no se graba)', () => {
    expect(ir).toContain('intento <= 3')
    expect(ir).toContain('page.reload(')
    expect(ir.indexOf('R.sinVer')).toBeLessThan(ir.indexOf('page.reload('))
  })
  it('si no sale, lo dice el resumen con lo que se ve; grabando y sin el cobro enviado, para', () => {
    expect(ir).toContain('resumen.push(`✗ v0 · la pantalla no ha salido')
    expect(ir).toContain('if (GRABA && !enviado) throw new Error(t)')
  })
  it('01 espera a la cifra «Cuotas al mes», no a un texto cualquiera', () => {
    expect(g).toContain("await ir('/conta/ventas/clientes-y-cuotas', page.locator('.g4-cifra').filter({ hasText: 'Cuotas al mes' }))")
  })
})

describe('GD · nº120 · los clics que escriben se comprueban', () => {
  const pqe = g.slice(g.indexOf('async function pulsaQueEscribe'), g.indexOf('async function pulsa(loc'))
  it('grabando, si no pasa lo que tiene que pasar, se pulsa de verdad fuera del montaje y, si no, se dice', () => {
    expect(pqe).toContain('efecto = null')
    expect(pqe).toContain('await R.sinVer(async () => { await l.click(')
    expect(pqe).toContain("throw new Error('el clic no ha hecho lo que tenía que hacer')")
  })
  it('06: «Este mes no», «Aprobar los N», «Enviar el cobro» y «Sí, enviar», cada uno con lo que tiene que pasar', () => {
    expect(g).toContain("cambio('Reformas Atalaya').getByText('Fuera de este cobro')")
    expect(g).toContain("page.locator('.g5-hecho').filter({ hasText: 'Aprobados' })")
    expect(g).toContain("await pulsaQueEscribe(enviar, 800, page.getByRole('dialog'))")
    expect(g).toContain("throw new Error('el diálogo de enviar sigue abierto')")
  })
})

describe('GD · nº120 · lo que falló en la grabación del run 22', () => {
  const montar = readFileSync('scripts/video/montar.mjs', 'utf8')
  const wf = readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')
  it('el montaje pasa los filtros a ffmpeg en un fichero (E2BIG con el vídeo entero)', () => {
    expect(montar).not.toContain("'-filter_complex', ")
    expect((montar.match(/'-filter_complex_script', guion\(/g) ?? []).length).toBe(2)
  })
  it('la grabación en bruto se guarda siempre ANTES de montar, y «montar» la vuelve a montar sin grabar', () => {
    const guardar = wf.indexOf('- name: Guardar la grabación en bruto (antes de montar)')
    expect(guardar).toBeGreaterThan(0)
    expect(guardar).toBeLessThan(wf.indexOf('- name: Montar con ffmpeg'))
    const bloque = wf.slice(guardar, wf.indexOf('- name: La grabación en bruto de otro run'))
    for (const f of ['if: always()', 'gd-sumied/crudo.webm', 'gd-sumied/tramos.json', 'gd-sumied/voz']) expect(bloque).toContain(f)
    expect(wf).toContain('options: [ensayo, grabar, comprobar, muestras-voz, video, montar]')
    expect(wf).toContain('run-id: ${{ inputs.desde_run }}')
    expect(wf).toContain("if: inputs.modo == 'video' || inputs.modo == 'montar'")
  })
  it('07.5 espera a que «Descargar PDF» esté encendido', () => {
    expect(g).toContain("page.getByRole('button', { name: 'Descargar PDF' })")
    expect(g).toContain('isEnabled()')
  })
  it('08 casa las liquidaciones como el agente, sin esperar a que alguien abra Bancos', () => {
    expect(g).toContain('await casarLiquidaciones()')
    expect(g).toContain("julio.cliente.rpc('conta_abono_gocardless_casar'")
    expect(g).toContain("p_confianza: 'seguro'")
  })
  it('11.3: Stripe en euros, España y sin Link', () => {
    expect(g).toContain("selectOption('ES')")
    expect(g).toContain('#enableStripePass')
    expect(g).toContain("locale: 'es-ES', timezoneId: 'Europe/Madrid'")
    expect(g).toContain("'Accept-Language': 'es-ES,es;q=0.9'")
  })
})
