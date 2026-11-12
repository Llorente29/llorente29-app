#!/usr/bin/env node
// scripts/video/montar-ajustado.mjs — GD · nº131 · el montaje del vídeo de gestorías, ajustado a la voz.
//
//   node scripts/video/montar-ajustado.mjs <salida>
//
// Lo mismo que montar.mjs lee (crudo.webm, tramos.json, portada.png, cierre.png, voz/frases.json), con otras reglas
// (Julio, nº131: el vídeo del run 26 tenía tramos de 10 a 25 s de imagen parada y sin voz):
//   · Cada plano dura lo que dura su frase: del crudo solo entra de 0,3 s antes de cada frase a 0,5 s después de su
//     voz. Lo que hay entre medias (esperas, tomas que siguen, pantallas quietas) no entra.
//   · MONTAR_TOMAS («04.1=05-bitrix.gif,05.3=05-pestana-cuotas.gif,…»): esas frases no salen del crudo sino de su toma,
//     a pantalla completa y recortada a la frase. Dos frases seguidas con la misma toma la continúan.
//   · MONTAR_INSERTO («<toma.gif>|<frases>|<escena>»): una toma que no se grabó con el resto (la 07b), con sus frases,
//     antes de la primera frase de <escena>. MONTAR_QUITAR («07.5,08.2»): esas frases fuera.
//   · Los subtítulos, en una franja oscura debajo: la imagen, un poco más pequeña, encima, y nada la tapa.
//   · Al acabar, silencedetect (−40 dB, 2 s) sobre el vídeo con voz: lo dice en silencios.txt y en el registro.
// Las tomas se buscan en TOMAS_DIRS (separadas por «:»), y si no, en scripts/video/gd/tomas.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { trozos } from './subtitulos.mjs'

const salida = process.argv[2]
if (!salida) { console.error('uso: montar-ajustado.mjs <salida>'); process.exit(2) }
const T = JSON.parse(readFileSync(join(salida, 'tramos.json'), 'utf8'))
const rutaVoz = join(salida, 'voz', 'frases.json')
const voz = existsSync(rutaVoz) ? JSON.parse(readFileSync(rutaVoz, 'utf8')).filter((f) => f.dura && existsSync(f.salida)) : []
const vozDe = new Map(voz.map((f) => [f.id, f]))
const NOMBRE = (process.env.VIDEO_NOMBRE || 'video').replace(/[^a-z0-9-]/gi, '')
// nº135 · Las carátulas, hechas (MONTAR_CARATULAS: la carpeta de video-tomas/gd-qbo/tomas): la entrada, 4 s; una de
// 2,5 s antes de su escena; el cierre, 5 s. A pantalla completa, sin zoom ni subtítulos, con un fundido de 0,3 s al entrar
// y al salir. La voz de la portada y la del cierre, solo si caben en su carátula.
const CARTELES = (() => {
  const d = process.env.MONTAR_CARATULAS
  if (!d) return null
  const f = (n) => { const r = join(d, n); if (!existsSync(r)) { console.error(`No está la carátula ${r}.`); process.exit(1) } return r }
  return {
    entrada: { png: f('caratula-0-entrada.png'), dura: 4 },
    caratulas: [['01', 'caratula-1-clientes.png'], ['04', 'caratula-2-bitrix.png'], ['06', 'caratula-3-cobro.png'], ['07', 'caratula-4-factura.png'],
      ['08', 'caratula-5-contabilidad.png'], ['10', 'caratula-6-portal.png']].map(([antes, n]) => ({ antes, png: f(n), dura: 2.5 })),
    cierre: { png: f('caratula-7-cierre.png'), dura: 5 },
  }
})()
const FUNDIDO = 0.3
const PORTADA = Math.round((CARTELES ? CARTELES.entrada.dura : Math.max(3.5, (vozDe.get('portada')?.dura ?? 0) + 1.2)) * 30) / 30
const CIERRE = Math.round((CARTELES ? CARTELES.cierre.dura : Math.max(3.5, (vozDe.get('cierre')?.dura ?? 0) + 1.6)) * 30) / 30
const caratulaDe = new Map((CARTELES?.caratulas ?? []).map((c) => [c.antes, c]))
const ANTES = 0.3      // del crudo, antes de que empiece la frase
const DESPUES = 0.5    // y después de que acabe su voz (Julio: «más 0,5 s como mucho»)
const W = 1920; const H = 1080
// La imagen, encima de la franja de los subtítulos (16:9, centrada).
const IH = 950; const IW = Math.round(IH * 16 / 9 / 2) * 2; const FONDO = '0x0f1623'

