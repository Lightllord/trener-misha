// The band within an open window — picked by whether the model is mid-response.
export type DeliveryBand = "full" | "interrupt";

// Concrete combined window state for the delivery site to switch on.
//   "closed"    — user is speaking; do not act on the channel.
//   "full"      — open, model silent; deliver any insight into the pause.
//   "interrupt" — open, model mid-response; only critical insights, by
//                 cancelling and restarting the current output.
export type DeliveryState = DeliveryBand | "closed";
