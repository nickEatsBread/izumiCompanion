import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('TV navigation loading handoff', () => {
  it('keeps catalogue skeletons mounted until the requested snapshot arrives', () => {
    expect(appSource).toContain('beginNavigationTransition(true)')
    expect(appSource).toContain('if (completedCatalogRequest) finishNavigationTransition()')
  })

  it('uses one compositor sweep instead of animating every skeleton block', () => {
    expect(styles).toMatch(/\.navigation-skeleton::after\s*\{[\s\S]*animation:\s*skeleton-page-sweep/)
    expect(styles).toMatch(/\.skeleton-block\s*\{[\s\S]*?background:\s*#1a1a1a;\s*\}/)
  })
})