const dirsTomas = [...(process.env.TOMAS_DIRS ?? '').split(':').filter(Boolean), 'scripts/video/gd/tomas']
const laToma = (f) => {
  const r = dirsTomas.map((d) => join(d, f)).find((x) => existsSync(x))
  if (!r) { console.error(`No está la toma ${f} (busco en ${dirsTomas.join(', ')}).`); process.exit(1) }
  return r
}
const TOMAS = new Map((process.env.MONTAR_TOMAS ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [id, f] = x.split('='); return [id, laToma(f)] }))
const QUITAR = new Set((process.env.MONTAR_QUITAR ?? '').split(/[\s,]+/).filter(Boolean))
const durDe = (id, defecto) => vozDe.get(id)?.dura ?? defecto ?? 2

// 1 · Las frases, en orden: las del crudo (menos las quitadas) y las de la toma intercalada.
const escenaDe = (id) => String(id).split('.')[0]
const frases = [...(T.dichos ?? [])].filter((d) => !QUITAR.has(d.id)).sort((a, b) => a.desde - b.desde)
  .map((d) => ({ id: d.id, texto: vozDe.get(d.id)?.texto ?? d.texto, dura: durDe(d.id, d.dura), desde: d.desde, toma: TOMAS.get(d.id) ?? null }))
if (process.env.MONTAR_INSERTO) {
  const [gif, prefijo, escena] = process.env.MONTAR_INSERTO.split('|')
  const toma = existsSync(gif) ? gif : laToma(gif)
  const suyas = voz.filter((f) => f.id.startsWith(`${prefijo}.`)).map((f) => ({ id: f.id, texto: f.texto, dura: f.dura, toma }))
  const k = frases.findIndex((f) => escenaDe(f.id) === escena)
  if (k < 0) { console.error(`No está la escena ${escena} en la grabación.`); process.exit(1) }
  frases.splice(k, 0, ...suyas)
  console.log(`Intercalada ${toma} (${suyas.length} frases) antes de la ${escena}.`)
}
if (QUITAR.size) console.log(`Quitadas: ${[...QUITAR].join(', ')}.`)

// 2 · Los planos. Del crudo, [desde − ANTES, desde + voz + DESPUES], sin pisar la frase siguiente y sin lo que el guion
// cortó (las esperas, sinVer). De una toma, ANTES + voz + DESPUES, siguiendo donde la dejó la frase anterior si es la misma.
const cortes = [...(T.cortes ?? [])].map(([a, b]) => [Math.max(0, a), Math.min(T.fin, b)]).filter(([a, b]) => b - a > 0.05).sort((x, y) => x[0] - y[0])
const sinCortes = (a, b) => {
  const out = []; let t = a
  for (const [c0, c1] of cortes) { if (c1 <= t || c0 >= b) continue; if (c0 > t) out.push([t, c0]); t = Math.max(t, c1) }
  if (b > t) out.push([t, b])
  return out.filter(([x, y]) => y - x > 0.04)
}
const FPS = 30
const enFot = (x) => Math.max(1, Math.round(x * FPS)) / FPS   // cada plano, fotogramas enteros: la voz no se desplaza
const planos = []   // { tipo: 'crudo', a, b } | { tipo: 'toma', gif, desde, dura }
let m = PORTADA     // dónde va, en el montaje
const enToma = new Map()
frases.forEach((f, i) => {
  // La carátula de su escena, antes de la primera frase de la escena.
  const car = caratulaDe.get(escenaDe(f.id))
  if (car && (i === 0 || escenaDe(frases[i - 1].id) !== escenaDe(f.id))) {
    const dura = enFot(car.dura)
    planos.push({ tipo: 'cartel', png: car.png, dura, m }); m += dura
    caratulaDe.delete(escenaDe(f.id))
    f.trasCartel = true
  }
  if (f.toma) {
    const desde = enToma.get(f.toma) ?? 0
    const dura = enFot(ANTES + f.dura + DESPUES)
    planos.push({ tipo: 'toma', gif: f.toma, desde, dura, m })
    f.a = m + ANTES; m += dura
    enToma.set(f.toma, desde + dura)
    return
  }
  const sig = frases.slice(i + 1).find((x) => !x.toma && x.desde !== undefined)
  const ant = planos.filter((p) => p.tipo === 'crudo').at(-1)
  let a = Math.max(T.inicio ?? 0, f.desde - ANTES)
  if (ant && planos.at(-1) === ant && a < ant.b) a = ant.b   // sigue el plano anterior, sin repetir
  let b = Math.min(T.fin, f.desde + f.dura + DESPUES)
  if (sig && sig.desde - ANTES < b && sig.desde - ANTES > a) b = sig.desde - ANTES
  const trozosCrudo = sinCortes(a, b)
  f.a = m + Math.max(0, f.desde - a)
  for (const [x, y0] of trozosCrudo) {
    const y = x + enFot(y0 - x)
    if (x <= f.desde && f.desde < y) f.a = m + (f.desde - x)
    const ult = planos.at(-1)
    planos.push({ tipo: 'crudo', a: x, b: y, m })
    m += y - x
  }
  if (!trozosCrudo.length) f.a = m
})
const durCuerpo = m - PORTADA
const total = PORTADA + durCuerpo + CIERRE
const dichos = frases.map((f, i) => ({ ...f, b: Math.min(i + 1 < frases.length ? frases[i + 1].a - 0.05 : PORTADA + durCuerpo, f.a + f.dura + 0.4) }))

