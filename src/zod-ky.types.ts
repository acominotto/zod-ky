import type * as ky from "ky"
import type { ZodError, ZodType } from "zod"

/** Resolved value of AugmentedResponsePromise (response with parseJson/safeParseJson from the hook). */
export type AugmentedResponse<T = unknown> = ky.KyResponse<T> & {
  parseJson: <U>(schema: ZodType<U>) => Promise<U>
  safeParseJson: <U>(schema: ZodType<U>) => Promise<{ success: true; data: U } | { success: false; error: ZodError }>
}

export type AugmentedResponsePromise<T = unknown> = ky.ResponsePromise<T> & AugmentedResponse<T>

export type AugmentedKyInstance = {
  <T = unknown>(input: ky.Input, options?: ky.Options): AugmentedResponsePromise<T>
} & {
  get: <T = unknown>(url: ky.Input, options?: ky.Options) => AugmentedResponsePromise<T>
  post: <T = unknown>(url: ky.Input, options?: ky.Options) => AugmentedResponsePromise<T>
  put: <T = unknown>(url: ky.Input, options?: ky.Options) => AugmentedResponsePromise<T>
  delete: <T = unknown>(url: ky.Input, options?: ky.Options) => AugmentedResponsePromise<T>
  patch: <T = unknown>(url: ky.Input, options?: ky.Options) => AugmentedResponsePromise<T>
  head: (url: ky.Input, options?: ky.Options) => AugmentedResponsePromise
  options: <T = unknown>(url: ky.Input, options?: ky.Options) => AugmentedResponsePromise<T>
  extend: (
    defaultOptions?: ky.Options | ((parentOptions: ky.Options) => ky.Options)
  ) => AugmentedKyInstance
  create: (options: ky.Options) => AugmentedKyInstance
} & Pick<ky.KyInstance, "stop" | "retry">
