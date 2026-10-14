// D01 · R2 punto 1 · La comprobación de antes-de-subir: un workflow que lee
// producción o Diez solo saca números y huellas. Con trozos reales de los
// workflows del repositorio.
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { revisar } from '../../../scripts/conta/workflows-salida.mjs'

const conDiez = (run: string) => `jobs:\n  prueba:\n    steps:\n      - name: x\n        env:\n          DIEZ_LECTURA: \${{ secrets.DIEZ_LECTURA }}\n        run: |\n${run.split('\n').map((l) => `          ${l}`).join('\n')}\n`

describe('workflows-salida', () => {
  it('el paso de diez-prueba-c0009 tal como estaba en main (el del run 60) no pasa', () => {
    const f = revisar(conDiez('npx --yes tsx@4.19.2 "$S" | tee prueba.md\ncat prueba.md >> "$GITHUB_STEP_SUMMARY"'))
    expect(f.length).toBe(2)
    expect(f[0]).toMatch(/corre npx --yes tsx/)
    expect(f[1]).toMatch(/GITHUB_STEP_SUMMARY sin pasar/)
  })
  it('por la puerta de salida, sí', () => {
    expect(revisar(conDiez('npx --yes tsx@4.19.2 "$S" 2>&1 | node scripts/conta/salida-segura.mjs | tee -a "$GITHUB_STEP_SUMMARY"'))).toEqual([])
  })
  it('a un fichero, un literal, una máscara y el tamaño de un fichero, sí', () => {
    expect(revisar(conDiez([
      'psql "$RO_DB_URL" -X -A -t -c "select 1" > /tmp/asiento.json',
      'echo "Asiento leído ($(wc -c < /tmp/asiento.json) bytes; no se publica)."',
      'echo "::add-mask::$v"',
      'echo "## Diez" >> "$GITHUB_STEP_SUMMARY"',
    ].join('\n')))).toEqual([])
  })
  it('psql al registro, un echo de una variable o un print con f-string de Python, no', () => {
    const f = revisar(conDiez([
      'psql "$RO_DB_URL" -X -A -t -c "select name from supplier"',
      'echo "Proveedor: $NOMBRE"',
      "python3 - <<'PY'",
      'print(f"leído {fila}")',
      'PY',
    ].join('\n')))
    expect(f.length).toBe(3)
  })
  it('un workflow que no lee producción ni Diez (staging) no se mira', () => {
    expect(revisar('jobs:\n  a:\n    steps:\n      - env:\n          DB_URL: ${{ secrets.STAGING_CONTA_DB_URL }}\n          PROD_REF: xzmpnchlguibclvxyynt\n        run: psql "$DB_URL" -c "select 1"\n')).toEqual([])
  })
  it('las variables declaradas del repositorio (nombres de fichero, md5) pueden salir', () => {
    const y = '# salida-segura · variables del repositorio: f md5\n' + conDiez('echo "OK $f ($md5)"\necho "Leído $NOMBRE"')
    expect(revisar(y)).toEqual([expect.stringMatching(/echo con variables/)])
  })
})
