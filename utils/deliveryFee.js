// Shared by checkout and the cart delivery-fee preview so the two can
// never drift out of sync. Simple 3-tier system based on comparing the
// vendor's own city/state to the buyer's shipping city/state — no real
// distance calculation or mapping service involved.
function calculateDeliveryFee(vendorProfile, shippingAddress) {
  const vendorCity = (vendorProfile?.city || '').trim().toLowerCase();
  const vendorState = (vendorProfile?.state || '').trim().toLowerCase();
  const buyerCity = (shippingAddress?.city || '').trim().toLowerCase();
  const buyerState = (shippingAddress?.state || '').trim().toLowerCase();

  if (vendorCity && buyerCity && vendorCity === buyerCity) {
    return vendorProfile.deliveryFeeSameCity || 0;
  }
  if (vendorState && buyerState && vendorState === buyerState) {
    return vendorProfile.deliveryFeeSameState || 0;
  }
  return vendorProfile?.deliveryFeeDifferentState || 0;
}

module.exports = { calculateDeliveryFee };
