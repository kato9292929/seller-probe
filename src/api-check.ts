// Entry of the Vercel function api/check.js (GET /check?url=…). Bundled by `npm run build:api`;
// api/check.js is committed so the deployment does not depend on how Vercel compiles TypeScript.
import { handleCheck } from "./check.js";

export const GET = (req: Request) => handleCheck(req);
