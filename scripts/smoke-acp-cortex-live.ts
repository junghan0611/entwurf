// Cortex ACP is no longer a supported Entwurf backend. Keep the old developer
// entry as a named refusal, never a vendor launch or a successful/skipped probe.
console.error("[entwurf:cortex-acp-disabled] Cortex ACP is not supported; no live probe was started.");
process.exitCode = 2;
