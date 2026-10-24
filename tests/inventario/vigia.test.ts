// tests/inventario/vigia.test.ts
//
// El vigía del autoconteo (scripts/inventario/vigia-autoconteo.mjs). La salida
// de autoconteo_vigia() NO es inventada: vigia-juguete.csv es la que da la
// función de la 0400 en la base de juguete después de una noche con un conteo
// roto (tests/inventario/autoconteo-noche.sh, GUARDAR_VIGIA=…). Los casos del
// cron (succeeded / failed) cambian solo esa fila, con los valores que pone
// pg_cron en cron.job_run_details.status.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { evaluar, enNumeros, leerFilas, leerSinAplicar } from '../../scripts/inventario/vigia-autoconteo.mjs'
import { filtrar } from '../../scripts/conta/lib/salidaSegura.mjs'

const juguete = readFileSync(path.join(__dirname, 'vigia-juguete.csv'), 'utf8')

describe('vigía del autoconteo', () => {
  it('lee la salida real de autoconteo_vigia()', () => {
    const f = leerFilas(juguete)
    expect(Object.keys(f).sort()).toEqual(['cron_estado', 'cron_inicio', 'cron_mensaje', 'sin_aplicar'])
    expect(leerSinAplicar(f.sin_aplicar)).toEqual([
      { codigo: 'J-ROTO', dia: '2026-10-20', estado: 'contando', contadas: 1, conFallo: true },
    ])
  })

  it('en rojo con un autoconteo roto, y lo dice con su código', () => {
    const r = evaluar(leerFilas(juguete))
    expect(r.rojo).toBe(true)
    expect(r.titulo).toBe('1 autoconteo sin aplicar.')
    expect(r.lineas.join('\n')).toContain('| J-ROTO | 2026-10-20 | contando | 1 | sí |')
  })

  it('en rojo si el cron de la noche ha fallado aunque no quede nada', () => {
    const csv = juguete.replace('cron_estado,sin pg_cron', 'cron_estado,failed')
      .replace('cron_mensaje,—', 'cron_mensaje,"Autoconteo de la noche: 1 sin aplicar: INV-1: x"')
      .replace(/sin_aplicar,.*/, 'sin_aplicar,')
    const r = evaluar(leerFilas(csv))
    expect(r.rojo).toBe(true)
    expect(r.titulo).toBe('El cron de la noche ha terminado en rojo.')
    expect(r.lineas[0]).toContain('«Autoconteo de la noche: 1 sin aplicar: INV-1: x»')
  })

  it('en verde con el cron bien y nada esperando, y lo dice (regla 8)', () => {
    const csv = juguete.replace('cron_estado,sin pg_cron', 'cron_estado,succeeded').replace(/sin_aplicar,.*/, 'sin_aplicar,')
    const r = evaluar(leerFilas(csv))
    expect(r.rojo).toBe(false)
    expect(r.titulo).toBe('Todo aplicado: el cron de la noche en verde y ningún autoconteo esperando.')
    expect(r.lineas).toContain('- **Autoconteos sin aplicar:** ninguno.')
  })

  it('antes de la 0400 no hay nada que vigilar, y no se pone en rojo', () => {
    const r = evaluar(leerFilas(''))
    expect(r.rojo).toBe(false)
    expect(r.titulo).toMatch(/Aún no está la 0400/)
  })

  it('el vigía no saca nombres: solo código, día, estado, cuántas y si hay fallo', () => {
    const sql = readFileSync(path.join(__dirname, '../../supabase/migrations/20261129T0400_autoconteo_se_aplica_entero.sql'), 'utf8')
    const cuerpo = sql.slice(sql.indexOf('create function public.autoconteo_vigia()'), sql.indexOf("revoke execute on function public.autoconteo_vigia()"))
    expect(cuerpo).not.toMatch(/recipe_item\b|ri\.name|\.name\b|locations/)
  })

  it('lo que sale al registro público pasa ENTERO por la puerta: solo números, ni códigos ni mensajes', () => {
    const salida = enNumeros(leerFilas(juguete.replace('cron_mensaje,—', 'cron_mensaje,"Faltan motivos en 1 producto: Pan de hamburguesa"')))
    const f = filtrar(salida)
    expect(f.retenidas).toBe(0)
    expect(salida).not.toMatch(/J-ROTO|Pan de hamburguesa/)
    expect(f.filas).toContainEqual({ clave: 'sin_aplicar.con_fallo', valor: '1' })
    expect(f.filas).toContainEqual({ clave: 'rojo', valor: '1' })
  })
})
