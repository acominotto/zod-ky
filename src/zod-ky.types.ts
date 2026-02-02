import type * as ky from "ky"
import type { ZodError, ZodType } from "zod"

/** Resolved value of AugmentedResponsePromise (response with parseJson/safeParseJson from the hook). */
export type AugmentedResponse<T = unknown> = ky.KyResponse<T> & {
  parseJson: <U>(schema: ZodType<U>) => Promise<U>
  safeParseJson: <U>(schema: ZodType<U>) => Promise<{ success: true; data: U } | { success: false; error: ZodError }>
}

export type AugmentedResponsePromise<T = unknown> = ky.ResponsePromise<T> & AugmentedResponse<T>

export type AugmentedKyInstance = Omit<
  ky.KyInstance,
  "extend" | "get" | "post" | "put" | "delete" | "patch" | "head" | "options"
> & {
  get: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  post: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  put: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  delete: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  patch: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  head: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  options: <T = unknown>(url: string | URL, options?: ky.Options) => AugmentedResponsePromise<T>
  extend: (
    defaultOptions?: ky.Options | ((parentOptions: ky.Options) => ky.Options)
  ) => AugmentedKyInstance
}
