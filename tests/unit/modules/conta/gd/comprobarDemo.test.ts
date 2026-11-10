// GD · nº92 y nº93 · «Comprobar» la demo en vivo: recorre la Gestoría Demo de producción SIN GRABAR y SOLO LEYENDO.
// Lo que se vigila, sobre el fichero (no se ejecuta: abre un navegador contra producción):
//   · a la base, solo consultas: ni insert, ni update, ni upsert, ni delete, y como funciones solo las de entrar;
//   · cada pulsación pasa por `pulsar`, que solo deja nombres de PULSABLES, y ninguno cambia la demo;
//   · el workflow lo corre en su propio job, desde el entorno «despliegue», y el de grabar no corre con «comprobar».
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const g = readFileSync('scripts/video/gd/comprobar.mjs', 'utf8')
const PULSABLES = (g.match(/export const PULSABLES = \[([\s\S]*?)\]/)?.[1] ?? '').match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) ?? []

describe('GD · comprobar la demo: solo lee', () => {
  it('a la base, solo consultas', () => {
    expect(g).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    const rpcs = [...g.matchAll(/\.rpc\('([^']+)'/g)].map((m) => m[1])
    expect(new Set(rpcs)).toEqual(new Set(['_cuenta_activa', 'cambiar_empresa']))
    expect(g).not.toMatch(/functions\/v1|functions\.invoke/)
  })

  it('solo pulsa lo de PULSABLES, y nada de eso cambia la demo', () => {
    expect(PULSABLES.length).toBeGreaterThan(3)
    for (const p of PULSABLES) expect(p).not.toMatch(/Preparar|Aprobar|Enviar|Este mes no|Validar|Deshacer|Volver a empezar|Lo he mirado|Confirmar|Guardar|Borrar|Firmar|Pagar/i)
    expect(g).toContain('if (!PULSABLES.includes(nombre)) throw')
    // Un solo .click(: el de dentro de `pulsar`.
    expect(g.match(/\.click\(/g)).toHaveLength(1)
    for (const [, n] of g.matchAll(/pulsar\([^\n]*?, '([^']+)'\)/g)) expect(PULSABLES).toContain(n)
    for (const [, n] of g.matchAll(/\['[^']+', '(pestaña [^']+)'\]/g)) expect(PULSABLES).toContain(n)
  })

  it('el workflow: su propio job, desde «despliegue», y el de grabar no corre con «comprobar»', () => {
    const w = readFileSync('.github/workflows/gd-video-qbo.yml', 'utf8')
    expect(w).toMatch(/options: \[ensayo, grabar, comprobar, muestras-voz, video, montar\]/)
    const job = w.slice(w.indexOf('  comprobar:'), w.indexOf('  video:'))
    expect(job).toContain("if: inputs.modo == 'comprobar'")
    expect(job).toContain('environment: despliegue')
    expect(job).toContain('node scripts/video/gd/comprobar.mjs')
    expect(job).not.toContain('video-salida/gd-qbo')
    expect(w.slice(w.indexOf('  grabar:'))).toMatch(/^ {2}grabar:\n {4}if: inputs\.modo == 'ensayo' \|\| inputs\.modo == 'grabar'/)
  })
})
