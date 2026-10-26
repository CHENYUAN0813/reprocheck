export function verifyProtocolLock(report, lockId) {
  if (!/^[a-f\d]{64}$/.test(lockId) || report.protocolLock?.lockId !== lockId) throw new Error("Protocol lock does not match this scanned report");
  return report.protocolLock;
}
