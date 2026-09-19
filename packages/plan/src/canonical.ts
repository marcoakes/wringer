/** One canonical-JSON and digest implementation, in `@wringer/records`.
 * Re-exported here because every plan record's hash is that implementation's
 * output, and a second description of it would drift from the first. */
export { canonicalJson, freezeData, hashBytes, hashValue } from "@wringer/records";
