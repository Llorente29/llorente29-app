#!/usr/bin/env node
// scripts/video/montar.mjs — V01 · monta el vídeo con ffmpeg.
//
//   node scripts/video/montar.mjs <salida>
//
// Lee de <salida>:
//   crudo.webm       la grabación de Playwright (1920×1080)
//   tramos.json      { pasos: [{ paso, subtitulo, desde }], cortes: [[desde, hasta]], fin }
//                    en segundos desde el principio de crudo.webm
//   portada.png, cierre.png   las dos tarjetas (las hace el guion)
// Deja:
//   factura-al-pago.mp4   H.264, 1920×1080, 30 fps, subtítulos quemados
//   subtitulos.ass        los subtítulos, con los tiempos ya del montaje
//   fotogramas/           uno cada 2 s (para revisarlo)
//   pasos/                uno por paso, a mitad de su subtítulo
//
// Cortes: lo que hay entre [desde, hasta] de un corte (las esperas de red) no
// entra. El subtítulo de cada paso va desde que empieza hasta el siguiente.

import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const salida = process.argv[2]
if (!salida) { console.error('uso: montar.mjs <salida>'); process.exit(2) }
const T = JSON.parse(readFileSync(join(salida, 'tramos.json'), 'utf8'))
const PORTADA = 2.5
const CIERRE = 3.5

// 1 · Lo que se queda del crudo: [0, fin] menos los cortes.
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

// 2 · Los subtítulos, en ASS: sin serifa, grandes, abajo, con caja semitransparente.
const hms = (s) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}` }
const pasos = (T.pasos ?? []).map((p, i, xs) => ({ ...p, a: aMontaje(p.desde), b: i + 1 < xs.length ? aMontaje(xs[i + 1].desde) : durCuerpo }))
  .filter((p) => p.subtitulo && p.b - p.a > 0.3)
const ass = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 0', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  // BorderStyle 3: caja detrás; BackColour &H70…: negro al ~56 %.
  'Style: Abajo,DejaVu Sans,46,&H00FFFFFF,&H00FFFFFF,&H70141414,&H70141414,1,0,0,0,100,100,0,0,3,16,0,2,200,200,64,1',
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...pasos.map((p) => `Dialogue: 0,${hms(PORTADA + p.a + 0.15)},${hms(PORTADA + p.b - 0.1)},Abajo,,0,0,0,,${p.subtitulo.replace(/\n/g, '\\N')}`),
  '',
].join('\n')
writeFileSync(join(salida, 'subtitulos.ass'), ass)

// 3 · ffmpeg: portada + tramos del crudo + cierre, y los subtítulos encima.
const partes = []
const filtros = []
filtros.push(`[0:v]scale=1920:1080,setsar=1,fps=30,format=yuv420p,fade=t=out:st=${PORTADA - 0.4}:d=0.4[p]`)
quedan.forEach(([a, b], i) => filtros.push(`[1:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS,scale=1920:1080,setsar=1,fps=30,format=yuv420p[t${i}]`))
filtros.push(`[2:v]scale=1920:1080,setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=0.4[c]`)
partes.push('[p]', ...quedan.map((_, i) => `[t${i}]`), '[c]')
filtros.push(`${partes.join('')}concat=n=${partes.length}:v=1:a=0[todo]`)
filtros.push(`[todo]ass=${join(salida, 'subtitulos.ass').replace(/:/g, '\\:')}[v]`)
const mp4 = join(salida, 'factura-al-pago.mp4')
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-loop', '1', '-t', String(PORTADA), '-i', join(salida, 'portada.png'),
  '-i', join(salida, 'crudo.webm'),
  '-loop', '1', '-t', String(CIERRE), '-i', join(salida, 'cierre.png'),
  '-filter_complex', filtros.join(';'), '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' })

const total = PORTADA + durCuerpo + CIERRE
console.log(`Montado: ${mp4} · ${total.toFixed(1)} s (crudo ${T.fin.toFixed(1)} s, ${cortes.length} cortes, ${quedan.length} tramos).`)

// 4 · Para revisar sin abrir el vídeo: uno cada 2 s y uno por paso.
for (const d of ['fotogramas', 'pasos']) { rmSync(join(salida, d), { recursive: true, force: true }); mkdirSync(join(salida, d)) }
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=1/2,scale=960:-2', join(salida, 'fotogramas', 'f%03d.jpg')])
const unPaso = (nombre, s) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', s.toFixed(2), '-i', mp4, '-frames:v', '1', join(salida, 'pasos', `${nombre}.png`)])
unPaso('0-portada', PORTADA / 2)
pasos.forEach((p) => unPaso(String(p.paso), PORTADA + (p.a + p.b) / 2))
unPaso('9-cierre', PORTADA + durCuerpo + CIERRE / 2)
writeFileSync(join(salida, 'montaje.json'), JSON.stringify({ total, portada: PORTADA, cierre: CIERRE, quedan, pasos: pasos.map(({ paso, subtitulo, a, b }) => ({ paso, subtitulo, desde: PORTADA + a, hasta: PORTADA + b })) }, null, 2))

// 5 · La voz (si el workflow ha dejado un modelo de Piper en VOZ_MODELO): dice
// lo mismo que los subtítulos, cada frase al empezar su paso, en una pista
// aparte. Deja también la pista suelta (voz.m4a) y el vídeo sin voz.
const modelo = process.env.VOZ_MODELO
if (modelo) {
  const dir = join(salida, 'voz'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir)
  const frases = [
    { texto: 'De la factura al pago, sin teclear nada.', en: 0.35 },
    ...pasos.map((p) => ({ texto: `${p.subtitulo}.`, en: PORTADA + p.a + 0.4, hasta: PORTADA + p.b })),
    { texto: 'Sumied. Contabilidad que se hace sola.', en: PORTADA + durCuerpo + 0.4, hasta: total },
  ].map((f, i) => ({ ...f, salida: join(dir, `f${i}.wav`) }))
  const rutaFrases = join(dir, 'frases.json')
  writeFileSync(rutaFrases, JSON.stringify(frases))
  execFileSync('python3', ['scripts/video/voz.py', modelo, rutaFrases], { stdio: 'inherit' })
  const hechas = JSON.parse(readFileSync(rutaFrases, 'utf8'))
  for (const f of hechas) if (f.hasta && f.en + f.dura > f.hasta) console.log(`AVISO: «${f.texto}» dura ${f.dura.toFixed(1)} s y se pisa con el paso siguiente.`)
  const entradas = hechas.flatMap((f) => ['-i', f.salida])
  const mezcla = hechas.map((f, i) => `[${i}:a]aresample=48000,adelay=${Math.round(f.en * 1000)}:all=1[a${i}]`).join(';') +
    `;${hechas.map((_, i) => `[a${i}]`).join('')}amix=inputs=${hechas.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},loudnorm=I=-16:TP=-1.5[voz]`
  const m4a = join(salida, 'voz.m4a')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...entradas, '-filter_complex', mezcla, '-map', '[voz]', '-c:a', 'aac', '-b:a', '160k', m4a])
  const sinVoz = join(salida, 'factura-al-pago-sin-voz.mp4')
  renameSync(mp4, sinVoz)
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', sinVoz, '-i', m4a, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', '-movflags', '+faststart', mp4])
  console.log(`Con voz: ${mp4} (y ${sinVoz}, y la pista suelta ${m4a}).`)
}
