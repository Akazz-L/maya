/** Leave the app for another site, such as Stripe's checkout. */
export function goTo(url: string): void {
  window.location.assign(url);
}
