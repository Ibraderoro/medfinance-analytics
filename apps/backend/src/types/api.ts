export interface ApiErrorShape {
  message: string;
  code: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiErrorShape;
  meta?: Record<string, unknown>;
}
