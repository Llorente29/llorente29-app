#!/usr/bin/env node
// scripts/video/montar.mjs — V01 · monta el vídeo con ffmpeg.
//
//   node scripts/video/montar.mjs <salida>
//
// Lee de <salida>:
//   crudo.webm       la grabación de Playwright (1920×1080)
//   tramos.json      { inicio, fin, pasos: [{ paso, desde }], dichos: [{ id, texto, dura, desde }], cortes: [[desde, hasta]] }
//                    en segundos desde el principio de crudo.webm
//   portada.png, cierre.png   las dos tarjetas (las hace el guion)
//   voz/frases.json  la voz ya hecha, antes de grabar (voz.py): { id, texto, salida, dura } por frase
// Deja:
//   factura-al-pago.mp4          H.264, 1920×1080, 30 fps, subtítulos quemados y la voz
//   factura-al-pago-sin-voz.mp4  el mismo, sin voz; voz.m4a, la voz sola
//   subtitulos.ass               los subtítulos, con los tiempos ya del montaje
//   fotogramas/                  uno cada 2 s (para revisarlo)
//   pasos/                       uno por paso, a mitad del paso
//
// Cortes: lo que hay entre [desde, hasta] de un corte (las esperas de red) no
// entra. El guion no corta nunca dentro de una frase (raton.mjs, di).

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const salida = process.argv[2]
if (!salida) { console.error('uso: montar.mjs <salida>'); process.exit(2) }
const T = JSON.parse(readFileSync(join(salida, 'tramos.json'), 'utf8'))
const rutaVoz = join(salida, 'voz', 'frases.json')
const voz = existsSync(rutaVoz) ? JSON.parse(readFileSync(rutaVoz, 'utf8')).filter((f) => f.dura && existsSync(f.salida)) : []
const vozDe = new Map(voz.map((f) => [f.id, f]))
const textoDe = (id, defecto) => vozDe.get(id)?.texto ?? defecto
const PORTADA = Math.max(2.5, (vozDe.get('portada')?.dura ?? 0) + 1.0)
const CIERRE = Math.max(3.5, (vozDe.get('cierre')?.dura ?? 0) + 1.6)

// 1 · Lo que se queda del crudo: [inicio, fin] menos los cortes.
const cortes = [...(T.cortes ?? [])].map(([a, b]) => [Math.max(0, a), Math.min(T.fin, b)]).filter(([a, b]) => b - a > 0.05).sort((x, y) => x[0] - y[0])
const quedan = []
let t = T.inicio ?? 0
for (const [a, b] of cortes) { if (a > t) quedan.push([t, a]); t = Math.max(t, b) }
if (T.fin > t) quedan.push([t, T.fin])

/** Un instante del crudo, en el montaje (sin portada). */
function aMontaje(x) {
  let m = 0
  for (const [a, b] of quedan) {
    if (x >= b) { m += b - a; continue }
    if (x > a) m += x - a
    break
  }
  return m
}
const durCuerpo = quedan.reduce((s, [a, b]) => s + b - a, 0)
const total = PORTADA + durCuerpo + CIERRE

// 2 · Lo que se dice, en el montaje: cada frase desde su gesto hasta que acaba (o empieza la siguiente).
const dichos = (T.dichos ?? []).map((d, i, xs) => {
  const a = PORTADA + aMontaje(d.desde)
  const sig = i + 1 < xs.length ? PORTADA + aMontaje(xs[i + 1].desde) : PORTADA + durCuerpo
  return { ...d, a, b: Math.min(sig - 0.05, a + (vozDe.get(d.id)?.dura ?? d.dura) + 0.8) }
})
const tarjetas = [
  { id: 'portada', texto: textoDe('portada', ''), a: 0.35, b: PORTADA - 0.2, sinSubtitulo: true },
  { id: 'cierre', texto: textoDe('cierre', ''), a: PORTADA + durCuerpo + 0.5, b: total - 0.2, sinSubtitulo: true },
]

