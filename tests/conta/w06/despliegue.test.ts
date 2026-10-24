// W06 (Julio, 22/10) · Los dos fallos de hoy, y que no se repitan.
//   1. bb7d2e24 arregló la prueba de staging de la 0470 sin tocar el manifiesto
//      y no se ensayó; y el commit del robot de capturas (con el token de
//      Actions, que no lanza workflows) se quedó como último de la rama, sin ensayo.
//   2. El #285 solo cambió _shared y el despliegue no redesplegó a nadie:
//      conta-diez-enviar y conta-diez-cola siguieron con el código de antes.
// Contra lo de verdad (regla 31): las fusiones de hoy y lo desplegado de
// conta-recibida-pdf tal como lo devolvió producción.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { funcionesDelPush } from '../../../scripts/pr/funciones-del-push.mjs'
import { comparar, rutaEnFunciones } from '../../../scripts/pr/comparar-desplegada.mjs'
import { ficherosDeFuncion, importaDeFunciones } from '../../../scripts/pr/importsDeFunciones.mjs'

const diff = (a: string, b: string) => execFileSync('git', ['diff', '--name-only', a, b, '--', 'supabase/functions'], { encoding: 'utf8' }).split('\n').filter(Boolean)

describe('qué se despliega por un push', () => {
  it('el #285 (solo _shared) despliega las dos funciones de Diez que lo usan', () => {
    expect(diff('29f17ac5', '2f07b012').every((f) => f.startsWith('supabase/functions/_shared/'))).toBe(true)
    // C12 (24/10): con el árbol de hoy, ese _shared también lo usa conta-diez-traspaso (importa diezDespacho).
    expect(funcionesDelPush(diff('29f17ac5', '2f07b012'))).toEqual(['conta-diez-cola', 'conta-diez-enviar', 'conta-diez-traspaso'])
  })
  it('el #288 (una función nueva y dos _shared nuevos que solo usa ella) despliega esa', () => {
    expect(funcionesDelPush(diff('58a3efbc', 'deb7b12a'))).toEqual(['conta-recibida-pdf'])
  })
  it('el caso del #181: cambiar diezCliente.ts despliega conta-diez-enviar (y las demás que lo usan)', () => {
    const f = funcionesDelPush(['supabase/functions/_shared/diezCliente.ts'])
    expect(f).toContain('conta-diez-enviar')
    expect(f).toContain('conta-diez-cola')
    for (const fn of f) expect(importaDeFunciones()[fn], fn).toContain('supabase/functions/_shared/diezCliente.ts')
  })
  it('una función borrada no se despliega; un fichero fuera de supabase/functions, tampoco', () => {
    expect(funcionesDelPush(['supabase/functions/vieja/index.ts'], {}, () => false)).toEqual([])
    expect(funcionesDelPush(['src/main.tsx'], {})).toEqual([])
  })
  it('los ficheros de una función: su carpeta y lo que importa, también indirectamente', () => {
    expect(ficherosDeFuncion('conta-recibida-pdf')).toEqual([
      'supabase/functions/_shared/imagenAPdf.ts', 'supabase/functions/_shared/recibidaPdf.ts', 'supabase/functions/conta-recibida-pdf/index.ts',
    ])
  })
})

describe('lo desplegado contra el repositorio', () => {
  const repo = (r: string) => { try { return readFileSync(`supabase/functions/${r}`) } catch { return null } }
  const usa = ficherosDeFuncion('conta-recibida-pdf').map((f) => f.slice('supabase/functions/'.length))
  const bajado = () => new Map(usa.map((u) => [u, readFileSync(`supabase/functions/${u}`)]))
  it('la ruta dentro de supabase/functions, venga como venga la bajada', () => {
    expect(rutaEnFunciones('supabase/functions/x/index.ts')).toBe('x/index.ts')
    expect(rutaEnFunciones('home/runner/work/a/a/supabase/functions/_shared/b.ts')).toBe('_shared/b.ts')
    expect(rutaEnFunciones('functions/_shared/b.ts')).toBe('_shared/b.ts')
    expect(rutaEnFunciones('./x/index.ts')).toBe('x/index.ts')
  })
  it('igual, fichero a fichero (los tres de conta-recibida-pdf, como quedaron en producción el 22/10)', () => {
    const r = comparar('conta-recibida-pdf', bajado(), repo, usa)
    expect(r).toEqual({ bien: true, lineas: ['  igual _shared/imagenAPdf.ts', '  igual _shared/recibidaPdf.ts', '  igual conta-recibida-pdf/index.ts'] })
  })
  it('un fichero distinto, uno que falta, uno que sobra o nada bajado: en rojo, y dice cuál', () => {
    const b = bajado(); b.set('_shared/recibidaPdf.ts', Buffer.from('// otra cosa'))
    expect(comparar('conta-recibida-pdf', b, repo, usa)).toMatchObject({ bien: false, lineas: expect.arrayContaining(['  DIFIERE _shared/recibidaPdf.ts']) })
    const f = bajado(); f.delete('_shared/imagenAPdf.ts')
    expect(comparar('conta-recibida-pdf', f, repo, usa).lineas).toContain('  FALTA _shared/imagenAPdf.ts (la función lo usa y no está desplegado)')
    const s = bajado(); s.set('_shared/viejo.ts', Buffer.from('x'))
    expect(comparar('conta-recibida-pdf', s, repo, usa).lineas).toContain('  SOBRA _shared/viejo.ts (desplegado, y no está en el repositorio)')
    expect(comparar('conta-recibida-pdf', new Map(), repo, usa).bien).toBe(false)
  })
})

