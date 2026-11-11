// Takes payment for an order-ahead order.
//
// Demo mode (no key in config.js): waits a moment and reports success. No money moves.
// Live mode (a Paystack public key in config.js): opens Paystack's own checkout, which
// handles the card or bank-transfer details. FastLane never sees or stores them.
//
// Without a server, a payment is trusted as soon as Paystack's window reports success.
// A live store must also confirm each payment on a server, using the reference, before
// handing goods over.
import { PAYSTACK_PUBLIC_KEY } from './config.js';

export const liveMode = /^pk_(test|live)_[A-Za-z0-9]+$/.test(PAYSTACK_PUBLIC_KEY);

let loading;
function loadPaystack() {
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.onload = resolve;
    script.onerror = () => { loading = undefined; reject(new Error('The payment service could not be reached. Check your connection and try again.')); };
    document.head.append(script);
  });
  return loading;
}

// amount is in kobo. Resolves { reference, method, mode }, or null if the shopper cancelled.
export async function takePayment({ amount, email, reference, method }) {
  if (!liveMode) {
    await new Promise((r) => setTimeout(r, method === 'transfer' ? 2400 : 1600));
    return { reference: 'DEMO-' + reference, method, mode: 'demo' };
  }
  await loadPaystack();
  return new Promise((resolve, reject) => {
    const popup = new window.PaystackPop();
    popup.newTransaction({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount,
      currency: 'NGN',
      reference,
      channels: method === 'transfer' ? ['bank_transfer'] : ['card'],
      onSuccess: (tx) => resolve({ reference: tx?.reference || reference, method, mode: 'paystack' }),
      onCancel: () => resolve(null),
      onError: (err) => reject(new Error(err?.message || 'The payment did not go through. Nothing was charged.')),
    });
  });
}
