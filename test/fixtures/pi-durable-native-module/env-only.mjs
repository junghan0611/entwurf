// Synthetic development fixture for the pi-durable `--native-module` ingress (#130 P2): an env-only
// module. Its initialization sets one synthetic, non-identity value; its default export is a native
// durable Extension with a name and nothing to register. Never ships; imports nothing.
process.env.MOCK_NATIVE_MARK = "mock-native-env-only-5d21";

export default { name: "mock-env-only" };
