/**
 * INTEGRATION test — reads a real operator-registry process on a real HyperBEAM node.
 * No mocks: the point is to prove the `operators` view actually returns what /operators
 * used to compute client-side.
 *
 * Requires:
 *   HB_URL                          e.g. http://localhost:8734
 *   OPERATOR_REGISTRY_PROCESS_ID    a process spawned from an operator-registry module
 *
 * To stand one up locally see smart-contracts/ao/scripts/run-e2e.ts, which publishes the
 * pure-source module into a node container and spawns it with the migration seed.
 */
import { getAddress } from 'ethers'

import { OperatorRegistryService } from '../src/operator-registry.service'

// tests/setup-env.ts fills both vars with placeholders so importing src/app.ts does not
// throw, so "is it set" cannot tell us whether a real node is reachable. A genuine AO
// process id is 43 base64url chars; the placeholder is not.
const HAVE_NODE = /^[A-Za-z0-9_-]{43}$/
  .test(process.env.OPERATOR_REGISTRY_PROCESS_ID || '')
const itNode = HAVE_NODE ? it : it.skip

describe('OperatorRegistryService', () => {
  it('fails closed when HB_URL is unset', () => {
    const saved = process.env.HB_URL
    const savedPid = process.env.OPERATOR_REGISTRY_PROCESS_ID
    delete process.env.HB_URL
    // The process-id check runs first, so it has to pass for this to reach the URL check.
    process.env.OPERATOR_REGISTRY_PROCESS_ID =
      savedPid || 'placeholder-process-id-for-tests'
    try {
      // There is deliberately no default node URL. The outage that forced this migration
      // happened because unset endpoints silently fell back to third-party infrastructure.
      expect(() => new OperatorRegistryService()).toThrow(/HB_URL is not set/)
    } finally {
      if (saved !== undefined) { process.env.HB_URL = saved }
    }
  })

  it('fails closed when the process id is unset', () => {
    const saved = process.env.OPERATOR_REGISTRY_PROCESS_ID
    delete process.env.OPERATOR_REGISTRY_PROCESS_ID
    try {
      expect(() => new OperatorRegistryService())
        .toThrow(/Missing OPERATOR_REGISTRY_PROCESS_ID/)
    } finally {
      if (saved !== undefined) { process.env.OPERATOR_REGISTRY_PROCESS_ID = saved }
    }
  })

  itNode('reads active operator addresses from the `operators` view', async () => {
    const service = new OperatorRegistryService()
    const operators = await service.getOperators()

    expect(Array.isArray(operators)).toBe(true)
    expect(operators.length).toBeGreaterThan(0)

    // The view returns a SET keyed by address, so dedup is a property of the shape rather
    // than something the service does. This is what replaced the `_.uniq` client-side.
    expect(new Set(operators).size).toBe(operators.length)

    // Addresses are EIP-55 post-migration, not legacynet `0x`+ALLCAPS. getAddress is the
    // oracle: a canonical address is its own checksum. If the migration had left these
    // uppercased, every one of these would fail.
    for (const address of operators) {
      expect(address).toBe(getAddress(address))
    }
  }, 60_000)

  itNode('serves from cache within the TTL rather than re-reading', async () => {
    const saved = process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS
    process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS = '600'
    try {
      const service = new OperatorRegistryService()
      const first = await service.getOperators()

      // A cached call must not touch the node at all. Reads cost ~0.5s against a real
      // process, so a second call returning near-instantly AND identically is the signal.
      const started = Date.now()
      const second = await service.getOperators()
      expect(Date.now() - started).toBeLessThan(50)
      expect(second).toEqual(first)
    } finally {
      if (saved === undefined) {
        delete process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS
      } else {
        process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS = saved
      }
    }
  }, 60_000)

  itNode('keeps serving the last good list when the node is unreachable', async () => {
    const saved = process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS
    process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS = '0'
    try {
      const service = new OperatorRegistryService()
      const good = await service.getOperators()
      expect(good.length).toBeGreaterThan(0)

      // Make the next read fail and expire the cache. /operators is a public endpoint, so a
      // node blip must degrade to slightly-stale data, never to an empty list — an empty
      // list reads as "every operator left the network".
      ;(service as any).fetchOperators =
        () => Promise.reject(new Error('connect ECONNREFUSED'))
      const stale = await service.getOperators()
      expect(stale).toEqual(good)
    } finally {
      if (saved === undefined) {
        delete process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS
      } else {
        process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS = saved
      }
    }
  }, 60_000)
})
