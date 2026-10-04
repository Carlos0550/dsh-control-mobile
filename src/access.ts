/** What the cockpit knows about how it is reached. */
export interface AccessReport {
  mode: 'tailnet' | 'public' | 'loopback'
  hostname?: string
  declared: boolean
}

/** Access diagnostics and the loopback-only login URL. */
export interface AccessService {
  describe(): AccessReport
  loginUrl(isLoopback: boolean): string | undefined
}

/**
 * Create the access service.
 * @param deps - listening port, configured public host, URL authenticator and declared authorities.
 * @returns the service.
 */
export function createAccess(deps: {
  port: number
  publicHost: string
  authenticatedUrl: (url: string) => string
  trustedHosts: readonly string[]
}): AccessService {
  const local = `http://127.0.0.1:${deps.port}`
  return {
    describe() {
      if (deps.publicHost === '') {
        return { mode: 'loopback', declared: true }
      }
      return {
        mode: deps.publicHost.endsWith('.ts.net') ? 'tailnet' : 'public',
        hostname: deps.publicHost,
        declared: deps.trustedHosts.includes(deps.publicHost),
      }
    },
    loginUrl(isLoopback) {
      if (!isLoopback) return undefined
      const base = deps.publicHost === '' ? local : `https://${deps.publicHost}`
      return deps.authenticatedUrl(base)
    },
  }
}
