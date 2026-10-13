import "dotenv/config";
import { refreshRfqSnapshot } from "../rfq.js";

const s = await refreshRfqSnapshot();
console.log(`rfq snapshot: ${s.status} ${s.fetched_at ?? ""} sellers=${s.sellers.length}${s.note ? ` (${s.note})` : ""}`);
