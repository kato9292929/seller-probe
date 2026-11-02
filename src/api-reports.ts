// Entry of the Vercel function api/reports.js (POST /reports). Bundled by `npm run build:api`.
import { handleReport } from "./reports.js";

export const POST = (req: Request) => handleReport(req);
export const OPTIONS = (req: Request) => handleReport(req);
