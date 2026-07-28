/**
 * Reading contract state off a HyperBEAM node, over plain HTTP.
 *
 * This service only ever READS. Under the D4 design a read is an unsigned GET against the
 * process's own device — no signing, no scheduled message, no new slot — so it needs none of
 * the ANS-104 machinery that @anyone-protocol/ao-client exists to provide. Depending on the
 * client for this pulled in @dha-team/arbundles (7MB: the whole @ethersproject v5 stack,
 * arweave, keccak, secp256k1) alongside the ethers v6 this service already used, to sign
 * nothing. So the read is inlined here instead, and there is no AO dependency to maintain.
 *
 * Keep this file read-only. If a write is ever needed, take the dependency rather than
 * growing a signer here — that is the line the seven divergent send-aos-message.ts copies
 * crossed.
 */
import { logger } from './logger'

/**
 * Read the node URL from the environment, failing closed.
 *
 * There is no default and there must never be one. The outage that forced this migration
 * happened because nothing set the endpoints explicitly and the AO client quietly fell back
 * to third-party infrastructure.
 */
export function nodeUrlFromEnv(varName = 'HB_URL'): string {
  const url = process.env[varName]?.trim()
  if (!url) {
    throw new Error(
      `${varName} is not set. It must point at our HyperBEAM node ` +
        '(e.g. https://hb.anyone.tech). There is deliberately no default.'
    )
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`${varName} must be an absolute http(s) URL, got "${url}"`)
  }
  return url
}

export class AoReadError extends Error {}

/**
 * Invoke a contract view: `GET <node>/<pid>~process@1.0/now/~lua@5.3a/<name>[?params]`.
 * This is the replacement for a legacynet `dryrun` carrying an `Action` tag.
 */
export async function readView<T = unknown>(
  nodeUrl: string,
  processId: string,
  name: string,
  params?: Record<string, string | number>,
  retries = 3
): Promise<T> {
  const query = params && Object.keys(params).length
    ? '?' + new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString()
    : ''
  const url =
    `${nodeUrl.replace(/\/+$/, '')}/${processId}~process@1.0/now/~lua@5.3a/${name}${query}`

  let lastError: Error | undefined

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      logger.debug(`Reading view ${name} from process ${processId}`)
      const response = await fetch(url)

      // Only 5xx is worth retrying — a 404 means the view or process does not exist and
      // will not start existing, so retrying just delays the error by ~6 seconds.
      if (response.status >= 500) {
        throw new AoReadError(
          `node returned ${response.status} reading view "${name}"`
        )
      }
      if (!response.ok) {
        throw new AoReadError(
          `node returned ${response.status} reading view "${name}" ` +
            `(${processId}/now/~lua@5.3a/${name})`
        )
      }

      const body = await response.text()
      try {
        return JSON.parse(body) as T
      } catch {
        // Worth spelling out: a view name that collides with a HyperBEAM process key is
        // shadowed on the read path and silently returns the base value instead.
        throw new AoReadError(
          `view "${name}" did not return JSON (got ${body.slice(0, 120)}). ` +
            'A view name that collides with a HyperBEAM process key is shadowed on the ' +
            'read path and returns the base value instead — check the view name.'
        )
      }
    } catch (error) {
      lastError = error as Error

      const retryable =
        error instanceof AoReadError
          ? /node returned 5\d\d/.test(error.message)
          : true // network-level failure (ECONNREFUSED, DNS, timeout)

      if (!retryable || attempt === retries - 1) { break }

      logger.debug(
        `Retrying view ${name} on process ${processId}`,
        JSON.stringify({ attempt, retries, error: lastError.message })
      )
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 2000))
    }
  }

  throw lastError
}
