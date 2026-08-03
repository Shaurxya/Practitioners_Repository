/** Mirrors dto/response/ErrorResponse.java. One error shape for the whole API. */
export interface ApiError {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  timestamp: string
}

/** Mirrors Spring Data's Page<T> JSON, which every list endpoint returns. */
export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
}
