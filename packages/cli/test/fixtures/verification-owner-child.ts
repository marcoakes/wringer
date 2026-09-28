import { createVerificationOwner } from "../../src/verification-owner";
await createVerificationOwner(process.argv[2]!, process.argv[3]!);
process.stdout.write("ready\n");
await new Promise(() => {});
