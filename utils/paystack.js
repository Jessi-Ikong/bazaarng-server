// Thin wrapper around Paystack's REST API. Uses Node's built-in fetch
// (Node 18+) rather than adding an SDK dependency for a handful of calls.
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

// amount is in Naira; Paystack expects kobo (amount * 100)
async function initializeTransaction({ email, amountNaira, reference, callbackUrl, metadata }) {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      amount: Math.round(amountNaira * 100),
      reference,
      callback_url: callbackUrl,
      metadata,
    }),
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || 'Could not initialize Paystack transaction');
  }
  return data.data; // { authorization_url, access_code, reference }
}

async function verifyTransaction(reference) {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || 'Could not verify Paystack transaction');
  }
  return data.data; // { status: 'success'|'failed'|..., amount, reference, ... }
}

module.exports = { initializeTransaction, verifyTransaction };
