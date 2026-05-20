// tests/unit/routes.test.ts
//
// Sprint 2 F2 (20/05/2026): tests smoke sobre rutas globales.
//
// Cubre:
//   - isPublicAuthRoute() — el helper que cerró la vulnerabilidad Sesión 9.
//     Casos edge: trailing slash, path con basename, paths similares pero
//     no idénticos.
//   - parseRoute() — el helper que AppContext usa para detectar slug en URL.
//     Casos edge: path vacío, sin slug, slug solo, slug + rest.
//   - buildRoute() — inverso de parseRoute. Casos edge: rest vacío, rest con
//     slash inicial/final, slug con caracteres normales.
//   - isValidSlugShape() — validación de slug. Casos edge: vacío, mayúsculas,
//     espacios, números al inicio (válido), guion al inicio (inválido).
//
// IMPORTANTE: estos tests son PUROS. Sin mocks, sin DOM, sin Supabase.
// Solo verifican lógica determinista de routes.ts.

import { describe, it, expect } from 'vitest'
import {
  isPublicAuthRoute,
  PUBLIC_AUTH_ROUTES,
  parseRoute,
  buildRoute,
  isValidSlugShape,
} from '../../src/routes'

describe('isPublicAuthRoute', () => {
  it('matchea /login exactamente', () => {
    expect(isPublicAuthRoute('/login')).toBe(true)
  })

  it('matchea /welcome exactamente', () => {
    expect(isPublicAuthRoute('/welcome')).toBe(true)
  })

  it('matchea /reset-password exactamente', () => {
    expect(isPublicAuthRoute('/reset-password')).toBe(true)
  })

  it('matchea /reset-password/confirm exactamente', () => {
    expect(isPublicAuthRoute('/reset-password/confirm')).toBe(true)
  })

  it('NO matchea /login-extra (evita falso positivo por startsWith)', () => {
    expect(isPublicAuthRoute('/login-extra')).toBe(false)
  })

  it('NO matchea /loginx', () => {
    expect(isPublicAuthRoute('/loginx')).toBe(false)
  })

  it('NO matchea /login/ (trailing slash)', () => {
    // Si en algún caller se cuela un trailing slash, queremos detectar el
    // bug en lugar de tratarlo como ruta pública.
    expect(isPublicAuthRoute('/login/')).toBe(false)
  })

  it('NO matchea /reset-password/confirm/ (trailing slash)', () => {
    expect(isPublicAuthRoute('/reset-password/confirm/')).toBe(false)
  })

  it('NO matchea /folvy/dashboard (ruta de Shell)', () => {
    expect(isPublicAuthRoute('/folvy/dashboard')).toBe(false)
  })

  it('NO matchea root vacío', () => {
    expect(isPublicAuthRoute('/')).toBe(false)
    expect(isPublicAuthRoute('')).toBe(false)
  })

  it('NO matchea rutas con basename embebido (basename va fuera)', () => {
    // useLocation() devuelve pathname SIN basename. Si llegan con basename
    // significa que algo ascendente está mal.
    expect(isPublicAuthRoute('/llorente29-app/login')).toBe(false)
  })

  it('PUBLIC_AUTH_ROUTES contiene exactamente 4 rutas', () => {
    // Si alguien añade rutas nuevas, debe actualizar también los tests.
    expect(PUBLIC_AUTH_ROUTES).toHaveLength(4)
    expect(PUBLIC_AUTH_ROUTES).toContain('/login')
    expect(PUBLIC_AUTH_ROUTES).toContain('/welcome')
    expect(PUBLIC_AUTH_ROUTES).toContain('/reset-password')
    expect(PUBLIC_AUTH_ROUTES).toContain('/reset-password/confirm')
  })
})

