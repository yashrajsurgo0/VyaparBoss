// WhatsApp intake: implemented in step 4. Stub keeps the server routes stable until then.
function createWhatsApp() {
  const off = Object.assign(new Error("WhatsApp is not set up yet"), { status: 503 });
  return {
    configured: false,
    verify() { throw off; },
    receive() { throw off; },
    async handleText() { throw off; },
  };
}
module.exports = { createWhatsApp };
