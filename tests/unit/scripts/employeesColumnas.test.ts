// tests/unit/scripts/employeesColumnas.test.ts
//
// N1 (29/10). La comprobación de scripts/conta/employees-columnas.mjs, contra la
// población REAL (regla 31): las tres migraciones del repositorio que añaden
// una columna a employees (medido el 29/10 sobre las 1.529, con dos lecturas
// distintas: el comprobador y una expresión aparte). Las tres son de antes de
// la 0731 y no dan permiso: hoy las tres pararían. Con su «grant select» o su
// «-- privada:», pasan.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { columnasSinPermiso } from '../../../scripts/conta/employees-columnas.mjs'

type Hallazgo = { columna: string; linea: number }
const leer = (f: string) => readFileSync(`supabase/migrations/${f}`, 'utf8')
const de = (texto: string): Hallazgo[] => columnasSinPermiso(texto)

const PAYROLL = '20260709T1600_payroll_cost.sql'
const AVISO = '20260805T1500_clockout_reminder.sql'
const CUENTA = '20260807T1700_f0_5_a1_add_backfill_account_id_team.sql'

describe('las tres migraciones reales que añaden una columna a employees', () => {
  it('sin permiso, las tres paran, cada una en su línea', () => {
    expect(de(leer(PAYROLL))).toEqual([{ columna: 'employer_ss_annual', linea: 18 }])
    expect(de(leer(AVISO))).toEqual([{ columna: 'forgot_clockout_reminder', linea: 9 }])
    expect(de(leer(CUENTA))).toEqual([{ columna: 'account_id', linea: 4 }])
  })

  it('con su «grant select» para la sesión, pasan', () => {
    expect(de(leer(AVISO) + '\ngrant select (forgot_clockout_reminder) on public.employees to authenticated, anon;\n')).toEqual([])
    expect(de(leer(CUENTA) + '\nGRANT SELECT ("account_id") ON TABLE employees TO authenticated;\n')).toEqual([])
  })

  it('el coste de SS, que la 0731 hizo privado, pasa diciéndolo', () => {
    expect(de(leer(PAYROLL) + '\n-- privada: employees.employer_ss_annual · coste de la empresa; lo lee empleados_datos_privados\n')).toEqual([])
  })

  it('un permiso que no es para la sesión, o el de otra columna, no vale', () => {
    expect(de(leer(AVISO) + '\ngrant select (forgot_clockout_reminder) on public.employees to service_role;\n')).toHaveLength(1)
    expect(de(leer(AVISO) + '\ngrant select (name) on public.employees to authenticated;\n')).toHaveLength(1)
    expect(de(leer(PAYROLL) + '\n-- privada: employees.employer_ss_annual\n')).toHaveLength(1)
  })
})

describe('lo que no es añadir una columna a employees', () => {
  it('la 0731 (cierra la lectura con un execute) y la 0732 (cambia datos) no traen ninguna', () => {
    expect(de(leer('20261029T0731_l1a_columnas_privadas.sql'))).toEqual([])
    expect(de(leer('20261029T0732_l1a_origen_movil.sql'))).toEqual([])
  })
  it('otra tabla que empieza igual, una restricción o un comentario', () => {
    expect(de('alter table public.employee_kiosk_pin add column x text;')).toEqual([])
    expect(de('alter table public.employees add constraint employees_x_check check (true);')).toEqual([])
    expect(de('-- alter table employees add column y text;')).toEqual([])
  })
  it('dentro de un execute dinámico sí se mira', () => {
    expect(de("do $$ begin execute 'alter table public.employees add column if not exists z text'; end $$;")).toEqual([{ columna: 'z', linea: 1 }])
  })
})
