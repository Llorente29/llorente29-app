// Prueba de scripts/lib/limpiarTipos.mjs contra un recorte del tipo REAL que
// genera Supabase (forma de producción, 05/10): una tabla con fill_acc, una
// sin él, una vista envenenadora y una función con el mismo nombre de campo.
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { CON_FILL_ACC, SIN_TIPO, limpiarTipos } from '../../../scripts/lib/limpiarTipos.mjs'

const RAW = `\uFEFFexport type Database = {
  public: {
    Tables: {
      employees: {
        Row: {
          account_id: string
          id: string
        }
        Insert: {
          account_id: string
          id?: string
        }
        Update: {
          account_id?: string
          id?: string
        }
        Relationships: []
      }
      supplier: {
        Row: {
          account_id: string
        }
        Insert: {
          account_id: string
        }
        Update: {
          account_id?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          srid: number
        }
        Insert: {
          srid: number
        }
        Update: {
          srid?: number
        }
        Relationships: []
      }
    }
    Views: {
      goods_receipt_posting_status: {
        Row: {
          goods_receipt_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      crear_algo: {
        Args: { account_id: string }
        Returns: string
      }
    }
  }
}`

describe('limpiarTipos', () => {
  const r = limpiarTipos(RAW)

  it('quita el BOM', () => {
    expect(r.texto.startsWith('export type')).toBe(true)
  })

  it('quita del tipo las tablas y vistas que envenenan la inferencia, y dice cuáles', () => {
    expect(r.quitadas).toEqual(['spatial_ref_sys', 'goods_receipt_posting_status'])
    expect(r.texto).not.toMatch(/spatial_ref_sys|goods_receipt_posting_status|srid/)
  })

  it('account_id opcional SOLO en el Insert de las tablas con fill_acc', () => {
    expect(r.opcionales).toBe(1)
    const employees = r.texto.slice(r.texto.indexOf('employees: {'), r.texto.indexOf('supplier: {'))
    expect(employees).toMatch(/Row: \{\s+account_id: string\n/)
    expect(employees).toMatch(/Insert: \{\s+account_id\?: string\n/)
    const supplier = r.texto.slice(r.texto.indexOf('supplier: {'))
    expect(supplier).toMatch(/Insert: \{\s+account_id: string\n/)
  })

  it('no toca las funciones', () => {
    expect(r.texto).toContain('Args: { account_id: string }')
  })

  it('el resto queda igual, línea a línea', () => {
    expect(r.texto.split('\n').length).toBe(RAW.split('\n').length - 18)
  })

  it('las listas son las medidas en producción', () => {
    expect(CON_FILL_ACC).toHaveLength(15)
    expect(SIN_TIPO).toHaveLength(5)
  })
})