// 2b · El ZOOM: mientras se dice una frase, se amplía lo que el ratón señala
// (la unión de las cajas de R.objetivos en ese rato), hasta ×ZMAX; entre
// frases separadas, y en la portada y el cierre, el plano entero. En el móvil
// es lo que hace que se lea. Es del montaje: no depende de cada pantalla.
const ZMAX = Number(process.env.VIDEO_ZMAX || 1.9)
const W = 1920; const H = 1080
const vista = (caja) => {
  if (!caja) return { z: 1, cx: W / 2, cy: H / 2 }
  const pad = 90
  const w = Math.max(caja.w + 2 * pad, W / ZMAX); const h = Math.max(caja.h + 2 * pad, H / ZMAX)
  const z = Math.min(ZMAX, Math.max(1, Math.min(W / w, H / h)))
  const cx = Math.min(W - W / z / 2, Math.max(W / z / 2, caja.x + caja.w / 2))
  const cy = Math.min(H - H / z / 2, Math.max(H / z / 2, caja.y + caja.h / 2))
  return { z, cx, cy }
}
const objetivos = T.objetivos ?? []
const llaves = [{ ...vista(null), t: 0 }]
;(T.dichos ?? []).forEach((d, i, xs) => {
  const fin = i + 1 < xs.length ? xs[i + 1].desde : T.fin
  const cajas = objetivos.filter((o) => o.t >= d.desde - 0.2 && o.t < fin && o.w > 2 && o.h > 2)
  let caja = null
  if (cajas.length) {
    const x0 = Math.min(...cajas.map((c) => c.x)); const y0 = Math.min(...cajas.map((c) => c.y))
    const x1 = Math.max(...cajas.map((c) => c.x + c.w)); const y1 = Math.max(...cajas.map((c) => c.y + c.h))
    caja = { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(W, x1) - Math.max(0, x0), h: Math.min(H, y1) - Math.max(0, y0) }
  }
  const v = vista(caja)
  const md = dichos[i]
  llaves.push({ ...llaves[llaves.length - 1], t: md.a - 0.15, mantener: true })
  llaves.push({ ...v, t: md.a + 0.75 })
  const sig = i + 1 < dichos.length ? dichos[i + 1].a : PORTADA + durCuerpo
  if (sig - md.b > 1.6) {  // hueco: se vuelve al plano entero (cambio de pantalla, un clic…)
    llaves.push({ ...v, t: md.b, mantener: true })
    llaves.push({ ...vista(null), t: md.b + 0.8 })
  }
})
llaves.push({ ...llaves[llaves.length - 1], t: PORTADA + durCuerpo - 0.9, mantener: true })
llaves.push({ ...vista(null), t: PORTADA + durCuerpo })
llaves.sort((a, b) => a.t - b.t)
// Una función a trozos para ffmpeg: entre dos llaves, una curva suave (smoothstep).
const aTrozos = (k) => {
  let e = llaves[llaves.length - 1][k].toFixed(4)
  for (let i = llaves.length - 2; i >= 0; i--) {
    const a = llaves[i]; const b = llaves[i + 1]
    const d = Math.max(0.001, b.t - a.t)
    const u = `clip((t-${a.t.toFixed(3)})/${d.toFixed(3)},0,1)`
    const tramo = `(${a[k].toFixed(4)}+(${(b[k] - a[k]).toFixed(4)})*${u}*${u}*(3-2*${u}))`
    e = `if(lt(t,${b.t.toFixed(3)}),${tramo},${e})`
  }
  return e
}
const Z = aTrozos('z'); const CX = aTrozos('cx'); const CY = aTrozos('cy')
writeFileSync(join(salida, 'zoom.json'), JSON.stringify(llaves.map((l) => ({ t: +l.t.toFixed(2), z: +l.z.toFixed(2), cx: Math.round(l.cx), cy: Math.round(l.cy) })), null, 1))

