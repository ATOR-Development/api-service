import { nodeUrlFromEnv, readView } from './util/ao-read'
import { logger } from './util/logger'

export class OperatorRegistryService {
  private readonly operatorRegistryProcessId: string
  private readonly hbUrl: string

  private operatorRegistryCacheTtlSeconds: number = 0
  private operatorRegistryCacheTimestamp: number = 0
  private operatorRegistryCachedOperators: string[] | null = null

  constructor() {
    logger.info('Initializing OperatorRegistryService...')
    this.operatorRegistryProcessId =
      process.env.OPERATOR_REGISTRY_PROCESS_ID || ''
    if (!this.operatorRegistryProcessId) {
      throw new Error('Missing OPERATOR_REGISTRY_PROCESS_ID!')
    }
    logger.info(
      `Using operator registry process ID [${this.operatorRegistryProcessId}]`
    )

    // Fail closed, no default. Replaces CU_URL/GATEWAY_URL/GRAPHQL_URL, two of which
    // pointed at third-party infrastructure. The outage that forced this migration was
    // caused by endpoints nobody had set explicitly.
    this.hbUrl = nodeUrlFromEnv()
    logger.info(`Reading operator registry from node [${this.hbUrl}]`)

    this.operatorRegistryCacheTtlSeconds =
      parseInt(process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS || '0')
    if (
      isNaN(this.operatorRegistryCacheTtlSeconds) ||
        this.operatorRegistryCacheTtlSeconds < 0
    ) {
      this.operatorRegistryCacheTtlSeconds = 0
      logger.warn(
        `Invalid OPERATOR_REGISTRY_CACHE_TTL_SECONDS ` +
          `[${process.env.OPERATOR_REGISTRY_CACHE_TTL_SECONDS}]. ` +
          `Using default value of 0.`
      )
    }
    logger.info(
      `Using operator registry cache TTL of ` +
        `[${this.operatorRegistryCacheTtlSeconds}] seconds`
    )
    logger.info('OperatorRegistryService initialized.')
  }

  /**
   * Active operator addresses: unique verified, minus blocked.
   *
   * This was a `View-State` dryrun that downloaded all five registry maps so the
   * service could uniq the values of one and difference them against the keys of
   * another. The native contract added the `operators` view for exactly this consumer
   * and does that work on-device, returning a SET (`{[address]: true}`) — already
   * deduped, already filtered. So the whole lodash pipeline collapses into reading the
   * keys, and we stop shipping the claimable/credit/hardware maps over the wire to
   * throw them away.
   */
  private async fetchOperators(): Promise<string[]> {
    const operators = await readView<Record<string, boolean>>(
      this.hbUrl,
      this.operatorRegistryProcessId,
      'operators'
    )

    // NB: Lua serializes an EMPTY table as a JSON array, so an empty registry arrives as
    //     `[]` rather than `{}`. Object.keys handles both, but be explicit about why the
    //     shape can vary.
    return Object.keys(operators)
  }

  async getOperators() {
    const now = Date.now()
    const cacheAge = (now - this.operatorRegistryCacheTimestamp) / 1000
    if (
      !this.operatorRegistryCachedOperators ||
      cacheAge >= this.operatorRegistryCacheTtlSeconds
    ) {
      logger.info(
        'Fetching operator registry state because the cache is empty or expired'
      )
      try {
        this.operatorRegistryCachedOperators = await this.fetchOperators()
        this.operatorRegistryCacheTimestamp = now
        logger.info(`Operator registry state fetched successfully!`)
      } catch (error: Error | any) {
        // Deliberately keep serving the stale list: this backs a public endpoint, and a
        // node blip should degrade to slightly-old data rather than an empty response.
        logger.error(
          `Failed to get Operator Registry State: ${error.message}`,
          error
        )
      }
    } else {
      logger.info(
        `Using cached operator registry state (age: ${cacheAge.toFixed(2)}s)`
      )
    }

    if (!this.operatorRegistryCachedOperators) {
      logger.error('Operator registry state is not available!')
      return []
    }

    logger.info(
      `Found [${this.operatorRegistryCachedOperators.length}] operator addresses`
    )

    return this.operatorRegistryCachedOperators
  }
}
