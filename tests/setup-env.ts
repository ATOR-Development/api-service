/**
 * src/app.ts constructs OperatorRegistryService at module scope, and that constructor fails
 * closed on both a missing process id and a missing HB_URL — so merely importing the app (as
 * app.test.ts does, to exercise the VictoriaMetrics routes) needs both present.
 *
 * These placeholders only fill in what is absent, so real values passed by the operator still
 * win. Nothing here should ever reach a network: the integration tests decide whether a real
 * node is available by checking that the process id is a genuine 43-char AO id, not by
 * checking that the vars merely exist.
 */
export const PLACEHOLDER_PROCESS_ID = 'placeholder-process-id-for-tests'

process.env.OPERATOR_REGISTRY_PROCESS_ID =
  process.env.OPERATOR_REGISTRY_PROCESS_ID || PLACEHOLDER_PROCESS_ID
process.env.HB_URL = process.env.HB_URL || 'http://placeholder.invalid'
