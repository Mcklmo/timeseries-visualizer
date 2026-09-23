import { describe, expect, it } from 'vitest'
import { DATASET, formatReport, reportQueries } from './usage-report.mjs'

describe('usage report', () => {
  it('queries the dataset the Worker writes, summing sample intervals', () => {
    for (const sql of Object.values(reportQueries(30))) {
      expect(sql).toContain(`FROM ${DATASET}`)
      expect(sql).toContain('SUM(_sample_interval)')
      expect(sql).toContain("INTERVAL '30' DAY")
    }
  })

  it('shows each feature as a share of app page views', () => {
    const report = formatReport(
      {
        daily: [{ day: '2026-09-01 00:00:00', n: '40' }],
        pages: [{ name: '/', n: '200' }, { name: '/about', n: '20' }],
        features: [{ name: 'load:file', n: '120' }, { name: 'format:tcx', n: '3' }],
        devices: [{ name: 'mobile', n: '150' }, { name: 'desktop', n: '50' }],
        countries: [{ name: 'DK', n: '90' }],
        referrers: [],
      },
      30,
    )
    expect(report).toContain('App page views: 200')
    expect(report).toMatch(/load:file\s+120\s+60\.0%/)
    expect(report).toMatch(/format:tcx\s+3\s+1\.5%/)
    expect(report).toMatch(/mobile\s+150\s+75\.0%/)
    expect(report).toContain('2026-09-01')
    expect(report).toContain('(none)')
  })
})
