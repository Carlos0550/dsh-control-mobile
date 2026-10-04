import { describe, expect, it } from 'vitest'
import { createAccess } from '../src/access.ts'

const deps = (publicHost: string, port = 3080) => ({
  port,
  publicHost,
  authenticatedUrl: (url: string) => `${url}/?token=tok-123`,
  trustedHosts: publicHost === '' ? [] : [publicHost],
})

describe('createAccess', () => {
  it('en modo loopback no hay URL de login remota', () => {
    const access = createAccess(deps(''))
    expect(access.describe()).toMatchObject({ mode: 'loopback', declared: true })
    expect(access.loginUrl(true)).toContain('token=tok-123')
    expect(access.loginUrl(false)).toBeUndefined()
  })

  it('con publicHost declarado, el modo es tailnet y la URL usa ese host', () => {
    const access = createAccess(deps('equipo.tailnet.ts.net'))
    expect(access.describe()).toMatchObject({ mode: 'tailnet', hostname: 'equipo.tailnet.ts.net', declared: true })
    expect(access.loginUrl(true)).toBe('https://equipo.tailnet.ts.net/?token=tok-123')
  })

  it('avisa cuando el hostname público no está en trustedHosts', () => {
    const access = createAccess({ ...deps('equipo.tailnet.ts.net'), trustedHosts: [] })
    expect(access.describe().declared).toBe(false)
  })
})