describe('los workflows', () => {
  const aplicar = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
  const e2e = readFileSync('.github/workflows/e2e-staging-conta.yml', 'utf8')
  const desplegar = readFileSync('.github/workflows/deploy-edge-functions.yml', 'utf8')
  it('el ensayo de staging se lanza también cuando cambia un fichero de la tanda, no solo el manifiesto', () => {
    const paths = aplicar.slice(aplicar.indexOf('  push:'), aplicar.indexOf('  workflow_dispatch:'))
    for (const p of ['supabase/staging/aplicar.txt', 'supabase/migrations/**', 'supabase/staging/sql/**', 'supabase/vuelta-atras/**', 'scripts/conta/staging-tanda.mjs']) expect(paths).toContain(`'${p}'`)
    // bb7d2e24 solo tocó la prueba de staging: con esto, se habría ensayado.
    const tocados = execFileSync('git', ['show', '--name-only', '--format=', 'bb7d2e24'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(tocados).toEqual(['supabase/staging/sql/20261203_d02_recibida_pdf_prueba.sql'])
  })
  it('después de su commit, el robot de capturas lanza el ensayo sobre ese commit si la rama trae tanda', () => {
    const paso = e2e.slice(e2e.indexOf('- name: Capturas · fijar las del frente en la rama'))
    const fin = paso.indexOf('\n  # ')
    const cuerpo = paso.slice(0, fin)
    expect(cuerpo).toMatch(/git push origin "HEAD:\$GITHUB_REF_NAME"[\s\S]*staging-tanda\.mjs nuevas origin\/main[\s\S]*gh workflow run aplicar-staging-conta\.yml[^\n]*--ref "\$GITHUB_REF_NAME" -f modo=aplicar/)
    expect(cuerpo).toContain('GH_TOKEN: ${{ github.token }}')
    expect(e2e).toMatch(/permissions:[\s\S]*actions: write/)
  })
  it('el despliegue usa la misma lista que pr-a-main (con _shared) y compara lo desplegado, fichero a fichero', () => {
    expect(desplegar).toContain('node scripts/pr/funciones-del-push.mjs "$ANTES" "${{ github.sha }}"')
    expect(desplegar).not.toMatch(/awk -F\/ 'NF>=3 \{print \$3\}'/)
    const comprobar = readFileSync('scripts/pr/comprobar-desplegadas.mjs', 'utf8')
    expect(comprobar).toContain("['functions', 'download', fn, '--project-ref', ref, '--use-api']")
    expect(comprobar).toContain("import { comparar, rutaEnFunciones } from './comparar-desplegada.mjs'")
    expect(desplegar).toContain('node scripts/pr/comprobar-desplegadas.mjs "$REF" "$RUNNER_TEMP/desplegadas.md" $FUNCIONES 2>&1 | node scripts/conta/salida-segura.mjs')
    // La comprobación va DESPUÉS de desplegar, y su detalle sube como artefacto.
    expect(desplegar.indexOf('comprobar-desplegadas.mjs')).toBeGreaterThan(desplegar.indexOf('supabase functions deploy'))
    expect(desplegar).toContain('name: desplegadas')
    expect(readFileSync('scripts/pr/revisar-pr.mjs', 'utf8')).toContain("import { importaDeFunciones } from './importsDeFunciones.mjs'")
  })
})
