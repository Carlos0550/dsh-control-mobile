import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { apply, Config, inject, name } from '../src/index.ts'

describe('plugin manifest', () => {
  it('declares the bundle patch and the plugin entry', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('dsh-mission-control')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.entry.name).toBe('dsh-mission-control')
    expect(manifest.entry.inject).toEqual(['webServer', 'connection'])
  })

  it('exposes the cordis plugin surface and its defaults', () => {
    expect(name).toBe('dsh-mission-control')
    expect(inject).toEqual(['webServer', 'connection'])
    expect(typeof apply).toBe('function')
    expect(Config({}).path).toBe('/mission')
    expect(Config({ path: '/otro' }).path).toBe('/otro')
  })
})
