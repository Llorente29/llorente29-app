// scripts/video/subtitulos.mjs — GD · nº96 · Dos líneas como mucho (se ve en el móvil): una frase larga sale en trozos seguidos, cada uno
// de hasta POR_TROZO letras (unas 2 líneas de 48 a 52 px en 1920), cortando mejor tras un signo; su tiempo, en
// proporción a lo que dice. Devuelve [{ texto, a, b }] con a y b entre 0 y 1.
export const POR_TROZO = Number(process.env.VIDEO_LETRAS_SUBTITULO || 86)
export function trozos(texto, max = POR_TROZO) {
  const palabras = String(texto).split(/\s+/).filter(Boolean)
  const out = []
  let actual = ''
  for (const p of palabras) {
    const junto = actual ? `${actual} ${p}` : p
    if (junto.length > max && actual) { out.push(actual); actual = p; continue }
    actual = junto
    // Un signo de pausa con el trozo ya a medias: se corta aquí.
    if (/[.:;!?]$/.test(p) && actual.length >= max * 0.55) { out.push(actual); actual = '' }
  }
  if (actual) out.push(actual)
  // Un final muy corto se junta con el anterior si aún caben las dos líneas (unas 48 letras cada una a 52 px).
  if (out.length > 1 && out[out.length - 1].length < 30 && out[out.length - 2].length + out[out.length - 1].length + 1 <= 94) {
    const fin = out.pop(); out[out.length - 1] += ` ${fin}`
  }
  const total = out.reduce((s, t) => s + t.length, 0) || 1
  let ac = 0
  return out.map((t) => { const a = ac / total; ac += t.length; return { texto: t, a, b: ac / total } })
}