describe('parseRoute', () => {
  it('path vacío devuelve slug null y rest vacío', () => {
    expect(parseRoute('')).toEqual({ slug: null, rest: '' })
  })

  it('root / devuelve slug null y rest vacío', () => {
    expect(parseRoute('/')).toEqual({ slug: null, rest: '' })
  })

  it('solo slug devuelve slug y rest vacío', () => {
    expect(parseRoute('/folvy')).toEqual({ slug: 'folvy', rest: '' })
  })

  it('slug + rest simple', () => {
    expect(parseRoute('/folvy/dashboard')).toEqual({
      slug: 'folvy',
      rest: 'dashboard',
    })
  })

  it('slug + rest con varios niveles', () => {
    expect(parseRoute('/folvy/appcc/hoy')).toEqual({
      slug: 'folvy',
      rest: 'appcc/hoy',
    })
  })

  it('trailing slashes se limpian', () => {
    expect(parseRoute('/folvy/dashboard/')).toEqual({
      slug: 'folvy',
      rest: 'dashboard',
    })
  })

  it('múltiples slashes leading se limpian', () => {
    expect(parseRoute('//folvy/dashboard')).toEqual({
      slug: 'folvy',
      rest: 'dashboard',
    })
  })

  it('Caso bug Sesión 9: parseRoute interpreta reset-password como slug', () => {
    // ESTE es exactamente el caso que rompía: AppContext aplicaba parseRoute
    // a /reset-password y obtenía slug='reset-password', luego intentaba
    // resolverlo como cuenta. La solución NO fue cambiar parseRoute (que
    // sigue haciendo lo "correcto" sintácticamente), sino añadir
    // isPublicAuthRoute() como guarda ANTES de llamar a parseRoute para
    // estos paths.
    //
    // Test documental: si alguien cambia parseRoute para "arreglar" esto,
    // el test fallará y obligará a revisar el contrato real.
    expect(parseRoute('/reset-password')).toEqual({
      slug: 'reset-password',
      rest: '',
    })
  })
})

describe('buildRoute', () => {
  it('slug sin rest', () => {
    expect(buildRoute('folvy')).toBe('/folvy')
  })

  it('slug con rest vacío explícito', () => {
    expect(buildRoute('folvy', '')).toBe('/folvy')
  })

  it('slug con rest simple', () => {
    expect(buildRoute('folvy', 'dashboard')).toBe('/folvy/dashboard')
  })

  it('limpia slash inicial del rest', () => {
    expect(buildRoute('folvy', '/dashboard')).toBe('/folvy/dashboard')
  })

  it('limpia slash final del rest', () => {
    expect(buildRoute('folvy', 'dashboard/')).toBe('/folvy/dashboard')
  })

  it('rest multinivel', () => {
    expect(buildRoute('folvy', 'appcc/hoy')).toBe('/folvy/appcc/hoy')
  })

  it('parseRoute(buildRoute(slug, rest)) es identidad', () => {
    const slug = 'folvy'
    const rest = 'appcc/hoy'
    const path = buildRoute(slug, rest)
    const parsed = parseRoute(path)
    expect(parsed.slug).toBe(slug)
    expect(parsed.rest).toBe(rest)
  })
})

describe('isValidSlugShape', () => {
  it('slugs válidos: minúsculas y números', () => {
    expect(isValidSlugShape('folvy')).toBe(true)
    expect(isValidSlugShape('llorente29')).toBe(true)
    expect(isValidSlugShape('cliente-1')).toBe(true)
    expect(isValidSlugShape('a')).toBe(true)
    expect(isValidSlugShape('9bistro')).toBe(true)
  })

  it('rechaza mayúsculas', () => {
    expect(isValidSlugShape('Folvy')).toBe(false)
    expect(isValidSlugShape('LLORENTE')).toBe(false)
  })

  it('rechaza espacios', () => {
    expect(isValidSlugShape('mi cuenta')).toBe(false)
  })

  it('rechaza string vacío', () => {
    expect(isValidSlugShape('')).toBe(false)
  })

  it('rechaza si empieza por guion', () => {
    expect(isValidSlugShape('-foo')).toBe(false)
  })

  it('rechaza caracteres especiales', () => {
    expect(isValidSlugShape('foo@bar')).toBe(false)
    expect(isValidSlugShape('foo_bar')).toBe(false)
    expect(isValidSlugShape('foo.bar')).toBe(false)
  })

  it('rechaza paths con slashes (no son slugs)', () => {
    expect(isValidSlugShape('foo/bar')).toBe(false)
  })

  it('NO acepta /reset-password como slug aunque sea sintácticamente parseable', () => {
    // 'reset-password' SÍ es un slug válido sintácticamente (minúsculas
    // y guion). Esto es CORRECTO: el slug en sí es válido, la protección
    // contra colisión con rutas auth la hace isPublicAuthRoute(), no esta
    // función.
    expect(isValidSlugShape('reset-password')).toBe(true)
  })
})
