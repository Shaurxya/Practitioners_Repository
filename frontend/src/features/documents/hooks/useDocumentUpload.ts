import { useMutation } from '@tanstack/react-query'
import { presignUpload } from '../api/documentApi'

/**
 * Phase 9 flow: presign, PUT the file straight to object storage, then confirm.
 * File bytes never pass through the Spring API.
 */
export function useDocumentUpload() {
  return useMutation({
    mutationFn: presignUpload,
  })
}