// 3 · Los subtítulos, en ASS: sin serifa, abajo, con caja semitransparente; dos líneas como mucho.
const hms = (s) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}` }
const ass = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 0', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  // BorderStyle 3: caja detrás; BackColour &H70…: negro al ~56 %.
  'Style: Abajo,DejaVu Sans,52,&H00FFFFFF,&H00FFFFFF,&H60141414,&H60141414,1,0,0,0,100,100,0,0,3,18,0,2,180,180,48,1',
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...dichos.map((d) => `Dialogue: 0,${hms(d.a + 0.05)},${hms(d.b)},Abajo,,0,0,0,,${d.texto}`),
  '',
].join('\n')
writeFileSync(join(salida, 'subtitulos.ass'), ass)

// 4 · ffmpeg: portada + tramos del crudo + cierre, y los subtítulos encima.
const partes = []
const filtros = []
filtros.push(`[0:v]scale=1920:1080,setsar=1,fps=30,format=yuv420p,fade=t=out:st=${(PORTADA - 0.4).toFixed(2)}:d=0.4[p]`)
quedan.forEach(([a, b], i) => filtros.push(`[1:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS,scale=1920:1080,setsar=1,fps=30,format=yuv420p[t${i}]`))
filtros.push(`[2:v]scale=1920:1080,setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=0.4[c]`)
partes.push('[p]', ...quedan.map((_, i) => `[t${i}]`), '[c]')
filtros.push(`${partes.join('')}concat=n=${partes.length}:v=1:a=0[todo]`)
filtros.push(`[todo]scale=w='trunc(${W}*(${Z})/2)*2':h='trunc(${H}*(${Z})/2)*2':eval=frame:flags=lanczos,` +
  `crop=${W}:${H}:x='clip((${CX})*iw/${W}-${W / 2},0,iw-${W})':y='clip((${CY})*ih/${H}-${H / 2},0,ih-${H})'[zz]`)
filtros.push(`[zz]ass=${join(salida, 'subtitulos.ass').replace(/:/g, '\\:')}[v]`)
const mp4 = join(salida, 'factura-al-pago.mp4')
const sinVoz = join(salida, 'factura-al-pago-sin-voz.mp4')
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-loop', '1', '-t', PORTADA.toFixed(2), '-i', join(salida, 'portada.png'),
  '-i', join(salida, 'crudo.webm'),
  '-loop', '1', '-t', CIERRE.toFixed(2), '-i', join(salida, 'cierre.png'),
  '-filter_complex', filtros.join(';'), '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sinVoz], { stdio: 'inherit' })
console.log(`Montado: ${total.toFixed(1)} s (crudo ${T.fin.toFixed(1)} s, ${cortes.length} cortes, ${quedan.length} tramos, ${dichos.length} frases).`)

// 5 · La voz: cada frase en su sitio, en una pista aparte. Sin voz hecha, el vídeo va sin voz.
const sonidos = [...tarjetas, ...dichos].filter((d) => vozDe.has(d.id))
if (sonidos.length) {
  for (const d of dichos) {
    const v = vozDe.get(d.id)
    if (v && d.a + v.dura > d.b + 0.6) console.log(`AVISO: «${d.texto}» (${v.dura.toFixed(1)} s) se pisa con la frase siguiente.`)
  }
  const entradas = sonidos.flatMap((d) => ['-i', vozDe.get(d.id).salida])
  const mezcla = sonidos.map((d, i) => `[${i}:a]aresample=48000,adelay=${Math.round(d.a * 1000)}:all=1[a${i}]`).join(';') +
    `;${sonidos.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sonidos.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},loudnorm=I=-16:TP=-1.5[voz]`
  const m4a = join(salida, 'voz.m4a')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...entradas, '-filter_complex', mezcla, '-map', '[voz]', '-c:a', 'aac', '-b:a', '160k', m4a])
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', sinVoz, '-i', m4a, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', '-movflags', '+faststart', mp4])
  console.log(`Con voz: ${sonidos.length} frases.`)
} else {
  renameSync(sinVoz, mp4)
  console.log('Sin voz: no hay voz hecha (voz/frases.json).')
}

// 6 · Para revisar sin abrir el vídeo: uno cada 2 s y uno por paso.
for (const d of ['fotogramas', 'pasos']) { rmSync(join(salida, d), { recursive: true, force: true }); mkdirSync(join(salida, d)) }
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=1/2,scale=960:-2', join(salida, 'fotogramas', 'f%03d.jpg')])
const unPaso = (nombre, s) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', s.toFixed(2), '-i', mp4, '-frames:v', '1', join(salida, 'pasos', `${nombre}.png`)])
const pasos = (T.pasos ?? []).map((p, i, xs) => ({ paso: p.paso, a: PORTADA + aMontaje(p.desde), b: PORTADA + (i + 1 < xs.length ? aMontaje(xs[i + 1].desde) : durCuerpo) }))
unPaso('0-portada', PORTADA / 2)
pasos.forEach((p) => unPaso(String(p.paso), (p.a + p.b) / 2))
unPaso('9-cierre', PORTADA + durCuerpo + CIERRE / 2)
writeFileSync(join(salida, 'montaje.json'), JSON.stringify({ total, portada: PORTADA, cierre: CIERRE, quedan, pasos,
  dichos: dichos.map(({ id, texto, a, b }) => ({ id, texto, desde: a, hasta: b })) }, null, 2))
