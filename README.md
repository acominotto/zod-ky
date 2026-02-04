# zod-ky

Zod-based typed [ky](https://github.com/sindresorhus/ky): a drop-in ky instance that adds `parseJson` and `safeParseJson` to every response so you can validate JSON with Zod schemas.

## Install

```bash
pnpm add zod-ky zod
# or
npm install zod-ky zod
```

**Peer dependencies:** `zod` >=4.3.6

## Usage

```ts
import { ky } from "zod-ky";
import { z } from "zod";

const UserSchema = z.object({ id: z.number(), name: z.string() });
type User = z.infer<typeof UserSchema>;

// parseJson: validates and returns typed data, throws ZodError on failure
const user = await ky.get("https://api.example.com/user").parseJson(UserSchema);
// user: User

// safeParseJson: returns { success: true, data } or { success: false, error }
const result = await ky
  .get("https://api.example.com/user")
  .safeParseJson(UserSchema);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error);
}
```

## extend()

`ky` from zod-ky supports `extend()`; extended instances keep `parseJson` and `safeParseJson` on responses.

```ts
import { ky } from "zod-ky";
import { z } from "zod";

const api = ky.extend({ prefixUrl: "https://api.example.com" });
const schema = z.object({ title: z.string() });

const data = await api.get("/post/1").then((res) => res.parseJson(schema));
```

## API

- **`ky`** – Augmented ky instance (same as ky: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `extend`).
- **`response.parseJson(schema)`** – Parses response JSON and validates with the Zod schema. Returns typed data or throws `ZodError`.
- **`response.safeParseJson(schema)`** – Same as above but returns `{ success: true, data: T }` or `{ success: false, error: ZodError }`.
- **`HTTPError`** – Re-exported from ky for error handling.

## License

ISC
