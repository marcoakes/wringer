import { withMaintenanceLock } from "../src/maintenance";
await withMaintenanceLock(process.argv[2]!, async () => { process.stdout.write("locked\n"); await new Promise(() => {}); });