// 3 · El zoom (nº134): como mucho 1,6×; el encuadre es el elemento entero que señala la frase (la unión de lo que señala el
// ratón mientras se dice), con un 10 % de margen por cada lado, así que no corta texto; transiciones suaves de 0,7 s; plano
// entero al empezar cada sección; y las tomas y las carátulas, siempre en plano entero.
const ZMAX = Number(process.env.VIDEO_ZMAX || 1.6)
const TRANSICION = 0.7
const vista = (caja) => {
  if (!caja) return { z: 1, cx: W / 2, cy: H / 2 }
  const mx = Math.max(16, caja.w * 0.1); const my = Math.max(16, caja.h * 0.1)
  const w = Math.max(caja.w + 2 * mx, W / ZMAX); const h = Math.max(caja.h + 2 * my, H / ZMAX)
  const z = Math.min(ZMAX, Math.max(1, Math.min(W / w, H / h)))
  return { z, cx: Math.min(W - W / z / 2, Math.max(W / z / 2, caja.x + caja.w / 2)), cy: Math.min(H - H / z / 2, Math.max(H / z / 2, caja.y + caja.h / 2)) }
}
const objetivos = T.objetivos ?? []
const llaves = [{ ...vista(null), t: 0 }]
dichos.forEach((d, i) => {
  const inicio = d.a - ANTES
  if (d.toma) { llaves.push({ ...llaves.at(-1), t: inicio - 0.01 }, { ...vista(null), t: inicio }); return }
  let caja = null
  if (d.desde !== undefined) {
    const fin = d.desde + d.dura + DESPUES
    const cajas = objetivos.filter((o) => o.t >= d.desde - 0.2 && o.t < fin && o.w > 2 && o.h > 2)
    if (cajas.length) {
      const x0 = Math.min(...cajas.map((c) => c.x)); const y0 = Math.min(...cajas.map((c) => c.y))
      const x1 = Math.max(...cajas.map((c) => c.x + c.w)); const y1 = Math.max(...cajas.map((c) => c.y + c.h))
      caja = { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(W, x1) - Math.max(0, x0), h: Math.min(H, y1) - Math.max(0, y0) }
    }
  }
  const v = vista(caja)
  const nuevaSeccion = i === 0 || escenaDe(d.id) !== escenaDe(dichos[i - 1].id) || !!dichos[i - 1].toma
  // Al empezar la sección (o al volver de una toma), plano entero; después, al encuadre de la frase en 0,7 s.
  if (nuevaSeccion) llaves.push({ ...llaves.at(-1), t: inicio - 0.01 }, { ...vista(null), t: inicio })
  const desde = Math.max(inicio, d.a - 0.1)
  llaves.push({ ...llaves.at(-1), t: desde }, { ...v, t: desde + TRANSICION })
})
// Las carátulas, en plano entero: lo de antes se queda hasta el corte.
for (const p of planos.filter((x) => x.tipo === 'cartel')) {
  const antes = [...llaves].filter((l) => l.t < p.m).sort((x, y) => x.t - y.t).at(-1) ?? vista(null)
  llaves.push({ ...antes, t: p.m - 0.01 }, { ...vista(null), t: p.m }, { ...vista(null), t: p.m + p.dura - 0.01 })
}
llaves.push({ ...llaves.at(-1), t: PORTADA + durCuerpo - 0.6 }, { ...vista(null), t: PORTADA + durCuerpo })
llaves.sort((a, b) => a.t - b.t)
const aTrozos = (k) => {
  const tramo = (i) => {
    if (i >= llaves.length - 1) return llaves.at(-1)[k].toFixed(4)
    const a = llaves[i]; const b = llaves[i + 1]
    const d = Math.max(0.001, b.t - a.t)
    const u = `clip((t-${a.t.toFixed(3)})/${d.toFixed(3)},0,1)`
    return `(${a[k].toFixed(4)}+(${(b[k] - a[k]).toFixed(4)})*${u}*${u}*(3-2*${u}))`
  }
  const arbol = (lo, hi) => (lo === hi ? tramo(lo) : `if(lt(t,${llaves[Math.floor((lo + hi) / 2) + 1].t.toFixed(3)}),${arbol(lo, Math.floor((lo + hi) / 2))},${arbol(Math.floor((lo + hi) / 2) + 1, hi)})`)
  return arbol(0, llaves.length - 1)
}
const Z = aTrozos('z'); const CX = aTrozos('cx'); const CY = aTrozos('cy')

