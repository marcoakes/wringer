// The harness remains Bun/TypeScript. This small OS adapter supplies only native
// decision display and Secure Enclave signing; it never runs an agent or a job.
import AppKit
import CryptoKit
import Darwin
import Foundation
import LocalAuthentication
import Security

let installedBinary = "/Library/Application Support/Wringer/bin/wringer-confirm"
let controllerPin = "/Library/Application Support/Wringer/confirmation/controller-public-key.bin"
let signingPolicy = "/Library/Application Support/Wringer/confirmation/signing-policy.json"
let keyTag = Data("com.wringer.confirmation.biometry-current-set.v1".utf8)
enum Refusal: Error { case stopped(String) }
func insist(_ condition: Bool, _ message: String) throws { if !condition { throw Refusal.stopped(message) } }
func emit(_ value: [String: Any]) { let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); print(String(data: data, encoding: .utf8)!) }
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func text(_ value: Any?, _ label: String) throws -> String { guard let string = value as? String else { throw Refusal.stopped("Missing \(label)") }; return string }
func object(_ value: Any?, _ fields: Set<String>) throws -> [String: Any] {
    guard let row = value as? [String: Any], Set(row.keys) == fields else { throw Refusal.stopped("Unexpected confirmation fields") }; return row
}
func data64(_ value: Any?, _ max: Int) throws -> Data {
    let encoded = try text(value, "encoded data")
    guard encoded.utf8.count <= max * 2, let data = Data(base64Encoded: encoded), data.count <= max, data.base64EncodedString() == encoded else { throw Refusal.stopped("Invalid or oversized encoded data") }; return data
}
func readBoundedInput() throws -> Data {
    var data = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: 8192), !chunk.isEmpty {
        data.append(chunk); try insist(data.count < 300_000, "Oversized decision")
    }
    try insist(!data.isEmpty, "Missing decision")
    // One framed envelope only. No file paths, commands or arbitrary URLs.
    return data
}
func requireNoExtendedAcl(_ path: String) throws {
    // acl_get_file can report ENOENT on a present sealed-system-volume path.
    // Do not reinterpret that error as protection. Use the fixed OS metadata
    // reader, with the same conservative no-ACL policy as the Bun inspector.
    let task = Process(), output = Pipe()
    task.executableURL = URL(fileURLWithPath: "/bin/ls")
    task.arguments = ["-lde", path]
    task.environment = ["PATH": "/usr/bin:/bin", "LC_ALL": "C"]
    task.standardInput = FileHandle.nullDevice
    task.standardOutput = output
    task.standardError = FileHandle.nullDevice
    try task.run()
    defer {
        if task.isRunning { kill(task.processIdentifier, SIGKILL); task.waitUntilExit() }
        try? output.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
    }
    try output.fileHandleForWriting.close()
    let fd = output.fileHandleForReading.fileDescriptor
    let flags = fcntl(fd, F_GETFL)
    try insist(flags >= 0 && fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0, "Protected file ACL reader is unavailable")
    let deadline = ProcessInfo.processInfo.systemUptime + 2
    var data = Data(), buffer = [UInt8](repeating: 0, count: 8192), ended = false
    while !ended || task.isRunning {
        try insist(ProcessInfo.processInfo.systemUptime < deadline, "Protected file ACL inspection timed out")
        let count = read(fd, &buffer, buffer.count)
        if count > 0 {
            data.append(contentsOf: buffer.prefix(count))
            try insist(data.count <= 64 * 1024, "Protected file ACL metadata exceeds its bound")
        } else if count == 0 {
            ended = true
            if task.isRunning { Thread.sleep(forTimeInterval: 0.005) }
        } else {
            try insist(errno == EAGAIN || errno == EINTR, "Protected file ACL metadata could not be read")
            Thread.sleep(forTimeInterval: 0.005)
        }
    }
    task.waitUntilExit()
    try insist(task.terminationReason == .exit && task.terminationStatus == 0, "Protected file ACL metadata reader failed")
    guard let text = String(data: data, encoding: .utf8) else { throw Refusal.stopped("Protected file ACL metadata is unreadable") }
    var lines = text.components(separatedBy: "\n")
    if lines.last == "" { lines.removeLast() }
    // '+' or any following ACL entry refuses. '@' denotes other extended
    // attributes only when no ACL entries follow. Unknown output also refuses.
    try insist(lines.count == 1 && lines[0].range(of: "^[bcdlps-][rwxstST-]{9}[ @]", options: .regularExpression) != nil, "Protected installation has an ACL or unknown ACL state")
}
func protectedFile(_ path: String, maximum: Int) throws -> Data {
    var current = ""
    for part in path.split(separator: "/") {
        current += "/" + part
        var info = stat()
        try insist(lstat(current, &info) == 0 && info.st_uid == 0 && info.st_mode & 0o022 == 0 && info.st_mode & S_IFMT != S_IFLNK, "Protected installation missing or writable by the app")
        try requireNoExtendedAcl(current)
        let writable = access(current, W_OK), writeError = errno
        try insist(writable != 0 && [EACCES, EPERM, EROFS].contains(writeError), "The calling account can alter the protected installation, or its access is unknown")
    }
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    try insist(fd >= 0, "Protected file could not be opened")
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    var info = stat()
    try insist(fstat(fd, &info) == 0 && info.st_uid == 0 && info.st_mode & 0o022 == 0 && info.st_mode & S_IFMT == S_IFREG && info.st_nlink == 1 && info.st_size <= maximum, "Protected file identity is invalid")
    return try handle.readToEnd() ?? Data()
}
func assertInstallation() throws {
    try insist(Bundle.main.executableURL?.path == installedBinary, "Install the reviewed native helper under the protected controller before enrolling or signing. A source-build probe cannot activate protection.")
    let binary = try protectedFile(installedBinary, maximum: 8_000_000)
    let policy = try object(JSONSerialization.jsonObject(with: protectedFile(signingPolicy, maximum: 4096)), ["schema_version", "teamIdentifier", "signingIdentifier", "executableSha256"])
    let team = try text(policy["teamIdentifier"], "publisher team"), identifier = try text(policy["signingIdentifier"], "signing identity")
    try insist(policy["schema_version"] as? String == "wringer.native-signing-policy.v1" && team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil && identifier == "com.wringer.confirmation" && policy["executableSha256"] as? String == digest(binary), "Native publisher or exact executable does not match the protected installation policy")
    var code: SecCode?
    try insist(SecCodeCopySelf([], &code) == errSecSuccess && code != nil, "Native helper signature unavailable")
    try insist(SecCodeCheckValidity(code!, [], nil) == errSecSuccess, "Native helper signature is invalid")
    var requirement: SecRequirement?
    let rule = "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"\(team)\""
    try insist(SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess && requirement != nil && SecCodeCheckValidity(code!, [], requirement) == errSecSuccess, "Native helper is not signed by the protected publisher")
    var staticCode: SecStaticCode?
    try insist(SecCodeCopyStaticCode(code!, [], &staticCode) == errSecSuccess && staticCode != nil, "Native helper static signature unavailable")
    var details: CFDictionary?
    try insist(SecCodeCopySigningInformation(staticCode!, SecCSFlags(rawValue: kSecCSSigningInformation), &details) == errSecSuccess, "Native helper signing information unavailable")
    let info = details as? [String: Any] ?? [:]
    let flags = info[kSecCodeInfoFlags as String] as? UInt32 ?? 0
    try insist(flags & 0x10000 != 0, "Native helper must use the hardened runtime")
    let entitlements = info[kSecCodeInfoEntitlementsDict as String] as? [String: Any] ?? [:]
    let applicationId = "\(team).\(identifier)"
    try insist(entitlements["com.apple.application-identifier"] as? String == applicationId && (entitlements["keychain-access-groups"] as? [String]) == [applicationId] && entitlements["com.apple.security.get-task-allow"] as? Bool != true && entitlements["com.apple.security.cs.disable-library-validation"] as? Bool != true, "Native confirmation lacks the exact provisioned Keychain identity or permits debugging/injection")
}
func context() throws -> LAContext {
    let value = LAContext(); value.localizedFallbackTitle = ""; value.touchIDAuthenticationAllowableReuseDuration = 0
    var error: NSError?
    try insist(value.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error), "Biometric confirmation is unavailable. No password, checkbox or software-key fallback is permitted.")
    return value
}
func storedKey(_ auth: LAContext) throws -> SecKey {
    let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecReturnRef as String: true, kSecUseDataProtectionKeychain as String: true, kSecUseAuthenticationContext as String: auth]
    var item: CFTypeRef?
    try insist(SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess && item != nil, "No enrolled confirmation key is available. Nothing was signed.")
    let key = item as! SecKey
    let attributes = SecKeyCopyAttributes(key) as? [String: Any]
    try insist(attributes?[kSecAttrTokenID as String] as? String == kSecAttrTokenIDSecureEnclave as String, "Enrolled key is not a Secure Enclave key")
    return key
}
func publicPoint(_ key: SecKey) throws -> Data {
    guard let pub = SecKeyCopyPublicKey(key), let data = SecKeyCopyExternalRepresentation(pub, nil) as Data? else { throw Refusal.stopped("Confirmation public key unavailable") }
    try insist(data.count == 65 && data.first == 4, "Unexpected confirmation public key"); return data
}
func enroll() throws {
    try assertInstallation()
    let auth = try context()
    defer { auth.invalidate() }
    // Never replace an existing item or a changed biometric enrollment silently.
    var existing: CFTypeRef?
    let inspection = LAContext(); inspection.interactionNotAllowed = true
    defer { inspection.invalidate() }
    let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag, kSecUseDataProtectionKeychain as String: true, kSecReturnAttributes as String: true, kSecUseAuthenticationContext as String: inspection]
    let found = SecItemCopyMatching(query as CFDictionary, &existing)
    try insist(found == errSecItemNotFound, "An enrollment exists or its state cannot be read. No key was replaced; use the protected enrollment recovery procedure.")
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error) else { throw Refusal.stopped("Biometric access control could not be created") }
    let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave, kSecUseDataProtectionKeychain as String: true, kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: keyTag, kSecAttrAccessControl as String: access]]
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else { throw Refusal.stopped("Secure Enclave enrollment failed; no software key was substituted") }
    let point = try publicPoint(key)
    emit(["schema_version": "wringer.native-enrollment.v1", "publicKey": point.base64EncodedString(), "keyId": digest(point), "protection": "secure-enclave-biometry-current-set", "note": "Local enrollment observation, not portable hardware attestation. A protected administrator must pin this public key and verify its provenance before activation."])
}
func confirm() throws {
    try assertInstallation()
    let envelope = try object(JSONSerialization.jsonObject(with: readBoundedInput()), ["schema_version", "payload", "controllerSignature"])
    try insist(envelope["schema_version"] as? String == "wringer.confirmation-envelope.v1", "Unknown confirmation envelope")
    let payload = try data64(envelope["payload"], 192 * 1024), signature = try data64(envelope["controllerSignature"], 80)
    let rawPin = try protectedFile(controllerPin, maximum: 65)
    try insist(rawPin.count == 65 && rawPin.first == 4, "Protected controller public key is invalid")
    let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass as String: kSecAttrKeyClassPublic, kSecAttrKeySizeInBits as String: 256]
    guard let pin = SecKeyCreateWithData(rawPin as CFData, attributes as CFDictionary, nil) else { throw Refusal.stopped("Controller public key could not be loaded") }
    try insist(SecKeyVerifySignature(pin, .ecdsaSignatureMessageX962SHA256, payload as CFData, signature as CFData, nil), "The protected controller did not sign this request")
    let challenge = try object(JSONSerialization.jsonObject(with: payload), ["schema_version", "id", "nonce", "issuedAt", "expiresAt", "decision"])
    try insist(challenge["schema_version"] as? String == "wringer.confirmation-challenge.v1", "Unknown challenge")
    let id = try text(challenge["id"], "challenge identity")
    try insist(UUID(uuidString: id) != nil, "Invalid challenge identity")
    let dateFormat = ISO8601DateFormatter(); dateFormat.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let issued = dateFormat.date(from: try text(challenge["issuedAt"], "issue time")), let expires = dateFormat.date(from: try text(challenge["expiresAt"], "expiry")) else { throw Refusal.stopped("Invalid confirmation lifetime") }
    try insist(issued <= Date() && expires > Date() && expires.timeIntervalSince(issued) > 0 && expires.timeIntervalSince(issued) <= 120, "Confirmation has expired")
    let decision = try object(challenge["decision"], ["schema_version", "controllerId", "jobId", "kind", "expectedRevision", "expectedCandidateTree", "actor", "originalRequest", "action"])
    try insist(decision["schema_version"] as? String == "wringer.protected-decision.v1", "Unknown decision")
    let kind = try text(decision["kind"], "decision kind")
    let titles = ["execution": "Approve this bounded work", "human-review": "Record your observation of this result", "publication": "Approve this exact handover"]
    guard let title = titles[kind] else { throw Refusal.stopped("Unknown decision kind") }
    let request = try text(decision["originalRequest"], "original request"), actor = try text(decision["actor"], "person"), revision = try text(decision["expectedRevision"], "revision")
    let pretty = try JSONSerialization.data(withJSONObject: decision, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    NSApplication.shared.setActivationPolicy(.accessory)
    let alert = NSAlert(); alert.messageText = title
    let preview = String(request.prefix(240)) + (request.count > 240 ? "…" : "")
    alert.informativeText = "Requested by: \(actor)\n\nRequest preview: \(preview)\n\nReview the complete original request and action in the scroll area below. This signs only this decision, not future work. Next, Touch ID confirms your presence. Cancel if you did not request this."
    alert.addButton(withTitle: "Review complete — use Touch ID"); alert.addButton(withTitle: "Cancel")
    let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 620, height: 300)); scroll.hasVerticalScroller = true
    let details = NSTextView(frame: scroll.bounds); details.isEditable = false; details.isSelectable = true; details.font = .monospacedSystemFont(ofSize: 11, weight: .regular); details.string = String(data: pretty, encoding: .utf8)!; details.isVerticallyResizable = true; details.textContainer?.widthTracksTextView = true
    scroll.documentView = details; alert.accessoryView = scroll
    NSApplication.shared.activate(ignoringOtherApps: true)
    try insist(alert.runModal() == .alertFirstButtonReturn && Date() < expires, "Decision cancelled or expired; nothing signed")
    let auth = try context(); defer { auth.invalidate() }
    // Fresh context for every decision; no prior Touch ID success is reused.
    let semaphore = DispatchSemaphore(value: 0); var authenticated = false
    auth.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "\(title) · decision \(String(revision.prefix(12)))") { ok, _ in authenticated = ok; semaphore.signal() }
    try insist(semaphore.wait(timeout: .now() + min(90, expires.timeIntervalSinceNow)) == .success && authenticated && Date() < expires, "Biometric confirmation cancelled, failed or expired")
    let key = try storedKey(auth), point = try publicPoint(key)
    var error: Unmanaged<CFError>?
    guard let signed = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, payload as CFData, &error) as Data?, Date() < expires else { throw Refusal.stopped("Biometric key could not sign before expiry; no fallback was used") }
    emit(["schema_version": "wringer.confirmation-proof.v1", "challengeId": id, "keyId": digest(point), "signature": signed.base64EncodedString()])
}
do {
    try insist(CommandLine.arguments.count == 2, "Use probe, enroll or confirm. No arbitrary path, URL or shell option is accepted.")
    switch CommandLine.arguments[1] {
    case "probe":
        let auth = LAContext(); var error: NSError?; let ready = auth.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error); auth.invalidate()
        var systemPathReadable = false, fileReason = "Root-owned system file checked"
        do { _ = try protectedFile("/bin/ls", maximum: 8_000_000); systemPathReadable = true }
        catch Refusal.stopped(let reason) { fileReason = reason }
        catch { fileReason = "Root-owned system file inspection unavailable" }
        emit(["schema_version": "wringer.native-confirmation-probe.v1", "biometricsAvailable": ready, "biometricsErrorCode": error?.code as Any? ?? NSNull(), "protectedSystemFileCheck": systemPathReadable, "protectedSystemFileReason": fileReason, "installedLocation": Bundle.main.executableURL?.path == installedBinary, "protectionEstablished": false, "note": "Read-only capability probe: no enrollment, signing, prompt, key read, controller installation or protection claim."])
    case "enroll": try enroll()
    case "confirm": try confirm()
    default: throw Refusal.stopped("Unknown operation")
    }
} catch {
    let message: String
    if case Refusal.stopped(let reason) = error { message = reason } else { message = "Native confirmation input or operating-system operation was refused" }
    emit(["schema_version": "wringer.native-confirmation-refusal.v1", "outcome": "refused", "message": message]); exit(2)
}
