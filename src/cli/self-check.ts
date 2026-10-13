import "dotenv/config";
import { makePayer } from "../pay.js";
import { selfCheck } from "../self-check.js";

const results = await selfCheck(await makePayer());
for (const r of results) console.log(JSON.stringify({ target: r.target, replay: r.replay, cache: r.cache, tx: (r.paid as any)?.tx }));