// 4 · Los subtítulos, en la franja de abajo: unos 36 px, una o dos líneas, sin caja (la franja ya es oscura).
const hms = (s) => { const h = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(mm).padStart(2, '0')}:${x}` }
writeFileSync(join(salida, 'subtitulos.ass'), [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  `Style: Franja,DejaVu Sans,36,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,${(W - IW) / 2 + 40},${(W - IW) / 2 + 40},${Math.round((H - IH - 2 * 43) / 2)},1`,
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...dichos.flatMap((d) => trozos(d.texto).map((t) => `Dialogue: 0,${hms(t.a * (d.b - d.a - 0.05) + d.a + 0.05)},${hms(t.b * (d.b - d.a - 0.05) + d.a + 0.05)},Franja,,0,0,0,,${t.texto}`)),
  '',
].join('\n'))

// 5 · ffmpeg, en dos pasadas (con un centenar de planos de la misma grabación en una sola orden, ffmpeg guarda todo
// lo decodificado y se queda sin memoria): cada plano a su fichero, con sus fotogramas exactos; luego, todos juntos con el
// zoom, la imagen encima de la franja y los subtítulos.
const dirPlanos = join(salida, 'planos-tmp')
rmSync(dirPlanos, { recursive: true, force: true }); mkdirSync(dirPlanos)
const comun = `setsar=1,fps=${FPS},format=yuv420p`
const codif = ['-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS)]
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
const lista = []
// Cada plano, con sus fotogramas EXACTOS: si a su trozo le faltan (el final de una toma o de la grabación), se repite
// el último (tpad) y se corta en N. Si no, el vídeo se queda corto y la voz se adelanta (3,6 s en la prueba del nº131).
let descuadres = 0
const plano = (nombre, entrada, vf, dura) => {
  const f = join(dirPlanos, `${nombre}.mp4`)
  const n = Math.round(dura * FPS)
  ff([...entrada, '-vf', `${vf},tpad=stop_mode=clone:stop_duration=${(dura + 2).toFixed(2)}`, '-frames:v', String(n), ...codif, f])
  const hay = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim())
  if (hay !== n) { descuadres++; console.log(`AVISO: el plano ${nombre} tiene ${hay} fotogramas y tenían que ser ${n}.`) }
  // nº136 · Y sus marcas de tiempo: un plano con huecos alargaba el vídeo al juntarlos (run 27: 6,8 s de más). Se dice.
  const [ini, dur] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time,duration', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number)
  if (Math.abs(ini) > 0.01 || Math.abs(dur - n / FPS) > 0.02) console.log(`Marcas de tiempo del plano ${nombre}: empieza en ${ini.toFixed(3)} s y dura ${dur.toFixed(3)} s (son ${n} fotogramas: ${(n / FPS).toFixed(3)} s).`)
  lista.push(`file '${f}'`)
}
const negro = (dura) => ['-f', 'lavfi', '-t', (dura + 1).toFixed(2), '-i', `color=c=black:s=${W}x${H}:r=${FPS}`]
if (CARTELES) plano('000-portada', negro(PORTADA), comun, enFot(PORTADA))
else plano('000-portada', ['-loop', '1', '-i', join(salida, existsSync(join(salida, 'portada-video.png')) ? 'portada-video.png' : 'portada.png')],
  `scale=${W}:${H},${comun},fade=t=out:st=${(PORTADA - 0.4).toFixed(2)}:d=0.4`, enFot(PORTADA))
planos.forEach((p, i) => {
  const n = String(i + 1).padStart(3, '0')
  if (p.tipo === 'cartel') plano(n, negro(p.dura), comun, p.dura)
  // nº136 · La grabación de Playwright solo guarda un fotograma cuando la pantalla cambia: si el plano empieza en un
  // hueco, el primero que se lee es el del siguiente cambio y el plano sale desplazado. Se empieza a leer 15 s antes, se
  // rellenan los huecos con la pantalla que había (fps) y se recorta justo en su sitio.
  else if (p.tipo === 'crudo') {
    const ss = Math.max(0, p.a - 15)
    plano(n, ['-ss', ss.toFixed(3), '-i', join(salida, 'crudo.webm')], `fps=${FPS},trim=start=${(p.a - ss).toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H},${comun}`, p.b - p.a)
  }
  else plano(n, ['-ignore_loop', '0', '-t', (p.desde + p.dura + 1).toFixed(2), '-i', p.gif],
    `trim=start=${p.desde.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1f2a3c,${comun}`, p.dura)
})
if (CARTELES) plano('999-cierre', negro(CIERRE), comun, enFot(CIERRE))
else plano('999-cierre', ['-loop', '1', '-i', join(salida, 'cierre.png')], `scale=${W}:${H},${comun},fade=t=in:st=0:d=0.4`, enFot(CIERRE))
writeFileSync(join(dirPlanos, 'lista.txt'), lista.join('\n') + '\n')
// nº136 · Al juntar, cada fotograma toma su tiempo de su número de orden (N/30), no de las marcas de cada plano: con
// planos de la grabación de verdad, las marcas traían huecos y el vídeo salía 204 fotogramas (6,8 s) más largo que la voz.
const filtros = [
  `[0:v]setpts=N/(${FPS}*TB),scale=w='trunc(${W}*(${Z})/2)*2':h='trunc(${H}*(${Z})/2)*2':eval=frame:flags=lanczos,` +
  `crop=${W}:${H}:x='clip((${CX})*(${Z})-${W / 2},0,${W}*((${Z})-1))':y='clip((${CY})*(${Z})-${H / 2},0,${H}*((${Z})-1))'[zz]`,
  `[zz]scale=${IW}:${IH}:flags=lanczos,pad=${W}:${H}:${(W - IW) / 2}:0:color=${FONDO}[fr]`,
  `[fr]ass=${join(salida, 'subtitulos.ass').replace(/:/g, '\\:')}[v0]`,
]
// Las carátulas, encima de todo (sin marco, sin franja, sin zoom), cada una en su sitio con su fundido.
const encima = CARTELES ? [{ png: CARTELES.entrada.png, a: 0, dura: PORTADA },
  ...planos.filter((p) => p.tipo === 'cartel').map((p) => ({ png: p.png, a: p.m, dura: p.dura })),
  { png: CARTELES.cierre.png, a: PORTADA + durCuerpo, dura: CIERRE }] : []
const entradasEncima = encima.flatMap((c) => ['-loop', '1', '-t', total.toFixed(2), '-i', c.png])
encima.forEach((c, k) => {
  const fin = c.a + c.dura
  filtros.push(`[${k + 1}:v]scale=${W}:${H},setsar=1,fps=${FPS},format=yuva420p,` +
    `fade=t=in:st=${c.a.toFixed(3)}:d=${FUNDIDO}:alpha=1,fade=t=out:st=${(fin - FUNDIDO).toFixed(3)}:d=${FUNDIDO}:alpha=1[k${k}]`)
  filtros.push(`[v${k}][k${k}]overlay=0:0:enable='between(t,${c.a.toFixed(3)},${fin.toFixed(3)})'${k === encima.length - 1 ? ',format=yuv420p[v]' : `[v${k + 1}]`}`)
})
if (!encima.length) filtros.push('[v0]null[v]')
const guion = (nombre, texto) => { const f = join(salida, `filtro-${nombre}.txt`); writeFileSync(f, texto); return f }
const mp4 = join(salida, `${NOMBRE}.mp4`)
const sinVoz = join(salida, `${NOMBRE}-sin-voz.mp4`)
ff(['-f', 'concat', '-safe', '0', '-i', join(dirPlanos, 'lista.txt'), ...entradasEncima, '-filter_complex_script', guion('video', filtros.join(';')), '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sinVoz])
rmSync(dirPlanos, { recursive: true, force: true })
const real = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sinVoz]).toString().trim())
console.log(`Montado: ${real.toFixed(2)} s (planeado ${total.toFixed(2)} s; crudo ${T.fin.toFixed(1)} s, ${planos.length} planos, ${dichos.length} frases, ${descuadres} planos descuadrados).`)
if (Math.abs(real - total) > 0.2) console.log(`AVISO: el vídeo dura ${real.toFixed(2)} s y lo planeado eran ${total.toFixed(2)} s: la voz no cuadra.`)

// 6 · La voz, cada frase en su sitio (y la portada y el cierre).
const cabe = (id, sitio) => !CARTELES || (vozDe.get(id)?.dura ?? Infinity) + 0.6 <= sitio
const tarjetas = [{ id: 'portada', a: 0.35 }, { id: 'cierre', a: PORTADA + durCuerpo + 0.5 }].filter((t) => cabe(t.id, t.id === 'portada' ? PORTADA : CIERRE))
if (CARTELES) for (const id of ['portada', 'cierre']) if (!tarjetas.some((t) => t.id === id) && vozDe.has(id)) console.log(`La voz de «${id}» (${vozDe.get(id).dura.toFixed(1)} s) no cabe en su carátula: va sin voz.`)
const sonidos = [...tarjetas, ...dichos].filter((d) => vozDe.has(d.id))
if (sonidos.length) {
  const ent = sonidos.flatMap((d) => ['-i', vozDe.get(d.id).salida])
  const mezcla = sonidos.map((d, i) => `[${i}:a]aresample=48000,adelay=${Math.round(d.a * 1000)}:all=1[a${i}]`).join(';') +
    `;${sonidos.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sonidos.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},alimiter=limit=0.95:level=false[voz]`
  const m4a = join(salida, 'voz.m4a')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...ent, '-filter_complex_script', guion('voz', mezcla), '-map', '[voz]', '-c:a', 'aac', '-b:a', '192k', m4a])
  // nº133 · La música (MONTAR_MUSICA), muy baja debajo de la voz: a −24 dB, y más baja aún cuando habla (la voz la aprieta,
  // sidechaincompress); repetida con un fundido de 2 s hasta cubrir el vídeo, entra con fundido y sale con fundido en el cierre.
  let pista = m4a
  const musica = process.env.MONTAR_MUSICA
  if (musica && existsSync(musica)) {
    const md = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', musica]).toString().trim())
    const veces = Math.max(1, Math.ceil((total + 2) / Math.max(1, md - 2)))
    const ent2 = ['-i', m4a, ...Array.from({ length: veces }, () => ['-i', musica]).flat()]
    let cadena = '[1:a]aresample=48000[m0]'
    for (let k = 2; k <= veces; k++) cadena += `;[${k}:a]aresample=48000[r${k}];[m${k - 2}][r${k}]acrossfade=d=2:c1=tri:c2=tri[m${k - 1}]`
    const mus = `${cadena};[m${veces - 1}]atrim=0:${total.toFixed(2)},volume=-24dB,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3[mus]` +
      ';[0:a]asplit=2[v1][v2];[mus][v2]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[bajo]' +
      ';[v1][bajo]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[mezcla]'
    pista = join(salida, 'voz-y-musica.m4a')
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...ent2, '-filter_complex_script', guion('musica', mus), '-map', '[mezcla]', '-c:a', 'aac', '-b:a', '192k', pista])
    console.log(`Con música: ${musica.split('/').at(-1)}, ${veces} ${veces === 1 ? 'vez' : 'veces'} con fundido, a −24 dB y más baja cuando habla.`)
  }
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', sinVoz, '-i', pista, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', '-movflags', '+faststart', mp4])
  console.log(`Con voz: ${sonidos.length} frases.`)
} else {
  renameSync(sinVoz, mp4)
  console.log('Sin voz: no hay voz hecha (voz/frases.json).')
}

// 7 · Los silencios: silencedetect (−40 dB, 2 s) sobre el vídeo con voz. Ninguno debería pasar de 2 s.
// Con música, el silencio se mide en la voz sola (voz.m4a): «sin voz» es lo que cuenta. Los de la entrada y las carátulas
// se dicen aparte: allí no se habla a propósito.
const medir = existsSync(join(salida, 'voz.m4a')) ? join(salida, 'voz.m4a') : mp4
// silencedetect escribe en la salida de ERRORES: se lee ésa (leyendo la normal, siempre salía 0).
const sd = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', medir, '-af', 'silencedetect=noise=-40dB:d=2', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? ''
const silencios = [...String(sd).matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((x) => ({ fin: +x[1], dura: +x[2] }))
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const carteles = [[0, PORTADA], ...planos.filter((p) => p.tipo === 'cartel').map((p) => [p.m, p.m + p.dura]), [PORTADA + durCuerpo, total]]
for (const s of silencios) { const a = s.fin - s.dura; s.cartel = carteles.some(([x, y]) => a < y && s.fin > x) }
const fuera = silencios.filter((s) => !s.cartel)
const lineas = silencios.map((s) => `${mmss(s.fin - s.dura)}  ${(s.fin - s.dura).toFixed(1)} s → ${s.fin.toFixed(1)} s (${s.dura.toFixed(1)} s)${s.cartel ? ' · entrada, carátula o cierre' : ' · SIN VOZ'}`)
writeFileSync(join(salida, 'silencios.txt'), [`silencedetect −40 dB, 2 s, sobre ${medir.split('/').at(-1)}: ${silencios.length} tramos sin voz de 2 s o más; fuera de la entrada, las carátulas y el cierre, ${fuera.length}.`, ...lineas, ''].join('\n'))
console.log(`Silencios de 2 s o más (−40 dB, ${medir.split('/').at(-1)}): ${silencios.length}; fuera de la entrada, las carátulas y el cierre: ${fuera.length}.${lineas.length ? `\n  ${lineas.join('\n  ')}` : ''}`)

// 8 · Para revisar sin abrir el vídeo: uno cada 2 s y uno por escena.
for (const d of ['fotogramas', 'pasos']) { rmSync(join(salida, d), { recursive: true, force: true }); mkdirSync(join(salida, d)) }
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=1/2,scale=960:-2', join(salida, 'fotogramas', 'f%03d.jpg')])
const unPaso = (nombre, s) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', s.toFixed(2), '-i', mp4, '-frames:v', '1', join(salida, 'pasos', `${nombre}.png`)])
const porEscena = new Map()
for (const d of dichos) if (!porEscena.has(escenaDe(d.id))) porEscena.set(escenaDe(d.id), d)
unPaso('0-portada', PORTADA / 2)
for (const [e, d] of porEscena) unPaso(e, d.a + Math.min(2, d.dura / 2))
unPaso('9-cierre', PORTADA + durCuerpo + CIERRE / 2)
writeFileSync(join(salida, 'montaje.json'), JSON.stringify({ total, portada: PORTADA, cierre: CIERRE, planos, silencios,
  dichos: dichos.map(({ id, texto, a, b, toma }) => ({ id, texto, desde: a, hasta: b, toma: toma ? toma.split('/').at(-1) : null })) }, null, 2))
