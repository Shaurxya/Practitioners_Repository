import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/registryImportApi'
import { RUNNING_STATUSES } from '../types'
import type {
  ImportBatchDetail,
  MappingConfirmation,
  PromoteRequest,
  RegistryFilter,
  RowCorrection,
  StagingFilter,
} from '../types'

/**
 * Progress: the browser polls Spring, and the sidecar pushes to Spring.
 *
 * Why not have the browser poll the extraction service directly: it is not
 * reachable from the browser by design, and Spring has to persist progress
 * against the batch anyway so the report survives a page reload.
 *
 * Why the sidecar pushes rather than Spring polling it: only the sidecar knows
 * page 173 just finished, and a 400 page OCR run would otherwise mean Spring
 * polling a busy service every few seconds for half an hour to learn nothing.
 * The cost of push is lost callbacks, which is what the heartbeat watchdog on
 * import_batch exists to catch.
 *
 * Two second interval while work is running, off otherwise. Polling a finished
 * batch is the sort of thing nobody notices until there are fifty tabs open.
 */
const RUNNING_POLL_MS = 2000

export function useBatches(page: number) {
  return useQuery({
    queryKey: ['import-batches', page],
    queryFn: () => api.fetchBatches(page),
    placeholderData: (previous) => previous,
    // The list shows live progress counts too, so it refreshes while anything
    // anywhere is running. Cheap: one query, page of 25.
    refetchInterval: (query) =>
      (query.state.data?.content ?? []).some((b) => RUNNING_STATUSES.includes(b.status))
        ? RUNNING_POLL_MS
        : false,
  })
}

export function useBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: ['import-batch', batchId],
    queryFn: () => api.fetchBatch(batchId as string),
    enabled: Boolean(batchId),
    refetchInterval: (query) =>
      query.state.data && RUNNING_STATUSES.includes(query.state.data.status)
        ? RUNNING_POLL_MS
        : false,
  })
}

export function useBatchPages(batchId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['import-batch-pages', batchId],
    queryFn: () => api.fetchPages(batchId as string),
    enabled: Boolean(batchId) && enabled,
  })
}

export function useCreateBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createBatch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import-batches'] })
    },
  })
}

/**
 * Every lifecycle action returns the whole batch, so the cache is seeded from
 * the response rather than invalidated and refetched. One round trip, and the
 * screen never flashes through a loading state on a button press.
 */
function useBatchAction(
  batchId: string | undefined,
  fn: (id: string) => Promise<ImportBatchDetail>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => fn(batchId as string),
    onSuccess: (batch) => {
      queryClient.setQueryData(['import-batch', batchId], batch)
      void queryClient.invalidateQueries({ queryKey: ['import-batches'] })
    },
  })
}

export const useStartClassification = (id: string | undefined) =>
  useBatchAction(id, api.startClassification)
export const useStartExtraction = (id: string | undefined) =>
  useBatchAction(id, api.startExtraction)
export const useCancelBatch = (id: string | undefined) => useBatchAction(id, api.cancelBatch)
export const useRetryExtraction = (id: string | undefined) =>
  useBatchAction(id, api.retryExtraction)
export const useRecomputeDiff = (id: string | undefined) => useBatchAction(id, api.recomputeDiff)

export function useMapping(batchId: string | undefined) {
  return useQuery({
    queryKey: ['import-mapping', batchId],
    queryFn: () => api.fetchMapping(batchId as string),
    enabled: Boolean(batchId),
  })
}

export function useConfirmMapping(batchId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MappingConfirmation) => api.confirmMapping(batchId as string, body),
    onSuccess: (batch) => {
      queryClient.setQueryData(['import-batch', batchId], batch)
      void queryClient.invalidateQueries({ queryKey: ['parser-profiles'] })
    },
  })
}

export function useStaging(batchId: string | undefined, filter: StagingFilter) {
  return useQuery({
    queryKey: ['import-staging', batchId, filter],
    queryFn: () => api.fetchStaging(batchId as string, filter),
    enabled: Boolean(batchId),
    placeholderData: (previous) => previous,
  })
}

/**
 * Not optimistic, same reasoning as useDecideCase in admin-review: the server
 * re-normalizes the corrected value and recomputes whether the row still needs
 * confirmation, so the row that comes back is not the row the browser would
 * have guessed. Showing a guess and then correcting it is worse than 200ms.
 */
export function useCorrectRow(batchId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { rowId: string; corrections: RowCorrection[] }) =>
      api.correctRow(batchId as string, input.rowId, input.corrections),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import-staging', batchId] })
      // The batch's "rows still needing confirmation" count moved.
      void queryClient.invalidateQueries({ queryKey: ['import-batch', batchId] })
      void queryClient.invalidateQueries({ queryKey: ['accuracy'] })
    },
  })
}

export function useConfirmRow(batchId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rowId: string) => api.confirmRow(batchId as string, rowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import-staging', batchId] })
      void queryClient.invalidateQueries({ queryKey: ['import-batch', batchId] })
    },
  })
}

export function useRejects(batchId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['import-rejects', batchId],
    queryFn: () => api.fetchRejects(batchId as string),
    enabled: Boolean(batchId) && enabled,
  })
}

export function usePromoteBatch(batchId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PromoteRequest) => api.promoteBatch(batchId as string, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import-batch', batchId] })
      void queryClient.invalidateQueries({ queryKey: ['import-batches'] })
    },
  })
}

export function useProfiles() {
  return useQuery({ queryKey: ['parser-profiles'], queryFn: api.fetchProfiles })
}

/** Reference data, changes at the rate of migrations. Cached for the session. */
export function useCouncils() {
  return useQuery({
    queryKey: ['councils'],
    queryFn: api.fetchCouncils,
    staleTime: Infinity,
  })
}

/**
 * The registry browser. placeholderData keeps the previous page on screen while
 * the next one loads, so paging does not flash an empty table.
 */
export function useRegistry(filter: RegistryFilter) {
  return useQuery({
    queryKey: ['registry', filter],
    queryFn: () => api.fetchRegistry(filter),
    placeholderData: (previous) => previous,
  })
}

export function useRegistrySummary() {
  return useQuery({ queryKey: ['registry-summary'], queryFn: api.fetchRegistrySummary })
}

export function useAccuracy() {
  return useQuery({ queryKey: ['accuracy'], queryFn: api.fetchAccuracy })
}
