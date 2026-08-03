import { useQuery } from '@tanstack/react-query'
import { lookupImmortalId } from '../api/publicVerifyApi'

export function usePublicVerification(immortalId: string) {
  return useQuery({
    queryKey: ['public-verify', immortalId],
    queryFn: () => lookupImmortalId(immortalId),
    enabled: immortalId.length > 0,
    // The backend caches this too. No point hammering it from the client.
    staleTime: 60_000,
  })
}
