/** A TCP handshake only. No application payload, HTTP request, key, or model. */
import { isIP } from "node:net";
const [address, textPort] = process.argv.slice(2), port = Number(textPort);
if (!address || isIP(address) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) throw Error("Expected IPv4 address and TCP port");
const deadline = setTimeout(() => { console.log("TCP_HANDSHAKE_TIMEOUT"); process.exit(3); }, 3000);
try {
  const socket = await Bun.connect({ hostname: address, port, socket: { open(socket) { socket.end(); }, data() {} } });
  clearTimeout(deadline);
  console.log("TCP_HANDSHAKE_CONNECTED");
  socket.end();
} catch { clearTimeout(deadline); console.log("TCP_HANDSHAKE_REFUSED"); process.exitCode = 3; }
